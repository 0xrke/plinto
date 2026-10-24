import { BEAT_KEYS, BEAT_START, STORY_T_END, beatEnd } from "@/lib/landing/sim/timeline";
import type { StoryFrame } from "../shared";

/*
 * Variant 23 (combo on v20). Copied from v20-playful-site/scene.ts; adds the raise column's geometry
 * (pixel box and segments) for the split beat.
 *
 * Pure geometry for the playful scene: pixel scales, the trampoline net's sag and the ball's squash. Everything is a function of the frame and the measured stage size, so scrolling back
 * draws the same picture. The ball's *bottom* touches the price (its contact point), so it rests on
 * the floor platforms and dents the net at exactly the drawn value.
 */

/** Story time domain: [0, STORY_T_END]. */
export const T_END = STORY_T_END;
/** Story time at which the bounce beat starts. */
export const T_BOUNCE = BEAT_START.bounce;
/** End of the split beat: the presale ledge ends here. */
export const T_LISTING = beatEnd("split");
/** End of the selloff: the price has met the floor; the close-up trail starts here. */
export const T_SELLOFF_END = beatEnd("selloff");
/** Time room kept ahead of the ball, so the scene is never half empty (a side-scroller camera). */
const X_LEAD = 1.6;
const X_MIN_SPAN = 4.8;

/** Right end of the visible time window: follows the ball with some lead, never past the story's end. */
export function xMaxFor(f: StoryFrame): number {
  return Math.min(T_END, Math.max(X_MIN_SPAN, f.t + X_LEAD));
}

export interface Plot {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  r: number;
}

/** Plot box inside the midnight card: the top keeps the corner chips (Illustration, scale) clear. */
export function plotFor(w: number, h: number, foot = 14): Plot {
  const small = w < 480;
  const r = small ? 10 : 13;
  return { w, h, left: 16, right: w - (small ? 20 : 28), top: r * 2 + (small ? 40 : 46), bottom: h - foot, r };
}

/** Beat start times inside (0, xMax): the card's vertical dividers, which slide with the camera. */
export function beatDividers(xMax: number): number[] {
  return [...new Set(BEAT_KEYS.map((k) => BEAT_START[k]))].filter((t) => t > 1e-9 && t < xMax - 1e-9);
}

export interface Scales {
  x: (t: number) => number;
  y: (v: number) => number;
}

export function scalesFor(p: Plot, f: StoryFrame): Scales {
  const span = Math.max(1e-9, f.y.max - f.y.min);
  const xMax = xMaxFor(f);
  return {
    x: (t) => p.left + (Math.min(xMax, Math.max(0, t)) / xMax) * (p.right - p.left),
    y: (v) => p.bottom - ((v - f.y.min) / span) * (p.bottom - p.top),
  };
}

/** How hard the ball presses into the net, 0..1 (1 at the drawn dip, 0.955 F vs the 0.9702 F line). */
export function netPress(f: StoryFrame): number {
  if (f.arbLine100 === null || f.floor100 === null) return 0;
  const depth = f.arbLine100 - f.valueOf100;
  if (depth <= 0) return 0;
  const full = f.arbLine100 - 0.955 * f.floor100;
  return Math.min(1, depth / Math.max(1e-9, full));
}

/**
 * The net as an SVG path from post to post. Taut at the arbitrage line; when the ball sits below it
 * the net dips through the ball's contact point (a soft U), so the drawn dent is the real distance.
 */
export function netPath(x0: number, x1: number, yLine: number, ball: { x: number; y: number } | null): string {
  if (!ball || ball.y <= yLine + 0.5 || ball.x <= x0 || ball.x >= x1) return `M${x0},${yLine} L${x1},${yLine}`;
  // Each half eases from its post into the contact point; control points stay between post and ball.
  const kl = Math.min(48, (ball.x - x0) * 0.45);
  const kr = Math.min(48, (x1 - ball.x) * 0.45);
  const f = (n: number) => n.toFixed(1);
  return `M${f(x0)},${f(yLine)} C${f(x0 + (ball.x - x0) * 0.35)},${f(yLine)} ${f(ball.x - kl)},${f(ball.y)} ${f(ball.x)},${f(ball.y)} C${f(ball.x + kr)},${f(ball.y)} ${f(x1 - (x1 - ball.x) * 0.35)},${f(yLine)} ${f(x1)},${f(yLine)}`;
}

/** Squash on impact (scaleX ≥ 1, scaleY ≤ 1) and a little stretch while flying fast. */
export function squash(f: StoryFrame, press: number, slopePx: number): { sx: number; sy: number } {
  if (press > 0) return { sx: 1 + 0.22 * press, sy: 1 - 0.24 * press };
  const s = Math.min(1, Math.abs(slopePx) / 6) * (f.beat === "pump" || f.beat === "selloff" ? 1 : 0.4);
  return { sx: 1 - 0.08 * s, sy: 1 + 0.1 * s };
}

