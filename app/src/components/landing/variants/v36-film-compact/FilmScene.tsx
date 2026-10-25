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
  SINCE_LISTING,
  STROKE,
  TILE_FLOOR,
  TILE_NOW,
  TILE_REDEEMED,
  TILE_SUPPLY,
  alpha,
  formatPctChange,
  formatUsdCents,
  formatUsdWhole,
  sinceListing,
  storyTradedUsd,
  tileValues,
} from "../shared";
import { closeness, type Camera } from "./camera";
import { layoutTags, stripLayout, type FilmGeometry } from "./sections";
import { burnMarks, supplyLane, supplyTag, type BurnMark } from "./supply";
import styles from "./filmCompact.module.css";

/*
 * Variant 36's film frame (copied from v32-film-sections, itself from v24-cinematic-clean): the site's midnight chart card
 * (BrandChartFrame) with the chart in world coordinates (x = story time × 1000, y = −USD × 100) seen
 * through the camera's viewBox. As in v03/v24, the SVG sits in an inset "plot box" with overflow
 * visible and preserveAspectRatio none, so the lines run past the box to the card's rounded edges
 * while the camera's rectangle maps onto the box; strokes are non-scaling. Chart labels are HTML,
 * placed in percent of the plot box. The split is v24's tall labelled column whose floor part lands
 * on the floor slab.
 *
 * What v32 adds (v27's chart language on v24's film): the card is measured, and the plot box is set
 * in pixels under the chip row and a section strip, ending short of the right edge. Over the plot an
 * SVG overlay in card pixels draws (1) the section strip, one section per beat named along the top
 * ("01 Presale", …), the current one bright with a mint number and a progress line, thin dividers,
 * the names following the camera's pans and zooms; (2) the y-axis labels at the right edge; and (3)
 * v27's two tooltips riding the price head on its right ("Your $100 now", "Floor pays back", each
 * with its change since listing once trading opens), clear of the head dot and of the bounce, which
 * always lie to their left. The current section is also lit faintly on the chart itself. A pure
 * function of (frame, camera, card size), with no timers and no transitions on values.
 *
 * v36 changes: compact tooltips on phones (smaller type and padding, see sections.ts), and the
 * redeem step's price tooltip stays at full contrast: instead of dimming the white tag to 55% (grey
 * ink on grey), it crossfades into a midnight-chip tag with white text as you redeem.
 *
 * Token supply on the chart (round 5): a thin supply lane at the card's bottom, like a volume pane
 * (0–100% of the listing supply, iris, sharing the camera's x), stepping down at each burn; a burn
 * marker on the floor line at each redemption that burns tokens, tied by a leader to the lane's step,
 * whose label pairs the supply drop with the small floor step it causes ("−30% supply → floor +0.9%":
 * the vault pays the redeemers out, so the floor rises by under 1%); and a third tooltip at the head,
 * "Token supply 69.7%, −30% since listing". The exits' "+0.9% from exits" chip is gone: the burn label
 * says it, next to its cause.
 */

const SX = 1000;
const SY = 100;
const X = (t: number) => t * SX;
const Y = (v: number) => -v * SY;
const scales: Scales = { xOf: X, yOf: Y, pctX: () => 0, pctY: () => 0 };

const ns = { vectorEffect: "non-scaling-stroke" as const, fill: "none" };

const SPLIT = BEATS.find((b) => b.key === "split")!;
/** The raise column in world units (story time, USD per $100). */
const COL = { x0: 0.08, x1: 0.72, top: 100 };
/** The raise's fill in the presale (and under each share until it takes its colour in the split). */
const PRESALE_FILL = alpha(CHART.presaleFill, 0.9);
/** Far-off world edges for full-bleed lines. */
const FAR_T = [-40, 60] as const;
const FAR_V = [-5000, 50000] as const;

/** The floor-to-arbitrage band: rose, strong enough to read as rose on midnight without mint beneath it. */
const STRIP = alpha("var(--color-risk-on-dark)", 0.3);

const SEG_FILL = {
  market: CHART.market,
  creator: CHART.fees,
  // Both fees are butter (the sandbox legend's colour); the platform's is the pale butter token.
  platform: "var(--color-graduating-soft)",
} as const;

/**
 * Split-beat choreography (beat progress; the split is a long 150svh beat): the presale column takes
 * its colours share by share (floor, market, fees, each with its label) while gaps open, the
 * labelled divided column holds still (the camera holds too, see camera.ts), then the floor part
 * lands on the slab.
 */
const DIVIDE: readonly [number, number] = [0.04, 0.24];
/** When each share takes its colour (and its label appears), bottom to top. */
const TINT = { floor: [0.04, 0.16], market: [0.12, 0.24], fees: [0.2, 0.32] } as const;
const LAND: readonly [number, number] = [0.56, 0.86];
/** The landed floor block hands over to the slab and the staircase. */
const HANDOVER: readonly [number, number] = [0.84, 0.97];
/** The presale's "Raised" label leaves as the column starts to divide. */
const RAISED_OUT: readonly [number, number] = [0.02, 0.1];

