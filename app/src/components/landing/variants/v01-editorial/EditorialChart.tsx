import { useEffect, useId, useRef, useState, type JSX } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, easeInOut, STORY_T_END } from "@/lib/landing/sim/story";
import { monotonePathD, niceTicks, ramp, stepPathD, type Scales } from "@/components/landing/lab/storyChartGeometry";
import {
  BEAT_LABELS,
  CHART_COPY,
  ILLUSTRATION,
  REAL_SCALE_LABEL,
  TILE_FLOOR,
  TILE_NOW,
  floorSharePct,
  formatUsdCents,
  formatUsdWhole,
  tileValues,
  type StoryFrame,
} from "../shared";
import styles from "./editorial.module.css";

/*
 * Variant 1, "Editorial": a newspaper-graphics chart drawn in real pixels (measured with a
 * ResizeObserver), so hairlines stay 1px and annotations sit exactly on the data. Pure function of
 * the frame: no timers and no CSS transitions on values. Everything is direct-labelled with leader
 * lines; the only strong colour is the floor's green.
 */

const PAD = { l: 0, r: 42, t: 12, b: 30 };
const SPLIT = BEATS.find((b) => b.key === "split")!;
/** Raise column in the split beat: centre and width in story time; height in chart dollars (y 0..120). */
const COL_T = SPLIT.start + 0.38 * (SPLIT.end - SPLIT.start);
const COL_W = 0.34;
const COL_TOP = 84;
const FS = 12;
/** Rough text width for flip decisions (no layout reads on scroll). */
const textW = (s: string, fs = FS) => s.length * fs * 0.58;

