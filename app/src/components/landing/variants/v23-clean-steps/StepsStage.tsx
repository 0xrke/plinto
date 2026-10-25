"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BrandChartFrame,
  CHART,
  CHART_COPY,
  DASH,
  SINCE_LISTING,
  STROKE,
  TILE_FLOOR,
  TILE_NOW,
  formatPctChange,
  formatUsdWhole,
  railLabel,
  railStatus,
  sinceListing,
  tileValues,
  useJumpToBeat,
  type StoryFrame,
} from "../shared";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { storyNetFinal } from "@/lib/landing/sim/story";
import {
  COLUMN_TOP,
  T_BOUNCE,
  T_SELLOFF_END,
  beatDividers,
  columnBox,
  columnSegments,
  dollarTicks,
  easeInOut,
  headSlope,
  netPath,
  netPress,
  plotFor,
  polyline,
  ramp,
  scalesFor,
  splitPathAt,
  splitPhases,
  squash,
  treads,
  xMaxFor,
  type Plot,
  type Scales,
} from "./geometry";
import styles from "./cleanSteps.module.css";

/*
 * Variant 23's stage: v20's clean playful stage with the split column of v1/v3. The price is a ball
 * whose bottom touches the value, the floor is a staircase of platforms from the engine's real fee
 * math, and from the bounce beat the arbitrage line (floor × arbLineRatio) runs under it as a dashed
 * rose staircase whose current tread dents like a trampoline net. Above the midnight card runs the
 * step rail; the two numbers head the caption column. In the presale the raise fills one tall
 * column on the chart's own $ axis up to your $100; in the split that column divides into floor
 * (mint, bottom), market (iris) and fees (butter, top), each labelled directly, and the floor segment
 * drops onto the floor slab the staircase starts from. Nothing is magnified: the close-up carries the
 * "real scale" chip. Round 2: the dots became the landing's line-segment rail with beat names, and
 * the two numbers moved from under the card to the head of the caption column (above the chart on
 * phones), each with its change since listing.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Measures the scene box; a sensible default for the server render and the first paint. */
function useBox(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, box };
}

const pct = (usd: number, m: LaunchMath) => Math.round((usd / m.raiseUsd) * 1000) / 10;

