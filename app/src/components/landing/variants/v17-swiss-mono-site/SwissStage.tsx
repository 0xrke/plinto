"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BrandChartFrame,
  CHART,
  CHART_COPY,
  DASH,
  LIGHT,
  alpha,
  STROKE,
  TILE_FLOOR,
  TILE_NOW,
  TILE_REDEEMED,
  beatCaption,
  formatUsdCents,
  formatUsdWhole,
  magnifiedLabel,
  railLabel,
  useActiveBeat,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  type StoryFrame,
} from "../shared";
import { INSET_H, swissChart, swissInset } from "./swissChart";
import s from "./swiss.module.css";

/*
 * Variant 17 stage pieces: the Swiss poster from v07 (index rail, two enormous counting figures,
 * one price line over the floor staircase, the caption set large) in the site's language. The figures
 * sit in the landing's cloud and floor-wash tiles, the chart is the midnight BrandChartFrame, the
 * rail is the landing's floor-green progress rail with the poster's 01–08 index.
 */

const VB = 1000;
/** The floor figure before the split has built a floor (no made-up number, no ghosted dash). */
export const FLOOR_PENDING = "Set at the split";
const pad2 = (i: number) => String(i + 1).padStart(2, "0");

/* ---------- Numbers ---------- */

/**
 * The two enormous tabular figures. They count with the scroll: your $100 follows the price line,
 * and the floor counts up from zero while the split builds it (then follows the real staircase).
 * At the redeem beat the floor tile gets a "Redeemed" pill.
 */
