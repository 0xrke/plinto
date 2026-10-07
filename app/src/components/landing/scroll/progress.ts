import { stepProgress } from "@/lib/landing/sim/scroll";

/*
 * Scroll progress driver for the landing chapters: a page-wide singleton, no React.
 *
 * Native scrolling only. One passive scroll + resize (+ visualViewport resize) listener for the
 * whole page, coalesced to one requestAnimationFrame. An IntersectionObserver marks chapters that
 * are near the viewport as live; only live chapters are measured. Per frame, every [data-step] rect
 * of every live chapter is read first, then the results are written: CSS variables `--q0…--qN`
 * on the chapter root (the mean `p` stays in the state only; no CSS reads it), `data-active` on the root (the step index) and on each step
 * ("true"/"false"), then subscribers are notified. Nothing here calls preventDefault, listens to
 * wheel or touch, or scrolls the page.
 */

export interface ChapterProgress {
  /** Mean of the step progresses, 0..1. */
  p: number;
  /** Per-step progress, 0..1, in DOM order. */
  q: readonly number[];
  /** The last step whose progress is above 0, or 0 if none. */
  active: number;
}

/** Same media query as chapter.module.css's wide layout. */
export const WIDE_QUERY = "(min-width: 1024px), (orientation: landscape) and (max-height: 500px)";
/** Smallest change that triggers a write. */
const EPSILON = 0.001;

/** The finished frame: every step at 1, the last step active. What the server and no-JS render. */
export function finalProgress(steps: number): ChapterProgress {
  const n = Math.max(1, Math.trunc(steps));
  return { p: 1, q: Object.freeze(Array.from({ length: n }, () => 1)), active: n - 1 };
}

interface Entry {
  observed: boolean;
  /** False until the first write, so the first measurement always writes. */
  written: boolean;
  live: boolean;
  /** Cached stage height (narrow layout's reading line), refreshed on resize. */
  stageH: number;
  state: ChapterProgress;
}

const entries = new Map<HTMLElement, Entry>();
const subs = new Map<HTMLElement, Set<() => void>>();
/** Final frames for roots that are not observed, cached so getProgress stays referentially stable. */
const finals = new WeakMap<HTMLElement, ChapterProgress>();

let attached = false;
let raf = 0;
let io: IntersectionObserver | null = null;
let wide = true;
let resized = true;

const stepsOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
const stageOf = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-stage]");

function finalFor(root: HTMLElement): ChapterProgress {
  let f = finals.get(root);
  const n = Math.max(1, stepsOf(root).length);
  if (!f || f.q.length !== n) {
    f = finalProgress(n);
    finals.set(root, f);
  }
  return f;
}

function schedule() {
  if (raf || typeof window === "undefined") return;
  raf = window.requestAnimationFrame(frame);
}

function onScroll() {
  schedule();
}

function onResize() {
  resized = true;
  schedule();
}

function readLayout() {
  wide = typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY).matches : true;
  for (const [root, e] of entries) {
    if (e.observed) e.stageH = stageOf(root)?.offsetHeight ?? 0;
  }
  resized = false;
}

function changed(prev: ChapterProgress, q: number[], active: number): boolean {
  if (prev.active !== active || prev.q.length !== q.length) return true;
  for (let i = 0; i < q.length; i++) {
    const a = prev.q[i]!;
    const b = q[i]!;
    if (Math.abs(a - b) > EPSILON) return true;
    // Always land exactly on the ends, even after sub-epsilon steps.
    if (a !== b && (b === 0 || b === 1)) return true;
  }
  return false;
}

