import { BEAT_KEYS, formatPctChange, storyFrame, type StoryFrame, type VariantProps } from "..";

/*
 * Pure geometry for the fixed tape (copied unchanged from v27-tape-fixed, which took it from v19):
 * where each beat sits in story time, the y-axis ticks and the placement of the two value tags that
 * ride the playhead. The tags keep the order of their dots. No React, no DOM.
 */

type Launch = VariantProps["m"];

export interface BeatBounds {
  /** Story time at which beat i starts (BEAT_KEYS order). */
  start: number[];
  /** Story time at which beat i ends (steps: start = end, it only moves the camera). */
  end: number[];
}

const boundsCache = new WeakMap<Launch, BeatBounds>();

/**
 * Beat windows in story time, read from the engine: pos i (i ≥ 1) is beat i − 1 finished, which is
 * the same instant as beat i's start.
 */
export function beatBounds(m: Launch): BeatBounds {
  const hit = boundsCache.get(m);
  if (hit) return hit;
  const at = BEAT_KEYS.map((_, i) => storyFrame(m, i).t);
  const endT = storyFrame(m, BEAT_KEYS.length).t;
  const out: BeatBounds = { start: at, end: at.map((_, i) => (i + 1 < at.length ? at[i + 1]! : endT)) };
  boundsCache.set(m, out);
  return out;
}

/** Up to ~`count` round ticks inside [min, max] (steps of 1, 2, 2.5 or 5 × 10^k). */
export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / unit) * unit; v <= max + 1e-9; v += unit) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * Vertical centres of the price tag and the floor tag (height `h`), each as close to its own line as
 * possible, never overlapping (gap `gap`) and kept inside [top, bottom]. The tags keep the order of
 * their dots, so the connectors never cross. `floorY` null: only the price tag.
 */
export function layoutTags(
  priceY: number,
  floorY: number | null,
  h: number,
  top: number,
  bottom: number,
  gap = 6,
): { price: number; floor: number | null } {
  const lo = top + h / 2;
  const hi = bottom - h / 2;
  const clamp = (y: number) => Math.min(hi, Math.max(lo, y));
  if (floorY === null) return { price: clamp(priceY), floor: null };
  const need = h + gap;
  const priceAbove = priceY <= floorY;
  let a = priceAbove ? priceY : floorY; // upper tag
  let b = priceAbove ? floorY : priceY; // lower tag
  if (b - a < need) {
    const mid = (a + b) / 2;
    a = mid - need / 2;
    b = mid + need / 2;
  }
  // Keep the pair inside the plot without letting them overlap.
  if (a < lo) {
    b += lo - a;
    a = lo;
  }
  if (b > hi) {
    a -= b - hi;
    b = hi;
  }
  a = Math.max(lo, a);
  return priceAbove ? { price: a, floor: b } : { price: b, floor: a };
}

/** "$36" or "$36.5": y-axis tick labels. */
export const tickLabel = (v: number): string => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(1)}`);

/** Floor value at story time t from the staircase vertices (the last vertex at or before t). */
export function floorAtTime(steps: ReadonlyArray<readonly [number, number]>, t: number): number | null {
  let v: number | null = null;
  for (const [x, y] of steps) {
    if (x <= t + 1e-9) v = y;
    else break;
  }
  return v;
}

const PUMP_I = BEAT_KEYS.indexOf("pump");

/**
 * The tape keeps the made-up price path on screen after it was drawn, so every beat from the pump on
 * (steps and redeem included) carries the Illustration label, not only the engine's illustrative ones.
 */
export const showsIllustration = (frame: StoryFrame): boolean => frame.illustrative || frame.beatIndex >= PUMP_I;

/**
 * Vertical centres for a column of tags (top to bottom, in this order), each as close to its wanted
 * centre as it can be, `gap` apart and kept inside [top, bottom]. Pushes down first, then back up
 * from the bottom edge, then down again from the top edge (the top wins if the column cannot fit).
 */
export function stackTags(items: ReadonlyArray<{ want: number; h: number }>, top: number, bottom: number, gap = 6): number[] {
  const c = items.map((it) => it.want);
  const n = c.length;
  for (let i = 0; i < n; i++) {
    const min = i === 0 ? top + items[0]!.h / 2 : c[i - 1]! + items[i - 1]!.h / 2 + gap + items[i]!.h / 2;
    c[i] = Math.max(c[i]!, min);
  }
  for (let i = n - 1; i >= 0; i--) {
    const max = i === n - 1 ? bottom - items[i]!.h / 2 : c[i + 1]! - items[i + 1]!.h / 2 - gap - items[i]!.h / 2;
    c[i] = Math.min(c[i]!, max);
  }
  for (let i = 0; i < n; i++) {
    const min = i === 0 ? top + items[0]!.h / 2 : c[i - 1]! + items[i - 1]!.h / 2 + gap + items[i]!.h / 2;
    c[i] = Math.max(c[i]!, min);
  }
  return c;
}

/**
 * A burn's floor step for its label: formatPctChange, but with two decimals below 0.1% so the bounce's
 * tiny step reads "+0.01%", not "0.0%" (it is real, and small).
 */
export function burnFloorText(pct: number): string {
  if (pct > 0 && pct < 0.1) return `+${Math.max(0.01, Math.round(pct * 100) / 100).toFixed(2)}%`;
  return formatPctChange(pct);
}
