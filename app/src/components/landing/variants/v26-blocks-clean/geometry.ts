/*
 * Pure 2.5D geometry for variant 26 (Blocks · clean), copied from v15-blocks-site so the source stays
 * untouched. The bouncy landing ease is gone: the site's motion settles and never overshoots.
 * The chart's front plane is an ordinary linear plot
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
  const compact = w < 480;
  // Shallow on purpose: the front top edge is the true floor, and a deep top face reads as "higher".
  const depth = Math.min(20, Math.max(10, Math.min(w, h) * 0.03));
  // The chart card already insets the plot under its chips; these margins only hold the tick labels.
  return {
    l: compact ? 44 : 56,
    r: w - (compact ? 6 : 10),
    t: compact ? 26 : 34,
    b: h - (compact ? 10 : 14),
    dx: -depth,
    dy: -depth * 0.58,
    ball: compact ? 7 : 9,
    compact,
  };
}

/** Linear map a..b → c..d. */
export const lerpMap = (x: number, a: number, b: number, c: number, d: number): number => (b === a ? c : c + ((x - a) / (b - a)) * (d - c));

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** 0..1 within a..b. */
export const within = (x: number, a: number, b: number): number => (b <= a ? (x >= b ? 1 : 0) : clamp01((x - a) / (b - a)));

export const easeOutCubic = (p: number): number => 1 - (1 - clamp01(p)) ** 3;

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
