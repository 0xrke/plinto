"use client";

import { useId } from "react";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  CHART_COPY,
  TILE_FLOOR,
  TILE_NOW,
  floorSharePct,
  tileValues,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { beatBounds, floorAtTime, layoutTags, niceTicks, tickLabel } from "./geometry";
import s from "./tape.module.css";

/*
 * The tape: the whole story drawn along story time, panned sideways so the frame's time sits under a
 * fixed playhead. Left of the playhead is what has happened; right of it is blank, hatched tape, and
 * the two value tags ride the playhead there. The y camera is the engine's (wide, then the close-up
 * band during "steps"); the staircase is never magnified, only the axis zooms.
 */

const STEPS_I = BEAT_KEYS.indexOf("steps");
const BOUNCE_I = BEAT_KEYS.indexOf("bounce");
const SPLIT_I = BEAT_KEYS.indexOf("split");
const PUMP_I = BEAT_KEYS.indexOf("pump");
/** Wide view: the real-scale staircase is too small to see; the steps beat zooms in. */
const FLOOR_WIDE_NOTE = "Floor steps: real scale, zoom next";

/**
 * Story time visible behind the playhead: `wide` before the steps beat, easing to `full` with the
 * engine's zoom (0 → 1 during steps, then 1).
 */
export function tapeSpan(compact: boolean, zoom: number): number {
  const wide = compact ? 3.2 : 5;
  const full = compact ? 5.6 : 6.6;
  return wide + (full - wide) * Math.min(1, Math.max(0, zoom));
}

/** Rough width of a ruler label at 12px bold (beat number + name). */
const labelWidth = (text: string, compact: boolean) => (text.length + 3) * (compact ? 6.6 : 7.2);

