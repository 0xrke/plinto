import type { LaunchMath } from "@/lib/landing/sim/launch";
import type { StoryFrame } from "@/lib/landing/sim/story";
import { T_GRAD, beatEnd } from "@/lib/landing/sim/timeline";
import { STORY_POS_END, STORY_T_END, storyFrame } from "@/lib/landing/sim/story";
import { areaUnderD, makeScales, monotonePathD, niceTicks, stepPathD, stripBetweenD, VB, type Pt, type Scales } from "@/components/landing/lab/storyChartGeometry";

/*
 * Pure geometry for the Swiss mono chart (site style), copied from v07-swiss-mono: one price line,
 * the floor staircase and the arbitrage line under it, plus the strip between them (the landing's
 * rose strip). The SVG is a 1000 × 1000 box stretched over the plot; HTML labels use the same scales
 * in percent.
 */

/** The staircase from story time `from` on (the first vertex is the floor's value at `from`). */
export function stepsFrom(steps: ReadonlyArray<Pt>, from: number): Pt[] {
  if (steps.length === 0 || steps[steps.length - 1]![0] < from) return [];
  let start: Pt | null = null;
  const out: Pt[] = [];
  for (const p of steps) {
    if (p[0] < from) start = [from, p[1]];
    else out.push(p);
  }
  return start ? [start, ...out] : out;
}

/** The x window's right edge before the close-up: the head sits at this share of the width. */
const HEAD_AT = 0.9;
/** Before the pump the window shows at least presale + split. */
const X_MIN_END = beatEnd("split") / HEAD_AT;

/**
 * Right edge of the x window (story time). Until the close-up the window follows the price head so
 * the line always spans the plot (no empty right side); the steps beat's zoom eases it out to the
 * full story, together with the y close-up.
 */
export function xEnd(frame: StoryFrame): number {
  const follow = Math.min(STORY_T_END, Math.max(X_MIN_END, frame.t / HEAD_AT));
  return follow + (STORY_T_END - follow) * frame.zoom;
}

/** makeScales with a custom x window [0, end]. */
function scalesFor(y: { min: number; max: number }, end: number): Scales {
  const base = makeScales(y);
  return { ...base, xOf: (t) => (t / end) * VB, pctX: (t) => (t / end) * 100 };
}

/** Share of the plot height the magnified inset takes, and of the inset its staircase spans. */
export const INSET_H = 0.26;
export const INSET_FILL = 0.6;
/** Inset x window: graduation to the end of the selloff (the wide-view beats). */
const INSET_T: readonly [number, number] = [T_GRAD, beatEnd("selloff")];

const insetDomainCache = new WeakMap<LaunchMath, { min: number; max: number }>();
/** The inset's fixed y domain: the whole story's floor range, so the staircase grows into it. */
function insetDomain(m: LaunchMath): { min: number; max: number } {
  let d = insetDomainCache.get(m);
  if (!d) {
    const ys = storyFrame(m, STORY_POS_END).floorSteps.map(([, v]) => v);
    d = { min: Math.min(...ys), max: Math.max(...ys) };
    insetDomainCache.set(m, d);
  }
  return d;
}

export interface SwissInset {
  d: string;
  /** Vertical magnification versus the main plot. */
  factor: number;
  opacity: number;
}

/**
 * While the wide view squashes the floor to a line, a small inset shows the same staircase with an
 * explicit magnification factor (factor = inset px per dollar ÷ main px per dollar).
 */
