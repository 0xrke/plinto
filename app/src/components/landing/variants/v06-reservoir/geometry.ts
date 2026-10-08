/*
 * Pure geometry for the Reservoir variant: the tank layout in pixels, the dollar and time scales and a
 * few path builders. No React, no DOM, so it is unit-testable.
 */

export interface TankBox {
  /** Tank interior, in SVG pixels. */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Time axis inside the tank (the glass doubles as a chart: story time runs left to right). */
  tx0: number;
  tx1: number;
  /** Gauge tick column (left edge), to the right of the tank. */
  gaugeX: number;
  /** Raise bar row above the tank. */
  barY: number;
  /** True on narrow stages (phone). */
  narrow: boolean;
}

/** Lays the tank and its gauge column out in a w × h SVG. The tank takes all the width but the gauge. */
export function tankBox(w: number, h: number): TankBox {
  const narrow = w < 560;
  const gaugeW = narrow ? 38 : 50;
  const x0 = 3;
  const x1 = Math.max(x0 + 120, w - gaugeW - 2);
  const inset = narrow ? 14 : 22;
  const top = narrow ? 56 : 50;
  return {
    x0,
    x1,
    top,
    bottom: h - 4,
    tx0: x0 + inset,
    tx1: x1 - inset,
    gaugeX: x1 + 6,
    barY: top - 30,
    narrow,
  };
}

/** Linear dollar → pixel map for a camera (y.min at the bottom, y.max `headroom` px under the top). */
export function dollarScale(y: { min: number; max: number }, top: number, bottom: number, headroom = 14) {
  const span = Math.max(1e-9, y.max - y.min);
  const usable = bottom - top - headroom;
  return (v: number) => bottom - ((v - y.min) / span) * usable;
}

/** Linear story time → pixel map over [0, endT]. */
export function timeScale(endT: number, x0: number, x1: number) {
  const span = Math.max(1e-9, endT);
  return (t: number) => x0 + clamp01(t / span) * (x1 - x0);
}

/** About `target` round tick values inside [min, max] (steps of 1, 2 or 5 × 10^k). */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * Water body with a sine surface, from x0 − period to x1 + period (so a translateX(−period) loop
 * never shows an edge), down to `bottom`.
 */
export function wavePath(x0: number, x1: number, surface: number, bottom: number, amp: number, period: number): string {
  const step = period / 8;
  const parts: string[] = [];
  for (let x = x0 - period; x <= x1 + period + 1e-6; x += step) {
    const y = surface + amp * Math.sin(((x - x0) / period) * Math.PI * 2);
    parts.push(`${parts.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(2)}`);
  }
  parts.push(`L${(x1 + period).toFixed(1)} ${bottom}`, `L${(x0 - period).toFixed(1)} ${bottom}`, "Z");
  return parts.join(" ");
}

/** Polyline "M x y L …" for [t, v] points through the given scales. */
export function linePath(points: ReadonlyArray<readonly [number, number]>, sx: (t: number) => number, sy: (v: number) => number): string {
  return points.map(([t, v], i) => `${i === 0 ? "M" : "L"}${sx(t).toFixed(2)} ${sy(v).toFixed(2)}`).join(" ");
}

/** Closed area under a polyline, down to pixel row `base`. */
export function areaPath(points: ReadonlyArray<readonly [number, number]>, sx: (t: number) => number, sy: (v: number) => number, base: number): string {
  if (points.length < 2) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${linePath(points, sx, sy)} L${sx(last[0]).toFixed(2)} ${base} L${sx(first[0]).toFixed(2)} ${base} Z`;
}

/**
 * The arbitrage line as its own staircase: the floor staircase × ratio, from `fromT` on (the bounce
 * beat), ending at `toT`. Empty when nothing of the floor exists at `fromT` yet or toT < fromT.
 */
export function scaledStepsFrom(steps: ReadonlyArray<readonly [number, number]>, ratio: number, fromT: number, toT: number): Array<[number, number]> {
  if (toT < fromT || steps.length === 0) return [];
  const out: Array<[number, number]> = [];
  let before: number | null = null;
  for (const [t, v] of steps) {
    if (t > toT) break;
    if (t < fromT) {
      before = v;
      continue;
    }
    if (out.length === 0 && t > fromT && before !== null) out.push([fromT, before * ratio]);
    out.push([t, v * ratio]);
  }
  if (out.length === 0 && before !== null) out.push([fromT, before * ratio]);
  const last = out[out.length - 1];
  if (last && last[0] < toT) out.push([toT, last[1]]);
  return out;
}

/** Tank interior outline: square top corners (open rim), rounded bottom corners. */
export function tankOutline(x0: number, x1: number, top: number, bottom: number, r: number): string {
  return `M${x0} ${top} L${x0} ${bottom - r} Q${x0} ${bottom} ${x0 + r} ${bottom} L${x1 - r} ${bottom} Q${x1} ${bottom} ${x1} ${bottom - r} L${x1} ${top}`;
}

/** Rough text width for the label pills (sans, ~0.56 em per character). */
export const textWidth = (s: string, fs: number): number => s.length * fs * 0.56;

export const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
