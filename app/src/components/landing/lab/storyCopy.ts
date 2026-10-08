import type { LaunchMath } from "@/lib/landing/sim/launch";
import { floorEvents } from "@/lib/landing/sim/floorPath";
import { BEAT_KEYS, STORY_POS_END, storyFrame, storyNetFinal, type BeatKey } from "@/lib/landing/sim/story";
import { formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";
import { formatUsdCompact, storyTradedUsd } from "./storyChartCopy";

/**
 * Every visible sentence of the scroll story (outside the chart) lives here, so tests can scan it
 * for length and overclaims. Captions: at most 7 words and one number each.
 */

export const STORY_TITLE = "Follow your $100";
export const STORY_FOOTNOTE = "Made-up trades. Real fee math. SPYx flat.";
export const STORY_HONESTY = "The floor protects from zero, not from loss.";

export const BEAT_LABELS: Readonly<Record<BeatKey, string>> = {
  presale: "Presale",
  split: "Split",
  pump: "Pump",
  selloff: "Selloff",
  steps: "Steps",
  bounce: "Bounce",
  exits: "Exits",
  redeem: "Redeem",
};

/** Scroll runway per beat, in svh: how long the step stays in the reading flow. */
export const BEAT_RUNWAY_SVH: Readonly<Record<BeatKey, number>> = {
  presale: 60,
  split: 70,
  pump: 80,
  selloff: 70,
  steps: 90,
  bounce: 90,
  exits: 70,
  redeem: 70,
};

export const TILE_NOW = "Your $100 now";
export const TILE_FLOOR = "Floor pays back";
export const TILE_REDEEMED = "Redeemed";

export const floorSharePct = (m: LaunchMath): number => Math.round(m.v * 100);

/** "Step 3 of 8: Pump". */
export const railLabel = (i: number): string => `Step ${i + 1} of ${BEAT_KEYS.length}: ${BEAT_LABELS[BEAT_KEYS[i]!]}`;

/** "3/8 · Pump" (the phone rail's status). */
export const railStatus = (i: number): string => `${i + 1}/${BEAT_KEYS.length} · ${BEAT_LABELS[BEAT_KEYS[i]!]}`;

export function beatCaption(m: LaunchMath, key: BeatKey): string {
  switch (key) {
    case "presale":
      return "You buy $100 in the presale.";
    case "split":
      return `${floorSharePct(m)}% of the raise becomes the floor.`;
    case "pump":
      return "Trading opens. Your $100 runs up.";
    case "selloff":
      return "Hype fades. Price falls to the floor.";
    case "steps":
      return "Zoom in: the floor climbs in steps.";
    case "bounce":
      return "Below the arbitrage line, buy-and-redeem pays.";
    case "exits":
      return `Every redemption leaves ${m.exitFeePct}% in the vault.`;
    case "redeem":
      return `Redeem now: ${formatUsdCents(storyNetFinal(m))} back, not zero.`;
  }
}


const numbersCache = new WeakMap<LaunchMath, StoryNumbers>();

type StoryNumbers = ReturnType<typeof computeStoryNumbers>;

/** Numbers behind the screen-reader lines, all from the launch math and the floor schedule (cached per launch). */
export function storyNumbers(m: LaunchMath): StoryNumbers {
  let n = numbersCache.get(m);
  if (!n) {
    n = computeStoryNumbers(m);
    numbersCache.set(m, n);
  }
  return n;
}

function computeStoryNumbers(m: LaunchMath) {
  const events = floorEvents(m);
  const end = storyFrame(m, STORY_POS_END);
  const redeems = events.filter((e) => e.kind === "redeem");
  const holders = redeems[redeems.length - 1];
  return {
    vaultPerTradePct: (m.lpVaultPerVolume * 100).toFixed(2),
    feesPct: (end.feesPct ?? 0).toFixed(1),
    tradedUsd: storyTradedUsd(m),
    arbLinePct: Math.round(m.arbLineRatio * 100),
    sellStopPct: Math.round(m.sellStopRatio * 100),
    holdersSharePct: holders && holders.kind === "redeem" ? Math.round(holders.share * 100) : 0,
    exitsPct: (end.exitsPct ?? 0).toFixed(1),
    peakUsd: end.peak.value,
    net: storyNetFinal(m),
  };
}

/** One screen-reader line per beat, with the numbers the chart shows. */
export function beatSrText(m: LaunchMath, key: BeatKey): string {
  const n = storyNumbers(m);
  switch (key) {
    case "presale":
      return `The presale raises ${formatUsdWhole(m.raiseUsd)} in total.`;
    case "split":
      return `${floorSharePct(m)}% of the raise buys SPYx for the floor vault, which pays back ${formatUsdCents(m.floorPer100Usd)} per $100 at listing.`;
    case "pump":
      return `Illustration: your $100 rises to ${formatUsdWhole(n.peakUsd)} on paper.`;
    case "selloff":
      return "Illustration: the price falls back to the floor.";
    case "steps":
      return `${n.vaultPerTradePct}% of every trade reaches the vault at each fee harvest: +${n.feesPct}% after ${formatUsdCompact(n.tradedUsd)} traded.`;
    case "bounce":
      return `Below about ${n.arbLinePct}% of the floor, buying in the pool and redeeming pays, before price impact and costs.`;
    case "exits":
      return `Under about ${n.sellStopPct}% of the floor, redeeming pays more than selling: ${n.holdersSharePct}% of supply redeems, and the ${m.exitFeePct}% exit fee kept in the vault lifts the floor ${n.exitsPct}%.`;
    case "redeem":
      return `Redeem pays ${formatUsdCents(n.net)} per $100; the price can stay below what you paid.`;
  }
}

/** Every visible prose string of the story outside the chart (rail labels and tiles aside). */
export function storyProse(m: LaunchMath): string[] {
  return [STORY_TITLE, ...BEAT_KEYS.map((k) => beatCaption(m, k)), STORY_FOOTNOTE, STORY_HONESTY];
}
