/*
 * Variant 35's token supply, drawn on the chart itself (no separate block): pure helpers for the
 * supply lane at the foot of the card (a step line at 100% from listing that steps down under each
 * burn), the burn markers on the floor line and their labels, and the third riding tag. Redeemed
 * tokens are burned, so supply only falls: −0.4% at the bounce's arbitrage redeem, −30% in the exits.
 * Honesty: burning 30% lifts the floor by under 1%, because the vault pays the redeemers out and keeps
 * only the 2% exit fee, so every burn label pairs the supply drop with its small floor step.
 */

import type { LaunchMath } from "@/lib/landing/sim/launch";
import { T_GRAD } from "@/lib/landing/sim/timeline";
import { formatPctChange, supplyAt, supplyBurns, type StoryFrame, type SupplyBurn } from "../shared";

/** The burn smaller than this share of supply gets the small marker and is labelled on its own beat only. */
export const SMALL_BURN = 0.05;

/** "69.7%": one decimal, so the 0.4% arbitrage burn shows; the untouched supply reads "100%". */
export const shareText = (share: number): string => (share >= 1 - 1e-9 ? "100%" : `${(share * 100).toFixed(1)}%`);

/** The supply's change since listing for the tag: "0%" until the first burn, then "−0.4%", "−30%". */
export const supplyPctText = (pct: number): string => (pct > -0.05 ? "0%" : formatPctChange(pct));

/** A floor step in percent: two decimals when tiny ("+0.01%"), otherwise one ("+0.9%"). */
export const floorStepText = (pct: number): string => `+${Math.abs(pct) < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}%`;

/** A burn's label, in two parts so phones can stack them: "−30% supply" and "floor +0.9%". */
export function burnLabel(b: SupplyBurn): { supply: string; floor: string } {
  return { supply: `${formatPctChange(b.supplyPct)} supply`, floor: `floor ${floorStepText(b.floorPct)}` };
}

/** The burns that have happened by the frame's time (none before listing). */
export function burnsSoFar(m: LaunchMath, frame: StoryFrame): readonly SupplyBurn[] {
  if (supplyAt(m, frame) === null) return [];
  return supplyBurns(m).filter((b) => frame.t >= b.t);
}

/**
 * The supply lane's step line, as (story time, share) corners: 100% from listing (graduation, where
 * the floor's foundation starts), an exact vertical riser at each burn so far, and the current share
 * at the head. Null before listing.
 */
export function supplyLane(m: LaunchMath, frame: StoryFrame): Array<[number, number]> | null {
  const now = supplyAt(m, frame);
  if (now === null) return null;
  const pts: Array<[number, number]> = [[T_GRAD, 1]];
  let share = 1;
  for (const b of burnsSoFar(m, frame)) {
    pts.push([b.t, share], [b.t, b.supplyAfter]);
    share = b.supplyAfter;
  }
  pts.push([Math.max(T_GRAD, frame.t), now.share]);
  return pts;
}
