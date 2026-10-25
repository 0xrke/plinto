import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, BEAT_KEYS, easeInOut, type BeatKey, type StoryFrame } from "@/lib/landing/sim/story";
import { T_GRAD, range } from "@/lib/landing/sim/timeline";
import {
  VB,
  areaUnderD,
  clampPct,
  monotonePathD,
  niceTicks,
  ramp,
  stepPathD,
  type Scales,
} from "@/components/landing/lab/storyChartGeometry";
import {
  BRAND_CLASS,
  BrandChartFrame,
  CHART,
  CHART_COPY,
  DASH,
  SINCE_LISTING,
  STROKE,
  TILE_FLOOR,
  TILE_NOW,
  TILE_REDEEMED,
  alpha,
  formatPctChange,
  formatUsdCents,
  formatUsdWhole,
  sinceListing,
  tileValues,
} from "../shared";
import { COMPACT_W, STEPS_I, headFraction, layoutSections, layoutTags, tagSize, type TagSize } from "./sections";
import styles from "./splitSections.module.css";

/*
 * Variant 30's one chart: 28's whole-story panel chart (copied from v28's PanelChart) split into
 * 27-style beat sections. A strip along the top of the card names each section ("01 Presale",
 * "02 Split", …): the current one white with a mint number, the others readable; thin dividers
 * separate the sections and the current one is lit. The names follow the camera: when it zooms into
 * the staircase the presale and split leave the view, their names go with them, and a section too
 * narrow for its name shows only its number. Right of the price head the chart is blank, hatched
 * "still to come" (as on 27's tape), and the two values ride the head there as 27's tooltips:
 * "Your $100 now" and "Floor pays back", each with its change since listing once trading opens.
 *
 * The rest is 28's: the raise as its own presale-sky bar on the chart's own $ axis that fills during
 * the presale, then divides at the split (floor mint at the bottom, market iris, fees butter on top,
 * each labelled), the floor segment settling onto the floor slab the staircase starts from; white
 * price, mint staircase over a mint-at-14% slab, rose dashed arbitrage line and bounce. A pure
 * function of the frame (no timers, no transitions on values). The SVG is a unit box stretched over
 * the plot with non-scaling strokes; labels are HTML placed in percent, the strip and the tooltips in
 * px from the plot's measured size. Colours are CHART tokens and site tokens only.
 */

const SPLIT_END = BEATS[1]!.end;
/** The raise column in story time (x) and USD per $100 (y). The floor slab starts at T_GRAD = 1. */
const COL = { x0: 0.1, x1: 0.92, top: 100 } as const;

type SegKey = "floor" | "market" | "creator" | "platform";

/** Column segments as cumulative shares of the raise, bottom to top. */
export function columnSegments(m: LaunchMath): Array<{ key: SegKey; from: number; to: number }> {
  const parts: Array<[SegKey, number]> = [
    ["floor", m.split.floorUsd],
    ["market", m.split.poolUsd],
    ["creator", m.split.creatorUsd],
    ["platform", m.split.platformUsd],
  ];
  let acc = 0;
  return parts.map(([key, usd]) => {
    const from = acc / m.raiseUsd;
    acc += usd;
    return { key, from, to: acc / m.raiseUsd };
  });
}

