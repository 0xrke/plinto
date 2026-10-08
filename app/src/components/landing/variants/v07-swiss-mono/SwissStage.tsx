"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  CHART_COPY,
  ILLUSTRATION,
  magnifiedLabel,
  REAL_SCALE_LABEL,
  TILE_FLOOR,
  TILE_NOW,
  TILE_REDEEMED,
  beatCaption,
  formatUsdCents,
  formatUsdWhole,
  railLabel,
  useActiveBeat,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  type StoryFrame,
} from "../shared";
import { INSET_H, swissChart, swissInset } from "./swissChart";
import s from "./swiss.module.css";

const VB = 1000;
const pad2 = (i: number) => String(i + 1).padStart(2, "0");

/* ---------- Numbers ---------- */

/** A figure with the "$" set apart, so tight tracking never lets it touch the first digit. */
function Figure({ text }: { text: string }) {
  return text.startsWith("$") ? (
    <>
      <span className={s.dollar}>$</span>
      {text.slice(1)}
    </>
  ) : (
    <>{text}</>
  );
}

/**
 * The two enormous tabular figures. They count with the scroll: your $100 follows the price line,
 * and the floor counts up from zero while the split builds it (then follows the real staircase).
 * At the redeem beat the left figure keeps its key and the floor figure gets a "Redeemed" stamp.
 */
