"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { floor100At } from "@/lib/landing/sim/floorPath";
import { BEAT_START, STORY_T_END, T_GRAD, easeInOut } from "@/lib/landing/sim/timeline";
import { BrandChartFrame, CHART, CHART_COPY, DASH, STROKE, SINCE_LISTING, TILE_FLOOR, TILE_NOW, formatPctChange, formatUsdCents, sinceListing, formatUsdWhole, tileValues, type StoryFrame, type VariantProps } from "../shared";
import { boxFaces, clamp01, easeOutCubic, lerpMap, niceTicks, plotFor, polyline, within, type Plot, type Size } from "./geometry";
import styles from "./blocksClean.module.css";

/*
 * Variant 26, the stage: v15's stair of real blocks in the site's midnight chart card, with the split
 * of variants 1 and 3. The presale fills one tall 2.5D column of twenty $5 slabs: your $100 on the
 * chart's own y axis. At the split the column divides in place, vertically: the floor share at the
 * bottom (mint), the market above it (iris), the creator and platform fees on top (butter), each
 * labelled directly inside its segment ("Floor 50%", "Market 40%", "Fees 5% · 5%"). Then the market
 * and the fees lift away, and the floor segment breaks into its slabs, which slide one by one into
 * the floor slab: the foundation the staircase starts from, its layers still visible. From there
 * every LP fee harvest (mint) and every kept exit fee (butter) settles one more block on top, exactly
 * as tall as its true floor step, so the staircase is built of blocks. The front plane is a linear
 * chart at true scale; the close-up says so ("Close-up · real scale"). Your $100 is the white ball on
 * the price's head: it rolls along the made-up path, falls in the selloff and bounces off the dashed
 * arbitrage line (the engine's ratio applied to the real staircase); from the bounce on the block
 * fronts turn to glass, so a dip under the floor reads as "inside the floor, above the line".
 * Colours: CHART tokens only (mixed over midnight for opaque faces), no raw hex.
 */

