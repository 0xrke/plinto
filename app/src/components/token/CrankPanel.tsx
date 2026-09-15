"use client";

import { useId, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { planCrank, type CrankAction } from "@stockfloor/sdk";
import type { LaunchSummary } from "@/lib/data/types";
import { useData, useRefreshChainData, useTxFlow } from "@/lib/data/context";
import { crankActionLabel } from "@/lib/data/chainActions";
import { formatTokenAmount } from "@/lib/format";
import { TxProgress } from "@/components/ui/TxProgress";
import { useActionGate } from "./useActionGate";

function actionDetail(a: CrankAction, launch: LaunchSummary): string | null {
  const q = launch.quote;
  const quote = (raw: bigint) => `${formatTokenAmount(raw, q.asset.decimals, { multiplier: q.multiplier, maxFractionDigits: 8 })} ${q.asset.symbol}`;
  switch (a.kind) {
    case "harvest_curve_fees":
      return `${quote(a.partnerQuoteFee)} to the vault`;
    case "harvest_migration_fee":
      return `${quote(a.expectedQuote)} to the vault`;
    case "harvest_surplus":
      return a.expectedQuote > 0n ? `${quote(a.expectedQuote)} to the vault` : "Sets the surplus flag (nothing to move)";
    case "harvest_lp_fees":
      return `${quote(a.pendingQuote)} to the vault`;
    case "burn_claimer_base":
      return `${formatTokenAmount(a.amount, launch.baseDecimals)} $${launch.symbol} burned`;
    default:
      return null;
  }
}

/**
 * Permissionless maintenance for demos: shows the crank actions due now (harvests, migration, burns)
 * and runs them with the connected wallet paying the fees. Nothing here can move vault funds out.
 */
export function CrankPanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions } = useData();
  const gate = useActionGate({ requireAttestation: false });
  const refresh = useRefreshChainData();
  const [flow, dispatch] = useTxFlow();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!launch.chain) return null;
  const due = planCrank(launch.chain);

  async function onRun() {
    setPending(true);
    setMessage(null);
    dispatch({ type: "reset" });
    const result = await actions.crank(launch, wallet, { dispatch });
    setPending(false);
    if (!result.ok) setMessage(result.error);
    refresh();
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
          Crank
        </h2>
        <span className="text-xs text-ink-3">Permissionless</span>
      </div>
      <p className="mt-1 text-sm text-ink-2">
        Anyone can move a launch forward: harvest fees into the vault, migrate a completed curve to DAMM v2, harvest
        the migration fee. Funds only ever go into the vault.
      </p>
      {due.length === 0 ? (
        <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">Nothing is due right now.</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {due.map((a, i) => {
            const detail = actionDetail(a, launch);
            return (
              <li key={`${a.kind}-${i}`} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-ink">{crankActionLabel(a)}</span>
                {detail ? <span className="tnum text-ink-3">{detail}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="btn btn-secondary mt-4 w-full"
        disabled={!gate.ready || pending || due.length === 0}
        aria-busy={pending}
        onClick={onRun}
      >
        {pending ? "Running the crank…" : due.length > 0 ? `Run crank (${due.length} step${due.length === 1 ? "" : "s"})` : "Run crank"}
      </button>
      {!gate.ready ? <p className="field-hint mt-2">{gate.reason}</p> : null}
      <div className="mt-3">
        <TxProgress flow={flow} />
      </div>
      {flow.status === "idle" && message ? (
        <p role="status" className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
