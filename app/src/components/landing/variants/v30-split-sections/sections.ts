import { BEATS, BEAT_KEYS } from "@/lib/landing/sim/story";
import { BEAT_LABELS } from "../shared";

/*
 * Pure geometry for variant 30's sectioned chart: where each beat's section and name sit in the
 * chart's pixel space (27's ruler, adapted to a chart whose camera zooms instead of panning), how
 * much room the riding tooltips need right of the price head, and where the two tooltips go
 * vertically (27's layoutTags). No React, no DOM.
 */

export const STEPS_I = BEAT_KEYS.indexOf("steps");
const LAST_I = BEAT_KEYS.length - 1;

/** Below this plot width (px) the chart uses its phone sizes (smaller strip type and tooltips). */
export const COMPACT_W = 440;

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** A beat's section in story time (BEATS: the steps beat is a moment, start = end). */
export const sectionTimes = (): ReadonlyArray<{ start: number; end: number }> => BEATS.map((b) => ({ start: b.start, end: b.end }));

/** Rough width of a strip name in px: 13.5px wide / 12px phones, sized for the bold current state. */
export const nameWidth = (text: string, compact: boolean) => text.length * (compact ? 7.1 : 7.9) + 2;

export type NameLevel = "full" | "num" | "hidden";

export interface SectionName {
  i: number;
  level: NameLevel;
  /** Left edge of the text (px from the plot's left). */
  left: number;
  width: number;
  text: string;
}

/**
 * Lays out the strip's section names for the beat bands `px` (x0..x1 in plot px, BEAT_KEYS order) in
 * a plot `w` px wide. A band name sticks to the visible left edge of its band ("01 Presale"); a band
 * too narrow for it shows only its number ("01"), and one too narrow for that shows nothing. The
 * last band, and the current one, may run on to the right edge. The steps beat is a moment: its name
 * ends just left of its diamond. Names never collide: when two would, the later name first moves right
 * inside its own band if it has room; otherwise the one that is not the current beat steps down
 * (full → number → hidden), the wider one first. Out-of-view sections have no name.
 */
export function layoutSections(px: ReadonlyArray<{ x0: number; x1: number }>, w: number, current: number, compact: boolean): SectionName[] {
  const inset = compact ? 6 : 10;
  const gap = compact ? 6 : 10;
  const spans = px.map(({ x0, x1 }, i) => {
    if (i === STEPS_I) return { lo: -Infinity, hi: x0 - 9, anchorEnd: true, inView: x0 >= 0 && x0 <= w };
    const a = Math.max(0, x0);
    const b = Math.min(w, i === LAST_I ? Math.max(x1, w) : x1);
    // The current beat keeps its full name even in a narrow band: it may run on over the sections
    // after it (their names yield), never past the plot's right edge.
    const hi = i === current ? Math.max(b, w) - 6 : b - 6;
    // The band after the steps moment starts just right of its diamond: a little more inset.
    return { lo: a + (i === STEPS_I + 1 ? inset + 4 : inset), hi, anchorEnd: false, inView: b - a > 0.5 };
  });
  const text = (i: number, level: NameLevel) => (level === "full" ? `${pad2(i + 1)} ${BEAT_LABELS[BEAT_KEYS[i]!]}` : pad2(i + 1));
  const place = (i: number, level: NameLevel): SectionName => {
    if (level === "hidden" || !spans[i]!.inView) return { i, level: "hidden", left: 0, width: 0, text: "" };
    const t = text(i, level);
    const width = nameWidth(t, compact);
    const sp = spans[i]!;
    const left = sp.anchorEnd ? sp.hi - width : sp.lo;
    // It must fit its own span (and the steps name must stay inside the plot).
    const fits = sp.anchorEnd ? left >= 2 : left + width <= sp.hi;
    if (!fits) return level === "full" ? place(i, "num") : { i, level: "hidden", left: 0, width: 0, text: "" };
    return { i, level, left, width, text: t };
  };
  const out = px.map((_, i) => place(i, "full"));
  const down = (n: SectionName) => {
    out[n.i] = place(n.i, n.level === "full" ? "num" : "hidden");
  };
  for (let guard = 0; guard < 40; guard++) {
    const shown = out.filter((n) => n.level !== "hidden").sort((a, b) => a.left - b.left);
    let hit = false;
    for (let k = 1; k < shown.length; k++) {
      const p = shown[k - 1]!;
      const n = shown[k]!;
      if (p.left + p.width + gap <= n.left) continue;
      hit = true;
      // A band name with room left in its own band moves right, clear of an earlier beat's name.
      const nsp = spans[n.i]!;
      const room = p.left + p.width + gap;
      if (!nsp.anchorEnd && p.i < n.i && room + n.width <= nsp.hi) {
        out[n.i] = { ...n, left: room };
        break;
      }
      // Otherwise the current beat keeps its name; otherwise the wider name (then the one further away) yields.
      const victim =
        p.i === current ? n : n.i === current ? p : p.width !== n.width ? (p.width > n.width ? p : n) : Math.abs(p.i - current) >= Math.abs(n.i - current) ? p : n;
      down(victim);
      break;
    }
    if (!hit) break;
  }
  return out;
}

/** The riding tooltips' sizes (px): label + value, plus a third line once trading opens. */
export interface TagSize {
  w: number;
  h0: number;
  h1: number;
  /** Gap between the head dot and the tooltip. */
  gap: number;
  /** Margin kept to the card's right edge. */
  margin: number;
}

export const tagSize = (compact: boolean): TagSize =>
  compact ? { w: 128, h0: 40, h1: 57, gap: 9, margin: 4 } : { w: 172, h0: 52, h1: 74, gap: 16, margin: 10 };

/**
 * Where the price head sits across the plot (0..1): far enough left that the tooltips fit beside it
 * on the blank chart to its right (as on 27's tape), never left of the middle.
 */
export function headFraction(w: number, tag: TagSize): number {
  if (!(w > 0)) return 0.7;
  return Math.min(0.85, Math.max(0.5, (w - tag.w - tag.gap - tag.margin) / w));
}

/**
 * Vertical centres of the price tag and the floor tag (height `h`), each as close to its own line as
 * possible, never overlapping (gap `gap`) and kept inside [top, bottom]. The higher value keeps the
 * upper slot, unless `priceOnTop` says which one should. `floorY` null: only the price tag. (27's.)
 */
export function layoutTags(
  priceY: number,
  floorY: number | null,
  h: number,
  top: number,
  bottom: number,
  gap = 6,
  priceOnTop?: boolean,
): { price: number; floor: number | null } {
  const lo = top + h / 2;
  const hi = bottom - h / 2;
  const clamp = (y: number) => Math.min(hi, Math.max(lo, y));
  if (floorY === null) return { price: clamp(priceY), floor: null };
  const need = h + gap;
  const priceAbove = priceOnTop ?? priceY <= floorY;
  let a = priceAbove ? priceY : floorY;
  let b = priceAbove ? floorY : priceY;
  if (a > b) {
    const mid = (a + b) / 2;
    a = mid;
    b = mid;
  }
  if (b - a < need) {
    const mid = (a + b) / 2;
    a = mid - need / 2;
    b = mid + need / 2;
  }
  if (a < lo) {
    b += lo - a;
    a = lo;
  }
  if (b > hi) {
    a -= b - hi;
    b = hi;
  }
  a = Math.max(lo, a);
  return priceAbove ? { price: a, floor: b } : { price: b, floor: a };
}
