"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { STORY_T_END, T_GRAD, easeInOut } from "@/lib/landing/sim/timeline";
import { CHART_COPY, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, formatUsdCents, tileValues, type StoryFrame, type VariantProps } from "../shared";
import { boxFaces, clamp01, easeOutBounce, easeOutCubic, lerpMap, niceTicks, plotFor, polyline, tickLabel, within, type Plot, type Size } from "./geometry";
import styles from "./blocks.module.css";

/*
 * Variant 5, the stage: the floor as a stair of real blocks. The front plane is a linear chart at
 * true scale (y axis ticks visible); every block is that chart's area under the floor, extruded up
 * and to the left. The foundation is the floor at graduation; each LP fee harvest (green) and each
 * redemption's kept exit fee (gold) drops one more block on top, exactly as tall as its floor step.
 * The price is a ball that rolls along the made-up path, falls in the selloff and bounces off the
 * elastic arbitrage line at the bounce. The arbitrage line is the engine's ratio applied to the real
 * staircase, so it steps up with the floor. From the bounce on the block fronts turn to glass, so a
 * dip under the floor reads as "inside the floor, above the arbitrage line" rather than vanishing.
 */

/** Face colours per block kind: front, top, side (side = the up-left riser faces). */
const BLOCK = {
  presale: { front: "#3b7bd0", top: "#a9cbf3", side: "#1f5fae" },
  floor: { front: "#1f9e7a", top: "#8fe6c6", side: "#14705a" },
  harvest: { front: "#34b58f", top: "#b5f0da", side: "#1f8a6b" },
  redeem: { front: "#e0c43a", top: "#f8eea6", side: "#ad9318" },
  market: { front: "#8b7cf6", top: "#d4ccfc", side: "#5b45d6" },
  cuts: { front: "#a3a3bd", top: "#e1e1ec", side: "#6b6b85" },
} as const;

type Kind = keyof typeof BLOCK;

/** Presale tower: 20 slabs of 5% of the raise each. */
const TOWER_SLABS = 20;
/** Presale and split are drawn on a tighter time window; from the pump on the camera follows the ball. */
const X_EARLY = 2.6;
/** Room kept right of the ball while the camera follows it (story time, plus a share of t). */
const X_LEAD = 0.45;
const X_LEAD_SHARE = 0.06;
/** Front-face opacity of the floor blocks once they turn to glass (bounce onward). */
const GLASS = 0.5;
/** A block's landing animation and its "+x%" tag, in story time. */
const DROP_T = 0.3;
const TAG_T = 0.34;

/** The x window's right end: fixed early, then it follows the ball so the stair fills the plot. */
function xMaxFor(f: StoryFrame): number {
  if (f.beatIndex < 2) return X_EARLY;
  return Math.min(STORY_T_END, Math.max(X_EARLY, f.t * (1 + X_LEAD_SHARE) + X_LEAD));
}

/* ---------- size ---------- */

const DEFAULT_SIZE: Size = { w: 640, h: 440 };

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

function Box({
  x0,
  x1,
  yTop,
  yBot,
  kind,
  p,
  opacity = 1,
  seam = 0.55,
  frontFill,
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
  frontFill?: string;
  frontOpacity?: number;
  topX1?: number;
}) {
  if (!(x1 > x0) || !(yBot > yTop - 0.01)) return null;
  const c = BLOCK[kind];
  const f = boxFaces(x0, x1, yTop, yBot, p.dx, p.dy, topX1);
  return (
    <g opacity={opacity}>
      <polygon points={f.side} fill={c.side} fillOpacity={frontOpacity < 1 ? 0.75 : 1} />
      <polygon points={f.top} fill={c.top} />
      <polygon points={f.front} fill={frontFill ?? c.front} fillOpacity={frontOpacity} />
      {seam > 0 ? <line x1={x0} x2={x1} y1={yTop} y2={yTop} stroke="#ffffff" strokeOpacity={seam} strokeWidth={1} /> : null}
    </g>
  );
}

