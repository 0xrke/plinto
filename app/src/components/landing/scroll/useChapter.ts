"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { useReducedMotion } from "../lab/storyHooks";
import { finalProgress, getProgress, observeChapter, subscribe, type ChapterProgress } from "./progress";

export type { ChapterProgress } from "./progress";

/**
 * Attaches the scroll driver unless reduced motion (or not yet known). Returns the ref to put on the
 * chapter root and the reduced-motion state (null on the server and the first client render).
 */
export function useChapterSetup(): { ref: RefObject<HTMLElement | null>; reduced: boolean | null } {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced !== false) return;
    const el = ref.current;
    if (!el) return;
    return observeChapter(el);
  }, [reduced]);
  return { ref, reduced };
}

/**
 * Re-renders only when `select(progress)` changes (Object.is). The server render and the first
 * client render use the final frame (every q = 1, the last step active), so markup without JS
 * shows the finished state. Return primitives (or quantize, see `quantize` in lib/landing/sim/scroll)
 * so a scroll frame that does not change the selected value costs no render.
 */
export function useChapterValue<T>(ref: RefObject<HTMLElement | null>, select: (s: ChapterProgress) => T, steps: number): T {
  // Memo on the progress object and the selector: the driver only replaces the object when
  // something changed, and an inline selector is simply re-run (cheap) on each render.
  const memo = useRef<{ s: ChapterProgress; f: (s: ChapterProgress) => T; v: T } | null>(null);
  const final = useRef<ChapterProgress | null>(null);
  if (final.current === null || final.current.q.length !== Math.max(1, Math.trunc(steps))) final.current = finalProgress(steps);

  const read = (s: ChapterProgress): T => {
    const m = memo.current;
    if (m && m.s === s && m.f === select) return m.v;
    const v = select(s);
    memo.current = { s, f: select, v: m && Object.is(m.v, v) ? m.v : v };
    return memo.current.v;
  };

  const sub = useCallback(
    (cb: () => void) => {
      const el = ref.current;
      return el ? subscribe(el, cb) : () => {};
    },
    [ref],
  );
  const getSnapshot = () => read(ref.current ? getProgress(ref.current) : final.current!);
  const getServerSnapshot = () => read(final.current!);
  return useSyncExternalStore(sub, getSnapshot, getServerSnapshot);
}
