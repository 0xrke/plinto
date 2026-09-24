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
import { BaseChip, BuyButtonLabel, DetailRow, FinePrint, ReceiveTile, RiskRow, SwapArrow, TokenPicker } from "./TradeBits";
import { TxProgress } from "@/components/ui/TxProgress";
import { useJupiterRouting } from "./PresaleTradePanel";
import { useActionGate } from "./useActionGate";

/** DAMM v2 pool fee (1%) used for estimates when there is no exact quote. */
const POOL_FEE_BPS = 100;

type Side = "buy" | "sell";

export function MarketBuyPanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions } = useData();
  const prices = usePayTokenPrices();
  const gate = useActionGate();
  const routing = useJupiterRouting();
  const refresh = useRefreshChainData();
  const baseBalance = useTokenBalance(launch.mint);
  const quoteBalance = useTokenBalance(launch.quote.asset.mint);
  const [flow, dispatch] = useTxFlow();
  const [side, setSide] = useState<Side>("buy");
  const [token, setToken] = useState<PayToken>("QUOTE");
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

  const receiveText =
    side === "buy"
      ? exactQuote
        ? baseAmount(exactQuote.amountOut)
        : tokensOut > 0
          ? `≈ ${formatNumber(tokensOut)} $${launch.symbol}`
          : `0 $${launch.symbol}`
      : exactQuote
        ? quoteAmount(exactQuote.amountOut)
        : sellUsdEst > 0
          ? `≈ ${formatUsd(sellUsdEst)} in ${tokenLabel(token)}`
          : `0 ${quote.symbol}`;

  return (
    <section aria-labelledby={`${id}-heading`} className="rail-section">
      <h2 id={`${id}-heading`} className="heading text-[21px] text-ink lg:text-[22px]">
        {side === "buy" ? "Buy on the market" : "Sell on the market"}
      </h2>
      <div role="group" aria-label="Trade side" className="segmented mt-4">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={side === s} onClick={() => switchSide(s)} className="capitalize">
            {s}
          </button>
        ))}
      </div>

      <div className="mt-3.5">
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
              <TokenPicker
                ariaLabel="Pay with"
                value={token}
                onChange={(t) => {
                  setToken(t);
                  setInput("");
                }}
                quoteSymbol={quote.symbol}
                routingAvailable={routing.available}
              />
            ) : (
              <BaseChip symbol={launch.symbol} />
            )
          }
          hint={
            side === "buy"
              ? token === "QUOTE" && wallet.connected && quoteBalance.data !== undefined
                ? `Balance: ${quoteAmount(quoteBalance.data)}${payUsd > 0 ? ` · ≈ ${formatUsd(payUsd)}` : ""}`
                : `≈ ${formatUsd(payUsd)}`
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
        <SwapArrow />
        <ReceiveTile
          label={exactQuote ? "You receive" : "You receive (est.)"}
          text={receiveText}
          unit={side === "buy" ? `$${launch.symbol}` : quote.symbol}
          action={
            side === "sell" ? (
              <TokenPicker
                id={`${id}-receive`}
                ariaLabel="Receive"
                value={token}
                onChange={setToken}
                quoteSymbol={quote.symbol}
                routingAvailable={routing.available}
              />
            ) : undefined
          }
        />
      </div>

      {!routing.available ? (
        <p className="field-hint mt-3">
          USDC and SOL route through Jupiter, which works on mainnet only.
          {routing.localFork ? ` On this local fork, trade with ${quote.symbol} directly.` : ""}
        </p>
      ) : null}

      {launch.quotePaused ? (
        <p className="tile-risk mt-3 px-3.5 py-2.5 text-sm text-risk">
          {quote.symbol} is paused by its issuer. Pool trades resume when it is unpaused.
        </p>
      ) : null}

      <dl className="mt-4 flex flex-col gap-2.5 text-[13.5px]" aria-live="polite">
        {side === "buy" ? (
          <>
            <DetailRow label="Minimum after 1% slippage">{exactQuote ? baseAmount(exactQuote.minOut) : "—"}</DetailRow>
            <DetailRow label="Average price for this buy">{avgPriceUsd !== null ? formatUsd(avgPriceUsd) : "—"}</DetailRow>
            <DetailRow label="Worth at the floor" valueClassName="!text-floor">
              {tokensOut > 0 ? `≈ ${formatUsd(atFloorUsd)}` : "—"}
            </DetailRow>
            {/*
              The button below must keep the mandated "… Max loss if you buy now: −Z%" sentence, and
              the "Price and floor" card states the same measure at the spot price. This row is the
              one that moves with the amount typed, so it says so.
            */}
            <RiskRow label="Max loss for this buy">{formatMaxLoss(maxLoss)}</RiskRow>
          </>
        ) : (
          <>
            {exactQuote ? <DetailRow label="Minimum after 1% slippage">{quoteAmount(exactQuote.minOut)}</DetailRow> : null}
            <DetailRow label="Floor (redeem instead)" valueClassName="!text-floor">
              {formatUsd(floorUsd)} per token
            </DetailRow>
          </>
        )}
      </dl>

      {side === "buy" ? (
        <button
          type="button"
          className="btn btn-primary btn-lg mt-4 h-auto min-h-[58px] w-full whitespace-normal py-2.5 text-center disabled:opacity-90 disabled:shadow-none"
          disabled={!canSubmit}
          aria-busy={pending}
          onClick={onSubmit}
        >
          <BuyButtonLabel label={buyButtonLabel(buyPriceUsd, floorUsd)} />
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-lg mt-4 w-full disabled:opacity-90 disabled:shadow-none" disabled={!canSubmit} aria-busy={pending} onClick={onSubmit}>
          {pending ? "Sending…" : `Sell $${launch.symbol}`}
        </button>
      )}
      <div className="mt-3 space-y-2">
        {!gate.ready ? <p className="field-hint">{gate.reason}</p> : null}
        <FinePrint summary={side === "buy" ? (exactQuote ? "Exact pool quote, max slippage 1%" : "Estimates at spot, max slippage 1%") : "Max slippage 1%"}>
          {side === "buy" ? (
            <p>
              {exactQuote
                ? "Exact DAMM v2 quote at the latest on-chain state; price and max loss are this buy's average price, pool fee and price impact included"
                : "Estimate at the spot price, before price impact, slippage and route fees"}{" "}
              (max slippage 1%). If the price falls to the floor, redeeming these tokens returns about{" "}
              {tokensOut > 0 ? formatUsd(atFloorUsd) : "the floor value"} after the exit fee.
            </p>
          ) : null}
          <p>{venueText}</p>
        </FinePrint>
        <TxProgress flow={flow} />
        {flow.status === "idle" && message ? (
          <p role="status" className="tile-soft px-3.5 py-2.5 text-sm text-ink-2">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
