"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { floor100At } from "@/lib/landing/sim/floorPath";
import { BEAT_START, STORY_T_END, T_GRAD, easeInOut } from "@/lib/landing/sim/timeline";
import { BrandChartFrame, CHART, CHART_COPY, DASH, STROKE, TILE_FLOOR, TILE_NOW, formatUsdCents, tileValues, type StoryFrame, type VariantProps } from "../shared";
import { boxFaces, clamp01, easeOutCubic, lerpMap, niceTicks, plotFor, polyline, within, type Plot, type Size } from "./geometry";
import styles from "./blocks.module.css";

/*
 * Variant 15, the stage: v05's stair of real blocks, drawn inside the site's midnight chart card.
 * The front plane is a linear chart at true scale (ticks visible); every block is that chart's area
 * under the floor, extruded up and to the left. The foundation is the floor at graduation; each LP fee
 * harvest (mint) and each redemption's kept exit fee (butter) settles one more block on top, exactly
 * as tall as its floor step. Your $100 is the white head dot of the price, grown into a ball that
 * rolls along the made-up path, falls in the selloff and bounces off the dashed arbitrage line (the
 * engine's ratio applied to the real staircase). The engine's illustrative dip reaches a little under
 * that line; here the line is the surface the ball lands on, so the drawn path rests on it at the dip
 * (and the "your $100" tile reads the same value) before it turns up. From the bounce on the block
 * fronts turn to glass, so a dip under the floor reads as "inside the floor, above the arbitrage line".
 * Colours: CHART tokens only (mixed over midnight for opaque faces), no raw hex. The raise is the
 * site's sky presale tint; the split recolours it into the sandbox's floor / market / fees colours.
 */