/** The ball: your $100. Rolls (its mark turns with x), squashes on the elastic line. */
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
          <stop offset="0%" stopColor="#c9c0ff" />
          <stop offset="45%" stopColor="#6d58e6" />
          <stop offset="100%" stopColor="#2c1f8a" />
        </radialGradient>
      </defs>
      <circle r={r} fill={`url(#ball-${id})`} />
      <g transform={`rotate(${turn})`}>
        <path d={`M${-r * 0.62} 0 A ${r * 0.62} ${r * 0.62} 0 0 1 ${r * 0.62} 0`} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={Math.max(1.2, r * 0.16)} strokeLinecap="round" />
      </g>
    </g>
  );
}

function Pill({ x, y, text, tone, anchor = "middle", opacity = 1, small }: { x: number; y: number; text: string; tone: "floor" | "risk" | "ink" | "gold"; anchor?: "start" | "middle" | "end"; opacity?: number; small?: boolean }) {
  const fs = small ? 10.5 : 12;
  const w = text.length * fs * 0.56 + 14;
  const h = fs + 9;
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  const tones = {
    floor: ["#eefaf5", "#0f5a48"],
    risk: ["#fff1f5", "#b02a57"],
    ink: ["#ffffff", "#14142b"],
    gold: ["#fbf1b8", "#6e5400"],
  } as const;
  const [bg, fg] = tones[tone];
  return (
    <g opacity={opacity}>
      <rect x={x0 + 2} y={y - h / 2 + 2} width={w} height={h} rx={5} fill={fg} opacity={0.9} />
      <rect x={x0} y={y - h / 2} width={w} height={h} rx={5} fill={bg} stroke={fg} strokeWidth={1.2} />
      <text x={x0 + w / 2} y={y + fs * 0.36} textAnchor="middle" fontSize={fs} fontWeight={700} fill={fg} className={styles.svgText}>
        {text}
      </text>
    </g>
  );
}

/* ---------- the stage ---------- */