export interface TapeProps {
  m: VariantProps["m"];
  frame: StoryFrame;
  /** Drawing size in px (the SVG viewBox). */
  w: number;
  h: number;
  className?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

export function Tape({ m, frame, w, h, className = "" }: TapeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const compact = w < 640;
  const b = beatBounds(m);

  const RULER = compact ? 30 : 36;
  const FOOT = compact ? 18 : 22;
  const top = RULER + (compact ? 16 : 22);
  const bot = h - FOOT - 8;
  /* Value tags ride the playhead on the narrow strip of unwritten tape to its right. */
  const tagW = compact ? 98 : 132;
  const tagH = compact ? 36 : 40;
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
  const edge = (x: number) => Math.min(1, Math.max(0, (x - (compact ? 44 : 64)) / 60));
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
  const priceArea = path.length > 1 ? `${priceD}L${X(path[path.length - 1]![0]).toFixed(1)} ${bot}L${X(path[0]![0]).toFixed(1)} ${bot}Z` : "";
  const steps = frame.floorSteps;
  const floorD = steps.length > 1 ? line(steps) : "";
  const floorArea = floorD ? `${floorD}L${X(steps[steps.length - 1]![0]).toFixed(1)} ${bot}L${X(steps[0]![0]).toFixed(1)} ${bot}Z` : "";

  /* ---- arbitrage line: the floor staircase × arbLineRatio, from the bounce on ---- */
  let arbD = "";
  // Phones: the bounce band is narrow and the dip fills it, so the label leads into the line from the
  // left instead of sitting on the dip.
  const arbLabelX = compact ? X(b.start[BOUNCE_I]!) - 6 : Math.max(X(b.start[BOUNCE_I]!) + 96, playX - 10);
  if (frame.arbLine100 !== null) {
    const t0 = b.start[BOUNCE_I]!;
    const f0 = floorAtTime(steps, t0) ?? frame.floor100 ?? 0;
    const pts: Array<[number, number]> = [[t0, f0 * m.arbLineRatio]];
    for (const [t, v] of steps) if (t > t0) pts.push([t, v * m.arbLineRatio]);
    arbD = line(pts);
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
  const peakY = Y(frame.peak.value);

  return (
    <svg className={`${s.svg} ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <clipPath id={`plot${uid}`}>
          <rect x={0} y={RULER} width={w} height={h - RULER - FOOT} />
        </clipPath>
        <pattern id={`hatch${uid}`} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={8} className={s.hatch} />
        </pattern>
        <linearGradient id={`pfill${uid}`} x1={0} y1={0} x2={0} y2={1}>
          <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0.16 }} />
          <stop offset="1" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
        </linearGradient>
        <linearGradient id={`fadeL${uid}`} x1={0} y1={0} x2={1} y2={0}>
          <stop offset="0" style={{ stopColor: "var(--tape-bg)", stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: "var(--tape-bg)", stopOpacity: 0 }} />
        </linearGradient>
        <linearGradient id={`fadeR${uid}`} x1={0} y1={0} x2={1} y2={0}>
          <stop offset="0" style={{ stopColor: "var(--tape-bg)", stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: "var(--tape-bg)", stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Beat bands and boundaries. */}
      {BEAT_KEYS.map((key, i) => {
        const x0 = X(b.start[i]!);
        const x1 = X(b.end[i]!);
        if (x1 < -20 || x0 > w + 20) return null;
        return (
          <g key={key}>
            {x1 > x0 ? <rect x={x0} y={RULER} width={x1 - x0} height={h - RULER - FOOT} className={i % 2 ? s.bandB : s.bandA} /> : null}
            {i > 0 ? <line x1={x0} x2={x0} y1={RULER} y2={h - FOOT} className={i === STEPS_I ? s.boundaryZoom : s.boundary} /> : null}
          </g>
        );
      })}

      {/* Unwritten tape to the right of the playhead. */}
      <rect x={playX} y={RULER} width={w - playX} height={h - RULER - FOOT} fill={`url(#hatch${uid})`} />

      <g clipPath={`url(#plot${uid})`}>
        {/* Grid. */}
        {ticks.map((v) => (
          <line key={v} x1={0} x2={w} y1={Y(v)} y2={Y(v)} className={s.grid} />
        ))}
        {hundredIn ? <line x1={0} x2={w} y1={Y(100)} y2={Y(100)} className={s.hundred} /> : null}

        {/* Presale: the raise fills. */}
        {inView(b.start[0]!, 1) && frame.y.min === 0 ? (
          <text opacity={edge(X((b.start[0]! + b.end[0]!) / 2) - 60)} x={X((b.start[0]! + b.end[0]!) / 2)} y={Y(100) + 26} className={s.note} textAnchor="middle">
            {CHART_COPY.raised(frame.raisedUsd)}
          </text>
        ) : null}

        {/* Split column. */}
        {split > 0 && inView(splitT, 1) ? (
          <g opacity={Math.min(1, split * 3)}>
            <rect x={X(splitT) - colW / 2} y={Y(100)} width={colW} height={Math.max(0, Y(0) - Y(100))} rx={3} className={s.colMarket} />
            <rect x={X(splitT) - colW / 2} y={Y(floorPart)} width={colW} height={Math.max(0, Y(0) - Y(floorPart))} rx={3} className={s.colFloor} />
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

        {/* Floor: the staircase, real scale. */}
        {floorD ? (
          <g opacity={frame.floorReveal}>
            <path d={floorArea} className={s.floorFill} />
            <path d={floorD} className={s.floor} />
            {frame.events.map((e) => (
              <circle key={e.t} cx={X(e.t)} cy={Y(e.to)} r={e === holders ? 4.5 : 3} className={s.eventDot} />
            ))}
          </g>
        ) : null}

        {/* Wide camera, real scale: say why the staircase looks flat here. */}
        {floorD && frame.beatIndex >= PUMP_I && frame.zoom < 0.5 && floorY !== null ? (
          <text opacity={(1 - frame.zoom * 2) * Math.min(1, frame.floorReveal)} x={playX - 12} y={floorY - 10} textAnchor="end" className={s.noteMint}>
            {FLOOR_WIDE_NOTE}
          </text>
        ) : null}

        {/* Arbitrage line. */}
        {arbD ? (
          <>
            <path d={arbD} className={s.arb} />
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
        <g opacity={frame.priceOpacity}>
          {priceArea ? <path d={priceArea} fill={`url(#pfill${uid})`} /> : null}
          <path d={priceD} className={s.price} />
        </g>

        {/* Peak, bounce, fee and exit labels. */}
        {frame.t >= frame.peak.t - 1e-9 && inView(frame.peak.t, 1) ? (
          <text opacity={edge(X(frame.peak.t) - 90)} x={X(frame.peak.t) - 12} y={Math.max(top - 4, peakY + 4)} textAnchor="end" className={s.notePeak}>
            {CHART_COPY.peak(frame.peak.value)}
          </text>
        ) : null}
        {frame.dip ? (
          <g>
            <circle cx={X(frame.dip.t)} cy={Y(frame.dip.value)} r={5} className={s.dip} />
            <text opacity={edge(X(frame.dip.t))} x={X(frame.dip.t) - 6} y={Math.min(bot - 2, Y(frame.dip.value) + 22)} className={s.noteRiskBold}>
              ↑ {CHART_COPY.bounce}
            </text>
          </g>
        ) : null}
        {feesFloor !== null && frame.feesPct !== null ? (
          <text opacity={edge(X(feesAt) - 130)} x={X(feesAt) - 10} y={Y(feesFloor) - 12} textAnchor="end" className={s.noteMintBold}>
            {CHART_COPY.fromFees(frame.feesPct)}
          </text>
        ) : null}
        {holders && frame.exitsPct !== null ? (
          <text opacity={edge(X(holders.t) - 130)} x={X(holders.t) - 8} y={Y(holders.to) - 14} textAnchor="end" className={s.noteMintBold}>
            {CHART_COPY.fromExits(frame.exitsPct)}
          </text>
        ) : null}
      </g>

      {/* Fixed y labels over a soft edge. */}
      <rect x={0} y={RULER} width={compact ? 34 : 48} height={h - RULER - FOOT} fill={`url(#fadeL${uid})`} />
      <rect x={w - (compact ? 20 : 40)} y={RULER} width={compact ? 20 : 40} height={h - RULER - FOOT} fill={`url(#fadeR${uid})`} />
      {ticks.map((v) => (
        <text key={v} x={compact ? 6 : 12} y={Y(v) - 5} className={s.tick}>
          {tickLabel(v)}
        </text>
      ))}
      {hundredIn ? (
        <text x={compact ? 6 : 12} y={Y(100) - 5} className={s.tickHundred}>
          {CHART_COPY.hundred}
        </text>
      ) : null}

      {/* Ruler: beat names pass by. */}
      <rect x={0} y={0} width={w} height={RULER} className={s.ruler} />
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
          lx = full ? Math.min(Math.max(x0 + 10, 8), x0 + room - lw - 6) : x0 + 6;
        }
        const lw = full ? labelWidth(BEAT_LABELS[key], compact) : 16;
        const left = anchorEnd ? lx - lw : lx;
        // Anything that would cross a deck edge fades out instead of being clipped.
        const fade = Math.min(1, Math.max(0, (left - 4) / 24), Math.max(0, (w - 6 - (left + lw)) / 24));
        const prog = i === frame.beatIndex && x1 > x0 ? Math.max(0, Math.min(x1, playX) - x0) : 0;
        return (
          <g key={key} className={state}>
            {i === STEPS_I ? <path d={`M${x0} ${RULER / 2 - 5}l5 5l-5 5l-5 -5Z`} className={s.diamond} /> : null}
            {fade > 0.02 ? (
              <text opacity={fade} x={lx} y={RULER / 2 + 4} textAnchor={anchorEnd ? "end" : undefined} className={s.beatLabel}>
                <tspan className={s.beatNum}>{num}</tspan>
                {full ? ` ${BEAT_LABELS[key]}` : null}
              </text>
            ) : null}
            {prog > 0 ? <rect x={x0} y={RULER - 3} width={prog} height={3} className={s.rulerProg} /> : null}
          </g>
        );
      })}

      {/* Sprockets. */}
      <rect x={0} y={h - FOOT} width={w} height={FOOT} className={s.ruler} />
      {Array.from({ length: Math.ceil((tRight - tLeft) / 0.2) + 2 }, (_, k) => {
        const t = Math.floor(tLeft / 0.2) * 0.2 + k * 0.2;
        return <rect key={k} x={X(t) - 4} y={h - FOOT / 2 - 3} width={8} height={6} rx={2} className={s.sprocket} />;
      })}

      {/* Playhead. */}
      <line x1={playX} x2={playX} y1={RULER} y2={h - FOOT} className={s.playhead} />
      <path d={`M${playX - 7} ${RULER}h14l-7 8Z`} className={s.playKnob} />
      <path d={`M${playX - 7} ${h - FOOT}h14l-7 -8Z`} className={s.playKnob} />

      {/* Value tags ride the playhead on the blank tape. */}
      {showFloorTag && floorY !== null && tags.floor !== null ? (
        <g opacity={frame.floorReveal}>
          <circle cx={playX} cy={floorY} r={4.5} className={s.floorDot} />
          <path d={`M${playX + 5} ${floorY}L${tagX} ${tags.floor}`} className={s.connMint} />
          <rect x={tagX} y={tags.floor - tagH / 2} width={tagW} height={tagH} rx={10} className={s.tagFloor} />
          <text x={tagX + 10} y={tags.floor - tagH / 2 + (compact ? 13 : 15)} className={s.tagLabel}>
            {TILE_FLOOR}
          </text>
          <text x={tagX + 10} y={tags.floor + tagH / 2 - (compact ? 7 : 8)} className={s.tagValue}>
            {floor}
          </text>
        </g>
      ) : null}
      <g opacity={Math.max(0.55, frame.priceOpacity)}>
        <circle cx={playX} cy={priceY} r={11} className={s.priceHalo} />
        <circle cx={playX} cy={priceY} r={5} className={s.priceDot} />
        <path d={`M${playX + 6} ${priceY}L${tagX} ${tags.price}`} className={s.connWhite} />
        <rect x={tagX} y={tags.price - tagH / 2} width={tagW} height={tagH} rx={10} className={s.tagPrice} />
        <text x={tagX + 10} y={tags.price - tagH / 2 + (compact ? 13 : 15)} className={s.tagLabel}>
          {TILE_NOW}
        </text>
        <text x={tagX + 10} y={tags.price + tagH / 2 - (compact ? 7 : 8)} className={s.tagValue}>
          {now}
        </text>
      </g>
    </svg>
  );
}
