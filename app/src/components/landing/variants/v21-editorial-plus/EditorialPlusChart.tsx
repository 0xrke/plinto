import { useEffect, useId, useRef, useState, type JSX } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, BOUNCE_ARB_KNOT, BOUNCE_DIP_KNOT, bounceWaypoints, easeInOut, STORY_T_END, storyValueAt } from "@/lib/landing/sim/story";
import { along, range } from "@/lib/landing/sim/timeline";
import { monotonePathD, niceTicks, ramp, stepPathD, stripBetweenD, type Scales } from "@/components/landing/lab/storyChartGeometry";
import {
  BEAT_LABELS,
  BrandChartFrame,
  CHART_COPY,
  TILE_FLOOR,
  TILE_NOW,
  floorSharePct,
  formatUsdCents,
  formatUsdWhole,
  tileValues,
  type StoryFrame,
} from "../shared";
import styles from "./editorialPlus.module.css";

/*
 * Variant 21, "Editorial plus": variant 11's newspaper-graphics chart (direct labels with leader
 * lines, the active-beat column, beats along the x axis, the two headline figures above the plot),
 * drawn taller, with the split beat redrawn as variant 3's bold raise column: your $100 stacked on
 * the $ axis as floor (mint), market (iris) and fees (butter), each labelled with its share, then the
 * floor segment drops to the floor per $100 and slides onto the slab under the staircase. The plot sits
 * in the midnight chart card (BrandChartFrame: butter "Illustration" pill, "Close-up · real scale"
 * chip); the price is white, the floor a mint staircase from frame.floorSteps, the arbitrage line and
 * bounce rose. Drawn in real pixels (ResizeObserver) so hairlines stay 1px and labels sit on the data.
 * Pure function of the frame: no timers and no transitions on values. Every colour is a site token.
 */

const PAD = { l: 0, r: 46, t: 10, b: 28 };
const SPLIT = BEATS.find((b) => b.key === "split")!;
/** The split column's height in chart dollars: your whole $100, on the chart's own y axis. */
const COL_TOP = 100;
const FS = 12;
/** Rough text width for flip decisions (no layout reads on scroll). */
const textW = (s: string, fs = FS) => s.length * fs * 0.6;

const BOUNCE = BEATS.find((b) => b.key === "bounce")!;

/**
 * Display only, for the made-up bounce: the engine's illustrative dip knot sits a little under the
 * arbitrage line, so drawn as-is the price reads as passing through the line. Here the dip knot is
 * drawn exactly on the line and the arbitrage knot halfway up to the sell-stop knot, so the price
 * comes down onto the dashed line and turns up. Same eased knots, same times; only the bounce's
 * knots 1..4 change, and the result never goes under the line. A pure function of (m, t, v).
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

/** The two headline figures, as site tiles with a direct-label key glyph each. */
function Figures({ m, f, still }: { m: LaunchMath; f: StoryFrame; still: boolean }) {
  const tiles = tileValues(f);
  const floor = tiles.floor;
  // The head as drawn (see landedValue): differs from the engine value only inside the bounce's dip.
  const shown = landedValue(m, f.t, f.valueOf100);
  const now = f.redeemProgress >= 1 || shown === f.valueOf100 ? tiles.now : formatUsdCents(shown);
  return (
    <div className={`${styles.figures} ${still ? styles.figuresStill : ""}`}>
      <p className={`${styles.fig} bg-cloud`}>
        <span className={styles.figLabel}>
          <svg width="18" height="10" className={styles.key} aria-hidden>
            <path d="M1 7 C5 7 7 2 11 3 S15 4 17 2" className={styles.keyInk} />
          </svg>
          <span className="truncate">{TILE_NOW}</span>
        </span>
        <b className={`${styles.figValue} tnum`} data-part="now">
          {now}
        </b>
      </p>
      <p className={`${styles.fig} bg-floor-wash`}>
        <span className={`${styles.figLabel} text-floor`}>
          <svg width="18" height="10" className={styles.key} aria-hidden>
            <path d="M1 8 H7 V5 H12 V2 H17" className={styles.keyFloor} />
          </svg>
          <span className="truncate">{TILE_FLOOR}</span>
        </span>
        <b className={`${styles.figValue} ${styles.figFloor} tnum`} data-part="floor">
          {floor}
        </b>
      </p>
    </div>
  );
}