export function BlocksStage({ m, frame, still = false }: VariantProps & { frame: StoryFrame; still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const { now, floor } = tileValues(frame);
  return (
    <div className={`${styles.stage} ${still ? styles.stageStill : ""}`} aria-hidden>
      <Hud frame={frame} now={now} floor={floor} />
      <div ref={ref} className={styles.scene}>
        <Scene m={m} frame={frame} size={size} />
      </div>
    </div>
  );
}

/** The trading path is made up whenever it is drawn (pump onward), not only in the engine's flagged beats. */
const madeUpPath = (f: StoryFrame): boolean => f.illustrative || (f.beatIndex >= 2 && f.priceOpacity > 0);

function Hud({ frame, now, floor }: { frame: StoryFrame; now: string; floor: string }) {
  const harvests = frame.events.filter((e) => e.kind === "harvest").length;
  const redeems = frame.events.filter((e) => e.kind === "redeem").length;
  const hasFloor = frame.floorReveal > 0.5;
  return (
    <div className={styles.hud}>
      <div className={styles.tiles}>
        <p className={styles.tile}>
          <span className={styles.tileLabel}>{TILE_NOW}</span>
          <span className={styles.tileValue}>{now}</span>
        </p>
        <p className={`${styles.tile} ${styles.tileFloor}`}>
          <span className={styles.tileLabel}>{TILE_FLOOR}</span>
          <span className={styles.tileValue}>{floor}</span>
        </p>
      </div>
      <div className={styles.ledger}>
        <span className={styles.cubes}>
          {hasFloor ? <i className={`${styles.cube} ${styles.cubeBase}`} /> : null}
          {Array.from({ length: harvests }, (_, i) => (
            <i key={`h${i}`} className={`${styles.cube} ${styles.cubeHarvest}`} />
          ))}
          {Array.from({ length: redeems }, (_, i) => (
            <i key={`r${i}`} className={`${styles.cube} ${styles.cubeRedeem}`} />
          ))}
        </span>
        {frame.feesPct !== null ? <span className={styles.ledgerNote}>{CHART_COPY.fromFees(frame.feesPct)}</span> : null}
        {frame.exitsPct !== null ? <span className={`${styles.ledgerNote} ${styles.ledgerGold}`}>{CHART_COPY.fromExits(frame.exitsPct)}</span> : null}
        <span className={styles.chips}>
          {madeUpPath(frame) ? <span className={styles.chip}>{ILLUSTRATION}</span> : null}
          {frame.zoom > 0.5 ? <span className={`${styles.chip} ${styles.chipScale}`}>{REAL_SCALE_LABEL}</span> : null}
        </span>
      </div>
    </div>
  );
}

function Scene({ m, frame, size }: VariantProps & { frame: StoryFrame; size: Size }) {
  const clip = useId().replace(/:/g, "");
  const p = plotFor(size);
  const { w, h } = size;
  const xMax = xMaxFor(frame);
  const X = (t: number) => lerpMap(t, 0, xMax, p.l, p.r);
  const Y = (v: number) => lerpMap(v, frame.y.min, frame.y.max, p.b, p.t);
  const groundY = frame.y.min <= 0 ? p.b : p.b + 40;
  const t = frame.t;
  const nowX = X(t);

  /* presale tower: 20 slabs; recoloured and split apart during the split, gone early in the pump */
  const towerFade = frame.beatIndex < 2 ? 1 : frame.beatIndex > 2 ? 0 : 1 - within(frame.beatProgress, 0, 0.12);
  const floorSlabs = Math.round(m.v * TOWER_SLABS);
  const cutSlabs = Math.round(((m.split.creatorUsd + m.split.platformUsd) / m.raiseUsd) * TOWER_SLABS);
  const filled = (frame.raisedUsd / m.raiseUsd) * TOWER_SLABS;
  const towerTop = Y(80);
  const slabH = (p.b - towerTop) / TOWER_SLABS;
  const tx0 = X(0.18);
  const tx1 = X(0.82);
  const split = easeOutCubic(frame.splitProgress);

  /* floor blocks */
  const reveal = frame.floorReveal;
  const f0 = m.floorPer100GrossUsd;
  const baseTop = Y(0) + (Y(f0) - Y(0)) * reveal;
  const showFloor = frame.floor100 !== null && reveal > 0;

  /* price */
  const v = frame.valueOf100;
  const ballBottom = Y(v);
  const arb = frame.arbLine100;
  const arbY = arb === null ? null : Y(arb);
  const deflect = arbY !== null && ballBottom > arbY ? ballBottom - arbY : 0;
  const squash = Math.min(0.2, deflect / (p.ball * 5));
  const arbIn = frame.beat === "bounce" ? within(frame.beatProgress, 0, 0.15) : arb === null ? 0 : 1;
  const glass = 1 - (1 - GLASS) * arbIn;
  const floorTop = frame.floor100 === null ? null : Y(frame.floor100);
  const shadowGap = floorTop === null || !showFloor ? null : floorTop - ballBottom;

  const ticks = niceTicks(frame.y.min, frame.y.max, p.compact ? 3 : 4);
  const trail = polyline(frame.path.map(([pt, pv]) => [X(pt), Y(pv)] as [number, number]));

  const redeem = easeOutCubic(frame.redeemProgress);
  const net = frame.floorNet100;

  /* the floor's true edge: the engine's staircase (scaled in with the reveal during the split) */
  const floorEdge = showFloor ? polyline(frame.floorSteps.map(([st, sv]) => [X(st), Y(sv * reveal)] as [number, number])) : null;

  /* blocks: the foundation, then one per event; each block's top face shows only where nothing stands on it */
  const blocks = showFloor
    ? [
        { key: "base", x0: X(T_GRAD), yTop: baseTop, yBot: groundY + 4, kind: "floor" as Kind, lift: 0, opacity: 1, landed: true },
        ...frame.events.map((e) => {
          const k = within(t, e.t, e.t + DROP_T);
          return {
            key: `e${e.t}`,
            x0: X(e.t),
            yTop: Y(e.to),
            yBot: Y(e.from),
            kind: (e.kind === "harvest" ? "harvest" : "redeem") as Kind,
            lift: (1 - easeOutBounce(k)) * (p.compact ? 26 : 40),
            opacity: Math.min(1, k * 4),
            landed: k >= 1,
          };
        }),
      ]
    : [];

  /* the arbitrage line: arbLineRatio × the real staircase, ending just past the ball */
  const arbEnd = Math.min(p.r, nowX + p.ball * 4);
  const arbPts: Array<[number, number]> | null =
    arbY === null ? null : frame.floorSteps.map(([st, sv], i, all) => [i === all.length - 1 ? arbEnd : X(st), Y(sv * m.arbLineRatio)] as [number, number]);
  const arbLabelAt = arbPts && arbPts.length > 0 ? arbPts[0]! : null;

  const wide = frame.y.max > 150;
  const floorPill = showFloor && frame.floor100 !== null && frame.beatIndex >= 1 && frame.beatIndex <= 3 && reveal >= 1;

  return (
    <svg className={styles.svg} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <clipPath id={`clip-${clip}`}>
          <rect x={0} y={p.t - 40} width={w} height={p.b - p.t + 40} />
        </clipPath>
        <clipPath id={`plot-${clip}`}>
          <rect x={0} y={p.t - 6} width={w} height={p.b - p.t + 6} />
        </clipPath>
        <linearGradient id={`base-${clip}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#26ab85" />
          <stop offset="1" stopColor="#178567" />
        </linearGradient>
      </defs>

      {/* guides at true scale */}
      <g className={styles.ticks}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={p.l} x2={p.r} y1={Y(v)} y2={Y(v)} />
            <text x={p.l - 8} y={Y(v) + 4} textAnchor="end">
              {tickLabel(v)}
            </text>
          </g>
        ))}
      </g>

      {/* "$100 in": the reference the wide view is measured against */}
      {wide && frame.beatIndex >= 2 && frame.beatIndex <= 3 ? (
        <g>
          <line x1={p.l} x2={p.r} y1={Y(100)} y2={Y(100)} className={styles.hundred} />
          <text x={p.r} y={Y(100) - 6} textAnchor="end" className={styles.hundredText}>
            {`${CHART_COPY.hundred} in`}
          </text>
        </g>
      ) : null}

      <g clipPath={`url(#clip-${clip})`}>
        {/* ground */}
        {groundY <= p.b ? <rect x={p.l + p.dx} y={groundY} width={p.r - p.l - p.dx} height={3} rx={1.5} className={styles.ground} /> : null}

        {/* presale tower */}
        {towerFade > 0
          ? Array.from({ length: TOWER_SLABS }, (_, i) => {
              const land = clamp01(filled - i);
              if (land <= 0) return null;
              const kind: Kind = split < 0.05 ? "presale" : i < floorSlabs ? "floor" : i >= TOWER_SLABS - cutSlabs ? "cuts" : "market";
              const away = i < floorSlabs ? 0 : split;
              const drop = (1 - easeOutBounce(land)) * 60;
              const yBot = p.b - i * slabH - drop - away * (p.compact ? 18 : 30);
              const dxAway = away * (p.compact ? 36 : 70) * (i >= TOWER_SLABS - cutSlabs ? 1.4 : 1);
              return <Box key={i} x0={tx0 + dxAway} x1={tx1 + dxAway} yTop={yBot - slabH + 1} yBot={yBot} kind={kind} p={p} seam={0.22} opacity={towerFade * Math.min(1, land * 2) * (1 - away * 0.55)} />;
            })
          : null}

        {/* the floor: foundation, then one block per event */}
        {blocks.map((b, i) => {
          const next = blocks[i + 1];
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
              frontFill={i === 0 ? `url(#base-${clip})` : undefined}
              frontOpacity={glass}
              topX1={next && next.landed ? next.x0 : nowX}
              seam={0}
            />
          );
        })}

        {/* the floor's true value, as a crisp edge on the block fronts */}
        {floorEdge ? <path d={floorEdge} className={styles.floorEdge} /> : null}

        {/* ball shadow on the floor edge */}
        {shadowGap !== null && shadowGap >= -1 && frame.priceOpacity > 0.5 ? (
          <ellipse
            cx={nowX}
            cy={floorTop ?? 0}
            rx={p.ball * (1.2 - clamp01(shadowGap / 160) * 0.5)}
            ry={p.ball * 0.38}
            fill="#0b0b24"
            opacity={0.28 * (1 - clamp01(shadowGap / 160))}
          />
        ) : null}

        {/* elastic, stepped arbitrage line */}
        {arbPts && arbY !== null && arbIn > 0 ? (
          <g opacity={arbIn}>
            <path d={steppedElastic(arbPts, nowX, deflect, p.ball * 4)} className={styles.arbHalo} />
            <path d={steppedElastic(arbPts, nowX, deflect, p.ball * 4)} className={styles.arb} />
            {arbLabelAt ? <Pill x={arbLabelAt[0] + 4} y={arbLabelAt[1] + (p.compact ? 14 : 16)} text={CHART_COPY.arbLine} tone="risk" anchor="start" small={p.compact} /> : null}
          </g>
        ) : null}

        {/* the price's track, on top of the blocks */}
        <g opacity={frame.priceOpacity} clipPath={`url(#plot-${clip})`}>
          <path d={trail} className={styles.trailHalo} />
          <path d={trail} className={styles.trail} />
        </g>

        {frame.dip && arbY !== null && frame.beatIndex >= 5 && frame.beatIndex <= 6 && t > frame.dip.t + 0.25 ? (
          <g opacity={within(t, frame.dip.t + 0.25, frame.dip.t + 0.5)}>
            <path d={`M${X(frame.dip.t)} ${Y(frame.dip.value) + 4}v${p.compact ? 8 : 12}`} className={styles.dipTick} />
            <Pill x={X(frame.dip.t)} y={Y(frame.dip.value) + (p.compact ? 22 : 28)} text={CHART_COPY.bounce} tone="ink" small />
          </g>
        ) : null}

        <Ball cx={nowX} bottom={ballBottom} r={p.ball} squash={squash} opacity={frame.priceOpacity} />

        {/* landing tags: "+0.96%" over each new block */}
        {frame.events.map((e) => {
          const k = within(t, e.t, e.t + TAG_T);
          if (k <= 0 || k >= 1) return null;
          const pct = (e.to / e.from - 1) * 100;
          return (
            <Pill
              key={`tag${e.t}`}
              x={X(e.t) + p.dx * 0.5}
              y={Y(e.to) + p.dy - 14 - k * 16}
              text={`+${pct.toFixed(2)}%`}
              tone={e.kind === "harvest" ? "floor" : "gold"}
              opacity={1 - easeInOut(within(k, 0.6, 1))}
              small
            />
          );
        })}

        {/* redeem: what the floor pays after the exit fee, marked on the top block itself */}
        {redeem > 0 && net !== null && floorTop !== null ? (
          <g opacity={within(redeem, 0, 0.3)}>
            <line x1={nowX - (p.compact ? 70 : 120) * redeem} x2={nowX} y1={Y(net)} y2={Y(net)} className={styles.netLine} />
            <Pill
              x={nowX - p.ball * 1.6}
              y={Y(net) + (p.compact ? 15 : 18)}
              text={p.compact ? CHART_COPY.redeem(net).replace(`${CHART_COPY.redeemWord} `, "") : CHART_COPY.redeem(net)}
              tone="gold"
              anchor="end"
              small={p.compact}
            />
          </g>
        ) : null}
      </g>

      {/* labels that live outside the clip */}
      {towerFade > 0 && frame.beatIndex === 0 ? (
        <text x={(tx0 + tx1) / 2} y={p.b - Math.min(filled, TOWER_SLABS) * slabH - p.dy - 10} textAnchor="middle" className={styles.inkLabel} opacity={towerFade}>
          {CHART_COPY.raised(Math.round(frame.raisedUsd / 100) * 100)}
        </text>
      ) : null}
      {split > 0.6 && towerFade > 0 ? (
        <g opacity={towerFade * within(split, 0.6, 1)}>
          <text x={(tx0 + tx1) / 2} y={p.b - (floorSlabs * slabH) / 2 + 4} textAnchor="middle" className={styles.towerLabel}>
            {CHART_COPY.floorShare(Math.round(m.v * 100))}
          </text>
          <text x={(tx0 + tx1) / 2 + (p.compact ? 36 : 70)} y={p.b - (floorSlabs + 4) * slabH - (p.compact ? 18 : 30)} textAnchor="middle" className={styles.towerLabel}>
            {CHART_COPY.market}
          </text>
        </g>
      ) : null}
      {floorPill && frame.floor100 !== null ? (
        <Pill
          x={X(T_GRAD) + p.dx}
          y={baseTop + p.dy - (p.compact ? 14 : 18)}
          text={`${CHART_COPY.floor} ${formatUsdCents(frame.floorNet100 ?? frame.floor100)}`}
          tone="floor"
          anchor="start"
          small={p.compact}
          opacity={frame.beatIndex === 1 ? within(frame.beatProgress, 0.8, 1) : 1}
        />
      ) : null}
      {frame.beatIndex >= 2 && frame.zoom === 0 && t >= frame.peak.t - 1e-9 ? (
        <Pill x={X(frame.peak.t)} y={Y(frame.peak.value) - p.ball * 2 - 10} text={CHART_COPY.peak(frame.peak.value)} tone="ink" small={p.compact} />
      ) : null}

      {frame.y.min > 0 && showFloor ? <path d={breakEdge(X(T_GRAD) + p.dx - 2, nowX + 2, p.b - 7, p.b + 2)} className={styles.break} /> : null}
      {frame.y.min > 0 ? null : <line x1={p.l} x2={p.r} y1={p.b + 0.5} y2={p.b + 0.5} className={styles.axis} />}
    </svg>
  );
}

/**
 * The stepped arbitrage line through `pts`; its last flat run dips into a smooth V where the ball
 * pushes it down (at bx, by `depth` px).
 */
function steppedElastic(pts: ReadonlyArray<[number, number]>, bx: number, depth: number, spread: number): string {
  if (pts.length === 0) return "";
  const r = (n: number) => Math.round(n * 100) / 100;
  let d = `M${r(pts[0]![0])} ${r(pts[0]![1])}`;
  for (let i = 1; i < pts.length - 1; i++) d += `L${r(pts[i]![0])} ${r(pts[i]![1])}`;
  const [x1, y] = pts[pts.length - 1]!;
  const x0 = pts.length > 1 ? pts[pts.length - 2]![0] : pts[0]![0];
  if (depth <= 0.2) return `${d}L${r(x1)} ${r(y)}`;
  const s = spread + depth * 1.5;
  const a = Math.max(x0, bx - s);
  const b = Math.min(x1, bx + s);
  return `${d}L${r(a)} ${r(y)}C${r(a + (bx - a) * 0.55)} ${r(y)} ${r(bx - (bx - a) * 0.45)} ${r(y + depth)} ${r(bx)} ${r(y + depth)}C${r(bx + (b - bx) * 0.45)} ${r(y + depth)} ${r(b - (b - bx) * 0.55)} ${r(y)} ${r(b)} ${r(y)}L${r(x1)} ${r(y)}`;
}

/** The torn bottom edge of a block that continues below the close-up (an axis break, not $0). */
function breakEdge(x0: number, x1: number, y: number, yBot: number): string {
  const step = 12;
  let d = `M${x0} ${yBot}V${y}`;
  for (let x = x0, k = 0; x < x1; x += step / 2, k++) d += `L${Math.min(x1, x + step / 2)} ${y + (k % 2 === 0 ? 4 : 0)}`;
  return `${d}V${yBot}Z`;
}
