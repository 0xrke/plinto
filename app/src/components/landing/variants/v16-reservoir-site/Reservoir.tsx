"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  BrandChartFrame,
  BrandTiles,
  CHART,
  CHART_COPY,
  DASH,
  ILLUSTRATION,
  LIGHT,
  STORY_POS_END,
  STROKE,
  alpha,
  formatUsdCents,
  formatUsdWhole,
  storyFrame,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { areaPath, clamp01, dollarScale, linePath, niceTicks, scaledStepsFrom, surfacePath, tankBox, tankOutline, textWidth, timeScale, waterPath } from "./geometry";
import styles from "./reservoir.module.css";

/*
 * Reservoir, site style: the floor vault as a tank of SPYx, drawn inside the site's midnight chart
 * card. The water level IS the floor per $100 (gross), on the story camera's dollar scale (frame.y).
 * The glass doubles as a chart: story time runs left to right, so every level the water has held
 * stays etched on the glass as a mint staircase, and the price (a white buoy) leaves its trail. The
 * buoy rises in the pump, sinks in the selloff, comes down onto the dashed rose arbitrage line (its
 * own staircase, just under the surface) and turns up; a marker stays at the dip. Fees drip in from
 * a spout, holders drain out through a tap. Under the card: the site's two tiles. The light strip with
 * the floor staircase over the whole story at a fixed close-up dollar band (true dollars) is its own
 * component (FloorStrip), placed by the variant beside the captions.
 *
 * Everything is a pure function of the frame (scroll position): no timers, no loops, no idle motion.
 */

type Ev = StoryFrame["events"][number];

interface Fixed {
  /** Every floor event of the story (from the finished frame). */
  events: Ev[];
  /** Story time at the start of the bounce beat (the arbitrage line appears) and at the end. */
  bounceT: number;
  endT: number;
  /** Strip band: the floor's whole range plus the dip, padded. True dollars, cropped. */
  strip: { min: number; max: number };
  floorPct: number;
  marketPct: number;
}

const fixedCache = new WeakMap<VariantProps["m"], Fixed>();

function fixedFor(m: VariantProps["m"]): Fixed {
  let f = fixedCache.get(m);
  if (!f) {
    const end = storyFrame(m, STORY_POS_END);
    const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 100);
    const lo = Math.min(m.floorPer100GrossUsd, end.dip?.value ?? Infinity, end.arbLine100 ?? Infinity);
    const hi = end.floor100 ?? m.floorPer100GrossUsd;
    const pad = Math.max(0.05, (hi - lo) * 0.18);
    f = {
      events: end.events,
      bounceT: storyFrame(m, 5).t,
      endT: end.t,
      strip: { min: lo - pad, max: hi + pad },
      floorPct: pct(m.split.floorUsd),
      marketPct: pct(m.split.poolUsd),
    };
    fixedCache.set(m, f);
  }
  return f;
}

/** Story-time windows for drips (before a harvest) and ripples (after any event). */
const DRIP_T = 0.32;
const RIPPLE_T = 0.4;

/** Rounds to 0.01 so server and client markup match. */
const r2 = (x: number): number => Math.round(x * 100) / 100;

const DEFAULT_SIZE = { w: 560, h: 420 };

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** The sticky stage (or a still): the tank card and the two tiles. */
export function Reservoir({ m, frame, still = false }: VariantProps & { frame: StoryFrame; still?: boolean }) {
  const [ref, size] = useSize<HTMLDivElement>();
  // The made-up price path is on the glass from the pump on: keep the pill (muted once numbers are real).
  const madeUp = frame.illustrative || frame.beatIndex >= 2;
  return (
    <div className={still ? styles.stillReservoir : styles.reservoir}>
      <BrandChartFrame
        inset="full"
        size={still ? "still" : "stage"}
        style={still ? { height: "var(--rv-still-h)" } : undefined}
        className={styles.tankCard}
        illustration={madeUp ? ILLUSTRATION : false}
        illustrationLive={frame.illustrative}
        scale={frame.zoom > 0.5 ? "real" : null}
        scaleOpacity={frame.zoom}
      >
        <div ref={ref} className={styles.tankWrap}>
          <Tank m={m} frame={frame} w={size.w} h={size.h} />
        </div>
      </BrandChartFrame>
      <BrandTiles frame={frame} />
    </div>
  );
}

