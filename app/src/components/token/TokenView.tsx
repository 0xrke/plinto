"use client";

import { useState } from "react";
import Link from "next/link";
import { maxLossFraction } from "@stockfloor/sdk";
import { useLaunch } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { formatMaxLoss, formatMultiple, formatPercent, formatProgress, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import {
  launchFloorUsd,
  presaleProgress,
  priceToFloorMultiple,
  projectedFloorUsd,
  quoteRawToUsd,
} from "@/lib/metrics";
import { PhaseBadge } from "@/components/ui/PhaseBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { QuoteChip } from "@/components/ui/QuoteChip";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { CrankPanel } from "./CrankPanel";
import { Disclosures } from "./Disclosures";
import { FloorMeter } from "./FloorMeter";
import { MarketBuyPanel } from "./MarketBuyPanel";
import { PhaseStepper } from "./PhaseStepper";
import { PresaleTradePanel } from "./PresaleTradePanel";
import { RedeemPanel } from "./RedeemPanel";
import { FloorHistoryPlaceholder, VaultStats } from "./VaultStats";

/**
 * Two-column layout on large screens: the primary card (row 1) and the secondary cards
 * (row 2) on the left, the action panels spanning both rows on the right. On small screens
 * the DOM order puts the action panels right after the primary card.
 */
const BODY_GRID = "grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]";
const SIDE_COLUMN = "space-y-6 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start";

export function TokenView({ mint }: { mint: string }) {
  const { data: launch, isPending, isError, error, refetch } = useLaunch(mint);

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6" aria-busy="true">
        <div className="h-16 w-2/3 animate-pulse rounded-xl bg-sunken" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-xl bg-sunken lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-xl bg-sunken" />
        </div>
        <span className="sr-only">Loading token</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6" role="alert">
        <h1 className="text-xl font-semibold text-ink">Could not load this token</h1>
        <p className="mt-2 text-sm text-ink-2">{error instanceof Error ? error.message : String(error)}</p>
        <button type="button" className="btn btn-secondary mt-6" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }

  if (!launch) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Token not found</h1>
        <p className="mt-2 break-all text-sm text-ink-2">
          No StockFloor launch uses the mint <span className="font-mono">{mint}</span>.
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Back to launches
        </Link>
      </div>
    );
  }

  return <TokenDetail launch={launch} />;
}

function TokenHeader({ launch }: { launch: LaunchSummary }) {
  const [copied, setCopied] = useState(false);
  async function copyMint() {
    try {
      await navigator.clipboard.writeText(launch.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; the mint stays visible.
    }
  }
  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <TokenAvatar symbol={launch.symbol} imageUrl={launch.imageUrl} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{launch.name}</h1>
            <PhaseBadge phase={launch.phase} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <span className="font-semibold text-ink-2">${launch.symbol}</span>
            <button
              type="button"
              onClick={copyMint}
              className="font-mono text-xs hover:text-ink"
              title={launch.mint}
              aria-label={`Copy mint address ${launch.mint}`}
            >
              {copied ? "Copied" : truncateAddress(launch.mint, 5)}
            </button>
            <span className="inline-flex items-center gap-1.5">
              Quote <QuoteChip symbol={launch.quote.asset.symbol} volatility={launch.quote.asset.volatility} />
            </span>
          </div>
        </div>
      </div>
      <PhaseStepper phase={launch.phase} />
    </header>
  );
}

function TokenDetail({ launch }: { launch: LaunchSummary }) {
  const graduated = launch.phase === "graduated";
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <TokenHeader launch={launch} />
      {graduated ? <GraduatedBody launch={launch} /> : <PresaleBody launch={launch} />}
      <Disclosures launch={launch} />
    </div>
  );
}

function GraduatedBody({ launch }: { launch: LaunchSummary }) {
  const floorUsd = launchFloorUsd(launch);
  const maxLoss = maxLossFraction(launch.priceUsd, floorUsd);
  const multiple = priceToFloorMultiple(launch.priceUsd, floorUsd);

  return (
    <div className={BODY_GRID}>
      <div className="lg:col-start-1 lg:row-start-1">
        <section aria-labelledby="meter-heading" className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="meter-heading" className="text-lg font-semibold text-ink">
              Price and floor
            </h2>
            <p className="text-xs text-ink-3">Floor = vault ÷ supply. No price oracle.</p>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-ink-3">Price</dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{formatUsd(launch.priceUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-3">Floor</dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-floor-strong">{formatUsd(floorUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-3">Max loss if you buy now</dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight text-risk">{formatMaxLoss(maxLoss)}</dd>
            </div>
          </dl>
          <div className="mt-6">
            <FloorMeter priceUsd={launch.priceUsd} floorUsd={floorUsd} maxLoss={maxLoss} />
          </div>
          <p className="mt-4 text-sm text-ink-2">
            {Number.isFinite(multiple) && multiple >= 1
              ? `The price is ${formatMultiple(multiple)} the floor. If the market fell all the way to the floor, a buyer at today's price would lose ${formatPercent(maxLoss)} of the purchase. It cannot fall to zero while the vault holds ${launch.quote.asset.symbol}.`
              : "The price is at or below the floor. Buying and redeeming returns at least the floor, minus the exit fee and trading fees."}
          </p>
        </section>
      </div>
      <div className={SIDE_COLUMN}>
        <MarketBuyPanel launch={launch} />
        <RedeemPanel launch={launch} />
        <CrankPanel launch={launch} />
      </div>
      <div className="space-y-6 lg:col-start-1 lg:row-start-2">
        <VaultStats launch={launch} />
        <FloorHistoryPlaceholder quoteSymbol={launch.quote.asset.symbol} underlying={launch.quote.asset.underlying} />
      </div>
    </div>
  );
}

