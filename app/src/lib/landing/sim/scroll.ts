import { STORY_POS_END } from "./story";
import { clamp01, range } from "./timeline";

/*
 * Pure scroll math for the scroll-driven story. The browser driver
 * (components/landing/scroll/progress.ts) measures rects and feeds these functions; nothing here
 * touches the DOM.
 */

export { clamp01, range };

/**
 * Local progress of a step whose top is `top` and height `h`, against a reading line at `line`
 * (viewport px): 0 while the step's top is at or below the line, 1 once its bottom has passed it.
 */
export function stepProgress(top: number, h: number, line: number): number {
  if (!(h > 0)) return top <= line ? 1 : 0;
  return clamp01((line - top) / h);
}

/** Step progress window that plays a beat; the finished frame holds from STORY_Q_DONE to 1. */
export const STORY_Q_START = 0.05;
export const STORY_Q_DONE = 0.75;

/**
 * Story position for the active step at its progress q: the beat plays over q 0.05..0.75 and holds
 * its end after that (pos = active + 1, which storyFrame draws as beat `active` finished, never as
 * the next beat's start), so the last beat finishes while the stage is pinned. Clamped to
 * [0, STORY_POS_END].
 */
export function storyPosAt(active: number, q: number): number {
  const i = Number.isFinite(active) ? Math.trunc(active) : 0;
  const pos = i + range(q, STORY_Q_START, STORY_Q_DONE);
  return Math.min(STORY_POS_END, Math.max(0, pos));
}

/** Snap x to a multiple of `step`, rounded to 1e-9 so 0.05 grids compare equal. */
export function quantize(x: number, step: number): number {
  if (!(step > 0)) return x;
  return Math.round(Math.round(x / step) * step * 1e9) / 1e9;
}