export function Numbers({ frame, compact = false }: { frame: StoryFrame; compact?: boolean }) {
  const redeemed = frame.redeemProgress >= 1 && frame.floorNet100 !== null;
  const floor = frame.floorNet100 === null ? null : frame.floorNet100 * frame.floorReveal;
  return (
    <div className={`${s.nums} ${compact ? s.numsCompact : ""}`} aria-hidden>
      <div className={`${s.num} tile-soft`}>
        <span className={s.numLabel}>{TILE_NOW}</span>
        <span className={`${s.numValue} tnum`} data-part="fig-now">
          {formatUsdCents(frame.valueOf100)}
        </span>
      </div>
      <div className={`${s.num} ${s.numFloor} tile-floor`}>
        <span className={s.numLabel}>
          {TILE_FLOOR}
          {redeemed ? <span className={`${s.stamp} pill pill-sm pill-floor`}>{TILE_REDEEMED}</span> : null}
        </span>
        {floor === null || floor <= 0 ? (
          <span className={s.numValue} data-part="fig-floor" data-empty="">
            <span className={s.numPending}>{FLOOR_PENDING}</span>
          </span>
        ) : (
          <span className={`${s.numValue} tnum`} data-part="fig-floor">
            {formatUsdCents(floor)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- Chart ---------- */

/** Ticks below this share of the plot (percent) would peek out from behind the split block. */
const SPLIT_TOP = 72;

/** Still card height: taller than the frame's 180px default so the ticks, chips and split fit. */
const STILL_H = 240;

const at = (x: number, y: number): CSSProperties => ({ left: `${x}%`, top: `${y}%` });

const lineStyle = (stroke: string, width: number, dash?: string): CSSProperties => ({
  stroke,
  strokeWidth: width,
  strokeDasharray: dash,
});

export function Chart({ m, frame, compact = false }: { m: LaunchMath; frame: StoryFrame; compact?: boolean }) {
  const g = swissChart(m, frame);
  const inset = swissInset(m, frame);
  // Every value path after the presale is made up (the presale price is fixed).
  const illustrated = frame.illustrative || (frame.beatIndex >= 2 && frame.priceOpacity > 0);
  const splitShown = frame.beatIndex <= 2;
  const splitFade = frame.beatIndex < 2 ? 1 : Math.max(0, 1 - frame.beatProgress * 5);
  const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;
  const sp = m.split;
  const segs = [
    { key: "floor", w: sp.floorUsd, label: CHART_COPY.floorShare(pct(sp.floorUsd)), color: CHART.floor },
    { key: "market", w: sp.poolUsd, label: CHART_COPY.market, color: CHART.market },
    { key: "fees", w: sp.creatorUsd + sp.platformUsd, label: CHART_COPY.fees(pct(sp.creatorUsd), pct(sp.platformUsd)), color: CHART.fees },
  ];
  // The presale band (and the raise filling it under the $100 line) gives way to the split.
  const bandOpacity = frame.beatIndex === 0 ? 1 : splitShown ? splitFade * (1 - 0.8 * frame.splitProgress) : 0;
  const total = segs.reduce((a, b) => a + b.w, 0) || 1;
  const gains = (
    <>
      {frame.feesPct !== null ? <span className={s.gain}>{CHART_COPY.fromFees(frame.feesPct)}</span> : null}
      {frame.exitsPct !== null ? <span className={s.gain}>{CHART_COPY.fromExits(frame.exitsPct)}</span> : null}
    </>
  );
  return (
    <BrandChartFrame
      size={compact ? "still" : "stage"}
      style={compact ? { height: STILL_H } : undefined}
      className={compact ? "" : s.chartCard}
      illustration={illustrated}
      scale={frame.zoom > 0.02 ? "real" : null}
      scaleOpacity={Math.min(1, frame.zoom * 2)}
      plotClassName={s.plotBox}
    >
      <div className={s.plot}>
        {g.ticks.filter((t) => !splitShown || splitFade <= 0 || t.y < SPLIT_TOP).map((t) => (
          <div key={t.v} className={s.tick} style={{ top: `${t.y}%` }}>
            <span className="tnum">{formatUsdWhole(t.v)}</span>
          </div>
        ))}
        <svg className={s.svg} viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none">
          {g.paidY !== null ? (
            <line className={s.line} x1={0} x2={VB} y1={(g.paidY / 100) * VB} y2={(g.paidY / 100) * VB} style={{ ...lineStyle(CHART.axis, STROKE.ref, DASH.ref), opacity: 0.5 }} />
          ) : null}
          {g.raiseD && bandOpacity > 0 ? (
            <>
              <path d={g.raiseBandD} style={{ fill: alpha(CHART.presale, 0.07), opacity: bandOpacity }} />
              <path d={g.raiseD} style={{ fill: alpha(CHART.presaleFill, 0.2), opacity: bandOpacity }} />
            </>
          ) : null}
          {g.floorAreaD ? <path d={g.floorAreaD} style={{ fill: CHART.floorSlab, opacity: frame.floorReveal }} /> : null}
          {g.arbStripD ? <path d={g.arbStripD} style={{ fill: CHART.arbStrip, opacity: frame.floorReveal }} /> : null}
          {g.arbD ? <path className={s.line} d={g.arbD} style={lineStyle(CHART.arb, STROKE.arb, DASH.arb)} /> : null}
          {g.floorD ? <path className={`${s.line} ${s.stair}`} d={g.floorD} style={{ ...lineStyle(CHART.floor, STROKE.floor), opacity: frame.floorReveal }} /> : null}
          <path className={`${s.line} ${s.price}`} d={g.priceD} style={{ ...lineStyle(CHART.price, STROKE.price), opacity: frame.priceOpacity }} />
        </svg>

        {g.paidY !== null ? (
          <span className={`${s.tag} ${s.paidTag}`} style={{ top: `${g.paidY}%` }}>
            {CHART_COPY.hundred}
          </span>
        ) : null}
        {g.peak ? (
          <span className={`${s.peakTag} pill pill-sm bg-tile text-white tnum`} style={at(g.peak.x, g.peak.y)}>
            {CHART_COPY.peak(frame.peak.value)}
          </span>
        ) : null}
        {g.arbStart ? (
          <span className={`${s.tag} ${s.arbTag}`} style={at(g.arbStart.x, g.arbStart.y)}>
            {CHART_COPY.arbLine}
          </span>
        ) : null}
        {g.dip ? (
          <>
            <span className={s.bounce} style={at(g.dip.x, g.dip.y)} data-part="bounce" />
            <span className={`${s.tag} ${s.dipTag}`} style={at(g.dip.x, g.dip.y)}>
              {CHART_COPY.bounce}
            </span>
          </>
        ) : null}
        {g.floorStart && frame.floorReveal > 0.5 ? (
          <span className={`${s.tag} ${s.floorTag}`} style={at(g.floorStart.x, g.floorStart.y)}>
            {CHART_COPY.floor}
          </span>
        ) : null}
        <span className={s.head} style={{ ...at(g.priceHead.x, g.priceHead.y), opacity: frame.priceOpacity }} />
        {g.floorHead && frame.floorReveal > 0 ? <span className={`${s.head} ${s.headFloor}`} style={at(g.floorHead.x, g.floorHead.y)} /> : null}

        {inset && inset.opacity > 0.01 ? (
          <div className={s.inset} style={{ height: `${INSET_H * 100}%`, opacity: inset.opacity }}>
            <svg className={s.svg} viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none">
              <path className={`${s.line} ${s.stair}`} d={inset.d} style={lineStyle(CHART.floor, 2)} />
            </svg>
            <span className={s.insetLabel}>{magnifiedLabel(inset.factor)}</span>
          </div>
        ) : null}

        {splitShown && splitFade > 0 ? (
          <div className={s.split} style={{ opacity: splitFade }}>
            <span className={s.splitRaised}>
              <span className={s.splitRaisedLabel}>Raised</span>
              <b className={`${s.splitRaisedValue} tnum`}>{formatUsdWhole(frame.raisedUsd)}</b>
            </span>
            <div className={s.splitBar}>
              {segs.map((seg, i) => (
                <span
                  key={seg.key}
                  className={s.splitSeg}
                  style={{
                    flexGrow: seg.w / total,
                    background: seg.color,
                    transform: `scaleX(${i === 0 ? frame.splitProgress : Math.max(0, frame.splitProgress * 1.6 - 0.6 * i)})`,
                  }}
                />
              ))}
            </div>
            <div className={s.splitLegend} style={{ opacity: frame.splitProgress }}>
              {segs.map((seg) => (
                <span key={seg.key} style={{ flexGrow: seg.w / total }}>
                  <i className={s.legendDot} style={{ background: seg.color }} />
                  {seg.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {frame.feesPct !== null || frame.exitsPct !== null ? <div className={s.gains}>{gains}</div> : null}
      </div>
    </BrandChartFrame>
  );
}

/* ---------- Live stage pieces (hooks) ---------- */

/** Numbers and chart for the current scroll frame (two grid children). */
export function LiveFrame() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return (
    <>
      <Numbers frame={frame} />
      <div className={s.chart}>
        <Chart m={m} frame={frame} />
      </div>
    </>
  );
}

/** The index rail: 8 numbered cells on the landing's progress track (--qN from the driver). */
export function Rail() {
  const { index } = useActiveBeat();
  const jump = useJumpToBeat();
  return (
    <nav className={s.rail} data-rail aria-label="Story steps">
      {BEAT_KEYS.map((key, i) => (
        <button
          key={key}
          type="button"
          className={s.railCell}
          data-state={i < index ? "past" : i === index ? "now" : "next"}
          aria-label={railLabel(i)}
          aria-current={i === index ? "step" : undefined}
          onClick={() => jump(i)}
          style={{ "--q": `var(--q${i}, 1)` } as CSSProperties}
        >
          <span className={s.railText}>
            <span className={`${s.railNum} tnum`}>{pad2(i)}</span>
            <span className={s.railName}>{BEAT_LABELS[key]}</span>
          </span>
          <span className={s.railTrack}>
            <span className={s.railFill} />
          </span>
        </button>
      ))}
    </nav>
  );
}

function KeyLine({ color, width, dash }: { color: string; width: number; dash?: string }) {
  return (
    <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden>
      <line x1="0" x2="24" y1="4" y2="4" style={{ stroke: color, strokeWidth: width, strokeDasharray: dash, strokeLinecap: dash ? "butt" : "round" }} />
    </svg>
  );
}

/** The chart key on the cloud panel: plain line swatches in the light-ground colours (ink, floor, risk-line). */
function Key() {
  return (
    <ul className={s.key}>
      <li>
        <span className={s.swatch}>
          <KeyLine color={LIGHT.price} width={STROKE.price} />
        </span>
        Your $100
      </li>
      <li className={s.keyFloor}>
        <span className={s.swatch}>
          <KeyLine color={LIGHT.floor} width={STROKE.floor} />
        </span>
        {CHART_COPY.floor}
      </li>
      <li>
        <span className={s.swatch}>
          <KeyLine color={LIGHT.arb} width={STROKE.arb + 0.5} dash={DASH.arb} />
        </span>
        {CHART_COPY.arbLine}
      </li>
    </ul>
  );
}

/** The active caption, set large; re-keyed on every beat so it fades in. */
export function Caption() {
  const m = useStoryLaunch();
  const { index, key } = useActiveBeat();
  return (
    <div className={s.cap} aria-hidden>
      <Key />
      <p key={key} className={s.capInner}>
        <span className={s.capIndex}>
          <span className="tnum">{pad2(index)}</span> · {BEAT_LABELS[key]}
        </span>
        <span className={s.capText}>{beatCaption(m, key)}</span>
      </p>
    </div>
  );
}
