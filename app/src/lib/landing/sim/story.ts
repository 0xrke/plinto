import { floor100At, floorEvents, floorSteps } from "./floorPath";
import type { LaunchMath } from "./launch";
import { flowToValue, paperValueOf100 } from "./market";
import {
  BEAT_KEYS,
  BEAT_SPANS,
  BEAT_START,
  STORY_T_END,
  T_GRAD,
  along,
  beatEnd,
  easeInOut,
  knotTime,
  range,
  type BeatKey,
} from "./timeline";

/*
 * "Follow your $100" as eight scroll beats. A frame is a pure function of (launch, pos), with
 * pos ∈ [0, 8] = beat index + progress within the beat, so scrolling back draws the same picture.
 * A whole pos i > 0 is beat i − 1 finished (not beat i at its start), so a step's hold and its
 * reduced-motion still show that step's own beat.
 * Made up (and labelled "Illustration" in the UI): the trading path (pump, selloff, bounce, exits),
 * the traded volume and who redeems when. Real: the launch math, the floor's step sizes (LP fee
 * harvests and exit fees kept on redemptions, `floorPath.ts`) and the arbitrage line. Ignored: the
 * DBC 0.2% migration liquidity fee, the pool fee's effect on the price path and raw rounding; SPYx
 * is held flat.
 */

export { BEAT_KEYS, STORY_T_END, easeInOut, type BeatKey };

/** pos runs from 0 (start of the presale) to 8 (end of redeem). */
export const STORY_POS_END = 8;

/** Beats with their story-time windows (the steps beat has start = end: it only moves the camera). */
export const BEATS: ReadonlyArray<{ key: BeatKey; start: number; end: number }> = BEAT_KEYS.map((key) => ({
  key,
  start: BEAT_START[key],
  end: beatEnd(key),
}));

/** Illustrative net buying during the pump, as fractions of B = 0.4 × raise. */
export const PUMP_WAYPOINTS: readonly number[] = [0, 0.35, 0.25, 0.6, 0.5, 0.85, 1];
/** Illustrative selloff, as fractions of the way from B to the flow that puts the price on the floor. */
export const SELLOFF_WAYPOINTS: readonly number[] = [0, 0.45, 0.38, 0.8, 0.72, 1];
/** Illustrative dip under the arbitrage line, as a multiple of the floor at the bounce (F̂_b). */
export const BOUNCE_DIP = 0.955;
/**
 * Illustrative path after the bounce and its hold during redeem, multiples of F̂_b. The price drifts
 * back under the floor (but stays above the arbitrage line) and the holders redeem at the middle
 * knot, where redeeming pays more than selling (price < sellStopRatio × floor); it bounces once
 * more and settles just under the floor, where redeeming still beats selling.
 */
export const EXITS_WAYPOINTS: readonly number[] = [1.08, 1.03, 0.98, 1.02, 0.99];
/** Index of the knot where the holders redeem. */
export const EXITS_REDEEM_KNOT = 2;
export const REDEEM_HOLD = 0.99;

/** Bounce knots as multiples of F̂_b; the arbitrage and sell-stop knots come from the fee ratios. */
export function bounceWaypoints(m: LaunchMath): readonly number[] {
  return [1, 0.985, BOUNCE_DIP, m.arbLineRatio, m.sellStopRatio, 1.04, 1.08];
}
/** Index of the dip and arbitrage knots in `bounceWaypoints`. */
export const BOUNCE_DIP_KNOT = 2;
export const BOUNCE_ARB_KNOT = 3;
const BOUNCE_KNOTS = 7;

/** Peak illustrative net buying as a share of the raise. */
const PEAK_FLOW_SHARE = 0.4;
/** Calm y-axis top (your $100, USD). */
const Y_CALM = 120;
const Y_HEADROOM = 1.15;
/** Pump: the camera zooms out over this share of the beat. */
const ZOOM_OUT_P = 0.3;
/** Close-up band around the floor: [0.93 × F̂0, 1.10 × F̂(end)]. */
const BAND_LO = 0.93;
const BAND_HI = 1.1;
/** Split beat sub-windows (beat progress). */
const SPLIT_COLUMN: readonly [number, number] = [0, 0.55];
const FLOOR_REVEAL: readonly [number, number] = [0.45, 1];
const PRICE_FADE_TO = 0.4;
/** The value path's fixed time grid. */
const GRID_POINTS = 240;