/** How far a share has taken its colour (1 outside the split once divided, 0 before it). */
function tintOf(f: StoryFrame, key: keyof typeof TINT): number {
  return f.beatIndex === 1 ? ramp(f.beatProgress, TINT[key][0], TINT[key][1]) : f.beatIndex > 1 ? 1 : 0;
}

/** Progress through the split choreography: 0 before the split, 1 after it. */
function splitBp(f: StoryFrame): number {
  return f.beat === "split" ? f.beatProgress : f.beatIndex > 1 ? 1 : 0;
}

/** The column's market and fee parts (and its outline) fade early in the pump. */
function columnRest(f: StoryFrame): number {
  return f.beat === "pump" ? 1 - ramp(f.beatProgress, 0, 0.12) : f.beatIndex <= 1 ? 1 : 0;
}

/** Where the floor part of the column is at this frame (world units). */
function floorBlock(m: LaunchMath, f: StoryFrame) {
  const bp = splitBp(f);
  const land = easeInOut(ramp(bp, LAND[0], LAND[1]));
  const gap = 1.6 * easeInOut(ramp(bp, DIVIDE[0], DIVIDE[1]));
  const share = m.split.floorUsd / m.raiseUsd;
  const top0 = share * COL.top - gap;
  return {
    land,
    gap,
    top: top0 + (m.floorPer100GrossUsd - top0) * land,
    // It stands on $0, like the column it left and the slab it becomes.
    bottom: 0,
    x0: COL.x0 + (SPLIT.start - COL.x0) * land,
    x1: COL.x1 + (Math.max(f.t, SPLIT.start + 0.05) - COL.x1) * land,
  };
}

