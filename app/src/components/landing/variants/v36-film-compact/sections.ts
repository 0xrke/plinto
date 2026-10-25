import { BEATS } from "@/lib/landing/sim/story";
import { BEAT_KEYS, BEAT_LABELS, type BeatKey } from "../shared";

/*
 * Pure geometry for variant 36's film frame (from v32), in card pixels: where the plot box sits inside the
 * midnight card (under the chip row and the section strip, above the supply lane at the bottom, short
 * of the right edge so the value tooltips can ride the price head), the section strip's labels (v27's
 * ruler logic, following the camera instead of a fixed playhead), and the placement of the tooltips
 * (v27's layoutTags). No React, no DOM.
 */

/** Below this card width the frame uses its phone layout (smaller strip type, narrower tooltips). */
export const COMPACT_W = 640;
/** The card's chip row: the corner pills sit at 10px and are 22px tall. The strip runs under it. */
export const CHIP_ROW = 40;

export interface FilmGeometry {
  W: number;
  H: number;
  compact: boolean;
  /** Section strip: from `chip` to `chip + strip`. */
  chip: number;
  strip: number;
  /** Plot box insets (px): the camera's rectangle maps onto this box. */
  pt: number;
  pr: number;
  pb: number;
  pl: number;
  /** Tooltips: width, gap from the head, height without / with the change since listing. */
  tagW: number;
  tagGap: number;
  tagH0: number;
  tagH1: number;
  /** The supply lane at the card's bottom (a volume pane): its top and height, card px. */
  laneTop: number;
  laneH: number;
}

export function filmGeometry(W: number, H: number): FilmGeometry {
  const compact = W < COMPACT_W;
  const strip = compact ? 30 : 36;
  // Phones: v32's tooltips took ~135px of a 350px card; these are ~25px narrower and ~10px shorter
  // (smaller type, tighter padding), so the plot keeps more of the width.
  const tagW = compact ? 104 : 168;
  const tagGap = compact ? 8 : 16;
  // The supply lane: thin, at the bottom of the card, under the plot (the card does not grow; the plot
  // gives up the lane's height and a little air).
  const laneH = compact ? 28 : 42;
  const laneTop = H - (compact ? 8 : 10) - laneH;
  return {
    W,
    H,
    compact,
    chip: CHIP_ROW,
    strip,
    pt: CHIP_ROW + strip + Math.round(H * (compact ? 0.05 : 0.06)),
    // The plot ends where the tooltips need it to: head + gap + tooltip + a margin fits in the card.
    pr: tagGap + tagW + (compact ? 4 : 10),
    pb: H - laneTop + (compact ? 16 : 20),
    pl: Math.round(W * (compact ? 0.05 : 0.04)),
    tagW,
    tagGap,
    tagH0: compact ? 30 : 48,
    tagH1: compact ? 42 : 68,
    laneTop,
    laneH,
  };
}

export const STEPS_I = BEAT_KEYS.indexOf("steps");
const LAST_I = BEAT_KEYS.length - 1;

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Rough width of a strip label (number + name): 13px phones, 16px wide (bold, the widest state). */
export const labelWidth = (text: string, compact: boolean) => (text.length + 3) * (compact ? 7.2 : 8.9);
/** Width of a number-only label ("05"). */
const NUM_W = 18;

export type SectionState = "past" | "current" | "future";

export interface StripLabel {
  key: BeatKey;
  i: number;
  num: string;
  /** The beat's name, or null when its section is too narrow (number only). */
  name: string | null;
  x: number;
  anchor: "start" | "end";
  opacity: number;
  state: SectionState;
}

export interface StripLayout {
  labels: StripLabel[];
  /** Section boundaries in view (x px); `zoom` marks the steps moment (the camera's dive). */
  dividers: Array<{ x: number; zoom: boolean }>;
  /** The current section's band, clipped to the card (null for the steps moment). */
  band: { x0: number; x1: number } | null;
  /** The steps moment's diamond, when in view. */
  diamond: { x: number; opacity: number; state: SectionState } | null;
}