export interface StoryFrame {
  pos: number;
  beat: BeatKey;
  beatIndex: number;
  /** 0..1 within the beat. */
  beatProgress: number;
  /** Story time; the x domain is [0, STORY_T_END]. */
  t: number;
  raisedUsd: number;
  /** The value line's head: your $100 in USD. */
  valueOf100: number;
  /** ≤ 240 grid points ∪ every knot and event time ≤ t ∪ {t}, strictly increasing in time. */
  path: Array<[t: number, v: number]>;
  /** 1, easing to 0.4 during redeem. */
  priceOpacity: number;
  /** Gross floor per $100; null before graduation. */
  floor100: number | null;
  /** floor100 × (1 − exit fee): what redeem pays. */
  floorNet100: number | null;
  /** Staircase vertices (floorPath.floorSteps). */
  floorSteps: Array<[number, number]>;
  /** 0..1 during split, then 1. */
  floorReveal: number;
  /** 0..1 split column animation. */
  splitProgress: number;
  /** arbLineRatio × floor100 from the bounce beat on, else null. */
  arbLine100: number | null;
  /** Floor events with e.t ≤ t: floor before and after, and the beat they fall in. */
  events: Array<{ t: number; kind: "harvest" | "redeem"; from: number; to: number; beat: BeatKey }>;
  /** Floor growth from LP fees up to the end of the selloff, in percent, once beat ≥ steps. */
  feesPct: number | null;
  /** The holders' redemption step in percent, once it has happened. */
  exitsPct: number | null;
  peak: { t: number; value: number };
  dip: { t: number; value: number } | null;
  /** Camera. */
  y: { min: number; max: number };
  /** 0 wide .. 1 close-up. */
  zoom: number;
  /** 0..1 during redeem. */
  redeemProgress: number;
  /** True during pump, selloff, bounce and exits (made-up trading path). */
  illustrative: boolean;
}

const clampT = (t: number) => Math.min(STORY_T_END, Math.max(0, Number.isFinite(t) ? t : 0));

interface StoryConstants {
  /** Floor at the end of the selloff (= the bounce's anchor). */
  floorAtBounce: number;
  /** Net flow that puts the price exactly on floorAtBounce. */
  selloffTargetFlow: number;
  peak: { t: number; value: number };
  wideMax: number;
  band: { min: number; max: number };
  bounce: readonly number[];
}

const constantsCache = new WeakMap<LaunchMath, StoryConstants>();

function storyConstants(m: LaunchMath): StoryConstants {
  const hit = constantsCache.get(m);
  if (hit) return hit;
  const floorAtBounce = floor100At(m, beatEnd("selloff"));
  const peakValue = paperValueOf100(m, PEAK_FLOW_SHARE * m.raiseUsd);
  const c: StoryConstants = {
    floorAtBounce,
    selloffTargetFlow: flowToValue(m, floorAtBounce),
    peak: { t: beatEnd("pump"), value: peakValue },
    wideMax: Math.max(Y_CALM, Y_HEADROOM * peakValue),
    band: { min: BAND_LO * m.floorPer100GrossUsd, max: BAND_HI * floor100At(m, STORY_T_END) },
    bounce: bounceWaypoints(m),
  };
  constantsCache.set(m, c);
  return c;
}

/** Close-up y band: [0.93 × F̂0, 1.10 × F̂(end)]. */
export function storyBand(m: LaunchMath): { min: number; max: number } {
  return { ...storyConstants(m).band };
}

/** Redeem payout per $100 at the end of the story: floor100At(end) × (1 − exit fee). */
export function storyNetFinal(m: LaunchMath): number {
  return floor100At(m, STORY_T_END) * (1 - m.exitFeePct / 100);
}

