"use client";

import { useId, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { maxLossFraction } from "@stockfloor/sdk";
import type { LaunchSummary } from "@/lib/data/types";
import { useData, usePayTokenPrices } from "@/lib/data/context";
import { PAY_TOKEN_DECIMALS, estimateTokensOut, floorValueUsd, parseUiNumber } from "@/lib/estimates";
import { formatMaxLoss, formatNumber, formatUsd, parseTokenInput } from "@/lib/format";
import { buyButtonLabel, launchFloorUsd } from "@/lib/metrics";
import { AmountField } from "@/components/ui/AmountField";
import { useActionGate } from "./useActionGate";

/** DAMM v2 pool fee (1%) used for the estimate. */
const POOL_FEE_BPS = 100;
const SLIPPAGE_BPS = 100;

type Pay = "USDC" | "SOL";

export function MarketBuyPanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions } = useData();
  const prices = usePayTokenPrices();
  const gate = useActionGate();
  const [pay, setPay] = useState<Pay>("USDC");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ pending: boolean; message: string | null }>({
    pending: false,
    message: null,
  });

  const floorUsd = launchFloorUsd(launch);
  const maxLoss = maxLossFraction(launch.priceUsd, floorUsd);
  const amount = parseUiNumber(input);
  const amountRaw = input.trim() === "" ? null : parseTokenInput(input, PAY_TOKEN_DECIMALS[pay]);
  const inputError = input.trim() !== "" && (amount === null || amountRaw === null) ? "Enter a valid amount." : null;
  const payUsd = amount !== null && prices.data ? amount * prices.data[pay] : 0;
  const tokensOut = estimateTokensOut(payUsd, launch.priceUsd, POOL_FEE_BPS);
  const atFloorUsd = floorValueUsd(tokensOut, floorUsd, launch.exitFeeBps);
  const canSubmit = gate.ready && amountRaw !== null && amountRaw > 0n && !status.pending;

  async function onBuy() {
    if (amountRaw === null) return;
    setStatus({ pending: true, message: null });
    const result = await actions.trade(
      { launch, side: "buy", payToken: pay, amountRaw, slippageBps: SLIPPAGE_BPS },
      wallet,
    );
    setStatus({ pending: false, message: result.ok ? "Swap submitted." : result.error });
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="card p-5">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
        Buy on the market
      </h2>
      <p className="mt-1 text-sm text-ink-2">Routed through Jupiter to the Meteora DAMM v2 pool.</p>

      <div className="mt-4 space-y-4">
        <AmountField
          id={`${id}-amount`}
          label="You pay"
          value={input}
          onChange={(v) => {
            setInput(v);
            setStatus({ pending: false, message: null });
          }}
          error={inputError}
          suffix={
            <select
              aria-label="Pay with"
              value={pay}
              onChange={(e) => setPay(e.target.value as Pay)}
              className="rounded-md border border-line bg-sunken px-2 py-1 text-sm font-semibold text-ink"
            >
              <option value="USDC">USDC</option>
              <option value="SOL">SOL</option>
            </select>
          }
          hint={payUsd > 0 ? `≈ ${formatUsd(payUsd)}` : undefined}
        />

        <dl className="space-y-2 rounded-lg bg-sunken/70 p-3 text-sm" aria-live="polite">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">You receive (est.)</dt>
            <dd className="tnum font-semibold text-ink">
              {tokensOut > 0
                ? `${formatNumber(tokensOut)} $${launch.symbol}`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">Worth at the floor</dt>
            <dd className="tnum text-floor-strong">{tokensOut > 0 ? `≈ ${formatUsd(atFloorUsd)}` : "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">Max loss if you buy now</dt>
            <dd className="tnum font-semibold text-risk">{formatMaxLoss(maxLoss)}</dd>
          </div>
        </dl>

        <button
          type="button"
          className="btn btn-primary h-auto w-full py-3 text-left leading-snug whitespace-normal"
          disabled={!canSubmit}
          onClick={onBuy}
        >
          {status.pending ? "Preparing swap…" : buyButtonLabel(launch.priceUsd, floorUsd)}
        </button>
        {!gate.ready ? <p className="field-hint">{gate.reason}</p> : null}
        <p className="field-hint">
          Estimate before slippage (max 1%) and route fees. If the price falls to the floor, redeeming these tokens
          returns about {tokensOut > 0 ? formatUsd(atFloorUsd) : "the floor value"} after the exit fee.
        </p>
        {status.message ? (
          <p role="status" className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
            {status.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
