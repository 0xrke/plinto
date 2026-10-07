"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CURVE_PRESETS, maxLossFraction } from "@stockfloor/sdk";
import { CREATOR_GRADUATION_BONUS_PCT, LP_FEE_SPLIT_PCT, PLATFORM_GRADUATION_FEE_PCT } from "@/lib/config";
import { useLaunch } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { formatPercent, formatProgress, formatTokenAmount, formatUsd } from "@/lib/format";
import {
  launchFloorUsd,
  presaleProgress,
  projectedFloorUsd,
  quoteRawToUsd,
} from "@/lib/metrics";
import { PageColumns } from "@/components/layout/PageColumns";
import { Details } from "@/components/ui/Details";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatTile } from "@/components/ui/Tiles";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { CrankPanel } from "./CrankPanel";
import { Disclosures } from "./Disclosures";
import { FloorMeter } from "./FloorMeter";
import { MarketBuyPanel } from "./MarketBuyPanel";
import { PhaseStepper } from "./PhaseStepper";
import { PresaleTradePanel } from "./PresaleTradePanel";
import { PriceChartCard } from "./PriceChartCard";
import { RedeemPanel } from "./RedeemPanel";
import { TokenHeader } from "./TokenHeader";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { isImpersonation } from "@/lib/data/impersonation";
import { VaultStats } from "./VaultStats";

/** Anchor of the trade panel. */
const TRADE_ID = "trade";

/*
 * Layout: PageColumns with the trade and redeem panels on the right rail. The main column is the
 * header, the price chart, a compact progress or floor block, then one "How it works" disclosure and
 * the collapsed risk disclosures. On phones the page is one column in reading order: the top of the
 * main column (header, chart, numbers), then the rail (the actions), then the rest of the main column. The main column is `display: contents` below lg so its two halves and
 * the rail can be ordered as siblings.
 */
const MAIN_MOBILE_CONTENTS = "max-lg:contents";
const TOP = "max-lg:order-1 max-lg:px-4 max-lg:pt-4 max-lg:sm:px-6";
const BOTTOM = "max-lg:order-3 max-lg:px-4 max-lg:pb-10 max-lg:sm:px-6 lg:mt-6";
const RAIL = "max-lg:order-2 max-lg:pb-4 max-lg:pt-4";

function TokenColumns({ top, bottom, rail }: { top: ReactNode; bottom: ReactNode; rail: ReactNode }) {
  return (
    <PageColumns
      mainClassName={MAIN_MOBILE_CONTENTS}
      railClassName={RAIL}
      main={
        <>
          <div className={`space-y-5 lg:space-y-6 ${TOP}`}>{top}</div>
          <div className={`space-y-5 lg:space-y-6 ${BOTTOM}`}>{bottom}</div>
        </>
      }
      rail={<div className="space-y-4 lg:space-y-6">{rail}</div>}
    />
  );
}

export function TokenView({ mint }: { mint: string }) {
  const { data: launch, isPending, isError, error, refetch } = useLaunch(mint);

  if (isPending) {
    return (
      <PageColumns
        main={
          <div className="space-y-6" aria-busy="true">
            <div className="h-5 w-40 animate-pulse rounded-full bg-lilac" />
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 animate-pulse rounded-[18px] bg-lilac sm:h-[68px] sm:w-[68px] sm:rounded-[20px]" />
              <div className="h-10 w-2/3 animate-pulse rounded-soft bg-lilac" />
            </div>
            <div className="grid grid-cols-3 gap-3.5">
              <div className="h-[76px] animate-pulse rounded-tile bg-surface shadow-tile" />
              <div className="h-[76px] animate-pulse rounded-tile bg-surface shadow-tile" />
              <div className="h-[76px] animate-pulse rounded-tile bg-surface shadow-tile" />
            </div>
            <div className="h-80 animate-pulse rounded-card bg-surface shadow-card" />
            <span className="sr-only">Loading token</span>
          </div>
        }
        rail={
          <div className="space-y-6" aria-hidden>
            <div className="h-7 w-48 animate-pulse rounded-full bg-lilac" />
            <div className="h-72 animate-pulse rounded-card bg-cloud" />
            <div className="h-80 animate-pulse rounded-feature bg-midnight/90" />
          </div>
        }
      />
    );
  }

  if (isError) {
    return (
      <PageColumns
        main={
          <div className="card mx-auto mt-6 max-w-xl p-8 text-center sm:mt-16" role="alert">
            <h1 className="display text-[28px] text-ink">Could not load this token</h1>
            <p className="mt-3 text-sm text-ink-2">{error instanceof Error ? error.message : String(error)}</p>
            <button type="button" className="btn btn-secondary mt-6" onClick={() => void refetch()}>
              Try again
            </button>
          </div>
        }
      />
    );
  }

  if (!launch) {
    return (
      <PageColumns
        main={
          <div className="card mx-auto mt-6 max-w-xl p-8 text-center sm:mt-16">
            <h1 className="display text-[28px] text-ink">Token not found</h1>
            <p className="mt-3 break-all text-sm text-ink-2">
              No Plinto launch uses the mint <span className="font-mono">{mint}</span>.
            </p>
            <Link href="/" className="btn btn-primary mt-6">
              <ChevronLeftIcon />
              Back to launches
            </Link>
          </div>
        }
      />
    );
  }

  return launch.phase === "graduated" ? <GraduatedView launch={launch} /> : <PresaleView launch={launch} />;
}

