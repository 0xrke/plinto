import type { LaunchMath } from "./launch";
import { paperValueOf100, presaleValueOf100 } from "./market";

/*
 * "Follow your $100": a 15-second story driven by one clock `t`. Every frame is a pure function of
 * (launch, t), so scrubbing backwards works and the same t always draws the same picture.
 * Only the trading path (trading + selloff) is made up: it follows fixed waypoints, never random
 * numbers, and the UI labels it as an illustration. Everything else is the launch math.
 * Ignored on purpose: LP and exit fees accruing into the vault (the real floor only grows), the DBC
 * 0.2% migration liquidity fee, the 1% pool fee and raw rounding.
 */

export type StageKey = "presale" | "graduation" | "trading" | "selloff" | "redeem";

export interface Stage {
  key: StageKey;
  label: string;
  /** Seconds. */
  start: number;
  end: number;
}

export const STORY_END = 15;

export const STAGES: readonly Stage[] = [
  { key: "presale", label: "Presale", start: 0, end: 3.5 },
  { key: "graduation", label: "Graduation", start: 3.5, end: 6 },
  { key: "trading", label: "Trading", start: 6, end: 10 },
  { key: "selloff", label: "Selloff", start: 10, end: 13 },
  { key: "redeem", label: "Redeem", start: 13, end: STORY_END },
];

/** Illustrative net buying during trading, as fractions of B = 0.4 × raise. */
export const TRADING_WAYPOINTS: readonly number[] = [0, 0.35, 0.25, 0.6, 0.5, 0.85, 1];
/** Illustrative selloff, as fractions of the way from B to the floor (−sellToFloorUsd). */
export const SELLOFF_WAYPOINTS: readonly number[] = [0, 0.45, 0.38, 0.8, 0.72, 1];

/** Peak illustrative net buying as a share of the raise. */
const PEAK_FLOW_SHARE = 0.4;
/** Calm y-axis top (your $100, USD). */
const Y_CALM = 120;
const Y_HEADROOM = 1.15;
const ZOOM_OUT_S = 0.6;
/** Graduation sub-windows, seconds from the story start. */
const SPLIT_WINDOW: readonly [number, number] = [3.5, 4.7];
const SLAB_WINDOW: readonly [number, number] = [4.7, 5.4];
const REDEEM_FILL_S = 0.8;
const MAX_PATH_POINTS = 120;

