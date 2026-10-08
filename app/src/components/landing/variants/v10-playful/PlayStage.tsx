"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BEAT_KEYS,
  CHART_COPY,
  ILLUSTRATION,
  REAL_SCALE_LABEL,
  TILE_FLOOR,
  TILE_NOW,
  railLabel,
  railStatus,
  tileValues,
  useJumpToBeat,
  type StoryFrame,
} from "../shared";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { storyNetFinal } from "@/lib/landing/sim/story";
import {
  T_BOUNCE,
  T_LISTING,
  T_SELLOFF_END,
  dollarTicks,
  headSlope,
  moodFor,
  netPath,
  netPress,
  plotFor,
  polyline,
  ramp,
  scalesFor,
  splitPathAt,
  squash,
  treads,
  type Mood,
  type Plot,
} from "./scene";
import styles from "./playful.module.css";

/*
 * The playful stage: a soft "level" card. The price is a ball with a face (its bottom touches the
 * value), the floor is a staircase of green platforms from the engine's real fee math, and from the
 * bounce beat a trampoline net hangs at the arbitrage line: the ball dents it to the drawn dip and
 * springs back. Camera, path, floor and every number come from the frame; nothing is magnified
 * (the close-up is labelled "real scale").
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

export function PlayStage({ m, frame: f, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  const { ref, box } = useBox({ w: 640, h: 420 });
  const { now, floor } = tileValues(f);
  return (
    <div className={`${styles.card} ${still ? styles.cardStill : ""}`}>
      <div className={styles.hud} aria-hidden>
        <Pill tone="ball" label={TILE_NOW} value={now} />
        <Pill tone="floor" label={TILE_FLOOR} value={floor} />
      </div>
      <div ref={ref} className={styles.scene} aria-hidden>
        <Scene m={m} f={f} p={plotFor(box.w, box.h, still ? 14 : 54)} />
      </div>
      {still ? null : <Levels active={f.beatIndex} />}
    </div>
  );
}

function Pill({ tone, label, value }: { tone: "ball" | "floor"; label: string; value: string }) {
  return (
    <div className={`${styles.pill} ${tone === "floor" ? styles.pillFloor : styles.pillBall}`}>
      <span className={styles.pillIcon} />
      <span className={styles.pillText}>
        <span className={styles.pillLabel}>{label}</span>
        <span className={styles.pillValue}>{value}</span>
      </span>
    </div>
  );
}

/** Level dots: where you are in the story; each jumps (native scroll) to its beat. */
function Levels({ active }: { active: number }) {
  const jump = useJumpToBeat();
  return (
    <nav className={styles.levels} aria-label="Story steps">
      <ol className={styles.dots}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key}>
            <button
              type="button"
              className={styles.dot}
              data-state={i < active ? "done" : i === active ? "now" : "next"}
              aria-label={railLabel(i)}
              aria-current={i === active ? "step" : undefined}
              onClick={() => jump(i)}
            />
          </li>
        ))}
      </ol>
      <span className={styles.levelText}>{railStatus(active)}</span>
    </nav>
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
  const fillD = steps.length ? `${stairD} L${s.x(steps[steps.length - 1]![0]).toFixed(1)},${p.bottom + 4} L${s.x(steps[0]![0]).toFixed(1)},${p.bottom + 4} Z` : "";

  // Net at the arbitrage line, from the bounce beat on.
  const press = netPress(f);
  const slope = headSlope(f, s);
  const yArb = f.arbLine100 === null ? null : s.y(f.arbLine100);
  // The net is strung along the time axis as the story reaches it: from just before the bounce to
  // just past the ball, never into the future.
  const netX0 = s.x(T_BOUNCE) - 18;
  const netX1 = Math.min(p.right, Math.max(netX0 + 40, xHead + p.r * 1.5));
  const contact = yArb !== null && press > 0 ? { x: xHead, y: yHead } : null;
  const { sx, sy } = squash(f, press, slope);
  const mood = moodFor(f, press, slope);

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
  const lastTread = runs[runs.length - 1];
  const redeemOn = f.redeemProgress;
  const splitShow = 1 - ramp(f.pos, 2.05, 2.4);
  const madeUp = f.illustrative || f.beatIndex >= 2;
  const clipId = "v10-plot-clip";

  return (
    <>
      <svg className={styles.svg} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`}>
        <defs>
          <linearGradient id="v10-floor-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--v10-floor-fill-top)" />
            <stop offset="1" stopColor="var(--v10-floor-fill-bottom)" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={-40} y={-400} width={p.w + 80} height={p.bottom + 400} />
          </clipPath>
          <radialGradient id="v10-ball" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="var(--v10-ball-hi)" />
            <stop offset="1" stopColor="var(--v10-ball)" />
          </radialGradient>
        </defs>

        <Clouds w={p.w} h={p.h} pos={f.pos} />

        {/* $100 line: the presale ledge, then a faint guide while the camera is wide. */}
        <g opacity={wide}>
          <line x1={p.left} x2={p.right} y1={hundredY} y2={hundredY} className={styles.hundredGuide} />
          {ledgeEnd > p.left ? <line x1={p.left} x2={Math.max(p.left + 1, ledgeEnd)} y1={hundredY + 3} y2={hundredY + 3} className={styles.ledge} /> : null}
        </g>

        {/* Tray under the plot: the level dots sit on it; the floor and the trail stop at its edge. */}
        <rect x={-10} y={p.bottom} width={p.w + 20} height={p.h - p.bottom + 40} className={styles.tray} />
        <line x1={0} x2={p.w} y1={p.bottom} y2={p.bottom} className={styles.trayEdge} />

        {/* Close-up $ scale: a few round ticks so "real scale" can be checked. */}
        {tickOpacity > 0.01 ? (
          <g opacity={tickOpacity}>
            {ticks.values.map((v) => {
              const y = s.y(v);
              if (y < p.top - 8 || y > p.bottom - 6) return null;
              return (
                <g key={v}>
                  <line x1={p.left + 34} x2={p.right} y1={y} y2={y} className={styles.tickLine} />
                  <text x={p.left} y={y + 4} className={styles.tickText}>
                    {ticks.label(v)}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {/* The floor: real staircase, fill below, platforms on top. */}
        {steps.length ? (
          <g clipPath={`url(#${clipId})`}>
          <g transform={`translate(0 ${floorShift.toFixed(1)})`}>
            <path d={fillD} fill="url(#v10-floor-fill)" />
            <path d={stairD} className={styles.stair} />
            {runs.map(([t0, t1, v]) => {
              const x0 = s.x(t0) + 3;
              const x1 = s.x(t1) - 3;
              if (x1 - x0 < 4) return null;
              return <rect key={t0} x={x0} y={s.y(v) - 3} width={x1 - x0} height={7} rx={3.5} className={styles.platform} />;
            })}
            {/* Coins: each LP fee harvest that lifted the floor. */}
            {harvests.map((e) => (
              <circle key={e.t} cx={s.x(e.t)} cy={s.y(e.to) - 12} r={4.5} className={styles.coin} opacity={0.35 + 0.65 * zoomed} />
            ))}
          </g>
          </g>
        ) : null}

        {/* Trail: a white halo under a solid line, so it reads on the sky and on the floor fill. */}
        <g clipPath={`url(#${clipId})`}>
          {oldOpacity > 0.01 ? (
            <g opacity={oldOpacity}>
              <path d={oldD} className={styles.trailHalo} />
              <path d={oldD} className={styles.trail} />
            </g>
          ) : null}
          {newD ? (
            <g opacity={f.priceOpacity}>
              <path d={newD} className={styles.trailHalo} />
              <path d={newD} className={styles.trail} />
            </g>
          ) : null}
        </g>

        {/* Trampoline net at the arbitrage line. */}
        {yArb !== null ? (
          <g className={styles.net}>
            <line x1={netX0} x2={netX0} y1={yArb} y2={yArb + 22} className={styles.post} />
            <line x1={netX1 - 8} x2={netX1 - 8} y1={yArb} y2={yArb + 22} className={styles.post} />
            <path d={netPath(netX0, netX1 - 8, yArb, contact)} className={styles.netLine} />
          </g>
        ) : null}

        {/* The ball: its bottom sits on the value. */}
        <g transform={`translate(${xHead.toFixed(1)} ${yHead.toFixed(1)})`} opacity={f.priceOpacity}>
          <ellipse cx={0} cy={1} rx={p.r * 0.9} ry={2.2} className={styles.shadow} />
          <g transform={`scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(0 ${-p.r})`}>
            <circle r={p.r} fill="url(#v10-ball)" className={styles.ball} />
            <Face r={p.r} mood={mood} look={Math.max(-1, Math.min(1, slope / 3))} />
          </g>
        </g>
      </svg>

      {/* HTML chips over the scene. */}
      <div className={styles.overlay}>
        <div className={styles.badges}>
          {madeUp ? <span className={`${styles.badge} ${styles.badgeIllu}`}>{ILLUSTRATION}</span> : null}
          {zoomed > 0.5 ? <span className={styles.badge}>{REAL_SCALE_LABEL}</span> : null}
        </div>

        {f.beatIndex <= 2 && splitShow > 0 ? <SplitBar m={m} f={f} opacity={splitShow} top={hundredY + p.r * 2 + 14} /> : null}

        {wide > 0.05 && f.t > 0 ? (
          <Chip x={p.right} y={hundredY - 8} anchor="bottom-right" tone="soft" opacity={wide}>
            {CHART_COPY.hundred}
          </Chip>
        ) : null}

        {f.t >= f.peak.t && wide > 0.05 ? (
          <Chip x={s.x(f.peak.t)} y={s.y(f.peak.value) - p.r * 2 - 10} anchor="bottom" tone="ball" opacity={wide}>
            {CHART_COPY.peak(f.peak.value)}
          </Chip>
        ) : null}

        {f.feesPct !== null && zoomed > 0.6 && runs.length > 2 ? (
          <Chip x={s.x(steps[0]![0]) + 4} y={s.y(steps[0]![1]) + 42} anchor="left-top" tone="floor" opacity={ramp(zoomed, 0.6, 1) * (1 - ramp(f.pos, 5, 5.15))}>
            {CHART_COPY.fromFees(f.feesPct)}
          </Chip>
        ) : null}

        {yArb !== null ? (
          <Chip x={netX0 - 8} y={yArb + 6} anchor="right-top" tone="net">
            {CHART_COPY.arbLine}
          </Chip>
        ) : null}

        {f.dip && f.beat === "bounce" ? (
          <Chip x={s.x(f.dip.t)} y={s.y(f.dip.value) + 10} anchor="top" tone="net" opacity={ramp(f.beatProgress, 0.3, 0.45)}>
            {CHART_COPY.bounce}
          </Chip>
        ) : null}

        {exitsEvent && f.exitsPct !== null ? (
          <Chip x={s.x(exitsEvent.t)} y={s.y(exitsEvent.to) - 26} anchor="bottom" tone="floor" opacity={1 - redeemOn}>
            {CHART_COPY.fromExits(f.exitsPct)}
          </Chip>
        ) : null}

        {steps.length && f.floorReveal > 0.5 && f.beat !== "redeem" ? (
          <Chip
            x={zoomed > 0.5 ? s.x(steps[0]![0]) + 4 : s.x(steps[0]![0]) - 6}
            y={s.y(steps[0]![1]) + floorShift + (zoomed > 0.5 ? 10 : -10)}
            anchor={zoomed > 0.5 ? "left-top" : "right-top"}
            tone="floorSolid"
            opacity={ramp(f.floorReveal, 0.5, 1)}
          >
            {CHART_COPY.floor}
          </Chip>
        ) : null}

        {redeemOn > 0 && lastTread ? (
          <Chip x={xHead} y={s.y(lastTread[2]) - p.r * 2 - 14} anchor="bottom-right" tone="redeem" opacity={ramp(redeemOn, 0.15, 0.6)}>
            {CHART_COPY.redeem(storyNetFinal(m))}
          </Chip>
        ) : null}
      </div>
    </>
  );
}

