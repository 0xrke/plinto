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
  alpha,
  floorSharePct,
  tileValues,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { beatBounds, floorAtTime, layoutTags, niceTicks, tickLabel } from "./geometry";
import s from "./tape.module.css";

/*
 * The tape (v09's idea, in the site's chart colours): the whole story drawn along story time, panned
 * sideways so the frame's time sits under a fixed playhead. Left of the playhead is what has
 * happened; right of it is blank, hatched tape, and the two value tags ride the playhead there. The y
 * camera is the engine's (wide, then the close-up band during "steps"); the staircase is never
 * magnified, only the axis zooms. Drawn on the midnight chart card: white price, mint floor, rose
 * dashed arbitrage line and bounce, iris / mint split column.
 */

const STEPS_I = BEAT_KEYS.indexOf("steps");
const BOUNCE_I = BEAT_KEYS.indexOf("bounce");
const SPLIT_I = BEAT_KEYS.indexOf("split");
const PUMP_I = BEAT_KEYS.indexOf("pump");
/** Wide view: the real-scale staircase is too small to see; the steps beat zooms in. */
export const FLOOR_WIDE_NOTE = "Floor steps: real scale, zoom next";
const FLOOR_WIDE_NOTE_LINES = ["Floor steps: real scale,", "zoom next"] as const;

/**
 * Story time visible behind the playhead: `wide` before the steps beat, easing to `full` with the
 * engine's zoom (0 → 1 during steps, then 1).
 */
export function tapeSpan(compact: boolean, zoom: number): number {
  const wide = compact ? 3.2 : 5;
  const full = compact ? 5.6 : 6.6;
  return wide + (full - wide) * Math.min(1, Math.max(0, zoom));
}

/** Below this drawing width the tape uses its phone layout (own ruler row, smaller type). */
export const COMPACT_W = 640;
/** Height of the card's chip row (the corner pills sit at 10px, 22px tall). */
export const CHIP_ROW = 44;

/** Rough width of a ruler label (beat number + name): 12px phones, 13.5px wide. */
const labelWidth = (text: string, compact: boolean) => (text.length + 3) * (compact ? 6.4 : 7.6);
/** Rough width of a raised chip ("Peak $400 ↑"), padding included: 11.5px phones, 12.5px wide. */
const chipWidth = (text: string, compact: boolean) => text.length * (compact ? 6.6 : 7.2) + (compact ? 18 : 22);

