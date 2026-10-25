import type { CSSProperties, ReactNode } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, BEAT_KEYS, STORY_T_END, easeInOut, type BeatKey, type StoryFrame } from "@/lib/landing/sim/story";
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
import { BRAND_CLASS, BrandChartFrame, CHART, CHART_COPY, DASH, STROKE, alpha, formatUsdCents, formatUsdWhole } from "../shared";
import styles from "./editorialPanel.module.css";

/*
 * The panel's one chart, in the site's midnight chart card (BrandChartFrame): white price, mint floor
 * staircase over a mint-at-14% slab, rose dashed arbitrage line, rose bounce dot with a white halo.
 * The raise is its own tall presale-sky bar in dollars on the chart's own y axis (variants 1/3/22):
 * it fills from $0 during the presale ("Raised $X of $10,000"), then the same bar splits into floor (mint, bottom), market (iris) and fees (butter, top), each
 * labelled inside its segment; the floor segment settles down onto the floor slab the staircase
 * starts from, and the column fades out as the pump begins. A pure function of the frame (no timers,
 * no transitions on values), drawn at the engine's own camera (frame.y), so the close-up is real
 * scale and its chip says so. The SVG is a unit box stretched over the plot with non-scaling
 * strokes; labels are HTML placed in percent. Colours are CHART tokens only.
 */

const PRESALE_END = BEATS[0]!.end;
const SPLIT_END = BEATS[1]!.end;
/** Story time shown past the price head (room for the head and its label). */
const X_PAD = 0.6;
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

/** The settled floor slab's label at the split, matching the "Floor pays back" tile: "Floor pays $34.88". */
export const floorPaysLabel = (net100: number) => `${CHART_COPY.floor} pays ${formatUsdCents(net100)}`;

/**
 * The split's own sub-phases on this panel's longer runway (150svh): the column divides and each
 * share takes its colour and label over the first 30% of the beat, the labelled column then holds
 * still until 60%, and only then does the floor segment settle onto the slab (60%..100%). The
 * engine's splitProgress/floorReveal overlap (0..0.55 and 0.45..1), which left the labelled column
 * on screen for a moment only. Before the split both are 0, after it both are 1.
 */
export const SPLIT_DIVIDE: readonly [number, number] = [0, 0.3];
export const SPLIT_SETTLE: readonly [number, number] = [0.6, 1];
export function splitPhase(f: StoryFrame): { grow: number; reveal: number } {
  if (f.beatIndex < 1) return { grow: 0, reveal: 0 };
  if (f.beatIndex > 1) return { grow: 1, reveal: 1 };
  const bp = f.beatProgress;
  return { grow: range(bp, SPLIT_DIVIDE[0], SPLIT_DIVIDE[1]), reveal: easeInOut(range(bp, SPLIT_SETTLE[0], SPLIT_SETTLE[1])) };
}

/** The raise label's lowest anchor (USD per $100), so its two lines stay above the plot's floor. */
const RAISED_MIN_Y = 16;

/** The presale label: "Raised $4,200" over "of $10,000". */
export const raisedOf = (m: LaunchMath) => `of ${formatUsdWhole(m.raiseUsd)}`;

/** How far the column has gone (0 = fully drawn, 1 = gone): it fades over the first 15% of the pump. */
export function columnGone(f: StoryFrame): number {
  if (f.beatIndex <= 1) return 0;
  if (f.beat === "pump") return ramp(f.beatProgress, 0, 0.15);
  return 1;
}

/**
 * The chart frames the story so far: x from 0 (or from graduation once the camera has zoomed in,
 * where nothing before it is in range) to a little past the price head. The presale and the split
 * share one fixed frame (up to the split's end), so the raise column never stretches while it
 * divides; from the pump on the frame follows the head, continuously. A pure function of the frame.
 */
export function panelScales(f: StoryFrame): Scales {
  const x0 = T_GRAD * f.zoom;
  const x1 = Math.min(STORY_T_END + 0.2, Math.max(f.t, SPLIT_END) + X_PAD);
  const xs = x1 - x0;
  const span = f.y.max - f.y.min || 1;
  return {
    xOf: (t) => ((t - x0) / xs) * VB,
    yOf: (v) => VB * (1 - (v - f.y.min) / span),
    pctX: (t) => ((t - x0) / xs) * 100,
    pctY: (v) => (1 - (v - f.y.min) / span) * 100,
  };
}

/** The stills' chart height: the shared 180px still frame is too short for the split column. */
const STILL_STYLE: CSSProperties = { height: 280 };

const ns = { vectorEffect: "non-scaling-stroke" as const, fill: "none" };