function useSize(initial: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (w: number, h: number) =>
      setSize((p) => (Math.round(w) === p.w && Math.round(h) === p.h ? p : { w: Math.round(w), h: Math.round(h) }));
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) set(r.width, r.height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e && e.contentRect.width > 0 && e.contentRect.height > 0) set(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

interface NoteProps {
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  text: string;
  anchor: "start" | "end" | "middle";
  opacity: number;
  tone?: "ink" | "floor" | "arb" | "muted";
  strong?: boolean;
}

/** A direct label with an elbow leader line from the anchor (ax, ay) to the text. */
function Note({ ax, ay, tx, ty, text, anchor, opacity, tone = "ink", strong = false }: NoteProps) {
  if (opacity <= 0.001) return null;
  const sign = ty >= ay ? 1 : -1;
  const leader =
    anchor === "middle"
      ? Math.abs(ty - ay) > 12
        ? `M${ax} ${ay + sign * 3} V${ty - sign * 9}`
        : ""
      : `M${ax} ${ay} V${ty} H${anchor === "start" ? tx - 5 : tx + 5}`;
  return (
    <g opacity={opacity} data-part="note">
      {leader ? <path d={leader} className={styles.leader} /> : null}
      <text x={tx} y={ty} dy="0.35em" textAnchor={anchor} className={`${styles.note} ${styles[`tone_${tone}`]} ${strong ? styles.noteStrong : ""}`}>
        {text}
      </text>
    </g>
  );
}

/** The made-up trading path is drawn from the pump on (and stays drawn, faded, through redeem). */
export const showsMadeUpPath = (f: StoryFrame): boolean => f.illustrative || (f.beatIndex >= 2 && f.priceOpacity > 0);

export interface EditorialChartProps {
  m: LaunchMath;
  frame: StoryFrame;
  /** Reduced-motion still: fixed height, smaller figures. */
  still?: boolean;
}

export function EditorialChart({ m, frame: f, still = false }: EditorialChartProps): JSX.Element {
  const { now, floor } = tileValues(f);
  return (
    <div className={`${styles.chart} ${still ? styles.chartStill : ""}`} aria-hidden data-chart={still ? "still" : "stage"}>
      <div className={styles.figures}>
        <div className={styles.fig}>
          <span className={styles.figLabel}>
            <svg width="18" height="10" className={styles.key}><path d="M1 7 C5 7 7 2 11 3 S15 4 17 2" className={styles.keyInk} /></svg>
            {TILE_NOW}
          </span>
          <span className={`${styles.figValue} tnum`} data-part="now">
            {now}
          </span>
        </div>
        <div className={styles.fig}>
          <span className={styles.figLabel}>
            <svg width="18" height="10" className={styles.key}><path d="M1 8 H7 V5 H12 V2 H17" className={styles.keyFloor} /></svg>
            {TILE_FLOOR}
          </span>
          <span className={`${styles.figValue} ${styles.figFloor} tnum`} data-part="floor">
            {floor}
          </span>
        </div>
      </div>
      <div className={styles.meta}>
        <span className={styles.unit}>US$</span>
        {showsMadeUpPath(f) ? (
          <span className={styles.illus} data-part="illustration">
            {ILLUSTRATION}
          </span>
        ) : null}
        <span className={styles.scale} style={{ opacity: ramp(f.zoom, 0.3, 1) }} data-part="scale">
          {f.zoom > 0 ? REAL_SCALE_LABEL : ""}
        </span>
      </div>
      <Plot m={m} f={f} still={still} />
    </div>
  );
}

function Plot({ m, f, still }: { m: LaunchMath; f: StoryFrame; still: boolean }) {
  const { ref, size } = useSize(still ? { w: 560, h: 220 } : { w: 720, h: 460 });
  const clip = useId().replace(/:/g, "");
  const { w, h } = size;
  const L = PAD.l;
  const R = w - PAD.r;
  const T = PAD.t;
  const B = h - PAD.b;
  const pw = Math.max(1, R - L);
  const ph = Math.max(1, B - T);
  const span = f.y.max - f.y.min || 1;
  const X = (t: number) => L + (t / STORY_T_END) * pw;
  const Y = (v: number) => T + (1 - (v - f.y.min) / span) * ph;
  const s: Scales = { xOf: X, yOf: Y, pctX: (t) => (t / STORY_T_END) * 100, pctY: (v) => (1 - (v - f.y.min) / span) * 100 };
  const cy = (y: number, lo = T + 8, hi = B - 8) => Math.min(hi, Math.max(lo, y));
  const wide = w >= 560;

  const bp = f.beatProgress;
  const at = (k: StoryFrame["beat"]) => f.beat === k;
  const calm = 1 - f.zoom;

  // Grid: round ticks inside the camera; a firm baseline only while the axis starts at zero.
  const ticks = niceTicks(f.y.min, f.y.max, 4);
  const tickStep = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const tickLabel = (v: number) => (Number.isInteger(tickStep) && Number.isInteger(v) ? formatUsdWhole(v) : formatUsdCents(v));

  // Floor.
  const f0 = m.floorPer100GrossUsd;
  const hasFloor = f.floorSteps.length > 1;
  const floorOpacity = hasFloor ? (at("split") ? ramp(f.floorReveal, 0.5, 1) : f.floorReveal) : 0;
  const stepD = hasFloor ? stepPathD(f.floorSteps, s) : "";
  const areaD = hasFloor ? `${stepD} L${X(f.floorSteps[f.floorSteps.length - 1]![0]).toFixed(2)} ${B} L${X(f.floorSteps[0]![0]).toFixed(2)} ${B} Z` : "";

  // Arbitrage line (bounce on).
  const arbOpacity = f.arbLine100 === null ? 0 : at("bounce") ? ramp(bp, 0, 0.25) : 1;
  const arbD = f.arbLine100 !== null && hasFloor ? stepPathD(f.floorSteps, s, m.arbLineRatio) : "";

  const harvests = f.events.filter((e) => e.kind === "harvest");
  const holders = f.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const lastFee = harvests[harvests.length - 1];
  const firstFee = harvests[0];
  const feesOpacity = f.feesPct === null || !lastFee ? 0 : at("steps") ? ramp(bp, 0.45, 0.9) : at("bounce") ? 1 - ramp(bp, 0, 0.2) : 0;
  const exitsOpacity = !holders || f.exitsPct === null ? 0 : at("exits") ? ramp(bp, 0.5, 0.65) : at("redeem") ? 1 - ramp(f.redeemProgress, 0, 0.3) : 0;
  const bounceNoteOpacity = at("bounce") ? 1 : at("exits") ? 1 - ramp(bp, 0.2, 0.4) : 0;

  // Head (your $100) and the redeem drop onto the net floor.
  const headX = X(f.t);
  const headY = cy(Y(f.valueOf100), T, B);
  const redeemNet = f.floorNet100 ?? 0;
  const redeemY = Y(f.valueOf100 + (redeemNet - f.valueOf100) * easeInOut(f.redeemProgress));

  // Active beat: a pale column behind the data (the zero-span steps beat has none).
  const active = BEATS.find((b) => b.key === f.beat && b.end > b.start);

  // Notes that may flip side to stay inside the plot.
  const startOrEnd = (ax: number, text: string, gap = 12) =>
    ax + gap + textW(text) <= R - 2 ? { tx: ax + gap, anchor: "start" as const } : { tx: ax - gap, anchor: "end" as const };

  const raiseShare = Math.min(1, Math.max(0, f.raisedUsd / m.raiseUsd));
  const raiseBarOpacity = (at("presale") ? 1 : at("split") ? 1 - ramp(bp, 0, 0.35) : 0) * calm;

  const peakText = CHART_COPY.peak(f.peak.value).replace(" ↑", "");
  const peakOpacity = f.t >= f.peak.t - 1e-6 ? (at("pump") ? ramp(bp, 0.9, 1) : 1) * (1 - ramp(f.zoom, 0, 0.4)) : 0;
  const peakPos = { x: X(f.peak.t), y: Y(f.peak.value) };

  const meetText = "Meets the floor";
  const meetOpacity = at("selloff") ? ramp(bp, 0.8, 0.98) : at("steps") ? 1 - ramp(f.zoom, 0, 0.35) : 0;
  const meetPos = { x: X(BEATS.find((b) => b.key === "selloff")!.end), y: Y(f.floor100 ?? m.floorPer100GrossUsd) };

  const paidOpacity = calm;

  // Close-ups: the earlier price runs off the top. Fade it out and mark where it comes back in.
  const offScale = f.zoom > 0 ? offScaleEntry(f.path, f.y.max) : null;

  return (
    <div ref={ref} className={styles.plot} data-part="plot">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={styles.svg}>
        <defs>
          <clipPath id={clip}>
            <rect x={L} y={T - 6} width={pw + 6} height={ph + 6} />
          </clipPath>
          <linearGradient id={`${clip}-fade`} gradientUnits="userSpaceOnUse" x1={0} y1={T - 6} x2={0} y2={T + 72}>
            <stop offset="0" stopColor="#fff" stopOpacity={0} />
            <stop offset="1" stopColor="#fff" stopOpacity={1} />
          </linearGradient>
          <mask id={`${clip}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
            <rect x={0} y={0} width={w} height={h} fill={`url(#${clip}-fade)`} />
          </mask>
        </defs>

        {/* Active beat column. */}
        {active ? <rect x={X(active.start)} y={T - 6} width={Math.max(0, X(active.end) - X(active.start))} height={ph + 6} className={styles.activeCol} /> : null}

        {/* Presale: the raise as its own progress bar (0..100% of the raise), never on the $ axis. */}
        {raiseBarOpacity > 0.001 ? (
          <RaiseBar x={L + 8} y={T + 16} w={Math.min(pw * 0.62, 300)} share={raiseShare} raised={f.raisedUsd} goal={m.raiseUsd} opacity={raiseBarOpacity} />
        ) : null}

        {/* Grid. */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} className={styles.grid} />
            <text x={R + 8} y={Y(v)} dy="0.35em" className={`${styles.tick} tnum`} data-part="tick">
              {tickLabel(v)}
            </text>
          </g>
        ))}
        <line x1={L} x2={R} y1={B} y2={B} className={f.y.min === 0 ? styles.baseline : styles.grid} />
        {f.y.min === 0 ? (
          <text x={R + 8} y={B} dy="0.35em" className={`${styles.tick} tnum`}>
            0
          </text>
        ) : null}

        {/* What you paid. */}
        {paidOpacity > 0.01 && Y(100) > T ? (
          <g opacity={paidOpacity}>
            <line x1={L} x2={R} y1={Y(100)} y2={Y(100)} className={styles.paid} />
            <text x={R - 2} y={Y(100) - 8} textAnchor="end" className={`${styles.note} ${styles.tone_muted}`}>
              You paid $100
            </text>
          </g>
        ) : null}

        <g clipPath={`url(#${clip})`}>
          {at("split") ? <SplitColumn m={m} f={f} X={X} Y={Y} /> : null}

          {hasFloor ? (
            <>
              <path d={areaD} className={styles.floorWash} opacity={f.floorReveal} data-part="floor-wash" />
              {arbD ? <path d={arbD} className={styles.arb} opacity={arbOpacity} data-part="arb-line" /> : null}
              {feesOpacity > 0 && lastFee ? (
                <g opacity={feesOpacity} data-part="fees">
                  <line x1={X(1)} x2={X(lastFee.t + 0.3)} y1={Y(f0)} y2={Y(f0)} className={styles.ref} />
                  <path
                    d={`M${X(lastFee.t + 0.3) - 4} ${Y(f0)} H${X(lastFee.t + 0.3)} V${Y(lastFee.to)} H${X(lastFee.t + 0.3) - 4}`}
                    className={styles.bracket}
                  />
                </g>
              ) : null}
              <path d={stepD} className={styles.floor} opacity={floorOpacity} data-part="floor-steps" data-vertices={f.floorSteps.length} />
              {f.zoom > 0
                ? harvests.map((e) => <circle key={e.t} cx={X(e.t)} cy={Y(e.to)} r={2.6} className={styles.floorDot} opacity={f.zoom} data-part="harvest" />)
                : null}
            </>
          ) : null}

          <path
            d={monotonePathD(f.path, s)}
            className={styles.price}
            opacity={f.priceOpacity}
            mask={offScale ? `url(#${clip}-mask)` : undefined}
            data-part="price"
          />
        </g>

        {/* ---------- Direct labels ---------- */}
        {hasFloor && floorOpacity > 0 ? (
          <text x={X(f.floorSteps[0]![0]) + 4} y={cy(Y(f.floorSteps[0]![1]) - 10)} className={`${styles.note} ${styles.tone_floor} ${styles.noteStrong}`} opacity={floorOpacity}>
            {CHART_COPY.floor}
          </text>
        ) : null}

        {at("split") ? <SplitNotes m={m} f={f} X={X} Y={Y} /> : null}

        <Note ax={peakPos.x} ay={peakPos.y} {...startOrEnd(peakPos.x, peakText)} ty={cy(peakPos.y - 22)} text={peakText} opacity={peakOpacity} strong />

        <Note ax={meetPos.x} ay={meetPos.y} tx={meetPos.x - 14} ty={cy(meetPos.y + 18, T + 8, B - 7)} anchor="end" text={meetText} opacity={meetOpacity} />

        {feesOpacity > 0 && lastFee && f.feesPct !== null ? (
          <>
            <text
              x={X(lastFee.t + 0.3) + 8}
              y={(Y(f0) + Y(lastFee.to)) / 2}
              dy="0.35em"
              className={`${styles.note} ${styles.tone_floor} ${styles.noteStrong}`}
              opacity={feesOpacity}
              data-part="fees-label"
            >
              {CHART_COPY.fromFees(f.feesPct)}
            </text>
            {firstFee ? (
              <Note
                ax={X(firstFee.t)}
                ay={(Y(firstFee.from) + Y(firstFee.to)) / 2}
                tx={X(firstFee.t) + 14}
                ty={cy(Y(f0) + 30)}
                text="Each step: a fee harvest"
                anchor="start"
                opacity={feesOpacity}
                tone="floor"
              />
            ) : null}
          </>
        ) : null}

        {arbD ? (
          <text
            x={X(f.floorSteps[0]![0]) + 4}
            y={cy(Y(f.floorSteps[0]![1] * m.arbLineRatio) + 14)}
            className={`${styles.note} ${styles.tone_arb} ${styles.noteStrong}`}
            opacity={at("bounce") ? ramp(bp, 0.15, 0.35) : 1}
            data-part="arb-label"
          >
            {CHART_COPY.arbLine}
          </text>
        ) : null}

        {f.dip ? (
          <>
            <circle cx={X(f.dip.t)} cy={Y(f.dip.value)} r={5} className={styles.dip} data-part="bounce" />
            <Note ax={X(f.dip.t)} ay={Y(f.dip.value)} tx={X(f.dip.t)} ty={cy(Y(f.dip.value) + 30)} text={CHART_COPY.bounce} anchor="middle" opacity={bounceNoteOpacity} tone="arb" strong />
          </>
        ) : null}

        {exitsOpacity > 0 && holders && f.exitsPct !== null ? (
          <>
            <circle cx={X(holders.t)} cy={Y(holders.to)} r={3} className={styles.floorDot} opacity={exitsOpacity} data-part="exits" />
            <Note
              ax={X(holders.t)}
              ay={(Y(holders.from) + Y(holders.to)) / 2}
              tx={X(holders.t) - 10}
              ty={cy(Y(Math.min(holders.from * m.arbLineRatio, f.dip?.value ?? Infinity)) + 24)}
              text={CHART_COPY.fromExits(f.exitsPct)}
              anchor="end"
              opacity={exitsOpacity}
              tone="floor"
              strong
            />
          </>
        ) : null}

        {/* Head: your $100 now. */}
        <circle cx={headX} cy={headY} r={4.5} className={styles.head} opacity={f.priceOpacity} data-part="head" />

        {f.redeemProgress > 0 ? (
          <>
            <circle cx={headX} cy={cy(redeemY, T, B)} r={5.5} className={styles.redeemDot} data-part="redeem-dot" />
            {/* Paper behind the label so the faded price does not run through it. */}
            <rect
              x={headX - 16 - textW(CHART_COPY.redeem(redeemNet), 13)}
              y={cy(redeemY, T, B) - 9}
              width={textW(CHART_COPY.redeem(redeemNet), 13) + 10}
              height={18}
              className={styles.labelBack}
              opacity={ramp(f.redeemProgress, 0.5, 1)}
            />
            <text
              x={headX - 12}
              y={cy(redeemY, T, B)}
              dy="0.35em"
              textAnchor="end"
              className={`${styles.note} ${styles.tone_floor} ${styles.noteStrong} ${styles.noteHalo}`}
              opacity={ramp(f.redeemProgress, 0.5, 1)}
              data-part="redeem-label"
            >
              {CHART_COPY.redeem(redeemNet)}
            </text>
          </>
        ) : null}

        {offScale !== null ? (
          <g opacity={ramp(f.zoom, 0.4, 1)} data-part="off-scale">
            <text x={X(offScale) - 6} y={T + 2} dy="0.35em" textAnchor="end" className={`${styles.note} ${styles.tone_muted}`}>
              ↑ off scale
            </text>
          </g>
        ) : null}

        {/* x axis: the beats, the active one in ink. */}
        <XAxis f={f} X={X} B={B} wide={wide} />
      </svg>
    </div>
  );
}