/* ---------------------------------------------------------------- labels */

/** A raised value chip on midnight (the landing's "$40.28" chip). */
function Chip({ x, y, text, fs, color = CHART.price, anchor = "start", opacity = 1, part }: { x: number; y: number; text: string; fs: number; color?: string; anchor?: "start" | "middle" | "end"; opacity?: number; part?: string }) {
  const w = textWidth(text, fs) + 16;
  const h = 22;
  const left = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
  return (
    <g opacity={opacity} data-part={part}>
      <rect x={r2(left)} y={r2(y - h / 2)} width={r2(w)} height={h} rx={h / 2} style={{ fill: CHART.raised }} />
      <text x={r2(left + w / 2)} y={r2(y + fs * 0.36)} textAnchor="middle" fontSize={fs} className={styles.label} style={{ fill: color }}>
        {text}
      </text>
    </g>
  );
}

/** A bare chart label (the landing's "Floor", "Arbitrage line", "Bounce"). */
function Label({ x, y, text, fs, color, anchor = "start", opacity = 1, part }: { x: number; y: number; text: string; fs: number; color: string; anchor?: "start" | "middle" | "end"; opacity?: number; part?: string }) {
  return (
    <text x={r2(x)} y={r2(y)} textAnchor={anchor} fontSize={fs} opacity={opacity} className={styles.label} style={{ fill: color }} data-part={part}>
      {text}
    </text>
  );
}

/* ---------------------------------------------------------------- tank */

/** Closed band between an upper and a lower staircase over the same time span. */
function stripPath(upper: Array<[number, number]>, lower: Array<[number, number]>, sx: (t: number) => number, sy: (v: number) => number): string {
  if (upper.length < 2 || lower.length < 2) return "";
  const back = lower
    .slice()
    .reverse()
    .map(([pt, v]) => `L${sx(pt).toFixed(2)} ${sy(v).toFixed(2)}`)
    .join(" ");
  return `${linePath(upper, sx, sy)} ${back} Z`;
}

