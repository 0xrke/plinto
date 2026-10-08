"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CHART_COPY,
  ILLUSTRATION,
  REAL_SCALE_LABEL,
  STORY_POS_END,
  TILE_FLOOR,
  TILE_NOW,
  formatUsdWhole,
  storyFrame,
  tileValues,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import {
  areaPath,
  clamp01,
  dollarScale,
  linePath,
  niceTicks,
  scaledStepsFrom,
  tankBox,
  tankOutline,
  textWidth,
  timeScale,
  wavePath,
} from "./geometry";
import styles from "./reservoir.module.css";

/*
 * Reservoir: the floor vault as a glass tank of SPYx. The water level IS the floor per $100 (gross),
 * on the story camera's dollar scale (frame.y). The glass doubles as a chart: story time runs left to
 * right, so every level the water has held stays etched on the glass as a staircase, and the price
 * (a buoy) leaves its trail behind it. The buoy rises in the pump, sinks in the selloff, dips under
 * the arbitrage line (its own staircase, just under the surface) and bounces; a marker stays at the
 * dip. A strip under the tank keeps the floor staircase over time on a fixed close-up dollar band.
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

/** Rounds to 0.01 so server and client markup match (Math.sin can differ in the last bits). */
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

export function Reservoir({ m, frame }: VariantProps & { frame: StoryFrame }) {
  const { now, floor } = tileValues(frame);
  const [ref, size] = useSize<HTMLDivElement>();
  const redeemed = frame.redeemProgress >= 1;
  return (
    <div className={styles.reservoir}>
      <div className={styles.readouts}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>
            <span className={styles.keyBuoy} aria-hidden />
            {TILE_NOW}
          </span>
          <span className={`${styles.statValue} ${styles.statNow} tnum`} data-redeemed={redeemed || undefined}>
            {now}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>
            <span className={styles.keyWater} aria-hidden />
            {TILE_FLOOR}
          </span>
          <span className={`${styles.statValue} ${styles.statFloor} tnum`}>{floor}</span>
        </div>
      </div>
      <div ref={ref} className={styles.tankWrap} aria-hidden>
        <Tank m={m} frame={frame} w={size.w} h={size.h} />
      </div>
      <Strip m={m} frame={frame} w={size.w} />
    </div>
  );
}

/* ---------------------------------------------------------------- label pill */

type Tone = "price" | "floor" | "arb" | "plain";

const TONE_CLASS: Record<Tone, string> = {
  price: styles.pillPrice!,
  floor: styles.pillFloor!,
  arb: styles.pillArb!,
  plain: styles.pillPlain!,
};

/** A small rounded label that stays readable over glass and water. `anchor` is the pill's x anchor. */
function Pill({ x, y, text, fs, tone, anchor = "start", opacity = 1, part }: { x: number; y: number; text: string; fs: number; tone: Tone; anchor?: "start" | "middle" | "end"; opacity?: number; part?: string }) {
  const w = textWidth(text, fs) + 14;
  const h = fs + 9;
  const left = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
  return (
    <g className={TONE_CLASS[tone]} opacity={opacity} data-part={part}>
      <rect x={r2(left)} y={r2(y - h / 2)} width={r2(w)} height={h} rx={h / 2} />
      <text x={r2(left + w / 2)} y={r2(y + fs * 0.36)} textAnchor="middle" fontSize={fs}>
        {text}
      </text>
    </g>
  );
}

/* ---------------------------------------------------------------- tank */

