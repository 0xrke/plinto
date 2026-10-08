"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { floor100At } from "@/lib/landing/sim/floorPath";
import { STORY_T_END } from "@/lib/landing/sim/story";
import { BEAT_START } from "@/lib/landing/sim/timeline";
import {
  BRAND_CLASS,
  BrandChartFrame,
  CHART,
  CHART_COPY,
  DASH,
  STROKE,
  TILE_NOW,
  formatUsdCents,
  formatUsdWhole,
  magnifiedLabel,
  tileValues,
  type StoryFrame,
} from "../shared";
import type { Ledger } from "./ledger";
import styles from "./cause.module.css";

/*
 * The price chart on the site's midnight chart card (BrandChartFrame), with the "Your $100 now" tile
 * (under the card on wide screens, beside "Floor pays back" on phones and in the stills). The SVG is stretched to the plot box (non-scaling strokes) and every
 * label, chip and dot is HTML positioned in percent, so text stays crisp at any size and the wires
 * can measure the chips. The floor is the engine's staircase (frame.floorSteps) at the frame's own y
 * camera: real scale. While the camera is wide (pump, selloff) the staircase is a flat line at that
 * scale, so a lens shows it close up with an explicit magnification label.
 */

const V = 1000;
/** Lens size as a share of the plot box. The magnification label is computed from it. */
const INSET_W = 0.44;
const INSET_H = 0.3;
/**
 * Arbitrage label: on wide screens to the right of the dashes' end (nothing is drawn there yet) while
 * the end is left of this x (percent); otherwise, and always on phones, under the dashes' left start,
 * where the price never goes at the close-up camera.
 */
const ARB_LABEL_END_MAX_X = 84;

type Pt = [number, number];

const nss = { vectorEffect: "non-scaling-stroke" } as const;

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const insetDomain = new WeakMap<LaunchMath, { min: number; max: number }>();

/** Fixed y band of the lens: the listing floor to the floor at the end of the steps beat, padded. */
function lensBand(m: LaunchMath): { min: number; max: number } {
  let d = insetDomain.get(m);
  if (!d) {
    const lo = m.floorPer100GrossUsd;
    const hi = floor100At(m, BEAT_START.bounce);
    const pad = Math.max(hi - lo, lo * 0.002) * 0.18;
    d = { min: lo - pad, max: hi + pad };
    insetDomain.set(m, d);
  }
  return d;
}

function Chips({ ledger, x, y }: { ledger: Ledger; x: (t: number) => number; y: (v: number) => number }) {
  const latest = ledger.latest;
  return (
    <>
      {ledger.entries.map((e) => (
        <span
          key={e.n}
          data-chip={e.n}
          data-kind={e.kind}
          data-hot={latest?.n === e.n ? "" : undefined}
          className={`${styles.chip} tnum`}
          style={{
            left: `${x(e.t)}%`,
            top: `${Math.min(100, Math.max(0, y(e.floor100)))}%`,
            opacity: e.kind === "split" ? ledger.split : 1,
          }}
        >
          {e.n}
        </span>
      ))}
    </>
  );
}

function Lens({ m, frame, ledger, mainSpan, opacity }: { m: LaunchMath; frame: StoryFrame; ledger: Ledger; mainSpan: number; opacity: number }) {
  const steps = frame.floorSteps;
  const band = lensBand(m);
  const t0 = steps[0]![0];
  const t1 = Math.max(steps[steps.length - 1]![0], t0 + 1e-6);
  const xPct = (t: number) => 4 + ((t - t0) / (t1 - t0)) * 92;
  const yPct = (v: number) => (1 - (v - band.min) / (band.max - band.min)) * 100;
  const pts = (a: Pt[]) => a.map(([t, v]) => `${((xPct(t) * V) / 100).toFixed(2)},${((yPct(v) * V) / 100).toFixed(2)}`).join(" ");
  const factor = (mainSpan / (band.max - band.min)) * INSET_H;
  // The values read like the ledger's total: what the floor pays back per $100, after the exit fee.
  const net = frame.floorNet100 !== null && frame.floor100 ? frame.floorNet100 / frame.floor100 : 1;
  const first = steps[0]![1];
  const last = steps[steps.length - 1]![1];
  return (
    <div className={styles.lens} style={{ width: `${INSET_W * 100}%`, height: `${INSET_H * 100}%`, opacity } as CSSProperties}>
      <span className={`${styles.lensLabel} ${BRAND_CLASS.pillOnDark}`}>{magnifiedLabel(factor)}</span>
      <svg className={styles.svg} viewBox={`0 0 ${V} ${V}`} preserveAspectRatio="none" aria-hidden>
        <polygon
          points={`${pts(steps)} ${((xPct(t1) * V) / 100).toFixed(2)},${V} ${((xPct(t0) * V) / 100).toFixed(2)},${V}`}
          style={{ fill: CHART.floorSlab }}
        />
        <polyline points={pts(steps)} style={{ fill: "none", stroke: CHART.floor, strokeWidth: STROKE.floor, strokeLinejoin: "miter", ...nss }} />
      </svg>
      <span className={`${styles.lensValue} tnum`} style={{ left: `${xPct(t0)}%`, top: `${yPct(first)}%` }} data-at="start">
        {formatUsdCents(first * net)}
      </span>
      {last - first > 1e-6 ? (
        <span className={`${styles.lensValue} tnum`} style={{ left: `${xPct(t1)}%`, top: `${yPct(last)}%` }} data-at="end">
          {formatUsdCents(last * net)}
        </span>
      ) : null}
      <Chips ledger={ledger} x={xPct} y={yPct} />
    </div>
  );
}

