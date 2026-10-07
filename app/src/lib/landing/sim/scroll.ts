import { STAGES } from "./story";

/*
 * Pure scroll math for the scroll-driven landing chapters. The browser driver
 * (components/landing/scroll/progress.ts) measures rects and feeds these functions; nothing here
 * touches the DOM.
 */

export const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : x > 0 ? 1 : 0);

/**
 * Local progress of a step whose top is `top` and height `h`, against a reading line at `line`
 * (viewport px): 0 while the step's top is at or below the line, 1 once its bottom has passed it.
 */
export function stepProgress(top: number, h: number, line: number): number {
  if (!(h > 0)) return top <= line ? 1 : 0;
  return clamp01((line - top) / h);
}

/** The a..b window inside q, mapped to 0..1 (a step at b when a = b). */
export function range(q: number, a: number, b: number): number {
  if (b <= a) return q >= b ? 1 : 0;
  return clamp01((q - a) / (b - a));
}

/** Story time for stage i at step progress q: plays over q 0.05..0.80, holds the stage end after that. */
export function storyTimeAt(i: number, q: number): number {
  const s = STAGES[Math.min(STAGES.length - 1, Math.max(0, Math.trunc(i)))]!;
  const p = range(q, 0.05, 0.8);
  return p >= 1 ? s.end : s.start + (s.end - s.start) * p;
}

/** Displayed share for chapter 03 step 1: min → max over q 0.1..0.9, an integer. */
export function sweepShareAt(q: number, min: number, max: number): number {
  return Math.round(min + (max - min) * range(q, 0.1, 0.9));
}

/** Snap x to a multiple of `step`, rounded to 1e-9 so 0.05 grids compare equal. */
export function quantize(x: number, step: number): number {
  if (!(step > 0)) return x;
  return Math.round(Math.round(x / step) * step * 1e9) / 1e9;
}
