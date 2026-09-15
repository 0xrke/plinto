/**
 * State machine for multi-transaction actions (create launch, trades with a Jupiter leg, redeem,
 * crank). The reducer is pure and ignores events that do not fit the current state, so a late
 * callback can never move a finished flow backwards.
 *
 *   idle ──start──▶ running ──(every step done or skipped)──▶ succeeded
 *                     │  ▲
 *            step-failed  resume (from the failed step)
 *                     ▼  │
 *                   failed
 *
 * Within `running`, exactly one step is active at a time; its `phase` tells the UI whether the
 * wallet is asked to sign or the network is confirming.
 */

export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";
export type StepPhase = "preparing" | "signing" | "confirming";

export interface TxStep {
  id: string;
  label: string;
  status: StepStatus;
  phase?: StepPhase;
  signature?: string;
  /** Result or skip reason shown under the step. */
  detail?: string;
  error?: string;
}

export type TxFlowStatus = "idle" | "running" | "succeeded" | "failed";

export interface TxFlowState {
  status: TxFlowStatus;
  steps: TxStep[];
  /** Error of the failed step (or of the flow before any step started). */
  error: string | null;
  /** Summary shown once the flow succeeded. */
  result: string | null;
}

export type TxFlowEvent =
  | { type: "start"; steps: Array<{ id: string; label: string }> }
  | { type: "step-started"; id: string; phase?: StepPhase }
  | { type: "step-phase"; id: string; phase: StepPhase }
  | { type: "step-succeeded"; id: string; signature?: string; detail?: string }
  | { type: "step-skipped"; id: string; detail?: string }
  | { type: "step-failed"; id: string; error: string }
  /** Add steps discovered while running (crank re-planning). Existing ids are left untouched. */
  | { type: "steps-added"; steps: Array<{ id: string; label: string }> }
  /** Mark every still-pending step skipped (the rest is no longer needed). */
  | { type: "skip-pending"; detail: string }
  | { type: "finish"; result?: string }
  /** Fail the flow outside a step (validation, guard). */
  | { type: "fail"; error: string }
  /** Retry after a failure: the failed step becomes pending again, finished steps stay done. */
  | { type: "resume" }
  | { type: "reset" };

export const IDLE_FLOW: TxFlowState = { status: "idle", steps: [], error: null, result: null };

function update(state: TxFlowState, id: string, fn: (s: TxStep) => TxStep | null): TxFlowState {
  const i = state.steps.findIndex((s) => s.id === id);
  if (i < 0) return state;
  const next = fn(state.steps[i]!);
  if (!next) return state;
  const steps = state.steps.slice();
  steps[i] = next;
  return { ...state, steps };
}

export function txFlowReducer(state: TxFlowState, event: TxFlowEvent): TxFlowState {
  switch (event.type) {
    case "reset":
      return IDLE_FLOW;
    case "start":
      if (state.status === "running") return state;
      return {
        status: "running",
        steps: event.steps.map((s) => ({ id: s.id, label: s.label, status: "pending" })),
        error: null,
        result: null,
      };
    case "resume":
      if (state.status !== "failed") return state;
      return {
        status: "running",
        error: null,
        result: null,
        steps: state.steps.map((s) => (s.status === "failed" || s.status === "active" ? { id: s.id, label: s.label, status: "pending" } : s)),
      };
    case "steps-added": {
      if (state.status !== "running") return state;
      const known = new Set(state.steps.map((s) => s.id));
      const added = event.steps.filter((s) => !known.has(s.id)).map((s): TxStep => ({ id: s.id, label: s.label, status: "pending" }));
      return added.length ? { ...state, steps: [...state.steps, ...added] } : state;
    }
    case "step-started":
      if (state.status !== "running" || state.steps.some((s) => s.status === "active")) return state;
      return update(state, event.id, (s) => (s.status === "pending" ? { ...s, status: "active", phase: event.phase ?? "preparing" } : null));
    case "step-phase":
      if (state.status !== "running") return state;
      return update(state, event.id, (s) => (s.status === "active" ? { ...s, phase: event.phase } : null));
    case "step-succeeded":
      if (state.status !== "running") return state;
      return update(state, event.id, (s) =>
        s.status === "active" || s.status === "pending"
          ? { id: s.id, label: s.label, status: "done", signature: event.signature, detail: event.detail }
          : null,
      );
    case "step-skipped":
      if (state.status !== "running") return state;
      return update(state, event.id, (s) =>
        s.status === "active" || s.status === "pending" ? { id: s.id, label: s.label, status: "skipped", detail: event.detail } : null,
      );
    case "skip-pending":
      if (state.status !== "running") return state;
      return { ...state, steps: state.steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped", detail: event.detail } : s)) };
    case "step-failed": {
      if (state.status !== "running") return state;
      const next = update(state, event.id, (s) =>
        s.status === "active" || s.status === "pending" ? { id: s.id, label: s.label, status: "failed", error: event.error } : null,
      );
      if (next === state) return state;
      return { ...next, status: "failed", error: event.error };
    }
    case "fail":
      if (state.status === "succeeded") return state;
      return {
        ...state,
        status: "failed",
        error: event.error,
        steps: state.steps.map((s) => (s.status === "active" ? { id: s.id, label: s.label, status: "failed", error: event.error } : s)),
      };
    case "finish":
      if (state.status !== "running") return state;
      if (state.steps.some((s) => s.status === "pending" || s.status === "active" || s.status === "failed")) return state;
      return { ...state, status: "succeeded", result: event.result ?? null };
  }
}

/** Callback the actions use to report progress (a React dispatch or a test recorder). */
export type FlowDispatch = (event: TxFlowEvent) => void;

export const noopDispatch: FlowDispatch = () => {};

/** Replays events through the reducer (tests, node scripts). */
export function recordFlow(): { dispatch: FlowDispatch; state: () => TxFlowState; events: TxFlowEvent[] } {
  let current = IDLE_FLOW;
  const events: TxFlowEvent[] = [];
  return {
    events,
    dispatch: (e) => {
      events.push(e);
      current = txFlowReducer(current, e);
    },
    state: () => current,
  };
}

export interface StepRunner {
  id: string;
  label: string;
  /** Returns true when the step already happened on chain (resume after a lost confirmation). */
  alreadyDone?: () => Promise<boolean>;
  run: (phase: (p: StepPhase) => void) => Promise<{ signature?: string; detail?: string }>;
}

/**
 * Run steps in order, dispatching flow events. Steps whose id is in `completed` are skipped over
 * (already done in an earlier attempt). Stops at the first failure and rethrows it.
 */
export async function runSteps(
  steps: StepRunner[],
  dispatch: FlowDispatch,
  completed: Set<string>,
  describeError: (e: unknown) => string,
): Promise<void> {
  for (const step of steps) {
    if (completed.has(step.id)) continue;
    dispatch({ type: "step-started", id: step.id, phase: "preparing" });
    try {
      if (step.alreadyDone && (await step.alreadyDone())) {
        completed.add(step.id);
        dispatch({ type: "step-succeeded", id: step.id, detail: "Already confirmed on chain" });
        continue;
      }
      const res = await step.run((phase) => dispatch({ type: "step-phase", id: step.id, phase }));
      completed.add(step.id);
      dispatch({ type: "step-succeeded", id: step.id, signature: res.signature, detail: res.detail });
    } catch (e) {
      dispatch({ type: "step-failed", id: step.id, error: describeError(e) });
      throw e;
    }
  }
}
