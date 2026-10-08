import type { CSSProperties, ReactNode } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, BEAT_KEYS, STORY_T_END, type BeatKey, type StoryFrame } from "@/lib/landing/sim/story";
import { T_GRAD } from "@/lib/landing/sim/timeline";
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
import styles from "./cardStack.module.css";

/*
 * The card's mini chart, in the site's midnight chart card (BrandChartFrame): white price, mint floor
 * staircase over a mint-at-14% slab, rose dashed arbitrage line, rose bounce dot with a white halo.
 * A pure function of the frame (no timers, no transitions on values), drawn at the engine's own
 * camera (frame.y), so the close-up is real scale and its chip says so. The SVG is a unit box
 * stretched over the plot with non-scaling strokes; labels are HTML placed in percent. Colours are
 * CHART tokens only.
 */

const PRESALE_END = BEATS[0]!.end;
/** Story time shown after the card's own beat (room for the head and its label). */
const X_PAD = 0.6;

/**
 * The chart frames the story so far: x from 0 (or from graduation once the camera has zoomed in,
 * where nothing before it is in range) to a little past the price head. A pure function of the frame
 * alone (not of the card), so two cards showing the same story pos (mid-slide: the outgoing card at
 * its end, the incoming one at its start) draw the identical chart at the identical scale.
 */
export function cardScales(f: StoryFrame): Scales {
  const x0 = T_GRAD * f.zoom;
  const x1 = Math.min(STORY_T_END + 0.2, Math.max(f.t, PRESALE_END) + X_PAD);
  const xs = x1 - x0;
  const span = f.y.max - f.y.min || 1;
  return {
    xOf: (t) => ((t - x0) / xs) * VB,
    yOf: (v) => VB * (1 - (v - f.y.min) / span),
    pctX: (t) => ((t - x0) / xs) * 100,
    pctY: (v) => (1 - (v - f.y.min) / span) * 100,
  };
}

const ns = { vectorEffect: "non-scaling-stroke" as const, fill: "none" };

export function MiniChart({ m, frame: f, card, still = false }: { m: LaunchMath; frame: StoryFrame; card: BeatKey; still?: boolean }) {
  const s = cardScales(f);
  const floorOpacity = f.floorSteps.length ? f.floorReveal : 0;
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
  const own = (k: BeatKey) => card === k;
  // Every path drawn past the presale is made up, including its faded hold during redeem.
  const illustrated = BEAT_KEYS.indexOf(f.beat) >= 2 && f.priceOpacity > 0;
  const raiseShare = Math.min(1, f.raisedUsd / m.raiseUsd);
  const arbEndY = f.floor100 !== null ? clampPct(s.pctY(m.arbLineRatio * f.floor100)) : 50;
  const showPeak = (own("pump") || own("selloff")) && f.t >= f.peak.t;

  return (
    <BrandChartFrame
      illustration={illustrated}
      scale={f.zoom > 0 ? "real" : null}
      scaleOpacity={f.zoom}
      size={still ? "still" : "stage"}
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
              {/* The presale band, and the raise filling it bottom to top (the landing story's look). */}
              <rect x={s.xOf(0)} y={0} width={s.xOf(PRESALE_END) - s.xOf(0)} height={VB} style={{ fill: alpha(CHART.presale, 0.07) }} />
              <rect
                x={s.xOf(0)}
                y={VB * (1 - raiseShare)}
                width={s.xOf(PRESALE_END) - s.xOf(0)}
                height={VB * raiseShare}
                style={{ fill: alpha(CHART.presaleFill, 0.2) }}
                data-part="raise"
              />
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
          {own("presale") ? (
            <span className={`${styles.lbl} ${styles.lblStrong} ${styles.raised} tnum`} style={{ color: CHART.price }}>
              {CHART_COPY.raised(f.raisedUsd)}
            </span>
          ) : null}
          {f.floor100 !== null && floorOpacity > 0 ? (
            <At x={s.pctX(f.floorSteps[0]![0])} y={clampPct(s.pctY(f.floorSteps[0]![1]), 10, 100)} opacity={floorOpacity}>
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
