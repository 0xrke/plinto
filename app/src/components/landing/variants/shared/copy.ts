/*
 * Every caption and label a variant may show, re-exported from the landing's story copy so all ten
 * variants say the same thing (captions: at most 7 words). Pure: safe anywhere.
 */
export {
  BEAT_LABELS,
  BEAT_RUNWAY_SVH,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  TILE_FLOOR,
  TILE_NOW,
  TILE_REDEEMED,
  beatCaption,
  beatSrText,
  floorSharePct,
  railLabel,
  railStatus,
  storyNumbers,
  storyProse,
} from "@/components/landing/lab/storyCopy";
export { CHART_COPY, ILLUSTRATION, formatUsdCompact, storyChartStrings, storyTradedUsd } from "@/components/landing/lab/storyChartCopy";
export { formatMultiple, formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";

import { formatUsdCents } from "@/lib/landing/sim/format";
import type { StoryFrame } from "@/lib/landing/sim/story";
import { TILE_REDEEMED } from "@/components/landing/lab/storyCopy";

/** Label for a close-up drawn at true scale ("Close-up · real scale"). */
export const REAL_SCALE_LABEL = "Close-up · real scale";
/** Label for any view that exaggerates the floor steps: "Steps magnified 20×". Never magnify silently. */
export const magnifiedLabel = (factor: number): string => `Steps magnified ${Math.round(factor)}×`;

/** The floor value shows once the split's floor reveal is past halfway (same rule as the landing tiles). */
const FLOOR_SHOWN_AT = 0.5;

/**
 * Tile values for a frame, same as the landing's StoryTiles: your $100 now ("Redeemed" once the
 * redeem beat finishes) and what the floor pays back net of the exit fee ("—" before the split).
 */
export function tileValues(frame: StoryFrame): { now: string; floor: string } {
  const now = frame.redeemProgress >= 1 ? TILE_REDEEMED : formatUsdCents(frame.valueOf100);
  const floor = frame.floorNet100 !== null && frame.floorReveal > FLOOR_SHOWN_AT ? formatUsdCents(frame.floorNet100) : "—";
  return { now, floor };
}
