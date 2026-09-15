"use client";

import { useEffect, useId, useState } from "react";
import Decimal from "decimal.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { maxLossFraction, uiToRaw } from "@stockfloor/sdk";
import { CURVE_TRADING_FEE_BPS, DEFAULT_SLIPPAGE_BPS } from "@/lib/config";
import type { LaunchSummary, PayToken } from "@/lib/data/types";
import { useCluster, useData, usePayTokenPrices, useRefreshChainData, useTokenBalance, useTxFlow } from "@/lib/data/context";
import { PAY_TOKEN_DECIMALS, estimateSellUsd, estimateTokensOut, parseUiNumber } from "@/lib/estimates";
import { formatMaxLoss, formatNumber, formatTokenAmount, formatUsd, parseTokenInput, rawToDecimal } from "@/lib/format";
import { buyAveragePriceUsd, presaleBuyButtonLabel, projectedFloorUsd } from "@/lib/metrics";
import { isQuoteError, quoteLaunchTrade } from "@/lib/tradeQuote";
import { AmountField } from "@/components/ui/AmountField";
import { TxProgress } from "@/components/ui/TxProgress";
import { useActionGate } from "./useActionGate";

type Side = "buy" | "sell";

/**
 * Whether USDC / SOL can be routed through Jupiter: mainnet only. Mock data keeps every option so the
 * design can be reviewed; on chain data the cluster probe decides.
 */
export function useJupiterRouting(): { available: boolean; localFork: boolean } {
  const { dataSource } = useData();
  const cluster = useCluster();
  if (dataSource.kind === "mock") return { available: true, localFork: false };
  return { available: cluster.data?.jupiterRouting === true, localFork: cluster.data?.kind === "local-fork" };
}

