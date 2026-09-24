import Link from "next/link";
import { maxLossFraction } from "@stockfloor/sdk";
import type { LaunchSummary } from "@/lib/data/types";
import { formatMaxLoss, formatMultiple, formatProgress, formatUsd } from "@/lib/format";
import { launchFloorUsd, presaleProgress, projectedFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { PhaseBadge } from "@/components/ui/PhaseBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { VolatilityTag } from "@/components/ui/QuoteChip";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { ChevronRightIcon, LinkIcon } from "@/components/ui/icons";
import { FloorMeter } from "@/components/token/FloorMeter";
import { NoBreakName } from "./NoBreakName";
import { launchStatus, statusLabel } from "./status";

const wholeUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Raise amounts: whole dollars (rounded down) from $100 up ("$621 of $1,001"), cents below. */
function formatRaiseUsd(value: number): string {
  return Number.isFinite(value) && value >= 100 ? wholeUsd.format(Math.floor(value)) : formatUsd(value);
}

/**
 * The notched "Explore ›" tab in the card's bottom-right corner. Decorative: the card's title link is
 * stretched over the whole card, so the card stays a single link target.
 */
function ExploreTab() {
  return (
    <span aria-hidden className="relative -mr-6 flex h-[58px] w-[138px] shrink-0 items-center justify-center gap-1 pl-[26px] text-[15px] font-bold text-ink">
      <svg width="138" height="58" viewBox="0 0 138 58" className="absolute inset-0">
        <path
          d="M0 58C14 58 18 52 20 42L24 16C26 6 32 0 44 0H138V58Z"
          className="fill-lilac transition-colors group-hover:fill-violet-soft"
        />
      </svg>
      <span className="relative">Explore</span>
      <ChevronRightIcon className="relative" />
    </span>
  );
}

export function LaunchCard({ launch }: { launch: LaunchSummary }) {
  const status = launchStatus(launch);
  const graduated = launch.phase === "graduated";
  const floorUsd = graduated ? launchFloorUsd(launch) : (projectedFloorUsd(launch) ?? 0);
  const hasEstimate = !graduated && projectedFloorUsd(launch) !== null;
  const progress = presaleProgress(launch);
  const raisedUsd = quoteRawToUsd(launch.quoteReserveRaw, launch.quote);
  const thresholdUsd = quoteRawToUsd(launch.thresholdQuoteRaw, launch.quote);
  const maxLoss = maxLossFraction(launch.priceUsd, floorUsd);
  const multiple = floorUsd > 0 ? launch.priceUsd / floorUsd : Number.POSITIVE_INFINITY;
  const href = `/t/${launch.mint}`;

  return (
    <article className="card group relative flex min-w-0 sm:min-h-[340px] flex-col overflow-hidden px-6 pt-6 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-start justify-between gap-3">
        <TokenAvatar symbol={launch.symbol} imageUrl={launch.imageUrl} size={56} />
        <PhaseBadge phase={launch.phase} label={statusLabel(status)} />
      </div>

      <h3 className="card-title mt-4 text-[22px] text-ink [text-wrap:balance]">
        <Link
          href={href}
          className="rounded-sm after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-violet"
        >
          <NoBreakName name={launch.name} />
        </Link>
        {/* The no-break space keeps the icon on the line of the last word. */}
        {"\u00a0"}
        <LinkIcon className="ml-1 inline-block align-[-2px] text-ink-2" />
      </h3>
      <p className="meta-violet mt-1.5 flex flex-wrap items-center gap-x-1">
        <span>${launch.symbol}</span> · <span>{launch.quote.asset.symbol}</span> · {statusLabel(status)}
        {launch.quote.asset.volatility === "volatile" ? (
          <span className="ml-1">
            <VolatilityTag volatility="volatile" />
          </span>
        ) : null}
      </p>

      {graduated ? (
        <>
          <p className="tnum mt-3 text-sm leading-normal text-ink-2">
            Price <span>{formatUsd(launch.priceUsd)}</span>
            {status === "floor-live" && Number.isFinite(multiple) ? (
              <>
                , <span>{formatMultiple(multiple)}</span> the floor.
              </>
            ) : (
              ". No floor until the migration fee reaches the vault."
            )}{" "}
            Vault share {launch.vaultSharePct}%. Max loss now{" "}
            <span className="font-bold text-risk">{formatMaxLoss(maxLoss)}</span>.
          </p>
          <div className="mt-4">
            <FloorMeter priceUsd={launch.priceUsd} floorUsd={floorUsd} maxLoss={maxLoss} compact />
          </div>
        </>
      ) : (
        <>
          <p className="tnum mt-3 text-sm leading-normal text-ink-2">
            {launch.phase === "graduating" ? (
              <>Curve complete. Waiting for migration. </>
            ) : (
              <>
                Curve price <span>{formatUsd(launch.priceUsd)}</span>.{" "}
              </>
            )}
            {hasEstimate ? (
              <>
                <span>Floor at graduation (est.)</span> <span>{formatUsd(floorUsd)}</span>.{" "}
              </>
            ) : null}
            Vault share {launch.vaultSharePct}%.
          </p>
          <div className="mt-4">
            <ProgressBar value={progress} label={`${launch.name} progress to graduation`} />
          </div>
        </>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0 pb-4">
          {graduated ? (
            <>
              <p className="text-xs text-ink-3">Floor</p>
              <p className="tnum mt-0.5 truncate text-base font-bold text-floor">{formatUsd(floorUsd)}</p>
            </>
          ) : (
            <>
              <p className="tnum text-xs text-ink-3">
                Raised · <span>{formatProgress(progress)}</span>
              </p>
              <p className="tnum mt-0.5 whitespace-nowrap text-base font-bold text-ink">
                {formatRaiseUsd(raisedUsd)} of {formatRaiseUsd(thresholdUsd)}
              </p>
            </>
          )}
        </div>
        <ExploreTab />
      </div>
    </article>
  );
}
