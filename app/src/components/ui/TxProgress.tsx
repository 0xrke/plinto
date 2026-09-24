"use client";

import type { ReactNode } from "react";
import { RPC_URL } from "@/lib/config";
import { explorerTxUrl } from "@/lib/chain/explorer";
import type { StepPhase, TxFlowState, TxStep } from "@/lib/chain/txFlow";
import { truncateAddress } from "@/lib/format";

const PHASE_TEXT: Record<StepPhase, string> = {
  preparing: "Preparing…",
  signing: "Approve in your wallet…",
  confirming: "Confirming on chain…",
};

function StepIcon({ step, index }: { step: TxStep; index: number }) {
  const base = "flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] text-xs font-bold";
  switch (step.status) {
    case "done":
      return (
        <span className={`${base} bg-floor text-white`} aria-hidden>
          ✓
        </span>
      );
    case "failed":
      return (
        <span className={`${base} bg-risk text-white`} aria-hidden>
          !
        </span>
      );
    case "skipped":
      return (
        <span className={`${base} bg-lilac text-ink-3`} aria-hidden>
          –
        </span>
      );
    case "active":
      return (
        <span className={`${base} bg-violet-soft text-violet`} aria-hidden>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-violet" />
        </span>
      );
    default:
      return (
        <span className={`${base} bg-surface text-ink-3 ring-1 ring-line-strong`} aria-hidden>
          {index + 1}
        </span>
      );
  }
}

const STATUS_TEXT: Record<TxStep["status"], string> = {
  pending: "waiting",
  active: "in progress",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};

/**
 * Step-by-step progress of a transaction flow: one row per transaction with its status, what the
 * app is waiting for (wallet approval or confirmation), the explorer link and any error.
 */
export function TxProgress({
  flow,
  title,
  actions,
  rpcUrl = RPC_URL,
}: {
  flow: TxFlowState;
  title?: string;
  /** Buttons under the list (retry, dismiss, links). */
  actions?: ReactNode;
  rpcUrl?: string;
}) {
  if (flow.status === "idle") return null;
  return (
    <div className="space-y-3 rounded-[20px] bg-cloud p-4" aria-live="polite">
      {title ? <p className="text-sm font-bold text-ink">{title}</p> : null}
      {flow.steps.length > 0 ? (
        <ol className="space-y-2.5">
          {flow.steps.map((step, i) => (
            <li key={step.id} className="flex items-start gap-3 text-sm">
              <StepIcon step={step} index={i} />
              <div className="min-w-0 flex-1">
                <p className={step.status === "pending" || step.status === "skipped" ? "text-ink-3" : "text-ink"}>
                  {step.label}
                  <span className="sr-only"> ({STATUS_TEXT[step.status]})</span>
                </p>
                {step.status === "active" && step.phase ? <p className="text-xs font-medium text-violet">{PHASE_TEXT[step.phase]}</p> : null}
                {step.signature ? (
                  <a
                    href={explorerTxUrl(step.signature, rpcUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-violet underline-offset-2 hover:underline"
                    title={step.signature}
                  >
                    {truncateAddress(step.signature, 8)}
                  </a>
                ) : null}
                {step.detail ? <p className="text-xs text-ink-3">{step.detail}</p> : null}
                {step.error ? <p className="text-xs text-risk">{step.error}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {flow.status === "failed" && flow.error ? (
        <p role="alert" className="rounded-[14px] bg-risk-wash px-3 py-2.5 text-sm text-risk">
          {flow.error}
        </p>
      ) : null}
      {flow.status === "succeeded" && flow.result ? (
        <p role="status" className="rounded-[14px] bg-floor-wash px-3 py-2.5 text-sm text-floor">
          {flow.result}
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
