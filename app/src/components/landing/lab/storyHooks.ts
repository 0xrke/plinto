"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { STAGES, STORY_END, stageAt } from "@/lib/landing/sim/story";

/*
 * Browser hooks for "Follow your $100". Everything here reads the browser in effects, so the server
 * render and the first client render are identical (the finished frame).
 */

/** `prefers-reduced-motion: reduce`; null until read on mount. */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setReduced(false);
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export interface InView {
  /** Any part of the element is in view. */
  visible: boolean;
  /**
   * At least half of the element is in view, or it fills at least half the viewport (a card
   * taller than twice the viewport, e.g. at 200% zoom, can never be half in view).
   */
  half: boolean;
}

const IN_VIEW_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

/** How much of the element is in view; null until the first observation. Without IntersectionObserver it counts as fully in view. */
export function useInView(ref: RefObject<Element | null>): InView | null {
  const [inView, setInView] = useState<InView | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setInView({ visible: true, half: true });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        const visible = e.isIntersecting;
        const fillsHalf = e.rootBounds != null && e.rootBounds.height > 0 && e.intersectionRect.height >= 0.5 * e.rootBounds.height;
        const half = visible && (e.intersectionRatio >= 0.5 || fillsHalf);
        setInView((prev) => (prev && prev.visible === visible && prev.half === half ? prev : { visible, half }));
      },
      { threshold: IN_VIEW_THRESHOLDS },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

/** False while the tab is hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const read = () => setVisible(document.visibilityState !== "hidden");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  return visible;
}

/** Under reduced motion, Play shows each stage whole and holds it this long. */
export const REDUCED_HOLD_MS = 3000;
/** Autoplay starts this long after the card is half in view. */
export const AUTOPLAY_DELAY_MS = 400;
/** Longest step one animation frame may take (a background tab returns with a huge gap). */
const MAX_FRAME_S = 0.1;

/** End of the stage after the one shown at t (clamped to the story end). */
export function nextStageEnd(t: number): number {
  return STAGES[Math.min(STAGES.length - 1, stageAt(t) + 1)]!.end;
}

/** End of the stage before the one shown at t (clamped to the first stage's end). */
export function prevStageEnd(t: number): number {
  return STAGES[Math.max(0, stageAt(t) - 1)]!.end;
}

export interface StoryClock {
  t: number;
  /** The user's intent; the clock only moves while also in view and the tab is visible. */
  playing: boolean;
  atEnd: boolean;
  /** Play, pause, or replay from the start at the end. */
  toggle: () => void;
  /** A manual jump: pauses and cancels autoplay for good. */
  seek: (t: number) => void;
}

/**
 * The story clock. Every control only sets `t`; the picture is `storyFrame(m, t)`.
 *
 * - Starts on the finished frame (what the server rendered). On the first observation, if motion is
 *   allowed and the card is not in view, it rewinds to 0 silently and arms a single autoplay that
 *   starts 400 ms after the card is half in view. If the card is already in view, it stays at the end.
 * - Runs on requestAnimationFrame only while playing, at least partly in view and the tab is
 *   visible, so scrolling the card fully away or hiding the tab pauses it and coming back resumes
 *   it unless the user paused. Only autoplay waits for the card to be half in view; an explicit
 *   Play runs whenever any of the card shows (landscape phones, 200% zoom).
 * - Under reduced motion there is no autoplay; Play steps through the stages, holding each for 3 s.
 */
export function useStoryClock({
  reducedMotion,
  inView,
  pageVisible,
}: {
  reducedMotion: boolean | null;
  inView: InView | null;
  pageVisible: boolean;
}): StoryClock {
  const [t, setT] = useState(STORY_END);
  const [playing, setPlaying] = useState(false);
  /** pending: not decided yet; armed: waiting for the card to come into view; off: never again. */
  const autoplay = useRef<"pending" | "armed" | "off">("pending");
  const visible = inView?.visible ?? null;
  const half = inView?.half ?? null;
  const running = playing && visible === true && pageVisible;
  const reduced = reducedMotion === true;

  // Decide once, after the first observation, whether this visit gets an autoplay.
  useEffect(() => {
    if (autoplay.current !== "pending" || reducedMotion === null || half === null) return;
    if (reducedMotion || half) {
      autoplay.current = "off";
      return;
    }
    autoplay.current = "armed";
    setT(0);
  }, [reducedMotion, half]);

  // Armed autoplay: start once, shortly after the card is half in view.
  useEffect(() => {
    if (autoplay.current !== "armed" || half !== true || !pageVisible) return;
    const id = window.setTimeout(() => {
      if (autoplay.current !== "armed") return;
      autoplay.current = "off";
      setPlaying(true);
    }, AUTOPLAY_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [half, pageVisible]);

  // Smooth clock.
  useEffect(() => {
    if (!running || reduced) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        const dt = Math.min(MAX_FRAME_S, Math.max(0, (now - last) / 1000));
        setT((prev) => Math.min(STORY_END, prev + dt));
      }
      last = now;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [running, reduced]);

  // Reduced motion: hold each whole stage, then show the next one.
  useEffect(() => {
    if (!running || !reduced || t >= STORY_END) return;
    const id = window.setTimeout(() => setT((prev) => nextStageEnd(prev)), REDUCED_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [running, reduced, t]);

  // Stop at the end.
  useEffect(() => {
    if (playing && t >= STORY_END) setPlaying(false);
  }, [playing, t]);

  const toggle = useCallback(() => {
    autoplay.current = "off";
    if (playing) {
      setPlaying(false);
      return;
    }
    if (t >= STORY_END) setT(reduced ? STAGES[0]!.end : 0);
    else if (reduced) setT(nextStageEnd(t));
    setPlaying(true);
  }, [playing, t, reduced]);

  const seek = useCallback((next: number) => {
    autoplay.current = "off";
    setPlaying(false);
    setT(Math.min(STORY_END, Math.max(0, next)));
  }, []);

  return { t, playing, atEnd: t >= STORY_END, toggle, seek };
}