/** A token mixed over the midnight ground: an opaque face colour (stacked faces never show through). */
const onMid = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, ${CHART.bg})`;

/** Face colours per block kind: front, top (lit), side (the up-left riser, darkest). */
const BLOCK = {
  presale: { front: onMid(CHART.presaleFill, 100), top: onMid(CHART.presale, 100), side: onMid(CHART.presaleFill, 52), seam: onMid(CHART.presaleFill, 60) },
  /** The split column: saturated, so it reads as the beat's main object. */
  colFloor: { front: onMid(CHART.floor, 92), top: onMid(CHART.floor, 100), side: onMid(CHART.floor, 58), seam: onMid(CHART.floor, 55) },
  colMarket: { front: onMid(CHART.market, 92), top: onMid(CHART.market, 100), side: onMid(CHART.market, 55), seam: onMid(CHART.market, 55) },
  colFees: { front: onMid(CHART.fees, 92), top: onMid(CHART.fees, 100), side: onMid(CHART.fees, 55), seam: onMid(CHART.fees, 55) },
  /** The foundation's layers once settled. */
  floor: { front: onMid(CHART.floor, 44), top: onMid(CHART.floor, 86), side: onMid(CHART.floor, 24), seam: CHART.bg },
  harvest: { front: onMid(CHART.floor, 64), top: onMid(CHART.floor, 100), side: onMid(CHART.floor, 38), seam: CHART.bg },
  harvestAlt: { front: onMid(CHART.floor, 54), top: onMid(CHART.floor, 100), side: onMid(CHART.floor, 32), seam: CHART.bg },
  redeem: { front: onMid(CHART.fees, 62), top: onMid(CHART.fees, 100), side: onMid(CHART.fees, 36), seam: CHART.bg },
} as const;

type Kind = keyof typeof BLOCK;

/** The column: twenty slabs of $5 each, so its top is $100 on the y axis. */
const SLABS = 20;
const SLAB_USD = 100 / SLABS;
/** The column's place in the early window (story time). */
const COL_T = { x0: 0.08, x1: 0.84 } as const;
/** Presale and split are drawn on a fixed early window; from the pump on the camera follows the ball. */
const X_EARLY = 2.6;
/** Room kept right of the ball while the camera follows it (story time, plus a share of t). */
const X_LEAD = 0.45;
const X_LEAD_SHARE = 0.06;
/** Front-face opacity of the floor blocks once they turn to glass (bounce onward). */
const GLASS = 0.72;
/** A block's settle and its "+x%" tag, in story time. */
const DROP_T = 0.3;
const TAG_T = 0.34;
/** A block settles from this far above (px). */
const DROP_PX = { compact: 18, wide: 28 } as const;

/**
 * The split beat's own phases (beat progress 0..1 over a 150svh step). The "Raised" label hands over
 * while the column divides; the labelled column then holds for about half the step (~70svh of
 * scroll), then the market and fees lift away and the floor's slabs slide one by one into the floor slab.
 */
const SPLIT = {
  divide: [0.04, 0.2],
  /** Floor label fades in over this window; market and fees follow LABEL_STAGGER and 2× later. */
  labels: [0.1, 0.2],
  leave: [0.68, 0.78],
  /** Floor slab i moves over [move0 + i·stagger, … + moveLen]. */
  move0: 0.68,
  stagger: 0.016,
  moveLen: 0.12,
  /** The mint staircase and the floor chip appear once every slab has landed. */
  edge: [0.94, 1],
} as const;
/** Reduced-motion still of the split: the labelled column, before it breaks up. */
const STILL_SPLIT_P = 0.45;
/** The "Raised" label fades out over this part of the split, as the column divides. */
const RAISED_OUT = [0, 0.1] as const;
/** Delay between the floor, market and fees labels (beat progress). */
const LABEL_STAGGER = 0.03;

/** The x window's right end: fixed early, then it follows the ball so the stair fills the plot. */
function xMaxFor(f: StoryFrame): number {
  if (f.beatIndex < 2) return X_EARLY;
  return Math.min(STORY_T_END, Math.max(X_EARLY, f.t * (1 + X_LEAD_SHARE) + X_LEAD));
}

/** The trading path is made up whenever it is drawn (pump onward), not only in the engine's flagged beats. */
export const madeUpPath = (f: StoryFrame): boolean => f.illustrative || f.beatIndex >= 2;

/** Percent of the raise, one decimal at most. */
const pctOf = (usd: number, total: number): number => Math.round((usd / total) * 1000) / 10;

/** The split column's segment labels, from the launch math. */
export function splitLabels(m: VariantProps["m"]): { floor: string; market: string; fees: string } {
  const floorPct = Math.round(m.v * 100);
  const cut = pctOf(m.split.creatorUsd, m.raiseUsd);
  const plat = pctOf(m.split.platformUsd, m.raiseUsd);
  const marketPct = Math.round(Math.max(0, 100 - floorPct - cut - plat) * 10) / 10;
  return {
    floor: CHART_COPY.floorShare(floorPct),
    market: `${CHART_COPY.market} ${marketPct}%`,
    fees: `Fees ${CHART_COPY.fees(cut, plat)}`,
  };
}

/* ---------- size ---------- */

const DEFAULT_SIZE: Size = { w: 560, h: 440 };

function useSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* ---------- pieces ---------- */

const fill = (c: string, extra?: CSSProperties): CSSProperties => ({ fill: c, ...extra });

function Box({
  x0,
  x1,
  yTop,
  yBot,
  kind,
  p,
  opacity = 1,
  seam = 0,
  frontOpacity = 1,
  topX1,
}: {
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
  kind: Kind;
  p: Plot;
  opacity?: number;
  seam?: number;
  frontOpacity?: number;
  topX1?: number;
}) {
  if (!(x1 > x0) || !(yBot > yTop - 0.01) || opacity <= 0) return null;
  const c = BLOCK[kind];
  const f = boxFaces(x0, x1, yTop, yBot, p.dx, p.dy, topX1);
  return (
    <g opacity={opacity} data-block={kind}>
      <polygon points={f.side} style={fill(c.side, { fillOpacity: frontOpacity < 1 ? 0.8 : 1 })} />
      {topX1 === undefined || topX1 > x0 ? <polygon points={f.top} style={fill(c.top)} /> : null}
      <polygon points={f.front} style={fill(c.front, { fillOpacity: frontOpacity })} />
      {seam > 0 ? <line x1={x0} x2={x1} y1={yBot} y2={yBot} style={{ stroke: c.seam, strokeOpacity: seam, strokeWidth: 1 }} /> : null}
    </g>
  );
}

/** The ball: your $100, the price's white head dot. Rolls (its mark turns with x), squashes on the arbitrage line. */
function Ball({ cx, bottom, r, squash, opacity }: { cx: number; bottom: number; r: number; squash: number; opacity: number }) {
  const id = useId().replace(/:/g, "");
  const sy = 1 - squash;
  const sx = 1 + squash * 0.6;
  const cy = bottom - r * sy;
  const turn = ((cx / r) * 180) / Math.PI;
  return (
    <g opacity={opacity} transform={`translate(${cx} ${cy}) scale(${sx} ${sy})`}>
      <defs>
        <radialGradient id={`ball-${id}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" style={{ stopColor: CHART.price }} />
          <stop offset="60%" style={{ stopColor: CHART.price }} />
          <stop offset="100%" style={{ stopColor: CHART.axis }} />
        </radialGradient>
      </defs>
      <circle r={r + 4} style={fill(CHART.bounceHalo)} />
      <circle r={r} style={{ fill: `url(#ball-${id})` }} />
      <g transform={`rotate(${turn})`}>
        <path
          d={`M${-r * 0.45} ${r * 0.2} A ${r * 0.5} ${r * 0.5} 0 0 0 ${r * 0.45} ${r * 0.2}`}
          style={{ fill: "none", stroke: CHART.axis, strokeOpacity: 0.7, strokeWidth: Math.max(1, r * 0.12), strokeLinecap: "round" }}
        />
      </g>
    </g>
  );
}

