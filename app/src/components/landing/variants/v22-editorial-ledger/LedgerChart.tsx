import { useEffect, useId, useRef, useState, type JSX } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, BOUNCE_ARB_KNOT, BOUNCE_DIP_KNOT, bounceWaypoints, easeInOut, STORY_T_END, storyValueAt } from "@/lib/landing/sim/story";
import { along, range } from "@/lib/landing/sim/timeline";
import { monotonePathD, niceTicks, ramp, stepPathD, stripBetweenD, type Scales } from "@/components/landing/lab/storyChartGeometry";
import { BEAT_LABELS, BrandChartFrame, CHART_COPY, formatUsdCents, formatUsdWhole, type StoryFrame } from "../shared";
import type { Ledger, LedgerEntry } from "./vaultLedger";
import styles from "./editorialLedger.module.css";

/*
 * Variant 22, "Editorial ledger": variant 11's editorial chart (direct labels with leader lines, the
 * active-beat column, beats along the x axis) on the midnight chart card, with two changes from the
 * founder's review. The split is variant 3's bold vertical column on the chart's own dollar axis:
 * floor at the bottom (mint), market above it (iris), fees on top (butter), each labelled directly
 * and large; the floor share then drops to the floor's value and stretches into the floor slab the
 * staircase starts from. And every vault-ledger entry (the split, each fee harvest, each redemption)
 * is a numbered chip on the floor step it made, the same number as its row in the ledger sidebar
 * (variant 18), so the chart and the ledger read as one picture without connector wires.
 * Drawn in real pixels (ResizeObserver) so hairlines stay 1px and labels sit on the data. A pure
 * function of the frame: no timers and no transitions on values. Every colour is a site token.
 */

const PAD = { l: 0, r: 46, t: 10, b: 28 };
const PRESALE = BEATS[0]!;
/** The raise column: your $100 in dollars on the chart's y axis, left edge at this story time. */
const COL_T0 = 0.14;
const COL_TOP = 100;
const FS = 12;
/** Rough text width for flip decisions (no layout reads on scroll). */
const textW = (s: string, fs = FS) => s.length * fs * 0.6;

const BOUNCE = BEATS.find((b) => b.key === "bounce")!;

/**
 * Display only, for the made-up bounce (as in variant 11): the engine's illustrative dip knot sits a
 * little under the arbitrage line, so drawn as-is the price reads as passing through the line. Here
 * the dip knot is drawn exactly on the line and the arbitrage knot halfway up to the sell-stop knot,
 * so the price comes down onto the dashed line and turns up. Same eased knots, same times; only the
 * bounce's knots 1..4 change, and the result never goes under the line. A pure function of (m, t, v).
 */
export function landedValue(m: LaunchMath, t: number, v: number): number {
  const knots = bounceWaypoints(m);
  const span = BOUNCE.end - BOUNCE.start;
  const n = knots.length - 1;
  const t0 = BOUNCE.start + (span * (BOUNCE_DIP_KNOT - 1)) / n;
  const t1 = BOUNCE.start + (span * (BOUNCE_ARB_KNOT + 1)) / n;
  if (!(span > 0) || t <= t0 || t >= t1) return v;
  const arb = m.arbLineRatio;
  const next = knots[BOUNCE_ARB_KNOT + 1]!;
  if (!(knots[BOUNCE_DIP_KNOT]! < arb && next > arb)) return v;
  const landed = knots.map((k, i) => (i === BOUNCE_DIP_KNOT ? arb : i === BOUNCE_ARB_KNOT ? (arb + next) / 2 : k));
  return storyValueAt(m, BOUNCE.start) * along(landed, range(t, BOUNCE.start, BOUNCE.end));
}

/** Beat label centres along the x axis, nudged apart so neighbours never touch (zero-span beats sit on a boundary). */
export function spreadLabels(xs: readonly number[], ws: readonly number[], lo: number, hi: number, gap = 12): number[] {
  const out = [...xs];
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]! + ws[i - 1]! / 2 + gap + ws[i]! / 2);
  const last = out.length - 1;
  if (last >= 0) out[last] = Math.min(out[last]!, hi - ws[last]! / 2);
  for (let i = last - 1; i >= 0; i--) out[i] = Math.min(out[i]!, out[i + 1]! - ws[i + 1]! / 2 - gap - ws[i]! / 2);
  if (last >= 0) out[0] = Math.max(out[0]!, lo + ws[0]! / 2);
  return out;
}

