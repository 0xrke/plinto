import { useId, type CSSProperties, type ReactNode } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, easeInOut, type StoryFrame } from "@/lib/landing/sim/story";
import { monotonePathD, niceTicks, ramp, stepPathD, type Pt, type Scales } from "@/components/landing/lab/storyChartGeometry";
import {
  BRAND_CLASS,
  BrandChartFrame,
  CHART,
  CHART_COPY,
  DASH,
  ILLUSTRATION,
  STROKE,
  alpha,
  formatUsdCents,
  formatUsdWhole,
  storyTradedUsd,
} from "../shared";
import { closeness, type Camera } from "./camera";
import styles from "./cinematic.module.css";

/*
 * One film frame, now the site's midnight chart card (BrandChartFrame): the chart in world
 * coordinates (x = story time × 1000, y = −USD × 100) seen through the camera's viewBox. As in
 * v03, the SVG sits in an inset "plot box" with overflow visible and preserveAspectRatio none, so the
 * lines run past the box to the card's rounded edges (the card clips them) while the camera's
 * rectangle maps onto the box; strokes are non-scaling. Labels are HTML, placed in percent of the
 * plot box. Colours come from CHART (var(--color-…) tokens). No glows, no pulse: a pure function of
 * (frame, camera), with no timers and no transitions on values.
 */

const SX = 1000;
const SY = 100;
const X = (t: number) => t * SX;
const Y = (v: number) => -v * SY;
const scales: Scales = { xOf: X, yOf: Y, pctX: () => 0, pctY: () => 0 };

const ns = { vectorEffect: "non-scaling-stroke" as const, fill: "none" };

const SPLIT = BEATS.find((b) => b.key === "split")!;
const PRESALE = BEATS[0]!;
/** The raise column in world units (story time, USD per $100). */
const COL = { x0: 0.3, x1: 0.7, top: 100 };
/** Far-off world edges for full-bleed lines. */
const FAR_T = [-40, 60] as const;
const FAR_V = [-5000, 50000] as const;

/** The floor-to-arbitrage band: rose, strong enough to read as rose on midnight without mint beneath it. */
const STRIP = alpha("var(--color-risk-on-dark)", 0.3);

const SEG_FILL = {
  market: CHART.market,
  creator: CHART.fees,
  platform: CHART.axis,
} as const;

export interface SceneProps {
  m: LaunchMath;
  frame: StoryFrame;
  cam: Camera;
  /** Reduced-motion still: the fixed 180px still card. */
  still?: boolean;
}