const pctOfRaise = (m: LaunchMath, usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;

/** The split column's segment labels: "Floor 50%", "Market 40%", "Fees 5% · 5%". */
export function splitLabels(m: LaunchMath): { floor: string; market: string; fees: string } {
  return {
    floor: CHART_COPY.floorShare(Math.round(m.v * 100)),
    market: `${CHART_COPY.market} ${pctOfRaise(m, m.split.poolUsd)}%`,
    fees: `Fees ${CHART_COPY.fees(pctOfRaise(m, m.split.creatorUsd), pctOfRaise(m, m.split.platformUsd))}`,
  };
}

/**
 * The split's own sub-phases on the 150svh runway (28's): the column divides over the first 30% of
 * the beat, the labelled column holds still until 60%, then the floor segment settles (60%..100%).
 */
export const SPLIT_DIVIDE: readonly [number, number] = [0, 0.3];
export const SPLIT_SETTLE: readonly [number, number] = [0.6, 1];
export function splitPhase(f: StoryFrame): { grow: number; reveal: number } {
  if (f.beatIndex < 1) return { grow: 0, reveal: 0 };
  if (f.beatIndex > 1) return { grow: 1, reveal: 1 };
  const bp = f.beatProgress;
  return { grow: range(bp, SPLIT_DIVIDE[0], SPLIT_DIVIDE[1]), reveal: easeInOut(range(bp, SPLIT_SETTLE[0], SPLIT_SETTLE[1])) };
}

/** The presale label: "Raised $4,200" over "of $10,000". */
export const raisedOf = (m: LaunchMath) => `of ${formatUsdWhole(m.raiseUsd)}`;

/** How far the column has gone (0 = fully drawn, 1 = gone): it fades over the first 15% of the pump. */
export function columnGone(f: StoryFrame): number {
  if (f.beatIndex <= 1) return 0;
  if (f.beat === "pump") return ramp(f.beatProgress, 0, 0.15);
  return 1;
}

/**
 * The chart frames the story so far: x from 0 (or from graduation once the camera has zoomed in) to
 * past the price head, with the head at `headFrac` of the width so the tooltips ride on blank chart
 * to its right. The presale and the split share one fixed frame (up to the split's end), so the raise
 * column never stretches while it divides; from the pump on the frame follows the head continuously.
 */
export function panelScales(f: StoryFrame, headFrac = 0.7): Scales {
  const x0 = T_GRAD * f.zoom;
  const x1 = x0 + (Math.max(f.t, SPLIT_END) - x0) / headFrac;
  const xs = x1 - x0;
  const span = f.y.max - f.y.min || 1;
  return {
    xOf: (t) => ((t - x0) / xs) * VB,
    yOf: (v) => VB * (1 - (v - f.y.min) / span),
    pctX: (t) => ((t - x0) / xs) * 100,
    pctY: (v) => (1 - (v - f.y.min) / span) * 100,
  };
}

/** The stills' chart height: the shared 180px still frame is too short for the strip and the column. */
const STILL_STYLE: CSSProperties = { height: 360 };
/** Plot size before it is measured (server render, tests): roughly the 1440×900 stage, or a still. */
const STAGE_BOX = { w: 600, h: 600 };
const STILL_BOX = { w: 560, h: 250 };

/** Element size via ResizeObserver (no scroll listener); a sane default for the server render. */
function useBox(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        setBox((p) => (Math.round(r.width) === p.w && Math.round(r.height) === p.h ? p : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [box, ref] as const;
}

const ns = { vectorEffect: "non-scaling-stroke" as const, fill: "none" };

export function SectionChart({ m, frame: f, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  const [box, ref] = useBox(still ? STILL_BOX : STAGE_BOX);
  const compact = box.w < COMPACT_W;
  const tag = tagSize(compact);
  const s = panelScales(f, headFraction(box.w, tag));
  const phase = splitPhase(f);
  const floorOpacity = f.floorSteps.length ? phase.reveal : 0;
  const stepD = f.floorSteps.length ? stepPathD(f.floorSteps, s) : "";
  const arbOpacity = f.arbLine100 === null ? 0 : f.beat === "bounce" ? ramp(f.beatProgress, 0, 0.2) : 1;
  const ticks = niceTicks(f.y.min, f.y.max, 3);
  const tickStep = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const tickLabel = (v: number) => (Number.isInteger(tickStep) && Number.isInteger(v) ? formatUsdWhole(v) : formatUsdCents(v));
  // The $100 reference line is named in the gutter (never on the plot, where the tooltips ride).
  const hundredIn = f.zoom < 1 && 100 > f.y.min && 100 < f.y.max && !ticks.some((v) => Math.abs(v - 100) < 1e-6);
  const head = { x: clampPct(s.pctX(f.t)), y: clampPct(s.pctY(f.valueOf100)) };
  const headPx = { x: (head.x / 100) * box.w, y: (head.y / 100) * box.h };
  const harvests = f.events.filter((e) => e.kind === "harvest");
  const holders = f.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const redeemNet = f.floorNet100 ?? 0;
  const redeemY = clampPct(s.pctY(f.valueOf100 + (redeemNet - f.valueOf100) * f.redeemProgress));
  const own = (k: BeatKey) => f.beat === k;
  const colGone = columnGone(f);
  // Every path drawn past the presale is made up, including its faded hold during redeem.
  const illustrated = BEAT_KEYS.indexOf(f.beat) >= 2 && f.priceOpacity > 0;
  const arbEndY = f.floor100 !== null ? clampPct(s.pctY(m.arbLineRatio * f.floor100)) : 50;
  const showPeak = (own("pump") || own("selloff")) && f.t >= f.peak.t;
  // "Bounce" sits under the dip, but never reaches past the head (the tooltips ride there).
  const bounceX = f.dip ? Math.min(s.pctX(f.dip.t), ((headPx.x - (compact ? 26 : 30)) / box.w) * 100) : 0;

  return (
    <BrandChartFrame
      illustration={illustrated}
      scale={f.zoom > 0 ? "real" : null}
      scaleOpacity={f.zoom}
      size={still ? "still" : "stage"}
      style={still ? STILL_STYLE : undefined}
      className={styles.chart}
    >
      <div className={`${styles.plot} ${compact ? styles.compact : ""}`} data-part="mini-chart">
        <Sections f={f} s={s} w={box.w} headX={head.x} compact={compact} />
        {/* Y-axis gutter: tick labels live outside the plot so they never meet the chart's labels. */}
        <div className={styles.yaxis}>
          {ticks.map((v) => (
            <At key={v} y={s.pctY(v)}>
              <span className={`${styles.lbl} ${styles.tickLbl}`} style={{ color: CHART.axis }}>
                {tickLabel(v)}
              </span>
            </At>
          ))}
          {hundredIn ? (
            <At y={s.pctY(100)} opacity={1 - f.zoom}>
              <span className={`${styles.lbl} ${styles.tickLbl} ${styles.tickHundred}`}>{CHART_COPY.hundred}</span>
            </At>
          ) : null}
        </div>
        <div className={styles.area} ref={ref}>
          <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none" className={styles.svg}>
            <g opacity={1 - f.zoom}>
              <line
                x1={0}
                x2={VB}
                y1={s.yOf(100)}
                y2={s.yOf(100)}
                {...ns}
                style={{ stroke: CHART.axis, strokeWidth: STROKE.ref, strokeDasharray: DASH.ref, strokeOpacity: 0.5 }}
              />
            </g>
            {ticks.map((v) => (
              <line key={v} x1={0} x2={VB} y1={s.yOf(v)} y2={s.yOf(v)} {...ns} style={{ stroke: CHART.grid, strokeWidth: STROKE.grid }} />
            ))}
            {stepD ? (
              <>
                <path d={areaUnderD(f.floorSteps, s)} style={{ fill: CHART.floorSlab }} opacity={floorOpacity} />
                {f.arbLine100 !== null ? (
                  <path
                    d={stepPathD(f.floorSteps, s, m.arbLineRatio)}
                    {...ns}
                    style={{ stroke: CHART.arb, strokeWidth: STROKE.arb, strokeDasharray: DASH.arb }}
                    opacity={arbOpacity}
                    data-part="arb-line"
                  />
                ) : null}
                <path
                  d={stepD}
                  {...ns}
                  style={{ stroke: CHART.floor, strokeWidth: STROKE.floor, strokeLinejoin: "miter" }}
                  opacity={floorOpacity}
                  data-part="floor-steps"
                />
              </>
            ) : null}
            {colGone < 1 ? <RaiseColumn m={m} f={f} s={s} opacity={1 - colGone} /> : null}
            <path
              d={monotonePathD(f.path, s)}
              {...ns}
              style={{ stroke: CHART.price, strokeWidth: STROKE.price, strokeLinejoin: "round", strokeLinecap: "round" }}
              opacity={f.priceOpacity}
              data-part="price"
            />
          </svg>

          {/* The raise: two lines inside the top of the filling bar (clear of the $100 line and the tooltip above it). */}
          {f.beatIndex <= 1 && phase.grow < 0.25 ? (
            <RaisedLabel m={m} f={f} s={s} opacity={1 - ramp(phase.grow, 0, 0.25)} compact={compact} />
          ) : null}
          {colGone < 1 ? <SplitLabels m={m} f={f} s={s} opacity={1 - colGone} /> : null}
          {/* The settled slab is named "Floor" (its value rides the head in the floor tooltip, so it is not repeated here).
              On a zoomed phone plot the first stair is narrower than the word, so it sits inside the slab, under the line. */}
          {f.floor100 !== null && floorOpacity > 0 ? (
            <At
              x={s.pctX(f.floorSteps[0]![0])}
              y={clampPct(s.pctY(f.floorSteps[0]![1]), 10, 100)}
              opacity={f.beatIndex <= 1 ? ramp(phase.reveal, 0.6, 1) : floorOpacity}
            >
              <span className={`${styles.lbl} ${styles.slabLbl} ${compact && f.zoom > 0.5 ? styles.below : styles.above}`} data-part="label-slab">
                {CHART_COPY.floor}
              </span>
            </At>
          ) : null}
          {f.arbLine100 !== null && f.floorSteps.length ? (
            <At x={s.pctX(f.floorSteps[0]![0])} y={clampPct(s.pctY(f.floorSteps[0]![1] * m.arbLineRatio), 0, 88)} opacity={arbOpacity}>
              <span className={`${styles.lbl} ${styles.below}`} style={{ color: CHART.arb }}>
                {CHART_COPY.arbLine}
              </span>
            </At>
          ) : null}
          {f.zoom > 0
            ? harvests.map((e) => <Dot key={e.t} x={s.pctX(e.t)} y={s.pctY(e.to)} size={6} color={CHART.floor} opacity={f.zoom} />)
            : null}
          {own("steps") && f.feesPct !== null ? (
            <At
              x={s.pctX((T_GRAD + (harvests[harvests.length - 1]?.t ?? T_GRAD)) / 2)}
              y={clampPct(s.pctY(harvests[harvests.length - 1]?.to ?? 0), 12, 90)}
              opacity={ramp(f.zoom, 0.85, 1)}
            >
              <span className={`${styles.lbl} ${styles.lblStrong} ${styles.above} ${styles.center}`} style={{ color: CHART.floor }} data-part="fees">
                {CHART_COPY.fromFees(f.feesPct)}
              </span>
            </At>
          ) : null}
          {f.dip ? (
            <>
              <Dot x={s.pctX(f.dip.t)} y={s.pctY(f.dip.value)} size={10} color={CHART.bounce} halo={CHART.bounceHalo} />
              {own("bounce") ? (
                <At x={bounceX} y={clampPct(s.pctY(f.dip.value), 0, 86)}>
                  <span className={`${styles.lbl} ${styles.lblStrong} ${styles.below} ${styles.center}`} style={{ color: CHART.bounce }} data-part="bounce">
                    {CHART_COPY.bounce}
                  </span>
                </At>
              ) : null}
            </>
          ) : null}
          {own("exits") && holders && f.exitsPct !== null ? (
            <>
              <Dot x={s.pctX(holders.t)} y={s.pctY(holders.to)} size={6} color={CHART.floor} />
              <At x={s.pctX(holders.t)} y={(clampPct(s.pctY(holders.from * m.arbLineRatio)) + 100) / 2} opacity={ramp(f.beatProgress, 0.5, 0.65)}>
                <span className={`${styles.lbl} ${styles.lblStrong} ${styles.belowLeft}`} style={{ color: CHART.floor }} data-part="exits">
                  {CHART_COPY.fromExits(f.exitsPct)}
                </span>
              </At>
            </>
          ) : null}
          {own("pump") || own("selloff") ? (
            // Up-left of the peak (never centred over it): at the pump's end the head, and its tooltip, sit right there.
            <At x={s.pctX(f.peak.t)} y={clampPct(s.pctY(f.peak.value), 9, 100)} opacity={showPeak ? 1 : 0}>
              <span className={`${styles.chipAt} ${BRAND_CLASS.pillRaised} tnum`} data-part="peak">
                {CHART_COPY.peak(f.peak.value)}
              </span>
            </At>
          ) : null}

          {f.redeemProgress > 0 ? (
            <>
              <Dot x={head.x} y={redeemY} size={10} color={CHART.floor} halo={alpha(CHART.floor, 0.25)} />
              {/* Midway between the arbitrage line's last step and the plot floor: clear of every line. The amount rides in the floor tooltip. */}
              <At x={head.x} y={(arbEndY + 100) / 2} opacity={ramp(f.redeemProgress, 0.4, 1)}>
                <span className={`${styles.redeemChip} tnum`} data-part="redeem">
                  {CHART_COPY.redeemWord}
                </span>
              </At>
            </>
          ) : null}
          <Tooltips m={m} f={f} s={s} w={box.w} h={box.h} head={headPx} tag={tag} reveal={floorOpacity} />
        </div>
      </div>
    </BrandChartFrame>
  );
}

/* ---------- the beat sections (27's ruler, following this chart's camera) ---------- */

/**
 * The sections layer: a tint on the presale and on the current section, thin dividers between the
 * sections (the steps moment dashed mint, with a mint diamond in the strip), the hatched blank chart
 * right of the head, and the strip of section names along the top. All x positions follow the
 * chart's own x scale, so they move and zoom with the camera.
 */
function Sections({ f, s, w, headX, compact }: { f: StoryFrame; s: Scales; w: number; headX: number; compact: boolean }) {
  const pct = BEATS.map((b) => ({ x0: s.pctX(b.start), x1: s.pctX(b.end) }));
  const px = pct.map(({ x0, x1 }) => ({ x0: (x0 / 100) * w, x1: (x1 / 100) * w }));
  const names = layoutSections(px, w, f.beatIndex, compact);
  const cur = f.beatIndex;
  const inside = (x: number) => x > 0.05 && x < 99.95;
  const band = (i: number) => {
    const a = clampPct(pct[i]!.x0);
    const b = clampPct(i === BEATS.length - 1 ? Math.max(pct[i]!.x1, 100) : pct[i]!.x1);
    return b - a > 0.05 ? { left: `${a}%`, width: `${b - a}%` } : null;
  };
  const presale = band(0);
  const current = cur === STEPS_I ? null : band(cur);
  const prog = cur === STEPS_I ? null : { a: clampPct(pct[cur]!.x0), b: clampPct(Math.min(headX, pct[cur]!.x1)) };
  const stepsX = pct[STEPS_I]!.x0;
  return (
    <>
      <div className={styles.bands} aria-hidden>
        {presale ? <span className={styles.bandPresale} style={presale} /> : null}
        {current ? <span className={styles.bandCurrent} style={current} data-part="section-current" data-beat={BEAT_KEYS[cur]} /> : null}
        <span className={styles.hatch} style={{ left: `${headX}%` }} />
        {BEATS.map((b, i) =>
          // The bounce starts where the steps moment is: one divider (the steps' own) marks both.
          i > 0 && i !== STEPS_I + 1 && inside(pct[i]!.x0) ? (
            <span key={b.key} className={i === STEPS_I ? styles.dividerSteps : styles.divider} style={{ left: `${pct[i]!.x0}%` }} data-part="divider" />
          ) : null,
        )}
      </div>
      <div className={styles.strip} data-part="sections">
        {inside(stepsX) ? (
          <span className={`${styles.diamond} ${cur < STEPS_I ? styles.diamondFuture : ""}`} style={{ left: `${stepsX}%` }} aria-hidden />
        ) : null}
        {prog && prog.b > prog.a ? <span className={styles.stripProg} style={{ left: `${prog.a}%`, width: `${prog.b - prog.a}%` }} /> : null}
        {names.map((n) =>
          n.level === "hidden" ? null : (
            <span
              key={n.i}
              className={`${styles.secName} ${n.i < cur ? styles.past : n.i === cur ? styles.current : styles.future}`}
              style={{ transform: `translate(${n.left.toFixed(1)}px, -50%)` }}
              data-part="section-name"
              data-beat={BEAT_KEYS[n.i]}
              data-level={n.level}
              data-current={n.i === cur ? "true" : undefined}
            >
              <span className={styles.secNum}>{n.text.slice(0, 2)}</span>
              {n.level === "full" ? n.text.slice(2) : null}
            </span>
          ),
        )}
      </div>
    </>
  );
}

/* ---------- the riding tooltips (27's tags) ---------- */

/**
 * "Your $100 now" and "Floor pays back" ride beside the price head on the blank chart to its right,
 * each joined to its own line by a thin connector: the price tag to the head dot, the floor tag to a
 * mint dot on the staircase. They never overlap (the larger number takes the upper tag), stay inside
 * the plot, and flip to the head's left only when the plot is too narrow for them on the right.
 * Before trading opens the price tag sits just above the $100 line, clear of the filling bar.
 */
function Tooltips({
  m,
  f,
  s,
  w,
  h,
  head,
  tag,
  reveal,
}: {
  m: LaunchMath;
  f: StoryFrame;
  s: Scales;
  w: number;
  h: number;
  head: { x: number; y: number };
  tag: TagSize;
  reveal: number;
}) {
  const { now, floor } = tileValues(f);
  const change = sinceListing(m, f);
  const floorY = f.floor100 !== null ? (clampPct(s.pctY(f.floor100)) / 100) * h : null;
  const showFloor = floor !== "—" && floorY !== null && reveal > 0.01;
  const priceH = change.now !== null ? tag.h1 : tag.h0;
  const floorH = change.floor !== null ? tag.h1 : tag.h0;
  const tagH = Math.max(priceH, showFloor ? floorH : 0);
  const priceOnTop = now !== TILE_REDEEMED && f.floorNet100 !== null ? f.valueOf100 >= f.floorNet100 : undefined;
  const preTrade = f.beatIndex <= 1;
  const priceAim = preTrade ? head.y - priceH / 2 - 12 : head.y;
  const ys = layoutTags(priceAim, showFloor ? floorY : null, tagH, 4, h - 4, 8, preTrade ? true : priceOnTop);
  // The head sits exactly where the room fits (headFraction): a 1px tolerance keeps rounding from flipping it.
  const flip = head.x + tag.gap + tag.w > w - tag.margin + 1;
  const x = flip ? head.x - tag.gap - tag.w : head.x + tag.gap;
  const edgeX = flip ? x + tag.w : x;
  return (
    <>
      <svg className={styles.conn} viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`} preserveAspectRatio="none" aria-hidden>
        {showFloor && ys.floor !== null && floorY !== null ? (
          <path d={`M${head.x} ${floorY}L${edgeX} ${ys.floor}`} className={styles.connMint} opacity={reveal} />
        ) : null}
        <path d={`M${head.x} ${head.y}L${edgeX} ${ys.price}`} className={styles.connWhite} opacity={Math.max(0.55, f.priceOpacity)} />
      </svg>
      {showFloor && floorY !== null ? <DotPx x={head.x} y={floorY} size={9} className={styles.floorDot} opacity={reveal} /> : null}
      <DotPx x={head.x} y={head.y} size={11} className={styles.headDot} opacity={Math.max(0.55, f.priceOpacity)} part="head" />
      {showFloor && ys.floor !== null ? (
        <Tag x={x} cy={ys.floor} w={tag.w} h={floorH} tone="floor" label={TILE_FLOOR} value={floor} pct={change.floor} opacity={reveal} />
      ) : null}
      <Tag x={x} cy={ys.price} w={tag.w} h={priceH} tone="price" label={TILE_NOW} value={now} pct={now === TILE_REDEEMED ? null : change.now} opacity={Math.max(0.55, f.priceOpacity)} />
    </>
  );
}

type Sign = "up" | "down" | "flat";
const signOf = (pct: number): Sign => (formatPctChange(pct) === "0.0%" ? "flat" : pct > 0 ? "up" : "down");

/**
 * One tooltip: label, value and (once trading opens) the change since listing under the value. The
 * floor's change reads in the floor colour; the price's is floor-green when up and coral when down.
 */
function Tag({
  x,
  cy,
  w,
  h,
  tone,
  label,
  value,
  pct,
  opacity,
}: {
  x: number;
  cy: number;
  w: number;
  h: number;
  tone: "price" | "floor";
  label: string;
  value: string;
  pct: number | null;
  opacity: number;
}) {
  const sign = pct === null ? null : signOf(pct);
  const pctClass = tone === "floor" ? styles.pctFloor : sign === "down" ? styles.pctDown : sign === "up" ? styles.pctUp : styles.pctFlat;
  return (
    <div
      className={`${styles.tag} ${tone === "floor" ? styles.tagFloor : styles.tagPrice}`}
      style={{ width: w, height: h, transform: `translate(${x.toFixed(1)}px, ${(cy - h / 2).toFixed(1)}px)`, opacity }}
      data-part={`tag-${tone}`}
    >
      <span className={styles.tagLabel}>{label}</span>
      <b className={`${styles.tagValue} tnum`} data-part={tone === "price" ? "tile-now" : "tile-floor"}>
        {value}
      </b>
      {pct !== null && sign !== null ? (
        <span className={`${styles.tagPct} tnum`} data-part={tone === "price" ? "since-now" : "since-floor"} data-sign={sign}>
          <b className={pctClass}>{formatPctChange(pct)}</b> {SINCE_LISTING}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- the raise column (variants 1/3, as in 28) ---------- */

/** The column's geometry for a frame: segment boxes in USD, the gap between them and the floor's top. */
function columnGeometry(m: LaunchMath, f: StoryFrame) {
  const segs = columnSegments(m);
  const { grow, reveal } = splitPhase(f);
  const gap = 1.2 * easeInOut(ramp(grow, 0, 0.5));
  const drop = easeInOut(ramp(reveal, 0, 0.7));
  const floorShareTop = segs[0]!.to * COL.top;
  const floorTop = floorShareTop + (m.floorPer100GrossUsd - floorShareTop) * drop - gap * (1 - drop);
  return { segs, grow, gap, drop, floorTop };
}

/** Each share takes its colour as its label appears: floor, then market, then the fees. */
const TINT: Record<SegKey, readonly [number, number]> = { floor: [0, 0.3], market: [0.25, 0.55], creator: [0.45, 0.75], platform: [0.45, 0.75] };

/**
 * The raise as its own presale-sky bar: it fills from $0 during the presale, then the SAME bar (same
 * x, same width) divides at the split. Each segment is laid over an opaque sky underlay while its
 * colour comes in (never a crossfade of two translucent fills, which reads as grey).
 */
function RaiseColumn({ m, f, s, opacity }: { m: LaunchMath; f: StoryFrame; s: Scales; opacity: number }) {
  const x = s.xOf(COL.x0);
  const w = s.xOf(COL.x1) - x;
  const sky = CHART.presaleFill;
  if (f.beatIndex === 0) {
    const fill = (f.raisedUsd / m.raiseUsd) * COL.top;
    return (
      <g opacity={opacity} data-part="raise-column">
        <rect x={x} y={s.yOf(fill)} width={w} height={Math.max(0, s.yOf(0) - s.yOf(fill))} style={{ fill: sky }} data-part="raise" />
      </g>
    );
  }
  const { segs, grow, gap, floorTop } = columnGeometry(m, f);
  const fills: Record<SegKey, string> = { floor: CHART.floor, market: CHART.market, creator: CHART.fees, platform: CHART.fees };
  const box: Record<SegKey, [number, number]> = {
    floor: [0, floorTop],
    market: [segs[1]!.from * COL.top + gap, segs[1]!.to * COL.top - gap],
    creator: [segs[2]!.from * COL.top + gap, segs[2]!.to * COL.top - 0.3],
    platform: [segs[3]!.from * COL.top + 0.3, segs[3]!.to * COL.top],
  };
  return (
    <g opacity={opacity} data-part="raise-column">
      {(Object.keys(box) as SegKey[]).map((key) => {
        const [lo, hi] = box[key];
        const tint = easeInOut(ramp(grow, TINT[key][0], TINT[key][1]));
        const r = { x, y: s.yOf(hi), width: w, height: Math.max(0, s.yOf(lo) - s.yOf(hi)) };
        return (
          <g key={key}>
            {tint < 1 ? <rect {...r} style={{ fill: sky }} /> : null}
            <rect {...r} style={{ fill: fills[key] }} opacity={tint} data-part={`split-${key}`} />
          </g>
        );
      })}
    </g>
  );
}

/** The bar's fill level (USD per $100) below which the raise label sits above the bar instead of inside it. */
const RAISED_INSIDE_MIN = 30;

/**
 * "Raised $4,200" over "of $10,000", centred on the bar: inside its top (midnight on sky) once the
 * fill is tall enough, just above it before that. It never reaches the $100 line, where the price
 * runs and its tooltip rides.
 */
function RaisedLabel({ m, f, s, opacity, compact }: { m: LaunchMath; f: StoryFrame; s: Scales; opacity: number; compact: boolean }) {
  const fill = f.beatIndex === 0 ? (f.raisedUsd / m.raiseUsd) * COL.top : COL.top;
  const inside = fill >= RAISED_INSIDE_MIN;
  const raised = CHART_COPY.raised(f.raisedUsd);
  // Phones: the bar is narrow, so "Raised" gets its own line over the amount.
  const cut = raised.indexOf(" ");
  return (
    <At x={s.pctX((COL.x0 + COL.x1) / 2)} y={s.pctY(fill)} opacity={opacity}>
      <span className={`${styles.raised} ${inside ? styles.raisedIn : styles.raisedOver} tnum`} data-part="raised">
        {compact && cut > 0 ? (
          <>
            <span className={styles.raisedOf}>{raised.slice(0, cut)}</span>
            <b>{raised.slice(cut + 1)}</b>
          </>
        ) : (
          <b>{raised}</b>
        )}
        <span className={styles.raisedOf}>{raisedOf(m)}</span>
      </span>
    </At>
  );
}

function SplitLabels({ m, f, s, opacity }: { m: LaunchMath; f: StoryFrame; s: Scales; opacity: number }) {
  if (f.beatIndex === 0) return null;
  const { segs, grow, floorTop } = columnGeometry(m, f);
  const text = splitLabels(m);
  const x = s.pctX((COL.x0 + COL.x1) / 2);
  const right = s.pctX(COL.x1);
  const items = [
    { key: "floor", text: text.floor, mid: floorTop / 2, o: ramp(grow, 0.1, 0.3) },
    { key: "market", text: text.market, mid: ((segs[1]!.from + segs[1]!.to) / 2) * COL.top, o: ramp(grow, 0.35, 0.55) },
    { key: "fees", text: text.fees, mid: ((segs[2]!.from + segs[3]!.to) / 2) * COL.top, o: ramp(grow, 0.55, 0.75) },
  ];
  return (
    <>
      {items.map((l) => (
        // The fees block is too thin for text inside: its label sits just right of it, in butter.
        <At key={l.key} x={l.key === "fees" ? right : x} y={s.pctY(l.mid)} opacity={l.o * opacity}>
          <span className={`${l.key === "fees" ? styles.segLblSide : styles.segLbl} tnum`} data-part={`label-${l.key}`}>
            {l.text}
          </span>
        </At>
      ))}
    </>
  );
}

/** Overlay at (x %, y %) of the plot, moved with a transform only. */
function At({ x = 0, y = 0, opacity = 1, children }: { x?: number; y?: number; opacity?: number; children: ReactNode }) {
  return (
    <span className={styles.at} style={{ transform: `translate(${x}%, ${y}%)`, opacity } as CSSProperties}>
      {children}
    </span>
  );
}

function Dot({ x, y, size, color, halo, opacity = 1 }: { x: number; y: number; size: number; color: string; halo?: string; opacity?: number }) {
  return (
    <At x={x} y={y} opacity={opacity}>
      <span className={styles.pt} style={{ width: size, height: size, background: color, boxShadow: halo ? `0 0 0 4px ${halo}` : undefined }} />
    </At>
  );
}

/** A dot at (x, y) px of the plot. */
function DotPx({ x, y, size, className, opacity = 1, part }: { x: number; y: number; size: number; className: string; opacity?: number; part?: string }) {
  return (
    <span
      className={`${styles.ptPx} ${className}`}
      style={{ width: size, height: size, transform: `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px)`, opacity }}
      data-part={part}
    />
  );
}

