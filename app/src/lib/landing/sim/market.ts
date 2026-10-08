import type { LaunchMath } from "./launch";

/*
 * "Your $100" after listing. You hold 100 / p1 tokens, so at listing the paper value is exactly $100.
 * (On the flat curve presale buyers paid at most p1, so valuing the position at p1 is conservative.)
 * The pool is DAMM v2 full range, i.e. constant product: with x USD of net buying (x < 0 is selling)
 * the pool quote is Q + x and the price is p1·(1 + x/Q)². The 1% pool fee is ignored, as in
 * `priceImpactPct` (math.ts) and the create page's `priceMoveOnBuy`.
 */

function assertFlow(m: LaunchMath, x: number): void {
  if (!(Number.isFinite(x) && x > -m.poolUsd)) throw new RangeError("net flow must be finite and above -pool quote");
}

/** Paper value of $100 bought at listing after `x` USD of net flow: `100(1 + x/Q)²`. */
export function paperValueOf100(m: LaunchMath, x: number): number {
  assertFlow(m, x);
  const g = 1 + x / m.poolUsd;
  return 100 * g * g;
}

/**
 * Net flow that puts "your $100" at `value100`, the inverse of `paperValueOf100`:
 * `Q(√(value100/100) − 1)`. `−sellToFloorUsd` is `flowToValue(m, floorPer100GrossUsd)`.
 */
export function flowToValue(m: LaunchMath, value100: number): number {
  if (!(Number.isFinite(value100) && value100 > 0)) throw new RangeError("value100 must be finite and positive");
  return m.poolUsd * (Math.sqrt(value100 / 100) - 1);
}

/** Relative price move after `x` USD of net flow: `(1 + x/Q)² − 1` (= priceImpactPct(x, Q) / 100 for x ≥ 0). */
export function priceMove(m: LaunchMath, x: number): number {
  return paperValueOf100(m, x) / 100 - 1;
}

/**
 * Value at the presale's current price of the tokens that will be "your $100" at listing:
 * `100 p(f) / p1`, with the single-segment DBC curve `p(f) = p0(1 + (√r − 1)f)²` and p1 = r·p0,
 * so `100(1 + (√r − 1)f)² / r`. `f` = share of the raise filled, clamped to [0, 1].
 */
export function presaleValueOf100(m: LaunchMath, f: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
  const g = 1 + (Math.sqrt(m.r) - 1) * p;
  return (100 * g * g) / m.r;
}

/*
 * Stops of the sandbox's "Trading after listing" slider. Selling stops at the floor: once the
 * price is under it, holders redeem instead of selling into the pool, so a lower pool price is not
 * a holder's outcome. The sell stops are shares of `sellToFloorUsd` (the leftmost stop lands exactly
 * on the floor at every floor share); the buy stops are dollars for a $10,000 raise.
 */
export const SELL_STOP_SHARES: readonly number[] = [1, 0.75, 0.5, 0.25];
export const BUY_STOPS_USD: readonly number[] = [0, 500, 1000, 2000];
export const FLOW_STOP_COUNT = SELL_STOP_SHARES.length + BUY_STOPS_USD.length;
/** +$1,000. */
export const DEFAULT_FLOW_INDEX = 6;
/** The leftmost stop: sold down to the floor. */
export const FLOOR_FLOW_INDEX = 0;

/** Net flow at slider stop `index`: −share × sellToFloorUsd, or a buy stop scaled to the raise (× T / $10,000). */
export function flowUsdAt(m: LaunchMath, index: number): number {
  const i = Math.min(FLOW_STOP_COUNT - 1, Math.max(0, Math.round(index)));
  if (i < SELL_STOP_SHARES.length) return -SELL_STOP_SHARES[i]! * m.sellToFloorUsd;
  return (BUY_STOPS_USD[i - SELL_STOP_SHARES.length]! * m.raiseUsd) / 10_000;
}