export interface EditorialPlusChartProps {
  m: LaunchMath;
  frame: StoryFrame;
  /** Reduced-motion still: a fixed-height card, compact figures. */
  still?: boolean;
}

export function EditorialPlusChart({ m, frame: f, still = false }: EditorialPlusChartProps): JSX.Element {
  return (
    <div className={`${styles.chart} ${still ? styles.chartStill : ""}`} aria-hidden data-chart={still ? "still" : "stage"}>
      <Figures m={m} f={f} still={still} />
      <BrandChartFrame
        className={still ? "" : "flex-1"}
        size={still ? "still" : "stage"}
        illustration={showsMadeUpPath(f)}
        scale={f.zoom > 0 ? "real" : null}
        scaleOpacity={ramp(f.zoom, 0.3, 1)}
      >
        <Plot m={m} f={f} still={still} />
      </BrandChartFrame>
    </div>
  );
}

function Plot({ m, f, still }: { m: LaunchMath; f: StoryFrame; still: boolean }) {
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
  // In the split, the staircase and slab appear only once the column's floor segment has landed.
  const phases = splitPhases(f);
  const floorOpacity = hasFloor ? (at("split") ? phases.land : f.floorReveal) : 0;
  const slabOpacity = hasFloor ? (at("split") ? phases.land : f.floorReveal) : 0;
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
  const headValue = landedValue(m, f.t, f.valueOf100);
  const headY = cy(Y(headValue), T, B);
  const redeemNet = f.floorNet100 ?? 0;
  const redeemY = Y(headValue + (redeemNet - headValue) * easeInOut(f.redeemProgress));
  const redeemText = CHART_COPY.redeem(redeemNet);
  const redeemW = textW(redeemText, 12.5) + 18;
  const topFloor = hasFloor ? f.floorSteps[f.floorSteps.length - 1]![1] : redeemNet;
  const chipY = cy(Y(Math.max(topFloor, redeemNet)) - 28, T + 14, B - 14);
  const chipRight = Math.min(R - 2, headX + 8);

  // Active beat: a faint column behind the data (the zero-span steps beat has none).
  const active = BEATS.find((b) => b.key === f.beat && b.end > b.start);

  // Notes that may flip side to stay inside the plot.
  const startOrEnd = (ax: number, text: string, gap = 12) =>
    ax + gap + textW(text) <= R - 2 ? { tx: ax + gap, anchor: "start" as const } : { tx: ax - gap, anchor: "end" as const };

  // Under the "You paid $100" line with room for its title, so the 0% tick never meets the $100 head.
  const raiseY = Math.min(B - 40, Math.max(T + 30, Y(100) + (compact ? 40 : 60)));
  const raiseShare = Math.min(1, Math.max(0, f.raisedUsd / m.raiseUsd));
  const raiseBarOpacity = (at("presale") ? 1 : at("split") ? 1 - ramp(bp, 0, 0.1) : 0) * calm;
  const box = columnBox(X, L, pw);

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

        {/* Active beat column. */}
        {active && !at("split") ? (
          <rect x={X(active.start)} y={T - 6} width={Math.max(0, X(active.end) - X(active.start))} height={ph + 6} rx={6} className={styles.activeCol} data-part="active-col" />
        ) : null}

        {/* Presale: the raise as its own progress bar (0..100% of the raise), never on the $ axis. */}
        {raiseBarOpacity > 0.001 ? (
          <RaiseBar x={L + 8} y={raiseY} w={Math.min(pw * 0.62, 300)} share={raiseShare} raised={f.raisedUsd} goal={m.raiseUsd} opacity={raiseBarOpacity} />
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
            {/* Steps aside while the split column's fee label sits under it. */}
            <text
              x={R - 2}
              y={Y(100) - 8}
              textAnchor="end"
              className={`${styles.note} ${styles.tone_muted}`}
              opacity={at("split") ? Math.max(1 - phases.feesGrow, phases.land) : 1}
            >
              You paid $100
            </text>
          </g>
        ) : null}

        <g clipPath={`url(#${clip})`}>
          {at("split") ? <SplitColumn m={m} f={f} X={X} Y={Y} box={box} /> : null}

          {hasFloor ? (
            <>
              <path d={areaD} className={styles.floorSlab} opacity={slabOpacity} data-part="floor-slab" />
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
              {f.zoom > 0
                ? harvests.map((e) => <circle key={e.t} cx={X(e.t)} cy={Y(e.to)} r={3} className={styles.floorDot} opacity={f.zoom} data-part="harvest" />)
                : null}
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
        {hasFloor && floorOpacity > 0 ? (
          <text x={X(f.floorSteps[0]![0]) + 4} y={cy(Y(f.floorSteps[0]![1]) - 10)} className={`${styles.note} ${styles.tone_floor} ${styles.noteStrong}`} opacity={floorOpacity}>
            {CHART_COPY.floor}
          </text>
        ) : null}

        {at("split") ? <SplitLabels m={m} f={f} X={X} Y={Y} box={box} narrow={!wide} /> : null}

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
            {firstFee && !compact ? (
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
          <>
            <circle cx={X(holders.t)} cy={Y(holders.to)} r={3} className={styles.floorDot} opacity={exitsOpacity} data-part="exits" />
            <Note
              ax={X(holders.t)}
              ay={(Y(holders.from) + Y(holders.to)) / 2}
              tx={X(holders.t) - 10}
              ty={cy(Math.max(Y(holders.from * m.arbLineRatio), dip?.y ?? -Infinity) + 24)}
              text={CHART_COPY.fromExits(f.exitsPct)}
              anchor="end"
              opacity={exitsOpacity}
              tone="floor"
              strong
            />
          </>
        ) : null}

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
        {compact ? null : <XAxis f={f} X={X} B={B} wide={wide} lo={L + 2} hi={R + 4} />}
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
      <text x={x} y={y - 12} className={`${styles.note} ${styles.noteStrong} ${styles.tone_ink}`}>
        {CHART_COPY.raised(raised)}
        <tspan className={styles.tone_muted} fontWeight={500}>{` of ${formatUsdWhole(goal)}`}</tspan>
      </text>
      <rect x={x} y={y} width={w} height={8} rx={4} className={styles.raiseTrack} />
      <rect x={x} y={y} width={Math.max(share > 0 ? 8 : 0, w * share)} height={8} rx={4} className={styles.raiseFill} data-part="raise-fill" />
      <text x={x} y={y + 24} className={`${styles.tick} tnum`}>
        0%
      </text>
      <text x={x + w} y={y + 24} textAnchor="end" className={`${styles.tick} tnum`}>
        100% of the raise
      </text>
    </g>
  );
}

/** Beats along the x axis. Wide: names (active in white). Narrow: numbers that match the captions' badges. */
function XAxis({ f, X, B, wide, lo, hi }: { f: StoryFrame; X: (t: number) => number; B: number; wide: boolean; lo: number; hi: number }) {
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
        const isActive = b.key === f.beat;
        return (
          <text key={b.key} x={xs[i]} y={B + 18} textAnchor="middle" className={`${styles.xLabel} ${isActive ? styles.xActive : ""} tnum`} data-part="x-label">
            {labels[i]}
          </text>
        );
      })}
    </g>
  );
}


