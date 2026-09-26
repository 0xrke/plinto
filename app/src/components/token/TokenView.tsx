"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { maxLossFraction } from "@stockfloor/sdk";
import { CREATOR_GRADUATION_BONUS_PCT, LP_FEE_SPLIT_PCT, PLATFORM_GRADUATION_FEE_PCT } from "@/lib/config";
import { useLaunch } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { formatMaxLoss, formatMultiple, formatPercent, formatProgress, formatTokenAmount, formatUsd } from "@/lib/format";
import {
  launchFloorUsd,
  presaleProgress,
  priceToFloorMultiple,
  projectedFloorUsd,
  quoteRawToUsd,
} from "@/lib/metrics";
import { PageColumns } from "@/components/layout/PageColumns";
import { Gauge } from "@/components/ui/Gauge";
import { MidnightCard, MidnightValue } from "@/components/ui/MidnightCard";
import { NotchedCta } from "@/components/ui/Notched";
import { IconTile, Pill, StatTile } from "@/components/ui/Tiles";
import { ArrowUpIcon, ChevronLeftIcon } from "@/components/ui/icons";
import { CrankPanel } from "./CrankPanel";
import { Disclosures } from "./Disclosures";
import { FloorMeter } from "./FloorMeter";
import { MarketBuyPanel } from "./MarketBuyPanel";
import { PhaseStepper } from "./PhaseStepper";
import { PresaleTradePanel } from "./PresaleTradePanel";
import { RedeemPanel } from "./RedeemPanel";
import { TokenHeader } from "./TokenHeader";
import { VaultStats } from "./VaultStats";

/** Anchor of the trade panel, for the "Buy" CTA on the presale progress card. */
const TRADE_ID = "trade";

