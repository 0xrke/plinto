"use client";

import { useId } from "react";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  CHART,
  CHART_COPY,
  DASH,
  STROKE,
  TILE_FLOOR,
  TILE_NOW,
  TILE_REDEEMED,
  STORY_POS_END,
  storyFrame,
  alpha,
  SINCE_LISTING,
  formatPctChange,
  formatUsdWhole,
  sinceListing,
  tileValues,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { beatBounds, floorAtTime, layoutTags, niceTicks, tickLabel } from "./tapeGeometry";
import s from "./tapeCompact.module.css";

/*
 * Variant 34's tape: variant 29's split tape (copied from v29-split-tape/SplitTape.tsx), drawn in
 * the smaller card of 20's size; the price tag no longer dims on the redeem beat. 29's notes follow.
 *
 * Variant 29's tape: v27's fixed tape, adapted to the narrower left column of a split layout. Changes over 27: the playhead always sits in the middle of
 * the card; a value tag that would leave the card on the right flips to the left of the playhead; the
 * current beat's section is highlighted under its bright ruler name; and the split holds the
 * divided, labelled column before its floor part settles (splitPhase), as the founder asked.
 *
 * From 27: the whole story drawn along story time, panned
 * sideways so the frame's time sits under a fixed playhead. Left of the playhead is what has
 * happened; right of it is blank, hatched tape, and the two value tags ride the playhead there. The y
 * camera is the engine's (wide, then the close-up band during "steps"); the staircase is never
 * magnified, only the axis zooms. Drawn on the midnight chart card: white price, mint floor, rose
 * dashed arbitrage line and bounce.
 *
 * The split is v03's vertical raise column, drawn in dollars on the tape's own y axis. It fills at the
 * playhead during the presale, divides at the split (floor mint at the bottom, market iris above it,
 * fees butter on top, each labelled with its percent), and its floor part drops onto the floor slab
 * the staircase starts from. The tape then carries it away to the left, under the playhead.
 */

const STEPS_I = BEAT_KEYS.indexOf("steps");
const BOUNCE_I = BEAT_KEYS.indexOf("bounce");
const SPLIT_I = BEAT_KEYS.indexOf("split");
const PUMP_I = BEAT_KEYS.indexOf("pump");

const pad2 = (n: number) => String(n).padStart(2, "0");
const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

/** Split beat (beat progress): the column divides over SPLIT_DIVIDE, holds labelled, then its floor settles over SPLIT_SETTLE. */
export const SPLIT_DIVIDE: readonly [number, number] = [0, 0.3];
export const SPLIT_SETTLE: readonly [number, number] = [0.6, 1];

/**
 * The split's own pacing (the engine divides and settles almost at once): `grow` divides the column,
 * `reveal` drops its floor part onto the slab and fades the staircase in. 0 before the split, 1 after.
 */
export function splitPhase(f: StoryFrame): { grow: number; reveal: number } {
  if (f.beatIndex < SPLIT_I) return { grow: 0, reveal: 0 };
  if (f.beatIndex > SPLIT_I) return { grow: 1, reveal: 1 };
  return { grow: ramp(f.beatProgress, SPLIT_DIVIDE[0], SPLIT_DIVIDE[1]), reveal: ease(ramp(f.beatProgress, SPLIT_SETTLE[0], SPLIT_SETTLE[1])) };
}

const finalPaths = new WeakMap<VariantProps["m"], StoryFrame["path"]>();
/** The whole story's price path (the finished frame's), cached per launch. */
function finalPath(m: VariantProps["m"]): StoryFrame["path"] {
  let p = finalPaths.get(m);
  if (!p) {
    p = storyFrame(m, STORY_POS_END).path;
    finalPaths.set(m, p);
  }
  return p;
}
/** Wide view: the real-scale staircase is too small to see; the steps beat zooms in. */
export const FLOOR_WIDE_NOTE = "Floor steps: real scale, zoom next";
const FLOOR_WIDE_NOTE_LINES = ["Floor steps: real scale,", "zoom next"] as const;

/**
 * Story time visible behind the playhead: `wide` before the steps beat, easing to `full` with the
 * engine's zoom (0 → 1 during steps, then 1).
 */
export function tapeSpan(compact: boolean, zoom: number): number {
  // The playhead sits mid-card, so half the card holds this much story time.
  const wide = compact ? 3.6 : 3.8;
  const full = compact ? 5.4 : 5.6;
  return wide + (full - wide) * Math.min(1, Math.max(0, zoom));
}

/** Below this drawing width the tape uses its phone layout (own ruler row, smaller type). */
export const COMPACT_W = 520;
/** Ruler names fade over this many px at the card edges (27: 24px, too ghostly in the narrower card). */
const RULER_FADE = 10;
/** Height of the card's chip row (the corner pills sit at 10px, 22px tall). The ruler runs under it. */
export const CHIP_ROW = 40;

/** Rough glyph widths (em) of Plus Jakarta Sans, bold: narrow, wide, capitals, digits, space, the rest. */
const glyphEm = (c: string) =>
  c === " " ? 0.27 : /[iljtfrI]/.test(c) ? 0.32 : /[mwMW]/.test(c) ? 0.86 : /[A-Z]/.test(c) ? 0.68 : /[0-9]/.test(c) ? 0.6 : 0.56;