export function PanelChart({ m, frame: f, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  const s = panelScales(f);
  const phase = splitPhase(f);
  const floorOpacity = f.floorSteps.length ? phase.reveal : 0;
  const stepD = f.floorSteps.length ? stepPathD(f.floorSteps, s) : "";
  const arbOpacity = f.arbLine100 === null ? 0 : f.beat === "bounce" ? ramp(f.beatProgress, 0, 0.2) : 1;
  const ticks = niceTicks(f.y.min, f.y.max, 3);
  const tickStep = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const tickLabel = (v: number) => (Number.isInteger(tickStep) && Number.isInteger(v) ? formatUsdWhole(v) : formatUsdCents(v));
  const head = { x: clampPct(s.pctX(f.t)), y: clampPct(s.pctY(f.valueOf100)) };
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

  return (
    <BrandChartFrame
      illustration={illustrated}
      scale={f.zoom > 0 ? "real" : null}
      scaleOpacity={f.zoom}
      size={still ? "still" : "stage"}
      style={still ? STILL_STYLE : undefined}
      className={styles.chart}
    >
      <div className={styles.plot} data-part="mini-chart">
        {/* Y-axis gutter: tick labels live outside the plot so they never meet the chart's labels. */}
        <div className={styles.yaxis}>
          {ticks.map((v) => (
            <At key={v} y={s.pctY(v)}>
              <span className={`${styles.lbl} ${styles.tickLbl}`} style={{ color: CHART.axis }}>
                {tickLabel(v)}
              </span>
            </At>
          ))}
        </div>
        <div className={styles.area}>
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

          {/* Labels */}
          <At y={s.pctY(100)} opacity={1 - f.zoom}>
            <span className={`${styles.lbl} ${styles.above} ${styles.alignR}`} style={{ color: CHART.axis }}>
              {CHART_COPY.hundred}
            </span>
          </At>
          {/* The raise: beside the bar (right of the price head's last presale spot), top level with the fill's top, from $0; it fades as the bar divides. */}
          {f.beatIndex <= 1 && phase.grow < 0.25 ? (
            <At
              x={s.pctX(PRESALE_END)}
              y={s.pctY(Math.max(RAISED_MIN_Y, f.beatIndex === 0 ? (f.raisedUsd / m.raiseUsd) * COL.top : COL.top))}
              opacity={1 - ramp(phase.grow, 0, 0.25)}
            >
              <span className={`${styles.raised} tnum`} data-part="raised">
                <b>{CHART_COPY.raised(f.raisedUsd)}</b>
                <span className={styles.raisedOf}>{raisedOf(m)}</span>
              </span>
            </At>
          ) : null}
          {colGone < 1 ? <SplitLabels m={m} f={f} s={s} opacity={1 - colGone} /> : null}
          {/* At the split the settled slab is named with what it pays back, so the dark block beside the column reads as the floor. */}
          {f.floorNet100 !== null && floorOpacity > 0 && colGone < 1 ? (
            <At x={s.pctX(f.floorSteps[0]![0])} y={clampPct(s.pctY(f.floorSteps[0]![1]), 10, 100)} opacity={ramp(phase.reveal, 0.6, 1) * (1 - colGone)}>
              <span className={`${styles.lbl} ${styles.slabLbl} ${styles.above} tnum`} data-part="label-slab">
                {floorPaysLabel(f.floorNet100)}
              </span>
            </At>
          ) : null}
          {f.floor100 !== null && floorOpacity > 0 && colGone > 0 ? (
            <At x={s.pctX(f.floorSteps[0]![0])} y={clampPct(s.pctY(f.floorSteps[0]![1]), 10, 100)} opacity={floorOpacity * colGone}>
              <span className={`${styles.lbl} ${styles.above}`} style={{ color: CHART.floor }}>
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
              opacity={ramp(f.zoom, 0.6, 1)}
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
                <At x={s.pctX(f.dip.t)} y={clampPct(s.pctY(f.dip.value), 0, 86)}>
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
              {/* Midway between the arbitrage line's step before the redemption and the plot floor, ending at the event. */}
              <At x={s.pctX(holders.t)} y={(clampPct(s.pctY(holders.from * m.arbLineRatio)) + 100) / 2} opacity={ramp(f.beatProgress, 0.5, 0.65)}>
                <span className={`${styles.lbl} ${styles.lblStrong} ${styles.belowLeft}`} style={{ color: CHART.floor }} data-part="exits">
                  {CHART_COPY.fromExits(f.exitsPct)}
                </span>
              </At>
            </>
          ) : null}
          {own("pump") || own("selloff") ? (
            <At x={s.pctX(f.peak.t)} y={clampPct(s.pctY(f.peak.value), 14, 100)} opacity={showPeak ? 1 : 0}>
              <span className={`${styles.chipAt} ${BRAND_CLASS.pillRaised} tnum`} data-part="peak">
                {CHART_COPY.peak(f.peak.value)}
              </span>
            </At>
          ) : null}

          <Dot x={head.x} y={head.y} size={10} color={CHART.price} halo={alpha(CHART.price, 0.16)} opacity={f.priceOpacity} />
          {f.redeemProgress > 0 ? (
            <>
              <Dot x={head.x} y={redeemY} size={10} color={CHART.floor} halo={alpha(CHART.floor, 0.25)} />
              {/* Midway between the arbitrage line's last step and the plot floor: clear of every line. */}
              <At x={head.x} y={(arbEndY + 100) / 2} opacity={ramp(f.redeemProgress, 0.4, 1)}>
                <span className={`${styles.redeemChip} tnum`} data-part="redeem">
                  {CHART_COPY.redeem(redeemNet)}
                </span>
              </At>
            </>
          ) : null}
        </div>
      </div>
    </BrandChartFrame>
  );
}

/* ---------- the raise column (variants 1/3) ---------- */

/** The column's geometry for a frame: segment boxes in USD, the gap between them and the floor's top. */
function columnGeometry(m: LaunchMath, f: StoryFrame) {
  const segs = columnSegments(m);
  const { grow, reveal } = splitPhase(f);
  // Thin gaps open between the segments as the column divides (USD).
  const gap = 1.2 * easeInOut(ramp(grow, 0, 0.5));
  // The floor segment settles: its top drops from its share of the raise onto the floor per $100.
  const drop = easeInOut(ramp(reveal, 0, 0.7));
  const floorShareTop = segs[0]!.to * COL.top;
  // Once settled, its top sits exactly on the floor per $100 (the gap only parts it from the market).
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
    // Fees: creator and platform as one butter block, a hairline apart.
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
      <span
        className={styles.pt}
        style={{ width: size, height: size, background: color, boxShadow: halo ? `0 0 0 4px ${halo}` : undefined }}
      />
    </At>
  );
}
