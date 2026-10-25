import { stepProgress } from "@/lib/landing/sim/scroll";

/*
 * Scroll progress driver for the landing's scroll-driven story ("Follow your $100"): a page-wide
 * singleton, no React. A "chapter" is a root element holding [data-step] elements and one [data-stage].
 *
 * Native scrolling only. One passive scroll + resize (+ visualViewport resize) listener for the
 * whole page, coalesced to one requestAnimationFrame. An IntersectionObserver marks chapters that
 * are near the viewport as live; only live chapters are measured (a chapter the observer has not
 * caught up with yet, after a jump of more than a viewport, is checked by its rect in the same
 * frame). Per frame, every [data-step] rect of every live chapter is read first, then the results
 * are written: CSS variables `--q0…--qN` on the chapter's [data-rail] (the root without one; only
 * changed values), `data-active` on the root (the step index) and on each step ("true"/"false",
 * only when the active step changes), then subscribers are notified. Nothing here calls
 * preventDefault, listens to wheel or touch, or scrolls the page.
 */

export interface ChapterProgress {
  /** Per-step progress, 0..1, in DOM order. */
  q: readonly number[];
  /** The last step whose progress is above 0, or 0 if none. */
  active: number;
}

/** Same media query as story/harness.module.css's wide layout. */
export const WIDE_QUERY = "(min-width: 1024px), (orientation: landscape) and (max-height: 500px)";
/** Smallest change that triggers a write. */
const EPSILON = 0.001;

/** The finished frame: every step at 1, the last step active. What the server and no-JS render. */
export function finalProgress(steps: number): ChapterProgress {
  const n = Math.max(1, Math.trunc(steps));
  return { q: Object.freeze(Array.from({ length: n }, () => 1)), active: n - 1 };
}

interface Entry {
  observed: boolean;
  /** False until the first write, so the first measurement always writes. */
  written: boolean;
  live: boolean;
  /** Cached stage height (narrow layout's reading line), refreshed on resize. */
  stageH: number;
  /** Last value written per --qN (formatted), so unchanged variables are not rewritten. */
  wroteQ: string[];
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
/** Where the pinned stage ends, from the viewport top: its height plus its sticky `top` (a pinned page header). */
const stageBottom = (root: HTMLElement) => {
  const stage = stageOf(root);
  if (!stage) return 0;
  return stage.offsetHeight + (parseFloat(getComputedStyle(stage).top) || 0);
};
/** Where the --qN variables go: the rail that reads them, so the rest of the chapter is not restyled. */
const varsOf = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-rail]") ?? root;

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
    if (e.observed) e.stageH = stageBottom(root);
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
    if (!e.observed) continue;
    if (!e.live) {
      // The observer reports late after a big jump (End, find-in-page); measure a chapter that is
      // within a viewport of the screen now rather than paint one stale frame.
      const r = root.getBoundingClientRect();
      if (!(r.bottom > -vh && r.top < 2 * vh)) continue;
    }
    const line = lineFor(vh, wide, e.stageH);
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
    const first = !e.written;
    const activeChanged = first || e.state.active !== active;
    e.written = true;
    e.state = { q: Object.freeze(q), active };
    const vars = varsOf(root);
    q.forEach((v, i) => {
      const s = fmt(v);
      if (e.wroteQ[i] === s) return;
      e.wroteQ[i] = s;
      vars.style.setProperty(`--q${i}`, s);
    });
    if (activeChanged) {
      root.dataset.active = String(active);
      steps.forEach((s, i) => {
        s.dataset.active = i === active ? "true" : "false";
      });
    }
    notify.push(root);
  }
  for (const root of notify) emit(root);
}

/**
 * The reading line, viewport px: a step's progress runs 0 → 1 while it crosses this line. Wide
 * layouts read at mid-screen; the narrow layout reads 40% of the way down the space under the
 * sticky stage, where the active caption card sits.
 */
function lineFor(vh: number, isWide: boolean, stageH: number): number {
  return isWide ? 0.5 * vh : stageH + 0.4 * (vh - stageH);
}

/** The reading line the driver uses for `root`, measured now (for scrolling a step to a given progress). */
export function readingLine(root: HTMLElement): number {
  const isWide = typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY).matches : true;
  return lineFor(window.innerHeight, isWide, stageBottom(root));
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
  const vars = varsOf(root);
  for (let i = 0; vars.style.getPropertyValue(`--q${i}`) !== ""; i++) vars.style.removeProperty(`--q${i}`);
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
    stageH: stageBottom(root),
    wroteQ: [],
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