/** A 22px chip drawn in SVG, like the landing chart's raised value chips ("Peak $400 ↑", "$40.28"). */
function Chip({
  x,
  y,
  text,
  tone = "raised",
  anchor = "middle",
  opacity = 1,
}: {
  x: number;
  y: number;
  text: string;
  tone?: "raised" | "floor" | "fees";
  anchor?: "start" | "middle" | "end";
  opacity?: number;
}) {
  const fs = 11.5;
  const w = text.length * fs * 0.56 + 18;
  const h = 22;
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  const ink = tone === "floor" ? CHART.floor : tone === "fees" ? CHART.fees : CHART.price;
  return (
    <g opacity={opacity}>
      <rect x={x0} y={y - h / 2} width={w} height={h} rx={h / 2} style={fill(CHART.raised)} />
      <text x={x0 + w / 2} y={y + 4} textAnchor="middle" className={styles.chipText} style={fill(ink)}>
        {text}
      </text>
    </g>
  );
}

/* ---------- the stage ---------- */

/** The ball rests on the arbitrage line: the shown value never goes under it once the line is drawn. */
export function onArbLine(m: VariantProps["m"], frame: StoryFrame, t: number, v: number): number {
  if (frame.arbLine100 === null || t < BEAT_START.bounce) return v;
  return Math.max(v, m.arbLineRatio * floor100At(m, t));
}