export function StepsStage({ m, frame: f, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  const { ref, box } = useBox({ w: 640, h: 420 });
  // From the pump on, the trail is made up: the butter pill stays (as in v11–v15).
  const madeUp = f.illustrative || f.beatIndex >= 2;
  return (
    <div className={`${styles.stageCol} ${still ? styles.stageStill : ""}`} data-v23-stage={still ? "still" : "live"}>
      {still ? null : <Rail active={f.beatIndex} fill={f.beatProgress} />}
      <div className={styles.cardSlot}>
        <BrandChartFrame
          inset="full"
          size={still ? "still" : "stage"}
          style={still ? { height: "100%" } : undefined}
          illustration={madeUp}
          scale={f.zoom > 0.5 ? "real" : null}
          scaleOpacity={ramp(f.zoom, 0.5, 0.8)}
        >
          <div ref={ref} className="absolute inset-0">
            <Scene m={m} f={f} p={plotFor(box.w, box.h)} />
          </div>
        </BrandChartFrame>
      </div>
      <Metrics m={m} f={f} />
    </div>
  );
}

/* ---------- Step rail ---------- */

/**
 * The landing's step rail: one line segment per beat with its name under it (wide screens), the
 * current one taller with a floor ring and filling while its beat plays. Each jumps (native scroll)
 * to its beat. Phones show "n/8 · Beat" beside the segments instead of the names.
 */
function Rail({ active, fill }: { active: number; fill: number }) {
  const jump = useJumpToBeat();
  return (
    <nav className={styles.rail} aria-label="Story steps">
      <ol className={styles.railList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={styles.railItem}>
            <button
              type="button"
              className={styles.railBtn}
              data-state={i < active ? "done" : i === active ? "now" : "next"}
              aria-label={railLabel(i)}
              aria-current={i === active ? "step" : undefined}
              onClick={() => jump(i)}
              style={{ "--fill": (i < active ? 1 : i > active ? 0 : Math.min(1, Math.max(0, fill))).toFixed(3) } as CSSProperties}
            >
              <span className={styles.railTrack} aria-hidden>
                <span className={styles.railFill} />
              </span>
              <span className={styles.railLabel} aria-hidden>
                {BEAT_LABELS[key]}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <span className={`tnum ${styles.railStatus}`} data-testid="v23-level">
        {railStatus(active)}
      </span>
    </nav>
  );
}

/* ---------- The two numbers ---------- */

/**
 * "Your $100 now" and "Floor pays back", large, each with how far it has moved since listing. On
 * wide screens they head the caption column (beside the chart's top edge); on phones they sit
 * right above the chart. The percents appear only once trading has opened.
 */
function Metrics({ m, f }: { m: LaunchMath; f: StoryFrame }) {
  const { now, floor } = tileValues(f);
  const since = sinceListing(m, f);
  return (
    <dl className={styles.metrics} data-part="metrics">
      <div className={`bg-cloud ${styles.metric}`}>
        <dt className={`${styles.metricLabel} text-ink-2`}>{TILE_NOW}</dt>
        <dd className={styles.metricBody}>
          <b data-part="tile-now" className={`tnum ${styles.metricValue} text-ink`}>
            {now}
          </b>
          <Change pct={since.now} part="since-now" tone={since.now !== null && since.now < 0 ? "down" : "up"} />
        </dd>
      </div>
      <div className={`bg-floor-wash ${styles.metric}`}>
        <dt className={`${styles.metricLabel} text-floor`}>{TILE_FLOOR}</dt>
        <dd className={styles.metricBody}>
          <b data-part="tile-floor" className={`tnum ${styles.metricValue} text-floor`}>
            {floor}
          </b>
          <Change pct={since.floor} part="since-floor" tone="floor" />
        </dd>
      </div>
    </dl>
  );
}

const CHANGE_CLASS = { up: "text-floor", down: "text-risk", floor: "text-floor" } as const;

/** "+4.8% since listing": the percent bold in its tone, the suffix lighter. Holds its line when empty. */
function Change({ pct, part, tone }: { pct: number | null; part: string; tone: keyof typeof CHANGE_CLASS }) {
  if (pct === null) return <span className={styles.change} aria-hidden />;
  return (
    <span className={`tnum ${styles.change} ${CHANGE_CLASS[tone]}`} data-part={part} data-tone={tone}>
      <b>{formatPctChange(pct)}</b> <span className={styles.changeSuffix}>{SINCE_LISTING}</span>
    </span>
  );
}

/* ---------- The scene ---------- */

function Scene({ m, f, p }: { m: LaunchMath; f: StoryFrame; p: Plot }) {
  const s = scalesFor(p, f);
  const xHead = s.x(f.t);
  const yHead = s.y(f.valueOf100);
  const zoomed = f.zoom;
  const wide = 1 - zoomed;

  // Floor: the column's floor segment lands on it late in the split (splitPhases), then the real staircase holds.
  const steps = f.floorSteps;
  const floorOn = f.beatIndex <= 1 ? ramp(splitPhases(f).reveal, 0.6, 0.95) : 1;
  const runs = treads(steps);
  const stairD = steps.length ? polyline(steps, s) : "";
  const slabBottom = p.h + 4;
  const fillD = steps.length
    ? `${stairD} L${s.x(steps[steps.length - 1]![0]).toFixed(1)},${slabBottom} L${s.x(steps[0]![0]).toFixed(1)},${slabBottom} Z`
    : "";

  // The arbitrage line, from the bounce beat on: the real staircase at floor × arbLineRatio across the
  // whole chart (as on the landing), with the rose strip between it and the floor.
  const press = netPress(f);
  const slope = headSlope(f, s);
  const yArb = f.arbLine100 === null ? null : s.y(f.arbLine100);
  const arbOpacity = yArb === null ? 0 : f.beat === "bounce" ? ramp(f.beatProgress, 0, 0.2) : 1;
  const arbSteps = yArb !== null ? steps.map(([t, v]) => [t, v * m.arbLineRatio] as const) : [];
  const arbD = arbSteps.length ? polyline(arbSteps, s) : "";
  const stripD = arbSteps.length ? `${stairD} ${polyline([...arbSteps].reverse(), s).replace(/^M/, "L")} Z` : "";
  // Its current tread is the trampoline: strung from just before the bounce to just past the ball
  // (never into the future), it dips through the ball's contact point while the ball presses on it.
  const netX0 = s.x(T_BOUNCE) - 16;
  const netX1 = Math.min(p.right, Math.max(netX0 + 40, xHead + p.r * 1.5)) - 8;
  const contact = yArb !== null && press > 0 ? { x: xHead, y: yHead } : null;
  const postsOn = f.beat === "bounce" ? arbOpacity * (1 - ramp(f.beatProgress, 0.85, 1)) : 0;
  const { sx, sy } = squash(f, press, slope);

  // Trail: the made-up price path behind the ball. In the close-up the drop from the peak (far above
  // the band) fades out, so only the part since the price met the floor stays.
  const { before, after } = splitPathAt(f.path, T_SELLOFF_END);
  const oldD = polyline(before, s);
  const newD = after.length > 1 ? polyline(after, s) : "";
  const oldOpacity = f.priceOpacity * (1 - ramp(zoomed, 0.05, 0.5));
  const ticks = dollarTicks(f.y.min, f.y.max);
  const tickOpacity = ramp(zoomed, 0.5, 0.9);
  const hundredY = s.y(100);

  const harvests = f.events.filter((e) => e.kind === "harvest");
  const exitsEvent = f.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const lastTread = runs[runs.length - 1];
  const redeemOn = f.redeemProgress;
  const splitShow = 1 - ramp(f.pos, 2.05, 2.4);
  const dividers = beatDividers(xMaxFor(f));
  // The bounce mark stays where the ball turned, once it has left the dip.
  const dipMark = f.dip && (f.beat === "bounce" || f.beat === "exits") && f.t > f.dip.t + 0.02 ? f.dip : null;
  // Unique per stage: the reduced-motion page renders eight stills, and SVG ids are document-wide.
  const uid = useId().replace(/:/g, "");
  const clipId = `v23-plot-clip-${uid}`;
  const arbClipId = `v23-arb-clip-${uid}`;

  return (
    <>
      <svg className={styles.svg} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={-40} y={-400} width={p.w + 80} height={p.h + 400} />
          </clipPath>
        </defs>

        {/* Beat dividers: the landing's grid, sliding with the side-scroller camera. */}
        {dividers.map((t) => (
          <line key={t} x1={s.x(t)} x2={s.x(t)} y1={p.top - 14} y2={p.h} style={{ stroke: CHART.grid }} strokeWidth={STROKE.grid} />
        ))}

        {/* $100 line: a faint reference while the camera is wide (the column's top in the presale). */}
        <g opacity={wide}>
          <line
            x1={p.left}
            x2={p.right}
            y1={hundredY}
            y2={hundredY}
            style={{ stroke: CHART.axis }}
            strokeOpacity={0.5}
            strokeWidth={STROKE.ref}
            strokeDasharray={DASH.ref}
          />
        </g>

        {/* Close-up $ scale: a few round ticks so "real scale" can be checked. */}
        {tickOpacity > 0.01 ? (
          <g opacity={tickOpacity}>
            {ticks.values.map((v) => {
              const y = s.y(v);
              if (y < p.top - 8 || y > p.bottom - 6) return null;
              return (
                <g key={v}>
                  <line x1={p.left + 40} x2={p.right} y1={y} y2={y} style={{ stroke: CHART.grid }} strokeWidth={STROKE.grid} />
                  <text x={p.left} y={y + 4} className={styles.tickText} style={{ fill: CHART.axis }}>
                    {ticks.label(v)}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {/* The floor: real staircase, flat mint slab below, rounded platforms on the treads. */}
        {steps.length ? (
          <g clipPath={`url(#${clipId})`}>
            <g opacity={floorOn}>
              <path d={fillD} style={{ fill: CHART.floorSlab }} />
              <path d={stairD} fill="none" style={{ stroke: CHART.floor }} strokeWidth={STROKE.floor} strokeLinejoin="miter" />
              {runs.map(([t0, t1, v]) => {
                const x0 = s.x(t0) + 1.5;
                const x1 = s.x(t1) - 1.5;
                // Short treads (the exits' small lifts) keep the bare staircase, so the steps stay legible.
                if (x1 - x0 < 14) return null;
                return <rect key={t0} x={x0} y={s.y(v) - 2.5} width={x1 - x0} height={5} rx={2.5} style={{ fill: CHART.floor }} />;
              })}
              {/* Coins: each LP fee harvest that lifted the floor. */}
              {harvests.map((e) => (
                <circle key={e.t} cx={s.x(e.t)} cy={s.y(e.to) - 12} r={3.5} style={{ fill: CHART.floor }} opacity={0.35 + 0.65 * zoomed} />
              ))}
            </g>
          </g>
        ) : null}

        {/* Presale and split: the raise column on the $ axis; its floor segment drops onto the slab. */}
        {f.beatIndex <= 2 && splitShow > 0.01 ? <RaiseColumn m={m} f={f} p={p} s={s} opacity={splitShow} /> : null}

        {/* Trail: a midnight halo under the white line, so it reads over the floor slab. */}
        <g clipPath={`url(#${clipId})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {oldOpacity > 0.01 ? (
            <g opacity={oldOpacity}>
              <path d={oldD} style={{ stroke: CHART.bg }} strokeWidth={6} />
              <path d={oldD} style={{ stroke: CHART.price }} strokeWidth={STROKE.price} />
            </g>
          ) : null}
          {newD ? (
            <g opacity={f.priceOpacity}>
              <path d={newD} style={{ stroke: CHART.bg }} strokeWidth={6} />
              <path d={newD} style={{ stroke: CHART.price }} strokeWidth={STROKE.price} />
            </g>
          ) : null}
        </g>

        {/* The arbitrage line: a dashed rose staircase; its current tread dents like a trampoline net. */}
        {yArb !== null && arbOpacity > 0.01 ? (
          <g data-part="arb" opacity={arbOpacity}>
            {contact ? (
              <clipPath id={arbClipId}>
                <rect x={-40} y={-400} width={Math.max(0, netX0 + 40)} height={p.h + 800} />
                <rect x={netX1} y={-400} width={Math.max(0, p.w + 40 - netX1)} height={p.h + 800} />
              </clipPath>
            ) : null}
            <path d={stripD} style={{ fill: CHART.arbStrip }} />
            <path
              d={arbD}
              fill="none"
              clipPath={contact ? `url(#${arbClipId})` : undefined}
              style={{ stroke: CHART.arb }}
              strokeWidth={STROKE.arb}
              strokeDasharray={DASH.arb}
              strokeLinejoin="miter"
            />
            {contact ? (
              <path
                data-part="net"
                d={netPath(netX0, netX1, yArb, contact)}
                fill="none"
                style={{ stroke: CHART.arb }}
                strokeWidth={2}
                strokeDasharray={DASH.arb}
                strokeLinecap="round"
              />
            ) : null}
            {postsOn > 0.01 ? (
              <g opacity={postsOn}>
                <line x1={netX0} x2={netX0} y1={yArb} y2={yArb + 12} style={{ stroke: CHART.arb }} strokeWidth={2.5} strokeLinecap="round" />
                <line x1={netX1} x2={netX1} y1={yArb} y2={yArb + 12} style={{ stroke: CHART.arb }} strokeWidth={2.5} strokeLinecap="round" />
              </g>
            ) : null}
          </g>
        ) : null}

        {/* Where the ball turned: the landing's bounce dot with its halo. */}
        {dipMark ? (
          <g opacity={f.priceOpacity}>
            <circle cx={s.x(dipMark.t)} cy={s.y(dipMark.value)} r={9} style={{ fill: CHART.bounceHalo }} />
            <circle cx={s.x(dipMark.t)} cy={s.y(dipMark.value)} r={5} style={{ fill: CHART.bounce }} />
          </g>
        ) : null}

        {/* The ball: its bottom sits on the value. */}
        <g transform={`translate(${xHead.toFixed(1)} ${yHead.toFixed(1)})`} opacity={f.priceOpacity} data-part="ball">
          <ellipse cx={0} cy={2} rx={p.r * 0.85} ry={2.2} style={{ fill: CHART.grid }} />
          <g transform={`scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(0 ${-p.r})`}>
            {press > 0 ? <circle r={p.r + 5} style={{ fill: CHART.bounceHalo }} /> : null}
            {/* A plain white ball (the price's head dot, grown): no face, no mascot. */}
            <circle r={p.r} style={{ fill: CHART.price, stroke: CHART.bg }} strokeWidth={2} />
          </g>
        </g>
      </svg>

      {/* HTML chips over the scene. */}
      <div className={styles.overlay}>
        {f.beatIndex <= 2 && splitShow > 0.01 ? <ColumnLabels m={m} f={f} p={p} s={s} opacity={splitShow} /> : null}

        {wide > 0.05 && f.t > 0 ? (
          <Chip x={p.right} y={hundredY - 6} anchor="bottom-right" tone="axis" opacity={wide}>
            {CHART_COPY.hundred}
          </Chip>
        ) : null}

        {f.t >= f.peak.t && wide > 0.05 ? (
          <Chip x={s.x(f.peak.t)} y={Math.max(38, s.y(f.peak.value) - p.r * 2 - 10)} anchor="bottom" tone="raised" opacity={wide}>
            {CHART_COPY.peak(f.peak.value)}
          </Chip>
        ) : null}

        {f.feesPct !== null && zoomed > 0.6 && runs.length > 2 ? (
          <Chip
            x={s.x(steps[0]![0]) + 4}
            y={Math.min(s.y(steps[0]![1]) + 40, p.h - 34)}
            anchor="left-top"
            tone="floor"
            opacity={ramp(zoomed, 0.6, 1) * (1 - ramp(f.pos, 5, 5.15))}
          >
            {CHART_COPY.fromFees(f.feesPct)}
          </Chip>
        ) : null}

        {arbSteps.length ? (
          <Chip x={s.x(arbSteps[0]![0]) + 4} y={s.y(arbSteps[0]![1]) + 8} anchor="left-top" tone="net" opacity={arbOpacity}>
            {CHART_COPY.arbLine}
          </Chip>
        ) : null}

        {f.dip && f.beat === "bounce" ? (
          <Chip x={s.x(f.dip.t)} y={s.y(f.dip.value) + 12} anchor="top" tone="net" opacity={ramp(f.beatProgress, 0.3, 0.45)}>
            {CHART_COPY.bounce}
          </Chip>
        ) : null}

        {exitsEvent && f.exitsPct !== null ? (
          <Chip x={s.x(exitsEvent.t)} y={s.y(exitsEvent.to) - 26} anchor="bottom" tone="floor" opacity={1 - ramp(redeemOn, 0, 0.15)}>
            {CHART_COPY.fromExits(f.exitsPct)}
          </Chip>
        ) : null}

        {/* From the pump on; in the split the column's "Floor 50%" label rides the segment down instead. */}
        {steps.length && f.floorReveal > 0.5 && f.beatIndex >= 2 && f.beat !== "redeem" ? (
          <Chip
            x={zoomed > 0.5 ? s.x(steps[0]![0]) + 4 : s.x(steps[0]![0]) - 6}
            y={s.y(steps[0]![1]) + (zoomed > 0.5 ? -8 : -10)}
            anchor={zoomed > 0.5 ? "left-bottom" : "right-top"}
            tone="floor"
            opacity={ramp(f.floorReveal, 0.5, 1)}
          >
            {CHART_COPY.floor}
          </Chip>
        ) : null}

        {redeemOn > 0 && lastTread ? (
          <Chip x={xHead} y={s.y(lastTread[2]) - p.r * 2 - 14} anchor="bottom-right" tone="redeem" opacity={ramp(redeemOn, 0.2, 0.6)}>
            {CHART_COPY.redeem(storyNetFinal(m))}
          </Chip>
        ) : null}
      </div>
    </>
  );
}

type Anchor = "bottom" | "top" | "left-top" | "left-bottom" | "right-top" | "bottom-right";
type Tone = "axis" | "raised" | "floor" | "net" | "redeem";

const TONE_CLASS: Record<Tone, string> = {
  axis: "text-[10.5px] font-semibold",
  raised: "pill pill-sm bg-tile text-white",
  floor: "pill pill-sm",
  net: "pill pill-sm",
  redeem: "pill bg-mint text-midnight",
};

/** An opaque tint on the midnight card, so a chip stays legible over the trail. */
const onCard = (color: string, a: number) => `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, ${CHART.bg})`;

const TONE_STYLE: Record<Tone, CSSProperties> = {
  axis: { color: CHART.axis },
  raised: {},
  floor: { color: CHART.floor, background: onCard(CHART.floor, 0.16) },
  net: { color: CHART.arb, background: onCard(CHART.arb, 0.16) },
  redeem: {},
};

function Chip({ x, y, anchor, tone, opacity = 1, children }: { x: number; y: number; anchor: Anchor; tone: Tone; opacity?: number; children: ReactNode }) {
  if (opacity <= 0.01) return null;
  return (
    <span
      className={`tnum ${styles.chip} ${TONE_CLASS[tone]}`}
      data-anchor={anchor}
      data-tone={tone}
      style={{ ...TONE_STYLE[tone], left: x, top: y, opacity }}
    >
      {children}
    </span>
  );
}

/* ---------- The raise column ---------- */

/** Where the floor segment is: it drops to the floor's real level, then stretches over the slab. */
function floorSegment(m: LaunchMath, f: StoryFrame, p: Plot, s: Scales) {
  const box = columnBox(p, s);
  const seg = columnSegments(m.split)[0]!;
  const r = splitPhases(f).reveal;
  const drop = easeInOut(ramp(r, 0, 0.55));
  const stretch = easeInOut(ramp(r, 0.3, 1));
  const floorV = f.floorSteps.length ? f.floorSteps[0]![1] : m.floorPer100GrossUsd;
  const topV = seg.to * COLUMN_TOP + (floorV - seg.to * COLUMN_TOP) * drop;
  const slabX1 = s.x(Math.max(1, f.t));
  return {
    x0: box.x0 + (s.x(1) - box.x0) * stretch,
    x1: box.x1 + (Math.max(s.x(1) + 24, slabX1) - box.x1) * stretch,
    top: s.y(topV),
    // Settled, it reaches the card's bottom edge like the slab under the staircase (no dark seam).
    bottom: p.bottom + (p.h + 4 - p.bottom) * stretch,
    drop,
    r,
  };
}

/** Presale: the raise fills the column up to your $100. Split: it divides; the floor part drops onto the slab. */
function RaiseColumn({ m, f, p, s, opacity }: { m: LaunchMath; f: StoryFrame; p: Plot; s: Scales; opacity: number }) {
  const { x0, x1 } = columnBox(p, s);
  const w = x1 - x0;
  const yTop = s.y(COLUMN_TOP);
  const y0 = s.y(0);
  const fill = (f.raisedUsd / m.raiseUsd) * COLUMN_TOP;
  const { sp } = splitPhases(f);
  const tint = ramp(sp, 0, 0.35);
  const gap = 3 * easeInOut(ramp(sp, 0.1, 0.5));
  const segs = columnSegments(m.split);
  const fl = floorSegment(m, f, p, s);
  const color: Record<string, string> = { market: CHART.market, creator: CHART.fees, platform: CHART.fees };
  return (
    <g data-part="split" opacity={opacity}>
      {/* The empty column up to $100, and the raise filling it (sky), which takes the split's colours. */}
      <rect x={x0} y={yTop} width={w} height={Math.max(0, y0 - yTop)} rx={6} style={{ fill: CHART.grid }} opacity={1 - tint} />
      {tint < 1 ? (
        <rect
          x={x0}
          y={s.y(fill)}
          width={w}
          height={Math.max(0, y0 - s.y(fill))}
          rx={6}
          style={{ fill: CHART.presaleFill }}
          opacity={1 - tint}
          data-part="raise-fill"
        />
      ) : null}
      {tint > 0
        ? segs.slice(1).map((g) => {
            const top = s.y(g.to * COLUMN_TOP) + gap / 2;
            const bot = s.y(g.from * COLUMN_TOP) - gap / 2;
            return (
              <rect
                key={g.key}
                x={x0}
                y={top}
                width={w}
                height={Math.max(0, bot - top)}
                rx={g.key === "platform" ? 6 : 3}
                style={{ fill: color[g.key] }}
                opacity={tint}
                data-seg={g.key}
              />
            );
          })
        : null}
      {tint > 0 ? (
        <rect
          x={fl.x0}
          y={fl.top + (gap / 2) * (1 - fl.drop)}
          width={Math.max(0, fl.x1 - fl.x0)}
          height={Math.max(0, fl.bottom - fl.top - (gap / 2) * (1 - fl.drop))}
          rx={3}
          style={{ fill: CHART.floor }}
          opacity={tint * (1 - 0.45 * ramp(fl.r, 0.7, 1))}
          data-seg="floor"
        />
      ) : null}
    </g>
  );
}

/** Direct labels beside the column: "Raised $X" in the presale; "Floor 50%", "Market 40%", "Fees 5% · 5%" in the split. */
function ColumnLabels({ m, f, p, s, opacity }: { m: LaunchMath; f: StoryFrame; p: Plot; s: Scales; opacity: number }) {
  const { x1 } = columnBox(p, s);
  const segs = columnSegments(m.split);
  const hundredY = s.y(COLUMN_TOP);
  const small = p.w < 480;
  const half = small ? 10 : 11;
  // Labels stay clear of the $100 line and the ball rolling on it, and never stack on each other.
  const minY = hundredY + p.r * 0.6 + half + 6;
  const x = x1 + (small ? 8 : 12);
  if (f.beatIndex === 0) {
    const fill = (f.raisedUsd / m.raiseUsd) * COLUMN_TOP;
    if (f.raisedUsd < 1) return null;
    return (
      <ColumnLabel x={x} y={Math.max(minY, s.y(fill))} color={CHART.presaleFill} opacity={opacity} part="raised">
        <RaisedText m={m} usd={f.raisedUsd} />
      </ColumnLabel>
    );
  }
  const { sp } = splitPhases(f);
  const fl = floorSegment(m, f, p, s);
  const feesY = Math.max(minY, s.y(((segs[2]!.from + segs[3]!.to) / 2) * COLUMN_TOP));
  const marketY = Math.max(feesY + 2 * half + 6, s.y(((segs[1]!.from + segs[1]!.to) / 2) * COLUMN_TOP));
  const floorY = Math.max(marketY + 2 * half + 6, (fl.top + fl.bottom) / 2);
  const raisedOff = 1 - ramp(sp, 0, 0.15);
  return (
    <>
      {raisedOff > 0.01 ? (
        <ColumnLabel x={x} y={minY} color={CHART.presaleFill} opacity={opacity * raisedOff} part="raised">
          <RaisedText m={m} usd={f.raisedUsd} />
        </ColumnLabel>
      ) : null}
      <ColumnLabel x={x} y={feesY} color={CHART.fees} opacity={opacity * ramp(sp, 0.55, 0.85)} part="fees">
        Fees {CHART_COPY.fees(pct(m.split.creatorUsd, m), pct(m.split.platformUsd, m))}
      </ColumnLabel>
      <ColumnLabel x={x} y={marketY} color={CHART.market} opacity={opacity * ramp(sp, 0.3, 0.55)} part="market">
        {CHART_COPY.market} {Math.round(pct(m.split.poolUsd, m))}%
      </ColumnLabel>
      <ColumnLabel
        x={Math.max(x, fl.x1 + (small ? 8 : 12))}
        y={floorY}
        color={CHART.floor}
        opacity={opacity * ramp(sp, 0.05, 0.3)}
        part="floor"
        strong
      >
        {CHART_COPY.floorShare(Math.round(m.v * 100))}
      </ColumnLabel>
    </>
  );
}

/** "Raised $9,481 of $10,000": the amount in the raise's colour, the target quieter. */
function RaisedText({ m, usd }: { m: LaunchMath; usd: number }) {
  return (
    <>
      {CHART_COPY.raised(usd)}
      <span className={styles.colLabelMuted} style={{ color: CHART.axis }}>{` of ${formatUsdWhole(m.raiseUsd)}`}</span>
    </>
  );
}

function ColumnLabel({
  x,
  y,
  color,
  opacity,
  part,
  strong = false,
  children,
}: {
  x: number;
  y: number;
  color: string;
  opacity: number;
  part: string;
  strong?: boolean;
  children: ReactNode;
}) {
  if (opacity <= 0.01) return null;
  return (
    <span className={`tnum ${styles.colLabel} ${strong ? styles.colLabelStrong : ""}`} style={{ left: x, top: y, opacity }} data-label={part}>
      <i className={styles.swatch} style={{ background: color }} aria-hidden />
      <span style={{ color }}>{children}</span>
    </span>
  );
}