export function Numbers({ frame, compact = false }: { frame: StoryFrame; compact?: boolean }) {
  const redeemed = frame.redeemProgress >= 1 && frame.floorNet100 !== null;
  const floor = frame.floorNet100 === null ? null : frame.floorNet100 * frame.floorReveal;
  return (
    <div className={`${s.nums} ${compact ? s.numsCompact : ""}`} aria-hidden>
      <div className={s.num}>
        <span className={s.numLabel}>{TILE_NOW}</span>
        <span className={s.numValue}>
          <Figure text={formatUsdCents(frame.valueOf100)} />
        </span>
      </div>
      <div className={`${s.num} ${s.numAccent}`}>
        <span className={s.numLabel}>
          {TILE_FLOOR}
          {redeemed ? <span className={s.stamp}>{TILE_REDEEMED}</span> : null}
        </span>
        {floor === null || floor <= 0 ? (
          <span className={`${s.numValue} ${s.numEmpty}`}>
            <Figure text="$—" />
          </span>
        ) : (
          <span className={s.numValue}>
            <Figure text={formatUsdCents(floor)} />
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- Chart ---------- */

const at = (x: number, y: number): CSSProperties => ({ left: `${x}%`, top: `${y}%` });

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
    { key: "floor", w: sp.floorUsd, label: CHART_COPY.floorShare(pct(sp.floorUsd)), accent: true },
    { key: "market", w: sp.poolUsd, label: CHART_COPY.market, accent: false },
    { key: "fees", w: sp.creatorUsd + sp.platformUsd, label: CHART_COPY.fees(pct(sp.creatorUsd), pct(sp.platformUsd)), accent: false },
  ];
  const total = segs.reduce((a, b) => a + b.w, 0) || 1;
  return (
    <div className={`${s.chart} ${compact ? s.chartCompact : ""}`} aria-hidden>
      <div className={s.plot}>
        {g.ticks.map((t) => (
          <div key={t.v} className={s.tick} style={{ top: `${t.y}%` }}>
            <span>{formatUsdWhole(t.v)}</span>
          </div>
        ))}
        <svg className={s.svg} viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none">
          {g.paidY !== null ? <line className={s.paid} x1={0} x2={VB} y1={(g.paidY / 100) * VB} y2={(g.paidY / 100) * VB} /> : null}
          {g.floorAreaD ? <path className={s.floorArea} d={g.floorAreaD} style={{ opacity: frame.floorReveal }} /> : null}
          {g.arbD ? <path className={s.arb} d={g.arbD} /> : null}
          {g.floorD ? <path className={s.floor} d={g.floorD} style={{ opacity: frame.floorReveal }} /> : null}
          <path className={s.price} d={g.priceD} style={{ opacity: frame.priceOpacity }} />
        </svg>

        {g.paidY !== null ? (
          <span className={`${s.tag} ${s.paidTag}`} style={{ top: `${g.paidY}%` }}>
            {CHART_COPY.hundred}
          </span>
        ) : null}
        {g.peak ? (
          <span className={`${s.tag} ${s.peakTag}`} style={at(g.peak.x, g.peak.y)}>
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
            <span className={s.ring} style={at(g.dip.x, g.dip.y)} />
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
        {g.floorHead && frame.floorReveal > 0 ? <span className={`${s.head} ${s.headAccent}`} style={at(g.floorHead.x, g.floorHead.y)} /> : null}

        {inset && inset.opacity > 0.01 ? (
          <div className={s.inset} style={{ height: `${INSET_H * 100}%`, opacity: inset.opacity }}>
            <svg className={s.svg} viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none">
              <path className={s.floor} d={inset.d} />
            </svg>
            <span className={s.insetLabel}>{magnifiedLabel(inset.factor)}</span>
          </div>
        ) : null}

        {splitShown && splitFade > 0 ? (
          <div className={s.split} style={{ opacity: splitFade }}>
            <span className={s.splitRaised}>{CHART_COPY.raised(frame.raisedUsd)}</span>
            <div className={s.splitBar}>
              {segs.map((seg, i) => (
                <span
                  key={seg.key}
                  className={`${s.splitSeg} ${seg.accent ? s.splitSegAccent : ""}`}
                  style={{ flexGrow: seg.w / total, transform: `scaleX(${i === 0 ? frame.splitProgress : Math.max(0, frame.splitProgress * 1.6 - 0.6 * i)})` }}
                />
              ))}
            </div>
            <div className={s.splitLegend} style={{ opacity: frame.splitProgress }}>
              {segs.map((seg) => (
                <span key={seg.key} className={seg.accent ? s.accentText : ""} style={{ flexGrow: seg.w / total }}>
                  {seg.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className={s.meta}>
        <span className={s.metaLeft}>
          {illustrated ? <span className={s.illus}>{ILLUSTRATION}</span> : null}
          {frame.zoom > 0.02 ? <span className={s.scale}>{REAL_SCALE_LABEL}</span> : null}
        </span>
        <span className={s.metaRight}>
          {frame.feesPct !== null ? <span className={s.accentText}>{CHART_COPY.fromFees(frame.feesPct)}</span> : null}
          {frame.exitsPct !== null ? <span className={s.accentText}>{CHART_COPY.fromExits(frame.exitsPct)}</span> : null}
        </span>
      </div>
    </div>
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
      <Chart m={m} frame={frame} />
    </>
  );
}

/** The index rail: 8 columns, a progress rule each (--qN from the driver), click to jump. */
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
          <span className={s.railNum}>{pad2(i)}</span>
          <span className={s.railName}>{BEAT_LABELS[key]}</span>
          <span className={s.railBar} />
        </button>
      ))}
    </nav>
  );
}

/** The active caption, set large; re-keyed on every beat so it slides in. */
export function Caption() {
  const m = useStoryLaunch();
  const { index, key } = useActiveBeat();
  return (
    <div className={s.cap} aria-hidden>
      <ul className={s.key}>
        <li>
          <span className={s.keyPrice} />
          Your $100
        </li>
        <li className={s.accentText}>
          <span className={s.keyFloor} />
          {CHART_COPY.floor}
        </li>
        <li>
          <span className={s.keyArb} />
          {CHART_COPY.arbLine}
        </li>
      </ul>
      <p key={key} className={s.capInner}>
        <span className={s.capIndex}>
          {pad2(index)} — {BEAT_LABELS[key]}
        </span>
        <span className={s.capText}>{beatCaption(m, key)}</span>
      </p>
    </div>
  );
}