export interface TapeProps {
  m: VariantProps["m"];
  frame: StoryFrame;
  /** Drawing size in px (the SVG viewBox). */
  w: number;
  h: number;
  /**
   * Room kept clear at the top-left / top-right for the card's corner chips. Wide tapes run the
   * ruler through the chip row, so beat names fade out before they reach a chip.
   */
  reserve?: { left: number; right: number };
  className?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

export function Tape({ m, frame, w, h, reserve = { left: 12, right: 12 }, className = "" }: TapeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const compact = w < COMPACT_W;
  const b = beatBounds(m);

  // Phones: the ruler gets its own row under the chips. Wide: the ruler is the chip row.
  const RULER = compact ? 28 : CHIP_ROW;
  const resL = compact ? 8 : reserve.left;
  const resR = compact ? 10 : reserve.right;
  const FOOT = compact ? 16 : 20;
  const top = RULER + (compact ? 16 : 26);
  const bot = h - FOOT - 8;
  /* Value tags ride the playhead on the narrow strip of unwritten tape to its right. */
  const tagW = compact ? 98 : 150;
  const tagH = compact ? 36 : 50;
  const tagGap = compact ? 8 : 18;
  const playX = Math.round(Math.min(w * (compact ? 0.7 : 0.72), w - tagW - tagGap - (compact ? 6 : 24)));
  /*
   * Time camera: how much story time the tape shows behind the playhead. During "steps" (where the
   * engine's y camera closes in on the floor) the tape zooms out too, so the whole staircase sits
   * behind the playhead; from then on the wider window keeps several steps in view.
   */
  const pastSpan = tapeSpan(compact, frame.zoom);
  const ppt = playX / pastSpan;
  const stepsLabelW = compact ? 16 : labelWidth(BEAT_LABELS.steps, false);
  /** Labels fade out as they reach the fixed y labels at the left edge. */
  const edge = (x: number) => Math.min(1, Math.max(0, compact ? (x - 36) / 30 : (x - 64) / 60));
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
  // Phones: the bounce band is narrow and the dip fills it, so the label leads into the line from the
  // left instead of sitting on the dip.
  const arbLabelX = compact ? X(b.start[BOUNCE_I]!) - 6 : Math.max(X(b.start[BOUNCE_I]!) + 96, playX - 10);
  if (frame.arbLine100 !== null) {
    const t0 = b.start[BOUNCE_I]!;
    const f0 = floorAtTime(steps, t0) ?? frame.floor100 ?? 0;
    const floorPts: Array<[number, number]> = [[t0, f0]];
    for (const [t, v] of steps) if (t > t0) floorPts.push([t, v]);
    const arbPts = floorPts.map(([t, v]) => [t, v * m.arbLineRatio] as [number, number]);
    arbD = line(arbPts);
    // The rose strip between the arbitrage line and the floor, as on the landing chart.
    arbStrip = `${arbD}${[...floorPts].reverse().map(([t, v]) => `L${xy(t, v)}`).join("")}Z`;
  }

  /* ---- y grid ---- */
  const hundredIn = 100 >= frame.y.min && 100 <= frame.y.max;
  const ticks = niceTicks(frame.y.min, frame.y.max, compact ? 3 : 4).filter((v) => !(hundredIn && Math.abs(v - 100) < 1e-6) && Y(v) > top - 4 && Y(v) < bot + 1);

  /* ---- split column: your $100 dissolves into floor + market ---- */
  const splitT = (b.start[SPLIT_I]! + b.end[SPLIT_I]!) / 2;
  const split = frame.splitProgress;
  const colW = compact ? 16 : 22;
  const floorGross = m.floorPer100GrossUsd;
  const floorPart = floorGross * ease((split - 0.15) / 0.85);
  // Labels go right of the column, or left of it when they would run onto the playhead's blank tape.
  // Once trading opens the column speaks for itself; its labels make room for the floor note.
  const splitLabelFade = Math.min(1, Math.max(0, 1 - (frame.pos - (SPLIT_I + 1)) * 3));
  const splitLeft = X(splitT) + colW / 2 + 80 > playX;
  // The column is drawn against $0..$100: once the camera closes in on the floor (steps on) it would
  // run off-scale as a full-height bar, so it fades out with the engine's zoom.
  const colOpacity = Math.min(1, split * 3) * (1 - Math.min(1, frame.zoom * 1.6));
  const colRight = X(splitT) + colW / 2;
  const splitLabelX = splitLeft ? X(splitT) - colW / 2 - 8 : X(splitT) + colW / 2 + 8;

  /* ---- markers and labels ---- */
  const holders = frame.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const feesAt = b.start[BOUNCE_I]!;
  const feesFloor = frame.feesPct !== null ? floorAtTime(steps, feesAt) : null;
  const priceY = Math.min(bot, Math.max(top, Y(frame.valueOf100)));
  const floorY = frame.floor100 !== null ? Math.min(bot, Math.max(top, Y(frame.floor100))) : null;
  const { now, floor } = tileValues(frame);
  const showFloorTag = floor !== "—" && floorY !== null;

  const tags = layoutTags(priceY, showFloorTag ? floorY : null, tagH, top - 8, bot);
  const tagX = playX + tagGap;
  const peakText = CHART_COPY.peak(frame.peak.value);
  const peakW = chipWidth(peakText, compact);
  const peakH = compact ? 22 : 24;
  const peakY = Math.max(top - 6, Math.min(bot - 30, Y(frame.peak.value) - 4));
  const plotH = h - RULER - FOOT;
  /** Ruler text line: the row's middle on phones, the corner chips' middle on wide cards. */
  const rulerMid = compact ? RULER / 2 : 21;
  /* "Raised $…" sits under the presale band, kept clear of the playhead while the band is short. */
  const raisedText = CHART_COPY.raised(frame.raisedUsd);
  const raisedW = textW(raisedText);
  const raisedX = Math.min(X((b.start[0]! + b.end[0]!) / 2), playX - 12 - raisedW / 2);
  /* The wide-camera floor note: two lines on phones so it stays clear of the split column. */
  const noteLines = compact ? FLOOR_WIDE_NOTE_LINES : [FLOOR_WIDE_NOTE];
  const noteLeft = playX - 12 - Math.max(...noteLines.map(textW));
  const noteClear = Math.min(1, Math.max(0, (noteLeft - colRight - 6) / 20));
  // As the price comes down onto the floor (selloff) the note would sit on the price line: it yields.
  const noteRoom = floorY !== null ? Math.min(1, Math.max(0, (floorY - priceY - 10 - noteLines.length * 15) / 24)) : 0;

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

        {/* Presale: the raise fills. */}
        {inView(b.start[0]!, 1) && frame.y.min === 0 ? (
          <text opacity={edge(raisedX - raisedW / 2)} x={raisedX} y={Y(100) + 26} className={s.note} textAnchor="middle">
            {raisedText}
          </text>
        ) : null}

        {/* Split column. */}
        {split > 0 && colOpacity > 0.01 && inView(splitT, 1) ? (
          <g opacity={colOpacity}>
            <rect x={X(splitT) - colW / 2} y={Y(100)} width={colW} height={Math.max(0, Y(0) - Y(100))} rx={4} className={s.colMarket} />
            <rect x={X(splitT) - colW / 2} y={Y(floorPart)} width={colW} height={Math.max(0, Y(0) - Y(floorPart))} rx={4} className={s.colFloor} />
            <g opacity={ease((split - 0.55) / 0.45) * splitLabelFade} textAnchor={splitLeft ? "end" : "start"}>
              <text x={splitLabelX} y={(Y(100) + Y(floorGross)) / 2 + 4} className={s.noteIris}>
                {CHART_COPY.market}
              </text>
              <text x={splitLabelX} y={(Y(floorGross) + Y(0)) / 2 + 4} className={s.noteMint}>
                {CHART_COPY.floorShare(floorSharePct(m))}
              </text>
            </g>
          </g>
        ) : null}

        {/* Floor: the staircase, real scale, exact risers (miter joins). */}
        {floorD ? (
          <g opacity={frame.floorReveal}>
            <path d={floorArea} style={{ fill: CHART.floorSlab }} />
            {arbStrip ? <path d={arbStrip} style={{ fill: CHART.arbStrip }} /> : null}
            <path d={floorD} className={s.floor} style={{ strokeWidth: STROKE.floor }} />
            {frame.events.map((e) => (
              <circle key={e.t} cx={X(e.t)} cy={Y(e.to)} r={e === holders ? 4 : 3} className={s.eventDot} />
            ))}
          </g>
        ) : null}

        {/* Wide camera, real scale: say why the staircase looks flat here. */}
        {floorD && frame.beatIndex >= PUMP_I && frame.zoom < 0.5 && floorY !== null ? (
          <text
            opacity={(1 - frame.zoom * 2) * Math.min(1, frame.floorReveal) * noteRoom * (split > 0 && inView(splitT, 1) ? noteClear : 1)}
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
            <path d={arbD} className={s.arb} style={{ strokeWidth: STROKE.arb, strokeDasharray: DASH.arb }} />
            <text
              opacity={arbLabelX - (compact ? 74 : 84) > 4 ? 1 : 0}
              x={arbLabelX}
              y={Y(frame.arbLine100 ?? 0) + 16}
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
        {frame.t >= frame.peak.t - 1e-9 && inView(frame.peak.t, 1) ? (
          <g opacity={edge(X(frame.peak.t) - peakW - 12)}>
            <rect x={X(frame.peak.t) - 12 - peakW} y={peakY} width={peakW} height={peakH} rx={peakH / 2} style={{ fill: CHART.raised }} />
            <text x={X(frame.peak.t) - 12 - peakW / 2} y={peakY + peakH / 2 + 4.5} textAnchor="middle" className={s.chipText}>
              {peakText}
            </text>
          </g>
        ) : null}
        {frame.dip ? (
          <g>
            <circle cx={X(frame.dip.t)} cy={Y(frame.dip.value)} r={9} style={{ fill: CHART.bounceHalo }} />
            <circle cx={X(frame.dip.t)} cy={Y(frame.dip.value)} r={5} style={{ fill: CHART.bounce }} />
            <text opacity={edge(X(frame.dip.t))} x={X(frame.dip.t)} y={Math.min(bot - 2, Y(frame.dip.value) + 24)} textAnchor="middle" className={s.noteRiskBold}>
              {CHART_COPY.bounce}
            </text>
          </g>
        ) : null}
        {feesFloor !== null && frame.feesPct !== null ? (
          <text opacity={edge(X(feesAt) - 10 - textW(CHART_COPY.fromFees(frame.feesPct)))} x={X(feesAt) - 10} y={Y(feesFloor) - 12} textAnchor="end" className={s.noteMintBold}>
            {CHART_COPY.fromFees(frame.feesPct)}
          </text>
        ) : null}
        {holders && frame.exitsPct !== null ? (
          <text opacity={edge(X(holders.t) - 8 - textW(CHART_COPY.fromExits(frame.exitsPct)))} x={X(holders.t) - 8} y={Y(holders.to) - 14} textAnchor="end" className={s.noteMintBold}>
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
      {BEAT_KEYS.map((key, i) => {
        const x0 = X(b.start[i]!);
        const x1 = X(b.end[i]!);
        if (x1 < -20 || x0 > w + 20) return null;
        const state = i < frame.beatIndex ? s.past : i === frame.beatIndex ? s.current : s.future;
        const num = pad2(i + 1);
        let full = true;
        let lx: number;
        let anchorEnd = false;
        if (i === STEPS_I) {
          // A moment, not a band: its label sits left of the diamond (number only on phones).
          full = !compact;
          lx = x0 - 9;
          anchorEnd = true;
        } else {
          // The label rides inside its band: it sticks to the left edge while the band runs past and
          // is pushed out with the band's end. A band too narrow for its name shows only its number.
          const room = x1 - x0 - (i + 1 === STEPS_I ? stepsLabelW + 14 : 0);
          full = room >= labelWidth(BEAT_LABELS[key], compact) + 16;
          const lw = full ? labelWidth(BEAT_LABELS[key], compact) : 16;
          lx = full ? Math.min(Math.max(x0 + 10, resL + 4), x0 + room - lw - 6) : x0 + 6;
        }
        const lw = full ? labelWidth(BEAT_LABELS[key], compact) : 16;
        const left = anchorEnd ? lx - lw : lx;
        // Anything that would cross a card edge fades out instead of being clipped.
        const fade = Math.min(1, Math.max(0, (left - resL) / 24), Math.max(0, (w - resR - (left + lw)) / 24));
        const prog = i === frame.beatIndex && x1 > x0 ? Math.max(0, Math.min(x1, playX) - x0) : 0;
        return (
          <g key={key} className={state}>
            {i === STEPS_I ? (
              <path
                opacity={Math.min(1, Math.max(0, (x0 - 6 - resL) / 12), Math.max(0, (w - resR - x0 - 6) / 12))}
                d={`M${x0} ${rulerMid - 5}l5 5l-5 5l-5 -5Z`}
                className={s.diamond}
              />
            ) : null}
            {fade > 0.02 ? (
              <text opacity={fade} x={lx} y={rulerMid + (compact ? 4 : 4.5)} textAnchor={anchorEnd ? "end" : undefined} className={s.beatLabel}>
                <tspan className={s.beatNum}>{num}</tspan>
                {full ? ` ${BEAT_LABELS[key]}` : null}
              </text>
            ) : null}
            {prog > 0 ? <rect x={x0} y={RULER - 2} width={prog} height={2} rx={1} className={s.rulerProg} /> : null}
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
      <line x1={playX} x2={playX} y1={RULER} y2={h - FOOT} className={s.playhead} />
      <path d={`M${playX - 6} ${RULER}h12l-6 7Z`} className={s.playKnob} />
      <path d={`M${playX - 6} ${h - FOOT}h12l-6 -7Z`} className={s.playKnob} />

      {/* Value tags ride the playhead on the blank tape. */}
      {showFloorTag && floorY !== null && tags.floor !== null ? (
        <g opacity={frame.floorReveal}>
          <circle cx={playX} cy={floorY} r={4.5} className={s.floorDot} />
          <path d={`M${playX + 5} ${floorY}L${tagX} ${tags.floor}`} className={s.connMint} />
          <rect x={tagX} y={tags.floor - tagH / 2} width={tagW} height={tagH} rx={10} className={s.tagFloor} />
          <text x={tagX + 10} y={tags.floor - tagH / 2 + (compact ? 13 : 18)} className={s.tagLabel}>
            {TILE_FLOOR}
          </text>
          <text x={tagX + 10} y={tags.floor + tagH / 2 - (compact ? 7 : 10)} className={s.tagValue}>
            {floor}
          </text>
        </g>
      ) : null}
      <g opacity={Math.max(0.55, frame.priceOpacity)}>
        <circle cx={playX} cy={priceY} r={10} style={{ fill: CHART.bounceHalo }} />
        <circle cx={playX} cy={priceY} r={5} className={s.priceDot} />
        <path d={`M${playX + 6} ${priceY}L${tagX} ${tags.price}`} className={s.connWhite} />
        <rect x={tagX} y={tags.price - tagH / 2} width={tagW} height={tagH} rx={10} className={s.tagPrice} />
        <text x={tagX + 10} y={tags.price - tagH / 2 + (compact ? 13 : 18)} className={s.tagLabel}>
          {TILE_NOW}
        </text>
        <text x={tagX + 10} y={tags.price + tagH / 2 - (compact ? 7 : 10)} className={s.tagValue}>
          {now}
        </text>
      </g>
    </svg>
  );
}