export function swissInset(m: LaunchMath, frame: StoryFrame): SwissInset | null {
  if (frame.floorSteps.length < 1 || frame.zoom >= 1 || frame.beatIndex < 2) return null;
  const dom = insetDomain(m);
  const span = dom.max - dom.min || 1;
  const pad = (1 - INSET_FILL) / 2;
  const [t0, t1] = INSET_T;
  const head = frame.floorSteps[frame.floorSteps.length - 1]!;
  const pts: Pt[] = [...frame.floorSteps, [Math.min(t1, Math.max(head[0], frame.t)), head[1]]];
  const d = pts
    .filter(([t]) => t <= t1)
    .map(([t, v], i) => {
      const x = ((t - t0) / (t1 - t0)) * VB;
      const y = VB * (1 - pad - ((v - dom.min) / span) * INSET_FILL);
      return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const factor = (INSET_H * INSET_FILL * (frame.y.max - frame.y.min)) / span;
  return { d, factor, opacity: frame.floorReveal * (1 - frame.zoom) };
}

export interface SwissChartGeometry {
  priceD: string;
  floorD: string;
  floorAreaD: string;
  arbD: string;
  /** The strip between the arbitrage line and the floor. */
  arbStripD: string;
  /** Head of the price line and of the floor, in percent of the plot (left, top). */
  priceHead: { x: number; y: number };
  floorHead: { x: number; y: number } | null;
  arbHead: { x: number; y: number } | null;
  /** Left ends of the arbitrage line and of the floor (label anchors). */
  arbStart: { x: number; y: number } | null;
  floorStart: { x: number; y: number } | null;
  /** The dashed "$100 paid" reference, percent from the top, or null when out of view. */
  paidY: number | null;
  ticks: Array<{ v: number; y: number }>;
  dip: { x: number; y: number } | null;
  peak: { x: number; y: number } | null;
  /** Presale / split only: the presale band under the $100 line, and the raise filling it so far. */
  raiseBandD: string;
  raiseD: string;
}

/** A rectangle from story time t0 to t1, from value v down to the plot's bottom (SVG units). */
function underRect(s: Scales, t0: number, t1: number, v: number): string {
  if (!(t1 > t0)) return "";
  const x0 = s.xOf(t0).toFixed(2);
  const x1 = s.xOf(t1).toFixed(2);
  const y = Math.max(0, s.yOf(v)).toFixed(2);
  return `M${x0} ${y} L${x1} ${y} L${x1} ${VB} L${x0} ${VB} Z`;
}

export function swissChart(m: LaunchMath, frame: StoryFrame): SwissChartGeometry {
  const s = scalesFor(frame.y, xEnd(frame));
  const head = frame.path[frame.path.length - 1]!;
  const fHead = frame.floorSteps[frame.floorSteps.length - 1];
  // The arbitrage line runs under the whole staircase, a fixed ratio below the floor.
  const arbSteps = frame.arbLine100 === null ? [] : frame.floorSteps;
  const aHead = arbSteps[arbSteps.length - 1];
  const inView = (v: number) => v > frame.y.min && v < frame.y.max;
  const presaleEnd = beatEnd("presale");
  const early = frame.beatIndex <= 1;
  return {
    raiseBandD: early ? underRect(s, 0, presaleEnd, 100) : "",
    raiseD: early ? underRect(s, 0, Math.min(presaleEnd, head[0]), 100) : "",
    priceD: monotonePathD(frame.path, s),
    floorD: frame.floorSteps.length > 1 ? stepPathD(frame.floorSteps, s) : "",
    floorAreaD: areaUnderD(frame.floorSteps, s),
    arbD: arbSteps.length > 1 ? stepPathD(arbSteps, s, m.arbLineRatio) : "",
    arbStripD: arbSteps.length > 1 ? stripBetweenD(arbSteps, m.arbLineRatio, s) : "",
    priceHead: { x: s.pctX(head[0]), y: s.pctY(head[1]) },
    floorHead: fHead ? { x: s.pctX(fHead[0]), y: s.pctY(fHead[1]) } : null,
    arbHead: aHead ? { x: s.pctX(aHead[0]), y: s.pctY(aHead[1] * m.arbLineRatio) } : null,
    arbStart: arbSteps.length > 1 ? { x: s.pctX(arbSteps[0]![0]), y: s.pctY(arbSteps[0]![1] * m.arbLineRatio) } : null,
    floorStart: frame.floorSteps.length > 1 ? { x: s.pctX(frame.floorSteps[0]![0]), y: s.pctY(frame.floorSteps[0]![1]) } : null,
    paidY: inView(100) ? s.pctY(100) : null,
    ticks: niceTicks(frame.y.min, frame.y.max, 4).map((v) => ({ v, y: s.pctY(v) })),
    dip: frame.dip && inView(frame.dip.value) ? { x: s.pctX(frame.dip.t), y: s.pctY(frame.dip.value) } : null,
    peak: frame.t >= frame.peak.t && inView(frame.peak.value * 0.999) && frame.zoom < 0.2 ? { x: s.pctX(frame.peak.t), y: s.pctY(frame.peak.value) } : null,
  };
}

/** Story time → percent from the left (for the x position of beat starts). */
export const pctOfT = (t: number): number => (t / STORY_T_END) * 100;