/** Beat that owns story time t (a beat owns its end instant; the zero-span steps beat owns none). */
function beatAtTime(t: number): BeatKey {
  for (const key of BEAT_KEYS) if (BEAT_SPANS[key] > 0 && t <= beatEnd(key)) return key;
  return "redeem";
}

/**
 * Illustrative net USD into the pool at story time t: 0 before the pump, B·PUMP_WAYPOINTS during it,
 * then from B down to the flow that lands on the floor at the end of the selloff, held after.
 */
export function netFlowAt(m: LaunchMath, t: number): number {
  const c = clampT(t);
  const B = PEAK_FLOW_SHARE * m.raiseUsd;
  const xF = storyConstants(m).selloffTargetFlow;
  if (c <= BEAT_START.pump) return 0;
  if (c <= beatEnd("pump")) return B * along(PUMP_WAYPOINTS, range(c, BEAT_START.pump, beatEnd("pump")));
  if (c <= beatEnd("selloff")) return B + along(SELLOFF_WAYPOINTS, range(c, BEAT_START.selloff, beatEnd("selloff"))) * (xF - B);
  return xF;
}

/** The value line at story time t. */
export function storyValueAt(m: LaunchMath, t: number): number {
  const c = clampT(t);
  const sc = storyConstants(m);
  const key = beatAtTime(c);
  const p = range(c, BEAT_START[key], beatEnd(key));
  switch (key) {
    case "presale": // You paid $100: it is worth $100 until trading opens.
    case "split":
      return 100;
    case "pump":
      return paperValueOf100(m, netFlowAt(m, c));
    case "selloff":
      // Exactly the floor at the end of the selloff (avoids a 1e-14 miss from the square root).
      return p >= 1 ? sc.floorAtBounce : paperValueOf100(m, netFlowAt(m, c));
    case "bounce":
      return sc.floorAtBounce * along(sc.bounce, p);
    case "exits":
      return sc.floorAtBounce * along(EXITS_WAYPOINTS, p);
    default:
      return sc.floorAtBounce * REDEEM_HOLD;
  }
}

/** Every knot and event time of the story (sorted, unique). */
function knotTimes(m: LaunchMath): number[] {
  const out: number[] = [];
  for (const key of BEAT_KEYS) out.push(BEAT_START[key], beatEnd(key));
  PUMP_WAYPOINTS.forEach((_, i) => out.push(knotTime("pump", PUMP_WAYPOINTS.length, i)));
  SELLOFF_WAYPOINTS.forEach((_, i) => out.push(knotTime("selloff", SELLOFF_WAYPOINTS.length, i)));
  for (let i = 0; i < BOUNCE_KNOTS; i++) out.push(knotTime("bounce", BOUNCE_KNOTS, i));
  EXITS_WAYPOINTS.forEach((_, i) => out.push(knotTime("exits", EXITS_WAYPOINTS.length, i)));
  for (const e of floorEvents(m)) out.push(e.t);
  return out;
}

function pathTo(m: LaunchMath, t: number): Array<[number, number]> {
  const step = STORY_T_END / (GRID_POINTS - 1);
  const times: number[] = [];
  for (let i = 0; i < GRID_POINTS && i * step < t - 1e-9; i++) times.push(i * step);
  for (const k of knotTimes(m)) if (k < t - 1e-9) times.push(k);
  times.sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  let last = -Infinity;
  for (const x of times) {
    if (x - last <= 1e-9) continue;
    out.push([x, storyValueAt(m, x)]);
    last = x;
  }
  out.push([t, storyValueAt(m, t)]);
  return out;
}

function camera(m: LaunchMath, beatIndex: number, p: number): { y: { min: number; max: number }; zoom: number } {
  const sc = storyConstants(m);
  const beat = BEAT_KEYS[beatIndex]!;
  if (beatIndex <= 1) return { y: { min: 0, max: Y_CALM }, zoom: 0 };
  if (beat === "pump") return { y: { min: 0, max: Y_CALM + (sc.wideMax - Y_CALM) * easeInOut(range(p, 0, ZOOM_OUT_P)) }, zoom: 0 };
  if (beat === "selloff") return { y: { min: 0, max: sc.wideMax }, zoom: 0 };
  if (beat === "steps") {
    const zoom = easeInOut(p);
    // Lerp written so zoom = 1 lands exactly on the band.
    return { y: { min: sc.band.min * zoom, max: sc.wideMax * (1 - zoom) + sc.band.max * zoom }, zoom };
  }
  return { y: { ...sc.band }, zoom: 1 };
}