function frame() {
  raf = 0;
  if (resized) readLayout();
  const vh = window.innerHeight;

  // Reads: every step rect of every live chapter.
  const measured: Array<{ root: HTMLElement; e: Entry; steps: HTMLElement[]; q: number[] }> = [];
  for (const [root, e] of entries) {
    if (!e.observed || !e.live) continue;
    const line = wide ? 0.5 * vh : e.stageH + 0.4 * (vh - e.stageH);
    const steps = stepsOf(root);
    const q = steps.map((s) => {
      const r = s.getBoundingClientRect();
      return stepProgress(r.top, r.height, line);
    });
    measured.push({ root, e, steps, q });
  }

  // Writes.
  const notify: HTMLElement[] = [];
  for (const { root, e, steps, q } of measured) {
    if (q.length === 0) continue;
    let active = 0;
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i]! > 0) {
        active = i;
        break;
      }
    }
    if (e.written && !changed(e.state, q, active)) continue;
    e.written = true;
    const p = q.reduce((a, b) => a + b, 0) / q.length;
    e.state = { p, q: Object.freeze(q), active };
    q.forEach((v, i) => root.style.setProperty(`--q${i}`, fmt(v)));
    root.dataset.active = String(active);
    steps.forEach((s, i) => {
      s.dataset.active = i === active ? "true" : "false";
    });
    notify.push(root);
  }
  for (const root of notify) emit(root);
}

const fmt = (x: number) => String(Math.round(x * 10000) / 10000);

function emit(root: HTMLElement) {
  const set = subs.get(root);
  if (set) for (const cb of [...set]) cb();
}

function attach() {
  if (attached) return;
  attached = true;
  resized = true;
  const opts: AddEventListenerOptions = { passive: true };
  window.addEventListener("scroll", onScroll, opts);
  window.addEventListener("resize", onResize, opts);
  window.visualViewport?.addEventListener("resize", onResize, opts);
  if (typeof IntersectionObserver === "function") {
    io = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          const e = entries.get(r.target as HTMLElement);
          if (e) e.live = r.isIntersecting;
        }
        schedule();
      },
      { rootMargin: "100% 0px" },
    );
  }
}

function detach() {
  if (!attached) return;
  attached = false;
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onResize);
  window.visualViewport?.removeEventListener("resize", onResize);
  io?.disconnect();
  io = null;
  if (raf) window.cancelAnimationFrame(raf);
  raf = 0;
}

/** Clear everything the driver wrote, so CSS falls back to the final frame (`var(--qN, 1)`). */
function clearWrites(root: HTMLElement) {
  root.style.removeProperty("--p");
  for (let i = 0; root.style.getPropertyValue(`--q${i}`) !== ""; i++) root.style.removeProperty(`--q${i}`);
  delete root.dataset.active;
  for (const s of stepsOf(root)) delete s.dataset.active;
}

/**
 * Start measuring a chapter root (a <section> holding [data-step] elements and one [data-stage]).
 * Returns the cleanup: it stops measuring, removes the CSS variables and data-active attributes,
 * resets the chapter to its final frame, and removes the page listeners after the last chapter.
 */
export function observeChapter(root: HTMLElement): () => void {
  const prev = entries.get(root);
  if (prev?.observed) return () => {};
  attach();
  const e: Entry = {
    observed: true,
    written: false,
    // Without IntersectionObserver every chapter is live.
    live: io === null,
    stageH: stageOf(root)?.offsetHeight ?? 0,
    state: finalFor(root),
  };
  entries.set(root, e);
  io?.observe(root);
  resized = true;
  schedule();
  return () => {
    if (entries.get(root) !== e) return;
    entries.delete(root);
    io?.unobserve(root);
    clearWrites(root);
    const wasFinal = e.state === finalFor(root);
    if (entries.size === 0) detach();
    if (!wasFinal) emit(root);
  };
}

/** Call `cb` whenever the chapter's progress changes. Works before or after observeChapter. */
export function subscribe(root: HTMLElement, cb: () => void): () => void {
  let set = subs.get(root);
  if (!set) {
    set = new Set();
    subs.set(root, set);
  }
  set.add(cb);
  return () => {
    const s = subs.get(root);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) subs.delete(root);
  };
}

/** Current progress; the final frame while the chapter is not observed. Referentially stable between changes. */
export function getProgress(root: HTMLElement): ChapterProgress {
  return entries.get(root)?.state ?? finalFor(root);
}