function Tank({ m, frame, w, h }: VariantProps & { frame: StoryFrame; w: number; h: number }) {
  const uid = useId().replace(/:/g, "");
  const fx = fixedFor(m);
  const b = tankBox(w, h);
  const y = dollarScale(frame.y, b.top, b.bottom);
  const sx = timeScale(fx.endT, b.tx0, b.tx1);
  const t = frame.t;
  const tw = b.x1 - b.x0;
  const fs = b.narrow ? 11 : 12.5;

  // Water: the floor, poured in during the split.
  const hasFloor = frame.floor100 !== null && frame.floorReveal > 0;
  const level = hasFloor ? frame.y.min + (frame.floor100! - frame.y.min) * frame.floorReveal : frame.y.min;
  const surface = Math.min(b.bottom, Math.max(b.top, y(level)));
  const depth = b.bottom - surface;
  const amp = b.narrow ? 2 : 2.6;
  const period = b.narrow ? 46 : 64;
  const settled = hasFloor && frame.floorReveal >= 1;

  // Buoy (the price) at the current story time.
  const buoyX = sx(t);
  const buoyY = y(frame.valueOf100);
  const r = b.narrow ? 8 : 10;

  // Arbitrage line: its own staircase (floor × ratio) from the bounce beat on.
  const ratio = frame.arbLine100 !== null && frame.floor100 ? frame.arbLine100 / frame.floor100 : null;
  const arbPts = ratio !== null ? scaledStepsFrom(frame.floorSteps, ratio, fx.bounceT, t) : [];
  const dip = frame.dip;
  const atBounce = frame.beat === "bounce";
  const touching = dip !== null && atBounce && t >= dip.t - 0.12 && t <= dip.t + 0.45;

  const zoomed = frame.zoom > 0.5;
  const harvests = frame.events.filter((e) => e.kind === "harvest");
  const exitsEv = frame.events.find((e) => e.kind === "redeem" && e.beat === "exits");

  // Fee spout over the right rim; drips for harvests coming up within DRIP_T.
  const spoutX = b.x1 - (b.narrow ? 26 : 34);
  const drips = fx.events.filter((e) => e.kind === "harvest" && e.t > t && e.t - t < DRIP_T);
  const ripples = frame.events.filter((e) => t - e.t >= 0 && t - e.t < RIPPLE_T);
  const showSpout = frame.beatIndex >= 2;

  // Tap: from the exits beat; flows around the holders' redemption and during redeem.
  const tapY = b.bottom - Math.min(34, (b.bottom - b.top) * 0.12);
  const showTap = frame.beatIndex >= 6;
  const holdersT = fx.events.find((e) => e.kind === "redeem" && e.beat === "exits")?.t ?? Infinity;
  const exitFlow = (t >= holdersT - 0.18 && t <= holdersT + 0.3) || frame.redeemProgress > 0;

  // Gauge ticks on the camera scale.
  const ticks = niceTicks(frame.y.min, frame.y.max, b.narrow ? 4 : 5);

  // Raise bar: fills in the presale, splits in the split beat.
  const raised = clamp01(frame.raisedUsd / m.raiseUsd);
  const sp = frame.splitProgress;
  const floorW = tw * (fx.floorPct / 100);
  const marketW = tw * (fx.marketPct / 100);
  const pouring = frame.beat === "split" && sp > 0.6 && frame.floorReveal < 1;
  const showBar = frame.beatIndex <= 1;

  // Bubbles: decorative, a pure function of story time (scroll back reverses them).
  const bubbles =
    depth > 30
      ? [0.18, 0.37, 0.55, 0.71, 0.86].map((u, i) => {
          const speed = 0.35 + 0.13 * i;
          const phase = (t * speed + u * 1.7) % 1;
          return { x: r2(b.x0 + tw * u), y: r2(b.bottom - 6 - phase * (depth - 12)), r: r2(1.4 + (i % 3) * 0.6), o: r2(0.6 * Math.sin(Math.PI * phase)) };
        })
      : [];

  const chips: string[] = [];
  if (frame.illustrative) chips.push(ILLUSTRATION);
  if (zoomed) chips.push(REAL_SCALE_LABEL);

  const clip = `rv-clip-${uid}`;
  const water = `rv-water-${uid}`;
  const glass = `rv-glass-${uid}`;

  // Buoy label: to the right of the buoy, flipped left near the right wall.
  const priceText = "Price of your $100";
  const priceW = textWidth(priceText, fs) + 14;
  const flip = buoyX + r + 8 + priceW > b.x1 - 6;
  // Near the settled surface the water carries the step labels, so the price label goes up into the air.
  const lift = settled && buoyY > surface - 34 && buoyY < surface + 0.14 * (b.bottom - b.top);
  const priceLabelY = lift ? Math.min(buoyY, surface) - r - 20 : buoyY < b.top + 16 ? buoyY + r + 14 : buoyY;

  return (
    <svg width={w} height={h} className={styles.svg} role="presentation">
      <defs>
        <clipPath id={clip}>
          <path d={`${tankOutline(b.x0, b.x1, b.top - 4, b.bottom, 20)} Z`} />
        </clipPath>
        <linearGradient id={water} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--rv-water-top)" stopOpacity="0.92" />
          <stop offset="0.3" stopColor="var(--rv-water-mid)" stopOpacity="0.88" />
          <stop offset="1" stopColor="var(--rv-water-deep)" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--rv-glass-edge)" stopOpacity="0.9" />
          <stop offset="0.06" stopColor="var(--rv-glass-fill)" stopOpacity="1" />
          <stop offset="0.94" stopColor="var(--rv-glass-fill)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--rv-glass-edge)" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* raise bar */}
      {showBar ? (
        <g>
          <rect x={b.x0} y={b.barY} width={tw} height={8} rx={4} className={styles.barTrack} />
          {sp <= 0 ? (
            <rect x={b.x0} y={b.barY} width={tw * raised} height={8} rx={4} className={styles.barRaised} />
          ) : (
            <>
              <rect x={b.x0} y={b.barY} width={floorW} height={8} rx={4} className={styles.barFloor} />
              <rect x={b.x0 + floorW + 2 * sp} y={b.barY} width={Math.max(0, marketW - 2 * sp)} height={8} rx={4} className={styles.barMarket} opacity={sp} />
              <rect x={b.x0 + floorW + marketW + 4 * sp} y={b.barY} width={Math.max(0, tw - floorW - marketW - 4 * sp)} height={8} rx={4} className={styles.barFees} opacity={sp} />
            </>
          )}
          {sp <= 0.25 ? (
            <text x={b.x0} y={b.barY - 8} className={styles.barLabel} fontSize={fs}>
              {CHART_COPY.raised(frame.raisedUsd)}
            </text>
          ) : (
            <g opacity={clamp01((sp - 0.25) / 0.4)}>
              <text x={b.x0} y={b.barY - 8} className={styles.barLabelFloor} fontSize={fs}>
                {CHART_COPY.floorShare(fx.floorPct)}
              </text>
              <text x={b.x0 + floorW + 6} y={b.barY - 8} className={styles.barLabel} fontSize={fs}>
                {CHART_COPY.market}
              </text>
            </g>
          )}
        </g>
      ) : null}

      {/* pour from the floor share into the tank */}
      {pouring ? (
        <rect
          x={b.x0 + floorW / 2 - 3}
          y={b.barY + 8}
          width={6}
          height={Math.max(0, surface - b.barY - 8)}
          rx={3}
          className={styles.pour}
          opacity={r2(0.95 - 0.5 * frame.floorReveal)}
        />
      ) : null}

      {/* fee spout over the right rim */}
      {showSpout ? (
        <g className={styles.spout}>
          <path d={`M${spoutX + 22} ${b.top - 30} L${spoutX + 22} ${b.top - 18} Q${spoutX + 22} ${b.top - 8} ${spoutX + 12} ${b.top - 8} L${spoutX} ${b.top - 8}`} />
          <text x={spoutX - 6} y={b.top - 4} textAnchor="end" fontSize={fs - 1} className={styles.spoutLabel}>
            LP fees in
          </text>
        </g>
      ) : null}

      {/* everything inside the glass */}
      <g clipPath={`url(#${clip})`}>
        <rect x={b.x0} y={b.top - 4} width={tw} height={b.bottom - b.top + 4} fill={`url(#${glass})`} />

        {/* faint dollar grid on the glass */}
        {ticks.map((v) => {
          const ty = y(v);
          return ty > b.top && ty < b.bottom ? <line key={v} x1={b.x0} x2={b.x1} y1={ty} y2={ty} className={styles.grid} /> : null;
        })}

        {hasFloor ? (
          <g className={styles.wave}>
            <path d={wavePath(b.x0, b.x1, surface, b.bottom + 2, amp, period)} fill={`url(#${water})`} style={{ ["--rv-period" as string]: `${-period}px` }} />
          </g>
        ) : null}
        {hasFloor ? <line x1={b.x0} x2={b.x1} y1={surface} y2={surface} className={styles.surfaceLine} /> : null}
        {bubbles.map((bb, i) => (
          <circle key={i} cx={bb.x} cy={bb.y} r={bb.r} className={styles.bubble} opacity={bb.o} />
        ))}
        {depth > 28 ? (
          <text x={(b.x0 + b.x1) / 2} y={b.bottom - (b.narrow ? 12 : 16)} textAnchor="middle" className={styles.vaultLabel} fontSize={fs}>
            Vault · SPYx
          </text>
        ) : null}

        {/* the water's past levels, etched on the glass: the floor staircase */}
        {settled && frame.floorSteps.length > 1 ? (
          <g data-part="tank-steps">
            <path d={linePath(frame.floorSteps, sx, y)} className={styles.stepsUnder} />
            <path d={linePath(frame.floorSteps, sx, y)} className={styles.steps} data-part="tank-steps-line" />
            {frame.events.map((e) => (
              <circle key={e.t} cx={r2(sx(e.t))} cy={r2(y(e.to))} r={b.narrow ? 2.6 : 3.2} className={styles.stepDot} />
            ))}
          </g>
        ) : null}

        {/* arbitrage line: the floor staircase × ratio, just under the surface */}
        {arbPts.length > 1 ? (
          <g data-part="tank-arb">
            <path d={linePath(arbPts, sx, y)} className={styles.arbUnder} />
            <path d={linePath(arbPts, sx, y)} className={touching ? styles.arbHot : styles.arb} />
          </g>
        ) : null}

        {/* price trail (made-up path) */}
        {frame.path.length > 1 ? (
          <g opacity={frame.priceOpacity}>
            <path d={linePath(frame.path, sx, y)} className={styles.trailUnder} />
            <path d={linePath(frame.path, sx, y)} className={styles.trail} />
          </g>
        ) : null}

        {/* drips and ripples */}
        {drips.map((e) => {
          const p = 1 - (e.t - t) / DRIP_T;
          const dy = b.top - 8 + (surface - b.top + 8) * p * p;
          return <ellipse key={e.t} cx={spoutX} cy={dy} rx={2.8} ry={3.8} className={styles.drip} />;
        })}
        {ripples.map((e) => {
          const p = (t - e.t) / RIPPLE_T;
          const rx0 = e.kind === "harvest" ? spoutX : e.beat === "bounce" ? buoyX : b.x1 - 30;
          return <ellipse key={e.t} cx={rx0} cy={surface} rx={6 + 34 * p} ry={2 + 5 * p} className={styles.ripple} opacity={1 - p} />;
        })}
      </g>

      {/* tank glass */}
      <path d={tankOutline(b.x0, b.x1, b.top, b.bottom, 20)} className={styles.glass} />
      <line x1={b.x0 - 3} x2={b.x0 + 8} y1={b.top} y2={b.top} className={styles.rim} />
      <line x1={b.x1 - 8} x2={b.x1 + 3} y1={b.top} y2={b.top} className={styles.rim} />

      {/* exit tap */}
      {showTap ? (
        <g>
          <path d={`M${b.x1} ${tapY} L${b.x1 + 16} ${tapY}`} className={styles.tap} />
          <rect x={b.x1 + 5} y={tapY - 8} width={7} height={5} rx={1.5} className={styles.valve} />
          {exitFlow ? <line x1={b.x1 + 16} x2={b.x1 + 16} y1={tapY + 3} y2={b.bottom + 4} className={styles.outflow} style={{ strokeDashoffset: -t * 90 }} /> : null}
        </g>
      ) : null}

      {/* gauge */}
      {ticks.map((v) => {
        const ty = y(v);
        if (ty < b.top - 2 || ty > b.bottom + 2) return null;
        return (
          <g key={v} className={styles.tick}>
            <line x1={b.gaugeX + (showTap && Math.abs(ty - tapY) < 10 ? 16 : 0)} x2={b.gaugeX + 5} y1={ty} y2={ty} />
            <text x={b.gaugeX + 9} y={ty + 4} fontSize={fs - 1.5}>
              {formatUsdWhole(v)}
            </text>
          </g>
        );
      })}

      {/* labels on the water and the steps */}
      {settled ? (
        <Pill x={b.tx0 - 6} y={Math.max(b.top + 12, surface - 16)} text={CHART_COPY.floor} fs={fs} tone="floor" part="floor-label" />
      ) : null}
      {zoomed && harvests.length > 0 && frame.feesPct !== null ? (
        <Pill x={sx(harvests[0]!.t) - 10} y={y(m.floorPer100GrossUsd) + 22} text={CHART_COPY.fromFees(frame.feesPct)} fs={fs - 1} tone="plain" opacity={frame.zoom} />
      ) : null}
      {zoomed && exitsEv && frame.exitsPct !== null ? (
        <Pill x={sx(exitsEv.t) - 6} y={y(exitsEv.to) + 24} anchor="end" text={CHART_COPY.fromExits(frame.exitsPct)} fs={fs - 1} tone="plain" />
      ) : null}
      {arbPts.length > 1 ? (
        <Pill x={sx(fx.bounceT) - 8} y={y(arbPts[0]![1])} anchor="end" text={CHART_COPY.arbLine} fs={fs} tone="arb" part="arb-label" />
      ) : null}

      {/* the dip: stays marked once the price has bounced off the arbitrage line */}
      {dip !== null ? (
        <g data-part="dip" opacity={atBounce ? 1 : 0.75}>
          <circle cx={r2(sx(dip.t))} cy={r2(y(dip.value))} r={b.narrow ? 6 : 7} className={styles.dipRing} />
          <path
            d={`M${r2(sx(dip.t))} ${r2(y(dip.value) - 10)} l0 ${-(b.narrow ? 14 : 18)} m-4 4 l4 -4 l4 4`}
            className={styles.dipArrow}
          />
          <Pill x={sx(dip.t)} y={y(dip.value) + (b.narrow ? 20 : 24)} anchor="middle" text={`${CHART_COPY.bounce} ↑`} fs={fs} tone="arb" />
        </g>
      ) : null}

      {/* redeem chip above the tap */}
      {frame.redeemProgress > 0 && frame.floorNet100 !== null ? (
        <Pill x={b.x1 - 12} y={tapY - 30} anchor="end" text={CHART_COPY.redeem(frame.floorNet100)} fs={fs} tone="floor" opacity={clamp01(frame.redeemProgress * 1.6)} />
      ) : null}

      {/* buoy */}
      <g opacity={frame.priceOpacity}>
        <g transform={`translate(${r2(buoyX)} ${r2(buoyY)})`} className={touching ? styles.buoyHot : undefined}>
          <circle r={r + 6} className={styles.buoyHalo} />
          <path d={`M${-r} 0 A${r} ${r} 0 0 1 ${r} 0 Z`} className={styles.buoyTop} />
          <path d={`M${-r} 0 A${r} ${r} 0 0 0 ${r} 0 Z`} className={styles.buoyBottom} />
          <circle r={r} className={styles.buoyRim} />
          <line x1={0} x2={0} y1={-r - 7} y2={-r} className={styles.buoyStick} />
        </g>
        <Pill x={lift ? (flip ? buoyX + r : buoyX - r) : flip ? buoyX - r - 8 : buoyX + r + 8} y={priceLabelY} anchor={flip ? "end" : "start"} text={priceText} fs={fs} tone="price" part="price-label" />
      </g>

      {/* chips */}
      {chips.map((c, i) => {
        const cw = textWidth(c, fs - 1) + 18;
        const chipY = b.top + 10 + i * 26;
        return (
          <g key={c} className={c === ILLUSTRATION ? styles.chipIllu : styles.chip}>
            <rect x={b.x0 + 10} y={chipY} width={r2(cw)} height={21} rx={10.5} />
            <text x={r2(b.x0 + 10 + cw / 2)} y={chipY + 14.5} textAnchor="middle" fontSize={fs - 1}>
              {c}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------------------------------------------------------- strip */

/**
 * The floor staircase over the whole story time on a fixed close-up dollar band (true dollars,
 * cropped, never stretched per step). Same time axis as the tank, so the cursor sits under the buoy.
 */
function Strip({ m, frame, w }: VariantProps & { frame: StoryFrame; w: number }) {
  const fx = fixedFor(m);
  const narrow = w < 560;
  const h = narrow ? 124 : 156;
  const b = tankBox(w, 400);
  const top = 26;
  const bottom = h - 8;
  const sx = timeScale(fx.endT, b.tx0, b.tx1);
  const band = fx.strip;
  const sy = (v: number) => bottom - ((v - band.min) / (band.max - band.min)) * (bottom - top);
  const steps = frame.floorSteps;
  const ratio = frame.arbLine100 !== null && frame.floor100 ? frame.arbLine100 / frame.floor100 : null;
  const arbPts = ratio !== null ? scaledStepsFrom(steps, ratio, fx.bounceT, frame.t) : [];
  const clipId = `rv-strip-${useId().replace(/:/g, "")}`;
  const fs = narrow ? 10.5 : 11.5;
  const ticks = niceTicks(band.min, band.max, 3);
  const settled = frame.floorReveal >= 1;
  return (
    <div className={styles.strip} style={{ height: h }} aria-hidden>
      <svg width={w} height={h} role="presentation" data-part="strip">
        <defs>
          <clipPath id={clipId}>
            <rect x={b.x0} y={top - 1} width={b.x1 - b.x0} height={bottom - top + 2} />
          </clipPath>
        </defs>
        <text x={b.x0 + 2} y={14} fontSize={fs} className={styles.stripTitle}>
          Floor over time
          <tspan className={styles.stripSub}>{narrow ? " · close-up, real scale" : " · close-up, real scale, same clock as the tank"}</tspan>
        </text>
        <rect x={b.x0} y={top} width={b.x1 - b.x0} height={bottom - top} rx={10} className={styles.stripBg} />
        {ticks.map((v) => (
          <g key={v} className={styles.tick}>
            <line x1={b.x0} x2={b.x1} y1={sy(v)} y2={sy(v)} className={styles.stripGrid} />
            <text x={b.gaugeX + 9} y={sy(v) + 4} fontSize={fs - 1}>
              {formatUsdWhole(v)}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {settled && steps.length > 1 ? <path d={areaPath(steps, sx, sy, bottom + 2)} className={styles.stripArea} /> : null}
          {frame.path.length > 1 ? <path d={linePath(frame.path, sx, sy)} className={styles.stripPrice} opacity={frame.priceOpacity} /> : null}
          {arbPts.length > 1 ? <path d={linePath(arbPts, sx, sy)} className={styles.stripArb} /> : null}
          {settled && steps.length > 1 ? <path d={linePath(steps, sx, sy)} className={styles.stripFloor} data-part="strip-steps" /> : null}
          {frame.dip ? <circle cx={r2(sx(frame.dip.t))} cy={r2(sy(frame.dip.value))} r={4} className={styles.dipRing} /> : null}
        </g>
        <line x1={sx(frame.t)} x2={sx(frame.t)} y1={top} y2={bottom} className={styles.stripCursor} />
      </svg>
    </div>
  );
}