type SegKey = "floor" | "market" | "creator" | "platform";

/** Column segments as cumulative shares of the raise, bottom to top. */
export function columnSegments(m: LaunchMath): Array<{ key: SegKey; from: number; to: number; usd: number }> {
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
    return { key, from, to: acc / m.raiseUsd, usd };
  });
}

/**
 * The split beat's choreography, from the beat's own progress (0..1), so the full labelled column
 * holds for a while before the floor settles:
 * - grow: the segments rise bottom to top (floor, market, fees), each with its label;
 * - drop: the floor segment's top comes down from its 50% share to the floor per $100;
 * - slide: the floor segment slides left onto the slab that the staircase starts from, while the
 *   market and fee segments fade away;
 * - land: the segment fades into the slab and the mint staircase takes over.
 */
export function splitPhases(f: StoryFrame) {
  const bp = f.beat === "split" ? f.beatProgress : f.beatIndex > 1 ? 1 : 0;
  return {
    floorGrow: easeInOut(ramp(bp, 0.02, 0.14)),
    marketGrow: easeInOut(ramp(bp, 0.1, 0.22)),
    feesGrow: easeInOut(ramp(bp, 0.18, 0.3)),
    drop: easeInOut(ramp(bp, 0.54, 0.68)),
    slide: easeInOut(ramp(bp, 0.68, 0.88)),
    rest: 1 - ramp(bp, 0.66, 0.8),
    land: ramp(bp, 0.86, 0.98),
  };
}