/*
 * Layout: PageColumns with the trade and redeem panels on the right rail. On phones the page is
 * one column in reading order: the top of the main column, then the rail (the actions), then the
 * rest of the main column. The main column is `display: contents` below lg so its two halves and
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

function GraduatedView({ launch }: { launch: LaunchSummary }) {
  const floorUsd = launchFloorUsd(launch);
  const maxLoss = maxLossFraction(launch.priceUsd, floorUsd);
  const multiple = priceToFloorMultiple(launch.priceUsd, floorUsd);
  // Migrated, but the migration fee is not in the vault yet: redemption is closed and the vault holds only fees.
  const harvestPending = !launch.migrationFeeHarvested;

  return (
    <TokenColumns
      top={
        <>
          <TokenHeader launch={launch} />
          {/* On phones the phase chip in the header carries the phase; the stepper starts at sm. */}
          <div className="max-sm:hidden">
            <PhaseStepper phase={launch.phase} migrationFeeHarvested={launch.migrationFeeHarvested} />
          </div>
          <section aria-labelledby="meter-heading" className="card p-5 sm:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="meter-heading" className="heading text-[22px] text-ink sm:text-2xl">
                Price and floor
              </h2>
              <p className="text-[13px] text-ink-3">Floor = vault ÷ supply. No price oracle.</p>
            </div>
            {harvestPending ? (
              <p role="status" className="tile-cream mt-4 px-4 py-3 text-sm leading-relaxed text-graduating">
                The pool migrated to Meteora DAMM v2, but the migration fee has not been harvested into the vault yet.
                Until then redemption is closed and the floor below counts only harvested fees. Anyone can run the crank
                to harvest it.
              </p>
            ) : null}
            <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] sm:gap-3.5">
              <StatTile label="Price" value={formatUsd(launch.priceUsd)} marker="price" valueClassName="max-sm:text-base lg:max-xl:text-lg" />
              <StatTile
                label="Floor"
                value={formatUsd(floorUsd)}
                tone="floor"
                marker="floor"
                valueClassName="max-sm:text-base lg:max-xl:text-lg"
              />
              {/* The spot-price measure. The buy panel's own row is for the amount typed there. */}
              <StatTile
                label="Max loss at the current price"
                value={formatMaxLoss(maxLoss)}
                tone="risk"
                className="col-span-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 sm:col-span-1"
                valueClassName="max-sm:mt-0 max-sm:text-xl"
              />
            </dl>
            {/* The meter's own "Price is N× the floor" caption stays for screen readers; the sentence below says it in full. */}
            <div className="mt-7 [&_figcaption]:sr-only">
              <FloorMeter priceUsd={launch.priceUsd} floorUsd={floorUsd} maxLoss={maxLoss} />
            </div>
            <p className="mt-4 text-[14.5px] leading-relaxed text-ink-2">
              {harvestPending ? (
                "Redemption opens after the migration-fee harvest into the vault (run the crank). The floor shown will rise when it lands."
              ) : Number.isFinite(multiple) && multiple >= 1 ? (
                <>
                  The price is <b className="text-ink">{formatMultiple(multiple)}</b> the floor. If the market fell all
                  the way to the floor, a buyer at today&apos;s price would lose {formatPercent(maxLoss)} of the purchase.
                  It cannot fall to zero while the vault holds {launch.quote.asset.symbol}.
                </>
              ) : (
                "The price is at or below the floor. Buying and redeeming returns at least the floor, minus the exit fee and trading fees."
              )}
            </p>
          </section>
        </>
      }
      rail={
        <>
          <MarketBuyPanel launch={launch} />
          <RedeemPanel launch={launch} />
          <CrankPanel launch={launch} />
          <p className="px-1 text-[13px] leading-normal text-ink-3 max-lg:px-2">
            The floor protects from zero, not from loss.
          </p>
        </>
      }
      bottom={
        <>
          <VaultStats launch={launch} />
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
  const projectedVault = launch.projectedAtGraduation?.vaultQuoteRaw ?? null;
  const graduating = launch.phase === "graduating";
  const amount = (raw: bigint) => formatTokenAmount(raw, quote.asset.decimals, { multiplier: quote.multiplier });
  const raised = amount(launch.quoteReserveRaw);

  function focusTrade() {
    const panel = document.getElementById(TRADE_ID);
    if (!panel) return;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    panel.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }

  const steps: { tone: "presale" | "graduating" | "violet" | "floor"; body: ReactNode }[] = [
    {
      tone: "presale",
      body: (
        <>
          The curve completes when its {symbol} reserve reaches the threshold (≈ {formatUsd(thresholdUsd)} raised).
        </>
      ),
    },
    ...(launch.feeSplit
      ? [
          {
            tone: "graduating" as const,
            body: (
              <>
                The platform {PLATFORM_GRADUATION_FEE_PCT}% and the creator {CREATOR_GRADUATION_BONUS_PCT}% of the threshold
                are paid out: a one-off success bonus for the creator, who took no presale fees.
              </>
            ),
          },
        ]
      : []),
    {
      tone: "graduating",
      body: (
        <>
          {launch.vaultSharePct}% of the threshold
          {projectedVault !== null ? (
            <>
              , <b className="tnum text-ink">{`${amount(projectedVault)} ${symbol}`}</b>,
            </>
          ) : null}{" "}
          moves into the ${launch.symbol} vault. The floor per token becomes vault ÷ supply.
        </>
      ),
    },
    {
      tone: "violet",
      body: (
        <>
          {launch.feeSplit ? (
            <>
              The rest seeds a Meteora DAMM v2 pool. Its liquidity is locked permanently; only fees can be claimed.
              After Meteora&apos;s share, the pool&apos;s fees go to the creator {LP_FEE_SPLIT_PCT.creator}%, the vault{" "}
              {LP_FEE_SPLIT_PCT.floor}% and the platform {LP_FEE_SPLIT_PCT.platform}%.
            </>
          ) : (
            <>
              The rest seeds a Meteora DAMM v2 pool. Its liquidity is locked permanently; only fees can be claimed, and
              they flow to the vault.
            </>
          )}
        </>
      ),
    },
    {
      tone: "floor",
      body: (
        <>
          The floor goes live: any holder can redeem for a pro-rata share of the vault minus a{" "}
          {formatPercent(launch.exitFeeBps / 10_000)} exit fee.
        </>
      ),
    },
  ];

  return (
    <TokenColumns
      top={
        <>
          <TokenHeader launch={launch} />
          {/* On phones the phase chip in the header carries the phase; the stepper starts at sm. */}
          <div className="max-sm:hidden">
            <PhaseStepper phase={launch.phase} migrationFeeHarvested={launch.migrationFeeHarvested} />
          </div>
          <div className="space-y-2.5 sm:space-y-3.5">
            <MidnightCard
              title={graduating ? "Curve complete" : "Progress to graduation"}
              subtitle={graduating ? `Raised in ${symbol}` : `The curve fills in ${symbol}`}
              gauge={
                <Gauge
                  value={progress}
                  label={formatProgress(progress)}
                  caption={graduating ? "Graduating" : "Presale"}
                  ariaLabel={`Curve ${formatProgress(progress)} filled`}
                  size={92}
                />
              }
              minHeight={250}
              howItWorksHref="/#how-it-works"
              cta={
                graduating ? undefined : (
                  <NotchedCta icon={<ArrowUpIcon />} onClick={focusTrade} className="min-w-[150px] !text-lg [&>span]:flex-1 [&>span]:justify-center">
                    Buy
                  </NotchedCta>
                )
              }
            >
              <div>
                <MidnightValue value={raised} unit={symbol} />
                <p className="tnum mt-2 text-[13.5px] text-on-dark">
                  of {amount(launch.thresholdQuoteRaw)} {symbol} · ≈ {formatUsd(raisedUsd)} of {formatUsd(thresholdUsd)}
                </p>
                {graduating ? (
                  <p className="mt-4 rounded-[18px] bg-tile px-4 py-3 text-[13px] leading-relaxed text-on-dark">
                    The raise is complete. Next, the pool migrates to Meteora DAMM v2 and the vault share is harvested
                    (Meteora keepers or anyone running the crank). Redemption opens as soon as the vault is funded.
                  </p>
                ) : null}
              </div>
            </MidnightCard>
            <dl className="grid auto-rows-fr grid-cols-2 gap-2.5 sm:gap-3.5 2xl:grid-cols-4">
              <StatTile label="Curve price" value={formatUsd(launch.priceUsd)} tone="white" size="md" />
              <StatTile
                label="Floor at graduation (est.)"
                value={estFloor !== null ? formatUsd(estFloor) : "Not yet known"}
                tone="white"
                size="md"
                valueClassName="!text-floor"
              />
              <StatTile
                label="Vault at graduation"
                value={projectedVault !== null ? `${amount(projectedVault)} ${symbol}` : "Not yet known"}
                sub={
                  <Pill tone="floor" size="sm">
                    {launch.vaultSharePct}% of the raise
                  </Pill>
                }
                tone="white"
                size="md"
              />
              <StatTile
                label="Curve"
                value={launch.preset === "gentle" ? "Gentle" : "Flat"}
                sub={
                  <Pill tone="violet" size="sm">
                    {launch.preset === "gentle" ? "1.2×" : "1.01×"}
                  </Pill>
                }
                tone="white"
                size="md"
              />
            </dl>
            {launch.floorPer100AtListingUsd !== null ? (
              <section
                role="note"
                aria-label="Floor per $100 at listing"
                className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-tile bg-floor-wash px-5 py-4"
              >
                <p className="min-w-0 flex-1 basis-60 text-[13.5px] leading-relaxed text-ink-2">
                  <span className="block text-sm font-bold text-floor-strong">Floor per $100 at listing</span>
                  What $100 of ${launch.symbol} bought at the listing price redeems for at the floor right after
                  graduation, after the {formatPercent(launch.exitFeeBps / 10_000)} exit fee. Vault share{" "}
                  <b className="tnum text-ink">{launch.vaultSharePct}% of the raise</b>. Not a guarantee of profit: the
                  floor moves with {quote.asset.underlying} in USD.
                </p>
                <p className="tnum shrink-0 text-[28px] font-extrabold leading-none tracking-[-0.02em] text-floor">
                  {formatUsd(launch.floorPer100AtListingUsd)}
                </p>
              </section>
            ) : null}
          </div>
        </>
      }
      rail={
        <>
          <div id={TRADE_ID} className="below-header">
            <PresaleTradePanel launch={launch} />
          </div>
          <RedeemPanel launch={launch} />
          <CrankPanel launch={launch} />
        </>
      }
      bottom={
        <>
          <section aria-labelledby="whatnext-heading" className="card p-5 sm:p-7">
            <h2 id="whatnext-heading" className="heading text-[21px] text-ink sm:text-2xl">
              What happens at graduation
            </h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-x-7 sm:gap-y-4">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[13.5px] leading-normal text-ink-2 sm:text-sm">
                  <IconTile tone={step.tone} size={28} className="!rounded-[10px] !text-sm">
                    {i + 1}
                  </IconTile>
                  <span className="pt-[3px]">{step.body}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-3">
              The floor protects from zero, not from loss.
            </p>
          </section>
          <Disclosures launch={launch} />
        </>
      }
    />
  );
}
