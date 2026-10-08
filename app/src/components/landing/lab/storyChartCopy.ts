import type { LaunchMath } from "@/lib/landing/sim/launch";
import { floorEvents } from "@/lib/landing/sim/floorPath";
import { formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";
import { storyFrame, storyNetFinal, STORY_POS_END } from "@/lib/landing/sim/story";

/** Every string drawn on the "Follow your $100" chart lives here, so tests can scan it. */

export const ILLUSTRATION = "Illustration";

export const CHART_COPY = {
  raised: (usd: number) => `Raised ${formatUsdWhole(usd)}`,
  floorShare: (pct: number) => `Floor ${pct}%`,
  market: "Market",
  fees: (creatorPct: number, platformPct: number) => `${creatorPct}% · ${platformPct}%`,
  floor: "Floor",
  traded: (volumeUsd: number) => `${ILLUSTRATION} · ${formatUsdCompact(volumeUsd)} traded`,
  closeUp: "Close-up · real scale",
  fromFees: (pct: number) => `+${pct.toFixed(1)}% from fees`,
  peak: (value: number) => `Peak ${formatUsdWhole(value)} ↑`,
  arbLine: "Arbitrage line",
  bounce: "Bounce",
  fromExits: (pct: number) => `+${pct.toFixed(1)}% from exits`,
  /** The redeem chip reads "Redeem $36.87" (just the amount on phones). */
  redeemWord: "Redeem",
  redeem: (net: number) => `Redeem ${formatUsdCents(net)}`,
  hundred: "$100",
} as const;

/** "$100k", "$1.5M", "$900". */
export function formatUsdCompact(usd: number): string {
  if (usd >= 1e6) return `$${trim(usd / 1e6)}M`;
  if (usd >= 1e3) return `$${trim(usd / 1e3)}k`;
  return formatUsdWhole(usd);
}
const trim = (n: number) => String(Math.round(n * 10) / 10);

const pctOfRaise = (m: LaunchMath, usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;

/** Total illustrative volume traded in the story (sum of the harvested volumes). */
export function storyTradedUsd(m: LaunchMath): number {
  return floorEvents(m).reduce((s, e) => s + (e.kind === "harvest" ? e.volumeUsd : 0), 0);
}

/** Every visible chart string for launch `m` (tests scan these for length and banned words). */
export function storyChartStrings(m: LaunchMath): string[] {
  const end = storyFrame(m, STORY_POS_END);
  return [
    ILLUSTRATION,
    CHART_COPY.raised(m.raiseUsd),
    CHART_COPY.floorShare(Math.round(m.v * 100)),
    CHART_COPY.market,
    CHART_COPY.fees(pctOfRaise(m, m.split.creatorUsd), pctOfRaise(m, m.split.platformUsd)),
    CHART_COPY.floor,
    CHART_COPY.traded(storyTradedUsd(m)),
    CHART_COPY.closeUp,
    CHART_COPY.fromFees(end.feesPct ?? 0),
    CHART_COPY.peak(end.peak.value),
    CHART_COPY.arbLine,
    CHART_COPY.bounce,
    CHART_COPY.fromExits(end.exitsPct ?? 0),
    CHART_COPY.redeem(storyNetFinal(m)),
  ];
}

export { pctOfRaise };
