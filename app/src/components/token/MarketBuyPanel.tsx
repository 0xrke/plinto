"use client";

import { useEffect, useId, useState } from "react";
import Decimal from "decimal.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { maxLossFraction, uiToRaw } from "@stockfloor/sdk";
import { DEFAULT_SLIPPAGE_BPS } from "@/lib/config";
import type { LaunchSummary, PayToken } from "@/lib/data/types";
import { useData, usePayTokenPrices, useRefreshChainData, useTokenBalance, useTxFlow } from "@/lib/data/context";
import { PAY_TOKEN_DECIMALS, estimateSellUsd, estimateTokensOut, floorValueUsd, parseUiNumber } from "@/lib/estimates";
import { formatMaxLoss, formatNumber, formatTokenAmount, formatUsd, parseTokenInput, rawToDecimal } from "@/lib/format";
import { buyAveragePriceUsd, buyButtonLabel, launchFloorUsd } from "@/lib/metrics";
import { isQuoteError, quoteLaunchTrade } from "@/lib/tradeQuote";
import { AmountField } from "@/components/ui/AmountField";
import { TxProgress } from "@/components/ui/TxProgress";
import { useJupiterRouting } from "./PresaleTradePanel";
import { useActionGate } from "./useActionGate";

/** DAMM v2 pool fee (1%) used for estimates when there is no exact quote. */
const POOL_FEE_BPS = 100;

type Side = "buy" | "sell";