/** Vertical speed of the head in px per sample (positive = going up on screen), from the last path points. */
export function headSlope(f: StoryFrame, s: Scales): number {
  const n = f.path.length;
  if (n < 2) return 0;
  const a = f.path[Math.max(0, n - 3)]!;
  const b = f.path[n - 1]!;
  const dx = s.x(b[0]) - s.x(a[0]);
  if (dx <= 0.01) return 0;
  return (s.y(a[1]) - s.y(b[1])) / Math.max(1, dx / 4);
}

/** Polyline for a list of (t, v) points. */
export function polyline(points: ReadonlyArray<readonly [number, number]>, s: Scales): string {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const [t, v] = points[i]!;
    d += `${i === 0 ? "M" : "L"}${s.x(t).toFixed(1)},${s.y(v).toFixed(1)}`;
  }
  return d;
}

/** The staircase's flat treads: [t0, t1, v] for every horizontal run of floorSteps (flat runs merged). */
export function treads(steps: ReadonlyArray<readonly [number, number]>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i + 1 < steps.length; i++) {
    const [t0, v0] = steps[i]!;
    const [t1] = steps[i + 1]!;
    if (t1 - t0 <= 1e-9) continue;
    const prev = out[out.length - 1];
    // Points on a flat run (no riser between them) extend the previous tread instead of starting a new one.
    if (prev && Math.abs(prev[2] - v0) <= 1e-9 * Math.max(1, Math.abs(v0)) && Math.abs(prev[1] - t0) <= 1e-9) prev[1] = t1;
    else out.push([t0, t1, v0]);
  }
  return out;
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The a..b window of x mapped to 0..1. */
export const ramp = (x: number, a: number, b: number) => (b <= a ? (x >= b ? 1 : 0) : clamp01((x - a) / (b - a)));

/** 2-4 round $ ticks inside [min, max] (for the close-up's scale), with a matching label format. */
export function dollarTicks(min: number, max: number): { values: number[]; label: (v: number) => string } {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return { values: [], label: String };
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? 10 * mag;
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) values.push(Math.round(v * 1e6) / 1e6);
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return { values, label: (v) => `$${v.toFixed(decimals)}` };
}

/** Path points split at time `t`: [before (inclusive), from (inclusive)]. */
export function splitPathAt(points: ReadonlyArray<readonly [number, number]>, t: number) {
  const before = points.filter(([pt]) => pt <= t);
  const after = points.filter(([pt]) => pt >= t);
  return { before, after };
}

/* ---------- The raise column (presale + split) ---------- */

export type SegmentKey = "floor" | "market" | "creator" | "platform";

/** Column segments as cumulative shares of the raise, bottom to top (floor, market, creator, platform). */
export function columnSegments(split: { floorUsd: number; poolUsd: number; creatorUsd: number; platformUsd: number }): Array<{
  key: SegmentKey;
  from: number;
  to: number;
}> {
  const parts: Array<[SegmentKey, number]> = [
    ["floor", split.floorUsd],
    ["market", split.poolUsd],
    ["creator", split.creatorUsd],
    ["platform", split.platformUsd],
  ];
  const total = Math.max(1e-9, parts.reduce((a, [, usd]) => a + usd, 0));
  let acc = 0;
  return parts.map(([key, usd]) => {
    const from = acc / total;
    acc += usd;
    return { key, from, to: acc / total };
  });
}

/** The column's height on the chart's $ axis: the raise drawn as your $100. */
export const COLUMN_TOP = 100;

/**
 * The column's pixel box: it stands over the presale (story time 0..0.92, just short of the floor
 * slab that starts at t = 1) and is at least 60px wide, so it reads as the beat's main object on a phone.
 */
export function columnBox(p: Plot, s: Scales): { x0: number; x1: number } {
  const x0 = p.left + 4;
  return { x0, x1: Math.max(s.x(0.92), x0 + 60) };
}

/** Ease in-out (cubic), for the floor segment's drop. */
export const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/**
 * The split beat's own phases, from its scroll progress (the step is 150svh): the column divides and
 * its labels come in over the first ~40%, the labelled column then holds, and only from 60% does the
 * floor segment drop onto the slab (done by 95%). Before the split both are 0; after it both are 1.
 */
export function splitPhases(f: StoryFrame): { sp: number; reveal: number } {
  if (f.beatIndex < 1) return { sp: 0, reveal: 0 };
  if (f.beatIndex > 1) return { sp: 1, reveal: 1 };
  return { sp: ramp(f.beatProgress, 0.02, 0.4), reveal: easeInOut(ramp(f.beatProgress, 0.6, 0.95)) };
}
