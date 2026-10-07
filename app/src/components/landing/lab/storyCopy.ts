import type { LaunchMath } from "@/lib/landing/sim/launch";
import { STAGES, storyFrame, type StageKey, type StoryFrame } from "@/lib/landing/sim/story";
import { formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";

/** Every visible sentence of the story lives here, so tests can scan it for overclaims. */

export const STORY_TITLE = "Follow your $100";
export const ILLUSTRATION = "Illustration";
/**
 * The scroll story's footnote: the made-up part, the stock price it holds still, and the fees the
 * sim leaves out (LP fees into the vault, the migration fee, the pool fee).
 */
export const storyFootnote = (symbol = "SPYx"): string =>
  `Made-up trades; ${symbol} price held flat. Fees simplified; the rest is SDK math.`;

export const floorSharePct = (m: LaunchMath): number => Math.round(m.v * 100);

/** `symbol` is the floor asset named at graduation (labels only; the math is the same for every asset). */
export function stageCaption(m: LaunchMath, key: StageKey, symbol = "SPYx"): string {
  switch (key) {
    case "presale":
      return "Buyers fill the curve. You buy $100 at the top.";
    case "graduation":
      return `Raise complete: ${floorSharePct(m)}% locks in ${symbol} as the floor.`;
    case "trading":
      return "Trading opens. A thin market swings hard.";
    case "selloff":
      return "Everyone sells. The price falls to the floor.";
    case "redeem":
      return `Burn tokens for your share of the floor, less ${m.exitFeePct}%.`;
  }
}

/** The redeem bar's split of $100 in whole cents: what the floor pays back and the rest. */
export function redeemCents(m: LaunchMath): { backCents: number; lostCents: number } {
  const backCents = Math.round(m.floorPer100Usd * 100);
  return { backCents, lostCents: 10_000 - backCents };
}

export const centsToUsd = (cents: number): string => formatUsdCents(cents / 100);

/** Peak of the illustrated path: the value at the end of trading. */
export function storyPeakValue(m: LaunchMath): number {
  return storyFrame(m, STAGES.find((s) => s.key === "trading")!.end).valueOf100;
}

export function storyChartLabel(m: LaunchMath): string {
  return `Illustration: your $100 rises to ${formatUsdWhole(storyPeakValue(m))} on paper, then falls to the floor, which pays back ${formatUsdCents(m.floorPer100Usd)}.`;
}

/** Scrubber value text: "Stage 3 of 5, Trading: your $100 is $312.40 on paper (illustration)." */
export function scrubberValueText(m: LaunchMath, f: StoryFrame): string {
  const s = STAGES[f.stageIndex]!;
  const head = `Stage ${f.stageIndex + 1} of ${STAGES.length}, ${s.label}`;
  if (f.stage === "redeem") return `${head}: the floor pays back ${formatUsdCents(m.floorPer100Usd)}.`;
  const tail = f.illustrative ? " (illustration)" : "";
  return `${head}: your $100 is ${formatUsdCents(f.valueOf100)} on paper${tail}.`;
}

