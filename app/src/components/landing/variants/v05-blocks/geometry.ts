/*
 * Pure 2.5D geometry for the Blocks variant. The chart's front plane is an ordinary linear plot
 * (x = story time, y = USD per $100); every block is that plot's area extruded "into the page" by
 * the depth vector D (up and to the left), so the floor's true height is the front face's height
 * and the extrusion never changes a value.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Plot {
  l: number;
  r: number;
  t: number;
  b: number;
  /** Depth vector (screen px, both negative: up-left). */
  dx: number;
  dy: number;
  /** Ball radius. */
  ball: number;
  /** Compact (phone) metrics. */
  compact: boolean;
}

export function plotFor({ w, h }: Size): Plot {
  const compact = w < 560;
  // Shallow on purpose: the front top edge is the true floor, and a deep top face reads as "higher".
  const depth = Math.min(18, Math.max(9, Math.min(w, h) * 0.026));
  return {
    l: compact ? 40 : 56,
    r: w - (compact ? 14 : 24),
    t: compact ? 26 : 34,
    b: h - (compact ? 16 : 20),
    dx: -depth,
    dy: -depth * 0.58,
    ball: compact ? 8 : 11,
    compact,
  };
}

/** Linear map a..b → c..d. */
export const lerpMap = (x: number, a: number, b: number, c: number, d: number): number => (b === a ? c : c + ((x - a) / (b - a)) * (d - c));

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** 0..1 within a..b. */
export const within = (x: number, a: number, b: number): number => (b <= a ? (x >= b ? 1 : 0) : clamp01((x - a) / (b - a)));

export const easeOutCubic = (p: number): number => 1 - (1 - clamp01(p)) ** 3;

/** A block landing: falls, overshoots and settles (0 → 1). */
export function easeOutBounce(p: number): number {
  const x = clamp01(p);
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x - 1.5 / d) ** 2 + 0.75;
  if (x < 2.5 / d) return n * (x - 2.25 / d) ** 2 + 0.9375;
  return n * (x - 2.625 / d) ** 2 + 0.984375;
}

/** "Nice" tick values inside [min, max], about `target` of them. */
export function niceTicks(min: number, max: number, target = 3): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export const tickLabel = (v: number): string => `$${Number.isInteger(v) ? v : v.toFixed(1)}`;

/**
 * The three visible faces of a box whose front face is x0..x1 × yTop..yBot. `topX1` trims the top
 * face to its exposed part (a block standing on this one hides the rest), so translucent fronts
 * never show a buried top face through them.
 */
export function boxFaces(x0: number, x1: number, yTop: number, yBot: number, dx: number, dy: number, topX1: number = x1): { front: string; top: string; side: string } {
  const tx1 = Math.max(x0, Math.min(x1, topX1));
  const p = (pts: Array<[number, number]>) => pts.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  return {
    front: p([
      [x0, yTop],
      [x1, yTop],
      [x1, yBot],
      [x0, yBot],
    ]),
    top: p([
      [x0, yTop],
      [tx1, yTop],
      [tx1 + dx, yTop + dy],
      [x0 + dx, yTop + dy],
    ]),
    side: p([
      [x0, yTop],
      [x0, yBot],
      [x0 + dx, yBot + dy],
      [x0 + dx, yTop + dy],
    ]),
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** SVG path through screen points. */
export const polyline = (pts: Array<[number, number]>): string => pts.map(([x, y], i) => `${i ? "L" : "M"}${round(x)} ${round(y)}`).join("");