/** Story time where the price last comes back into view from above the camera, or null. */
function offScaleEntry(path: StoryFrame["path"], top: number): number | null {
  for (let i = path.length - 2; i >= 0; i--) {
    const [t0, v0] = path[i]!;
    const [t1, v1] = path[i + 1]!;
    if (v0 > top && v1 <= top) return t0 + ((v0 - top) / (v0 - v1 || 1)) * (t1 - t0);
  }
  return null;
}

/** The presale raise on its own 0..100% scale, so its height never reads as a price. */
function RaiseBar({ x, y, w, share, raised, goal, opacity }: { x: number; y: number; w: number; share: number; raised: number; goal: number; opacity: number }) {
  return (
    <g opacity={opacity} data-part="raise-bar">
      <text x={x} y={y - 10} className={`${styles.note} ${styles.noteStrong} ${styles.tone_ink}`}>
        {CHART_COPY.raised(raised)}
        <tspan className={styles.tone_muted} fontWeight={500}>{` of ${formatUsdWhole(goal)}`}</tspan>
      </text>
      <rect x={x} y={y} width={w} height={8} className={styles.raiseTrack} />
      <rect x={x} y={y} width={w * share} height={8} className={styles.raiseFill} data-part="raise-fill" />
      <text x={x} y={y + 22} className={`${styles.tick} tnum`}>
        0%
      </text>
      <text x={x + w} y={y + 22} textAnchor="end" className={`${styles.tick} tnum`}>
        100% of the raise
      </text>
    </g>
  );
}

