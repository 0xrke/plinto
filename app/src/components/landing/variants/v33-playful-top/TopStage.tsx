"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { quantize } from "@/lib/landing/sim/scroll";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import { SupplyIcon } from "@/components/ui/icons";
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
  TILE_SUPPLY,
  railLabel,
  railStatus,
  useActiveBeat,
  useJumpToBeat,
  useStoryProgress,
  type StoryFrame,
} from "../shared";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { storyNetFinal } from "@/lib/landing/sim/story";
import {
  T_BOUNCE,
  T_LISTING,
  T_SELLOFF_END,
  beatDividers,
  clearOfBall,
  dollarTicks,
  headSlope,
  netPath,
  netPress,
  plotFor,
  polyline,
  ramp,
  scalesFor,
  splitPathAt,
  squash,
  treads,
  xMaxFor,
  type Plot,
} from "./scene";
import { topTiles, type TileChange } from "./tiles";
import styles from "./playfulTop.module.css";

/*
 * Variant 33's stage: variant 20's playful scene with the values on top. Same game as v10/v20: the
 * price is a ball whose bottom touches the value, the floor is a staircase of platforms from the
 * engine's real fee math, and from the bounce beat the arbitrage line (floor × arbLineRatio) runs
 * under it as a dashed rose staircase whose current tread is the trampoline. Top to bottom: the
 * line-segment step rail with the beat names (as in 29), then three equal light tiles near the eye
 * line ("Your $100 now", "Floor pays back", each with its change since listing, and 18's token
 * supply with its shrinking bar), then the midnight chart card at 20's size. Nothing is magnified:
 * the close-up carries the "real scale" chip.
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

export function TopStage({ m, frame: f, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  const { ref, box } = useBox({ w: 640, h: 420 });
  // From the pump on, the trail is made up: the butter pill stays (as in v11–v15).
  const madeUp = f.illustrative || f.beatIndex >= 2;
  return (
    <div className={`${styles.stageCol} ${still ? styles.stageStill : ""}`} data-v33-stage={still ? "still" : "live"}>
      {still ? null : <Rail />}
      <TopTiles m={m} f={f} />
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
    </div>
  );
}

/* ---------- Step rail (29's line segments with the beat names) ---------- */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The active segment fills while its beat plays (q 0.05..0.75), on a 1/200 grid. */
const selectFill = (st: ChapterProgress): number => quantize(clamp01(((st.q[st.active] ?? 1) - 0.05) / 0.7), 0.005);