/** The one explainer of the token page: phase stepper, the graduation steps and the floor rules, collapsed. */
function HowItWorks({ launch, children }: { launch: LaunchSummary; children?: ReactNode }) {
  const symbol = launch.quote.asset.symbol;
  const thresholdUsd = quoteRawToUsd(launch.thresholdQuoteRaw, launch.quote);
  const projectedVault = launch.projectedAtGraduation?.vaultQuoteRaw ?? null;
  const amount = (raw: bigint) => formatTokenAmount(raw, launch.quote.asset.decimals, { multiplier: launch.quote.multiplier });
  const ratio = CURVE_PRESETS[launch.preset].priceRatio;
  const exitFee = formatPercent(launch.exitFeeBps / 10_000);
  const steps: ReactNode[] = [
    <>Curve completes at ≈ {formatUsd(thresholdUsd)} raised.</>,
    ...(launch.feeSplit ? [<>Platform {PLATFORM_GRADUATION_FEE_PCT}%, creator {CREATOR_GRADUATION_BONUS_PCT}% paid out.</>] : []),
    <>
      {launch.vaultSharePct}%{projectedVault !== null ? ` (${amount(projectedVault)} ${symbol})` : ""} goes to the vault: floor =
      vault ÷ supply.
    </>,
    launch.feeSplit ? (
      <>
        The rest seeds a locked Meteora pool; its fees: creator {LP_FEE_SPLIT_PCT.creator}%, vault {LP_FEE_SPLIT_PCT.floor}%, platform{" "}
        {LP_FEE_SPLIT_PCT.platform}%.
      </>
    ) : (
      <>The rest seeds a locked Meteora pool; its fees flow to the vault.</>
    ),
    <>Redeem any time for your share of the vault, minus a {exitFee} exit fee.</>,
  ];
  return (
    <section aria-labelledby="how-heading" className="card px-5 py-3 sm:px-7">
      <Details
        summaryClassName="w-full !text-ink"
        summary={
          <h2 id="how-heading" className="flex-1 text-[17px] font-bold text-ink">
            How it works
          </h2>
        }
      >
        <div className="space-y-5 pb-4 pt-2">
          <PhaseStepper phase={launch.phase} migrationFeeHarvested={launch.migrationFeeHarvested} />
          <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-normal text-ink-2 marker:font-bold marker:text-violet">
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <ul className="space-y-1.5 border-t border-line pt-4 text-[13px] leading-normal text-ink-2">
            <li>
              Curve: {CURVE_PRESETS[launch.preset].label}, price ×{formatMultipleBare(Number(ratio.num) / Number(ratio.den))} from
              the first buy to graduation.
            </li>
            {launch.floorPer100AtListingUsd !== null ? (
              <li>
                Floor per $100: what $100 bought at the listing price redeems for at the floor right after graduation,
                after the {exitFee} exit fee ({formatUsd(launch.floorPer100AtListingUsd)}). It moves with{" "}
                {launch.quote.asset.underlying} in USD.
              </li>
            ) : null}
            <li>Floor = vault ÷ supply. No price oracle.</li>
            <li className="font-semibold text-ink">The floor protects from zero, not from loss.</li>
          </ul>
          {children}
        </div>
      </Details>
    </section>
  );
}