/**
 * The strip along the top of the frame: one section per beat, named inside its band. A label sticks to
 * its band's left edge (or the card's) and is pushed out with the band's end, so names never collide;
 * a band too narrow for its name shows only its number, and one too narrow even for that shows nothing.
 * A label whose band is out of view, or that would cross a card edge, fades out instead of clipping.
 * `cx` maps story time to card x (it follows the camera's pans and zooms).
 */
export function stripLayout(cx: (t: number) => number, W: number, compact: boolean, current: number): StripLayout {
  const resL = compact ? 8 : 12;
  const resR = compact ? 10 : 14;
  /** Where a label sticks while its band runs past the card's left edge. */
  const stick = resL + 4;
  const stepsLabelW = compact ? NUM_W : labelWidth(BEAT_LABELS.steps, false);
  const labels: StripLabel[] = [];
  const dividers: StripLayout["dividers"] = [];
  let band: StripLayout["band"] = null;
  let diamond: StripLayout["diamond"] = null;
  BEATS.forEach(({ key, start, end }, i) => {
    const x0 = cx(start);
    const x1 = cx(end);
    const state: SectionState = i < current ? "past" : i === current ? "current" : "future";
    // The bounce starts where the steps moment sits: one divider for both.
    if (i > 0 && i !== STEPS_I + 1 && x0 > -2 && x0 < W + 2) dividers.push({ x: x0, zoom: i === STEPS_I });
    if (i === current && x1 > x0) band = { x0: Math.max(0, x0), x1: Math.min(W, x1) };
    if (x1 < -20 || x0 > W + 20) return;
    let full: boolean;
    let lx: number;
    let anchor: StripLabel["anchor"] = "start";
    let fits = true;
    if (i === STEPS_I) {
      // A moment, not a band: its label sits left of the diamond (number only on phones).
      full = !compact;
      lx = x0 - 9;
      anchor = "end";
      diamond = { x: x0, opacity: Math.min(1, Math.max(0, (x0 - 6 - resL) / 12), Math.max(0, (W - resR - x0 - 6) / 12)), state };
    } else {
      // The last beat has no band after it: its name may run on towards the card's right edge.
      // The label sticks at the card's left edge while its band runs past it (fully readable there),
      // and is pushed out with the band's end: it drops to its number when the visible part of the band
      // gets too narrow for the name, then fades as the number is pushed past the edge.
      const bandEnd = i === LAST_I ? Math.max(x1, W - resR) : x1;
      const limit = bandEnd - (i + 1 === STEPS_I ? stepsLabelW + 14 : 0) - 6;
      const inset = i === STEPS_I + 1 ? 14 : 10;
      const start = Math.max(x0 + inset, stick);
      full = limit - start >= labelWidth(BEAT_LABELS[key], compact);
      const numStart = Math.max(x0 + inset - 4, stick);
      // A number may only slide left out of its band at the card's edge; inside the card it hides.
      fits = full || numStart === stick || limit - NUM_W >= numStart;
      lx = Math.min(full ? start : numStart, limit - NUM_W);
    }
    const lw = full ? labelWidth(BEAT_LABELS[key], compact) : NUM_W;
    const left = anchor === "end" ? lx - lw : lx;
    // Anything that would cross a card edge fades out instead of being clipped; a label resting at
    // the sticky left position stays at full strength (no half-faded ghosts). The left ramp ends before
    // the label's left edge comes within 4px of the card's edge, so a number pushed out to the left never
    // shows cut off by the card's rounded corner.
    const opacity = fits ? Math.min(1, Math.max(0, (left - resL + 4) / 8), Math.max(0, (W - resR - (left + lw)) / 24)) : 0;
    labels.push({ key, i, num: pad2(i + 1), name: full ? BEAT_LABELS[key] : null, x: lx, anchor, opacity, state });
  });
  return { labels, dividers, band, diamond };
}

/**
 * Vertical centres of the price tooltip and the floor tooltip (height `h`), each as close to its own
 * line as possible, never overlapping (gap `gap`) and kept inside [top, bottom]. The higher value keeps
 * the upper slot, unless `priceOnTop` says which one should. `floorY` null: only the price tooltip.
 * Copied from v27's tapeGeometry.
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