/** Where the floor segment settles: the first step of the staircase (the floor per $100 at listing). */
const floorStart = (m: LaunchMath, f: StoryFrame): number => f.floorSteps[0]?.[1] ?? m.floorPer100GrossUsd;

type ColumnBox = { x0: number; x1: number; top: number };

/** The column's place in pixels: wide, in the empty plot right of the split beat, $0..$100 tall. */
export function columnBox(X: (t: number) => number, L: number, pw: number): ColumnBox {
  const w = Math.min(150, Math.max(64, pw * 0.2));
  const x0 = Math.max(L + 8, X(SPLIT.end) + Math.max(14, pw * 0.05));
  return { x0, x1: x0 + w, top: COL_TOP };
}

type Axis = { m: LaunchMath; f: StoryFrame; X: (t: number) => number; Y: (v: number) => number; box: ColumnBox; narrow?: boolean };

/** Split beat: your $100 as one stacked column on the $ axis; its floor share then settles onto the slab. */
function SplitColumn({ m, f, X, Y, box }: Axis) {
  const segs = columnSegments(m);
  const p = splitPhases(f);
  const gapPx = 3;
  const floorSeg = segs[0]!;
  const floorFull = floorSeg.to * box.top;
  const floorTop = (floorFull + (floorStart(m, f) - floorFull) * p.drop) * p.floorGrow;
  const slabX0 = X(f.floorSteps[0]?.[0] ?? SPLIT.start);
  const slabX1 = Math.max(slabX0 + 2, X(f.t));
  const fx0 = box.x0 + (slabX0 - box.x0) * p.slide;
  const fx1 = box.x1 + (slabX1 - box.x1) * p.slide;
  const grows = [p.floorGrow, p.marketGrow, p.feesGrow, p.feesGrow];
  return (
    <g data-part="split-column">
      {p.floorGrow > 0 ? (
        <rect
          x={fx0}
          y={Y(floorTop)}
          width={Math.max(0, fx1 - fx0)}
          height={Math.max(0, Y(0) - Y(floorTop))}
          rx={4 * (1 - p.slide)}
          className={styles.colFloor}
          opacity={1 - 0.86 * p.land}
          data-part="split-floor"
        />
      ) : null}
      {segs.slice(1).map((seg, i) => {
        const g = grows[i + 1]!;
        if (!(g > 0) || !(p.rest > 0)) return null;
        const lo = seg.from * box.top;
        const hi = lo + (seg.to - seg.from) * box.top * g;
        const y0 = Y(hi);
        const y1 = Y(lo) - gapPx;
        return (
          <rect
            key={seg.key}
            x={box.x0}
            y={y0}
            width={box.x1 - box.x0}
            height={Math.max(0, y1 - y0)}
            rx={3}
            className={styles[`col_${seg.key}`]}
            opacity={p.rest}
            data-part={`split-${seg.key}`}
          />
        );
      })}
    </g>
  );
}

