"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEAT_START, STORY_T_END, T_GRAD, range } from "@/lib/landing/sim/timeline";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  CHART_COPY,
  ILLUSTRATION,
  REAL_SCALE_LABEL,
  STORY_TITLE,
  TILE_FLOOR,
  TILE_NOW,
  formatUsdWhole,
  railLabel,
  tileValues,
  type StoryFrame,
} from "../shared";
import {
  TRADE_START,
  arbStrength,
  deltaPct,
  niceTicks,
  preK,
  showsIllustration,
  spreadTags,
  tickerEvent,
  vaultUsd,
  volumeBars,
  warpT,
} from "./deskMath";
import s from "./desk.module.css";

/* ---------- size ---------- */

function useSize(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      setSize((p) => (Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

/* ---------- chart ---------- */

/** Time-axis window (warped story time): at least this span, and this much room ahead of the head. */
const X_MIN_SPAN = 2.6;
const X_LEAD = 0.9;
const linePath = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
const SESSIONS = BEAT_KEYS.filter((k) => k !== "steps");

interface Tag {
  id: string;
  y: number;
  label: string;
  cls: string;
  opacity?: number;
}

function Chart({ m, frame, w, h, activeIndex }: { m: LaunchMath; frame: StoryFrame; w: number; h: number; activeIndex: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const compact = w < 560;
  const charW = compact ? 6.1 : 6.7;
  const padL = compact ? 6 : 12;
  const padR = compact ? 54 : 100;
  const padT = compact ? 30 : 40;
  const laneH = compact ? 40 : 58;
  const laneGap = compact ? 10 : 14;
  const labelH = compact ? 20 : 26;
  const pw = Math.max(1, w - padL - padR);
  const ph = Math.max(1, h - padT - laneGap - laneH - labelH);
  const bottom = padT + ph;
  const laneTop = bottom + laneGap;
  const laneBottom = laneTop + laneH;

  // x: warped story time following the head, the full story at the end.
  const k = preK(frame);
  const xEnd = warpT(STORY_T_END, k);
  const xMax = Math.min(xEnd, Math.max(X_MIN_SPAN, warpT(frame.t, k) + X_LEAD));
  const x = (t: number) => padL + (warpT(t, k) / xMax) * pw;
  const { min, max } = frame.y;
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * ph;

  const { ticks, decimals } = niceTicks(min, max, compact ? 4 : 5);

  // Price: the engine's value path as one line with a soft area under it.
  const pts = frame.path.map(([t, v]) => [x(t), y(v)] as [number, number]);
  const priceD = linePath(pts);
  const areaD = pts.length ? `${priceD}L${pts[pts.length - 1]![0].toFixed(1)} ${bottom}L${pts[0]![0].toFixed(1)} ${bottom}Z` : "";
  const head = frame.valueOf100;
  const hx = x(frame.t);
  const hy = y(head);

  // Floor staircase (real scale): the engine's vertices, wiped in during the split.
  const steps = frame.floorSteps.map(([t, v]) => [x(t), y(v)] as [number, number]);
  const floorD = steps.length ? linePath(steps) : "";
  const band = compact ? 12 : 16;
  const bandD = steps.length
    ? `${floorD}${steps
        .slice()
        .reverse()
        .map(([px, py]) => `L${px.toFixed(1)} ${(py + band).toFixed(1)}`)
        .join("")}Z`
    : "";
  const revealW = x(T_GRAD) - padL + frame.floorReveal * (hx - x(T_GRAD)) + 2;
  const floorOpacity = Math.min(1, frame.floorReveal * 1.4);

  // Arbitrage line: arbLineRatio × the staircase from the split on, faint until the bounce.
  const arbD = steps.length ? linePath(frame.floorSteps.map(([t, v]) => [x(t), y(v * m.arbLineRatio)])) : "";
  const arbOn = arbStrength(frame);
  const arbStart = frame.floorSteps[0];

  // Volume lane.
  const bars = volumeBars(m, frame);
  const trading = frame.t > TRADE_START;

  const redeemOn = frame.redeemProgress > 0 && frame.floorNet100 !== null;
  const pxFade = frame.priceOpacity * (1 - range(frame.redeemProgress, 0.2, 0.5));

  const tagH = compact ? 18 : 20;
  const tagList: Tag[] = [];
  if (pxFade > 0.02) tagList.push({ id: "px", y: hy, label: head.toFixed(2), cls: s.tagPx, opacity: pxFade });
  if (frame.floor100 !== null && frame.floorReveal > 0.5) tagList.push({ id: "fl", y: y(frame.floor100), label: frame.floor100.toFixed(2), cls: s.tagFloor });
  if (frame.arbLine100 !== null) tagList.push({ id: "arb", y: y(frame.arbLine100), label: frame.arbLine100.toFixed(2), cls: s.tagArb, opacity: arbOn });
  if (redeemOn)
    tagList.push({
      id: "rd",
      y: y(frame.floorNet100!),
      label: compact ? frame.floorNet100!.toFixed(2) : `${CHART_COPY.redeemWord} ${frame.floorNet100!.toFixed(2)}`,
      cls: s.tagRedeem,
      opacity: frame.redeemProgress,
    });
  const tags = spreadTags(
    tagList.filter((t) => t.y >= padT - 2 && t.y <= bottom + 2),
    tagH + 3,
    padT - 8,
    bottom + 8,
  );
  // Hide the tick labels a tag would cover.
  const tickHidden = (ty: number) => tags.some((t) => Math.abs(t.ty - ty) < tagH + 2);

  // Session labels: the ones with room on wide screens; on phones only the active session (none at steps).
  const sessions = SESSIONS.map((key, n) => {
    const sx = x(BEAT_START[key]);
    const next = n + 1 < SESSIONS.length ? x(BEAT_START[SESSIONS[n + 1]!]) : padL + pw;
    return { key, sx, room: next - sx, on: BEAT_KEYS.indexOf(key) === activeIndex };
  });

  return (
    <svg className={s.svg} viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" aria-hidden>
      <defs>
        <clipPath id={`plot${uid}`}>
          <rect x={padL} y={padT - 1} width={pw} height={ph + 2} />
        </clipPath>
        <clipPath id={`reveal${uid}`}>
          <rect x={padL} y={padT - 1} width={Math.max(0, revealW)} height={ph + band + 2} />
        </clipPath>
        <linearGradient id={`area${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--d-up)" stopOpacity="0.1" />
          <stop offset="1" stopColor="var(--d-up)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`pre${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--d-ink)" stopOpacity="0.035" />
          <stop offset="1" stopColor="var(--d-ink)" stopOpacity="0.01" />
        </linearGradient>
        <filter id={`glow${uid}`} x="-5%" y="-50%" width="110%" height="200%">
          <feGaussianBlur stdDeviation={compact ? 3 : 4.5} />
        </filter>
      </defs>

      {/* pre-market shading and session separators */}
      <rect x={padL} y={padT} width={Math.max(0, x(TRADE_START) - padL)} height={laneBottom - padT} fill={`url(#pre${uid})`} />
      {sessions.map(({ key, sx, room, on }) => {
        const label = BEAT_LABELS[key].toUpperCase();
        const fits = room > label.length * (compact ? 6.4 : 7) + 10 && sx < padL + pw - (compact ? 44 : 56);
        const show = compact ? on && fits : fits;
        return (
          <g key={key}>
            {BEAT_START[key] > 0 && sx < padL + pw ? <line x1={sx} x2={sx} y1={padT} y2={laneBottom} className={s.session} /> : null}
            {show ? (
              <text x={sx + 4} y={laneBottom + (compact ? 14 : 18)} className={on ? s.sessionOn : s.sessionLabel}>
                {label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* y grid + axis (labels under a tag are hidden) */}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={padL + pw} y1={y(v)} y2={y(v)} className={s.grid} />
          {tickHidden(y(v)) ? null : (
            <text x={padL + pw + 8} y={y(v) + 3.5} className={s.axis}>
              {v.toFixed(decimals)}
            </text>
          )}
        </g>
      ))}

      <g clipPath={`url(#plot${uid})`}>
        {/* entry reference */}
        <line x1={padL} x2={padL + pw} y1={y(100)} y2={y(100)} className={s.entry} />
        <text x={padL + 4} y={y(100) - 6} className={s.entryLabel}>
          {CHART_COPY.hundred}
        </text>

        {/* floor: glowing stepped band */}
        {floorD ? (
          <g clipPath={`url(#reveal${uid})`} opacity={floorOpacity}>
            <path d={bandD} className={s.band} />
            <path d={floorD} className={s.floorGlow} filter={`url(#glow${uid})`} />
            <path d={floorD} className={s.floor} />
            {frame.events.map((e) => (
              <circle key={e.t} cx={x(e.t)} cy={y(e.to)} r={compact ? 2 : 2.5} className={s.eventDot} />
            ))}
          </g>
        ) : null}

        {/* arbitrage line */}
        {arbD ? (
          <g clipPath={`url(#reveal${uid})`} opacity={floorOpacity * arbOn}>
            <path d={arbD} className={s.arb} />
          </g>
        ) : null}

        {/* in-plot legends (close-up only, where the two lines separate) */}
        {arbStart && frame.zoom > 0.5 && frame.floorReveal > 0.6 ? (
          <g opacity={Math.min(1, (frame.zoom - 0.5) * 2)}>
            <text x={x(arbStart[0]) + 6} y={y(arbStart[1]) - 9} className={s.floorLabel}>
              {CHART_COPY.floor.toUpperCase()}
            </text>
            <text x={x(arbStart[0]) + 6} y={y(arbStart[1] * m.arbLineRatio) + 15} className={s.arbLabel} opacity={Math.max(0.6, arbOn)}>
              {CHART_COPY.arbLine.toUpperCase()}
            </text>
          </g>
        ) : null}

        {/* price */}
        <g opacity={frame.priceOpacity}>
          <path d={areaD} fill={`url(#area${uid})`} />
          <path d={priceD} className={s.price} />
        </g>

        {/* bounce marker */}
        {frame.dip && frame.arbLine100 !== null ? (
          <g className={s.dip}>
            <circle cx={x(frame.dip.t)} cy={y(frame.dip.value)} r={compact ? 7 : 9} />
            <text x={x(frame.dip.t)} y={y(frame.dip.value) + (compact ? 20 : 24)} textAnchor="middle">
              {CHART_COPY.bounce}
            </text>
          </g>
        ) : null}

        {/* redeem: what the floor pays back */}
        {redeemOn ? (
          <g opacity={frame.redeemProgress} className={s.redeem}>
            <line x1={x(BEAT_START.redeem)} x2={hx} y1={y(frame.floorNet100!)} y2={y(frame.floorNet100!)} />
          </g>
        ) : null}

        {/* last price guide + head */}
        <g opacity={pxFade}>
          <line x1={hx} x2={padL + pw} y1={hy} y2={hy} className={s.guide} />
          {trading ? <circle cx={hx} cy={hy} r={compact ? 6 : 8} className={s.headGlow} /> : null}
          <circle cx={hx} cy={hy} r={compact ? 2.5 : 3} className={s.head} />
        </g>
      </g>

      {/* volume lane */}
      <g>
        <line x1={padL} x2={padL + pw} y1={laneBottom} y2={laneBottom} className={s.grid} />
        <text x={padL + 4} y={laneTop + (compact ? 9 : 11)} className={s.laneLabel}>
          {trading ? `VOL · ${ILLUSTRATION.toUpperCase()}` : "DEPOSITS"}
        </text>
        {bars.map((b) => {
          const x0 = x(b.t0);
          const x1 = x(Math.min(b.t1, STORY_T_END));
          const bw = Math.max(1, (x1 - x0) * 0.62);
          const bh = Math.max(1, b.v * (laneH - (compact ? 12 : 16)));
          return (
            <rect
              key={`${b.kind === "deposit" ? "d" : "t"}${b.b}`}
              x={(x0 + x1) / 2 - bw / 2}
              y={laneBottom - bh}
              width={bw}
              height={bh}
              rx={Math.min(1.5, bw / 4)}
              className={b.kind === "deposit" ? s.volDep : b.kind === "down" ? s.volDown : s.volUp}
              opacity={b.live ? 1 : 0.7}
            />
          );
        })}
      </g>

      {/* axis tags */}
      {tags.map((t) => {
        const tw = Math.max(compact ? 44 : 60, t.label.length * charW + 12);
        return (
          <g key={t.id} className={t.cls} opacity={t.opacity ?? 1} transform={`translate(${padL + pw + 2} ${t.ty})`}>
            <rect x={0} y={-tagH / 2} width={Math.min(tw, padR - 2)} height={tagH - 1} rx={4} />
            <text x={6} y={compact ? 4 : 4.5}>
              {t.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- presale / split ticket ---------- */

function Allocation({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const fade = 1 - range(frame.pos, 2.05, 2.4);
  if (fade <= 0) return null;
  const fill = m.raiseUsd > 0 ? frame.raisedUsd / m.raiseUsd : 0;
  const sp = frame.splitProgress;
  const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 100);
  const segs = [
    { k: "floor", w: m.split.floorUsd, cls: s.segFloor },
    { k: "pool", w: m.split.poolUsd, cls: s.segPool },
    { k: "cr", w: m.split.creatorUsd, cls: s.segCut },
    { k: "pl", w: m.split.platformUsd, cls: s.segCut },
  ];
  const cuts = m.split.creatorUsd + m.split.platformUsd;
  return (
    <div className={s.alloc} style={{ opacity: fade }} aria-hidden>
      <div className={s.allocHead}>
        <span>{sp > 0.5 ? "Graduated" : "Presale"}</span>
        <b className={s.num}>
          {formatUsdWhole(frame.raisedUsd)}
          <span className={s.allocOf}> / {formatUsdWhole(m.raiseUsd)}</span>
        </b>
      </div>
      <div className={s.allocBar}>
        <div className={s.allocFill} style={{ transform: `scaleX(${fill})`, opacity: 1 - sp }} />
        <div className={s.allocSegs} style={{ opacity: sp, gap: `${3 * sp}px` }}>
          {segs.map((g) => (
            <div key={g.k} className={g.cls} style={{ flexGrow: g.w }} />
          ))}
        </div>
      </div>
      <div className={s.allocRows}>
        <dl className={s.rows} style={{ opacity: 1 - sp }}>
          <div>
            <dt>Your order</dt>
            <dd>{formatUsdWhole(100)}</dd>
          </div>
          <div>
            <dt>Filled</dt>
            <dd>{Math.round(fill * 100)}%</dd>
          </div>
        </dl>
        <dl className={s.rows} style={{ opacity: sp }}>
          <div className={s.rowFloor}>
            <dt>{CHART_COPY.floorShare(pct(m.split.floorUsd))} · vault</dt>
            <dd>{formatUsdWhole(m.split.floorUsd)}</dd>
          </div>
          <div>
            <dt>
              {CHART_COPY.market} {pct(m.split.poolUsd)}% · pool
            </dt>
            <dd>{formatUsdWhole(m.split.poolUsd)}</dd>
          </div>
          <div className={s.rowDim}>
            <dt>Fees {CHART_COPY.fees(pct(m.split.creatorUsd), pct(m.split.platformUsd))}</dt>
            <dd>{formatUsdWhole(cuts)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/* ---------- panel ---------- */

export interface TerminalProps {
  m: LaunchMath;
  frame: StoryFrame;
  activeIndex: number;
  /** Live: ticker caption + rail. Still: chart and status only (StoryStills prints the caption). */
  mode: "live" | "still";
  caption?: string;
  onJump?: (i: number) => void;
}

export function Terminal({ m, frame, activeIndex, mode, caption, onJump }: TerminalProps) {
  const { ref, w, h } = useSize({ w: 960, h: 520 });
  const { now, floor } = tileValues(frame);
  const vault = vaultUsd(m, frame);
  const live = mode === "live";
  const key = BEAT_KEYS[activeIndex]!;
  const zoomed = frame.zoom > 0.02;

  return (
    <div className={`${s.panel} ${live ? s.panelLive : s.panelStill}`}>
      <div className={s.top}>
        <span className={s.brand}>
          <i className={s.dot} aria-hidden />
          {STORY_TITLE}
        </span>
        <span className={s.badges}>
          {showsIllustration(frame) ? <span className={s.badgeIllu}>{ILLUSTRATION}</span> : null}
          {zoomed ? <span className={`${s.badgeScale} ${s.wideOnly}`}>{REAL_SCALE_LABEL}</span> : null}
        </span>
      </div>

      <div className={s.chartWrap} ref={ref}>
        <Chart m={m} frame={frame} w={w} h={h} activeIndex={live ? activeIndex : frame.beatIndex} />
        <p className={s.event} aria-hidden>
          <span className={s.eventKey}>{live ? `T+${frame.t.toFixed(2)}` : `${frame.beatIndex + 1}/8`}</span>
          {tickerEvent(m, frame)}
        </p>
        {zoomed ? <p className={`${s.scaleNote} ${s.phoneOnly}`}>{REAL_SCALE_LABEL}</p> : null}
        <Allocation m={m} frame={frame} />
      </div>

      <dl className={s.status}>
        <div className={s.cell}>
          <dt>Beat</dt>
          <dd className={s.num}>
            <span>
              {String(activeIndex + 1).padStart(2, "0")}
              <span className={s.dim}>/08</span>
            </span>
            <span className={s.beatName}>{BEAT_LABELS[key]}</span>
          </dd>
        </div>
        <div className={s.cell}>
          <dt>{TILE_NOW}</dt>
          <dd className={s.num}>
            {now}
            {frame.redeemProgress < 1 ? <span className={frame.valueOf100 >= 100 ? s.deltaUp : s.deltaDown}>{deltaPct(frame.valueOf100)}</span> : null}
          </dd>
        </div>
        <div className={`${s.cell} ${s.cellFloor}`}>
          <dt>{TILE_FLOOR}</dt>
          <dd className={s.num}>{floor}</dd>
        </div>
        <div className={s.cell}>
          <dt>Vault</dt>
          <dd className={s.num}>{vault === null ? "—" : formatUsdWhole(vault)}</dd>
        </div>
      </dl>

      {live ? (
        <div className={s.ticker}>
          <div className={s.rail} data-rail>
            {BEAT_KEYS.map((k, i) => (
              <button
                key={k}
                type="button"
                className={s.railSeg}
                data-on={i === activeIndex ? "" : undefined}
                style={{ "--fill": `var(--q${i}, 1)` } as CSSProperties}
                onClick={() => onJump?.(i)}
                aria-label={railLabel(i)}
              >
                <span className={s.railLabel}>{BEAT_LABELS[k]}</span>
                <span className={s.railTrack}>
                  <span className={s.railFill} />
                </span>
              </button>
            ))}
          </div>
          <p className={s.captionLine} aria-hidden>
            <span className={s.prompt}>{String(activeIndex + 1).padStart(2, "0")} ›</span>
            <span key={key} className={s.captionText}>
              {caption}
              <i className={s.caret} />
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