/** A token mixed over the midnight ground: an opaque face colour (stacked faces never show through). */
const onMid = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, ${CHART.bg})`;

/** Face colours per block kind: front, top (lit), side (the up-left riser, darkest). */
const BLOCK = {
  presale: { front: onMid(CHART.presaleFill, 100), top: onMid(CHART.presale, 100), side: onMid(CHART.presaleFill, 52), seam: onMid(CHART.presaleFill, 70) },
  floor: { front: onMid(CHART.floor, 36), top: onMid(CHART.floor, 80), side: onMid(CHART.floor, 20), seam: CHART.bg },
  harvest: { front: onMid(CHART.floor, 62), top: onMid(CHART.floor, 100), side: onMid(CHART.floor, 36), seam: CHART.bg },
  harvestAlt: { front: onMid(CHART.floor, 50), top: onMid(CHART.floor, 100), side: onMid(CHART.floor, 30), seam: CHART.bg },
  redeem: { front: onMid(CHART.fees, 62), top: onMid(CHART.fees, 100), side: onMid(CHART.fees, 36), seam: CHART.bg },
  market: { front: onMid(CHART.market, 70), top: onMid(CHART.market, 100), side: onMid(CHART.market, 40), seam: onMid(CHART.market, 50) },
  cuts: { front: onMid(CHART.fees, 78), top: onMid(CHART.fees, 100), side: onMid(CHART.fees, 44), seam: onMid(CHART.fees, 55) },
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
const GLASS = 0.72;
/** A block's settle and its "+x%" tag, in story time. */
const DROP_T = 0.3;
const TAG_T = 0.34;
/** A block settles from this far above (px): the site's motion travels at most 16px for UI, a bit more for a falling block. */
const DROP_PX = { compact: 18, wide: 28 } as const;

/** The x window's right end: fixed early, then it follows the ball so the stair fills the plot. */
function xMaxFor(f: StoryFrame): number {
  if (f.beatIndex < 2) return X_EARLY;
  return Math.min(STORY_T_END, Math.max(X_EARLY, f.t * (1 + X_LEAD_SHARE) + X_LEAD));
}

/** The trading path is made up whenever it is drawn (pump onward), not only in the engine's flagged beats. */
export const madeUpPath = (f: StoryFrame): boolean => f.illustrative || (f.beatIndex >= 2 && f.priceOpacity > 0);

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
  if (!(x1 > x0) || !(yBot > yTop - 0.01)) return null;
  const c = BLOCK[kind];
  const f = boxFaces(x0, x1, yTop, yBot, p.dx, p.dy, topX1);
  return (
    <g opacity={opacity}>
      <polygon points={f.side} style={fill(c.side, { fillOpacity: frontOpacity < 1 ? 0.8 : 1 })} />
      <polygon points={f.top} style={fill(c.top)} />
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

export function BlocksStage({ m, frame: raw, still = false }: VariantProps & { frame: StoryFrame; still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const frame: StoryFrame = { ...raw, valueOf100: onArbLine(m, raw, raw.t, raw.valueOf100) };
  return (
    <div className={`${styles.stage} ${still ? styles.stageStill : ""}`} aria-hidden data-v15-stage="">
      <BrandChartFrame
        size={still ? "still" : "stage"}
        className={styles.chart}
        style={still ? { height: 260 } : undefined}
        illustration={madeUpPath(frame)}
        scale={frame.zoom > 0 ? "real" : null}
        scaleOpacity={clamp01(frame.zoom * 2)}
      >
        <div ref={ref} className={styles.scene}>
          <Scene m={m} frame={frame} size={size} under={Math.max(0, frame.valueOf100 - raw.valueOf100)} />
        </div>
      </BrandChartFrame>
      <Tiles frame={frame} />
      <Ledger frame={frame} />
    </div>
  );
}

/** The landing's two tiles; the phone label drops "now" so the value never truncates it. */
function Tiles({ frame }: { frame: StoryFrame }) {
  const { now, floor } = tileValues(frame);
  const short = TILE_NOW.replace(/ now$/, "");
  return (
    <div className={styles.tiles}>
      <p className={styles.tileNow}>
        <span>
          {short}
          {short !== TILE_NOW ? <span className={styles.wideOnly}>{TILE_NOW.slice(short.length)}</span> : null}
        </span>
        <b data-part="tile-now">{now}</b>
      </p>
      <p className={styles.tileFloor}>
        <span>{TILE_FLOOR}</span>
        <b data-part="tile-floor">{floor}</b>
      </p>
    </div>
  );
}

/** One mini cube per block on the stair, plus what the fees and exits added: the original's ledger. */
function Ledger({ frame }: { frame: StoryFrame }) {
  const harvests = frame.events.filter((e) => e.kind === "harvest").length;
  const redeems = frame.events.filter((e) => e.kind === "redeem").length;
  const hasFloor = frame.floorReveal > 0.5;
  return (
    <div className={styles.ledger}>
      <span className={styles.cubes}>
        {hasFloor ? <span className={styles.ledgerLabel}>Blocks</span> : null}
        {hasFloor ? <i className={`${styles.cube} ${styles.cubeBase}`} /> : null}
        {Array.from({ length: harvests }, (_, i) => (
          <i key={`h${i}`} className={`${styles.cube} ${styles.cubeHarvest}`} />
        ))}
        {Array.from({ length: redeems }, (_, i) => (
          <i key={`r${i}`} className={`${styles.cube} ${styles.cubeRedeem}`} />
        ))}
      </span>
      <span className={styles.pills}>
        {frame.feesPct !== null ? <span className="pill pill-sm pill-floor tnum">{CHART_COPY.fromFees(frame.feesPct)}</span> : null}
        {frame.exitsPct !== null ? <span className="pill pill-sm pill-graduating tnum">{CHART_COPY.fromExits(frame.exitsPct)}</span> : null}
      </span>
    </div>
  );
}

function Scene({ m, frame, size, under }: VariantProps & { frame: StoryFrame; size: Size; under: number }) {
  const clip = useId().replace(/:/g, "");
  const p = plotFor(size);
  const { w, h } = size;
  const xMax = xMaxFor(frame);
  const X = (t: number) => lerpMap(t, 0, xMax, p.l, p.r);
  const Y = (v: number) => lerpMap(v, frame.y.min, frame.y.max, p.b, p.t);
  const groundY = frame.y.min <= 0 ? p.b : p.b + 40;
  const t = frame.t;
  const nowX = X(t);
  const drop = p.compact ? DROP_PX.compact : DROP_PX.wide;

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
  const splitDx = p.compact ? 32 : 64;
  const splitDy = p.compact ? 16 : 26;

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
  // How far the engine's dip pushes into the line (px): the ball squashes on it, the line holds.
  const push = arb === null ? 0 : Y(arb - under) - Y(arb);
  const squash = Math.min(0.18, push / (p.ball * 4));
  const arbIn = frame.beat === "bounce" ? within(frame.beatProgress, 0, 0.15) : arb === null ? 0 : 1;
  const glass = 1 - (1 - GLASS) * arbIn;
  const floorTop = frame.floor100 === null ? null : Y(frame.floor100);
  const shadowGap = floorTop === null || !showFloor ? null : floorTop - ballBottom;

  const ticks = niceTicks(frame.y.min, frame.y.max, p.compact ? 3 : 4);
  const trail = polyline(frame.path.map(([pt, pv]) => [X(pt), Y(onArbLine(m, frame, pt, pv))] as [number, number]));

  const redeem = easeOutCubic(frame.redeemProgress);
  const net = frame.floorNet100;

  /* the floor's true edge: the engine's staircase (scaled in with the reveal during the split) */
  const floorEdge = showFloor ? polyline(frame.floorSteps.map(([st, sv]) => [X(st), Y(sv * reveal)] as [number, number])) : null;

  /* blocks: the foundation, then one per event; each block's top face shows only where nothing stands on it */
  let harvestNo = 0;
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
            kind: (e.kind === "harvest" ? (harvestNo++ % 2 === 0 ? "harvest" : "harvestAlt") : "redeem") as Kind,
            lift: (1 - easeOutCubic(k)) * drop,
            opacity: Math.min(1, k * 3),
            landed: k >= 1,
          };
        }),
      ]
    : [];

  /* the arbitrage line: arbLineRatio × the real staircase, ending where the stair ends (at the ball) */
  const arbPts: Array<[number, number]> | null = arbY === null ? null : frame.floorSteps.map(([st, sv]) => [X(st), Y(sv * m.arbLineRatio)] as [number, number]);
  const arbLabelAt = arbPts && arbPts.length > 0 ? arbPts[0]! : null;
  const arbPath = arbPts ? polyline(arbPts) : null;
  /* the bounce point: where the ball met the line */
  const dipAt = frame.dip ? ([X(frame.dip.t), Y(onArbLine(m, frame, frame.dip.t, frame.dip.value))] as const) : null;

  const wide = frame.y.max > 150;
  const floorChip = showFloor && frame.floor100 !== null && frame.beatIndex >= 1 && frame.beatIndex <= 3 && reveal >= 1;
  const showDip = frame.dip && arbY !== null && frame.beatIndex >= 5 && frame.beatIndex <= 6 && t > frame.dip.t + 0.25;

  return (
    <svg className={styles.svg} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
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
      {wide && frame.beatIndex >= 2 && frame.beatIndex <= 3 ? (
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

        {/* presale tower */}
        {towerFade > 0
          ? Array.from({ length: TOWER_SLABS }, (_, i) => {
              const land = clamp01(filled - i);
              if (land <= 0) return null;
              const kind: Kind = split < 0.05 ? "presale" : i < floorSlabs ? "floor" : i >= TOWER_SLABS - cutSlabs ? "cuts" : "market";
              const away = i < floorSlabs ? 0 : split;
              const fall = (1 - easeOutCubic(land)) * drop;
              const yBot = p.b - i * slabH - fall - away * splitDy;
              const dxAway = away * splitDx * (i >= TOWER_SLABS - cutSlabs ? 1.4 : 1);
              return (
                <Box key={i} x0={tx0 + dxAway} x1={tx1 + dxAway} yTop={yBot - slabH + 1} yBot={yBot} kind={kind} p={p} seam={1} opacity={towerFade * Math.min(1, land * 2) * (1 - away * 0.12)} />
              );
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
              seam={i > 0 ? 0.85 : 0}
              frontOpacity={glass}
              topX1={next && next.landed ? next.x0 : nowX}
            />
          );
        })}

        {/* the floor's true value: the mint staircase, exact risers */}
        {floorEdge ? <path d={floorEdge} className={styles.stair} style={{ stroke: CHART.floor, strokeWidth: STROKE.floor }} /> : null}

        {/* ball shadow on the floor edge */}
        {shadowGap !== null && shadowGap >= -1 && frame.priceOpacity > 0.5 ? (
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

        {/* the price's track, on top of the blocks */}
        <g opacity={frame.priceOpacity} clipPath={`url(#plot-${clip})`}>
          <path d={trail} className={styles.line} style={{ stroke: CHART.bg, strokeWidth: 6, strokeOpacity: 0.55 }} />
          <path d={trail} className={styles.line} style={{ stroke: CHART.price, strokeWidth: STROKE.price }} />
        </g>

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

        <Ball cx={nowX} bottom={ballBottom} r={p.ball} squash={squash} opacity={frame.priceOpacity} />

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

      {/* labels that live outside the clip */}
      {towerFade > 0 && frame.beatIndex === 0 && filled >= 1 ? (
        <Chip x={(tx0 + tx1) / 2 + p.dx / 2} y={towerTop + p.dy - 18} text={CHART_COPY.raised(Math.round(frame.raisedUsd / 100) * 100)} />
      ) : null}
      {split > 0.6 && towerFade > 0 ? (
        <g opacity={towerFade * within(split, 0.6, 1)}>
          <text x={(tx0 + tx1) / 2} y={p.b - (floorSlabs * slabH) / 2 + 4} textAnchor="middle" className={styles.towerLabel} style={fill(CHART.floor)}>
            {CHART_COPY.floorShare(Math.round(m.v * 100))}
          </text>
          <text x={(tx0 + tx1) / 2 + splitDx} y={p.b - (floorSlabs + 4) * slabH - splitDy + 4} textAnchor="middle" className={styles.towerLabel} style={fill(CHART.price)}>
            {CHART_COPY.market}
          </text>
        </g>
      ) : null}
      {floorChip && frame.floor100 !== null ? (
        <Chip
          x={X(T_GRAD) + p.dx}
          y={baseTop + p.dy - 16}
          text={`${CHART_COPY.floor} ${formatUsdCents(frame.floorNet100 ?? frame.floor100)}`}
          tone="floor"
          anchor="start"
          opacity={frame.beatIndex === 1 ? within(frame.beatProgress, 0.8, 1) : 1}
        />
      ) : null}
      {frame.beatIndex >= 2 && frame.zoom === 0 && t >= frame.peak.t - 1e-9 ? <Chip x={X(frame.peak.t)} y={Y(frame.peak.value) - p.ball * 2 - 8} text={CHART_COPY.peak(frame.peak.value)} /> : null}

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
