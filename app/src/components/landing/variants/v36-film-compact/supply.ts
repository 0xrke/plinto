import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS } from "@/lib/landing/sim/story";
import { formatPctChange, supplyAt, supplyBurns, type StoryFrame } from "../shared";

/*
 * Variant 36's token supply on the chart, as pure data (no React, no DOM): the supply lane under the
 * plot (a step line at 100% from listing that steps down at each burn), the burn markers on the floor
 * line, and the third riding tooltip. Burning 30% of supply lifts the floor by under 1% (the vault pays
 * the redeemers out and keeps only the exit fee), so every burn label pairs the supply drop with its
 * small floor step. Everything is a function of the frame: scrolling back removes what scrolling on drew.
 */

/** Trading opens at the start of the pump: the lane starts here, and nothing is drawn before it. */
export const LISTING_T = BEATS.find((b) => b.key === "pump")!.start;
const LISTING_I = BEATS.findIndex((b) => b.key === "pump");

/** A burn smaller than this share of supply gets the small marker (and its label only while latest). */
export const SMALL_BURN = 0.05;
/** Story time over which a marker and its label fade in after the burn. */
export const MARK_IN = 0.06;

/** Share as a percent with one decimal ("69.7%"), but a plain "100%" before anything burns. */
export function supplyText(share: number): string {
  return share >= 0.99995 ? "100%" : `${(share * 100).toFixed(1)}%`;
}

/** A floor step in percent: "+0.9%", and two decimals for a step too small for one ("+0.01%"). */
export function floorStepText(pct: number): string {
  return Math.abs(pct) >= 0.05 ? formatPctChange(pct) : `${pct < 0 ? "−" : "+"}${Math.abs(pct).toFixed(2)}%`;
}

export interface SupplyTag {
  /** Outstanding share of the listing supply, 0..1. */
  share: number;
  /** "69.7%". */
  value: string;
  /** Change since listing in percent (−30.3); 0 until something burns. */
  pct: number;
}

/** The third tooltip's numbers, from listing on; null before. */
export function supplyTag(m: LaunchMath, f: StoryFrame): SupplyTag | null {
  const s = supplyAt(m, f);
  if (s === null) return null;
  return { share: s.share, value: supplyText(s.share), pct: s.pct };
}

/**
 * The supply lane's step line as [story time, share] corners, from listing up to the head (f.t): 100%
 * from listing, stepping down at each burn already passed. Null before listing.
 */
export function supplyLane(m: LaunchMath, f: StoryFrame): Array<readonly [number, number]> | null {
  if (f.beatIndex < LISTING_I) return null;
  const end = Math.max(LISTING_T, f.t);
  const pts: Array<readonly [number, number]> = [[LISTING_T, 1]];
  let share = 1;
  for (const b of supplyBurns(m)) {
    if (b.t > f.t) break;
    pts.push([b.t, share], [b.t, b.supplyAfter]);
    share = b.supplyAfter;
  }
  pts.push([end, share]);
  return pts;
}

export interface BurnMark {
  t: number;
  /** The floor right after the burn (USD per $100): where the marker sits on the staircase. */
  floor: number;
  /** The small arbitrage-redeem burn (0.4%) gets a smaller marker. */
  small: boolean;
  /** "−30% supply" and "floor +0.9%": the supply drop always paired with the small floor step. */
  supplyText: string;
  floorText: string;
  /** The marker's fade-in. */
  opacity: number;
  /** The label's: the small burn's label shows only while it is the latest burn. */
  labelOpacity: number;
}

const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));

/** The burns already passed at this frame (a burn appears when f.t reaches its time and stays). */
export function burnMarks(m: LaunchMath, f: StoryFrame): BurnMark[] {
  if (f.beatIndex < LISTING_I) return [];
  const burns = supplyBurns(m);
  const out: BurnMark[] = [];
  burns.forEach((b, i) => {
    if (f.t < b.t) return;
    const e = f.events.find((x) => x.kind === "redeem" && Math.abs(x.t - b.t) < 1e-9);
    if (!e || e.kind !== "redeem") return;
    const small = b.share < SMALL_BURN;
    const opacity = ramp(f.t, b.t, b.t + MARK_IN);
    const next = burns[i + 1];
    // A later burn takes the small label's place (they would crowd); a big label stays.
    const handover = small && next ? 1 - ramp(f.t, next.t, next.t + MARK_IN) : 1;
    out.push({
      t: b.t,
      floor: e.to,
      small,
      supplyText: `${formatPctChange(b.supplyPct)} supply`,
      floorText: `floor ${floorStepText(b.floorPct)}`,
      opacity,
      labelOpacity: opacity * handover,
    });
  });
  return out;
}