/** Three soft clouds drifting left with the scroll position (not with time); they wrap around. */
function Clouds({ w, h, pos }: { w: number; h: number; pos: number }) {
  const small = w < 480;
  const wrap = (x: number) => ((((x + 0.2) % 1.4) + 1.4) % 1.4) - 0.2;
  const clouds: Array<[start: number, speed: number, y: number, scale: number]> = [
    [0.7, 0.09, 0.2, small ? 0.7 : 1],
    [0.28, 0.06, 0.4, small ? 0.5 : 0.75],
    [1.0, 0.12, 0.62, small ? 0.45 : 0.6],
  ];
  return (
    <g aria-hidden>
      {clouds.map(([start, speed, y, sc], i) => (
        <g key={i} transform={`translate(${(w * wrap(start - pos * speed)).toFixed(1)} ${(h * y).toFixed(1)}) scale(${sc})`} className={styles.cloud}>
          <ellipse cx={0} cy={0} rx={34} ry={14} />
          <ellipse cx={-14} cy={-8} rx={16} ry={13} />
          <ellipse cx={10} cy={-12} rx={18} ry={16} />
        </g>
      ))}
    </g>
  );
}

/** The ball's face: eyes look along the motion; the mouth carries the mood. */
function Face({ r, mood, look }: { r: number; mood: Mood; look: number }) {
  const ex = r * 0.36;
  const ey = -r * 0.12;
  const pupil = r * 0.16;
  const dy = -look * r * 0.1;
  const eyes =
    mood === "squeeze" ? (
      <>
        <path d={`M${-ex - pupil},${ey} l${pupil},${-pupil * 0.8} l${pupil},${pupil * 0.8}`} className={styles.faceLine} />
        <path d={`M${ex - pupil},${ey} l${pupil},${-pupil * 0.8} l${pupil},${pupil * 0.8}`} className={styles.faceLine} />
      </>
    ) : mood === "sleepy" ? (
      <>
        <path d={`M${-ex - pupil},${ey} q${pupil},${pupil} ${pupil * 2},0`} className={styles.faceLine} />
        <path d={`M${ex - pupil},${ey} q${pupil},${pupil} ${pupil * 2},0`} className={styles.faceLine} />
      </>
    ) : (
      <>
        <circle cx={-ex + 1} cy={ey + dy} r={pupil} className={styles.faceFill} />
        <circle cx={ex + 1} cy={ey + dy} r={pupil} className={styles.faceFill} />
      </>
    );
  const my = r * 0.36;
  const mw = r * 0.34;
  const mouth =
    mood === "happy" || mood === "relief" ? (
      <path d={`M${-mw},${my - 2} q${mw},${mw * 0.9} ${mw * 2},0`} className={styles.faceLine} />
    ) : mood === "worried" ? (
      <ellipse cx={0} cy={my} rx={r * 0.12} ry={r * 0.15} className={styles.faceFill} />
    ) : mood === "squeeze" ? (
      <path d={`M${-mw},${my} h${mw * 2}`} className={styles.faceLine} />
    ) : (
      <path d={`M${-mw * 0.7},${my - 1} q${mw * 0.7},${mw * 0.5} ${mw * 1.4},0`} className={styles.faceLine} />
    );
  return (
    <g>
      {eyes}
      {mouth}
      <circle cx={-r * 0.62} cy={r * 0.22} r={r * 0.14} className={styles.blush} />
      <circle cx={r * 0.62} cy={r * 0.22} r={r * 0.14} className={styles.blush} />
    </g>
  );
}