function PresaleBody({ launch }: { launch: LaunchSummary }) {
  const progress = presaleProgress(launch);
  const quote = launch.quote;
  const raisedUsd = quoteRawToUsd(launch.quoteReserveRaw, quote);
  const thresholdUsd = quoteRawToUsd(launch.thresholdQuoteRaw, quote);
  const estFloor = projectedFloorUsd(launch);
  const projectedVault = launch.projectedAtGraduation?.vaultQuoteRaw ?? null;
  const graduating = launch.phase === "graduating";

  return (
    <div className={BODY_GRID}>
      <div className="lg:col-start-1 lg:row-start-1">
        <section aria-labelledby="progress-heading" className="card p-5 sm:p-6">
          <h2 id="progress-heading" className="text-lg font-semibold text-ink">
            {graduating ? "Curve complete" : "Progress to graduation"}
          </h2>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
            <p className="text-3xl font-semibold tracking-tight text-ink">{formatProgress(progress)}</p>
            <p className="text-sm text-ink-2">
              <span className="font-semibold text-ink">
                {formatTokenAmount(launch.quoteReserveRaw, quote.asset.decimals, { multiplier: quote.multiplier })}
              </span>{" "}
              of{" "}
              {formatTokenAmount(launch.thresholdQuoteRaw, quote.asset.decimals, { multiplier: quote.multiplier })}{" "}
              {quote.asset.symbol} · ≈ {formatUsd(raisedUsd)} of {formatUsd(thresholdUsd)}
            </p>
          </div>
          <div className="mt-3">
            <ProgressBar value={progress} label="Progress to graduation" />
          </div>
          {graduating ? (
            <p className="mt-4 rounded-lg bg-graduating-soft px-3 py-2 text-sm text-graduating">
              The raise is complete. Next, the pool migrates to Meteora DAMM v2 and the vault share is harvested (Meteora
              keepers or anyone running the crank). Redemption opens as soon as the vault is funded.
            </p>
          ) : null}
          <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-line pt-5 min-[420px]:grid-cols-2 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-3">Curve price</dt>
              <dd className="mt-0.5 font-semibold text-ink">{formatUsd(launch.priceUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Floor at graduation (est.)</dt>
              <dd className="mt-0.5 font-semibold text-floor-strong">{estFloor !== null ? formatUsd(estFloor) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Vault at graduation</dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {projectedVault !== null
                  ? `${formatTokenAmount(projectedVault, quote.asset.decimals, { multiplier: quote.multiplier })} ${quote.asset.symbol}`
                  : "—"}
              </dd>
              <dd className="text-xs text-ink-3">{launch.vaultSharePct}% of the raise</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Curve</dt>
              <dd className="mt-0.5 font-semibold text-ink">{launch.preset === "gentle" ? "Gentle (1.2×)" : "Flat (1.01×)"}</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className={SIDE_COLUMN}>
        <PresaleTradePanel launch={launch} />
        <RedeemPanel launch={launch} />
        <CrankPanel launch={launch} />
      </div>
      <div className="lg:col-start-1 lg:row-start-2">
        <section aria-labelledby="whatnext-heading" className="card p-5 sm:p-6">
          <h2 id="whatnext-heading" className="text-lg font-semibold text-ink">
            What happens at graduation
          </h2>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-ink-2">
            <li>
              <span className="font-semibold text-ink">1.</span> The curve completes when its {quote.asset.symbol} reserve
              reaches the threshold.
            </li>
            <li>
              <span className="font-semibold text-ink">2.</span> {launch.vaultSharePct}% of the threshold moves into
              this token&apos;s vault. The floor per token becomes vault ÷ supply.
            </li>
            <li>
              <span className="font-semibold text-ink">3.</span> The rest seeds a Meteora DAMM v2 pool. Its liquidity is
              locked permanently; only fees can be claimed, and they flow to the vault.
            </li>
            <li>
              <span className="font-semibold text-ink">4.</span> From then on, any holder can redeem for a pro-rata share
              of the vault minus a {formatPercent(launch.exitFeeBps / 10_000)} exit fee.
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