/** Where you are in the story; each segment jumps (native scroll) to its beat. */
function Rail() {
  const { index } = useActiveBeat();
  const fill = useStoryProgress(selectFill);
  const jump = useJumpToBeat();
  return (
    <nav className={styles.rail} aria-label="Story steps">
      <ol className={styles.railList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={styles.railItem}>
            <button
              type="button"
              className={styles.railBtn}
              aria-label={railLabel(i)}
              aria-current={i === index ? "step" : undefined}
              onClick={() => jump(i)}
              style={{ "--fill": (i < index ? 1 : i > index ? 0 : fill).toFixed(3) } as CSSProperties}
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
      <span className={`${styles.railStatus} tnum`} aria-hidden data-testid="v33-level">
        {railStatus(index)}
      </span>
    </nav>
  );
}

/* ---------- The three tiles on top ---------- */

function Change({ change }: { change: TileChange | null }) {
  // Before listing there is no change to show; the line keeps its height so nothing jumps.
  if (!change) return <span className={styles.tileChange} aria-hidden />;
  return (
    <span className={`${styles.tileChange} tnum`} data-tone={change.tone}>
      {change.text}
      <span className={styles.since}> {SINCE_LISTING}</span>
    </span>
  );
}

/**
 * "Your $100 now", "Floor pays back" and the token supply, three equal light tiles over the card.
 * The supply tile (18's ledger row) has a bar that shrinks with the burned part hatched, and lights
 * up for a moment after each burn.
 */
function TopTiles({ m, f }: { m: LaunchMath; f: StoryFrame }) {
  const t = topTiles(m, f);
  const kept = t.supply.listed ? t.supply.share : 0;
  const burned = t.supply.listed ? 1 - t.supply.share : 0;
  return (
    <div className={styles.tiles} aria-hidden data-part="tiles">
      <div className={styles.tile} data-tile="now">
        <span className={styles.tileLabel}>{TILE_NOW}</span>
        <b data-part="tile-now" className={`${styles.tileValue} tnum`}>
          {t.now.value}
        </b>
        <Change change={t.now.change} />
      </div>
      <div className={styles.tile} data-tile="floor">
        <span className={styles.tileLabel}>{TILE_FLOOR}</span>
        <b data-part="tile-floor" className={`${styles.tileValue} tnum`}>
          {t.floor.value}
        </b>
        <Change change={t.floor.change} />
      </div>
      <div
        className={styles.tile}
        data-tile="supply"
        data-hot={t.supply.fresh > 0 ? "" : undefined}
        style={{ "--fresh": t.supply.fresh.toFixed(3) } as CSSProperties}
      >
        <span className={styles.tileLabel}>
          <span className={styles.supplyIcon}>
            <SupplyIcon size={14} />
          </span>
          {TILE_SUPPLY}
        </span>
        <b data-part="tile-supply" className={`${styles.tileValue} tnum`}>
          {t.supply.value}
        </b>
        <Change change={t.supply.change} />
        <span className={styles.supplyBar} data-part="supply-bar">
          <span className={styles.segSupply} style={{ width: `${(kept * 100).toFixed(2)}%` }} />
          <span className={styles.segBurned} style={{ width: `${(burned * 100).toFixed(2)}%` }} />
        </span>
      </div>
    </div>
  );
}

/* ---------- The scene ---------- */

function Scene({ m, f, p }: { m: LaunchMath; f: StoryFrame; p: Plot }) {
  const s = scalesFor(p, f);
  const xHead = s.x(f.t);
  const yHead = s.y(f.valueOf100);
  const zoomed = f.zoom;
  const wide = 1 - zoomed;

  // Floor: rises out of the ground during the split (floorReveal), then holds its real staircase.
  const steps = f.floorSteps;
  const floorShift = (1 - f.floorReveal) * Math.max(0, p.h + 40 - (steps.length ? s.y(steps[0]![1]) : p.h));
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
  const ledgeEnd = Math.min(xHead, s.x(T_LISTING));

  const harvests = f.events.filter((e) => e.kind === "harvest");
  const exitsEvent = f.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  // The exits chip sits over the tread the ball climbs back onto: it fades while the ball passes
  // under it (a rough box for "+0.9% from exits", centred on the event, bottom 26px above the tread).
  const exitsChipClear = exitsEvent
    ? clearOfBall(
        { left: s.x(exitsEvent.t) - 62, right: s.x(exitsEvent.t) + 62, top: s.y(exitsEvent.to) - 50, bottom: s.y(exitsEvent.to) - 26 },
        xHead,
        yHead,
        p.r,
      )
    : 1;
  const lastTread = runs[runs.length - 1];
  const redeemOn = f.redeemProgress;
  const splitShow = 1 - ramp(f.pos, 2.05, 2.4);
  const dividers = beatDividers(xMaxFor(f));
  // The bounce mark stays where the ball turned, once it has left the dip.
  const dipMark = f.dip && (f.beat === "bounce" || f.beat === "exits") && f.t > f.dip.t + 0.02 ? f.dip : null;
  const clipId = "v33-plot-clip";
  const arbClipId = "v33-arb-clip";

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

        {/* $100 line: the presale ledge, then a faint reference while the camera is wide. */}
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
          {ledgeEnd > p.left ? (
            <line
              x1={p.left}
              x2={Math.max(p.left + 1, ledgeEnd)}
              y1={hundredY + 4}
              y2={hundredY + 4}
              style={{ stroke: CHART.presaleFill }}
              strokeWidth={6}
              strokeLinecap="round"
            />
          ) : null}
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
            <g transform={`translate(0 ${floorShift.toFixed(1)})`}>
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
        {f.beatIndex <= 2 && splitShow > 0 ? <SplitBar m={m} f={f} opacity={splitShow} top={hundredY + p.r * 2 + 16} /> : null}

        {wide > 0.05 && f.t > 0 ? (
          <Chip x={p.right} y={hundredY - 6} anchor="bottom-right" tone="axis" opacity={wide}>
            {CHART_COPY.hundred}
          </Chip>
        ) : null}

        {f.t >= f.peak.t && wide > 0.05 ? (
          <Chip x={s.x(f.peak.t)} y={s.y(f.peak.value) - p.r * 2 - 10} anchor="bottom" tone="raised" opacity={wide}>
            {CHART_COPY.peak(f.peak.value)}
          </Chip>
        ) : null}

        {f.feesPct !== null && zoomed > 0.6 && runs.length > 2 ? (
          <Chip
            x={s.x(steps[0]![0]) + 4}
            y={s.y(steps[0]![1]) + 40}
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
          <Chip
            x={s.x(exitsEvent.t)}
            y={s.y(exitsEvent.to) - 26}
            anchor="bottom"
            tone="floor"
            opacity={(1 - ramp(redeemOn, 0, 0.15)) * exitsChipClear}
          >
            {CHART_COPY.fromExits(f.exitsPct)}
          </Chip>
        ) : null}

        {/* Hidden while the split bar covers the rising floor (presale, split). */}
        {steps.length && f.floorReveal > 0.5 && f.beatIndex >= 2 && f.beat !== "redeem" ? (
          <Chip
            x={zoomed > 0.5 ? s.x(steps[0]![0]) + 4 : s.x(steps[0]![0]) - 6}
            y={s.y(steps[0]![1]) + floorShift + (zoomed > 0.5 ? -8 : -10)}
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

/** Presale: the raise fills a rounded bar; split: it breaks into floor / market / fees (sandbox colours). */
function SplitBar({ m, f, opacity, top }: { m: LaunchMath; f: StoryFrame; opacity: number; top: number }) {
  const fill = f.raisedUsd / m.raiseUsd;
  const sp = f.splitProgress;
  const gap = 4 * sp;
  const segs = [
    { key: "floor", share: m.split.floorUsd / m.raiseUsd, label: CHART_COPY.floorShare(Math.round(m.v * 100)), color: CHART.floor },
    { key: "market", share: m.split.poolUsd / m.raiseUsd, label: CHART_COPY.market, color: CHART.market },
    {
      key: "cuts",
      share: (m.split.creatorUsd + m.split.platformUsd) / m.raiseUsd,
      label: CHART_COPY.fees(pct(m.split.creatorUsd, m), pct(m.split.platformUsd, m)),
      color: CHART.fees,
    },
  ];
  return (
    <div className={`${styles.split} rounded-[16px] bg-tile`} style={{ opacity, top }} data-part="split">
      <p className="tnum mb-2 font-display text-[15px] font-bold text-white lg:text-[17px]">{CHART_COPY.raised(f.raisedUsd)}</p>
      <div className="flex h-3 rounded-full bg-midnight-line" style={{ gap }}>
        {sp <= 0 ? (
          <span className="block h-full rounded-full" style={{ width: `${(fill * 100).toFixed(2)}%`, background: CHART.presaleFill }} />
        ) : (
          segs.map((g) => <span key={g.key} className="block h-full basis-0 rounded-full" style={{ flexGrow: g.share, background: g.color }} />)
        )}
      </div>
      {sp > 0 ? (
        <div className="mt-2 flex gap-1.5 text-[11px] font-semibold text-on-dark-2" style={{ opacity: ramp(sp, 0.3, 0.8) }}>
          {segs.map((g) => (
            <span key={g.key} className={styles.legendItem} style={{ flexGrow: g.share }}>
              <i className="size-2 shrink-0 rounded-full" style={{ background: g.color }} />
              {g.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
