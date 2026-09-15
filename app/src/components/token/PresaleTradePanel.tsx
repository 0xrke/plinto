"use client";

import { useId, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { uiToRaw } from "@stockfloor/sdk";
import { CURVE_TRADING_FEE_BPS } from "@/lib/config";
import type { LaunchSummary, PayToken } from "@/lib/data/types";
import { useData, usePayTokenPrices, useTokenBalance } from "@/lib/data/context";
import {
  PAY_TOKEN_DECIMALS,
  estimateSellUsd,
  estimateTokensOut,
  parseUiNumber,
} from "@/lib/estimates";
import { formatNumber, formatTokenAmount, formatUsd, parseTokenInput, rawToDecimal } from "@/lib/format";
import { projectedFloorUsd } from "@/lib/metrics";
import { AmountField } from "@/components/ui/AmountField";
import { useActionGate } from "./useActionGate";

const SLIPPAGE_BPS = 100;

type Side = "buy" | "sell";

export function PresaleTradePanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions } = useData();
  const prices = usePayTokenPrices();
  const balance = useTokenBalance(launch.mint);
  const gate = useActionGate();
  const [side, setSide] = useState<Side>("buy");
  const [pay, setPay] = useState<PayToken>("USDC");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ pending: boolean; message: string | null }>({
    pending: false,
    message: null,
  });

  const quote = launch.quote.asset;
  const curveOpen = launch.phase === "presale";
  const payLabel = (p: PayToken) => (p === "QUOTE" ? quote.symbol : p);
  const estFloor = projectedFloorUsd(launch);

  const amount = parseUiNumber(input);
  let amountRaw: bigint | null = null;
  if (input.trim() !== "" && amount !== null) {
    if (side === "sell") amountRaw = parseTokenInput(input, launch.baseDecimals);
    else if (pay === "QUOTE") {
      try {
        amountRaw = uiToRaw(input.trim().replace(/,/g, ""), quote.decimals, launch.quote.multiplier);
      } catch {
        amountRaw = null;
      }
    }
    else amountRaw = parseTokenInput(input, PAY_TOKEN_DECIMALS[pay]);
  }
  const balanceRaw = wallet.connected ? (balance.data ?? null) : null;
  let inputError: string | null = null;
  if (input.trim() !== "") {
    if (amount === null || amountRaw === null) inputError = "Enter a valid amount.";
    else if (side === "sell" && balanceRaw !== null && amountRaw > balanceRaw) inputError = "Amount exceeds your balance.";
  }

  let payUsd = 0;
  if (side === "buy" && amount !== null) {
    if (pay === "QUOTE") payUsd = amount * launch.quote.priceUsd;
    else if (prices.data) payUsd = amount * prices.data[pay];
  }
  const tokensOut = side === "buy" ? estimateTokensOut(payUsd, launch.priceUsd, CURVE_TRADING_FEE_BPS) : 0;
  const sellUsd = side === "sell" && amount !== null ? estimateSellUsd(amount, launch.priceUsd, CURVE_TRADING_FEE_BPS) : 0;
  const sellQuoteUi = launch.quote.priceUsd > 0 ? sellUsd / launch.quote.priceUsd : 0;

  const canSubmit =
    curveOpen && gate.ready && amountRaw !== null && amountRaw > 0n && !inputError && !status.pending;

  async function onSubmit() {
    if (amountRaw === null) return;
    setStatus({ pending: true, message: null });
    const result = await actions.trade(
      { launch, side, payToken: side === "sell" ? "QUOTE" : pay, amountRaw, slippageBps: SLIPPAGE_BPS },
      wallet,
    );
    setStatus({ pending: false, message: result.ok ? "Transaction submitted." : result.error });
  }

  function switchSide(next: Side) {
    setSide(next);
    setInput("");
    setStatus({ pending: false, message: null });
  }

  const route =
    side === "sell"
      ? `$${launch.symbol} → ${quote.symbol} on the bonding curve. One transaction.`
      : pay === "QUOTE"
        ? `${quote.symbol} → $${launch.symbol} on the bonding curve. One transaction.`
        : `${pay} → ${quote.symbol} via Jupiter, then ${quote.symbol} → $${launch.symbol} on the bonding curve. Two transactions.`;

  return (
    <section aria-labelledby={`${id}-heading`} className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
          Trade on the curve
        </h2>
        <div role="tablist" aria-label="Trade side" className="flex rounded-lg border border-line p-0.5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              onClick={() => switchSide(s)}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${
                side === s ? "bg-brand text-white" : "text-ink-2 hover:text-ink"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {!curveOpen ? (
        <p className="mt-4 rounded-lg bg-graduating-soft px-3 py-2 text-sm text-graduating">
          The curve is complete. Trading resumes on DAMM v2 once the pool migrates, and redemption opens after the
          vault harvest.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg bg-presale-soft px-3 py-2 text-sm text-presale">
            No floor during the presale. The floor is funded at graduation
            {estFloor !== null ? ` (estimated ${formatUsd(estFloor)} per token)` : ""}. Until then you can sell back to
            the curve.
          </p>

          {side === "buy" ? (
            <AmountField
              id={`${id}-buy`}
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
                  onChange={(e) => {
                    setPay(e.target.value as PayToken);
                    setInput("");
                  }}
                  className="rounded-md border border-line bg-sunken px-2 py-1 text-sm font-semibold text-ink"
                >
                  {(["USDC", "SOL", "QUOTE"] as const).map((p) => (
                    <option key={p} value={p}>
                      {payLabel(p)}
                    </option>
                  ))}
                </select>
              }
              hint={payUsd > 0 ? `≈ ${formatUsd(payUsd)}` : undefined}
            />
          ) : (
            <AmountField
              id={`${id}-sell`}
              label="You sell"
              value={input}
              onChange={(v) => {
                setInput(v);
                setStatus({ pending: false, message: null });
              }}
              error={inputError}
              suffix={`$${launch.symbol}`}
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
          )}

          <dl className="space-y-2 rounded-lg bg-sunken/70 p-3 text-sm" aria-live="polite">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">You receive (est.)</dt>
              <dd className="tnum text-right font-semibold text-ink">
                {side === "buy"
                  ? tokensOut > 0
                    ? `${formatNumber(tokensOut)} $${launch.symbol}`
                    : "—"
                  : sellUsd > 0
                    ? `${formatNumber(sellQuoteUi, 6)} ${quote.symbol} (≈ ${formatUsd(sellUsd)})`
                    : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Curve price</dt>
              <dd className="tnum text-ink">{formatUsd(launch.priceUsd)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Curve fee</dt>
              <dd className="tnum text-ink">1%</dd>
            </div>
          </dl>

          <p className="field-hint">Route: {route}</p>

          <button type="button" className="btn btn-primary w-full" disabled={!canSubmit} onClick={onSubmit}>
            {status.pending
              ? "Preparing transaction…"
              : side === "buy"
                ? `Buy $${launch.symbol} on the curve`
                : `Sell $${launch.symbol} to the curve`}
          </button>
          {!gate.ready ? <p className="field-hint">{gate.reason}</p> : null}
          <p className="field-hint">
            Estimates use the current curve price; the price rises as the curve fills. Max slippage 1%.
          </p>
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