export function CleanBlocksStage({ m, frame: raw, still = false }: VariantProps & { frame: StoryFrame; still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const frame: StoryFrame = { ...raw, valueOf100: onArbLine(m, raw, raw.t, raw.valueOf100) };
  return (
    <div className={`${styles.stage} ${still ? styles.stageStill : ""}`} aria-hidden data-v26-stage="">
      <BrandChartFrame
        size={still ? "still" : "stage"}
        className={styles.chart}
        style={still ? { height: 300 } : undefined}
        illustration={madeUpPath(frame)}
        scale={frame.zoom > 0 ? "real" : null}
        scaleOpacity={clamp01(frame.zoom * 2)}
      >
        <div ref={ref} className={styles.scene}>
          <Scene m={m} frame={frame} size={size} under={Math.max(0, frame.valueOf100 - raw.valueOf100)} still={still} />
        </div>
      </BrandChartFrame>
      <Metrics m={m} frame={frame} />
    </div>
  );
}

/**
 * The two story metrics, large: your $100 now and what the floor pays back, each with its change
 * since listing (none before trading opens; none for the price once redeemed). On wide screens the
 * panel sits in the caption column, pinned above the captions; on phones it is a row above the chart.
 */
export function Metrics({ m, frame }: VariantProps & { frame: StoryFrame }) {
  const { now, floor } = tileValues(frame);
  const pct = sinceListing(m, frame);
  return (
    <div className={styles.metrics} data-part="metrics">
      <p className={styles.metricNow}>
        <span>{TILE_NOW}</span>
        <b className={styles.metricValue} data-part="tile-now">
          {now}
        </b>
        <Pct value={pct.now} part="pct-now" tone={pct.now !== null && pct.now < 0 ? "down" : "up"} />
      </p>
      <p className={styles.metricFloor}>
        <span>{TILE_FLOOR}</span>
        <b className={styles.metricValue} data-part="tile-floor">
          {floor}
        </b>
        <Pct value={pct.floor} part="pct-floor" tone="floor" />
      </p>
    </div>
  );
}

function Pct({ value, part, tone }: { value: number | null; part: string; tone: "up" | "down" | "floor" }) {
  if (value === null) return <span className={styles.pct} aria-hidden />;
  return (
    <span className={`${styles.pct} ${tone === "down" ? styles.pctDown : styles.pctUp}`} data-part={part} data-tone={tone}>
      <b className="tnum">{formatPctChange(value)}</b> {SINCE_LISTING}
    </span>
  );
}

interface Rect {
  x0: number;
  x1: number;
  yTop: number;
  yBot: number;
}

const mixRect = (a: Rect, b: Rect, k: number): Rect => ({
  x0: a.x0 + (b.x0 - a.x0) * k,
  x1: a.x1 + (b.x1 - a.x1) * k,
  yTop: a.yTop + (b.yTop - a.yTop) * k,
  yBot: a.yBot + (b.yBot - a.yBot) * k,
});

function Scene({ m, frame, size, under, still }: VariantProps & { frame: StoryFrame; size: Size; under: number; still: boolean }) {
  const clip = useId().replace(/:/g, "");
  const p = plotFor(size);
  const { w, h } = size;
  const xMax = xMaxFor(frame);
  const X = (t: number) => lerpMap(t, 0, xMax, p.l, p.r);
  const Y = (v: number) => lerpMap(v, frame.y.min, frame.y.max, p.b, p.t);
  const t = frame.t;
  const nowX = X(t);
  const drop = p.compact ? DROP_PX.compact : DROP_PX.wide;
  const beatIndex = frame.beatIndex;

  /* the split beat's own clock; the reduced-motion still shows the labelled column */
  const sp = beatIndex === 1 ? (still ? STILL_SPLIT_P : frame.beatProgress) : beatIndex > 1 ? 1 : 0;
  const divide = easeInOut(within(sp, SPLIT.divide[0], SPLIT.divide[1]));
  const leave = easeInOut(within(sp, SPLIT.leave[0], SPLIT.leave[1]));
  const edgeIn = beatIndex >= 2 ? 1 : within(sp, SPLIT.edge[0], SPLIT.edge[1]);

  /* the column: twenty $5 slabs, floor at the bottom, market above, fees on top */
  const floorSlabs = Math.max(1, Math.min(SLABS - 1, Math.round(m.v * SLABS)));
  const feeSlabs = Math.max(1, Math.round(((m.split.creatorUsd + m.split.platformUsd) / m.raiseUsd) * SLABS));
  const segOf = (i: number): "floor" | "market" | "fees" => (i < floorSlabs ? "floor" : i >= SLABS - feeSlabs ? "fees" : "market");
  const cx0 = X(COL_T.x0);
  const cx1 = X(COL_T.x1);
  const gapPx = (p.compact ? 8 : 14) * divide;
  const lift = (seg: "floor" | "market" | "fees") => (seg === "market" ? gapPx : seg === "fees" ? gapPx * 2 : 0);
  const filled = (frame.raisedUsd / m.raiseUsd) * SLABS;
  const showColumn = beatIndex <= 1;

  /* the foundation: the floor slab at listing, in layers (one per floor slab of the column) */
  const f0 = m.floorPer100GrossUsd;
  const groundY = frame.y.min <= 0 ? p.b : p.b + 40;
  const layerRect = (i: number): Rect => ({
    x0: X(T_GRAD),
    x1: nowX,
    yTop: Y((f0 * (i + 1)) / floorSlabs),
    yBot: i === 0 ? Math.max(groundY + 4, Y(0)) : Y((f0 * i) / floorSlabs),
  });
  const slabMove = (i: number) => easeInOut(within(sp, SPLIT.move0 + i * SPLIT.stagger, SPLIT.move0 + i * SPLIT.stagger + SPLIT.moveLen));
  const showFloor = frame.floor100 !== null && beatIndex >= 1;

  /* price */
  const v = frame.valueOf100;
  const ballBottom = Y(v);
  const arb = frame.arbLine100;
  const arbY = arb === null ? null : Y(arb);
  // How far the engine's dip pushes into the line (px): the ball squashes on it, the line holds.
  const push = arb === null ? 0 : Y(arb - under) - Y(arb);
  const squash = Math.min(0.18, push / (p.ball * 4));
  const arbIn = frame.beat === "bounce" ? within(frame.beatProgress, 0, 0.15) : arb === null ? 0 : 1;
  const glass = 1 - (1 - GLASS) * arbIn;
  const floorTop = frame.floor100 === null ? null : Y(frame.floor100);
  const shadowGap = floorTop === null || !showFloor || beatIndex < 2 ? null : floorTop - ballBottom;
  const ballOpacity = beatIndex >= 2 ? frame.priceOpacity : 0;

  const ticks = niceTicks(frame.y.min, frame.y.max, p.compact ? 3 : 4);
  const trail = polyline(frame.path.map(([pt, pv]) => [X(pt), Y(onArbLine(m, frame, pt, pv))] as [number, number]));

  const redeem = easeOutCubic(frame.redeemProgress);
  const net = frame.floorNet100;

  /* the floor's true edge: the engine's staircase, exact risers */
  const floorEdge = showFloor && edgeIn > 0 ? polyline(frame.floorSteps.map(([st, sv]) => [X(st), Y(sv)] as [number, number])) : null;

  /* event blocks: one per harvest or kept exit fee, each settling onto the one below */
  let harvestNo = 0;
  const events = showFloor
    ? frame.events.map((e) => {
        const k = within(t, e.t, e.t + DROP_T);
        return {
          key: `e${e.t}`,
          x0: X(e.t),
          yTop: Y(e.to),
          yBot: Y(e.from),
          kind: (e.kind === "harvest" ? (harvestNo++ % 2 === 0 ? "harvest" : "harvestAlt") : "redeem") as Kind,
          lift: (1 - easeOutCubic(k)) * drop,
          opacity: Math.min(1, k * 3),
          landed: k >= 1,
        };
      })
    : [];
  const firstLanded = events[0] && events[0].landed ? events[0].x0 : nowX;

  /* the arbitrage line: arbLineRatio × the real staircase, ending where the stair ends (at the ball) */
  const arbPts: Array<[number, number]> | null = arbY === null ? null : frame.floorSteps.map(([st, sv]) => [X(st), Y(sv * m.arbLineRatio)] as [number, number]);
  const arbLabelAt = arbPts && arbPts.length > 0 ? arbPts[0]! : null;
  const arbPath = arbPts ? polyline(arbPts) : null;
  /* the bounce point: where the ball met the line */
  const dipAt = frame.dip ? ([X(frame.dip.t), Y(onArbLine(m, frame, frame.dip.t, frame.dip.value))] as const) : null;

  const wide = frame.y.max > 150;
  const floorChip = showFloor && frame.floor100 !== null && beatIndex <= 3 && edgeIn > 0;
  const showDip = frame.dip && arbY !== null && beatIndex >= 5 && beatIndex <= 6 && t > frame.dip.t + 0.25;
  const labels = splitLabels(m);

  /* column slabs (presale and split) */
  const columnSlabs = showColumn
    ? Array.from({ length: SLABS }, (_, i) => {
        const land = clamp01(filled - i);
        if (land <= 0) return null;
        const seg = segOf(i);
        const fall = (1 - easeOutCubic(land)) * drop;
        // A 1px gap reads each $5 slab in the presale; it closes as the column divides, so the
        // segments become solid faces and their labels sit on clean colour.
        const col: Rect = { x0: cx0, x1: cx1, yTop: Y((i + 1) * SLAB_USD) - lift(seg) - fall + (1 - divide), yBot: Y(i * SLAB_USD) - lift(seg) - fall };
        const fade = Math.min(1, land * 2);
        if (seg === "floor") {
          const k = slabMove(i);
          const r = k > 0 ? mixRect(col, layerRect(i), k) : col;
          return { i, seg, r, k, fade, opacity: fade };
        }
        // market and fees lift off and fade once the floor starts to break up
        const up = leave * (p.compact ? 18 : 28);
        return { i, seg, r: { ...col, yTop: col.yTop - up, yBot: col.yBot - up }, k: 0, fade, opacity: fade * (1 - leave) };
      }).filter((s): s is NonNullable<typeof s> => s !== null)
    : [];
  // The $5 seams fade once the column is divided, so they never cut through the segment labels.
  const columnSeam = 1 - 0.75 * divide;
  const segKind = { floor: "colFloor", market: "colMarket", fees: "colFees" } as const;
  // Only the column's top slab shows its top face (each segment's top shows once the gaps open).
  const topOf = (i: number, seg: "floor" | "market" | "fees") => {
    const next = i + 1;
    if (next >= SLABS || next >= Math.ceil(filled)) return true;
    return segOf(next) !== seg && divide > 0.15;
  };
  const allLanded = beatIndex >= 2 || (showFloor && slabMove(floorSlabs - 1) >= 1);

  /* label geometry: centred in each segment's front face */
  const lx = (cx0 + cx1) / 2;
  const segMid = (from: number, to: number, seg: "floor" | "market" | "fees") => (Y(from * SLAB_USD) + Y(to * SLAB_USD)) / 2 - lift(seg);
  const labelIn = (a: number) => within(sp, SPLIT.labels[0] + a, SPLIT.labels[1] + a);
  const floorLabelO = labelIn(0) * (1 - within(sp, SPLIT.move0, SPLIT.move0 + 0.06));
  const restLabelO = (1 - leave) * (beatIndex === 1 ? 1 : 0);
  const big = p.compact ? 18 : 30;
  /* the raise label rides the column's top as it fills, then hands over to the segment labels */
  const raisedO = beatIndex === 0 ? 1 : beatIndex === 1 ? 1 - within(sp, RAISED_OUT[0], RAISED_OUT[1]) : 0;
  const raisedTop = Y(Math.min(SLABS, filled) * SLAB_USD);
  const raisedY = Math.max(Y(SLABS * SLAB_USD) + (p.compact ? 14 : 20), Math.min(Y(0) - (p.compact ? 24 : 32), raisedTop + (p.compact ? 14 : 20)));
  /* the empty column ahead of the fill: a faint outline of the whole $100 bar */
  const ghostO = beatIndex === 0 ? 1 : beatIndex === 1 ? 1 - divide : 0;
  const small = p.compact ? 11.5 : 14;

  return (
    <svg className={styles.svg} width={w} height={h} viewBox={`0 0 ${w} ${h}`} data-beat={frame.beat}>
      <defs>
        <clipPath id={`clip-${clip}`}>
          <rect x={0} y={p.t - 40} width={w} height={p.b - p.t + 40} />
        </clipPath>
        <clipPath id={`plot-${clip}`}>
          <rect x={0} y={p.t - 6} width={w} height={p.b - p.t + 6} />
        </clipPath>
      </defs>

      {/* guides at true scale */}
      <g>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={p.l} x2={p.r} y1={Y(tv)} y2={Y(tv)} style={{ stroke: CHART.grid, strokeWidth: STROKE.grid }} />
            <text x={p.l - 8} y={Y(tv) + 4} textAnchor="end" className={styles.tick} style={fill(CHART.axis)}>
              {formatUsdCents(tv)}
            </text>
          </g>
        ))}
      </g>

      {/* "$100 in": the reference the wide view is measured against */}
      {wide && beatIndex >= 2 && beatIndex <= 3 ? (
        <g>
          <line x1={p.l} x2={p.r} y1={Y(100)} y2={Y(100)} style={{ stroke: CHART.axis, strokeWidth: STROKE.ref, strokeDasharray: DASH.ref, strokeOpacity: 0.5 }} />
          <text x={p.r} y={Y(100) - 6} textAnchor="end" className={styles.label} style={fill(CHART.axis)}>
            {`${CHART_COPY.hundred} in`}
          </text>
        </g>
      ) : null}

      <g clipPath={`url(#clip-${clip})`}>
        {/* ground */}
        {groundY <= p.b ? <rect x={p.l + p.dx} y={groundY} width={p.r - p.l - p.dx} height={2} rx={1} style={fill(CHART.grid)} /> : null}

        {/* the foundation, layer by layer, once its slab has landed (from the pump on it is always there) */}
        {showFloor
          ? Array.from({ length: floorSlabs }, (_, i) => {
              const landed = beatIndex >= 2 || slabMove(i) >= 1;
              if (!landed) return null;
              const r = layerRect(i);
              const top = i === floorSlabs - 1;
              return (
                <Box
                  key={`layer${i}`}
                  {...r}
                  kind="floor"
                  p={p}
                  seam={i > 0 ? 0.7 * within(r.yBot - r.yTop, 4, 12) : 0}
                  frontOpacity={glass}
                  topX1={top ? firstLanded : r.x0}
                />
              );
            })
          : null}

        {/* the bar the presale fills: its outline, from $0 to your $100 */}
        {showColumn && ghostO > 0 ? (
          <g data-part="raise-bar" opacity={ghostO}>
            <rect x={cx0} y={Y(SLABS * SLAB_USD)} width={cx1 - cx0} height={Y(0) - Y(SLABS * SLAB_USD)} style={{ fill: CHART.grid, fillOpacity: 0.6, stroke: CHART.axis, strokeOpacity: 0.55, strokeWidth: 1, strokeDasharray: DASH.guide }} />
          </g>
        ) : null}

        {/* the column: presale sky, then floor / market / fees; the floor's slabs travel into the foundation */}
        {columnSlabs.map((s) => (
          <g key={`col${s.i}`}>
            <Box
              {...s.r}
              kind={segKind[s.seg]}
              p={p}
              seam={columnSeam}
              opacity={s.opacity * (1 - s.k)}
              topX1={topOf(s.i, s.seg) || s.k > 0 ? undefined : s.r.x0}
            />
            {/* a travelling floor slab takes on the foundation's colour as it lands */}
            {s.k > 0 && s.k < 1 ? <Box {...s.r} kind="floor" p={p} seam={1} opacity={s.k} /> : null}
            {divide < 1 ? <Box {...s.r} kind="presale" p={p} seam={1} opacity={s.fade * (1 - divide)} topX1={topOf(s.i, s.seg) ? undefined : s.r.x0} /> : null}
          </g>
        ))}

        {/* the floor: one block per event on top of the foundation */}
        {events.map((b, i) => {
          const next = events[i + 1];
          return (
            <Box
              key={b.key}
              x0={b.x0}
              x1={nowX}
              yTop={b.yTop - b.lift}
              yBot={b.yBot - b.lift}
              kind={b.kind}
              p={p}
              opacity={b.opacity}
              seam={0.85}
              frontOpacity={glass}
              topX1={next && next.landed ? next.x0 : nowX}
            />
          );
        })}

        {/* the floor's true value: the mint staircase, exact risers */}
        {floorEdge && allLanded ? <path d={floorEdge} className={styles.stair} style={{ stroke: CHART.floor, strokeWidth: STROKE.floor, opacity: edgeIn }} /> : null}

        {/* ball shadow on the floor edge */}
        {shadowGap !== null && shadowGap >= -1 && ballOpacity > 0.5 ? (
          <ellipse
            cx={nowX}
            cy={floorTop ?? 0}
            rx={p.ball * (1.2 - clamp01(shadowGap / 160) * 0.5)}
            ry={p.ball * 0.36}
            style={fill(CHART.bg, { opacity: 0.55 * (1 - clamp01(shadowGap / 160)) })}
          />
        ) : null}

        {/* the stepped arbitrage line; it gives where the ball lands on it */}
        {arbPath && arbIn > 0 ? (
          <g opacity={arbIn}>
            <path d={arbPath} className={styles.stair} style={{ stroke: CHART.bg, strokeWidth: 5, strokeOpacity: 0.6 }} />
            <path d={arbPath} className={styles.stair} style={{ stroke: CHART.arb, strokeWidth: 2, strokeDasharray: DASH.arb, strokeLinecap: "butt" }} />
            {arbLabelAt ? (
              <text x={arbLabelAt[0] + 2} y={arbLabelAt[1] + 15} className={styles.label} style={fill(CHART.arb)}>
                {CHART_COPY.arbLine}
              </text>
            ) : null}
          </g>
        ) : null}

        {/* the price's track, on top of the blocks (from the pump on: before it, your $100 is in the column) */}
        {beatIndex >= 2 ? (
          <g opacity={frame.priceOpacity} clipPath={`url(#plot-${clip})`}>
            <path d={trail} className={styles.line} style={{ stroke: CHART.bg, strokeWidth: 6, strokeOpacity: 0.55 }} />
            <path d={trail} className={styles.line} style={{ stroke: CHART.price, strokeWidth: STROKE.price }} />
          </g>
        ) : null}

        {/* the bounce: a rose dot with a halo where the price met the arbitrage line */}
        {showDip && frame.dip && dipAt ? (
          <g opacity={within(t, frame.dip.t + 0.25, frame.dip.t + 0.5)}>
            <circle cx={dipAt[0]} cy={dipAt[1]} r={9} style={fill(CHART.bounceHalo)} />
            <circle cx={dipAt[0]} cy={dipAt[1]} r={5} style={fill(CHART.bounce)} />
            <text x={dipAt[0]} y={dipAt[1] + 24} textAnchor="middle" className={styles.labelStrong} style={fill(CHART.bounce)}>
              {CHART_COPY.bounce}
            </text>
          </g>
        ) : null}

        <Ball cx={nowX} bottom={ballBottom} r={p.ball} squash={squash} opacity={ballOpacity} />

        {/* settle tags: "+0.96%" over each new block */}
        {frame.events.map((e) => {
          const k = within(t, e.t, e.t + TAG_T);
          if (k <= 0 || k >= 1) return null;
          const pct = (e.to / e.from - 1) * 100;
          return (
            <text
              key={`tag${e.t}`}
              x={X(e.t) + p.dx * 0.5}
              y={Y(e.to) + p.dy - 10 - k * 12}
              textAnchor="middle"
              className={styles.labelStrong}
              style={fill(e.kind === "harvest" ? CHART.floor : CHART.fees, { opacity: 1 - easeInOut(within(k, 0.6, 1)) })}
            >
              {`+${pct.toFixed(2)}%`}
            </text>
          );
        })}

        {/* redeem: what the floor pays after the exit fee, marked on the top block itself */}
        {redeem > 0 && net !== null && floorTop !== null ? (
          <g opacity={within(redeem, 0, 0.3)}>
            <line
              x1={nowX - (p.compact ? 70 : 120) * redeem}
              x2={nowX}
              y1={Y(net)}
              y2={Y(net)}
              style={{ stroke: CHART.fees, strokeWidth: 2, strokeDasharray: DASH.guide }}
            />
            <Chip
              x={nowX - p.ball * 1.6}
              y={Y(net) + 20}
              text={p.compact ? CHART_COPY.redeem(net).replace(`${CHART_COPY.redeemWord} `, "") : CHART_COPY.redeem(net)}
              tone="fees"
              anchor="end"
            />
          </g>
        ) : null}
      </g>

      {/* the split column's direct labels, inside each segment */}
      {showColumn && beatIndex === 1 ? (
        <g data-part="split-labels" textAnchor="middle">
          <g opacity={floorLabelO}>
            <text x={lx} y={segMid(0, floorSlabs, "floor") - big * 0.12} className={styles.segName} style={fill(CHART.bg, { fontSize: small })}>
              {CHART_COPY.floor}
            </text>
            <text x={lx} y={segMid(0, floorSlabs, "floor") + big * 0.82} className={styles.segPct} style={fill(CHART.bg, { fontSize: big })}>
              {labels.floor.replace(`${CHART_COPY.floor} `, "")}
            </text>
          </g>
          <g opacity={labelIn(LABEL_STAGGER) * restLabelO}>
            <text x={lx} y={segMid(floorSlabs, SLABS - feeSlabs, "market") - big * 0.12} className={styles.segName} style={fill(CHART.bg, { fontSize: small })}>
              {CHART_COPY.market}
            </text>
            <text x={lx} y={segMid(floorSlabs, SLABS - feeSlabs, "market") + big * 0.82} className={styles.segPct} style={fill(CHART.bg, { fontSize: big })}>
              {labels.market.replace(`${CHART_COPY.market} `, "")}
            </text>
          </g>
          <text
            x={lx}
            y={segMid(SLABS - feeSlabs, SLABS, "fees") + small * 0.36}
            className={styles.segName}
            style={fill(CHART.bg, { fontSize: small, opacity: labelIn(LABEL_STAGGER * 2) * restLabelO })}
          >
            {labels.fees}
          </text>
        </g>
      ) : null}

      {/* the raise: the column's own label, "Raised $X of $10,000", beside its front face */}
      {showColumn && raisedO > 0 && frame.raisedUsd >= 1 ? (
        <g data-part="raise-label" opacity={raisedO}>
          <text x={cx1 + (p.compact ? 10 : 18)} y={raisedY} className={styles.raiseBig} style={fill(CHART.price, { fontSize: p.compact ? 16 : 24 })}>
            {CHART_COPY.raised(Math.round(frame.raisedUsd / 100) * 100)}
          </text>
          <text x={cx1 + (p.compact ? 10 : 18)} y={raisedY + (p.compact ? 17 : 24)} className={styles.raiseOf} style={fill(CHART.axis, { fontSize: p.compact ? 12 : 15 })}>
            {`of ${formatUsdWhole(m.raiseUsd)}`}
          </text>
        </g>
      ) : null}
      {floorChip && frame.floor100 !== null ? (
        <Chip
          x={X(T_GRAD) + p.dx}
          y={Y(f0) + p.dy - 16}
          text={`${CHART_COPY.floor} ${formatUsdCents(frame.floorNet100 ?? frame.floor100)}`}
          tone="floor"
          anchor="start"
          opacity={edgeIn}
        />
      ) : null}
      {beatIndex >= 2 && frame.zoom === 0 && t >= frame.peak.t - 1e-9 ? <Chip x={X(frame.peak.t)} y={Y(frame.peak.value) - p.ball * 2 - 8} text={CHART_COPY.peak(frame.peak.value)} /> : null}

      {frame.y.min > 0 && showFloor ? <path d={breakEdge(X(T_GRAD) + p.dx - 2, nowX + 2, p.b - 6, p.b + 16)} style={fill(CHART.bg)} /> : null}
      {frame.y.min > 0 ? null : <line x1={p.l} x2={p.r} y1={p.b + 0.5} y2={p.b + 0.5} style={{ stroke: CHART.grid, strokeWidth: STROKE.grid }} />}
    </svg>
  );
}

/** A soft wavy bottom edge on blocks that continue below the close-up (an axis break, not $0). */
function breakEdge(x0: number, x1: number, y: number, yBot: number): string {
  const step = 12;
  let d = `M${x0} ${yBot}V${y}`;
  for (let x = x0, k = 0; x < x1; x += step / 2, k++) d += `L${Math.min(x1, x + step / 2)} ${y + (k % 2 === 0 ? 3 : 0)}`;
  return `${d}V${yBot}Z`;
}