function formatMultipleBare(x: number): string {
  return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function GraduatedView({ launch }: { launch: LaunchSummary }) {
  const floorUsd = launchFloorUsd(launch);
  const maxLoss = maxLossFraction(launch.priceUsd, floorUsd);
  // Migrated, but the migration fee is not in the vault yet: redemption is closed and the vault holds only fees.
  const harvestPending = !launch.migrationFeeHarvested;

  return (
    <TokenColumns
      top={
        <>
          {isImpersonation(launch) && <ImpersonationBanner symbol={launch.symbol} />}
          <TokenHeader launch={launch} />
          <PriceChartCard launch={launch} />
          <section aria-labelledby="meter-heading" className="card p-4 sm:p-5">
            <h2 id="meter-heading" className="sr-only">
              Price and floor
            </h2>
            {harvestPending ? (
              <p role="status" className="tile-cream mb-4 px-4 py-3 text-sm leading-relaxed text-graduating">
                Migrated. Redemption opens after the vault harvest — run the crank.
              </p>
            ) : null}
            {/*
              The meter alone carries the floor, the price and the share at risk (the spot max loss); the
              buy button states the max loss of the amount typed. Its "Price is N× the floor" caption
              stays for screen readers.
            */}
            <div className="[&_figcaption]:sr-only">
              <FloorMeter priceUsd={launch.priceUsd} floorUsd={floorUsd} maxLoss={maxLoss} />
            </div>
          </section>
        </>
      }
      rail={
        <>
          <div id={TRADE_ID} className="below-header">
            <MarketBuyPanel launch={launch} />
          </div>
          <RedeemPanel launch={launch} />
          <CrankPanel launch={launch} />
        </>
      }
      bottom={
        <>
          <HowItWorks launch={launch}>
            <div className="border-t border-line pt-4">
              <VaultStats launch={launch} />
            </div>
          </HowItWorks>
          <Disclosures launch={launch} />
        </>
      }
    />
  );
}

function PresaleView({ launch }: { launch: LaunchSummary }) {
  const progress = presaleProgress(launch);
  const quote = launch.quote;
  const symbol = quote.asset.symbol;
  const raisedUsd = quoteRawToUsd(launch.quoteReserveRaw, quote);
  const thresholdUsd = quoteRawToUsd(launch.thresholdQuoteRaw, quote);
  const estFloor = projectedFloorUsd(launch);
  const graduating = launch.phase === "graduating";
  const amount = (raw: bigint) => formatTokenAmount(raw, quote.asset.decimals, { multiplier: quote.multiplier });

  return (
    <TokenColumns
      top={
        <>
          {isImpersonation(launch) && <ImpersonationBanner symbol={launch.symbol} />}
          <TokenHeader launch={launch} />
          <PriceChartCard launch={launch} />
          <section aria-labelledby="curve-heading" className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="curve-heading" className="text-[15px] font-bold text-ink">
                {graduating ? "Curve complete" : "Bonding curve"}
              </h2>
              <p className="tnum text-[13px] text-ink-3">
                {formatUsd(raisedUsd)} of {formatUsd(thresholdUsd)} · {formatProgress(progress)}
              </p>
            </div>
            <p className="tnum mt-1.5 text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-ink">
              {amount(launch.quoteReserveRaw)} <span className="text-base font-bold text-ink-3">/ {amount(launch.thresholdQuoteRaw)} {symbol}</span>
            </p>
            <div className="mt-3">
              <ProgressBar value={progress} label={graduating ? "Curve complete" : "Progress to graduation"} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
              <StatTile label="Est. floor" value={estFloor !== null ? formatUsd(estFloor) : "—"} tone="floor" size="md" />
              <StatTile
                label="Floor per $100"
                value={launch.floorPer100AtListingUsd !== null ? formatUsd(launch.floorPer100AtListingUsd) : "—"}
                sub={`after the ${formatPercent(launch.exitFeeBps / 10_000)} exit fee`}
                tone="floor"
                size="md"
              />
              <StatTile label="Floor share" value={`${launch.vaultSharePct}%`} size="md" className="max-sm:col-span-2" />
            </dl>
          </section>
        </>
      }
      rail={
        <>
          <div id={TRADE_ID} className="below-header">
            <PresaleTradePanel launch={launch} />
          </div>
          {/* No Redeem card before migration: the trade panel's notice says when it opens. */}
          <CrankPanel launch={launch} />
        </>
      }
      bottom={
        <>
          <HowItWorks launch={launch} />
          <Disclosures launch={launch} />
        </>
      }
    />
  );
}