export function Scene({ m, frame: f, cam, still = false }: SceneProps) {
  const w = cam.x1 - cam.x0;
  const h = cam.y1 - cam.y0;
  const px = (t: number) => ((t - cam.x0) / w) * 100;
  const py = (v: number) => ((cam.y1 - v) / h) * 100;
  const close = closeness(cam);
  const at = (k: StoryFrame["beat"]) => f.beat === k;
  const bp = f.beatProgress;

  const ticks = niceTicks(cam.y0, cam.y1, still ? 3 : 4);
  const tickStep = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const tickLabel = (v: number) => (Number.isInteger(tickStep) && Number.isInteger(v) ? formatUsdWhole(v) : formatUsdCents(v));

  // Floor: revealed during the split, then a staircase (always from the engine's events).
  const steps = f.floorSteps as Pt[];
  const hasFloor = steps.length > 1;
  const floorOpacity = hasFloor ? (at("split") ? ramp(f.floorReveal, 0.5, 1) : f.floorReveal) : 0;
  const stepD = hasFloor ? stepPathD(steps, scales) : "";
  const lastT = hasFloor ? steps[steps.length - 1]![0] : 0;
  const slabD = hasFloor ? `${stepD} L${X(lastT)} ${Y(FAR_V[0])} L${X(steps[0]![0])} ${Y(FAR_V[0])} Z` : "";

  const arbOpacity = f.arbLine100 === null ? 0 : at("bounce") ? ramp(bp, 0, 0.2) : 1;
  const arbD = hasFloor && f.arbLine100 !== null ? stepPathD(steps, scales, m.arbLineRatio) : "";
  const stripD =
    hasFloor && f.arbLine100 !== null
      ? `${stepD} ${[...steps]
          .reverse()
          .map(([t, v]) => `L${X(t)} ${Y(v * m.arbLineRatio)}`)
          .join(" ")} Z`
      : "";

  const arbSlabD = arbD ? `${arbD} L${X(lastT)} ${Y(FAR_V[0])} L${X(steps[0]![0])} ${Y(FAR_V[0])} Z` : "";

  const harvests = f.events.filter((e) => e.kind === "harvest");
  const lastFee = harvests[harvests.length - 1];
  const holders = f.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const feesOpacity = f.feesPct === null || !lastFee ? 0 : at("steps") ? ramp(bp, 0.45, 0.9) : at("bounce") ? 1 - ramp(bp, 0, 0.25) : 0;
  const exitsOpacity =
    f.exitsPct === null || !holders ? 0 : at("exits") ? ramp(bp, 0.5, 0.65) : at("redeem") ? 1 - ramp(f.redeemProgress, 0, 0.4) : 0;
  const peakOpacity = f.t >= f.peak.t ? (at("pump") ? 1 : 1 - close) : 0;
  const bounceLabelOpacity = at("exits") ? 1 - ramp(bp, 0.25, 0.45) : at("redeem") ? 0 : 1;

  const redeemNet = f.floorNet100 ?? 0;
  const redeemDrop = f.redeemProgress > 0 ? easeInOut(f.redeemProgress) : 0;
  const redeemDotV = f.valueOf100 + (redeemNet - f.valueOf100) * redeemDrop;

  // Labels sit on the first tread that is wide enough on screen, so no riser runs through them.
  const labelT = hasFloor ? firstWideTread(steps, cam.x0 + 0.02 * w, cam.x1, 0.14 * w) : 0;
  const floorLabelX = hasFloor ? Math.max(px(labelT), 2) : 0;
  const arbLabelOpacity = arbOpacity * (at("redeem") ? 1 - ramp(f.redeemProgress, 0, 0.4) : 1);
  // Any made-up price path on screen carries the label (steps and redeem too, not only the engine's illustrative beats).
  const pathShown = f.priceOpacity > 0 && f.path.length > 1 && f.beatIndex >= 2;
  const pill =
    at("pump") || at("selloff") ? CHART_COPY.traded(storyTradedUsd(m)) : f.illustrative || pathShown ? ILLUSTRATION : undefined;
  // The price fades out above the frame, so off-shot spikes never run under the chips.
  const maskId = `v13-top-${useId().replace(/:/g, "")}`;
  const scaleOpacity = ramp(close, 0.05, 0.6);

  return (
    <BrandChartFrame
      size={still ? "still" : "stage"}
      inset="full"
      illustration={pill}
      scale={close > 0.05 ? "real" : null}
      scaleOpacity={scaleOpacity}
      className={still ? styles.sceneStill : styles.scene}
      plotClassName={styles.plot}
    >
      <svg className={styles.svg} viewBox={`${X(cam.x0)} ${Y(cam.y1)} ${w * SX} ${h * SY}`} preserveAspectRatio="none" overflow="visible">
        <defs>
          <linearGradient id={`${maskId}-g`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={Y(cam.y1 + 0.16 * h)} y2={Y(cam.y1 + 0.03 * h)}>
            <stop offset="0" style={{ stopColor: CHART.price }} stopOpacity={0} />
            <stop offset="1" style={{ stopColor: CHART.price }} stopOpacity={1} />
          </linearGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={X(FAR_T[0])} y={Y(FAR_V[1])} width={X(FAR_T[1] - FAR_T[0])} height={(FAR_V[1] - FAR_V[0]) * SY}>
            <rect x={X(FAR_T[0])} y={Y(FAR_V[1])} width={X(FAR_T[1] - FAR_T[0])} height={(FAR_V[1] - FAR_V[0]) * SY} fill={`url(#${maskId}-g)`} />
          </mask>
        </defs>

        {/* Beat boundaries: faint full-height rules, the film's "sets". */}
        {BEATS.slice(1)
          .filter((b, i, all) => all.findIndex((o) => o.start === b.start) === i)
          .map((b) => (
            <line
              key={b.key}
              x1={X(b.start)}
              x2={X(b.start)}
              y1={Y(FAR_V[1])}
              y2={Y(FAR_V[0])}
              {...ns}
              style={{ stroke: CHART.grid }}
              strokeWidth={STROKE.grid}
              strokeOpacity={0.6}
            />
          ))}
        {ticks.map((v) => (
          <line key={v} x1={X(FAR_T[0])} x2={X(FAR_T[1])} y1={Y(v)} y2={Y(v)} {...ns} style={{ stroke: CHART.grid }} strokeWidth={STROKE.grid} />
        ))}
        {/* What you paid. */}
        <line
          x1={X(FAR_T[0])}
          x2={X(FAR_T[1])}
          y1={Y(100)}
          y2={Y(100)}
          {...ns}
          style={{ stroke: CHART.axis }}
          strokeWidth={STROKE.ref}
          strokeDasharray={DASH.ref}
          strokeOpacity={0.5}
          opacity={1 - close}
        />

        {/* Presale: the raise fills the column up to your $100. */}
        {f.beatIndex <= 1 ? <RaiseColumn m={m} f={f} /> : null}

        {/* Mint slab under the floor; once the arbitrage line is in, the band between the two is rose only (no mint under it). */}
        {hasFloor ? <path d={slabD} style={{ fill: CHART.floorSlab }} opacity={floorOpacity * (stripD ? 1 - arbOpacity : 1)} data-part="floor-slab" /> : null}
        {arbSlabD ? <path d={arbSlabD} style={{ fill: CHART.floorSlab }} opacity={floorOpacity * arbOpacity} /> : null}
        {stripD ? <path d={stripD} style={{ fill: STRIP }} opacity={arbOpacity} data-part="arb-strip" /> : null}
        {arbD ? (
          <path d={arbD} {...ns} style={{ stroke: CHART.arb }} strokeWidth={STROKE.arb} strokeDasharray={DASH.arb} opacity={arbOpacity} data-part="arb-line" />
        ) : null}
        {feesOpacity > 0 && lastFee ? (
          <g opacity={feesOpacity}>
            <line
              x1={X(steps[0]![0])}
              x2={X(lastFee.t + 0.25)}
              y1={Y(m.floorPer100GrossUsd)}
              y2={Y(m.floorPer100GrossUsd)}
              {...ns}
              style={{ stroke: CHART.axis }}
              strokeWidth={STROKE.ref}
              strokeDasharray={DASH.guide}
              strokeOpacity={0.7}
            />
            <line
              x1={X(lastFee.t + 0.25)}
              x2={X(lastFee.t + 0.25)}
              y1={Y(m.floorPer100GrossUsd)}
              y2={Y(lastFee.to)}
              {...ns}
              style={{ stroke: CHART.floor }}
              strokeWidth={2}
            />
          </g>
        ) : null}
        {stepD ? (
          <path
            d={stepD}
            {...ns}
            style={{ stroke: CHART.floor }}
            strokeWidth={STROKE.floor}
            strokeLinejoin="miter"
            opacity={floorOpacity}
            data-part="floor-steps"
          />
        ) : null}

        <path
          d={monotonePathD(f.path, scales)}
          {...ns}
          style={{ stroke: CHART.price }}
          strokeWidth={STROKE.price}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={f.priceOpacity}
          mask={`url(#${maskId})`}
          data-part="price"
        />
      </svg>

      {/* ---------- labels (percent of the plot box) ---------- */}
      {ticks.map((v) => (
        <At key={v} x={100} y={py(v)}>
          <span className={styles.tickLabel}>{tickLabel(v)}</span>
        </At>
      ))}
      {f.beatIndex === 0 && f.raisedUsd >= 1 ? (
        <At x={px(PRESALE.end / 2)} y={py(COL.top)}>
          <span className={`${styles.label} ${styles.raised} tnum`}>{CHART_COPY.raised(f.raisedUsd)}</span>
        </At>
      ) : null}
      {at("split") ? <SplitLabels m={m} f={f} px={px} py={py} /> : null}
      {hasFloor && floorOpacity > 0 ? (
        <At x={floorLabelX} y={py(floorAtT(steps, labelT))} opacity={at("split") ? ramp(f.floorReveal, 0.75, 1) : floorOpacity}>
          <span className={`${styles.label} ${styles.floorLabel}`}>{CHART_COPY.floor}</span>
        </At>
      ) : null}
      {f.arbLine100 !== null && hasFloor ? (
        <>
          {/* Wide frames: by the head. Narrow frames: under the line on the left tread, clear of the dip. */}
          <At x={Math.max(px(f.t) - 1, 0)} y={py(f.arbLine100)} opacity={arbLabelOpacity}>
            <span className={`${styles.label} ${styles.arbLabel} ${styles.wideOnly}`}>{CHART_COPY.arbLine}</span>
          </At>
          <At x={floorLabelX} y={py(floorAtT(steps, labelT) * m.arbLineRatio)} opacity={arbLabelOpacity}>
            <span className={`${styles.label} ${styles.arbLabelLeft} ${styles.narrowOnly}`}>{CHART_COPY.arbLine}</span>
          </At>
        </>
      ) : null}
      {peakOpacity > 0 ? (
        <At x={px(f.peak.t)} y={py(f.peak.value)} opacity={peakOpacity}>
          <span className={`${BRAND_CLASS.pillRaised} ${styles.peak} tnum`}>{CHART_COPY.peak(f.peak.value)}</span>
        </At>
      ) : null}
      {close > 0 ? harvests.map((e) => <Dot key={e.t} x={px(e.t)} y={py(e.to)} className={styles.harvestDot} opacity={close} />) : null}
      {feesOpacity > 0 && lastFee && f.feesPct !== null ? (
        <At x={px(lastFee.t + 0.25)} y={py(m.floorPer100GrossUsd)} opacity={feesOpacity}>
          <span className={`${styles.label} ${styles.fees} tnum`}>{CHART_COPY.fromFees(f.feesPct)}</span>
        </At>
      ) : null}
      {f.dip ? (
        <>
          <Dot x={px(f.dip.t)} y={py(f.dip.value)} className={styles.bounceDot} part="bounce" />
          <At x={px(f.dip.t)} y={py(f.dip.value)} opacity={bounceLabelOpacity}>
            <span className={`${styles.label} ${styles.bounce}`}>{CHART_COPY.bounce}</span>
          </At>
        </>
      ) : null}
      {exitsOpacity > 0 && holders && f.exitsPct !== null ? (
        <>
          <Dot x={px(holders.t)} y={py(holders.to)} className={styles.harvestDot} opacity={exitsOpacity} />
          <At x={px(holders.t)} y={py(holders.to)} opacity={exitsOpacity}>
            <span className={`${styles.label} ${styles.exits} tnum`}>{CHART_COPY.fromExits(f.exitsPct)}</span>
          </At>
        </>
      ) : null}
      <Dot x={px(f.t)} y={py(f.valueOf100)} className={styles.head} opacity={f.priceOpacity} />
      {f.redeemProgress > 0 ? (
        <>
          <Dot x={px(f.t)} y={py(redeemDotV)} className={styles.redeemDot} />
          {/* The chip hangs off the redeem dot on a leader, below the arbitrage line. */}
          <At x={px(f.t)} y={py(redeemDotV)} opacity={ramp(f.redeemProgress, 0.4, 0.9)}>
            <span className={styles.redeemLeader} />
            <span className={`${styles.redeemChip} tnum`}>{CHART_COPY.redeem(redeemNet)}</span>
          </At>
        </>
      ) : null}
    </BrandChartFrame>
  );
}

/** A plot-box-sized, click-through layer translated to (x %, y %); the child sits at its top-left. */
function At({ x, y, opacity = 1, children }: { x: number; y: number; opacity?: number; children: ReactNode }) {
  if (!(opacity > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const style: CSSProperties = { transform: `translate(${x}%, ${y}%)`, opacity };
  return (
    <span className={styles.at} style={style}>
      {children}
    </span>
  );
}

function Dot({ x, y, className, opacity = 1, part }: { x: number; y: number; className: string; opacity?: number; part?: string }) {
  return (
    <At x={x} y={y} opacity={opacity}>
      <span className={`${styles.dot} ${className}`} data-part={part} />
    </At>
  );
}

/** Raise column (world units): fills during the presale; in the split it divides, and the floor slides into the slab. */
function RaiseColumn({ m, f }: { m: LaunchMath; f: StoryFrame }) {
  const fill = (f.raisedUsd / m.raiseUsd) * COL.top;
  if (f.beatIndex === 0) {
    return (
      <g>
        {/* The empty column is an outline on a faint sky track; the raise fills it in presale sky. */}
        <rect x={X(COL.x0)} y={Y(COL.top)} width={X(COL.x1 - COL.x0)} height={COL.top * SY} style={{ fill: alpha(CHART.presaleFill, 0.08) }} />
        <rect
          x={X(COL.x0)}
          y={Y(COL.top)}
          width={X(COL.x1 - COL.x0)}
          height={COL.top * SY}
          {...ns}
          style={{ stroke: alpha(CHART.presaleFill, 0.35) }}
          strokeWidth={1}
          strokeDasharray={DASH.guide}
        />
        <rect x={X(COL.x0)} y={Y(fill)} width={X(COL.x1 - COL.x0)} height={fill * SY} style={{ fill: alpha(CHART.presaleFill, 0.9) }} data-part="raise-fill" />
        {fill > 0 ? (
          <line x1={X(COL.x0)} x2={X(COL.x1)} y1={Y(fill)} y2={Y(fill)} {...ns} style={{ stroke: CHART.presaleFill }} strokeWidth={2} />
        ) : null}
      </g>
    );
  }
  const segs = columnSegments(m);
  const grow = f.splitProgress;
  const reveal = f.floorReveal;
  const rest = 1 - ramp(reveal, 0.4, 1);
  const floorSeg = segs[0]!;
  // The floor segment morphs into the slab: first its top drops to the floor, then it stretches to the head.
  const drop = easeInOut(ramp(reveal, 0, 0.55));
  const stretch = easeInOut(ramp(reveal, 0.35, 1));
  const top = floorSeg.to * COL.top + (m.floorPer100GrossUsd - floorSeg.to * COL.top) * drop;
  const fx0 = COL.x0 + (SPLIT.start - COL.x0) * stretch;
  const fx1 = COL.x1 + (f.t - COL.x1) * stretch;
  const gap = 1.2 * easeInOut(ramp(grow, 0, 0.5));
  const floorTop = top - gap * (1 - drop);
  return (
    <g>
      <rect
        x={X(fx0)}
        y={Y(floorTop)}
        width={X(Math.max(0, fx1 - fx0))}
        height={Math.max(0, floorTop) * SY}
        style={{ fill: CHART.floor }}
        opacity={1 - ramp(reveal, 0.7, 1)}
      />
      {segs.slice(1).map((s) => {
        // The column divides: thin gaps open between the segments.
        const lo = s.from * COL.top + gap;
        const hi = s.to * COL.top - gap;
        return (
          <rect
            key={s.key}
            x={X(COL.x0)}
            y={Y(hi)}
            width={X(COL.x1 - COL.x0)}
            height={Math.max(0, (hi - lo) * SY)}
            style={{ fill: SEG_FILL[s.key as keyof typeof SEG_FILL] }}
            opacity={rest}
          />
        );
      })}
    </g>
  );
}

function SplitLabels({ m, f, px, py }: { m: LaunchMath; f: StoryFrame; px: (t: number) => number; py: (v: number) => number }) {
  const segs = columnSegments(m);
  const rest = 1 - ramp(f.floorReveal, 0.4, 1);
  const x = px(COL.x1);
  const items = [
    {
      key: "floor",
      text: CHART_COPY.floorShare(Math.round(m.v * 100)),
      mid: (segs[0]!.from + segs[0]!.to) / 2,
      cls: styles.floorLabel,
      o: ramp(f.splitProgress, 0.05, 0.3) * (1 - ramp(f.floorReveal, 0.45, 0.75)),
    },
    {
      key: "market",
      text: CHART_COPY.market,
      mid: (segs[1]!.from + segs[1]!.to) / 2,
      cls: styles.marketLabel,
      o: ramp(f.splitProgress, 0.3, 0.55) * rest,
    },
    {
      key: "fees",
      text: CHART_COPY.fees(Math.round((m.split.creatorUsd / m.raiseUsd) * 1000) / 10, Math.round((m.split.platformUsd / m.raiseUsd) * 1000) / 10),
      mid: (segs[2]!.from + segs[3]!.to) / 2,
      cls: styles.feesLabel,
      o: ramp(f.splitProgress, 0.6, 0.9) * rest,
    },
  ];
  return (
    <>
      {items.map((l) => (
        <At
          key={l.key}
          x={x}
          y={py(l.key === "floor" ? l.mid * COL.top + (m.floorPer100GrossUsd - l.mid * COL.top) * f.floorReveal : l.mid * COL.top)}
          opacity={l.o}
        >
          <span className={`${styles.label} ${styles.side} ${l.cls} tnum`}>{l.text}</span>
        </At>
      ))}
    </>
  );
}

/** Start (story time) of the first tread visible over [from, to] for at least minW; else `from`. */
function firstWideTread(steps: ReadonlyArray<Pt>, from: number, to: number, minW: number): number {
  for (let i = 0; i < steps.length - 1; i++) {
    const a = Math.max(steps[i]![0], from);
    const b = Math.min(steps[i + 1]![0], to);
    if (steps[i + 1]![0] > steps[i]![0] && b - a >= minW) return a;
  }
  return Math.max(steps[0]![0], from);
}

/** The staircase's value at story time t (right-continuous: a riser at t counts as climbed). */
function floorAtT(steps: ReadonlyArray<Pt>, t: number): number {
  let v = steps[0]![1];
  for (const [st, sv] of steps) {
    if (st > t) break;
    v = sv;
  }
  return v;
}

/** Column segments as cumulative shares of the raise, bottom to top. */
function columnSegments(m: LaunchMath): Array<{
  key: "floor" | "market" | "creator" | "platform";
  from: number;
  to: number;
}> {
  const parts: Array<["floor" | "market" | "creator" | "platform", number]> = [
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