/** Big direct labels beside the column: name and share, with the dollars of your $100 under them. */
function SplitLabels({ m, f, X, Y, box, narrow = false }: Axis) {
  const segs = columnSegments(m);
  const p = splitPhases(f);
  const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;
  const per100 = (usd: number) => formatUsdWhole((usd / m.raiseUsd) * 100);
  const floorFull = segs[0]!.to * box.top;
  const floorTop = floorFull + (floorStart(m, f) - floorFull) * p.drop;
  const slabX1 = Math.max(X(SPLIT.start) + 2, X(f.t));
  const floorX = box.x1 + (slabX1 - box.x1) * p.slide + 14;
  const tx = box.x1 + 14;
  const feesMid = ((segs[2]!.from + segs[3]!.to) / 2) * box.top;
  const items = [
    {
      key: "floor",
      x: floorX,
      y: Y(floorTop / 2),
      text: CHART_COPY.floorShare(floorSharePct(m)),
      sub: `${per100(m.split.floorUsd)} → floor vault`,
      // Once the segment has dropped, its dollar line says what the shorter bar now is.
      settled: "the floor under your $100",
      tone: styles.labelFloor,
      // Rides with the segment onto the slab, then hands over to the staircase's own "Floor" label.
      o: ramp(p.floorGrow, 0.4, 1) * (1 - ramp(p.land, 0, 0.7)),
    },
    {
      key: "market",
      x: tx,
      y: Y(((segs[1]!.from + segs[1]!.to) / 2) * box.top),
      text: `${CHART_COPY.market} ${pct(m.split.poolUsd)}%`,
      sub: `${per100(m.split.poolUsd)} → trading pool`,
      tone: styles.labelMarket,
      o: ramp(p.marketGrow, 0.4, 1) * p.rest,
    },
    {
      key: "fees",
      x: tx,
      // Lifted a little above the thin fee segments so it never meets the market label.
      y: Math.min(Y(feesMid), Y(segs[1]!.to * box.top) - 30),
      text: `Fees ${CHART_COPY.fees(pct(m.split.creatorUsd), pct(m.split.platformUsd))}`,
      sub: narrow
        ? `${per100(m.split.creatorUsd)} + ${per100(m.split.platformUsd)}`
        : `${per100(m.split.creatorUsd + m.split.platformUsd)} → creator · platform`,
      tone: styles.labelFees,
      o: ramp(p.feesGrow, 0.4, 1) * p.rest,
    },
  ];
  return (
    <g data-part="split-labels">
      {items.map((l) =>
        l.o > 0.001 ? (
          <g key={l.key} opacity={l.o} data-part={`split-label-${l.key}`}>
            <text x={l.x} y={l.y - 2} className={`${styles.splitLabel} ${l.tone} tnum`}>
              {l.text}
            </text>
            <text x={l.x} y={l.y + 15} className={`${styles.splitSub} tnum`} opacity={l.settled ? 1 - ramp(p.drop, 0, 0.45) : 1}>
              {l.sub}
            </text>
            {/* Swapped, not cross-faded, so the two dollar lines never show on top of each other. */}
            {l.settled && p.drop > 0.55 ? (
              <text x={l.x} y={l.y + 15} className={styles.splitSub} opacity={ramp(p.drop, 0.55, 1)}>
                {l.settled}
              </text>
            ) : null}
          </g>
        ) : null,
      )}
    </g>
  );
}