type Anchor = "bottom" | "top" | "left-bottom" | "left-top" | "right-top" | "bottom-right";
type Tone = "soft" | "ball" | "floor" | "floorSolid" | "net" | "redeem";

function Chip({ x, y, anchor, tone, opacity = 1, children }: { x: number; y: number; anchor: Anchor; tone: Tone; opacity?: number; children: ReactNode }) {
  if (opacity <= 0.01) return null;
  return (
    <span className={`${styles.chip} ${styles[`tone_${tone}`]}`} data-anchor={anchor} style={{ left: x, top: y, opacity } as CSSProperties}>
      {children}
    </span>
  );
}

/** Presale: the raise fills a rounded bar; split: it breaks into floor / market / the two cuts. */
function SplitBar({ m, f, opacity, top }: { m: LaunchMath; f: StoryFrame; opacity: number; top: number }) {
  const fill = f.raisedUsd / m.raiseUsd;
  const sp = f.splitProgress;
  const gap = 6 * sp;
  const segs = [
    { key: "floor", share: m.split.floorUsd / m.raiseUsd, label: CHART_COPY.floorShare(Math.round(m.v * 100)), cls: styles.segFloor },
    { key: "market", share: m.split.poolUsd / m.raiseUsd, label: CHART_COPY.market, cls: styles.segMarket },
    { key: "cuts", share: (m.split.creatorUsd + m.split.platformUsd) / m.raiseUsd, label: CHART_COPY.fees(pct(m.split.creatorUsd, m), pct(m.split.platformUsd, m)), cls: styles.segCuts },
  ];
  return (
    <div className={styles.split} style={{ opacity, top }}>
      <div className={styles.splitHead}>
        <span>{CHART_COPY.raised(f.raisedUsd)}</span>
      </div>
      <div className={styles.splitBar} style={{ gap }}>
        {sp <= 0 ? (
          <span className={styles.segRaise} style={{ width: `${(fill * 100).toFixed(2)}%` }} />
        ) : (
          segs.map((g) => <span key={g.key} className={`${styles.seg} ${g.cls}`} style={{ flexGrow: g.share }} />)
        )}
      </div>
      {sp > 0 ? (
        <div className={styles.splitLegend} style={{ opacity: ramp(sp, 0.3, 0.8) }}>
          {segs.map((g) => (
            <span key={g.key} className={styles.legendItem} style={{ flexGrow: g.share }}>
              <i className={g.cls} />
              {g.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
