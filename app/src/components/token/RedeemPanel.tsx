"use client";

import { useId, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { LaunchSummary } from "@/lib/data/types";
import { useData, useRefreshChainData, useTokenBalance, useTxFlow } from "@/lib/data/context";
import { formatMultiple, formatPercent, formatSignificantDown, formatTokenAmount, formatUsd, parseTokenInput, rawToDecimal } from "@/lib/format";
import { estimateSellUsd, validateRedeemAmount } from "@/lib/estimates";
import { floorQuotePerToken, launchFloorUsd, previewRedeem, priceToFloorMultiple } from "@/lib/metrics";
import { quoteMarketSellUsd } from "@/lib/tradeQuote";
import { Gauge } from "@/components/ui/Gauge";
import { MidnightCard } from "@/components/ui/MidnightCard";
import { NotchedCta } from "@/components/ui/Notched";
import { LockIcon, RedeemIcon } from "@/components/ui/icons";
import { TxProgress } from "@/components/ui/TxProgress";
import { useActionGate } from "./useActionGate";

/** DAMM v2 pool fee used for the "sell at market instead" comparison. */
const MARKET_FEE_BPS = 100;

export function RedeemPanel({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const wallet = useWallet();
  const { actions } = useData();
  const balance = useTokenBalance(launch.mint);
  const gate = useActionGate();
  const refresh = useRefreshChainData();
  const [flow, dispatch] = useTxFlow();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ pending: boolean; message: string | null }>({
    pending: false,
    message: null,
  });

  const quote = launch.quote.asset;
  // Redeem opens only once the pool migrated and the migration fee is in the vault (SDK phase "redeemable").
  const open = launch.phase === "graduated" && launch.migrationFeeHarvested;
  const amountRaw = input.trim() === "" ? null : parseTokenInput(input, launch.baseDecimals);
  const balanceRaw = wallet.connected ? (balance.data ?? null) : null;
  const inputError = input.trim() === "" ? null : validateRedeemAmount(amountRaw, balanceRaw, launch.supplyRaw);
  const preview = amountRaw !== null && amountRaw > 0n && !inputError ? previewRedeem(launch, amountRaw) : null;
  const zeroPayout = preview !== null && preview.net === 0n;
  // Exact DAMM v2 sell quote (pool fee and price impact) when chain state is available, else a spot estimate.
  const marketExact = amountRaw !== null && amountRaw > 0n ? quoteMarketSellUsd(launch, amountRaw) : null;
  const marketUsd =
    marketExact ??
    (amountRaw !== null && amountRaw > 0n
      ? estimateSellUsd(rawToDecimal(amountRaw, launch.baseDecimals).toNumber(), launch.priceUsd, MARKET_FEE_BPS)
      : 0);

  // With no amount typed (and with no wallet, which is most first visits) there is nothing to
  // preview, so the same three rows state the rate instead: what one token is backed by and what it
  // would pay after the exit fee. Both are read from the vault, and neither needs a wallet.
  const floorQuote = floorQuotePerToken(launch.vaultRaw, launch.supplyRaw, launch.baseDecimals, launch.quote);
  const floorUsd = launchFloorUsd(launch);
  const perTokenAfterFeeUsd = floorUsd * (1 - launch.exitFeeBps / 10_000);

  const canSubmit = open && !launch.quotePaused && gate.ready && preview !== null && !zeroPayout && !status.pending;

  async function onRedeem() {
    if (!preview || amountRaw === null) return;
    setStatus({ pending: true, message: null });
    dispatch({ type: "reset" });
    const result = await actions.redeem({ launch, amountRaw }, wallet, { dispatch });
    setStatus({ pending: false, message: result.ok ? "Redeemed." : result.error });
    if (result.ok) {
      setInput("");
      refresh();
    }
  }

  const quoteAmount = (raw: bigint) =>
    `${formatTokenAmount(raw, quote.decimals, { multiplier: launch.quote.multiplier, maxFractionDigits: 8 })} ${quote.symbol}`;
  const exitFee = formatPercent(launch.exitFeeBps / 10_000);
  const title = "Redeem at the floor";
  const intro = (
    <>
      Burn ${launch.symbol}, receive a pro-rata share of the vault in {quote.symbol} minus the {exitFee} exit fee.
    </>
  );
  const caveat = (
    <>
      Available to every holder at any time: the program has no pause switch. The {quote.symbol} issuer can pause{" "}
      {quote.symbol} transfers, and a program upgrade could change the rules (see disclosures).
    </>
  );

  if (!open) {
    return (
      <section aria-labelledby={`${id}-heading`} className="card p-5 lg:rounded-soft lg:bg-lilac lg:shadow-none">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${id}-heading`} className="text-[15px] font-bold text-ink">
            {title}
          </h2>
          <span className="pill pill-sm pill-neutral shrink-0">
            <LockIcon size={12} />
            Closed
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-normal text-ink-3">
          Redemption opens after migration to DAMM v2 and the migration-fee harvest into the vault.
          {launch.phase === "graduated" ? " The pool has migrated; the harvest is the next crank step." : ""} Then any
          holder can burn ${launch.symbol} for a pro-rata share of the vault in {quote.symbol}, minus the {exitFee} exit
          fee.
        </p>
      </section>
    );
  }

  const multiple = priceToFloorMultiple(launch.priceUsd, floorUsd);
  const multipleKnown = Number.isFinite(multiple) && multiple > 0;
  const netUi = preview ? quoteAmount(preview.net) : null;

  return (
    <div className="space-y-3">
      <MidnightCard
        title={title}
        subtitle={<span className="block max-w-[200px]">{intro}</span>}
        gauge={
          <Gauge
            value={multipleKnown ? Math.min(1 / multiple, 1) : 0}
            label={multipleKnown ? formatMultiple(multiple) : "Live"}
            caption="Floor live"
            ariaLabel={multipleKnown ? `Price is ${formatMultiple(multiple)} the floor` : "Floor live"}
          />
        }
        howItWorksHref="/#how-it-works"
        cta={
          <NotchedCta
            icon={<RedeemIcon />}
            className="disabled:!opacity-100 disabled:!text-ink-2"
            disabled={!canSubmit} onClick={onRedeem} aria-busy={status.pending}>
            {status.pending ? (
              "Preparing…"
            ) : (
              <>
                Redeem{netUi ? <span className="sr-only"> for {netUi}</span> : null}
              </>
            )}
          </NotchedCta>
        }
      >
        <div className="space-y-4">
          <DarkAmountField
            id={`${id}-amount`}
            symbol={launch.symbol}
            value={input}
            onChange={(v) => {
              setInput(v);
              setStatus({ pending: false, message: null });
              if (flow.status !== "running") dispatch({ type: "reset" });
            }}
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

          <div aria-live="polite">
            {preview && netUi ? (
              <dl>
                <dt className="text-[12.5px] text-on-dark">
                  Burn {formatTokenAmount(amountRaw!, launch.baseDecimals)} ${launch.symbol}, receive
                </dt>
                <dd className="mt-1.5">
                  <span className="sr-only">{netUi}</span>
                  <BigFigure text={`≈ ${netUi}`} unit={quote.symbol} />
                </dd>
                <dd className="tnum mt-2 text-sm font-semibold text-mint">
                  ≈ {formatUsd(preview.netUsd)} after the {exitFee} fee
                </dd>
              </dl>
            ) : (
              <>
                <dl>
                  <div>
                    <dt className="text-[12.5px] text-on-dark">You receive per token</dt>
                    <dd className="mt-1.5">
                      <BigFigure text={`≈ ${formatUsd(perTokenAfterFeeUsd)}`} />
                    </dd>
                    <dd className="mt-2 text-sm font-semibold text-mint">after the {exitFee} fee</dd>
                  </div>
                </dl>
                <p className="mt-1 text-[12.5px] text-on-dark-3">Enter an amount for the exact payout.</p>
              </>
            )}
          </div>

          <details className="group rounded-[16px] bg-tile/70 text-[12.5px] leading-normal">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3.5 font-semibold text-on-dark-2 [&::-webkit-details-marker]:hidden">
              {preview ? "Payout breakdown" : "Rate and fees"}
              <span aria-hidden className="text-iris transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="space-y-2.5 px-3.5 pb-3.5">
              <dl className="space-y-2.5">
              {preview ? (
                <>
                  <DarkRow label="Share of the vault">{quoteAmount(preview.gross)}</DarkRow>
                  <DarkRow label={`Exit fee ${exitFee} (stays in the vault)`}>−{quoteAmount(preview.fee)}</DarkRow>
                  <DarkRow label={marketExact !== null ? "Selling at market instead (exact DAMM v2 quote)" : "Selling at market instead (est.)"}>
                    ≈ {formatUsd(marketUsd)}
                  </DarkRow>
                  {/*
                    The floor per token never falls in the quote asset (the exit fee stays in the vault),
                    but this figure is in USD, where it moves with the underlying. Do not promise "never
                    lower" next to a dollar amount.
                  */}
                  <DarkRow label="Floor for remaining holders">
                    {formatUsd(preview.floorAfterUsd)} (never falls in {quote.symbol})
                  </DarkRow>
                </>
              ) : (
                <>
                  <DarkRow label="Floor per token">
                    <span className="block">
                      {formatSignificantDown(floorQuote, 4)} {quote.symbol}
                    </span>
                    <span className="block text-on-dark-3">≈ {formatUsd(floorUsd)}</span>
                  </DarkRow>
                  <DarkRow label="Exit fee">{exitFee} (stays in the vault)</DarkRow>
                </>
              )}
              </dl>
              <p className="border-t border-midnight-line pt-2.5 text-xs text-on-dark-3">{caveat}</p>
            </div>
          </details>

          {zeroPayout ? (
            <p className="text-sm font-semibold text-risk-on-dark">This amount is too small: the payout rounds down to zero.</p>
          ) : null}
          {launch.quotePaused ? (
            <p className="rounded-[14px] bg-tile px-3.5 py-2.5 text-[13px] text-risk-on-dark">
              {quote.symbol} is paused by its issuer. Redemptions work again once it resumes; your tokens and the vault
              stay untouched.
            </p>
          ) : null}
        </div>
      </MidnightCard>
      {/* "Connect a wallet" already shows under the buy panel above; repeat only the other reasons. */}
      {!gate.ready && wallet.connected ? <p className="field-hint px-1">{gate.reason}</p> : null}
      <TxProgress flow={flow} />
      {flow.status === "idle" && status.message ? (
        <p role="status" className="tile-soft px-3.5 py-2.5 text-sm text-ink-2">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

/** Big white numerals; a trailing unit is drawn smaller. Decorative: callers give the exact text. */
function BigFigure({ text, unit }: { text: string; unit?: string }) {
  const hasUnit = unit !== undefined && text.endsWith(` ${unit}`);
  const number = hasUnit ? text.slice(0, -unit.length - 1) : text;
  const size = number.length > 12 ? "text-[26px]" : number.length > 9 ? "text-[32px]" : "text-[40px]";
  return (
    <span aria-hidden={hasUnit ? true : undefined} className="tnum flex flex-wrap items-baseline gap-x-2 text-white">
      <span className={`font-extrabold leading-none tracking-[-0.03em] ${size}`}>{number}</span>
      {hasUnit ? <span className="text-[17px] font-extrabold">{unit}</span> : null}
    </span>
  );
}

function DarkRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-t border-midnight-line pt-2.5">
      <dt className="max-w-[55%] text-on-dark-3">{label}</dt>
      <dd className="tnum text-right font-semibold text-white">{children}</dd>
    </div>
  );
}

/** The amount input on the midnight card: same behaviour as AmountField, dark surface. */
function DarkAmountField({
  id,
  symbol,
  value,
  onChange,
  error,
  hint,
  onMax,
}: {
  id: string;
  symbol: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  hint?: string;
  onMax?: () => void;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <div
        className={`rounded-[18px] bg-tile px-4 py-2.5 focus-within:outline-2 focus-within:outline-iris ${
          error ? "outline-2 outline-risk-on-dark" : ""
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-[12.5px] text-on-dark">
            Amount to redeem
          </label>
          {onMax ? (
            <button
              type="button"
              onClick={onMax}
              className="-my-2 min-h-8 rounded-lg px-2 text-xs font-bold text-iris hover:bg-midnight-chip"
            >
              Max
            </button>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2.5">
          <input
            id={id}
            className="tnum h-9 min-w-0 flex-1 bg-transparent p-0 text-xl font-extrabold text-white outline-none placeholder:text-on-dark-3/50"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="shrink-0 text-sm font-bold text-on-dark-2">${symbol}</span>
        </div>
        {!error && hint ? (
          <p id={`${id}-hint`} className="tnum text-xs text-on-dark-3">
            {hint}
          </p>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 px-1 text-sm font-semibold text-risk-on-dark">
          {error}
        </p>
      ) : null}
    </div>
  );
}
