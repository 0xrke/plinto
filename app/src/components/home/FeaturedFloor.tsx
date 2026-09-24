"use client";

import { useLaunches } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { formatMultiple, formatTokenAmount, formatUsd } from "@/lib/format";
import { launchFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { Gauge } from "@/components/ui/Gauge";
import { MidnightCard, MidnightValue } from "@/components/ui/MidnightCard";
import { NotchedCta } from "@/components/ui/Notched";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { launchStatus } from "@/components/launch/status";

/** The graduated launch with a live floor and the largest vault in USD, or null. */
export function featuredLaunch(launches: LaunchSummary[]): LaunchSummary | null {
  let best: LaunchSummary | null = null;
  let bestUsd = 0;
  for (const l of launches) {
    if (launchStatus(l) !== "floor-live" || l.vaultRaw <= 0n) continue;
    const usd = quoteRawToUsd(l.vaultRaw, l.quote);
    if (best === null || usd > bestUsd) {
      best = l;
      bestUsd = usd;
    }
  }
  return best;
}

/** Rail block: the biggest live vault on the midnight card, with the price-to-floor gauge. */
export function FeaturedFloor() {
  const { data, isPending, isError } = useLaunches();
  const launch = featuredLaunch(data ?? []);

  return (
    <section aria-labelledby="featured-heading" className="rail-section">
      <SectionHeader
        id="featured-heading"
        title="Featured floor"
        href={launch ? `/t/${launch.mint}` : undefined}
        linkLabel="Open token"
        linkAriaLabel={launch ? `Open ${launch.name}` : undefined}
      />
      <div className="mt-3.5">{isPending ? <Skeleton /> : launch ? <Featured launch={launch} /> : <NoFloor error={isError} />}</div>
    </section>
  );
}

function Featured({ launch }: { launch: LaunchSummary }) {
  const floorUsd = launchFloorUsd(launch);
  const multiple = floorUsd > 0 ? launch.priceUsd / floorUsd : Number.POSITIVE_INFINITY;
  const vaultUsd = quoteRawToUsd(launch.vaultRaw, launch.quote);
  const vaultUi = formatTokenAmount(launch.vaultRaw, launch.quote.asset.decimals, { multiplier: launch.quote.multiplier });
  const quote = launch.quote.asset.symbol;
  const hasMultiple = Number.isFinite(multiple) && multiple > 0;

  return (
    <MidnightCard
      headingLevel={3}
      // The narrow 340px rail has no room for both the link and the CTA; How it works sits just below.
      className="lg:max-xl:[&>a]:hidden"
      // One line like the mockup: long names truncate, and "vault" moves to the subline.
      title={
        <span className="block truncate" title={launch.name}>
          {launch.name}
        </span>
      }
      subtitle={`$${launch.symbol} vault · Floor live`}
      gauge={
        hasMultiple ? (
          <Gauge
            value={Math.min(1 / multiple, 1)}
            label={formatMultiple(multiple)}
            caption="Floor live"
            ariaLabel={`Price is ${formatMultiple(multiple).replace("×", "")} times the floor`}
          />
        ) : undefined
      }
      cta={
        <NotchedCta
          href={`/t/${launch.mint}`}
          icon={<ArrowUpRightIcon />}
          aria-label={`Buy $${launch.symbol} on its token page`}
          // A slightly tighter tab keeps a clear gap after "How it works" on the 392px rail.
          className="text-[15px] [&>span]:pr-5"
        >
          Buy ${launch.symbol}
        </NotchedCta>
      }
    >
      <MidnightValue value={vaultUi} unit={quote} size={vaultUi.length > 9 ? "md" : "lg"} />
      <p className="tnum mt-2.5 text-sm leading-normal text-on-dark">
        ≈ {formatUsd(vaultUsd)} in the vault. Floor = vault ÷ supply. No price oracle.
      </p>
    </MidnightCard>
  );
}

function NoFloor({ error }: { error: boolean }) {
  return (
    <MidnightCard
      headingLevel="p"
      title={error ? "Launches did not load" : "No floor is live yet"}
      subtitle="Floors open when a launch graduates"
      minHeight={260}
      cta={
        <NotchedCta href="/create" icon={<ArrowUpRightIcon />}>
          Launch a token
        </NotchedCta>
      }
    >
      <p className="text-sm leading-normal text-on-dark">
        A fixed share of every raise moves into the token&apos;s vault at graduation. Floor = vault ÷ supply.
      </p>
    </MidnightCard>
  );
}

function Skeleton() {
  return <div aria-hidden className="card-midnight h-[330px] animate-pulse" />;
}