export function PresaleTradePanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions, dataSource } = useData();
  const prices = usePayTokenPrices();
  const baseBalance = useTokenBalance(launch.mint);
  const quoteBalance = useTokenBalance(launch.quote.asset.mint);
  const gate = useActionGate();
  const routing = useJupiterRouting();
  const refresh = useRefreshChainData();
  const [flow, dispatch] = useTxFlow();
  const [side, setSide] = useState<Side>("buy");
  const [pay, setPay] = useState<PayToken>(dataSource.kind === "mock" ? "USDC" : "QUOTE");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Jupiter routing is mainnet-only: fall back to the quote asset when it is unavailable.
  useEffect(() => {
    if (!routing.available && pay !== "QUOTE") setPay("QUOTE");
  }, [routing.available, pay]);

  const quote = launch.quote.asset;
  const curveOpen = launch.phase === "presale" && !launch.quotePaused;
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
    } else amountRaw = parseTokenInput(input, PAY_TOKEN_DECIMALS[pay]);
  }
  const baseBalanceRaw = wallet.connected ? (baseBalance.data ?? null) : null;
  const quoteBalanceRaw = wallet.connected ? (quoteBalance.data ?? null) : null;
  let inputError: string | null = null;
  if (input.trim() !== "") {
    if (amount === null || amountRaw === null) inputError = "Enter a valid amount.";
    else if (side === "sell" && baseBalanceRaw !== null && amountRaw > baseBalanceRaw) inputError = "Amount exceeds your balance.";
    else if (side === "buy" && pay === "QUOTE" && quoteBalanceRaw !== null && amountRaw > quoteBalanceRaw)
      inputError = `Amount exceeds your ${quote.symbol} balance.`;
  }

  // Exact quote from the chain state for direct trades; price-based estimate otherwise.
  const exact = side === "sell" || pay === "QUOTE" ? quoteLaunchTrade(launch, side, inputError ? null : amountRaw, DEFAULT_SLIPPAGE_BPS) : null;
  const exactQuote = exact && !isQuoteError(exact) ? exact : null;
  const quoteError = isQuoteError(exact) ? exact.error : null;

  let payUsd = 0;
  if (side === "buy" && amount !== null) {
    if (pay === "QUOTE") payUsd = amount * launch.quote.priceUsd;
    else if (prices.data) payUsd = amount * prices.data[pay];
  }
  const tokensOut = side === "buy" ? estimateTokensOut(payUsd, launch.priceUsd, CURVE_TRADING_FEE_BPS) : 0;
  const sellUsd = side === "sell" && amount !== null ? estimateSellUsd(amount, launch.priceUsd, CURVE_TRADING_FEE_BPS) : 0;
  const sellQuoteUi = launch.quote.priceUsd > 0 ? sellUsd / launch.quote.priceUsd : 0;

  // Presale buys have no floor yet: the label bounds the loss against the estimated floor at graduation,
  // at this buy's average price when an exact curve quote exists.
  const avgPriceUsd = side === "buy" && exactQuote ? buyAveragePriceUsd(launch, exactQuote.amountIn, exactQuote.amountOut) : null;
  const buyPriceUsd = avgPriceUsd ?? launch.priceUsd;
  const estMaxLoss = estFloor !== null && estFloor > 0 ? maxLossFraction(buyPriceUsd, estFloor) : null;

  const canSubmit = curveOpen && gate.ready && amountRaw !== null && amountRaw > 0n && !inputError && !quoteError && !pending;

  async function onSubmit() {
    if (amountRaw === null) return;
    setPending(true);
    setMessage(null);
    dispatch({ type: "reset" });
    const result = await actions.trade(
      // Sells on the curve pay out the quote asset.
      {
        launch,
        side,
        payToken: side === "sell" ? "QUOTE" : pay,
        amountRaw,
        slippageBps: DEFAULT_SLIPPAGE_BPS,
        // The action never signs a lower minimum than the one shown here.
        expected: exactQuote ? { venue: exactQuote.venue, minOut: exactQuote.minOut } : undefined,
      },
      wallet,
      { dispatch },
    );
    setPending(false);
    if (result.ok) {
      setInput("");
      refresh();
    } else setMessage(result.error);
  }

  function switchSide(next: Side) {
    setSide(next);
    setInput("");
    setMessage(null);
    dispatch({ type: "reset" });
  }

  const route =
    side === "sell"
      ? `$${launch.symbol} → ${quote.symbol} on the bonding curve. One transaction.`
      : pay === "QUOTE"
        ? `${quote.symbol} → $${launch.symbol} on the bonding curve. One transaction.`
        : `${pay} → ${quote.symbol} via Jupiter, then ${quote.symbol} → $${launch.symbol} on the bonding curve. Two transactions.`;

  const quoteAmount = (raw: bigint) => `${formatTokenAmount(raw, quote.decimals, { multiplier: launch.quote.multiplier, maxFractionDigits: 8 })} ${quote.symbol}`;
  const baseAmount = (raw: bigint) => `${formatTokenAmount(raw, launch.baseDecimals)} $${launch.symbol}`;

  let receiveText = "—";
  let minText: string | null = null;
  if (exactQuote) {
    receiveText = side === "buy" ? baseAmount(exactQuote.amountOut) : quoteAmount(exactQuote.amountOut);
    minText = side === "buy" ? baseAmount(exactQuote.minOut) : quoteAmount(exactQuote.minOut);
  } else if (side === "buy" && tokensOut > 0) receiveText = `≈ ${formatNumber(tokensOut)} $${launch.symbol}`;
  else if (side === "sell" && sellUsd > 0) receiveText = `≈ ${formatNumber(sellQuoteUi, 6)} ${quote.symbol} (≈ ${formatUsd(sellUsd)})`;

  const payOptions: PayToken[] = ["QUOTE", "USDC", "SOL"];

  return (
    <section aria-labelledby={`${id}-heading`} className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
          Trade on the curve
        </h2>
        <div role="group" aria-label="Trade side" className="flex rounded-lg border border-line p-0.5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
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

      {launch.quotePaused ? (
        <p className="mt-4 rounded-lg bg-risk-soft px-3 py-2 text-sm text-risk">
          {quote.symbol} is paused by its issuer. Trading on the curve resumes when it is unpaused.
        </p>
      ) : launch.phase !== "presale" ? (
        <p className="mt-4 rounded-lg bg-graduating-soft px-3 py-2 text-sm text-graduating">
          The curve is complete. Trading resumes on DAMM v2 once the pool migrates, and redemption opens after the
          vault harvest. Anyone can run the crank below to move it forward.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg bg-presale-soft px-3 py-2 text-sm text-presale">
            No floor during the presale. The floor is funded at graduation
            {estFloor !== null ? ` (estimated ${formatUsd(estFloor)} per token)` : ""}. Until then you can sell back to
            the curve.
          </p>

          <AmountField
            id={`${id}-${side}`}
            label={side === "buy" ? "You pay" : "You sell"}
            value={input}
            onChange={(v) => {
              setInput(v);
              setMessage(null);
            }}
            error={inputError ?? quoteError}
            suffix={
              side === "buy" ? (
                <select
                  aria-label="Pay with"
                  value={pay}
                  onChange={(e) => {
                    setPay(e.target.value as PayToken);
                    setInput("");
                  }}
                  className="rounded-md border border-line bg-sunken px-2 py-1 text-sm font-semibold text-ink"
                >
                  {payOptions.map((p) => (
                    <option key={p} value={p} disabled={p !== "QUOTE" && !routing.available}>
                      {payLabel(p)}
                    </option>
                  ))}
                </select>
              ) : (
                `$${launch.symbol}`
              )
            }
            hint={
              side === "buy"
                ? pay === "QUOTE" && wallet.connected && quoteBalance.data !== undefined
                  ? `Balance: ${quoteAmount(quoteBalance.data)}${payUsd > 0 ? ` · ≈ ${formatUsd(payUsd)}` : ""}`
                  : payUsd > 0
                    ? `≈ ${formatUsd(payUsd)}`
                    : undefined
                : wallet.connected && baseBalance.data !== undefined
                  ? `Balance: ${baseAmount(baseBalance.data)}`
                  : undefined
            }
            onMax={
              side === "sell"
                ? wallet.connected && baseBalance.data !== undefined && baseBalance.data > 0n
                  ? () => setInput(rawToDecimal(baseBalance.data, launch.baseDecimals).toFixed())
                  : undefined
                : pay === "QUOTE" && wallet.connected && quoteBalance.data !== undefined && quoteBalance.data > 0n
                  ? () =>
                      setInput(
                        rawToDecimal(quoteBalance.data, quote.decimals, launch.quote.multiplier)
                          .toDecimalPlaces(quote.decimals, Decimal.ROUND_DOWN)
                          .toFixed(),
                      )
                  : undefined
            }
          />

          {!routing.available && side === "buy" ? (
            <p className="field-hint">
              Paying with USDC or SOL routes through Jupiter, which works on mainnet only.
              {routing.localFork ? ` On this local fork, pay with ${quote.symbol} directly (the faucet in the header has some).` : ""}
            </p>
          ) : null}

          <dl className="space-y-2 rounded-lg bg-sunken/70 p-3 text-sm" aria-live="polite">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">{exactQuote ? "You receive" : "You receive (est.)"}</dt>
              <dd className="tnum text-right font-semibold text-ink">{receiveText}</dd>
            </div>
            {minText ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Minimum after 1% slippage</dt>
                <dd className="tnum text-right text-ink">{minText}</dd>
              </div>
            ) : null}
            {exactQuote?.partialFill ? (
              <p className="text-xs text-graduating">
                This buy completes the curve: it uses {quoteAmount(exactQuote.amountIn)} and the rest stays in your wallet.
              </p>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Curve price</dt>
              <dd className="tnum text-ink">{formatUsd(launch.priceUsd)}</dd>
            </div>
            {side === "buy" && avgPriceUsd !== null ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Average price for this buy</dt>
                <dd className="tnum text-ink">{formatUsd(avgPriceUsd)}</dd>
              </div>
            ) : null}
            {side === "buy" ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Max loss if it graduates (est.)</dt>
                <dd className="tnum font-semibold text-risk">{estMaxLoss !== null ? formatMaxLoss(estMaxLoss) : "—"}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Curve fee</dt>
              <dd className="tnum text-ink">1%</dd>
            </div>
          </dl>

          <p className="field-hint">Route: {route}</p>

          {side === "buy" ? (
            <button
              type="button"
              className="btn btn-primary h-auto w-full py-3 text-left leading-snug whitespace-normal"
              disabled={!canSubmit}
              onClick={onSubmit}
              aria-busy={pending}
            >
              {presaleBuyButtonLabel(buyPriceUsd, estFloor)}
            </button>
          ) : (
            <button type="button" className="btn btn-primary w-full" disabled={!canSubmit} onClick={onSubmit} aria-busy={pending}>
              {pending ? "Sending…" : `Sell $${launch.symbol} to the curve`}
            </button>
          )}
          {side === "buy" ? (
            <p className="field-hint">
              There is no floor until graduation. If the curve never completes, the only exit is selling back to the
              curve at its price, so the loss is not bounded by a floor.
            </p>
          ) : null}
          {!gate.ready ? <p className="field-hint">{gate.reason}</p> : null}
          <p className="field-hint">
            {exactQuote
              ? "Quoted with the exact curve math at the latest on-chain state. You never receive less than the minimum shown: if the price moved past it before you sign, nothing is sent and you review the new quote."
              : "Estimates use the current curve price; the price rises as the curve fills. Max slippage 1%."}
          </p>
          <TxProgress flow={flow} />
          {flow.status === "idle" && message ? (
            <p role="status" className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
              {message}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
