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
 * Tile values for a frame: your $100 now ("Redeemed" once the
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

import { applyFloorEvent, floorEvents } from "@/lib/landing/sim/floorPath";

/** One redemption that burns tokens: when, how much, and what it does to supply, vault and floor. */
export interface SupplyBurn {
  /** Story time (the chart's x). */
  t: number;
  /** Share of the then-outstanding supply redeemed and burned (0.004, 0.3). */
  share: number;
  /** Outstanding supply after the burn, as a share of listing supply. */
  supplyAfter: number;
  /** Supply change of this burn, percent (−0.4, −30). */
  supplyPct: number;
  /** Vault change of this burn, percent: the redeemers' payout leaves the vault. */
  vaultPct: number;
  /** Floor change of this burn, percent: only the exit fee stays, so it is small and positive. */
  floorPct: number;
}

const burnCache = new WeakMap<LaunchMath, readonly SupplyBurn[]>();

/**
 * The story's two burns (the bounce's arbitrage redeem and the holders' exits), with their effect on
 * supply, vault and floor. Burning 30% of supply lifts the floor by under 1%, because the vault pays
 * the redeemers out and keeps only the exit fee: show the burn with its small floor step, never as if
 * the burn alone pushed the floor up.
 */
export function supplyBurns(m: LaunchMath): readonly SupplyBurn[] {
  let burns = burnCache.get(m);
  if (!burns) {
    const out: SupplyBurn[] = [];
    let s = { vaultUsd: m.split.floorUsd, supplyShare: 1 };
    for (const e of floorEvents(m)) {
      const next = applyFloorEvent(m, s, e);
      if (e.kind === "redeem") {
        const floorBefore = s.vaultUsd / s.supplyShare;
        const floorAfter = next.vaultUsd / next.supplyShare;
        out.push({
          t: e.t,
          share: e.share,
          supplyAfter: next.supplyShare,
          supplyPct: (next.supplyShare / s.supplyShare - 1) * 100,
          vaultPct: (next.vaultUsd / s.vaultUsd - 1) * 100,
          floorPct: (floorAfter / floorBefore - 1) * 100,
        });
      }
      s = next;
    }
    burns = Object.freeze(out);
    burnCache.set(m, burns);
  }
  return burns;
}
