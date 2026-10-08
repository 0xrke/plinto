import { BEAT_START, STORY_T_END, beatEnd } from "@/lib/landing/sim/timeline";
import type { StoryFrame } from "../shared";

/*
 * Pure geometry for the playful scene: pixel scales, the trampoline net's sag, the ball's squash and
 * its face. Everything is a function of the frame and the measured stage size, so scrolling back
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

/** `foot`: room kept free at the bottom (the level dots sit over it). */
export function plotFor(w: number, h: number, foot = 12): Plot {
  const r = w < 480 ? 11 : 14;
  return { w, h, left: 18, right: w - (w < 480 ? 22 : 30), top: r * 2 + 18, bottom: h - foot, r };
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

export type Mood = "calm" | "happy" | "worried" | "squeeze" | "relief" | "sleepy";

export function moodFor(f: StoryFrame, press: number, slope: number): Mood {
  if (press > 0.35) return "squeeze";
  switch (f.beat) {
    case "presale":
    case "split":
      return "calm";
    case "pump":
      return slope < -0.5 ? "worried" : "happy";
    case "selloff":
      return "worried";
    case "steps":
      return "calm";
    case "bounce":
      return f.beatProgress > 0.55 ? "relief" : "worried";
    case "exits":
      return "calm";
    case "redeem":
      return f.redeemProgress > 0.5 ? "sleepy" : "calm";
  }
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

/** The staircase's flat treads: [t0, t1, v] for every horizontal run of floorSteps. */
export function treads(steps: ReadonlyArray<readonly [number, number]>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i + 1 < steps.length; i++) {
    const [t0, v0] = steps[i]!;
    const [t1] = steps[i + 1]!;
    if (t1 - t0 > 1e-9) out.push([t0, t1, v0]);
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
