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

import type { LaunchMath } from "@/lib/landing/sim/launch";
import { storyFrame } from "@/lib/landing/sim/story";

/** Suffix for the change since the market opened: "+4.8% since listing". */
export const SINCE_LISTING = "since listing";

/** The story position where trading opens (start of the pump beat): the listing baseline. */
const LISTING_POS = 2;

const listingCache = new WeakMap<LaunchMath, { now: number; floor: number }>();

/** Your $100 and the net floor per $100 at the moment the market opens. */
export function listingBaseline(m: LaunchMath): { now: number; floor: number } {
  let base = listingCache.get(m);
  if (!base) {
    const f = storyFrame(m, LISTING_POS);
    base = { now: f.valueOf100, floor: f.floorNet100 ?? m.floorPer100Usd };
    listingCache.set(m, base);
  }
  return base;
}

/**
 * How far the price (your $100) and the floor have moved since listing, in percent. Both are null
 * before trading opens; the price is null once your $100 is redeemed (the tile then says "Redeemed").
 */
export function sinceListing(m: LaunchMath, frame: StoryFrame): { now: number | null; floor: number | null } {
  if (frame.beatIndex < LISTING_POS || frame.floorNet100 === null) return { now: null, floor: null };
  const base = listingBaseline(m);
  const now = frame.redeemProgress >= 1 ? null : (frame.valueOf100 / base.now - 1) * 100;
  return { now, floor: (frame.floorNet100 / base.floor - 1) * 100 };
}

/**
 * A signed percent change: "+4.8%", "−61%", "+300%". One decimal below 10%, whole numbers above;
 * a true minus sign; "0.0%" when it rounds to zero.
 */
export function formatPctChange(pct: number): string {
  const abs = Math.abs(pct);
  const text = abs < 10 ? abs.toFixed(1) : Math.round(abs).toFixed(0);
  if (Number(text) === 0) return "0.0%";
  return `${pct > 0 ? "+" : "−"}${text}%`;
}

import { floorStateAt } from "@/lib/landing/sim/floorPath";

/** Label for the outstanding token supply (variant 18's ledger row). */
export const TILE_SUPPLY = "Token supply";

/**
 * Token supply still outstanding, as a share of the supply at listing (1 = 100%), and its change in
 * percent. Redemptions burn tokens, so it only ever falls: by 0.4% at the bounce's arbitrage redeem
 * and by 30% when holders redeem in the exits beat. Null before trading opens, like sinceListing.
 */
export function supplyAt(m: LaunchMath, frame: StoryFrame): { share: number; pct: number } | null {
  if (frame.beatIndex < LISTING_POS) return null;
  const { supplyShare } = floorStateAt(m, frame.t);
  return { share: supplyShare, pct: (supplyShare - 1) * 100 };
}