/**
 * Width of a ruler label ("NN Name") at 13px on phones and 16px wide, bold (the widest state). 29
 * used a flat 8.4px a glyph, which under-measured "06 Bounce" so it could touch "07" in this card.
 */
const labelWidth = (text: string, compact: boolean) => [...`00 ${text}`].reduce((a, c) => a + glyphEm(c), 0) * (compact ? 13 : 16) * 1.06 + 2;
/** Rough width of a raised chip ("Peak $400 ↑"), padding included: 11.5px phones, 12.5px wide. */
const chipWidth = (text: string, compact: boolean) => text.length * (compact ? 6.6 : 7.2) + (compact ? 18 : 22);

export interface TapeProps {
  m: VariantProps["m"];
  frame: StoryFrame;
  /** Drawing size in px (the SVG viewBox). */
  w: number;
  h: number;
  className?: string;
}

export function CompactTape({ m, frame, w, h, className = "" }: TapeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const compact = w < COMPACT_W;
  const b = beatBounds(m);

  // The ruler has its own row, under the card's chip row (the tape box starts below the chips), so
  // beat names never meet the Illustration pill or the scale chip.
  const RULER = compact ? 30 : 38;
  const resL = compact ? 8 : 12;
  const resR = compact ? 10 : 14;
  const FOOT = compact ? 16 : 20;
  const top = RULER + (compact ? 16 : 26);
  const bot = h - FOOT - 8;
  /* Value tags ride the playhead on the narrow strip of unwritten tape to its right. */
  const tagW = compact ? 124 : 172;
  // A tag is label + value, plus a third line with the change since listing once trading opens.
  const tagH0 = compact ? 36 : 50;
  const tagH1 = compact ? 52 : 74;
  // Clear of the price head's 10px halo on phones too (29 used 8px there).
  const tagGap = compact ? 12 : 18;
  // The playhead (and so the current action) always sits in the middle of the card.
  const playX = Math.round(w * 0.5);
  // The tags ride right of the playhead; if the card is too narrow for that, they flip to its left.
  const tagPad = compact ? 6 : 16;
  const flip = playX + tagGap + tagW > w - tagPad;
  /*
   * Time camera: how much story time the tape shows behind the playhead. During "steps" (where the
   * engine's y camera closes in on the floor) the tape zooms out too, so the whole staircase sits
   * behind the playhead; from then on the wider window keeps several steps in view.
   */
  const pastSpan = tapeSpan(compact, frame.zoom);
  const ppt = playX / pastSpan;
  /** Labels fade out as they reach the fixed y labels at the left edge. */
  const edge = (x: number) => Math.min(1, Math.max(0, compact ? (x - 30) / 14 : (x - 60) / 30));
  /** Rough width of an 11.5px bold chart label. */
  const textW = (text: string) => text.length * (compact ? 6.3 : 7.2);
  const X = (t: number) => playX + (t - frame.t) * ppt;
  const span = frame.y.max - frame.y.min || 1;
  const Y = (v: number) => bot - ((v - frame.y.min) / span) * (bot - top);
  const xy = (t: number, v: number) => `${X(t).toFixed(1)} ${Y(v).toFixed(1)}`;
  const line = (pts: ReadonlyArray<readonly [number, number]>) => pts.map(([t, v], i) => `${i ? "L" : "M"}${xy(t, v)}`).join("");

  const tLeft = frame.t - playX / ppt;
  const tRight = frame.t + (w - playX) / ppt;
  const inView = (t: number, margin = 0.4) => t >= tLeft - margin && t <= tRight + margin;

  /* ---- price and floor ---- */
  const path = frame.path;
  const priceD = line(path);
  const steps = frame.floorSteps;
  const floorD = steps.length > 1 ? line(steps) : "";
  const floorArea = floorD ? `${floorD}L${X(steps[steps.length - 1]![0]).toFixed(1)} ${bot}L${X(steps[0]![0]).toFixed(1)} ${bot}Z` : "";

  /* ---- arbitrage line: the floor staircase × arbLineRatio, from the bounce on ---- */
  let arbD = "";
  let arbStrip = "";
  let arbStartV = 0;
  // The dip fills the bounce band and the selloff's last drop runs down its left edge, so the label
  // leads into the line from the left, clear of that drop, just under the line's level: the treads
  // there are higher (the floor only climbs), so the text keeps off the staircase.
  const arbLabelX = X(b.start[BOUNCE_I]!) - (compact ? 14 : 18);
  if (frame.arbLine100 !== null) {
    const t0 = b.start[BOUNCE_I]!;
    const f0 = floorAtTime(steps, t0) ?? frame.floor100 ?? 0;
    const floorPts: Array<[number, number]> = [[t0, f0]];
    for (const [t, v] of steps) if (t > t0) floorPts.push([t, v]);
    const arbPts = floorPts.map(([t, v]) => [t, v * m.arbLineRatio] as [number, number]);
    arbStartV = arbPts[0]![1];
    arbD = line(arbPts);
    // The rose strip between the arbitrage line and the floor, as on the landing chart.
    arbStrip = `${arbD}${[...floorPts].reverse().map(([t, v]) => `L${xy(t, v)}`).join("")}Z`;
  }

  /* ---- y grid ---- */
  const hundredIn = 100 >= frame.y.min && 100 <= frame.y.max;
  const ticks = niceTicks(frame.y.min, frame.y.max, compact ? 3 : 4).filter((v) => !(hundredIn && Math.abs(v - 100) < 1e-6) && Y(v) > top - 4 && Y(v) < bot + 1);

  /*
   * ---- the raise column (v03): your $100 as one stacked column on the $ axis ----
   * Its right edge sits on the presale/split boundary, which is where the floor staircase starts, so
   * the settled floor part lands flush on the slab. During the presale that boundary is still right
   * of the playhead: the column waits just left of it, filling, until the tape carries it away.
   */
  const { grow: split, reveal } = splitPhase(frame);
  const colW = compact ? 40 : Math.round(Math.min(110, Math.max(72, w * 0.08)));
  const rx = compact ? 3 : 4;
  // A clear gap keeps the column apart from the playhead, its dot and the price line's end.
  const colGap = compact ? 10 : 28;
  const colRight = Math.min(X(b.start[SPLIT_I]!), playX - colGap);
  const colLeft = colRight - colW;
  const colMid = colLeft + colW / 2;
  const segs = columnSegments(m);
  const floorGross = m.floorPer100GrossUsd;
  /* The floor part drops from its share of the raise to what the floor pays per $100. */
  const drop = ease(ramp(reveal, 0, 0.6));
  const floorTop = segs.floor.to * 100 + (floorGross - segs.floor.to * 100) * drop;
  /* Thin gaps open between the parts as the column divides (px). */
  const gapPx = 3 * ease(ramp(split, 0, 0.4));
  /* Once settled, the floor part is flush with the staircase's first tread. */
  const floorGap = (gapPx / 2) * (1 - drop);
  // Once trading opens the column has said its piece: labels go first, then market and fees.
  const after = frame.pos - (SPLIT_I + 1);
  // Quick fades: half-faded iris and butter over the pump's first rise read as mud, not as a split.
  const labelsOut = 1 - ramp(after, 0, 0.1);
  const restOut = 1 - ramp(after, 0.02, 0.14);
  // The column is drawn against $0..$100: when the camera closes in on the floor it would run off
  // scale, so the whole column fades with the engine's zoom (and is long gone by then anyway).
  const colOpacity = (1 - Math.min(1, frame.zoom * 2)) * edge(colLeft + 20);
  const showColumn = frame.beatIndex <= PUMP_I && colOpacity > 0.01 && colRight > -20;
  const fill = Math.min(100, (frame.raisedUsd / m.raiseUsd) * 100);
  const colour = ramp(split, 0, 0.35);
  const labelSize = compact ? 12.5 : 16;
  const labelX = colLeft - (compact ? 8 : 12);
  const pctOf = (usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;
  const splitLabels = [
    { key: "fees", text: `Fees ${CHART_COPY.fees(pctOf(m.split.creatorUsd), pctOf(m.split.platformUsd))}`, mid: (segs.creator.from + segs.platform.to) * 50, cls: s.splitFees, o: ramp(split, 0.55, 0.85) * restOut },
    { key: "market", text: `${CHART_COPY.market} ${pctOf(m.split.poolUsd)}%`, mid: (segs.market.from + segs.market.to) * 50, cls: s.splitMarket, o: ramp(split, 0.3, 0.6) * restOut },
    { key: "floor", text: CHART_COPY.floorShare(Math.round(m.v * 100)), mid: floorTop / 2, cls: s.splitFloor, o: ramp(split, 0.05, 0.35) },
  ];
  /*
   * Each label fades only as its own left end nears the card edge (Outfit bold is about 0.56em a
   * glyph). The labels sit at $17–$95, between the $0 / $50 / $100 tick labels, so they may pass
   * over the tick column without touching a tick.
   */
  const labelFade = (text: string) => ramp(labelX - text.length * labelSize * 0.53, -2, 6);

  /* ---- markers and labels ---- */
  /** Baseline of the "Bounce" label, under the dip dot. */
  const bounceLabelY = (dipY: number) => Math.min(bot - 2, dipY + 24);
  const holders = frame.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  /*
   * "+x% from exits" sits by its riser, where the exits beat's price swings through: v19 always put
   * it above-left, across the spike. Take the first spot the price never crosses, tested against the
   * whole story's path. The test is pan-invariant, so the choice never flips mid-scroll.
   */
  let exitsLabel: { x: number; y: number; left: number; anchor: "start" | "end" } | null = null;
  if (holders && frame.exitsPct !== null) {
    const lw = textW(CHART_COPY.fromExits(frame.exitsPct));
    const hx = X(holders.t);
    const hy = Y(holders.to);
    const full = finalPath(m);
    const crossed = (xa: number, xb: number, ya: number, yb: number) => {
      for (let i = 1; i < full.length; i++) {
        const x1 = X(full[i - 1]![0]);
        const x2 = X(full[i]![0]);
        if (Math.max(x1, x2) < xa || Math.min(x1, x2) > xb) continue;
        // The part of the segment inside [xa, xb], then its y range.
        const at = (x: number) => {
          const k = x2 === x1 ? 0 : (x - x1) / (x2 - x1);
          return Y(full[i - 1]![1] + (full[i]![1] - full[i - 1]![1]) * Math.min(1, Math.max(0, k)));
        };
        const ys = [at(Math.max(Math.min(x1, x2), xa)), at(Math.min(Math.max(x1, x2), xb))];
        if (Math.max(...ys) < ya || Math.min(...ys) > yb) continue;
        return true;
      }
      return false;
    };
    // Above the tread, else under the arbitrage line (the price only dips below it at the bounce).
    // Always left of the riser: right of it is blank tape while the riser is new.
    // The arbitrage line left of the riser sits on the floor before it.
    const arbY = Y((floorAtTime(steps, holders.t - 1e-6) ?? holders.to) * m.arbLineRatio);
    // Last resort (phones, where the exits' swings fill the band): under the "Bounce" label, over
    // the slab, where the price never goes (the dip is the path's lowest point from here on).
    // Nor on the "Bounce" label (on phones the dip sits right under the exits' riser).
    const bx = frame.dip ? Math.min(X(frame.dip.t), playX - textW(CHART_COPY.bounce) / 2 - 6) : 0;
    const by = frame.dip ? bounceLabelY(Y(frame.dip.value)) : 0;
    const bw = textW(CHART_COPY.bounce) / 2 + 4;
    const onBounce = (a: number, z: number, y: number) => frame.dip !== null && z >= bx - bw && a <= bx + bw && y + 4 >= by - 13 && y - 13 <= by + 4;
    const under = frame.dip ? bounceLabelY(Y(frame.dip.value)) + 24 : arbY + 38;
    const rows = [hy - 14, arbY + 20, arbY + 38, ...(under < bot - 6 ? [under] : [])];
    const options = rows.map((y) => ({ anchor: "end" as const, x: hx - 8, y, left: hx - 8 - lw }));
    exitsLabel =
      options.find((o) => !crossed(o.left - 2, o.left + lw + 2, o.y - 13, o.y + 4) && !onBounce(o.left, o.left + lw, o.y)) ?? options[0]!;
  }
  const feesAt = b.start[BOUNCE_I]!;
  const feesFloor = frame.feesPct !== null ? floorAtTime(steps, feesAt) : null;
  const priceY = Math.min(bot, Math.max(top, Y(frame.valueOf100)));
  const floorY = frame.floor100 !== null ? Math.min(bot, Math.max(top, Y(frame.floor100))) : null;
  const { now, floor } = tileValues(frame);
  const showFloorTag = floor !== "—" && floorY !== null && reveal > 0.5;

  // Both tags numeric: the larger number takes the upper tag, whatever the lines' order.
  const priceOnTop = now !== TILE_REDEEMED && frame.floorNet100 !== null ? frame.valueOf100 >= frame.floorNet100 : undefined;
  const change = sinceListing(m, frame);
  const priceH = change.now !== null ? tagH1 : tagH0;
  const floorH = change.floor !== null ? tagH1 : tagH0;
  const tags = layoutTags(priceY, showFloorTag ? floorY : null, Math.max(priceH, showFloorTag ? floorH : 0), top - 8, bot, 6, priceOnTop);
  const tagX = flip ? Math.max(2, playX - tagGap - tagW) : playX + tagGap;
  /** Where a connector leaves the playhead's dot: towards the tag's side. */
  const connFrom = (r: number) => (flip ? playX - r : playX + r);
  const connTo = flip ? tagX + tagW : tagX;
  const peakText = CHART_COPY.peak(frame.peak.value);
  const peakW = chipWidth(peakText, compact);
  const peakH = compact ? 22 : 24;
  const peakY = Math.max(top - 6, Math.min(bot - 30, Y(frame.peak.value) - 4));
  // The chip belongs to the peak: once the close-up camera puts the peak off the top, it goes too.
  const peakOpacity = ramp(Y(frame.peak.value), top - 2, top + 12);
  /*
   * "Bounce" sits under the dip, but never past the playhead (v19 let it run into the value tags
   * while the dip was still at the playhead). "+x% from fees" waits for the close-up: on the way in,
   * the selloff's last drop still runs diagonally through its spot.
   */
  const bounceX = frame.dip ? Math.min(X(frame.dip.t), playX - textW(CHART_COPY.bounce) / 2 - 6) : 0;
  const feesIn = ramp(frame.zoom, 0.6, 0.95);
  const plotH = h - RULER - FOOT;
  /** Ruler text line: the middle of its row. */
  const rulerMid = RULER / 2;
  /*
   * Presale: "Raised $X" over "of $10,000", left of the column at its fill level (v22's label). It
   * gives way to the split's labels as the column divides.
   */
  const raisedText = CHART_COPY.raised(frame.raisedUsd);
  const raisedOf = `of ${formatUsdWhole(m.raiseUsd)}`;
  const raisedSize = compact ? 12.5 : 17;
  const raisedX = colLeft - (compact ? 8 : 14);
  const raisedY = Math.min(Y(0) - raisedSize * 1.6, Math.max(Y(100) + raisedSize + 8, Y(fill) + raisedSize));
  const raisedOpacity = (1 - ramp(split, 0, 0.15)) * ramp(raisedX - raisedText.length * raisedSize * 0.53, -2, 6);
  /* The wide-camera floor note: two lines on phones so it stays clear of the split column. */
  const noteLines = compact ? FLOOR_WIDE_NOTE_LINES : [FLOOR_WIDE_NOTE];
  const noteLeft = playX - 12 - Math.max(...noteLines.map(textW));
  const noteClear = Math.min(1, Math.max(0, (noteLeft - colRight - 6) / 20));
  // As the price comes down onto the floor (selloff) the note would sit on the price line: it yields.
  const noteRoom = floorY !== null ? Math.min(1, Math.max(0, (floorY - priceY - 10 - noteLines.length * 15) / 24)) : 0;

  /*
   * ---- the section strip: one name per beat, riding its band ----
   * A name sticks to its band's left edge while the band runs past and is pushed out with the band's
   * end; a band too narrow for its name shows only its number. The steps beat is a moment, not a
   * band: its name sits left of its diamond. Then collisions are settled in priority order (the
   * current beat first, then its neighbours outwards): a name that would touch one already placed
   * slides right inside its own band, else falls back to its number, and hides if even that would
   * touch. So names never collide, and the current one is always named in full.
   */
  type RulerLabel = { i: number; x0: number; x1: number; end: number; lx: number; lw: number; full: boolean; anchorEnd: boolean; hidden: boolean };
  const numW = compact ? 18 : 22;
  const ruler: RulerLabel[] = [];
  BEAT_KEYS.forEach((key, i) => {
    const x0 = X(b.start[i]!);
    const x1 = X(b.end[i]!);
    if (x1 < -20 || x0 > w + 20) return;
    const current = i === frame.beatIndex;
    const nameW = labelWidth(BEAT_LABELS[key], compact);
    if (i === STEPS_I) {
      const full = !compact || current;
      ruler.push({ i, x0, x1, end: x0, lx: x0 - 9, lw: full ? nameW : numW, full, anchorEnd: true, hidden: false });
      return;
    }
    // The last beat has no band after it: its name may run on over the blank tape.
    const bandEnd = i === BEAT_KEYS.length - 1 ? Math.max(x1, w - resR) : x1;
    const inset = i === STEPS_I + 1 ? 14 : 10;
    const room = bandEnd - x0;
    const full = current || room >= nameW + inset + 6;
    const lw = full ? nameW : numW;
    const lx = full ? Math.max(x0 + inset, Math.min(Math.max(x0 + inset, resL + 4), bandEnd - lw - 6)) : x0 + inset - 4;
    ruler.push({ i, x0, x1, end: bandEnd, lx, lw, full, anchorEnd: false, hidden: false });
  });
  {
    const GAP = compact ? 8 : 12;
    const placed: Array<[number, number]> = [];
    const span = (lx: number, lw: number, anchorEnd: boolean) => (anchorEnd ? [lx - lw, lx] : [lx, lx + lw]) as [number, number];
    const clear = ([a, z]: [number, number]) => placed.every(([pa, pz]) => z + GAP <= pa || a >= pz + GAP);
    /** A band name blocked by one already placed may slide right inside its own band, past it. */
    const slide = (l: RulerLabel, lw: number): number | null => {
      if (l.anchorEnd) return null;
      let x = l.lx;
      for (let k = 0; k < 3; k++) {
        if (clear(span(x, lw, false))) return x + lw <= l.end - 4 ? x : null;
        x = Math.max(x, ...placed.filter(([pa, pz]) => x + lw + GAP > pa && x < pz + GAP).map(([, pz]) => pz + GAP));
      }
      return null;
    };
    const order = [...ruler].sort((p, q) => Math.abs(p.i - frame.beatIndex) - Math.abs(q.i - frame.beatIndex) || p.i - q.i);
    for (const l of order) {
      const current = l.i === frame.beatIndex;
      if (current || clear(span(l.lx, l.lw, l.anchorEnd))) {
        placed.push(span(l.lx, l.lw, l.anchorEnd));
        continue;
      }
      const tries: Array<[boolean, number]> = l.full ? [[true, l.lw], [false, numW]] : [[false, numW]];
      let done = false;
      for (const [full, lw] of tries) {
        const at = clear(span(l.lx, lw, l.anchorEnd)) ? l.lx : slide(l, lw);
        if (at !== null) {
          l.full = full;
          l.lw = lw;
          l.lx = at;
          placed.push(span(at, lw, l.anchorEnd));
          done = true;
          break;
        }
      }
      if (!done) l.hidden = true;
    }
    // A name that would run over a card edge shrinks to its number instead of sitting there
    // half-faded; only the number fades as it leaves. The current name always stays in full.
    for (const l of ruler) {
      if (!l.full || l.anchorEnd || l.i === frame.beatIndex) continue;
      if (l.lx + l.lw > w - resR - RULER_FADE) {
        l.full = false;
        l.lw = numW;
      } else if (l.lx < resL + RULER_FADE) {
        l.full = false;
        l.lw = numW;
        l.lx = Math.max(l.lx, l.end - numW - 6);
      }
    }
  }

  return (
    <svg className={`${s.svg} ${compact ? "" : s.wide} ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <clipPath id={`plot${uid}`}>
          <rect x={0} y={RULER} width={w} height={plotH} />
        </clipPath>
        <pattern id={`hatch${uid}`} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={8} className={s.hatch} />
        </pattern>
        <linearGradient id={`fadeL${uid}`} x1={0} y1={0} x2={1} y2={0}>
          <stop offset="0" style={{ stopColor: CHART.bg, stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: CHART.bg, stopOpacity: 0 }} />
        </linearGradient>
        <linearGradient id={`fadeR${uid}`} x1={0} y1={0} x2={1} y2={0}>
          <stop offset="0" style={{ stopColor: CHART.bg, stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: CHART.bg, stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Beat bands and boundaries; the presale band gets the site's sky tint. */}
      {BEAT_KEYS.map((key, i) => {
        const x0 = X(b.start[i]!);
        const x1 = X(b.end[i]!);
        if (x1 < -20 || x0 > w + 20) return null;
        return (
          <g key={key}>
            {x1 > x0 ? (
              <rect
                x={x0}
                y={RULER}
                width={x1 - x0}
                height={plotH}
                style={{ fill: i === 0 ? alpha(CHART.presale, 0.07) : i % 2 ? "transparent" : alpha(CHART.price, 0.02) }}
              />
            ) : null}
            {/* The current beat's section is lit, from its ruler name down to the sprockets. */}
            {i === frame.beatIndex && x1 > x0 ? (
              <rect data-part="section-current" x={x0} y={RULER} width={x1 - x0} height={plotH} style={{ fill: alpha(CHART.floor, 0.06) }} />
            ) : null}
            {i > 0 ? <line x1={x0} x2={x0} y1={RULER} y2={h - FOOT} className={i === STEPS_I ? s.boundaryZoom : s.boundary} /> : null}
          </g>
        );
      })}

      {/* Unwritten tape to the right of the playhead. */}
      <rect x={playX} y={RULER} width={w - playX} height={plotH} fill={`url(#hatch${uid})`} />

      <g clipPath={`url(#plot${uid})`}>
        {/* Grid. */}
        {ticks.map((v) => (
          <line key={v} x1={0} x2={w} y1={Y(v)} y2={Y(v)} className={s.grid} />
        ))}
        {hundredIn ? <line x1={0} x2={w} y1={Y(100)} y2={Y(100)} className={s.hundred} style={{ strokeDasharray: DASH.ref }} /> : null}

        {/* The raise column: fills during the presale, divides at the split, the floor part settles. */}
        {showColumn ? (
          <g opacity={colOpacity}>
            {colour < 1 ? (
              <rect data-part="raise-track" opacity={1 - colour} x={colLeft} y={Y(100)} width={colW} height={Math.max(0, Y(0) - Y(100))} rx={rx} className={s.colTrack} />
            ) : null}
            {split <= 0 ? (
              <rect data-part="raise-fill" x={colLeft} y={Y(fill)} width={colW} height={Math.max(0, Y(0) - Y(fill))} rx={rx} style={{ fill: CHART.presaleFill }} />
            ) : null}
            {split > 0 ? (
              <g>
                {(["platform", "creator", "market"] as const).map((key) => {
                  const y0 = Y(segs[key].to * 100) + gapPx / 2;
                  const y1 = Y(segs[key].from * 100) - gapPx / 2;
                  // Colour is laid over the opaque raise fill (not crossfaded with it), so it never turns muddy.
                  return (
                    <g key={key} opacity={restOut}>
                      {colour < 1 ? <rect x={colLeft} y={y0} width={colW} height={Math.max(0, y1 - y0)} rx={rx} style={{ fill: CHART.presaleFill }} /> : null}
                      <rect data-part={`split-${key}`} x={colLeft} y={y0} width={colW} height={Math.max(0, y1 - y0)} rx={rx} opacity={colour} className={key === "market" ? s.colMarket : s.colFees} />
                    </g>
                  );
                })}
                {colour < 1 ? (
                  <rect x={colLeft} y={Y(floorTop) + floorGap} width={colW} height={Math.max(0, Y(0) - Y(floorTop) - floorGap)} rx={rx} style={{ fill: CHART.presaleFill }} />
                ) : null}
                {/* The floor part: once trading opens it fades to the slab's own tint (mint at 14%). */}
                <rect
                  data-part="split-floor"
                  x={colLeft}
                  y={Y(floorTop) + floorGap}
                  width={colW}
                  height={Math.max(0, Y(0) - Y(floorTop) - floorGap)}
                  rx={rx}
                  opacity={colour * (0.14 + 0.86 * restOut)}
                  className={s.colFloor}
                />
              </g>
            ) : null}
            {split > 0 && labelsOut > 0.01 ? (
              <g opacity={labelsOut} textAnchor="end">
                {splitLabels.map((l) => (
                  <text key={l.key} data-part={`split-label-${l.key}`} opacity={l.o * labelFade(l.text)} x={labelX} y={Y(l.mid) + labelSize * 0.36} className={`${s.splitLabel} ${l.cls}`}>
                    {l.text}
                  </text>
                ))}
              </g>
            ) : null}
          </g>
        ) : null}
        {/* "Raised $X of $10,000" beside the filling column. */}
        {showColumn && frame.y.min === 0 && frame.raisedUsd >= 1 && raisedOpacity > 0.01 ? (
          <text data-part="raise-label" opacity={raisedOpacity * colOpacity} x={raisedX} y={raisedY} textAnchor="end" className={s.raisedLabel}>
            {raisedText}
            <tspan x={raisedX} dy={raisedSize * 1.15} className={s.raisedOf}>
              {raisedOf}
            </tspan>
          </text>
        ) : null}

        {/* Floor: the staircase, real scale, exact risers (miter joins). */}
        {floorD ? (
          <g opacity={reveal}>
            <path d={floorArea} style={{ fill: CHART.floorSlab }} />
            {arbStrip ? <path d={arbStrip} style={{ fill: CHART.arbStrip }} /> : null}
            <path d={floorD} data-part="floor-steps" className={s.floor} style={{ strokeWidth: STROKE.floor }} />
            {frame.events.map((e) => (
              <circle key={e.t} cx={X(e.t)} cy={Y(e.to)} r={e === holders ? 4 : 3} className={s.eventDot} />
            ))}
          </g>
        ) : null}

        {/* Wide camera, real scale: say why the staircase looks flat here. */}
        {floorD && frame.beatIndex >= PUMP_I && frame.zoom < 0.5 && floorY !== null ? (
          <text
            opacity={(1 - frame.zoom * 2) * Math.min(1, reveal) * noteRoom * (showColumn && restOut > 0.01 ? noteClear : 1)}
            x={playX - 12}
            y={floorY - 10 - (noteLines.length - 1) * 15}
            textAnchor="end"
            className={s.noteMint}
          >
            {noteLines.map((ln, k) => (
              <tspan key={ln} x={playX - 12} dy={k ? 15 : 0}>
                {ln}
              </tspan>
            ))}
          </text>
        ) : null}

        {/* Arbitrage line. */}
        {arbD ? (
          <>
            <path d={arbD} data-part="arb-line" className={s.arb} style={{ strokeWidth: STROKE.arb, strokeDasharray: DASH.arb }} />
            <text
              opacity={edge(arbLabelX - textW(CHART_COPY.arbLine))}
              x={arbLabelX}
              y={Y(arbStartV) + 13}
              textAnchor="end"
              className={s.noteRisk}
            >
              {CHART_COPY.arbLine}
            </text>
          </>
        ) : null}

        {/* Price. */}
        <path d={priceD} opacity={frame.priceOpacity} className={s.price} style={{ strokeWidth: STROKE.price }} />

        {/* Peak chip, bounce, fee and exit labels. */}
        {frame.t >= frame.peak.t - 1e-9 && inView(frame.peak.t, 1) && peakOpacity > 0.01 ? (
          <g opacity={edge(X(frame.peak.t) - peakW - 12) * peakOpacity}>
            <rect x={X(frame.peak.t) - 12 - peakW} y={peakY} width={peakW} height={peakH} rx={peakH / 2} style={{ fill: CHART.raised }} />
            <text x={X(frame.peak.t) - 12 - peakW / 2} y={peakY + peakH / 2 + 4.5} textAnchor="middle" className={s.chipText}>
              {peakText}
            </text>
          </g>
        ) : null}
        {frame.dip ? (
          <g>
            <circle cx={X(frame.dip.t)} cy={Y(frame.dip.value)} r={9} style={{ fill: CHART.bounceHalo }} />
            <circle data-part="bounce" cx={X(frame.dip.t)} cy={Y(frame.dip.value)} r={5} style={{ fill: CHART.bounce }} />
            <text opacity={edge(bounceX)} x={bounceX} y={bounceLabelY(Y(frame.dip.value))} textAnchor="middle" className={s.noteRiskBold}>
              {CHART_COPY.bounce}
            </text>
          </g>
        ) : null}
        {feesFloor !== null && frame.feesPct !== null ? (
          <text
            opacity={edge(X(feesAt) - 16 - textW(CHART_COPY.fromFees(frame.feesPct))) * feesIn}
            x={X(feesAt) - 16}
            y={Y(feesFloor) - 12} textAnchor="end" className={s.noteMintBold}>
            {CHART_COPY.fromFees(frame.feesPct)}
          </text>
        ) : null}
        {holders && exitsLabel && frame.exitsPct !== null ? (
          <text
            opacity={edge(exitsLabel.left)}
            x={exitsLabel.x}
            y={exitsLabel.y}
            textAnchor={exitsLabel.anchor}
            className={s.noteMintBold}
          >
            {CHART_COPY.fromExits(frame.exitsPct)}
          </text>
        ) : null}
      </g>

      {/* Fixed y labels over a soft edge. */}
      <rect x={0} y={RULER} width={compact ? 34 : 52} height={plotH} fill={`url(#fadeL${uid})`} />
      <rect x={w - (compact ? 16 : 32)} y={RULER} width={compact ? 16 : 32} height={plotH} fill={`url(#fadeR${uid})`} />
      {ticks.map((v) => (
        <text key={v} x={compact ? 8 : 14} y={Y(v) - 5} className={s.tick}>
          {tickLabel(v)}
        </text>
      ))}
      {hundredIn ? (
        <text x={compact ? 8 : 14} y={Y(100) - 5} className={s.tickHundred}>
          {CHART_COPY.hundred}
        </text>
      ) : null}

      {/* Ruler: beat names pass by. */}
      <line x1={0} x2={w} y1={RULER - 0.5} y2={RULER - 0.5} className={s.grid} />
      {ruler.map((l) => {
        const key = BEAT_KEYS[l.i]!;
        const state = l.i < frame.beatIndex ? s.past : l.i === frame.beatIndex ? s.current : s.future;
        const left = l.anchorEnd ? l.lx - l.lw : l.lx;
        // Anything that would cross a card edge fades out instead of being clipped, over a short
        // distance so a name never lingers half-faded (a ghost) at the edge of the narrower card.
        const fade = l.hidden ? 0 : Math.min(1, Math.max(0, (left - resL) / RULER_FADE), Math.max(0, (w - resR - (left + l.lw)) / RULER_FADE));
        const prog = l.i === frame.beatIndex && l.x1 > l.x0 ? Math.max(0, Math.min(l.x1, playX) - l.x0) : 0;
        return (
          <g key={key} className={state} data-section={key} data-current={l.i === frame.beatIndex ? "true" : undefined}>
            {l.i === STEPS_I ? (
              <path
                opacity={Math.min(1, Math.max(0, (l.x0 - 6 - resL) / 12), Math.max(0, (w - resR - l.x0 - 6) / 12))}
                d={`M${l.x0} ${rulerMid - 5}l5 5l-5 5l-5 -5Z`}
                className={s.diamond}
              />
            ) : null}
            {fade > 0.02 ? (
              <text data-part="section-name" opacity={fade} x={l.lx} y={rulerMid + (compact ? 4.5 : 5.5)} textAnchor={l.anchorEnd ? "end" : undefined} className={s.beatLabel}>
                <tspan className={s.beatNum}>{pad2(l.i + 1)}</tspan>
                {l.full ? ` ${BEAT_LABELS[key]}` : null}
              </text>
            ) : null}
            {prog > 0 ? <rect x={l.x0} y={RULER - 2} width={prog} height={2} rx={1} className={s.rulerProg} /> : null}
          </g>
        );
      })}

      {/* Sprockets. */}
      <line x1={0} x2={w} y1={h - FOOT + 0.5} y2={h - FOOT + 0.5} className={s.grid} />
      {Array.from({ length: Math.ceil((tRight - tLeft) / 0.2) + 2 }, (_, k) => {
        const t = Math.floor(tLeft / 0.2) * 0.2 + k * 0.2;
        return <rect key={k} x={X(t) - 4} y={h - FOOT / 2 - 2.5} width={8} height={5} rx={2.5} className={s.sprocket} />;
      })}

      {/* Playhead. */}
      <line data-part="playhead" x1={playX} x2={playX} y1={RULER} y2={h - FOOT} className={s.playhead} />
      <path d={`M${playX - 6} ${RULER}h12l-6 7Z`} className={s.playKnob} />
      <path d={`M${playX - 6} ${h - FOOT}h12l-6 -7Z`} className={s.playKnob} />

      {/* Value tags ride the playhead on the blank tape. */}
      {showFloorTag && floorY !== null && tags.floor !== null ? (
        <g data-part="tag-floor" opacity={reveal}>
          <circle cx={playX} cy={floorY} r={4.5} className={s.floorDot} />
          <path d={`M${connFrom(5)} ${floorY}L${connTo} ${tags.floor}`} className={s.connMint} />
          <TagBody x={tagX} cy={tags.floor} w={tagW} h={floorH} compact={compact} tone="floor" label={TILE_FLOOR} value={floor} pct={change.floor} part="floor" />
        </g>
      ) : null}
      {/* Only the dot and its connector dim with the price line once you have redeemed; the tag
          itself stays at full strength, so its value reads as well as the floor's (29 dimmed it all). */}
      <g data-part="tag-price">
        <g data-part="price-head" opacity={Math.max(0.55, frame.priceOpacity)}>
          <circle cx={playX} cy={priceY} r={10} style={{ fill: CHART.bounceHalo }} />
          <circle cx={playX} cy={priceY} r={5} className={s.priceDot} />
          <path d={`M${connFrom(6)} ${priceY}L${connTo} ${tags.price}`} className={s.connWhite} />
        </g>
        <TagBody x={tagX} cy={tags.price} w={tagW} h={priceH} compact={compact} tone="price" label={TILE_NOW} value={now} pct={change.now} part="price" />
      </g>
    </svg>
  );
}

/**
 * One value tag riding the playhead: label, value and (once trading opens) the change since listing
 * under the value. The floor's change reads in the floor colour; the price's is floor-green when up
 * and coral (risk) when down.
 */
function TagBody({
  x,
  cy,
  w,
  h,
  compact,
  tone,
  label,
  value,
  pct,
  part,
}: {
  x: number;
  cy: number;
  w: number;
  h: number;
  compact: boolean;
  tone: "price" | "floor";
  label: string;
  value: string;
  pct: number | null;
  part: "price" | "floor";
}) {
  const y0 = cy - h / 2;
  const pctClass = tone === "floor" ? s.pctFloor : pct !== null && pct < 0 ? s.pctDown : s.pctUp;
  return (
    <>
      <rect x={x} y={y0} width={w} height={h} rx={10} className={tone === "floor" ? s.tagFloor : s.tagPrice} />
      <text x={x + 10} y={y0 + (compact ? 13 : 18)} className={s.tagLabel}>
        {label}
      </text>
      <text x={x + 10} y={y0 + (compact ? 30 : 41)} className={s.tagValue}>
        {value}
      </text>
      {pct !== null ? (
        <text data-part={`pct-${part}`} x={x + 10} y={y0 + (compact ? 45 : 63)} className={s.tagPct}>
          <tspan className={pctClass}>{formatPctChange(pct)}</tspan>
          <tspan className={s.tagPctSuffix}> {SINCE_LISTING}</tspan>
        </text>
      ) : null}
    </>
  );
}

type SegKey = "floor" | "market" | "creator" | "platform";

/** The raise column's parts as cumulative shares of the raise, bottom to top (v03's columnSegments). */
function columnSegments(m: VariantProps["m"]): Record<SegKey, { from: number; to: number }> {
  const parts: Array<[SegKey, number]> = [
    ["floor", m.split.floorUsd],
    ["market", m.split.poolUsd],
    ["creator", m.split.creatorUsd],
    ["platform", m.split.platformUsd],
  ];
  let acc = 0;
  const out = {} as Record<SegKey, { from: number; to: number }>;
  for (const [key, usd] of parts) {
    const from = acc / m.raiseUsd;
    acc += usd;
    out[key] = { from, to: acc / m.raiseUsd };
  }
  return out;
}
