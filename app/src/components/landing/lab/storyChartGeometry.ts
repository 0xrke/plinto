import { STORY_T_END } from "@/lib/landing/sim/story";

/*
 * Pure geometry for StoryChart. The SVG is a unit box (VB × VB, preserveAspectRatio none) stretched
 * over the plot; HTML labels are placed in percent of the same box, so both share these scales.
 */

export const VB = 1000;

export type Pt = readonly [number, number];

export interface Scales {
  /** Story time → SVG x. */
  xOf: (t: number) => number;
  /** Value → SVG y (top = y.max). */
  yOf: (v: number) => number;
  /** Story time → percent from the left. */
  pctX: (t: number) => number;
  /** Value → percent from the top (unclamped). */
  pctY: (v: number) => number;
}

export function makeScales(y: { min: number; max: number }): Scales {
  const span = y.max - y.min || 1;
  return {
    xOf: (t) => (t / STORY_T_END) * VB,
    yOf: (v) => VB * (1 - (v - y.min) / span),
    pctX: (t) => (t / STORY_T_END) * 100,
    pctY: (v) => (1 - (v - y.min) / span) * 100,
  };
}

const n = (x: number) => (Math.abs(x) < 5e-3 ? 0 : x).toFixed(2);

/**
 * Staircase path through `steps` with straight segments only. Consecutive vertices that share a
 * story time (a riser) get the identical x string, so every riser is exactly vertical.
 */
export function stepPathD(steps: ReadonlyArray<Pt>, s: Scales, scale = 1): string {
  return steps.map(([t, v], i) => `${i ? "L" : "M"}${n(s.xOf(t))} ${n(s.yOf(v * scale))}`).join(" ");
}

/** Closed area between the staircase and the bottom of the plot. */
export function areaUnderD(steps: ReadonlyArray<Pt>, s: Scales): string {
  if (steps.length < 2) return "";
  const x0 = n(s.xOf(steps[0]![0]));
  const x1 = n(s.xOf(steps[steps.length - 1]![0]));
  return `${stepPathD(steps, s)} L${x1} ${VB} L${x0} ${VB} Z`;
}

/** Closed strip between the staircase and the same staircase scaled by `ratio` (< 1). */
export function stripBetweenD(steps: ReadonlyArray<Pt>, ratio: number, s: Scales): string {
  if (steps.length < 2) return "";
  const top = steps.map(([t, v], i) => `${i ? "L" : "M"}${n(s.xOf(t))} ${n(s.yOf(v))}`);
  const bottom = [...steps].reverse().map(([t, v]) => `L${n(s.xOf(t))} ${n(s.yOf(v * ratio))}`);
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

/**
 * Monotone cubic path (Fritsch–Carlson, as d3's curveMonotoneX) through points with strictly
 * increasing x. It never overshoots the data between two samples, so a smoothed price never dips
 * under a level the samples stay above.
 */
export function monotonePathD(points: ReadonlyArray<Pt>, s: Scales): string {
  const P = points.map(([t, v]) => [s.xOf(t), s.yOf(v)] as const);
  const k = P.length;
  if (k === 0) return "";
  if (k === 1) return `M${n(P[0]![0])} ${n(P[0]![1])}`;
  const d: number[] = []; // secant slopes
  for (let i = 0; i < k - 1; i++) {
    const h = P[i + 1]![0] - P[i]![0];
    d.push(h > 0 ? (P[i + 1]![1] - P[i]![1]) / h : 0);
  }
  const m: number[] = new Array(k);
  m[0] = d[0]!;
  m[k - 1] = d[k - 2]!;
  for (let i = 1; i < k - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < k - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const r = a * a + b * b;
    if (r > 9) {
      const tau = 3 / Math.sqrt(r);
      m[i] = tau * a * d[i]!;
      m[i + 1] = tau * b * d[i]!;
    }
  }
  let out = `M${n(P[0]![0])} ${n(P[0]![1])}`;
  for (let i = 0; i < k - 1; i++) {
    const [x0, y0] = P[i]!;
    const [x1, y1] = P[i + 1]!;
    const h = (x1 - x0) / 3;
    out += ` C${n(x0 + h)} ${n(y0 + m[i]! * h)} ${n(x1 - h)} ${n(y1 - m[i + 1]! * h)} ${n(x1)} ${n(y1)}`;
  }
  return out;
}

/** Up to `target` round ticks strictly inside (min, max), using the smallest 1/2/2.5/5 × 10^k step that fits. */
export function niceTicks(min: number, max: number, target = 3): number[] {
  if (!(max > min) || target < 1) return [];
  const raw = (max - min) / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const mult of [1, 2, 2.5, 5, 10, 20]) {
    const step = mult * p;
    const ticks: number[] = [];
    for (let v = Math.ceil(min / step) * step; v < max - 1e-9; v += step) if (v > min + 1e-9) ticks.push(Math.round(v * 1e6) / 1e6);
    if (ticks.length <= target && ticks.length > 0) return ticks;
  }
  return [];
}

/** Which side of a point a label goes, so it stays inside the plot (percent coordinates). */
export function labelSide(leftPct: number, topPct: number): { x: "right" | "left"; y: "above" | "below" } {
  return { x: leftPct > 72 ? "left" : "right", y: topPct < 16 ? "below" : "above" };
}

export const clampPct = (p: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, p));

/** 0..1 ramp of x over [from, to]. */
export const ramp = (x: number, from: number, to: number): number => Math.min(1, Math.max(0, (x - from) / (to - from)));

/** Parse an M/L path into vertices (for tests and label anchoring). */
export function pathVertices(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}