function Tank({ m, frame, w, h }: VariantProps & { frame: StoryFrame; w: number; h: number }) {
  const uid = useId().replace(/:/g, "");
  const fx = fixedFor(m);
  const b = tankBox(w, h);
  const y = dollarScale(frame.y, b.top, b.bottom);
  const sx = timeScale(fx.endT, b.tx0, b.tx1);
  const t = frame.t;
  const tw = b.x1 - b.x0;
  const fs = b.narrow ? 11 : 11.5;
  const axisFs = b.narrow ? 10.5 : 11;

  // Water: the floor, poured in during the split. Flat and still, like the site's slabs.
  const hasFloor = frame.floor100 !== null && frame.floorReveal > 0;
  const level = hasFloor ? frame.y.min + (frame.floor100! - frame.y.min) * frame.floorReveal : frame.y.min;
  const surface = Math.min(b.bottom, Math.max(b.top, y(level)));
  const depth = b.bottom - surface;
  const settled = hasFloor && frame.floorReveal >= 1;

  // Buoy (the price) at the current story time.
  const buoyX = sx(t);
  const buoyY = y(frame.valueOf100);
  const r = b.narrow ? 7 : 8.5;

  // Arbitrage line: its own staircase (floor × ratio) from the bounce beat on.
  const ratio = frame.arbLine100 !== null && frame.floor100 ? frame.arbLine100 / frame.floor100 : null;
  const arbPts = ratio !== null ? scaledStepsFrom(frame.floorSteps, ratio, fx.bounceT, t) : [];
  const dip = frame.dip;
  const atBounce = frame.beat === "bounce";
  const touching = dip !== null && atBounce && t >= dip.t - 0.12 && t <= dip.t + 0.45;

  const zoomed = frame.zoom > 0.5;
  const harvests = frame.events.filter((e) => e.kind === "harvest");
  const exitsEv = frame.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const feesY = y(m.floorPer100GrossUsd) + 22;
  // Labels take turns, as on the landing chart: fees in the steps beat, the bounce until the exits
  // take over, the exits until the redeem, the price chip until the redeem pays out.
  const bp = frame.beatProgress;
  const ramp = (x: number, a: number, z: number) => clamp01((x - a) / (z - a));
  const at = (k: StoryFrame["beat"]) => frame.beat === k;
  const feesOpacity = !zoomed || harvests.length === 0 || frame.feesPct === null ? 0 : at("steps") ? ramp(bp, 0.3, 0.7) * frame.zoom : at("bounce") ? 1 - ramp(bp, 0, 0.25) : 0;
  const exitsOpacity = !zoomed || !exitsEv || frame.exitsPct === null ? 0 : at("exits") ? ramp(bp, 0.5, 0.65) : at("redeem") ? 1 - ramp(frame.redeemProgress, 0, 0.3) : 0;
  const bounceLabelOpacity = at("exits") ? 1 - ramp(bp, 0.25, 0.45) : at("redeem") ? 0 : 1;
  // On phones the "Arbitrage line" chip makes room for the exits chip (the line itself stays).
  const arbLabelOpacity = !b.narrow ? 1 : at("exits") ? 1 - ramp(bp, 0.25, 0.45) : at("redeem") ? 0 : 1;
  const priceChipOpacity = at("redeem") ? 1 - ramp(frame.redeemProgress, 0, 0.5) : 1;

  // Fee spout over the right rim; drips for harvests coming up within DRIP_T.
  const spoutX = b.x1 - (b.narrow ? 26 : 34);
  const drips = fx.events.filter((e) => e.kind === "harvest" && e.t > t && e.t - t < DRIP_T);
  const ripples = frame.events.filter((e) => t - e.t >= 0 && t - e.t < RIPPLE_T);
  const showSpout = frame.beatIndex >= 2;

  // Tap: from the exits beat; flows around the holders' redemption and during redeem.
  const tapY = b.bottom - Math.min(34, (b.bottom - b.top) * 0.12);
  const showTap = frame.beatIndex >= 6;
  const holdersT = exitsEv?.t ?? fx.events.find((e) => e.kind === "redeem" && e.beat === "exits")?.t ?? Infinity;
  const exitFlow = (t >= holdersT - 0.18 && t <= holdersT + 0.3) || frame.redeemProgress > 0;

  // Gauge ticks on the camera scale.
  const ticks = niceTicks(frame.y.min, frame.y.max, b.narrow ? 4 : 5);

  // Raise bar: fills in the presale, splits in the split beat (sandbox legend colours).
  const raised = clamp01(frame.raisedUsd / m.raiseUsd);
  const sp = frame.splitProgress;
  const floorW = tw * (fx.floorPct / 100);
  const marketW = tw * (fx.marketPct / 100);
  const pouring = frame.beat === "split" && sp > 0.6 && frame.floorReveal < 1;
  const showBar = frame.beatIndex <= 1;
  const barH = 8;

  const clip = `rv16-clip-${uid}`;

  // Value chip: right of the buoy, flipped left near the wall; lifted over the water's labels.
  const priceText = formatUsdCents(frame.valueOf100);
  const priceW = textWidth(priceText, fs) + 16;
  const flip = buoyX + r + 10 + priceW > b.x1 - 6;
  const lift = settled && buoyY > surface - 30 && buoyY < surface + 0.14 * (b.bottom - b.top);
  const priceX = lift ? (flip ? buoyX + r : buoyX - r) : flip ? buoyX - r - 10 : buoyX + r + 10;
  const priceLabelY = lift ? Math.min(buoyY, surface) - r - 18 : buoyY < b.top + 14 ? buoyY + r + 16 : buoyY;
  // "+x% from exits" sits in the water, under the step it made, the arbitrage line and the dip, so it
  // never meets the price chip above the surface or covers the bounce.
  const exitsText = frame.exitsPct !== null ? CHART_COPY.fromExits(frame.exitsPct) : "";
  const exitsX = exitsEv ? sx(exitsEv.t) - 6 : 0;
  const exitsY = exitsEv ? Math.min(b.bottom - 16, Math.max(y(exitsEv.to * (ratio ?? 1)), dip !== null ? y(dip.value) + 12 : 0) + 20) : 0;

  const glassStroke = alpha(CHART.axis, 0.55);

  return (
    <svg width={w} height={h} className={styles.svg} role="presentation">
      <defs>
        <clipPath id={clip}>
          <path d={`${tankOutline(b.x0, b.x1, b.top - 4, b.bottom, 18)} Z`} />
        </clipPath>
      </defs>

      {/* raise bar */}
      {showBar ? (
        <g data-part="raise-bar">
          <rect x={b.x0} y={b.barY} width={tw} height={barH} rx={barH / 2} style={{ fill: CHART.grid }} />
          {sp <= 0 ? (
            <rect x={b.x0} y={b.barY} width={r2(tw * raised)} height={barH} rx={barH / 2} style={{ fill: CHART.presaleFill }} />
          ) : (
            <>
              <rect x={b.x0} y={b.barY} width={r2(floorW)} height={barH} rx={barH / 2} style={{ fill: CHART.floor }} />
              <rect x={r2(b.x0 + floorW + 3 * sp)} y={b.barY} width={r2(Math.max(0, marketW - 3 * sp))} height={barH} rx={barH / 2} style={{ fill: CHART.market }} opacity={sp} />
              <rect x={r2(b.x0 + floorW + marketW + 6 * sp)} y={b.barY} width={r2(Math.max(0, tw - floorW - marketW - 6 * sp))} height={barH} rx={barH / 2} style={{ fill: CHART.fees }} opacity={sp} />
            </>
          )}
          {sp <= 0.25 ? (
            <Label x={b.x0} y={b.barY - 8} text={CHART_COPY.raised(frame.raisedUsd)} fs={fs} color={CHART.label} />
          ) : (
            <g opacity={r2(clamp01((sp - 0.25) / 0.4))}>
              <Label x={b.x0} y={b.barY - 8} text={CHART_COPY.floorShare(fx.floorPct)} fs={fs} color={CHART.floor} />
              <Label x={b.x0 + floorW + 6} y={b.barY - 8} text={CHART_COPY.market} fs={fs} color={CHART.label} />
            </g>
          )}
        </g>
      ) : null}

      {/* pour from the floor share into the tank */}
      {pouring ? (
        <rect
          x={r2(b.x0 + floorW / 2 - 2.5)}
          y={b.barY + barH}
          width={5}
          height={r2(Math.max(0, surface - b.barY - barH))}
          rx={2.5}
          style={{ fill: CHART.floor }}
          opacity={r2(0.9 - 0.5 * frame.floorReveal)}
        />
      ) : null}

      {/* fee spout over the right rim */}
      {showSpout ? (
        <g>
          <path
            d={`M${spoutX + 22} ${b.top - 30} L${spoutX + 22} ${b.top - 18} Q${spoutX + 22} ${b.top - 8} ${spoutX + 12} ${b.top - 8} L${spoutX} ${b.top - 8}`}
            className={styles.pipe}
            style={{ stroke: glassStroke }}
          />
          <Label x={spoutX - 6} y={b.top - 4} anchor="end" text="LP fees in" fs={axisFs} color={CHART.axis} />
        </g>
      ) : null}

      {/* everything inside the glass */}
      <g clipPath={`url(#${clip})`}>
        <rect x={b.x0} y={b.top - 4} width={tw} height={b.bottom - b.top + 4} style={{ fill: alpha(CHART.price, 0.025) }} />

        {/* dollar grid on the glass */}
        {ticks.map((v) => {
          const ty = y(v);
          return ty > b.top && ty < b.bottom ? <line key={v} x1={b.x0} x2={b.x1} y1={r2(ty)} y2={r2(ty)} className={styles.hair} style={{ stroke: CHART.grid }} /> : null;
        })}

        {/* water: flat mint layers (denser in the deep half) under a surface that curls at the glass */}
        {hasFloor ? (
          <g data-part="water">
            <path d={waterPath(b.x0, b.x1, r2(surface), b.bottom + 4)} style={{ fill: alpha(CHART.floor, 0.18) }} />
            {depth > 24 ? <rect x={b.x0} y={r2(surface + depth * 0.5)} width={tw} height={r2(depth * 0.5 + 4)} style={{ fill: alpha(CHART.floor, 0.08) }} /> : null}
            <path d={surfacePath(b.x0, b.x1, r2(surface))} className={styles.surface} style={{ stroke: alpha(CHART.floor, 0.7) }} />
          </g>
        ) : null}

        {/* a flat highlight down the glass, near the left wall */}
        <rect x={b.x0 + 9} y={b.top + 12} width={b.narrow ? 5 : 7} height={r2((b.bottom - b.top) * 0.62)} rx={3.5} style={{ fill: alpha(CHART.price, 0.06) }} />

        {/* graduation notches on the right wall, at the gauge's dollar ticks */}
        {ticks.map((v) => {
          const ty = y(v);
          return ty > b.top + 4 && ty < b.bottom - 4 ? <line key={v} x1={b.x1 - 10} x2={b.x1} y1={r2(ty)} y2={r2(ty)} className={styles.notch} style={{ stroke: alpha(CHART.axis, 0.7) }} /> : null;
        })}

        {/* the arbitrage strip and line: the floor staircase × ratio, just under the surface */}
        {arbPts.length > 1 && settled ? <path d={stripPath(scaledStepsFrom(frame.floorSteps, 1, fx.bounceT, t), arbPts, sx, y)} style={{ fill: CHART.arbStrip }} /> : null}
        {arbPts.length > 1 ? (
          <path
            d={linePath(arbPts, sx, y)}
            data-part="tank-arb"
            className={styles.line}
            style={{ stroke: CHART.arb, strokeWidth: touching ? STROKE.arb + 1 : STROKE.arb, strokeDasharray: DASH.arb }}
          />
        ) : null}

        {/* the water's past levels, etched on the glass: the floor staircase */}
        {settled && frame.floorSteps.length > 1 ? (
          <g data-part="tank-steps">
            <path d={linePath(frame.floorSteps, sx, y)} className={styles.stairs} style={{ stroke: CHART.floor, strokeWidth: STROKE.floor }} data-part="tank-steps-line" />
            {frame.events.map((e) => (
              <circle key={e.t} cx={r2(sx(e.t))} cy={r2(y(e.to))} r={3} style={{ fill: CHART.floor }} />
            ))}
          </g>
        ) : null}

        {/* price trail (made-up path) */}
        {frame.path.length > 1 ? (
          <path d={linePath(frame.path, sx, y)} opacity={frame.priceOpacity} className={styles.trail} style={{ stroke: CHART.price, strokeWidth: STROKE.price }} />
        ) : null}

        {/* drips and ripples: pure functions of story time */}
        {drips.map((e) => {
          const p = 1 - (e.t - t) / DRIP_T;
          const dy = b.top - 8 + (surface - b.top + 8) * p * p;
          return <ellipse key={e.t} cx={spoutX} cy={r2(dy)} rx={2.6} ry={3.6} style={{ fill: CHART.floor }} />;
        })}
        {ripples.map((e) => {
          const p = (t - e.t) / RIPPLE_T;
          const rx0 = e.kind === "harvest" ? spoutX : e.beat === "bounce" ? buoyX : b.x1 - 30;
          return <ellipse key={e.t} cx={r2(rx0)} cy={r2(surface)} rx={r2(6 + 30 * p)} ry={r2(2 + 4 * p)} className={styles.hair} style={{ fill: "none", stroke: CHART.floor }} opacity={r2(0.8 * (1 - p))} />;
        })}
      </g>

      {/* tank glass: walls, rim lips and the stand with its plate */}
      <path d={tankOutline(b.x0, b.x1, b.top, b.bottom, 18)} className={styles.glass} style={{ stroke: glassStroke }} />
      <path d={`M${b.x0 - 7} ${b.top} L${b.x0 + 2} ${b.top} M${b.x1 - 2} ${b.top} L${b.x1 + 7} ${b.top}`} className={styles.pipe} style={{ stroke: glassStroke }} />
      <g data-part="stand">
        <rect x={b.x0 + 18} y={b.baseY} width={r2(tw - 36)} height={b.baseH} rx={b.baseH / 2} style={{ fill: CHART.chip }} />
        <text x={r2((b.x0 + b.x1) / 2)} y={r2(b.baseY + b.baseH / 2 + 3.6)} textAnchor="middle" className={styles.vaultLabel} fontSize={b.narrow ? 9.5 : 10.5} style={{ fill: CHART.floor }}>
          Floor vault · SPYx
        </text>
      </g>

      {/* exit tap */}
      {showTap ? (
        <g data-part="tap">
          <path d={`M${b.x1} ${r2(tapY)} L${b.x1 + 14} ${r2(tapY)}`} className={styles.pipe} style={{ stroke: glassStroke }} />
          <rect x={b.x1 + 4} y={r2(tapY - 8)} width={7} height={5} rx={2} style={{ fill: CHART.label }} />
          {exitFlow ? (
            <line
              x1={b.x1 + 14}
              x2={b.x1 + 14}
              y1={r2(tapY + 3)}
              y2={b.bottom + 6}
              className={styles.outflow}
              style={{ stroke: CHART.floor, strokeDashoffset: r2(-t * 90) }}
            />
          ) : null}
        </g>
      ) : null}

      {/* gauge */}
      {ticks.map((v) => {
        const ty = y(v);
        if (ty < b.top - 2 || ty > b.bottom + 2 || (showTap && Math.abs(ty - tapY) < 14)) return null;
        return (
          <text key={v} x={b.gaugeX + 8} y={r2(ty + 3.5)} fontSize={axisFs} className={`${styles.axis} tnum`} style={{ fill: CHART.axis }}>
            {formatUsdWhole(v)}
          </text>
        );
      })}

      {/* labels on the water and the steps */}
      {settled ? (
        <Label x={b.tx0 - 4} y={Math.max(b.top + 14, surface - 9)} text={CHART_COPY.floor} fs={fs} color={CHART.floor} part="floor-label" />
      ) : null}
      {feesOpacity > 0 ? (
        <Label x={sx(harvests[0]!.t) - 6} y={feesY} text={CHART_COPY.fromFees(frame.feesPct ?? 0)} fs={fs} color={CHART.floor} opacity={r2(feesOpacity)} part="fees-label" />
      ) : null}
      {exitsOpacity > 0 && exitsEv ? <Chip x={exitsX} y={exitsY} anchor="end" text={exitsText} fs={fs} color={CHART.floor} opacity={r2(exitsOpacity)} part="exits-chip" /> : null}
      {arbPts.length > 1 && arbLabelOpacity > 0 ? (
        b.narrow ? (
          <Chip x={sx(fx.bounceT) - 6} y={y(arbPts[0]![1]) + 14} anchor="end" text={CHART_COPY.arbLine} fs={fs} color={CHART.arb} opacity={r2(arbLabelOpacity)} part="arb-label" />
        ) : (
          <Label x={sx(fx.bounceT) - 8} y={y(arbPts[0]![1]) + 15} anchor="end" text={CHART_COPY.arbLine} fs={fs} color={CHART.arb} part="arb-label" />
        )
      ) : null}

      {/* the dip: stays marked once the price has bounced off the arbitrage line */}
      {dip !== null ? (
        <g data-part="dip" opacity={atBounce ? 1 : 0.8}>
          <circle cx={r2(sx(dip.t))} cy={r2(y(dip.value))} r={9} style={{ fill: CHART.bounceHalo }} />
          <circle cx={r2(sx(dip.t))} cy={r2(y(dip.value))} r={5} style={{ fill: CHART.bounce }} />
          {bounceLabelOpacity > 0 ? (
            <Label x={sx(dip.t)} y={y(dip.value) + 22} anchor="middle" text={`${CHART_COPY.bounce} ↑`} fs={fs} color={CHART.bounce} opacity={r2(bounceLabelOpacity)} />
          ) : null}
        </g>
      ) : null}

      {/* redeem chip by the tap, low in the water */}
      {frame.redeemProgress > 0 && frame.floorNet100 !== null ? (
        <Chip x={b.x1 - 16} y={b.bottom - (b.narrow ? 20 : 24)} anchor="end" text={CHART_COPY.redeem(frame.floorNet100)} fs={fs} opacity={r2(clamp01(frame.redeemProgress * 1.6))} part="redeem-chip" />
      ) : null}

      {/* buoy: the price of your $100 */}
      <g opacity={frame.priceOpacity} data-part="buoy">
        <g transform={`translate(${r2(buoyX)} ${r2(buoyY)})`}>
          <circle r={r + 6} style={{ fill: touching ? alpha(CHART.bounce, 0.3) : CHART.bounceHalo }} />
          <path d={`M${-r} 0 A${r} ${r} 0 0 1 ${r} 0 Z`} style={{ fill: CHART.price }} />
          <path d={`M${-r} 0 A${r} ${r} 0 0 0 ${r} 0 Z`} style={{ fill: CHART.bg }} />
          <circle r={r} className={styles.rim} style={{ stroke: CHART.price }} />
          <line x1={0} x2={0} y1={-r - 6} y2={-r} className={styles.rim} style={{ stroke: CHART.price }} />
        </g>
        {priceChipOpacity > 0 ? <Chip x={priceX} y={priceLabelY} anchor={flip ? "end" : "start"} text={priceText} fs={fs} opacity={r2(priceChipOpacity)} part="price-chip" /> : null}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- strip */

/**
 * The floor staircase over the whole story time on a fixed close-up dollar band (true dollars,
 * cropped, never stretched per step), on a cloud panel beside the captions, with the tank's key.
 * Same story clock as the tank's glass; the cursor marks "now".
 */
export function FloorStrip({ m, frame }: VariantProps & { frame: StoryFrame }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const clipId = `rv16-strip-${useId().replace(/:/g, "")}`;
  const fx = fixedFor(m);
  const w = size.w;
  const h = size.h;
  const narrow = w < 380;
  const gaugeW = narrow ? 36 : 42;
  const x0 = 14;
  const x1 = Math.max(x0 + 60, w - gaugeW);
  const top = 6;
  const bottom = h - 6;
  const sx = timeScale(fx.endT, x0 + 6, x1 - 6);
  const band = fx.strip;
  const sy = (v: number) => bottom - ((v - band.min) / (band.max - band.min)) * (bottom - top);
  const steps = frame.floorSteps;
  const ratio = frame.arbLine100 !== null && frame.floor100 ? frame.arbLine100 / frame.floor100 : null;
  const arbPts = ratio !== null ? scaledStepsFrom(steps, ratio, fx.bounceT, frame.t) : [];
  const fs = narrow ? 10 : 11;
  const ticks = niceTicks(band.min, band.max, 2);
  const settled = frame.floorReveal >= 1;
  return (
    <div className={styles.strip} aria-hidden data-part="floor-strip">
      <p className={styles.stripTitle}>
        <span className={styles.stripName}>Floor over time</span>
        <span className={styles.stripSub}>Close-up · real scale</span>
      </p>
      <div ref={ref} className={styles.stripPlot}>
        <svg width={w} height={h} role="presentation" data-part="strip">
          <defs>
            <clipPath id={clipId}>
              <rect x={x0} y={top - 1} width={x1 - x0} height={bottom - top + 2} />
            </clipPath>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={x0} x2={x1} y1={r2(sy(v))} y2={r2(sy(v))} className={styles.hair} style={{ stroke: LIGHT.lineStrong }} />
              <text x={x1 + 6} y={r2(sy(v) + 3.5)} fontSize={fs} className={`${styles.axis} tnum`} style={{ fill: LIGHT.ink3 }}>
                {formatUsdWhole(v)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {settled && steps.length > 1 ? <path d={areaPath(steps, sx, sy, bottom + 2)} style={{ fill: LIGHT.floorSoft }} opacity={0.7} /> : null}
            {frame.path.length > 1 ? (
              <path d={linePath(frame.path, sx, sy)} className={styles.line} style={{ stroke: LIGHT.ink3, strokeWidth: 1.25 }} opacity={0.6 * frame.priceOpacity} />
            ) : null}
            {arbPts.length > 1 ? <path d={linePath(arbPts, sx, sy)} className={styles.line} style={{ stroke: LIGHT.arb, strokeWidth: STROKE.arb, strokeDasharray: DASH.arb }} /> : null}
            {settled && steps.length > 1 ? (
              <path d={linePath(steps, sx, sy)} className={styles.stairs} style={{ stroke: LIGHT.floor, strokeWidth: STROKE.floor }} data-part="strip-steps" />
            ) : null}
            {frame.dip ? <circle cx={r2(sx(frame.dip.t))} cy={r2(sy(frame.dip.value))} r={3.5} style={{ fill: LIGHT.bounce }} /> : null}
          </g>
          <line x1={r2(sx(frame.t))} x2={r2(sx(frame.t))} y1={top} y2={bottom} className={styles.hair} style={{ stroke: LIGHT.ink3 }} opacity={0.5} />
          {settled ? null : (
            <text x={r2((x0 + x1) / 2)} y={r2((top + bottom) / 2 - 8)} textAnchor="middle" fontSize={fs + 1} className={styles.axis} style={{ fill: LIGHT.ink3 }}>
              The floor's steps draw here once the vault fills
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
