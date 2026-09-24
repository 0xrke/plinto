import Link from "next/link";
import { maxLossFraction } from "@stockfloor/sdk";
import type { LaunchSummary } from "@/lib/data/types";
import { formatMaxLoss, formatPercent, formatProgress, formatUsd } from "@/lib/format";
import { launchFloorUsd, presaleProgress, projectedFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { PhaseBadge } from "@/components/ui/PhaseBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { QuoteChip } from "@/components/ui/QuoteChip";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { TokenCover } from "@/components/ui/TokenCover";
import { FloorMeter } from "@/components/token/FloorMeter";

export function LaunchCard({ launch }: { launch: LaunchSummary }) {
  const graduated = launch.phase === "graduated";
  const floorUsd = graduated ? launchFloorUsd(launch) : (projectedFloorUsd(launch) ?? 0);
  const progress = presaleProgress(launch);
  const raisedUsd = quoteRawToUsd(launch.quoteReserveRaw, launch.quote);
  const thresholdUsd = quoteRawToUsd(launch.thresholdQuoteRaw, launch.quote);
  const maxLoss = maxLossFraction(launch.priceUsd, floorUsd);

  return (
    <article className="card group relative flex min-w-0 flex-col gap-4 overflow-hidden p-4 transition-shadow hover:shadow-md sm:p-5">
      <TokenCover symbol={launch.symbol} imageUrl={launch.imageUrl} className="-mx-4 -mt-4 h-20 sm:-mx-5 sm:-mt-5 sm:h-24" />
      <div className="relative -mt-12 flex items-end justify-between gap-3">
        <TokenAvatar symbol={launch.symbol} imageUrl={launch.imageUrl} size={56} ring />
        <PhaseBadge phase={launch.phase} />
      </div>
      <header className="-mt-2 min-w-0">
        <h3 className="display truncate text-lg text-ink">
          <Link href={`/t/${launch.mint}`} className="after:absolute after:inset-0 after:content-['']">
            {launch.name}
          </Link>
        </h3>
        <p className="text-sm text-ink-3">${launch.symbol}</p>
      </header>

      {graduated ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 text-sm min-[440px]:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-ink-3">Price</dt>
              <dd className="truncate font-semibold text-ink">{formatUsd(launch.priceUsd)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-3">Floor</dt>
              <dd className="truncate font-semibold text-floor-strong">{formatUsd(floorUsd)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-3">Max loss now</dt>
              <dd className="truncate font-semibold text-risk">{formatMaxLoss(maxLoss)}</dd>
            </div>
          </dl>
          <FloorMeter priceUsd={launch.priceUsd} floorUsd={floorUsd} maxLoss={maxLoss} compact />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="text-ink-2">
                <span className="font-semibold text-ink">{formatUsd(raisedUsd)}</span> of{" "}
                {formatUsd(thresholdUsd)}
              </span>
              <span className="font-semibold text-presale">{formatProgress(progress)}</span>
            </div>
            <ProgressBar value={progress} label={`${launch.name} progress to graduation`} size="sm" />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-ink-3">Curve price</dt>
              <dd className="truncate font-semibold text-ink">{formatUsd(launch.priceUsd)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-3">Floor at graduation (est.)</dt>
              <dd className="truncate font-semibold text-floor-strong">{formatUsd(floorUsd)}</dd>
            </div>
          </dl>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-ink-3">
        <span>Quote</span>
        <QuoteChip symbol={launch.quote.asset.symbol} volatility={launch.quote.asset.volatility} />
        <span className="ml-auto">Vault share {launch.vaultSharePct}%</span>
      </footer>
    </article>
  );
}