/** The headline value of "Your $100 now" as the chart draws it (differs from the engine only inside the bounce's dip). */
export function shownValue(m: LaunchMath, f: StoryFrame): number {
  return landedValue(m, f.t, f.valueOf100);
}

/**
 * Chip opacity for a ledger entry on the chart. Close-up (from the steps beat on): every entry, so
 * the numbered steps line up with the numbered ledger rows. Wide camera (split, pump, selloff): the
 * staircase is a flat line at that scale, so only the newest entry is marked, never a pile of chips.
 */
export function chipOpacity(f: StoryFrame, ledger: Ledger, e: LedgerEntry): number {
  if (f.beatIndex === 0) return 0;
  const close = ramp(f.zoom, 0.55, 0.9);
  const isLatest = ledger.latest?.n === e.n;
  if (!isLatest) return close;
  return Math.max(close, e.kind === "split" ? ramp(f.floorReveal, 0.8, 1) : 1);
}

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

type Tone = "ink" | "floor" | "arb" | "muted";

interface NoteProps {
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  text: string;
  anchor: "start" | "end" | "middle";
  opacity: number;
  tone?: Tone;
  strong?: boolean;
}

/** A direct label with an elbow leader line from the anchor (ax, ay) to the text. */
function Note({ ax, ay, tx, ty, text, anchor, opacity, tone = "ink", strong = false }: NoteProps) {
  if (opacity <= 0.001) return null;
  const sign = ty >= ay ? 1 : -1;
  const leader =
    anchor === "middle"
      ? Math.abs(ty - ay) > 14
        ? `M${ax} ${ay + sign * 7} V${ty - sign * 9}`
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

export interface LedgerChartProps {
  m: LaunchMath;
  frame: StoryFrame;
  ledger: Ledger;
  /** Reduced-motion still: a fixed-height card. */
  still?: boolean;
  /** The active step (the heading's beat), so the x axis never names a different beat than the heading; defaults to the frame's. */
  activeBeat?: number;
}

export function LedgerChart({ m, frame: f, ledger, still = false, activeBeat }: LedgerChartProps): JSX.Element {
  return (
    <BrandChartFrame
      className={still ? "" : styles.chartCard}
      size={still ? "still" : "stage"}
      illustration={showsMadeUpPath(f)}
      scale={f.zoom > 0 ? "real" : null}
      scaleOpacity={ramp(f.zoom, 0.3, 1)}
    >
      <Plot m={m} f={f} ledger={ledger} still={still} activeBeat={activeBeat ?? f.beatIndex} />
    </BrandChartFrame>
  );
}

function Plot({ m, f, ledger, still, activeBeat }: { m: LaunchMath; f: StoryFrame; ledger: Ledger; still: boolean; activeBeat: number }) {
  const { ref, size } = useSize(still ? { w: 520, h: 120 } : { w: 640, h: 420 });
  const clip = useId().replace(/:/g, "");
  const { w, h } = size;
  const compact = h < 200;
  const L = PAD.l;
  const R = w - PAD.r;
  const T = PAD.t;
  const B = h - (compact ? 18 : PAD.b);
  const pw = Math.max(1, R - L);
  const ph = Math.max(1, B - T);
  const span = f.y.max - f.y.min || 1;
  const X = (t: number) => L + (t / STORY_T_END) * pw;
  const Y = (v: number) => T + (1 - (v - f.y.min) / span) * ph;
  const s: Scales = { xOf: X, yOf: Y, pctX: (t) => (t / STORY_T_END) * 100, pctY: (v) => (1 - (v - f.y.min) / span) * 100 };
  const cy = (y: number, lo = T + 8, hi = B - 8) => Math.min(hi, Math.max(lo, y));
  const wide = w >= 520;

  const bp = f.beatProgress;
  const at = (k: StoryFrame["beat"]) => f.beat === k;
  const calm = 1 - f.zoom;

  // Grid: round ticks inside the camera.
  const ticks = niceTicks(f.y.min, f.y.max, compact ? 2 : 4);
  const tickStep = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const tickLabel = (v: number) => (Number.isInteger(tickStep) && Number.isInteger(v) ? formatUsdWhole(v) : formatUsdCents(v));

  // Floor.
  const f0 = m.floorPer100GrossUsd;
  const hasFloor = f.floorSteps.length > 1;
  const floorOpacity = hasFloor ? (at("split") ? ramp(f.floorReveal, 0.6, 1) : f.floorReveal) : 0;
  const stepD = hasFloor ? stepPathD(f.floorSteps, s) : "";
  const areaD = hasFloor ? `${stepD} L${X(f.floorSteps[f.floorSteps.length - 1]![0]).toFixed(2)} ${B} L${X(f.floorSteps[0]![0]).toFixed(2)} ${B} Z` : "";

  // Arbitrage line (bounce on).
  const arbOpacity = f.arbLine100 === null ? 0 : at("bounce") ? ramp(bp, 0, 0.25) : 1;
  const arbD = f.arbLine100 !== null && hasFloor ? stepPathD(f.floorSteps, s, m.arbLineRatio) : "";

  const harvests = f.events.filter((e) => e.kind === "harvest");
  const holders = f.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const lastFee = harvests[harvests.length - 1];
  const feesOpacity = f.feesPct === null || !lastFee ? 0 : at("steps") ? ramp(bp, 0.45, 0.9) : at("bounce") ? 1 - ramp(bp, 0, 0.2) : 0;
  const exitsOpacity = !holders || f.exitsPct === null ? 0 : at("exits") ? ramp(bp, 0.5, 0.65) : at("redeem") ? 1 - ramp(f.redeemProgress, 0, 0.3) : 0;
  const bounceNoteOpacity = at("bounce") ? 1 : at("exits") ? 1 - ramp(bp, 0.2, 0.4) : 0;

  // Head (your $100) and the redeem drop onto the net floor.
  const headX = X(f.t);
  const headValue = shownValue(m, f);
  const headY = cy(Y(headValue), T, B);
  const redeemNet = f.floorNet100 ?? 0;
  const redeemY = Y(headValue + (redeemNet - headValue) * easeInOut(f.redeemProgress));
  const redeemText = CHART_COPY.redeem(redeemNet);
  const redeemW = textW(redeemText, 12.5) + 18;
  const topFloor = hasFloor ? f.floorSteps[f.floorSteps.length - 1]![1] : redeemNet;
  const chipY = cy(Y(Math.max(topFloor, redeemNet)) - 34, T + 14, B - 14);
  const chipRight = Math.min(R - 2, headX + 8);

  // Active beat: a faint column behind the data (the zero-span steps beat has none).
  const active = BEATS.find((b) => b.key === f.beat && b.end > b.start);

  // Notes that may flip side to stay inside the plot.
  const startOrEnd = (ax: number, text: string, gap = 12) =>
    ax + gap + textW(text) <= R - 2 ? { tx: ax + gap, anchor: "start" as const } : { tx: ax - gap, anchor: "end" as const };

  const peakText = CHART_COPY.peak(f.peak.value).replace(" ↑", "");
  const peakOpacity = f.t >= f.peak.t - 1e-6 ? (at("pump") ? ramp(bp, 0.9, 1) : 1) * (1 - ramp(f.zoom, 0, 0.4)) : 0;
  const peakPos = { x: X(f.peak.t), y: Y(f.peak.value) };

  const meetText = "Meets the floor";
  const meetOpacity = at("selloff") ? ramp(bp, 0.8, 0.98) : at("steps") ? 1 - ramp(f.zoom, 0, 0.35) : 0;
  const meetPos = { x: X(BEATS.find((b) => b.key === "selloff")!.end), y: Y(f.floor100 ?? m.floorPer100GrossUsd) };

  // The bounce: the price lands on the arbitrage line (landedValue) and turns up.
  const dip = f.dip ? { x: X(f.dip.t), y: Y(landedValue(m, f.dip.t, f.dip.value)) } : null;

  // Close-ups: the earlier price runs off the top. Fade it out and mark where it comes back in.
  const path = f.path.map(([t, v]): [number, number] => [t, landedValue(m, t, v)]);
  const offScale = f.zoom > 0 ? offScaleEntry(path, f.y.max) : null;

  // The raise column (presale, split): wide enough to be the beat's main object at any card width.
  const colW = Math.min(150, Math.max(58, pw * 0.2));
  const col = { x0: L + Math.max(10, X(COL_T0) - L), x1: 0 };
  col.x1 = col.x0 + colW;
  // It stays through the split's held frame and fades out as the pump opens (never pops off at a beat boundary).
  const columnOpacity = f.beatIndex <= 1 ? 1 : f.beatIndex === 2 ? 1 - ramp(bp, 0, 0.3) : 0;
  const showColumn = columnOpacity > 0.001 && f.zoom === 0;

  // Ledger chips. The "Floor" label sits above chip 1 (and clear of chip 2 on narrow cards).
  const chipR = wide ? 9 : 7.5;
  const floorLabelX = hasFloor ? X(f.floorSteps[0]![0]) - 3 : 0;

  return (
    <div ref={ref} className="absolute inset-0" data-part="plot">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={styles.svg}>
        <defs>
          <clipPath id={clip}>
            <rect x={L} y={T - 6} width={pw + 6} height={ph + 6} />
          </clipPath>
          <linearGradient id={`${clip}-fade`} gradientUnits="userSpaceOnUse" x1={0} y1={T - 6} x2={0} y2={T + 72}>
            <stop offset="0" className={styles.maskStop} stopOpacity={0} />
            <stop offset="1" className={styles.maskStop} stopOpacity={1} />
          </linearGradient>
          <mask id={`${clip}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
            <rect x={0} y={0} width={w} height={h} fill={`url(#${clip}-fade)`} />
          </mask>
        </defs>

        {/* Active beat column (not behind the raise column, which is the beat's own object). */}
        {active && f.beatIndex >= 2 ? (
          <rect x={X(active.start)} y={T - 6} width={Math.max(0, X(active.end) - X(active.start))} height={ph + 6} rx={6} className={styles.activeCol} data-part="active-col" />
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
        <line x1={L} x2={R} y1={B} y2={B} className={styles.grid} />
        {f.y.min === 0 && !compact ? (
          <text x={R + 8} y={B} dy="0.35em" className={`${styles.tick} tnum`}>
            $0
          </text>
        ) : null}

        {/* What you paid. */}
        {calm > 0.01 && Y(100) > T ? (
          <g opacity={calm}>
            <line x1={L} x2={R} y1={Y(100)} y2={Y(100)} className={styles.paid} />
            <text x={R - 2} y={Y(100) - 8} textAnchor="end" className={`${styles.note} ${styles.tone_muted}`}>
              You paid $100
            </text>
          </g>
        ) : null}

        <g clipPath={`url(#${clip})`}>
          {showColumn ? (
            <g opacity={columnOpacity}>
              <RaiseColumn m={m} f={f} x0={col.x0} x1={col.x1} X={X} Y={Y} />
            </g>
          ) : null}

          {hasFloor ? (
            <>
              <path d={areaD} className={styles.floorSlab} opacity={floorOpacity} data-part="floor-slab" />
              {arbD ? <path d={stripBetweenD(f.floorSteps, m.arbLineRatio, s)} className={styles.arbStrip} opacity={arbOpacity} data-part="arb-strip" /> : null}
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
            </>
          ) : null}

          <path
            d={monotonePathD(path, s)}
            className={styles.price}
            opacity={f.priceOpacity}
            mask={offScale ? `url(#${clip}-mask)` : undefined}
            data-part="price"
          />
        </g>

        {/* ---------- Direct labels ---------- */}
        {hasFloor && floorOpacity > 0 && !at("split") ? (
          <text x={floorLabelX} y={cy(Y(f.floorSteps[0]![1]) - chipR - 10)} className={`${styles.note} ${styles.tone_floor} ${styles.noteStrong}`} opacity={floorOpacity * (1 - columnOpacity)}>
            {CHART_COPY.floor}
          </text>
        ) : null}

        {showColumn ? (
          <g opacity={columnOpacity}>
            <ColumnLabels m={m} f={f} x0={col.x0} x1={col.x1} T={T} X={X} Y={Y} big={wide} />
          </g>
        ) : null}

        <Note ax={peakPos.x} ay={peakPos.y} {...startOrEnd(peakPos.x, peakText)} ty={cy(peakPos.y - 22)} text={peakText} opacity={peakOpacity} strong />

        <Note ax={meetPos.x} ay={meetPos.y} tx={meetPos.x - 14 - chipR} ty={cy(meetPos.y + 14 + 2 * chipR, T + 8, B - 7)} anchor="end" text={meetText} opacity={meetOpacity} />

        {feesOpacity > 0 && lastFee && f.feesPct !== null ? (
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
        ) : null}

        {/* In the compact still the exits note sits where this label would; the dashed line reads by itself. */}
        {arbD && !(compact && exitsOpacity > 0) ? (
          <text
            x={X(f.floorSteps[0]![0]) + 4}
            y={cy(Y(f.floorSteps[0]![1] * m.arbLineRatio) + 15)}
            className={`${styles.note} ${styles.tone_arb} ${styles.noteStrong}`}
            opacity={at("bounce") ? ramp(bp, 0.15, 0.35) : 1}
            data-part="arb-label"
          >
            {CHART_COPY.arbLine}
          </text>
        ) : null}

        {dip ? (
          <>
            <circle cx={dip.x} cy={dip.y} r={9} className={styles.bounceHalo} />
            <circle cx={dip.x} cy={dip.y} r={5} className={styles.bounce} data-part="bounce" />
            <Note ax={dip.x} ay={dip.y} tx={dip.x} ty={cy(dip.y + 30)} text={CHART_COPY.bounce} anchor="middle" opacity={bounceNoteOpacity} tone="arb" strong />
          </>
        ) : null}

        {exitsOpacity > 0 && holders && f.exitsPct !== null ? (
          <Note
            ax={X(holders.t)}
            ay={Y(holders.to) + chipR + 2}
            tx={X(holders.t) - 10}
            ty={cy(Math.max(Y(holders.from * m.arbLineRatio), dip?.y ?? -Infinity) + 36)}
            text={CHART_COPY.fromExits(f.exitsPct)}
            anchor="end"
            opacity={exitsOpacity}
            tone="floor"
            strong
          />
        ) : null}

        {/* Ledger chips: the same numbers as the ledger's rows, on the floor step each entry made. */}
        {hasFloor ? <Chips f={f} ledger={ledger} X={X} Y={Y} r={chipR} numbers={!compact} /> : null}

        {/* Head: your $100 now. */}
        <circle cx={headX} cy={headY} r={5} className={styles.head} opacity={f.priceOpacity} data-part="head" />

        {f.redeemProgress > 0 ? (
          <>
            <circle cx={headX} cy={cy(redeemY, T, B)} r={6} className={styles.redeemDot} data-part="redeem-dot" />
            {/* A solid mint pill above the top floor step (clear of the staircase), with a leader down to the dot. */}
            <g opacity={ramp(f.redeemProgress, 0.5, 1)} data-part="redeem-label">
              <path d={`M${headX} ${chipY + 11} V${cy(redeemY, T, B) - 7}`} className={styles.redeemLeader} />
              <rect x={chipRight - redeemW} y={chipY - 11} width={redeemW} height={22} rx={11} className={styles.chipBack} />
              <text x={chipRight - redeemW / 2} y={chipY} dy="0.35em" textAnchor="middle" className={styles.chipText}>
                {redeemText}
              </text>
            </g>
          </>
        ) : null}

        {offScale !== null ? (
          <g opacity={ramp(f.zoom, 0.4, 1)} data-part="off-scale">
            <text x={X(offScale) - 6} y={T + 2} dy="0.35em" textAnchor="end" className={`${styles.note} ${styles.tone_muted}`}>
              ↑ off scale
            </text>
          </g>
        ) : null}

        {/* x axis: the beats, the active one in white. */}
        {compact ? null : <XAxis active={activeBeat} X={X} B={B} wide={wide} lo={L + 2} hi={R + 4} />}
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

/** Beats along the x axis. Wide: names (active in white). Narrow: numbers that match the caption's badge. */
function XAxis({ active, X, B, wide, lo, hi }: { active: number; X: (t: number) => number; B: number; wide: boolean; lo: number; hi: number }) {
  const ticks = BEATS.filter((b) => b.end > b.start).slice(1);
  const labels = BEATS.map((b, i) => (wide ? BEAT_LABELS[b.key] : String(i + 1)));
  const fs = wide ? 11.5 : 11;
  const xs = spreadLabels(
    BEATS.map((b) => (b.end <= b.start ? X(b.start) : (X(b.start) + X(b.end)) / 2)),
    labels.map((l) => textW(l, fs)),
    lo,
    hi,
    wide ? 12 : 6,
  );
  return (
    <g data-part="x-axis">
      {ticks.map((b) => (
        <line key={b.key} x1={X(b.start)} x2={X(b.start)} y1={B} y2={B + 5} className={styles.xTick} />
      ))}
      {BEATS.map((b, i) => {
        const isActive = i === active;
        return (
          <text key={b.key} x={xs[i]} y={B + 18} textAnchor="middle" className={`${styles.xLabel} ${isActive ? styles.xActive : ""} tnum`} data-part="x-label">
            {labels[i]}
          </text>
        );
      })}
    </g>
  );
}

/** Column segments as cumulative shares of the raise, bottom to top. */
export function columnSegments(m: LaunchMath) {
  const parts: Array<[key: "floor" | "market" | "creator" | "platform", usd: number]> = [
    ["floor", m.split.floorUsd],
    ["market", m.split.poolUsd],
    ["creator", m.split.creatorUsd],
    ["platform", m.split.platformUsd],
  ];
  let acc = 0;
  return parts.map(([key, usd]) => {
    const from = acc / m.raiseUsd;
    acc += usd;
    return { key, usd, from, to: acc / m.raiseUsd };
  });
}

/**
 * The split's geometry (variant 3's motion): the column divides (thin gaps open), then the floor
 * segment's top drops to the floor's value per $100 and the segment slides into the slab under the
 * staircase, while market and fees stay standing, dimmed, so the finished frame still shows which
 * part became the floor and which did not. Shared by the column and its labels.
 */
function splitGeometry(m: LaunchMath, f: StoryFrame, x0: number, x1: number, X: (t: number) => number) {
  const segs = columnSegments(m);
  const reveal = f.floorReveal;
  const drop = easeInOut(ramp(reveal, 0, 0.55));
  const slide = easeInOut(ramp(reveal, 0.4, 1));
  const top = segs[0]!.to * COL_TOP + (m.floorPer100GrossUsd - segs[0]!.to * COL_TOP) * drop;
  const gap = 1.5 * easeInOut(ramp(f.splitProgress, 0, 0.4));
  const fx0 = x0 + (X(PRESALE.end) - x0) * slide;
  const fx1 = x1 + (X(f.t) - x1) * slide;
  // Once the floor has settled, market and fees step back (fills more than labels, which stay legible).
  const settled = ramp(reveal, 0.5, 1);
  const rest = 1 - 0.3 * settled;
  const labelRest = 1 - 0.15 * settled;
  return { segs, drop, top, gap, fx0, fx1, rest, labelRest };
}

type ColProps = { m: LaunchMath; f: StoryFrame; x0: number; x1: number; X: (t: number) => number; Y: (v: number) => number };

/** Presale: the column fills up to your $100. Split: it divides into floor, market and fees; the floor settles into the floor. */
function RaiseColumn({ m, f, x0, x1, X, Y }: ColProps) {
  if (f.beatIndex === 0) {
    const fill = Math.min(1, f.raisedUsd / m.raiseUsd) * COL_TOP;
    return (
      <g data-part="raise-column">
        <rect x={x0} y={Y(COL_TOP)} width={x1 - x0} height={Math.max(0, Y(0) - Y(COL_TOP))} rx={3} className={styles.colTrack} />
        <rect x={x0} y={Y(fill)} width={x1 - x0} height={Math.max(0, Y(0) - Y(fill))} rx={3} className={styles.colFill} data-part="raise-fill" />
      </g>
    );
  }
  const g = splitGeometry(m, f, x0, x1, X);
  const grow = f.splitProgress;
  return (
    <g data-part="split-column">
      {g.segs.slice(1).map((sg, i) => {
        const lo = Y(sg.from * COL_TOP) - g.gap;
        const hi = Y(sg.to * COL_TOP) + g.gap;
        // Each share takes its colour in turn (market, then the two fees), as its label appears. The
        // colour is laid over an opaque raise fill (not crossfaded with it), so it never turns muddy.
        const tint = ramp(grow, 0.3 + 0.2 * i, 0.55 + 0.2 * i);
        return (
          <g key={sg.key} opacity={g.rest} data-seg={sg.key}>
            {tint < 1 ? <rect x={x0} y={hi} width={x1 - x0} height={Math.max(0, lo - hi)} className={styles.colFill} /> : null}
            <rect x={x0} y={hi} width={x1 - x0} height={Math.max(0, lo - hi)} className={styles[`col_${sg.key}`]} opacity={tint} />
          </g>
        );
      })}
      <g data-seg="floor">
        <rect
          x={g.fx0}
          y={Y(g.top) + g.gap * (1 - g.drop)}
          width={Math.max(0, g.fx1 - g.fx0)}
          height={Math.max(0, Y(0) - Y(g.top) - g.gap * (1 - g.drop))}
          className={styles.colFill}
          opacity={ramp(grow, 0.05, 0.3) < 1 ? 1 : 0}
        />
        <rect
          x={g.fx0}
          y={Y(g.top) + g.gap * (1 - g.drop)}
          width={Math.max(0, g.fx1 - g.fx0)}
          height={Math.max(0, Y(0) - Y(g.top) - g.gap * (1 - g.drop))}
          className={styles.col_floor}
          opacity={ramp(grow, 0.05, 0.3)}
        />
      </g>
    </g>
  );
}

/** Big direct labels beside the column, in the segments' own colours. */
function ColumnLabels({ m, f, x0, x1, T, X, Y, big }: ColProps & { T: number; big: boolean }) {
  const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;
  const tx = x1 + (big ? 16 : 10);
  if (f.beatIndex === 0) {
    const fill = Math.min(1, f.raisedUsd / m.raiseUsd) * COL_TOP;
    if (f.raisedUsd < 1) return null;
    return (
      <g data-part="raise-label">
        <text x={tx} y={Math.min(Y(0) - 12, Y(fill) + 18)} dy="0.35em" className={`${styles.colLabel} ${styles.colLabel_raise} tnum`}>
          {CHART_COPY.raised(f.raisedUsd)}
          <tspan className={styles.colLabelMuted}>{` of ${formatUsdWhole(m.raiseUsd)}`}</tspan>
        </text>
      </g>
    );
  }
  const g = splitGeometry(m, f, x0, x1, X);
  const mid = (a: number, b: number) => Y(((a + b) / 2) * COL_TOP);
  const gap = big ? 16 : 10;
  const items = [
    {
      key: "fees",
      text: `Fees ${CHART_COPY.fees(pct(m.split.creatorUsd), pct(m.split.platformUsd))}`,
      from: x1,
      y: mid(g.segs[2]!.from, g.segs[3]!.to),
      o: ramp(f.splitProgress, 0.7, 0.95) * g.labelRest,
    },
    {
      key: "market",
      text: `${CHART_COPY.market} ${pct(m.split.poolUsd)}%`,
      from: x1,
      y: mid(g.segs[1]!.from, g.segs[1]!.to),
      o: ramp(f.splitProgress, 0.3, 0.55) * g.labelRest,
    },
    // The floor's label rides on its segment as it drops and slides into the slab.
    { key: "floor", text: CHART_COPY.floorShare(Math.round(pct(m.split.floorUsd))), from: g.fx1, y: Y(g.top / 2), o: ramp(f.splitProgress, 0.05, 0.3) },
  ];
  // Short ticks from the column's edge to each label, so a label is never read against the wrong segment.
  return (
    <g data-part="split-labels">
      {items.map((it) =>
        it.o > 0.001 ? (
          <g key={it.key} opacity={it.o} data-label={it.key}>
            <path d={`M${it.from + 3} ${it.y} H${it.from + gap - 5}`} className={`${styles.colTick} ${styles[`colTick_${it.key}`]}`} />
            <text x={it.from + gap} y={it.y} dy="0.35em" className={`${styles.colLabel} ${styles[`colLabel_${it.key}`]} tnum`}>
              {it.text}
            </text>
          </g>
        ) : null,
      )}
    </g>
  );
}

/** Numbered ledger chips on the staircase. */
function Chips({ f, ledger, X, Y, r, numbers }: { f: StoryFrame; ledger: Ledger; X: (t: number) => number; Y: (v: number) => number; r: number; numbers: boolean }) {
  return (
    <g data-part="chips">
      {ledger.entries.map((e) => {
        const o = chipOpacity(f, ledger, e);
        if (o <= 0.001) return null;
        const hot = ledger.latest?.n === e.n;
        const x = X(e.t);
        const y = Y(e.floor100);
        return (
          <g key={e.n} opacity={o} data-chip={e.n} data-kind={e.kind} data-hot={hot ? "" : undefined}>
            {hot ? <circle cx={x} cy={y} r={r + 3 + 4 * ledger.fresh} className={`${styles.chipHalo} ${styles[`kind_${e.kind}`]}`} /> : null}
            <circle cx={x} cy={y} r={numbers ? r : 4} className={`${styles.chipDot} ${styles[`kind_${e.kind}`]}`} />
            {numbers ? (
              <text x={x} y={y} dy="0.36em" textAnchor="middle" className={`${styles.chipNo} tnum`}>
                {e.n}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
