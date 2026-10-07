import type { KeyboardEvent } from "react";

/*
 * Range-input styling and keys for the floor-share slider, copied from lab/SplitSandbox (which the
 * wiring step deletes) so the chapter does not depend on it.
 *
 * A range input with a 44px touch target and a 12px drawn track. The track is a sibling element;
 * the input itself is transparent. Webkit puts the thumb at the top of a styled track, so it gets
 * a 9px margin ((44 − 26) / 2); Firefox centres it on its own. The thumb follows the create form's
 * SPLIT_RANGE: white with a floor ring.
 */
export const RANGE = [
  "relative z-10 block h-11 w-full cursor-pointer appearance-none bg-transparent",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
  "[&::-webkit-slider-runnable-track]:h-11 [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:mt-[9px] [&::-webkit-slider-thumb]:h-[26px] [&::-webkit-slider-thumb]:w-[26px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-floor [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
  "[&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-floor [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
  "[&::-moz-range-track]:bg-transparent",
].join(" ");

/** Left offset of a value at fraction `f` of the range, matching where the 26px thumb's centre sits. */
export const thumbLeft = (f: number) => `calc(13px + (100% - 26px) * ${f})`;

/**
 * Keyboard stepping for a range input: arrows ±1, PageUp/PageDown ±`page`, Home/End to the ends.
 * Browsers already do this natively, but their PageUp step differs (and jsdom has none), so the
 * slider handles the keys itself and stops the native step.
 */
export function rangeKeyHandler(value: number, min: number, max: number, page: number, set: (v: number) => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: page,
      PageDown: -page,
      Home: min - value,
      End: max - value,
    };
    const d = step[e.key];
    if (d === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next = Math.min(max, Math.max(min, value + d));
    if (next !== value) set(next);
  };
}