export function Chart({ m, frame, ledger, still = false }: { m: LaunchMath; frame: StoryFrame; ledger: Ledger; still?: boolean }) {
  const { min, max } = frame.y;
  const span = max - min || 1;
  const yPct = (v: number) => (1 - (v - min) / span) * 100;
  const xPct = (t: number) => (t / STORY_T_END) * 100;
  const sx = (t: number) => (xPct(t) * V) / 100;
  const sy = (v: number) => (yPct(v) * V) / 100;
  const pts = (a: Pt[]) => a.map(([t, v]) => `${sx(t).toFixed(2)},${sy(v).toFixed(2)}`).join(" ");

  const { now } = tileValues(frame);
  const steps = frame.floorSteps;
  const head = frame.path[frame.path.length - 1]!;
  const stepEnd = steps.length > 0 ? steps[steps.length - 1]! : null;
  const ticks = niceTicks(min, max, 4);
  const closeUp = frame.zoom >= 0.5;
  const showHundred = 100 >= min && 100 <= max && !closeUp;
  const showPeak = frame.t >= frame.peak.t && frame.zoom < 0.35;
  // The lens takes over the chips while the camera is wide; it fades out as the camera zooms in.
  const lens = !closeUp && frame.beatIndex >= 2 && steps.length > 1;
  const lensOpacity = lens ? Math.min(1, Math.max(0, (0.5 - frame.zoom) / 0.25)) : 0;
  // Every price move after the split is made up (the engine flags only some beats).
  const illustrative = frame.illustrative || (frame.beatIndex >= 2 && frame.priceOpacity > 0);
  // The arbitrage line follows the whole staircase: arbLineRatio × floor at every step.
  const arbRatio = frame.arbLine100 !== null && frame.floor100 ? frame.arbLine100 / frame.floor100 : null;
  const arbSteps: Pt[] = arbRatio !== null ? steps.map(([t, v]) => [t, v * arbRatio]) : [];
  const arbEnd = arbSteps.length > 0 ? arbSteps[arbSteps.length - 1]! : null;
  const arbEndFits = arbEnd !== null && xPct(arbEnd[0]) < ARB_LABEL_END_MAX_X;
  const floorBase = stepEnd ? `${sx(stepEnd[0]).toFixed(2)},${V} ${sx(steps[0]![0]).toFixed(2)},${V}` : "";
  // The rose strip between the arbitrage line and the floor: the zone where buy-and-redeem pays.
  const arbStrip = arbSteps.length > 1 ? `${pts(steps)} ${pts([...arbSteps].reverse())}` : "";

  return (
    <div className={styles.chartCol}>
      <BrandChartFrame
        size={still ? "still" : "stage"}
        illustration={illustrative} scale={closeUp ? "real" : null} className={styles.chartCard} plotClassName={styles.plotBox}>
        <div className={styles.plotWrap}>
          <div className={styles.ticks} aria-hidden>
            {ticks.map((v) => (
              <span key={v} className={`${styles.tick} tnum`} style={{ top: `${yPct(v)}%` }}>
                {formatUsdWhole(v)}
              </span>
            ))}
          </div>
          <div className={styles.plot} aria-hidden>
            <svg className={styles.svg} viewBox={`0 0 ${V} ${V}`} preserveAspectRatio="none">
              {ticks.map((v) => (
                <line key={v} x1={0} x2={V} y1={sy(v)} y2={sy(v)} style={{ stroke: CHART.grid, strokeWidth: STROKE.grid, ...nss }} />
              ))}
              {showHundred ? (
                <line
                  x1={0}
                  x2={V}
                  y1={sy(100)}
                  y2={sy(100)}
                  style={{ stroke: CHART.axis, strokeWidth: STROKE.ref, strokeDasharray: DASH.ref, opacity: 0.5, ...nss }}
                />
              ) : null}
              {steps.length > 1 ? (
                <g opacity={frame.floorReveal}>
                  <polygon points={`${pts(steps)} ${floorBase}`} style={{ fill: CHART.floorSlab }} />
                  {arbStrip ? <polygon points={arbStrip} style={{ fill: CHART.arbStrip }} /> : null}
                  <polyline points={pts(steps)} style={{ fill: "none", stroke: CHART.floor, strokeWidth: STROKE.floor, strokeLinejoin: "miter", ...nss }} />
                </g>
              ) : null}
              {arbSteps.length > 1 ? (
                <polyline
                  points={pts(arbSteps)}
                  style={{ fill: "none", stroke: CHART.arb, strokeWidth: STROKE.arb, strokeDasharray: DASH.arb, strokeLinejoin: "miter", ...nss }}
                />
              ) : null}
              <polyline
                points={pts(frame.path)}
                opacity={frame.priceOpacity}
                style={{ fill: "none", stroke: CHART.price, strokeWidth: STROKE.price, strokeLinejoin: "round", strokeLinecap: "round", ...nss }}
              />
            </svg>

            {showHundred ? (
              <span className={styles.hundredLabel} style={{ top: `${yPct(100)}%` }}>
                {CHART_COPY.hundred}
              </span>
            ) : null}
            {showPeak ? (
              <span
                className={`${styles.peakLabel} ${BRAND_CLASS.pillRaised}`}
                style={{ left: `${xPct(frame.peak.t)}%`, top: `${yPct(frame.peak.value)}%` }}
              >
                {CHART_COPY.peak(frame.peak.value)}
              </span>
            ) : null}
            {arbEnd !== null && arbSteps.length > 1 ? (
              <>
                {arbEndFits ? (
                  <span className={styles.arbLabel} data-at="end" style={{ left: `${xPct(arbEnd[0])}%`, top: `${yPct(arbEnd[1])}%` }}>
                    {CHART_COPY.arbLine}
                  </span>
                ) : null}
                <span
                  className={styles.arbLabel}
                  data-at="start"
                  data-alt={arbEndFits ? "" : undefined}
                  style={{ left: `${xPct(arbSteps[0]![0])}%`, top: `${yPct(arbSteps[0]![1])}%` }}
                >
                  {CHART_COPY.arbLine}
                </span>
              </>
            ) : null}
            {stepEnd && frame.floorReveal > 0.5 ? (
              <span className={styles.floorLabel} style={{ left: `${xPct(steps[0]![0])}%`, top: `${yPct(steps[0]![1])}%` }}>
                {CHART_COPY.floor}
              </span>
            ) : null}

            {lens ? null : <Chips ledger={ledger} x={xPct} y={yPct} />}

            {frame.dip ? (
              <span className={styles.bounce} style={{ left: `${xPct(frame.dip.t)}%`, top: `${yPct(frame.dip.value)}%` }}>
                <span className={styles.bounceDot} />
                <span className={styles.bounceLabel}>{CHART_COPY.bounce}</span>
              </span>
            ) : null}

            <span
              className={styles.dot}
              style={{
                left: `${xPct(head[0])}%`,
                top: `${Math.min(100, Math.max(0, yPct(head[1])))}%`,
                opacity: frame.priceOpacity,
              }}
            />

            {lens ? <Lens m={m} frame={frame} ledger={ledger} mainSpan={span} opacity={lensOpacity} /> : null}
          </div>
        </div>
      </BrandChartFrame>
      <p className={styles.nowTile} aria-hidden>
        <span>{TILE_NOW}</span>
        <b data-part="tile-now" className="tnum">
          {now}
        </b>
      </p>
    </div>
  );
}
