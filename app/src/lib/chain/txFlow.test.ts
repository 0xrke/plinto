import { describe, expect, it } from "vitest";
import { IDLE_FLOW, recordFlow, runSteps, txFlowReducer, type TxFlowEvent, type TxFlowState } from "./txFlow";

const two = [
  { id: "a", label: "Step A" },
  { id: "b", label: "Step B" },
];

function play(events: TxFlowEvent[], from: TxFlowState = IDLE_FLOW): TxFlowState {
  return events.reduce(txFlowReducer, from);
}

describe("txFlowReducer", () => {
  it("runs steps in order through signing and confirming to success", () => {
    let s = play([{ type: "start", steps: two }]);
    expect(s.status).toBe("running");
    expect(s.steps.map((x) => x.status)).toEqual(["pending", "pending"]);

    s = play([{ type: "step-started", id: "a" }, { type: "step-phase", id: "a", phase: "signing" }], s);
    expect(s.steps[0]).toMatchObject({ status: "active", phase: "signing" });
    s = play([{ type: "step-phase", id: "a", phase: "confirming" }, { type: "step-succeeded", id: "a", signature: "sigA" }], s);
    expect(s.steps[0]).toEqual({ id: "a", label: "Step A", status: "done", signature: "sigA", detail: undefined });

    // Finishing early is ignored while a step is still pending.
    expect(play([{ type: "finish", result: "early" }], s).status).toBe("running");

    s = play([{ type: "step-started", id: "b" }, { type: "step-succeeded", id: "b", signature: "sigB" }, { type: "finish", result: "All done" }], s);
    expect(s.status).toBe("succeeded");
    expect(s.result).toBe("All done");
  });

  it("allows only one active step and ignores events for unknown or finished steps", () => {
    let s = play([{ type: "start", steps: two }, { type: "step-started", id: "a" }]);
    expect(play([{ type: "step-started", id: "b" }], s)).toBe(s);
    expect(play([{ type: "step-succeeded", id: "zzz" }], s)).toBe(s);
    s = play([{ type: "step-succeeded", id: "a" }], s);
    expect(play([{ type: "step-failed", id: "a", error: "late" }], s)).toBe(s);
    expect(play([{ type: "step-phase", id: "a", phase: "signing" }], s)).toBe(s);
  });

  it("fails at a step and resumes from it, keeping finished steps", () => {
    let s = play([
      { type: "start", steps: two },
      { type: "step-started", id: "a" },
      { type: "step-succeeded", id: "a", signature: "sigA" },
      { type: "step-started", id: "b" },
      { type: "step-failed", id: "b", error: "ExceededSlippage" },
    ]);
    expect(s.status).toBe("failed");
    expect(s.error).toBe("ExceededSlippage");
    expect(s.steps.map((x) => x.status)).toEqual(["done", "failed"]);
    // A finished flow cannot be moved by late step events.
    expect(play([{ type: "step-succeeded", id: "b" }], s)).toBe(s);

    s = play([{ type: "resume" }], s);
    expect(s.status).toBe("running");
    expect(s.error).toBeNull();
    expect(s.steps.map((x) => x.status)).toEqual(["done", "pending"]);
    expect(s.steps[0]!.signature).toBe("sigA");

    s = play([{ type: "step-started", id: "b" }, { type: "step-succeeded", id: "b" }, { type: "finish" }], s);
    expect(s.status).toBe("succeeded");
  });

  it("fails before any step (validation) and marks an active step failed on a flow-level failure", () => {
    const early = play([{ type: "fail", error: "Connect a wallet" }]);
    expect(early).toEqual({ status: "failed", steps: [], error: "Connect a wallet", result: null });

    const mid = play([{ type: "start", steps: two }, { type: "step-started", id: "a" }, { type: "fail", error: "RPC down" }]);
    expect(mid.status).toBe("failed");
    expect(mid.steps[0]).toMatchObject({ status: "failed", error: "RPC down" });
    expect(mid.steps[1]!.status).toBe("pending");

    const done = play([{ type: "start", steps: [two[0]!] }, { type: "step-succeeded", id: "a" }, { type: "finish" }]);
    expect(play([{ type: "fail", error: "late" }], done)).toBe(done);
  });

  it("adds steps discovered while running, skips the rest, and resets", () => {
    let s = play([{ type: "start", steps: [two[0]!] }, { type: "steps-added", steps: two }]);
    expect(s.steps.map((x) => x.id)).toEqual(["a", "b"]);
    s = play([{ type: "step-started", id: "a" }, { type: "step-skipped", id: "a", detail: "done by someone else" }, { type: "skip-pending", detail: "No longer due" }, { type: "finish" }], s);
    expect(s.steps.map((x) => [x.status, x.detail])).toEqual([
      ["skipped", "done by someone else"],
      ["skipped", "No longer due"],
    ]);
    expect(s.status).toBe("succeeded");
    expect(play([{ type: "reset" }], s)).toBe(IDLE_FLOW);
    // A second start while running is ignored.
    const running = play([{ type: "start", steps: two }]);
    expect(play([{ type: "start", steps: [] }], running)).toBe(running);
  });
});

describe("runSteps", () => {
  it("runs pending steps, reports phases and signatures, and skips steps completed earlier", async () => {
    const rec = recordFlow();
    rec.dispatch({ type: "start", steps: [...two, { id: "c", label: "Step C" }] });
    const completed = new Set(["a"]);
    rec.dispatch({ type: "step-succeeded", id: "a", detail: "earlier" });
    const ran: string[] = [];
    await runSteps(
      [
        { id: "a", label: "A", run: async () => (ran.push("a"), { signature: "x" }) },
        {
          id: "b",
          label: "B",
          run: async (phase) => {
            phase("signing");
            phase("confirming");
            ran.push("b");
            return { signature: "sigB" };
          },
        },
        { id: "c", label: "C", alreadyDone: async () => true, run: async () => (ran.push("c"), {}) },
      ],
      rec.dispatch,
      completed,
      String,
    );
    rec.dispatch({ type: "finish" });
    expect(ran).toEqual(["b"]);
    expect([...completed]).toEqual(["a", "b", "c"]);
    const st = rec.state();
    expect(st.status).toBe("succeeded");
    expect(st.steps.map((x) => [x.id, x.status, x.signature ?? x.detail])).toEqual([
      ["a", "done", "earlier"],
      ["b", "done", "sigB"],
      ["c", "done", "Already confirmed on chain"],
    ]);
    const phases = rec.events.filter((e) => e.type === "step-phase").map((e) => (e as { phase: string }).phase);
    expect(phases).toEqual(["signing", "confirming"]);
  });

  it("stops at the first failure with a described error and rethrows it", async () => {
    const rec = recordFlow();
    rec.dispatch({ type: "start", steps: two });
    const completed = new Set<string>();
    const boom = new Error("raw failure");
    await expect(
      runSteps(
        [
          { id: "a", label: "A", run: async () => ({}) },
          {
            id: "b",
            label: "B",
            run: async () => {
              throw boom;
            },
          },
        ],
        rec.dispatch,
        completed,
        () => "Readable failure.",
      ),
    ).rejects.toBe(boom);
    expect(rec.state().status).toBe("failed");
    expect(rec.state().error).toBe("Readable failure.");
    expect([...completed]).toEqual(["a"]);
  });
});
