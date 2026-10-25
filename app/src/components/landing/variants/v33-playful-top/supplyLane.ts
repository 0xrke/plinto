import type { LaunchMath } from "@/lib/landing/sim/launch";
import { formatPctChange, supplyAt, supplyBurns, type StoryFrame, type SupplyBurn } from "../shared";
import { T_LISTING } from "./scene";

/*
 * Variant 33: the token supply on the chart, as pure data. A thin lane at the bottom of the midnight
 * card (a trading chart's volume pane) with its own 0–100% scale and the chart's x axis: supply sits
 * at 100% from listing and steps down at each redemption that burns tokens. Each burn also gets a
 * marker on the floor line, labelled with the supply drop and the small floor step it causes.
 * Honesty: burning 30% lifts the floor by under 1%, because the vault pays the redeemers out and
 * keeps only the exit fee, so the label always pairs the two numbers.
 */

/** The lane's name, and its one tick (the top of its 0–100% scale). */
export const SUPPLY_LANE_LABEL = "Supply";
export const SUPPLY_LANE_TOP = "100%";

/** A burn smaller than this share of supply is "tiny": a smaller marker, labelled only on its beat. */
export const TINY_BURN_SHARE = 0.05;

export const isTinyBurn = (b: SupplyBurn): boolean => b.share < TINY_BURN_SHARE;

/** Floor change of a burn: one decimal, or two when it rounds to zero at one (+0.008% → "+0.01%"). */
export function burnFloorText(pct: number): string {
  const one = formatPctChange(pct);
  if (one !== "0.0%") return one;
  const two = Math.abs(pct).toFixed(2);
  if (Number(two) === 0) return "0.0%";
  return `${pct > 0 ? "+" : "−"}${two}%`;
}

/** "−30% supply → floor +0.9%": the supply drop paired with the floor step it causes. */
export function burnLabel(b: SupplyBurn): string {
  return `${formatPctChange(b.supplyPct)} supply → floor ${burnFloorText(b.floorPct)}`;
}

/** The burns that have happened by this frame (none before listing); scrolling back removes them. */
export function burnsSoFar(m: LaunchMath, f: StoryFrame): SupplyBurn[] {
  if (supplyAt(m, f) === null) return [];
  return supplyBurns(m).filter((b) => b.t <= f.t + 1e-9);
}

/**
 * The lane's step line as (t, share) vertices, from listing to the frame's time: flat at 1, a riser
 * at each burn so far. Null before listing (nothing is drawn).
 */
export function laneSteps(m: LaunchMath, f: StoryFrame): Array<[number, number]> | null {
  const now = supplyAt(m, f);
  if (now === null) return null;
  const pts: Array<[number, number]> = [[T_LISTING, 1]];
  let share = 1;
  for (const b of burnsSoFar(m, f)) {
    pts.push([b.t, share], [b.t, b.supplyAfter]);
    share = b.supplyAfter;
  }
  pts.push([Math.max(T_LISTING, f.t), now.share]);
  return pts;
}

/** The floor value (per $100) right after time t on a staircase: the last vertex at or before t. */
export function floorAfter(steps: ReadonlyArray<readonly [number, number]>, t: number): number | null {
  let v: number | null = null;
  for (const [st, sv] of steps) {
    if (st > t + 1e-9) break;
    v = sv;
  }
  return v;
}