export function MarketBuyPanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions, dataSource } = useData();
  const prices = usePayTokenPrices();
  const gate = useActionGate();
  const routing = useJupiterRouting();
  const refresh = useRefreshChainData();
  const baseBalance = useTokenBalance(launch.mint);
  const quoteBalance = useTokenBalance(launch.quote.asset.mint);
  const [flow, dispatch] = useTxFlow();
  const [side, setSide] = useState<Side>("buy");
  const [token, setToken] = useState<PayToken>(dataSource.kind === "mock" ? "USDC" : "QUOTE");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!routing.available && token !== "QUOTE") setToken("QUOTE");
  }, [routing.available, token]);

  const quote = launch.quote.asset;
  const floorUsd = launchFloorUsd(launch);
  const tokenLabel = (t: PayToken) => (t === "QUOTE" ? quote.symbol : t);
  const amount = parseUiNumber(input);

  let amountRaw: bigint | null = null;
  if (input.trim() !== "" && amount !== null) {
    if (side === "sell") amountRaw = parseTokenInput(input, launch.baseDecimals);
    else if (token === "QUOTE") {
      try {
        amountRaw = uiToRaw(input.trim().replace(/,/g, ""), quote.decimals, launch.quote.multiplier);
      } catch {
        amountRaw = null;
      }
    } else amountRaw = parseTokenInput(input, PAY_TOKEN_DECIMALS[token]);
  }
  let inputError: string | null = null;
  if (input.trim() !== "") {
    if (amount === null || amountRaw === null) inputError = "Enter a valid amount.";
    else if (wallet.connected && side === "sell" && baseBalance.data !== undefined && amountRaw > baseBalance.data) inputError = "Amount exceeds your balance.";
    else if (wallet.connected && side === "buy" && token === "QUOTE" && quoteBalance.data !== undefined && amountRaw > quoteBalance.data)
      inputError = `Amount exceeds your ${quote.symbol} balance.`;
  }

  const exact = token === "QUOTE" ? quoteLaunchTrade(launch, side, inputError ? null : amountRaw, DEFAULT_SLIPPAGE_BPS) : null;
  const exactQuote = exact && !isQuoteError(exact) ? exact : null;
  const quoteError = isQuoteError(exact) ? exact.error : null;
  // With an exact quote, price and max loss use this buy's average price (pool fee and its own price
  // impact included), which in a thin pool is well above the spot price.
  const avgPriceUsd = side === "buy" && exactQuote ? buyAveragePriceUsd(launch, exactQuote.amountIn, exactQuote.amountOut) : null;
  const buyPriceUsd = avgPriceUsd ?? launch.priceUsd;
  const maxLoss = maxLossFraction(buyPriceUsd, floorUsd);

  let payUsd = 0;
  if (side === "buy" && amount !== null) {
    if (token === "QUOTE") payUsd = amount * launch.quote.priceUsd;
    else if (prices.data) payUsd = amount * prices.data[token];
  }
  const tokensOutEst = side === "buy" ? estimateTokensOut(payUsd, launch.priceUsd, POOL_FEE_BPS) : 0;
  const tokensOut = exactQuote && side === "buy" ? rawToDecimal(exactQuote.amountOut, launch.baseDecimals).toNumber() : tokensOutEst;
  const atFloorUsd = floorValueUsd(tokensOut, floorUsd, launch.exitFeeBps);
  const sellUsdEst = side === "sell" && amount !== null ? estimateSellUsd(amount, launch.priceUsd, POOL_FEE_BPS) : 0;

  const canSubmit = gate.ready && !launch.quotePaused && amountRaw !== null && amountRaw > 0n && !inputError && !quoteError && !pending;

  async function onSubmit() {
    if (amountRaw === null) return;
    setPending(true);
    setMessage(null);
    dispatch({ type: "reset" });
    const result = await actions.trade(
      {
        launch,
        side,
        payToken: token,
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

  const quoteAmount = (raw: bigint) => `${formatTokenAmount(raw, quote.decimals, { multiplier: launch.quote.multiplier, maxFractionDigits: 8 })} ${quote.symbol}`;
  const baseAmount = (raw: bigint) => `${formatTokenAmount(raw, launch.baseDecimals)} $${launch.symbol}`;

  const venueText =
    token === "QUOTE"
      ? `Trades ${quote.symbol} directly against the Meteora DAMM v2 pool.`
      : `Routed through Jupiter to the Meteora DAMM v2 pool.`;

  return (
    <section aria-labelledby={`${id}-heading`} className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
          {side === "buy" ? "Buy on the market" : "Sell on the market"}
        </h2>
        <div role="group" aria-label="Trade side" className="flex rounded-lg border border-line p-0.5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => switchSide(s)}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${side === s ? "bg-brand text-white" : "text-ink-2 hover:text-ink"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-2">{venueText}</p>

      <div className="mt-4 space-y-4">
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
                value={token}
                onChange={(e) => {
                  setToken(e.target.value as PayToken);
                  setInput("");
                }}
                className="rounded-md border border-line bg-sunken px-2 py-1 text-sm font-semibold text-ink"
              >
                {(["QUOTE", "USDC", "SOL"] as const).map((t) => (
                  <option key={t} value={t} disabled={t !== "QUOTE" && !routing.available}>
                    {tokenLabel(t)}
                  </option>
                ))}
              </select>
            ) : (
              `$${launch.symbol}`
            )
          }
          hint={
            side === "buy"
              ? token === "QUOTE" && wallet.connected && quoteBalance.data !== undefined
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
              : token === "QUOTE" && wallet.connected && quoteBalance.data !== undefined && quoteBalance.data > 0n
                ? () =>
                    setInput(
                      rawToDecimal(quoteBalance.data, quote.decimals, launch.quote.multiplier)
                        .toDecimalPlaces(quote.decimals, Decimal.ROUND_DOWN)
                        .toFixed(),
                    )
                : undefined
          }
        />

        {side === "sell" ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor={`${id}-receive`} className="text-ink-2">
              Receive
            </label>
            <select
              id={`${id}-receive`}
              value={token}
              onChange={(e) => setToken(e.target.value as PayToken)}
              className="rounded-md border border-line bg-sunken px-2 py-1 text-sm font-semibold text-ink"
            >
              {(["QUOTE", "USDC", "SOL"] as const).map((t) => (
                <option key={t} value={t} disabled={t !== "QUOTE" && !routing.available}>
                  {tokenLabel(t)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!routing.available ? (
          <p className="field-hint">
            USDC and SOL route through Jupiter, which works on mainnet only.
            {routing.localFork ? ` On this local fork, trade with ${quote.symbol} directly.` : ""}
          </p>
        ) : null}

        {launch.quotePaused ? (
          <p className="rounded-lg bg-risk-soft px-3 py-2 text-sm text-risk">
            {quote.symbol} is paused by its issuer. Pool trades resume when it is unpaused.
          </p>
        ) : null}

        <dl className="space-y-2 rounded-lg bg-sunken/70 p-3 text-sm" aria-live="polite">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{exactQuote ? "You receive" : "You receive (est.)"}</dt>
            <dd className="tnum text-right font-semibold text-ink">
              {side === "buy"
                ? exactQuote
                  ? baseAmount(exactQuote.amountOut)
                  : tokensOut > 0
                    ? `≈ ${formatNumber(tokensOut)} $${launch.symbol}`
                    : "—"
                : exactQuote
                  ? quoteAmount(exactQuote.amountOut)
                  : sellUsdEst > 0
                    ? `≈ ${formatUsd(sellUsdEst)} in ${tokenLabel(token)}`
                    : "—"}
            </dd>
          </div>
          {exactQuote ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Minimum after 1% slippage</dt>
              <dd className="tnum text-right text-ink">{side === "buy" ? baseAmount(exactQuote.minOut) : quoteAmount(exactQuote.minOut)}</dd>
            </div>
          ) : null}
          {side === "buy" ? (
            <>
              {avgPriceUsd !== null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Average price for this buy</dt>
                  <dd className="tnum text-ink">{formatUsd(avgPriceUsd)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Worth at the floor</dt>
                <dd className="tnum text-floor-strong">{tokensOut > 0 ? `≈ ${formatUsd(atFloorUsd)}` : "—"}</dd>
              </div>
              {/*
                The button below must keep the mandated "… Max loss if you buy now: −Z%" sentence, and
                the "Price and floor" card states the same measure at the spot price. This row is the
                one that moves with the amount typed, so it says so.
              */}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">Max loss for this buy</dt>
                <dd className="tnum font-semibold text-risk">{formatMaxLoss(maxLoss)}</dd>
              </div>
            </>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Floor (redeem instead)</dt>
              <dd className="tnum text-floor-strong">{formatUsd(floorUsd)} per token</dd>
            </div>
          )}
        </dl>

        {side === "buy" ? (
          <button
            type="button"
            className="btn btn-primary h-auto w-full py-3 text-left leading-snug whitespace-normal"
            disabled={!canSubmit}
            aria-busy={pending}
            onClick={onSubmit}
          >
            {buyButtonLabel(buyPriceUsd, floorUsd)}
          </button>
        ) : (
          <button type="button" className="btn btn-primary w-full" disabled={!canSubmit} aria-busy={pending} onClick={onSubmit}>
            {pending ? "Sending…" : `Sell $${launch.symbol}`}
          </button>
        )}
        {!gate.ready ? <p className="field-hint">{gate.reason}</p> : null}
        {side === "buy" ? (
          <p className="field-hint">
            {exactQuote
              ? "Exact DAMM v2 quote at the latest on-chain state; price and max loss are this buy's average price, pool fee and price impact included"
              : "Estimate at the spot price, before price impact, slippage and route fees"}{" "}
            (max slippage 1%). If
            the price falls to the floor, redeeming these tokens returns about{" "}
            {tokensOut > 0 ? formatUsd(atFloorUsd) : "the floor value"} after the exit fee.
          </p>
        ) : null}
        <TxProgress flow={flow} />
        {flow.status === "idle" && message ? (
          <p role="status" className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