const pctOf = (m: LaunchMath, usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;

export interface SceneProps {
  m: LaunchMath;
  frame: StoryFrame;
  cam: Camera;
  /** The card's measured size and the plot box inside it. */
  g: FilmGeometry;
  /** Reduced-motion still card. */
  still?: boolean;
}

export function Scene({ m, frame: f, cam, g, still = false }: SceneProps) {
  const w = cam.x1 - cam.x0;
  const h = cam.y1 - cam.y0;
  const px = (t: number) => ((t - cam.x0) / w) * 100;
  const py = (v: number) => ((cam.y1 - v) / h) * 100;
  const close = closeness(cam);
  const at = (k: StoryFrame["beat"]) => f.beat === k;
  const bp = f.beatProgress;

  const ticks = niceTicks(cam.y0, cam.y1, g.compact ? 3 : 4);
  const current = BEATS[f.beatIndex]!;

  // Floor: revealed during the split, then a staircase (always from the engine's events).
  const steps = f.floorSteps as Pt[];
  const hasFloor = steps.length > 1;
  // During the split the slab and staircase take over from the landed floor block (own timing, see HANDOVER).
  const floorOpacity = hasFloor ? (at("split") ? ramp(bp, HANDOVER[0], HANDOVER[1]) : f.floorReveal) : 0;
  const stepD = hasFloor ? stepPathD(steps, scales) : "";
  const lastT = hasFloor ? steps[steps.length - 1]![0] : 0;
  // The slab stands on $0 (the same base as the raise column), not past the card's edge.
  const slabD = hasFloor ? `${stepD} L${X(lastT)} ${Y(0)} L${X(steps[0]![0])} ${Y(0)} Z` : "";

  const arbOpacity = f.arbLine100 === null ? 0 : at("bounce") ? ramp(bp, 0, 0.2) : 1;
  const arbD = hasFloor && f.arbLine100 !== null ? stepPathD(steps, scales, m.arbLineRatio) : "";
  const stripD =
    hasFloor && f.arbLine100 !== null
      ? `${stepD} ${[...steps]
          .reverse()
          .map(([t, v]) => `L${X(t)} ${Y(v * m.arbLineRatio)}`)
          .join(" ")} Z`
      : "";

  const arbSlabD = arbD ? `${arbD} L${X(lastT)} ${Y(0)} L${X(steps[0]![0])} ${Y(0)} Z` : "";

  const harvests = f.events.filter((e) => e.kind === "harvest");
  const lastFee = harvests[harvests.length - 1];
  const feesOpacity = f.feesPct === null || !lastFee ? 0 : at("steps") ? ramp(bp, 0.45, 0.9) : at("bounce") ? 1 - ramp(bp, 0, 0.25) : 0;
  const peakOpacity = f.t >= f.peak.t ? (at("pump") ? 1 : 1 - close) : 0;
  // The bounce marker appears as the head climbs off the dip, so the two dots never sit on each other.
  const bounceIn = f.dip ? ramp((f.t - f.dip.t) / w, 0.008, 0.03) : 0;
  const bounceLabelOpacity = bounceIn * (at("exits") ? 1 - ramp(bp, 0.25, 0.45) : at("redeem") ? 0 : 1);

  const redeemNet = f.floorNet100 ?? 0;
  const redeemDrop = f.redeemProgress > 0 ? easeInOut(f.redeemProgress) : 0;
  const redeemDotV = f.valueOf100 + (redeemNet - f.valueOf100) * redeemDrop;

  // The floor and arbitrage labels hug the left edge of the view (or the staircase's start). Both move
  // continuously with the camera: the floor label lifts smoothly over the risers its width covers, so
  // no riser runs through it, and the arbitrage label hangs under its line, which only climbs to the right.
  const labelT = hasFloor ? Math.max(steps[0]![0], cam.x0 + 0.02 * w) : 0;
  const floorLabelX = hasFloor ? Math.max(px(labelT), 2) : 0;
  const floorLabelV = hasFloor ? liftedFloor(steps, labelT, 0.11 * w, 0.05 * w) : 0;
  const arbLabelV = hasFloor ? easedFloor(steps, labelT, 0.05 * w) * m.arbLineRatio : 0;
  // It hangs under its line, but never into the supply lane under the plot.
  const plotHpx = Math.max(1, g.H - g.pt - g.pb);
  const arbLabelMaxY = ((g.laneTop - 30 - g.pt) / plotHpx) * 100;
  const arbLabelOpacity = arbOpacity * (at("redeem") ? 1 - ramp(f.redeemProgress, 0, 0.4) : 1);
  // Any made-up price path on screen carries the label (steps and redeem too, not only the engine's illustrative beats).
  const pathShown = f.priceOpacity > 0 && f.path.length > 1 && f.beatIndex >= 2;
  const pill =
    at("pump") || at("selloff") ? CHART_COPY.traded(storyTradedUsd(m)) : f.illustrative || pathShown ? ILLUSTRATION : undefined;
  // The price fades out above the frame, so off-shot spikes never run under the chips.
  const maskId = `v36-top-${useId().replace(/:/g, "")}`;
  const scaleOpacity = ramp(close, 0.05, 0.6);
  const plotStyle = {
    "--pt": `${g.pt}px`,
    "--pr": `${g.pr}px`,
    "--pb": `${g.pb}px`,
    "--pl": `${g.pl}px`,
    ...(still ? { height: "100%" } : null),
  } as CSSProperties;

  return (
    <BrandChartFrame
      size={still ? "still" : "stage"}
      inset="full"
      illustration={pill}
      scale={close > 0.05 ? "real" : null}
      scaleOpacity={scaleOpacity}
      className={`${styles.scene} ${still ? styles.sceneStill : ""}`}
      plotClassName={styles.plot}
      style={plotStyle}
      overlay={
        <FilmOverlay
          m={m}
          f={f}
          cam={cam}
          g={g}
          ticks={ticks}
        />
      }
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

        {/* The current section, lit faintly from edge to edge (v27's section bands). */}
        {current.end > current.start ? (
          <rect
            x={X(current.start)}
            y={Y(FAR_V[1])}
            width={X(current.end - current.start)}
            height={(FAR_V[1] - FAR_V[0]) * SY}
            style={{ fill: alpha(CHART.price, 0.035) }}
            data-part="section-band"
          />
        ) : null}
        {/* Section dividers: thin full-height rules; the steps moment (the camera's dive) is dashed mint. */}
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
              style={{ stroke: b.key === "steps" ? alpha(CHART.floor, 0.4) : CHART.grid }}
              strokeWidth={STROKE.grid}
              strokeDasharray={b.key === "steps" ? "2 4" : undefined}
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
        {f.beatIndex <= 2 && columnRest(f) > 0 ? <RaiseColumn m={m} f={f} /> : null}

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
      {f.beatIndex <= 1 && f.raisedUsd >= 1 ? (
        // Beside the column at the fill line ("Raised $8,210 of $10,000"); it stays under the $100 line.
        <At
          x={px(COL.x1)}
          y={py(Math.min(0.86 * COL.top, Math.max(0.06 * COL.top, (f.raisedUsd / m.raiseUsd) * COL.top)))}
          opacity={f.beatIndex === 0 ? 1 : 1 - ramp(bp, RAISED_OUT[0], RAISED_OUT[1])}
        >
          <span className={`${styles.splitLabel} ${styles.raised} tnum`} data-part="raise-label">
            {CHART_COPY.raised(f.raisedUsd)}
            <span className={styles.raisedOf}> of {formatUsdWhole(m.raiseUsd)}</span>
          </span>
        </At>
      ) : null}
      {f.beatIndex >= 1 && f.beatIndex <= 2 ? <SplitLabels m={m} f={f} px={px} py={py} /> : null}
      {hasFloor && floorOpacity > 0 && !at("split") ? (
        <At x={floorLabelX} y={py(floorLabelV)} opacity={at("pump") ? ramp(bp, 0.04, 0.14) : floorOpacity}>
          <span className={`${styles.label} ${styles.floorLabel}`} data-part="floor-label">
            {CHART_COPY.floor}
          </span>
        </At>
      ) : null}
      {f.arbLine100 !== null && hasFloor ? (
        <>
          {/* Under the line on the left tread, clear of the head and the dip (the price never runs there). */}
          <At x={floorLabelX} y={Math.min(py(arbLabelV), arbLabelMaxY)} opacity={arbLabelOpacity}>
            <span className={`${styles.label} ${styles.arbLabelLeft}`} data-part="arb-label">
              {CHART_COPY.arbLine}
            </span>
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
          <Dot x={px(f.dip.t)} y={py(f.dip.value)} className={styles.bounceDot} opacity={bounceIn} part="bounce" />
          <At x={px(f.dip.t)} y={py(f.dip.value)} opacity={bounceLabelOpacity}>
            <span className={`${styles.label} ${styles.bounce}`}>{CHART_COPY.bounce}</span>
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

/** Raise column (world units): fills during the presale; in the split it divides, and the floor part lands on the slab. */
function RaiseColumn({ m, f }: { m: LaunchMath; f: StoryFrame }) {
  const width = X(COL.x1 - COL.x0);
  const outline = (
    <rect
      x={X(COL.x0)}
      y={Y(COL.top)}
      width={width}
      height={COL.top * SY}
      {...ns}
      style={{ stroke: alpha(CHART.axis, 0.45) }}
      strokeWidth={1}
      strokeDasharray={DASH.guide}
    />
  );
  if (f.beatIndex === 0) {
    const fill = (f.raisedUsd / m.raiseUsd) * COL.top;
    return (
      <g>
        {/* The empty column is an outline on a faint sky track; the raise fills it in presale sky. */}
        <rect x={X(COL.x0)} y={Y(COL.top)} width={width} height={COL.top * SY} style={{ fill: alpha(CHART.presaleFill, 0.08) }} />
        {outline}
        <rect x={X(COL.x0)} y={Y(fill)} width={width} height={fill * SY} style={{ fill: PRESALE_FILL }} data-part="raise-fill" />
        {fill > 0 ? <line x1={X(COL.x0)} x2={X(COL.x1)} y1={Y(fill)} y2={Y(fill)} {...ns} style={{ stroke: CHART.presaleFill }} strokeWidth={2} /> : null}
      </g>
    );
  }
  const rest = columnRest(f);
  const blk = floorBlock(m, f);
  const bp = splitBp(f);
  // Solid mint while it travels; once landed it settles to a strong mint wash over the slab (the
  // staircase line takes over its top edge), then fades with the column early in the pump.
  const blockOpacity = f.beatIndex === 1 ? 1 - 0.62 * ramp(bp, HANDOVER[0] + 0.04, HANDOVER[1]) : 0.38 * rest;
  return (
    <g data-part="split-column">
      <g opacity={rest}>
        {outline}
        {columnSegments(m)
          .slice(1)
          .map((s) => {
            // The column divides: gaps open between the segments.
            const lo = s.from * COL.top + blk.gap / 2;
            const hi = s.to * COL.top - blk.gap / 2;
            // Each share takes its colour over the presale fill (laid on top, not crossfaded), so the
            // column the presale filled is the same column that divides: no jump at the beat boundary.
            const tint = tintOf(f, s.key === "market" ? "market" : "fees");
            const rect = { x: X(COL.x0), y: Y(hi), width, height: Math.max(0, (hi - lo) * SY) };
            return (
              <g key={s.key}>
                {tint < 1 ? <rect {...rect} style={{ fill: PRESALE_FILL }} /> : null}
                <rect {...rect} style={{ fill: SEG_FILL[s.key as keyof typeof SEG_FILL] }} opacity={tint} data-part={`split-${s.key}`} />
              </g>
            );
          })}
      </g>
      {blockOpacity > 0 ? (
        <g opacity={blockOpacity}>
          {tintOf(f, "floor") < 1 ? (
            <rect x={X(blk.x0)} y={Y(blk.top)} width={X(Math.max(0, blk.x1 - blk.x0))} height={Math.max(0, blk.top - blk.bottom) * SY} style={{ fill: PRESALE_FILL }} />
          ) : null}
          <rect
            x={X(blk.x0)}
            y={Y(blk.top)}
            width={X(Math.max(0, blk.x1 - blk.x0))}
            height={Math.max(0, blk.top - blk.bottom) * SY}
            style={{ fill: CHART.floor }}
            opacity={tintOf(f, "floor")}
            data-part="split-floor"
          />
        </g>
      ) : null}
    </g>
  );
}

/** Direct labels on the split column: name and percent, in the segment's colour, beside it. */
function SplitLabels({ m, f, px, py }: { m: LaunchMath; f: StoryFrame; px: (t: number) => number; py: (v: number) => number }) {
  const segs = columnSegments(m);
  const bp = splitBp(f);
  const rest = columnRest(f);
  const blk = floorBlock(m, f);
  const inn = (a: number) => (f.beatIndex === 1 ? ramp(bp, a, a + 0.12) : 1);
  const x = px(COL.x1);
  const fees = segs[2]!;
  const platform = segs[3]!;
  const floorO = f.beat === "pump" ? 1 - ramp(f.beatProgress, 0, 0.1) : inn(TINT.floor[0] + 0.04);
  return (
    <>
      {/* The floor's label rides on the block, at its right edge and vertical middle. */}
      <At x={px(blk.x1)} y={py((blk.top + blk.bottom) / 2)} opacity={floorO}>
        {/* No per-$100 figure here: the "Floor pays back" tooltip already carries the floor's value. */}
        <span className={`${styles.splitLabel} ${styles.splitFloor} tnum`} data-part="split-label-floor">
          {CHART_COPY.floorShare(Math.round(m.v * 100))}
        </span>
      </At>
      <At x={x} y={py(((segs[1]!.from + segs[1]!.to) / 2) * COL.top)} opacity={inn(TINT.market[0] + 0.04) * rest}>
        <span className={`${styles.splitLabel} ${styles.splitMarket} tnum`} data-part="split-label-market">
          {CHART_COPY.market} {pctOf(m, m.split.poolUsd)}%
        </span>
      </At>
      <At x={x} y={py(((fees.from + platform.to) / 2) * COL.top)} opacity={inn(TINT.fees[0] + 0.04) * rest}>
        <span className={`${styles.splitLabel} ${styles.splitFees} tnum`} data-part="split-label-fees">
          Fees {CHART_COPY.fees(pctOf(m, m.split.creatorUsd), pctOf(m, m.split.platformUsd))}
        </span>
      </At>
    </>
  );
}

/**
 * The height a label of width `span` (story time) starting at t must sit at to clear the staircase:
 * the floor at t plus every riser it covers. A riser just past its right end counts in part (over
 * `fade`), so the label rises smoothly as the camera pans instead of jumping a step.
 */
export function liftedFloor(steps: ReadonlyArray<Pt>, t: number, span: number, fade: number): number {
  let v = floorAtT(steps, t);
  for (let i = 1; i < steps.length; i++) {
    const [rt, rv] = steps[i]!;
    const rise = rv - steps[i - 1]![1];
    if (rt <= t || !(rise > 0)) continue;
    v += rise * Math.min(1, Math.max(0, (t + span + fade - rt) / fade));
  }
  return v;
}

/**
 * The floor at t for a label hanging under the line: a riser the left edge has just passed counts in
 * part (over `fade`), so the label eases up a step instead of jumping. It never rises above the line.
 */
export function easedFloor(steps: ReadonlyArray<Pt>, t: number, fade: number): number {
  let v = floorAtT(steps, t);
  for (let i = 1; i < steps.length; i++) {
    const [rt, rv] = steps[i]!;
    const rise = rv - steps[i - 1]![1];
    if (rt > t || rt <= t - fade || !(rise > 0)) continue;
    v -= rise * (1 - (t - rt) / fade);
  }
  return v;
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

/** "$36" or "$36.50": y-axis labels at the card's right edge. */
function tickText(ticks: readonly number[], v: number): string {
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  return Number.isInteger(step) && Number.isInteger(v) ? formatUsdWhole(v) : formatUsdCents(v);
}

/**
 * The card-pixel layer over the plot (v27's chart language): the section strip under the chip row,
 * the y labels at the right edge, the supply lane at the bottom with the burn markers over it, and the
 * three tooltips riding the price head.
 */
function FilmOverlay({
  m,
  f,
  cam,
  g,
  ticks,
}: {
  m: LaunchMath;
  f: StoryFrame;
  cam: Camera;
  g: FilmGeometry;
  ticks: readonly number[];
}) {
  const { W, H, compact } = g;
  const plotW = Math.max(1, W - g.pl - g.pr);
  const plotH = Math.max(1, H - g.pt - g.pb);
  const cx = (t: number) => g.pl + ((t - cam.x0) / (cam.x1 - cam.x0)) * plotW;
  const cy = (v: number) => g.pt + ((cam.y1 - v) / (cam.y1 - cam.y0)) * plotH;
  const stripTop = g.chip;
  const stripBot = g.chip + g.strip;
  const stripMid = stripTop + g.strip / 2;
  const strip = stripLayout(cx, W, compact, f.beatIndex);

  /* ---- supply: the lane's step line, the burns, the third tooltip (all from listing on) ---- */
  const lane = supplyLane(m, f);
  const burns = burnMarks(m, f);
  const sup = supplyTag(m, f);
  const laneBot = g.laneTop + g.laneH;
  const ly = (share: number) => laneBot - share * g.laneH;
  // The lane's band comes in with the pump (trading opens), over the slab running past the plot.
  const laneIn = f.beat === "pump" ? ramp(f.beatProgress, 0, 0.06) : 1;

  /* ---- tooltips: right of the head, so the head dot and the bounce (always left of it) stay clear ---- */
  const headX = cx(f.t);
  const priceY = Math.min(H - 4, Math.max(stripBot + 4, cy(f.valueOf100)));
  const floorY = f.floor100 !== null ? Math.min(H - 4, Math.max(stripBot + 4, cy(f.floor100))) : null;
  const { now, floor } = tileValues(f);
  const showFloorTag = floor !== "—" && floorY !== null;
  // Both numeric: the larger number takes the upper tooltip, whatever the lines' order.
  const priceOnTop = now !== TILE_REDEEMED && f.floorNet100 !== null ? f.valueOf100 >= f.floorNet100 : undefined;
  const change = sinceListing(m, f);
  const priceH = change.now !== null ? g.tagH1 : g.tagH0;
  const floorH = change.floor !== null ? g.tagH1 : g.tagH0;
  const supplyH = g.tagH1;
  const colTop = stripBot + 8;
  const colBot = H - 10;
  // The supply tooltip takes the bottom of the column, as close to the lane as the others allow.
  const tags = layoutTags(
    priceY,
    showFloorTag ? floorY : null,
    Math.max(priceH, showFloorTag ? floorH : 0),
    colTop,
    sup ? colBot - supplyH - 6 : colBot,
    6,
    priceOnTop,
  );
  const tagX = Math.min(headX + g.tagGap, W - (compact ? 6 : 8) - g.tagW);
  // As you redeem, the price tag flips from white to a midnight chip over a short stretch of scroll
  // (a slow crossfade would pass through grey on grey).
  const muted = ramp(f.redeemProgress, 0.5, 0.56);
  const tagBoxes = [
    { y: tags.price, h: priceH },
    ...(showFloorTag && tags.floor !== null ? [{ y: tags.floor, h: floorH }] : []),
  ];
  const tagsBottom = Math.max(...tagBoxes.map((b) => b.y + b.h / 2));
  const supplyY = sup ? Math.min(colBot - supplyH / 2, Math.max(tagsBottom + 6 + supplyH / 2, g.laneTop + g.laneH / 2)) : null;
  if (supplyY !== null) tagBoxes.push({ y: supplyY, h: supplyH });

  /* ---- y labels at the right edge; one a tooltip would cover fades out ---- */
  const tickX = W - (compact ? 8 : 14);
  const tickW = (text: string) => text.length * (compact ? 6.4 : 7.4);
  const coverFade = (y: number, text: string) => {
    if (tagX + g.tagW < tickX - tickW(text) - 4) return 1;
    const d = Math.min(...tagBoxes.map((b) => Math.abs(y - b.y) - b.h / 2));
    return ramp(d, 4, 14);
  };
  const tickOpacity = (y: number, text: string) => (y < stripBot + 10 || y > g.laneTop - 14 ? 0 : coverFade(y, text));

  /* ---- burn labels in the lane, right-aligned to their step; the lane's name yields to them ---- */
  const charW = compact ? 6.1 : 6.9;
  const nameX = compact ? 8 : 14;
  const nameRight = nameX + (compact ? 34 : 44);
  const burnLabels = burns.map((b) => {
    const x = cx(b.t) - (compact ? 5 : 8);
    const w = compact ? Math.max(b.supplyText.length, b.floorText.length) * charW : (b.supplyText.length + b.floorText.length + 3) * charW;
    // Fades before it would run off the card's left edge.
    return { b, x, left: x - w, opacity: b.labelOpacity * ramp(x - w, 4, 14) };
  });
  const nameOpacity = Math.min(1, ...burnLabels.filter((l) => l.opacity > 0.02).map((l) => ramp(l.left - nameRight, 4, 16)));

  return (
    <svg className={`${styles.overlaySvg} ${compact ? "" : styles.wide}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      {/* Y labels. */}
      {ticks.map((v) => {
        const y = cy(v);
        const text = tickText(ticks, v);
        const o = tickOpacity(y, text);
        return o > 0.01 ? (
          <text key={v} x={tickX} y={y + 4} textAnchor="end" opacity={o} className={styles.tick}>
            {text}
          </text>
        ) : null;
      })}

      {/* The strip: an opaque head band (lines fade out under it), the current section lit, dividers. */}
      <rect x={0} y={0} width={W} height={stripBot} style={{ fill: CHART.bg }} />
      {strip.band ? <rect x={strip.band.x0} y={stripTop} width={Math.max(0, strip.band.x1 - strip.band.x0)} height={g.strip} className={styles.stripBand} /> : null}
      <line x1={0} x2={W} y1={stripBot - 0.5} y2={stripBot - 0.5} className={styles.stripRule} />
      {strip.dividers.map((d) => (
        <line key={d.x} x1={d.x} x2={d.x} y1={stripTop} y2={stripBot} className={d.zoom ? styles.dividerZoom : styles.divider} />
      ))}
      {strip.band ? (
        <rect
          x={strip.band.x0}
          y={stripBot - 2}
          width={Math.max(0, Math.min(headX, strip.band.x1) - strip.band.x0)}
          height={2}
          rx={1}
          className={styles.stripProg}
          data-part="section-progress"
        />
      ) : null}
      {strip.diamond && strip.diamond.opacity > 0.01 ? (
        <path
          opacity={strip.diamond.opacity}
          d={`M${strip.diamond.x} ${stripMid - 5}l5 5l-5 5l-5 -5Z`}
          className={`${styles.diamond} ${styles[strip.diamond.state]}`}
        />
      ) : null}
      {strip.labels.map((l) =>
        l.opacity > 0.02 ? (
          <text
            key={l.key}
            opacity={l.opacity}
            x={l.x}
            y={stripMid + (compact ? 4.5 : 5.5)}
            textAnchor={l.anchor === "end" ? "end" : undefined}
            className={`${styles.sectionLabel} ${styles[l.state]}`}
            data-part="section-label"
            data-beat={l.key}
            data-state={l.state}
          >
            <tspan className={styles.sectionNum}>{l.num}</tspan>
            {l.name ? ` ${l.name}` : null}
          </text>
        ) : null,
      )}

      {/* The supply lane: an opaque band under the plot (the slab runs past it), 0–100% of the listing supply. */}
      {lane ? (
        <g opacity={laneIn} data-part="supply-lane">
          <rect x={0} y={g.laneTop - 8} width={W} height={H - g.laneTop + 8} style={{ fill: CHART.bg }} />
          <line x1={0} x2={W} y1={g.laneTop - 7.5} y2={g.laneTop - 7.5} className={styles.stripRule} />
          <line x1={0} x2={W} y1={g.laneTop + 0.5} y2={g.laneTop + 0.5} className={styles.laneRef} />
          <path
            d={`${lanePathD(lane, cx, ly)} L${cx(lane[lane.length - 1]![0])} ${laneBot} L${cx(lane[0]![0])} ${laneBot} Z`}
            className={styles.laneArea}
          />
          <path d={lanePathD(lane, cx, ly)} className={styles.laneLine} data-part="supply-line" />
          <text x={nameX} y={g.laneTop + (compact ? 11 : 15)} className={styles.laneName} opacity={nameOpacity} data-part="supply-name">
            Supply
          </text>
          {coverFade(g.laneTop, "100%") > 0.01 ? (
            <text x={tickX} y={g.laneTop + 4} textAnchor="end" opacity={coverFade(g.laneTop, "100%")} className={styles.tick} data-part="supply-tick">
              100%
            </text>
          ) : null}
          {burnLabels.map(({ b, x, opacity }) =>
            opacity > 0.02 ? (
              <BurnLabel key={b.t} b={b} x={x} y={g.laneTop} h={g.laneH} compact={compact} opacity={opacity} />
            ) : null,
          )}
        </g>
      ) : null}

      {/* Burn markers on the floor line, each tied to its step in the lane below. */}
      {burns.map((b) => {
        const x = cx(b.t);
        const y = cy(b.floor);
        const r = b.small ? (compact ? 6 : 7) : compact ? 8 : 10;
        return (
          <g key={b.t} opacity={b.opacity} data-part="burn-mark" data-small={b.small ? "" : undefined}>
            <line x1={x} x2={x} y1={y + r + 2} y2={g.laneTop - 8} className={styles.burnLeader} />
            <circle cx={x} cy={y} r={r} className={styles.burnRing} />
            <path d={FLAME} transform={`translate(${x} ${y}) scale(${r / 10})`} className={styles.burnFlame} />
          </g>
        );
      })}

      {/* Tooltips riding the price head. */}
      {sup && supplyY !== null && lane ? (
        <g opacity={laneIn} data-part="tag-supply">
          <circle cx={headX} cy={ly(sup.share)} r={3.5} className={styles.laneDot} />
          <path d={`M${headX + 4} ${ly(sup.share)}L${tagX} ${supplyY}`} className={styles.connIris} />
          <TagBody x={tagX} cy={supplyY} w={g.tagW} h={supplyH} compact={compact} tone="supply" label={TILE_SUPPLY} value={sup.value} pct={sup.pct} part="supply" />
        </g>
      ) : null}
      {showFloorTag && floorY !== null && tags.floor !== null ? (
        <g opacity={f.floorReveal} data-part="tag-floor">
          <circle cx={headX} cy={floorY} r={4.5} className={styles.floorDot} />
          <path d={`M${headX + 5} ${floorY}L${tagX} ${tags.floor}`} className={styles.connMint} />
          <TagBody x={tagX} cy={tags.floor} w={g.tagW} h={floorH} compact={compact} tone="floor" label={TILE_FLOOR} value={floor} pct={change.floor} part="floor" />
        </g>
      ) : null}
      {/* The connector fades with the price line as you redeem; the tag itself never dims. */}
      <path d={`M${headX + 8} ${priceY}L${tagX} ${tags.price}`} className={styles.connWhite} opacity={f.priceOpacity} />
      <g data-part="tag-price" data-muted={muted >= 0.5 ? "" : undefined}>
        {/* Redeemed: a midnight-chip tag with white text under the white one, which fades out. */}
        {muted > 0 ? (
          <TagBody x={tagX} cy={tags.price} w={g.tagW} h={priceH} compact={compact} tone="muted" label={TILE_NOW} value={now} pct={change.now} part={muted >= 0.5 ? "now" : null} />
        ) : null}
        {muted < 1 ? (
          <g opacity={1 - muted}>
            <TagBody x={tagX} cy={tags.price} w={g.tagW} h={priceH} compact={compact} tone="price" label={TILE_NOW} value={now} pct={change.now} part={muted < 0.5 ? "now" : null} />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

/** A small flame, centred on (0, 0), about 13px tall at scale 1 (it fills a 10px-radius ring). */
const FLAME =
  "M0 -6.5C2.6 -4 4.6 -1.6 4.6 1.4C4.6 4.2 2.6 6 0 6C-2.6 6 -4.6 4.2 -4.6 1.6C-4.6 -0.6 -3.2 -2 -2.2 -3.6C-1.8 -2 -1 -1 0.2 -0.8C0.6 -2.6 0.5 -4.6 0 -6.5Z";

/** The lane's step line through its corners (card px). */
function lanePathD(pts: ReadonlyArray<readonly [number, number]>, cx: (t: number) => number, ly: (s: number) => number): string {
  return pts.map(([t, s], i) => `${i === 0 ? "M" : "L"}${cx(t)} ${ly(s)}`).join(" ");
}

/** A burn's label in the lane, right-aligned to its step: the supply drop, then the small floor step. */
function BurnLabel({ b, x, y, h, compact, opacity }: { b: BurnMark; x: number; y: number; h: number; compact: boolean; opacity: number }) {
  if (compact) {
    return (
      <g opacity={opacity} data-part="burn-label">
        <text x={x} y={y + h / 2 - 1.5} textAnchor="end" className={styles.burnText}>
          <tspan className={styles.burnSupply}>{b.supplyText}</tspan>
        </text>
        <text x={x} y={y + h / 2 + 10} textAnchor="end" className={styles.burnText}>
          <tspan className={styles.burnFloor}>{b.floorText}</tspan>
        </text>
      </g>
    );
  }
  return (
    <text x={x} y={y + h / 2 + 4.5} textAnchor="end" opacity={opacity} className={styles.burnText} data-part="burn-label">
      <tspan className={styles.burnSupply}>{b.supplyText}</tspan>
      <tspan className={styles.burnArrow}> → </tspan>
      <tspan className={styles.burnFloor}>{b.floorText}</tspan>
    </text>
  );
}

const TAG_FILL = { price: styles.tagPrice, floor: styles.tagFloor, muted: styles.tagChip, supply: styles.tagSupply } as const;

/**
 * One tooltip (v27's tag): label, value and, once trading opens, the change since listing under the
 * value. The floor's change reads in the floor colour; the price's is floor green up, coral down.
 */
function TagBody({
  x,
  cy,
  w,
  h,
  compact,
  tone,
  label,
  value,
  pct,
  part,
}: {
  x: number;
  cy: number;
  w: number;
  h: number;
  compact: boolean;
  tone: "price" | "floor" | "muted" | "supply";
  label: string;
  value: string;
  pct: number | null;
  /** The data-part suffix; null for the hidden half of a crossfade (so tests and tools see one tag). */
  part: "now" | "floor" | "supply" | null;
}) {
  const y0 = cy - h / 2;
  const pctClass =
    tone === "floor" ? styles.pctFloor : tone === "supply" ? styles.pctSupply : pct !== null && pct < 0 ? styles.pctDown : styles.pctUp;
  const tx = x + (compact ? 8 : 10);
  return (
    <g className={tone === "muted" ? styles.tagMuted : tone === "supply" ? styles.tagSupplyTone : undefined}>
      <rect x={x} y={y0} width={w} height={h} rx={compact ? 8 : 10} className={TAG_FILL[tone]} />
      <text x={tx} y={y0 + (compact ? 11.5 : 17)} className={styles.tagLabel}>
        {label}
      </text>
      <text x={tx} y={y0 + (compact ? 26 : 39)} className={styles.tagValue} data-part={part ? `tile-${part}` : undefined}>
        {value}
      </text>
      {pct !== null && Number.isFinite(pct) ? (
        <text data-part={part ? `pct-${part}` : undefined} x={tx} y={y0 + (compact ? 37.5 : 59)} className={styles.tagPct}>
          <tspan className={pctClass}>{formatPctChange(pct)}</tspan>
          <tspan className={styles.tagPctSuffix}> {SINCE_LISTING}</tspan>
        </text>
      ) : null}
    </g>
  );
}
