"use client";

import { useId, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { LaunchSummary } from "@/lib/data/types";
import { useData, useTokenBalance } from "@/lib/data/context";
import { formatPercent, formatTokenAmount, formatUsd, parseTokenInput, rawToDecimal } from "@/lib/format";
import { estimateSellUsd, validateRedeemAmount } from "@/lib/estimates";
import { previewRedeem } from "@/lib/metrics";
import { AmountField } from "@/components/ui/AmountField";
import { useActionGate } from "./useActionGate";

/** DAMM v2 pool fee used for the "sell at market instead" comparison. */
const MARKET_FEE_BPS = 100;

export function RedeemPanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions } = useData();
  const balance = useTokenBalance(launch.mint);
  const gate = useActionGate();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ pending: boolean; message: string | null }>({
    pending: false,
    message: null,
  });

  const quote = launch.quote.asset;
  const open = launch.phase === "graduated" && launch.migrationFeeHarvested;
  const amountRaw = input.trim() === "" ? null : parseTokenInput(input, launch.baseDecimals);
  const balanceRaw = wallet.connected ? (balance.data ?? null) : null;
  const inputError = input.trim() === "" ? null : validateRedeemAmount(amountRaw, balanceRaw, launch.supplyRaw);
  const preview = amountRaw !== null && amountRaw > 0n && !inputError ? previewRedeem(launch, amountRaw) : null;
  const zeroPayout = preview !== null && preview.net === 0n;
  const marketUsd =
    amountRaw !== null && amountRaw > 0n
      ? estimateSellUsd(rawToDecimal(amountRaw, launch.baseDecimals).toNumber(), launch.priceUsd, MARKET_FEE_BPS)
      : 0;

  const canSubmit = open && gate.ready && preview !== null && !zeroPayout && !status.pending;

  async function onRedeem() {
    if (!preview || amountRaw === null) return;
    setStatus({ pending: true, message: null });
    const result = await actions.redeem({ launch, amountRaw }, wallet);
    setStatus({ pending: false, message: result.ok ? "Redeemed." : result.error });
  }

  const quoteAmount = (raw: bigint) =>
    `${formatTokenAmount(raw, quote.decimals, { multiplier: launch.quote.multiplier, maxFractionDigits: 8 })} ${quote.symbol}`;

  return (
    <section aria-labelledby={`${id}-heading`} className="card p-5">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
        Redeem at the floor
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        Burn ${launch.symbol} and receive your pro-rata share of the vault in {quote.symbol}. Available to every
        holder at any time; nobody can pause it except the {quote.symbol} issuer.
      </p>

      {!open ? (
        <p className="mt-4 rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
          Redemption opens after migration to DAMM v2 and the migration-fee harvest into the vault.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <AmountField
            id={`${id}-amount`}
            label="Amount to redeem"
            value={input}
            onChange={(v) => {
              setInput(v);
              setStatus({ pending: false, message: null });
            }}
            suffix={`$${launch.symbol}`}
            error={inputError}
            hint={
              wallet.connected && balance.data !== undefined
                ? `Balance: ${formatTokenAmount(balance.data, launch.baseDecimals)} $${launch.symbol}`
                : undefined
            }
            onMax={
              wallet.connected && balance.data !== undefined && balance.data > 0n
                ? () => setInput(rawToDecimal(balance.data, launch.baseDecimals).toFixed())
                : undefined
            }
          />

          <dl className="space-y-2 rounded-lg bg-sunken/70 p-3 text-sm" aria-live="polite">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Share of the vault</dt>
              <dd className="tnum text-right text-ink">{preview ? quoteAmount(preview.gross) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">
                Exit fee {formatPercent(launch.exitFeeBps / 10_000)}{" "}
                <span className="text-ink-3">(stays in the vault)</span>
              </dt>
              <dd className="tnum text-right text-ink">
                {preview ? `−${quoteAmount(preview.fee)}` : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-line pt-2">
              <dt className="font-semibold text-ink">You receive</dt>
              <dd className="text-right">
                <span className="tnum block font-semibold text-floor-strong">
                  {preview ? quoteAmount(preview.net) : "—"}
                </span>
                {preview ? <span className="block text-xs text-ink-3">≈ {formatUsd(preview.netUsd)}</span> : null}
              </dd>
            </div>
            {preview ? (
              <>
                <div className="flex justify-between gap-3 text-xs">
                  <dt className="text-ink-3">Selling at market instead (est.)</dt>
                  <dd className="tnum text-ink-3">≈ {formatUsd(marketUsd)}</dd>
                </div>
                <div className="flex justify-between gap-3 text-xs">
                  <dt className="text-ink-3">Floor for remaining holders</dt>
                  <dd className="tnum text-ink-3">{formatUsd(preview.floorAfterUsd)} (never lower)</dd>
                </div>
              </>
            ) : null}
          </dl>

          {zeroPayout ? (
            <p className="text-sm text-risk">This amount is too small: the payout rounds down to zero.</p>
          ) : null}

          <button type="button" className="btn btn-floor w-full" disabled={!canSubmit} onClick={onRedeem}>
            {status.pending
              ? "Preparing redemption…"
              : preview
                ? `Redeem for ${quoteAmount(preview.net)}`
                : "Redeem"}
          </button>
          {!gate.ready ? <p className="field-hint">{gate.reason}</p> : null}
          {status.message ? (
            <p role="status" className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
              {status.message}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