/**
 * The frame at scroll position pos ∈ [0, 8] (clamped): beat index + progress within the beat. A whole
 * pos i > 0 is beat i − 1 at progress 1 (the same story time as beat i at 0, so frames stay continuous).
 */
export function storyFrame(m: LaunchMath, pos: number): StoryFrame {
  const cp = Math.min(STORY_POS_END, Math.max(0, Number.isFinite(pos) ? pos : 0));
  const beatIndex = cp <= 0 ? 0 : Math.min(BEAT_KEYS.length - 1, Math.ceil(cp) - 1);
  const beatProgress = cp - beatIndex;
  const beat = BEAT_KEYS[beatIndex]!;
  const t = clampT(BEAT_START[beat] + BEAT_SPANS[beat] * beatProgress);
  const sc = storyConstants(m);
  const f = m.exitFeePct / 100;

  const valueOf100 = storyValueAt(m, t);
  const floor100 = t >= T_GRAD ? floor100At(m, t) : null;

  const events: StoryFrame["events"] = [];
  let before = m.floorPer100GrossUsd;
  for (const e of floorEvents(m)) {
    const after = floor100At(m, e.t);
    if (e.t <= t) events.push({ t: e.t, kind: e.kind, from: before, to: after, beat: beatAtTime(e.t) });
    before = after;
  }
  const holders = events.find((e) => e.kind === "redeem" && e.beat === "exits");

  const splitIndex = BEAT_KEYS.indexOf("split");
  const dipT = knotTime("bounce", BOUNCE_KNOTS, BOUNCE_DIP_KNOT);
  const redeemIndex = BEAT_KEYS.indexOf("redeem");
  const redeemProgress = beatIndex === redeemIndex ? beatProgress : 0;
  const cam = camera(m, beatIndex, beatProgress);

  return {
    pos: cp,
    beat,
    beatIndex,
    beatProgress,
    t,
    raisedUsd: m.raiseUsd * easeInOut(range(t, BEAT_START.presale, beatEnd("presale"))),
    valueOf100,
    path: pathTo(m, t),
    priceOpacity: 1 - (1 - PRICE_FADE_TO) * easeInOut(redeemProgress),
    floor100,
    floorNet100: floor100 === null ? null : floor100 * (1 - f),
    floorSteps: floorSteps(m, t),
    floorReveal: beatIndex < splitIndex ? 0 : beatIndex > splitIndex ? 1 : easeInOut(range(beatProgress, FLOOR_REVEAL[0], FLOOR_REVEAL[1])),
    splitProgress: beatIndex < splitIndex ? 0 : beatIndex > splitIndex ? 1 : range(beatProgress, SPLIT_COLUMN[0], SPLIT_COLUMN[1]),
    arbLine100: beatIndex >= BEAT_KEYS.indexOf("bounce") && floor100 !== null ? m.arbLineRatio * floor100 : null,
    events,
    feesPct: beatIndex >= BEAT_KEYS.indexOf("steps") ? (sc.floorAtBounce / m.floorPer100GrossUsd - 1) * 100 : null,
    exitsPct: holders ? (holders.to / holders.from - 1) * 100 : null,
    peak: { ...sc.peak },
    dip: t >= dipT - 1e-9 ? { t: dipT, value: BOUNCE_DIP * sc.floorAtBounce } : null,
    y: { min: cam.y.min, max: Math.max(cam.y.max, beatIndex < 4 ? valueOf100 : 0) },
    zoom: cam.zoom,
    redeemProgress,
    illustrative: beat === "pump" || beat === "selloff" || beat === "bounce" || beat === "exits",
  };
}