export interface StoryFrame {
  t: number;
  stage: StageKey;
  stageIndex: number;
  /** 0..1 within the current stage. */
  stageProgress: number;
  /** Presale counter, USD. */
  raisedUsd: number;
  /** The value line's head: your $100 in USD. */
  valueOf100: number;
  /** The value line from 0 to t, at most 120 points, strictly increasing in time. */
  path: Array<[t: number, value: number]>;
  /** Graduation split bar animation, 0..1. */
  splitProgress: number;
  /** Floor slab rise, 0..1. */
  floorSlabProgress: number;
  /** Redeem bar fill, 0..1. */
  redeemProgress: number;
  /** Top of the y domain (eased zoom-out in trading, then held). */
  yMax: number;
  /** True while the made-up trading path is on screen (trading, selloff). */
  illustrative: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clampT = (t: number) => Math.min(STORY_END, Math.max(0, Number.isFinite(t) ? t : 0));

/** Cubic ease-in-out on [0, 1]. */
export function easeInOut(p: number): number {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const windowProgress = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

/**
 * Index of the stage shown at `t`. A stage owns its end instant (start < t ≤ end; t = 0 is the
 * presale), so "jump to the end of a stage" still shows that stage.
 */
export function stageAt(t: number): number {
  const c = clampT(t);
  const i = STAGES.findIndex((s) => c <= s.end);
  return i < 0 ? STAGES.length - 1 : i;
}

/** Waypoint fraction at progress p ∈ [0, 1]: equal sub-durations, cubic in-out within each segment. */
function along(waypoints: readonly number[], p: number): number {
  const segments = waypoints.length - 1;
  const pos = clamp01(p) * segments;
  const i = Math.min(segments - 1, Math.floor(pos));
  const a = waypoints[i]!;
  const b = waypoints[i + 1]!;
  return a + (b - a) * easeInOut(pos - i);
}

const stageByKey = (key: StageKey) => STAGES.find((s) => s.key === key)!;

/**
 * Illustrative net USD into the pool after listing at story time t: 0 before trading, up through
 * B·TRADING_WAYPOINTS, then from B down to xF = −sellToFloorUsd, then xF. Every waypoint lies in
 * [0, 1], so the flow stays within [xF, B] and the value never drops below the floor.
 */
export function netFlowAt(m: LaunchMath, t: number): number {
  const c = clampT(t);
  const B = PEAK_FLOW_SHARE * m.raiseUsd;
  const xF = -m.sellToFloorUsd;
  const trading = stageByKey("trading");
  const selloff = stageByKey("selloff");
  if (c <= trading.start) return 0;
  if (c <= trading.end) return B * along(TRADING_WAYPOINTS, windowProgress(c, trading.start, trading.end));
  if (c <= selloff.end) return B + along(SELLOFF_WAYPOINTS, windowProgress(c, selloff.start, selloff.end)) * (xF - B);
  return xF;
}

/** The value line at t (no path, no zoom). */
function valueAt(m: LaunchMath, t: number): number {
  const c = clampT(t);
  const s = STAGES[stageAt(c)]!;
  switch (s.key) {
    case "presale":
      return presaleValueOf100(m, easeInOut(windowProgress(c, s.start, s.end)));
    case "graduation":
      return 100;
    case "trading":
    case "selloff": {
      // Exactly the floor at the end of the selloff (avoids a 1e-14 dip from the square).
      if (c >= s.end && s.key === "selloff") return m.floorPer100GrossUsd;
      return paperValueOf100(m, netFlowAt(m, c));
    }
    case "redeem":
      return m.floorPer100GrossUsd;
  }
}

/**
 * Top of the y domain: calm (120) through presale and graduation, then it zooms out to fit the
 * illustrated peak over the first 0.6 s of trading and stays there, so the finished frame shows the
 * whole rise and fall.
 */
function yMaxAt(m: LaunchMath, t: number): number {
  const peak = paperValueOf100(m, PEAK_FLOW_SHARE * m.raiseUsd);
  const zoomed = Math.max(Y_CALM, Y_HEADROOM * peak);
  const trading = stageByKey("trading");
  if (t <= trading.start) return Y_CALM;
  return Y_CALM + (zoomed - Y_CALM) * easeInOut((t - trading.start) / ZOOM_OUT_S);
}

/** The value line from 0 to t on a fixed time grid, ending exactly at (t, value). */
function pathTo(m: LaunchMath, t: number): Array<[number, number]> {
  const step = STORY_END / (MAX_PATH_POINTS - 1);
  const out: Array<[number, number]> = [];
  for (let i = 0; i * step < t - 1e-9; i++) out.push([i * step, valueAt(m, i * step)]);
  out.push([t, valueAt(m, t)]);
  return out;
}

export function storyFrame(m: LaunchMath, t: number): StoryFrame {
  const c = clampT(t);
  const stageIndex = stageAt(c);
  const s = STAGES[stageIndex]!;
  const presale = stageByKey("presale");
  const redeem = stageByKey("redeem");
  const valueOf100 = valueAt(m, c);
  return {
    t: c,
    stage: s.key,
    stageIndex,
    stageProgress: windowProgress(c, s.start, s.end),
    raisedUsd: m.raiseUsd * easeInOut(windowProgress(c, presale.start, presale.end)),
    valueOf100,
    path: pathTo(m, c),
    splitProgress: windowProgress(c, SPLIT_WINDOW[0], SPLIT_WINDOW[1]),
    floorSlabProgress: easeInOut(windowProgress(c, SLAB_WINDOW[0], SLAB_WINDOW[1])),
    redeemProgress: windowProgress(c, redeem.start, redeem.start + REDEEM_FILL_S),
    yMax: Math.max(yMaxAt(m, c), valueOf100),
    illustrative: s.key === "trading" || s.key === "selloff",
  };
}
