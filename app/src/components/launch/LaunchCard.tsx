import Link from "next/link";
import { maxLossFraction } from "@stockfloor/sdk";
import type { LaunchSummary } from "@/lib/data/types";
import { formatMaxLoss, formatPercent, formatUsd } from "@/lib/format";
import { launchFloorUsd, presaleProgress, projectedFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { PhaseBadge } from "@/components/ui/PhaseBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { QuoteChip } from "@/components/ui/QuoteChip";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { FloorMeter } from "@/components/token/FloorMeter";

export function LaunchCard({ launch }: { launch: LaunchSummary }) {
  const graduated = launch.phase === "graduated";
  const floorUsd = graduated ? launchFloorUsd(launch) : (projectedFloorUsd(launch) ?? 0);
  const progress = presaleProgress(launch);
  const raisedUsd = quoteRawToUsd(launch.quoteReserveRaw, launch.quote);
  const thresholdUsd = quoteRawToUsd(launch.thresholdQuoteRaw, launch.quote);
  const maxLoss = maxLossFraction(launch.priceUsd, floorUsd);

  return (
    <article className="card group relative flex min-w-0 flex-col gap-4 p-4 transition-shadow hover:shadow-md sm:p-5">
      <header className="flex items-start gap-3">
        <TokenAvatar symbol={launch.symbol} imageUrl={launch.imageUrl} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-ink">
            <Link href={`/t/${launch.mint}`} className="after:absolute after:inset-0 after:content-['']">
              {launch.name}
            </Link>
          </h3>
          <p className="text-sm text-ink-3">${launch.symbol}</p>
        </div>
        <PhaseBadge phase={launch.phase} />
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
              <span className="font-semibold text-presale">{formatPercent(progress, { digits: 0 })}</span>
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
