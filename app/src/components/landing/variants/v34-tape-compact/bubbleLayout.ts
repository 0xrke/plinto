/*
 * Where the speech bubbles sit on desktop, as a pure function of the scroll: u = the active step plus
 * its progress (0..8), the bubble layer's height (the viewport) and each bubble's height. Sticky
 * bubbles cannot do this: a bubble that drifts up inside its sticky slot leaves a gap as big as the
 * drift between it and the next one, so the next never touches it. Here the next bubble catches up
 * from below the screen, meets the current one and kicks it up, and the old one flies off the top
 * while the new one starts its own drift. Scrolling back plays it in reverse exactly.
 */

export const BUBBLE_MOTION = {
  /** The takeover spot: a bubble's top when it becomes current, from the layer's middle. */
  takeover: -32,
  /** How far the current bubble drifts up over its step. */
  drift: 140,
  /** The last part of a step (share of it) in which the next bubble catches up and pushes. */
  push: 0.25,
  /** Space between two bubbles in contact. */
  gap: 16,
  /** Share of the next step over which the pushed-out bubble flies up off the top of the layer. */
  flyOut: 0.3,
  /** Share of the push window over which the incoming bubble fades in. */
  fadeIn: 0.35,
} as const;

export interface BubblePlace {
  /** Top of the bubble in the layer, px. */
  y: number;
  /** Opacity, 0..1. */
  o: number;
  /** The current bubble (full ink, filled badge, tail); the others are muted. */
  active: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** One entry per bubble; null where a bubble is not shown. */
export function bubbleLayout(u: number, layerH: number, heights: readonly number[]): (BubblePlace | null)[] {
  const n = heights.length;
  const out: (BubblePlace | null)[] = Array.from({ length: n }, () => null);
  if (n === 0) return out;
  const { takeover, drift, push, gap, flyOut, fadeIn } = BUBBLE_MOTION;
  const i = Math.min(n - 1, Math.max(0, Math.floor(u)));
  const q = u >= n ? 1 : clamp01(u - i);
  const top = layerH / 2 + takeover;
  const hasNext = i < n - 1;

  // Where a bubble ends its step: drifted up, or kicked higher still by the next one.
  const end = (k: number) => Math.min(top - drift, top - gap - heights[k]!);

  // The current bubble drifts up over the whole of its step.
  let cur = top - drift * ease(q);
  if (hasNext && q > 1 - push) {
    // The next one rises from just below the layer to the takeover spot; once it meets the current
    // bubble it pushes it up, keeping the gap.
    const h = ease((q - (1 - push)) / push);
    const next = layerH + (top - layerH) * h;
    cur = Math.min(cur, next - gap - heights[i]!);
    out[i + 1] = { y: next, o: clamp01(h / fadeIn), active: false };
  }
  out[i] = { y: cur, o: 1, active: true };

  // The bubble just pushed out keeps going: it flies up off the top of the layer, from where it
  // ended, at a steady speed (no stop at the hand-off), and is gone by flyOut of the next step.
  if (i > 0 && q < flyOut) {
    const from = end(i - 1) + (cur - top);
    const t = q / flyOut;
    out[i - 1] = { y: from - t * (end(i - 1) + heights[i - 1]! + gap), o: 1, active: false };
  }
  return out;
}