/** Beats along the x axis. Wide: names (active in ink). Narrow: numbers that match the captions' kickers. */
function XAxis({ f, X, B, wide }: { f: StoryFrame; X: (t: number) => number; B: number; wide: boolean }) {
  const ticks = BEATS.filter((b) => b.end > b.start).slice(1);
  return (
    <g data-part="x-axis">
      {ticks.map((b) => (
        <line key={b.key} x1={X(b.start)} x2={X(b.start)} y1={B} y2={B + 5} className={styles.xTick} />
      ))}
      {BEATS.map((b, i) => {
        const isActive = b.key === f.beat;
        const zero = b.end <= b.start;
        const x = zero ? X(b.start) : (X(b.start) + X(b.end)) / 2;
        const label = wide ? BEAT_LABELS[b.key] : String(i + 1);
        return (
          <text
            key={b.key}
            x={x}
            y={B + 19}
            textAnchor="middle"
            className={`${styles.xLabel} ${isActive ? styles.xActive : ""} tnum`}
            data-part="x-label"
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

/** Column segments as cumulative shares of the raise, bottom to top. */
function columnSegments(m: LaunchMath) {
  const parts: Array<[string, number]> = [
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

type Axis = { m: LaunchMath; f: StoryFrame; X: (t: number) => number; Y: (v: number) => number };

/** Split beat: the raise as one stacked column; its floor share then settles into the floor. */
function SplitColumn({ m, f, X, Y }: Axis) {
  const segs = columnSegments(m);
  const grow = f.splitProgress;
  const reveal = f.floorReveal;
  const rest = 1 - ramp(reveal, 0.4, 1);
  const x0 = X(COL_T - COL_W / 2);
  const x1 = X(COL_T + COL_W / 2);
  const fx0 = x0 + (X(f.floorSteps[0]?.[0] ?? COL_T) - x0) * reveal;
  const fx1 = x1 + (X(f.t) - x1) * reveal;
  const floorTop = (segs[0]!.to * COL_TOP + (m.floorPer100GrossUsd - segs[0]!.to * COL_TOP) * reveal) * Math.min(1, grow / 0.3 || 0);
  return (
    <g data-part="split-column">
      <rect x={fx0} y={Y(floorTop)} width={Math.max(0, fx1 - fx0)} height={Math.max(0, Y(0) - Y(floorTop))} className={styles.segFloor} opacity={1 - reveal} />
      {segs.slice(1).map((seg, i) => {
        const g = ramp(grow, 0.25 + 0.25 * i, 0.5 + 0.25 * i);
        const lo = seg.from * COL_TOP;
        const hi = lo + (seg.to - seg.from) * COL_TOP * g;
        return (
          <rect key={seg.key} x={x0} y={Y(hi)} width={x1 - x0} height={Math.max(0, Y(lo) - Y(hi))} className={styles[`seg_${seg.key}`]} opacity={rest} />
        );
      })}
    </g>
  );
}

function SplitNotes({ m, f, X, Y }: Axis) {
  const segs = columnSegments(m);
  const rest = 1 - ramp(f.floorReveal, 0.4, 1);
  const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 100);
  const ax = X(COL_T + COL_W / 2);
  const tx = ax + 26;
  const mid = (a: number, b: number) => Y(((a + b) / 2) * COL_TOP);
  return (
    <g data-part="split-notes">
      <Note
        ax={ax}
        ay={mid(segs[0]!.from, segs[0]!.to)}
        tx={tx}
        ty={mid(segs[0]!.from, segs[0]!.to)}
        text={CHART_COPY.floorShare(floorSharePct(m))}
        anchor="start"
        tone="floor"
        strong
        opacity={ramp(f.splitProgress, 0.1, 0.35) * (1 - ramp(f.floorReveal, 0, 0.5))}
      />
      <Note
        ax={ax}
        ay={mid(segs[1]!.from, segs[1]!.to)}
        tx={tx}
        ty={mid(segs[1]!.from, segs[1]!.to)}
        text={`${CHART_COPY.market} ${pct(m.split.poolUsd)}%`}
        anchor="start"
        opacity={ramp(f.splitProgress, 0.4, 0.6) * rest}
      />
      <Note
        ax={ax}
        ay={mid(segs[2]!.from, segs[3]!.to)}
        tx={tx}
        ty={mid(segs[2]!.from, segs[3]!.to) - 14}
        text={`Fees ${CHART_COPY.fees(pct(m.split.creatorUsd), pct(m.split.platformUsd))}`}
        anchor="start"
        tone="muted"
        opacity={ramp(f.splitProgress, 0.7, 0.95) * rest}
      />
    </g>
  );
}
