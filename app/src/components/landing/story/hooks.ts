"use client";

import { useMemo } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEAT_KEYS, STORY_POS_END, storyFrame, type BeatKey, type StoryFrame } from "@/lib/landing/sim/story";
import { quantize, storyPosAt } from "@/lib/landing/sim/scroll";
import { readingLine, type ChapterProgress } from "@/components/landing/scroll/progress";
import { useChapterValue } from "@/components/landing/scroll/useChapter";
import { useStoryContext } from "./context";

/** Default position grid: 1/200 of a beat (what the landing uses). */
export const POS_STEP = 0.005;
/** A jump lands here in the step, past the end of its beat (0.75), so the beat shows finished. */
export const JUMP_Q = 0.85;
const STEPS = BEAT_KEYS.length;

const selectActive = (s: ChapterProgress): number => s.active;
const posSelectors = new Map<number, (s: ChapterProgress) => number>();
/** One stable selector per grid size, so useChapterValue's memo holds between renders. */
function posSelector(step: number): (s: ChapterProgress) => number {
  let f = posSelectors.get(step);
  if (!f) {
    f = (s) => quantize(storyPosAt(s.active, s.q[s.active] ?? 1), step);
    posSelectors.set(step, f);
  }
  return f;
}

/**
 * Story position 0..8 (beat index + progress within the beat), quantised to `step`. The component
 * re-renders only when the quantised value changes; the server and first paint get 8 (finished).
 */
export function usePos(step: number = POS_STEP): number {
  const { ref } = useStoryContext();
  return useChapterValue(ref, posSelector(step > 0 ? step : POS_STEP), STEPS);
}

/** The current frame, storyFrame(m, usePos(step)), memoised on the quantised pos. */
export function useStoryFrame(step: number = POS_STEP): StoryFrame {
  const { m } = useStoryContext();
  const pos = usePos(step);
  return useMemo(() => storyFrame(m, pos), [m, pos]);
}

/** Index of the active step (0..7); re-renders only when it changes. */
export function useActiveBeat(): { index: number; key: BeatKey } {
  const { ref } = useStoryContext();
  const index = useChapterValue(ref, selectActive, STEPS);
  return { index, key: BEAT_KEYS[index]! };
}

/**
 * Low-level: any value derived from the raw progress ({ q: per-step 0..1, active }). Return a
 * primitive (or quantise) so frames that do not change it cost no render. Keep `select` stable
 * (module-level) for best results.
 */
export function useStoryProgress<T>(select: (s: ChapterProgress) => T): T {
  const { ref } = useStoryContext();
  return useChapterValue(ref, select, STEPS);
}

/** prefers-reduced-motion: true, false, or null (server / first client render: unknown). */
export function useStoryReducedMotion(): boolean | null {
  return useStoryContext().reduced;
}

/** The launch math the story runs on. */
export function useStoryLaunch(): LaunchMath {
  return useStoryContext().m;
}

/** `jumpToBeat(i, q = 0.85)`: native (smooth unless reduced motion) scroll to beat i. */
export function useJumpToBeat(): (i: number, q?: number) => void {
  return useStoryContext().jumpToBeat;
}

/** One still per beat: beat i finished (storyFrame(m, i + 1)), for reduced motion or thumbnails. */
export function stillFrames(m: LaunchMath): StoryFrame[] {
  return BEAT_KEYS.map((_, i) => storyFrame(m, i + 1));
}

export function useStillFrames(): StoryFrame[] {
  const { m } = useStoryContext();
  return useMemo(() => stillFrames(m), [m]);
}

/**
 * Scroll the page so step i of chapter `root` sits at progress q (default 0.85: its beat finished).
 * Native window.scrollTo only; the scroll listener does the rest, so scrolling back reverses exactly.
 */
export function jumpToBeat(root: HTMLElement | null, i: number, opts: { q?: number; reduced?: boolean | null } = {}): void {
  const step = root?.querySelectorAll<HTMLElement>("[data-step]")[Math.max(0, Math.min(STEPS - 1, Math.trunc(i)))];
  if (!root || !step) return;
  const r = step.getBoundingClientRect();
  const q = opts.q ?? JUMP_Q;
  const top = window.scrollY + r.top + q * r.height - readingLine(root);
  window.scrollTo({ top: Math.max(0, top), behavior: opts.reduced === false ? "smooth" : "auto" });
}

export { BEAT_KEYS, STORY_POS_END, storyFrame, type BeatKey, type StoryFrame };
