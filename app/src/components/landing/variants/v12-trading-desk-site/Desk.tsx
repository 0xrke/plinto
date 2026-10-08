"use client";

import { memo, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEAT_START, STORY_T_END, T_GRAD, range } from "@/lib/landing/sim/timeline";
import { IconTile } from "@/components/ui/Tiles";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  BrandChartFrame,
  CHART_COPY,
  STORY_TITLE,
  TILE_FLOOR,
  TILE_NOW,
  floorSharePct,
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

/*
 * The trading desk of v02 in the site's style: a cloud desk panel holding one midnight chart card
 * (price, floor staircase at real scale, arbitrage line, volume lane, price tags), four status tiles
 * (beat, your $100, floor pays back, vault) and the landing's rail over the caption. Every value is a
 * pure function of the frame, so scrolling back reverses exactly.
 */

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
const usd = (v: number, d = 2) => `$${v.toFixed(d)}`;

interface Tag {
  id: string;
  y: number;
  label: string;
  cls: string;
  opacity?: number;
}

/** The chart's plot box for a w×h card (phones and narrow stills are compact). */
function plotBox(w: number, h: number) {
  const compact = w < 560;
  const padT = compact ? 42 : 50;
  const laneH = compact ? 36 : 54;
  const laneGap = compact ? 10 : 14;
  const labelH = compact ? 22 : 30;
  return { compact, padT, laneH, laneGap, labelH, ph: Math.max(1, h - padT - laneGap - laneH - labelH) };
}

function Chart({ m, frame, w, h, activeIndex }: { m: LaunchMath; frame: StoryFrame; w: number; h: number; activeIndex: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { compact, padT, laneH, laneGap, labelH, ph } = plotBox(w, h);
  const charW = compact ? 6 : 6.6;
  const padL = compact ? 12 : 18;
  const padR = compact ? 64 : 112;
  const pw = Math.max(1, w - padL - padR);
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

  // Price: the engine's value path.
  const pts = frame.path.map(([t, v]) => [x(t), y(v)] as [number, number]);
  const priceD = linePath(pts);
  const head = frame.valueOf100;
  const hx = x(frame.t);
  const hy = y(head);

  // Floor staircase (real scale): the engine's vertices, wiped in during the split, a slab under it.
  const steps = frame.floorSteps.map(([t, v]) => [x(t), y(v)] as [number, number]);
  const floorD = steps.length ? linePath(steps) : "";
  const slabD = steps.length ? `${floorD}L${steps[steps.length - 1]![0].toFixed(1)} ${bottom + 1}L${steps[0]![0].toFixed(1)} ${bottom + 1}Z` : "";
  const revealW = x(T_GRAD) - padL + frame.floorReveal * (hx - x(T_GRAD)) + 2;
  const floorOpacity = Math.min(1, frame.floorReveal * 1.4);

  // Arbitrage line: arbLineRatio × the staircase from the split on, faint until the bounce.
  const arbPts = frame.floorSteps.map(([t, v]) => [x(t), y(v * m.arbLineRatio)] as [number, number]);
  const arbD = arbPts.length ? linePath(arbPts) : "";
  const stripD = arbPts.length ? `${floorD}${arbPts.slice().reverse().map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join("")}Z` : "";
  const arbOn = arbStrength(frame);
  const arbStart = frame.floorSteps[0];

  const bars = volumeBars(m, frame);
  const trading = frame.t > TRADE_START;

  const redeemOn = frame.redeemProgress > 0 && frame.floorNet100 !== null;
  const pxFade = frame.priceOpacity * (1 - range(frame.redeemProgress, 0.2, 0.5));

  const tagH = compact ? 18 : 22;
  const tagList: Tag[] = [];
  if (pxFade > 0.02) tagList.push({ id: "px", y: hy, label: usd(head), cls: s.tagPx, opacity: pxFade });
  if (frame.floor100 !== null && frame.floorReveal > 0.5) tagList.push({ id: "fl", y: y(frame.floor100), label: usd(frame.floor100), cls: s.tagFloor });
  // At the redeem the arbitrage tag hands its slot to the redeem tag, so the axis keeps two tags.
  const arbTagOn = arbOn * (1 - range(frame.redeemProgress, 0, 0.35));
  if (frame.arbLine100 !== null && arbTagOn > 0.02) tagList.push({ id: "arb", y: y(frame.arbLine100), label: usd(frame.arbLine100), cls: s.tagArb, opacity: arbTagOn });
  if (redeemOn)
    tagList.push({
      id: "rd",
      y: y(frame.floorNet100!),
      label: compact ? usd(frame.floorNet100!) : `${CHART_COPY.redeemWord} ${usd(frame.floorNet100!)}`,
      cls: s.tagRedeem,
      opacity: frame.redeemProgress,
    });
  const tags = spreadTags(
    tagList.filter((t) => t.y >= padT - 2 && t.y <= bottom + 2),
    tagH + 6,
    padT - 10,
    bottom + 10,
  );
  const tickHidden = (ty: number) => tags.some((t) => Math.abs(t.ty - ty) < tagH + 4);

  // Session labels: the ones with room on wide screens; on phones only the active one.
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
          <rect x={padL} y={padT - 1} width={Math.max(0, revealW)} height={ph + 2} />
        </clipPath>
      </defs>

      {/* presale band and session dividers */}
      <rect x={padL} y={padT} width={Math.max(0, x(TRADE_START) - padL)} height={laneBottom - padT} rx={6} className={s.preBand} />
      {sessions.map(({ key, sx, room, on }) => {
        const label = BEAT_LABELS[key];
        const fits = room > label.length * (compact ? 6.2 : 6.8) + 12 && sx < padL + pw - (compact ? 40 : 52);
        const show = compact ? on && fits : fits;
        return (
          <g key={key}>
            {BEAT_START[key] > 0 && sx < padL + pw ? <line x1={sx} x2={sx} y1={padT} y2={laneBottom} className={s.session} /> : null}
            {show ? (
              <text x={sx + 6} y={laneBottom + (compact ? 15 : 20)} className={on ? s.sessionOn : s.sessionLabel}>
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
              {usd(v, decimals)}
            </text>
          )}
        </g>
      ))}

      <g clipPath={`url(#plot${uid})`}>
        {/* entry reference */}
        <line x1={padL} x2={padL + pw} y1={y(100)} y2={y(100)} className={s.entry} />
        <text x={padL + 6} y={y(100) - 7} className={s.entryLabel}>
          {CHART_COPY.hundred}
        </text>

        {/* floor: mint staircase over a flat slab, the arbitrage strip under it */}
        {floorD ? (
          <g clipPath={`url(#reveal${uid})`} opacity={floorOpacity}>
            <path d={slabD} className={s.slab} />
            <path d={stripD} className={s.strip} opacity={arbOn} />
            <path d={floorD} className={s.floor} />
            {frame.events.map((e) => (
              <circle key={e.t} cx={x(e.t)} cy={y(e.to)} r={compact ? 2.5 : 3} className={s.eventDot} />
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
            <text x={x(arbStart[0]) + 6} y={y(arbStart[1]) - 8} className={s.floorLabel}>
              {CHART_COPY.floor}
            </text>
            <text x={x(arbStart[0]) + 6} y={y(arbStart[1] * m.arbLineRatio) + 16} className={s.arbLabel} opacity={Math.max(0.6, arbOn)}>
              {CHART_COPY.arbLine}
            </text>
          </g>
        ) : null}

        {/* price */}
        <path d={priceD} className={s.price} opacity={frame.priceOpacity} />

        {/* bounce marker: the price meets the dashed arbitrage line and turns up */}
        {frame.dip && frame.arbLine100 !== null ? (
          <g className={s.dip}>
            <circle cx={x(frame.dip.t)} cy={y(frame.dip.value)} r={compact ? 8 : 10} className={s.dipHalo} />
            <circle cx={x(frame.dip.t)} cy={y(frame.dip.value)} r={compact ? 4 : 5} className={s.dipDot} />
            <text x={x(frame.dip.t)} y={y(frame.dip.value) + (compact ? 22 : 26)} textAnchor="middle" className={s.dipLabel}>
              {CHART_COPY.bounce}
            </text>
          </g>
        ) : null}

        {/* redeem: what the floor pays back */}
        {redeemOn ? (
          <line
            x1={x(BEAT_START.redeem)}
            x2={hx}
            y1={y(frame.floorNet100!)}
            y2={y(frame.floorNet100!)}
            className={s.redeem}
            opacity={frame.redeemProgress}
          />
        ) : null}

        {/* last price guide + head */}
        <g opacity={pxFade}>
          <line x1={hx} x2={padL + pw} y1={hy} y2={hy} className={s.guide} />
          {trading ? <circle cx={hx} cy={hy} r={compact ? 7 : 9} className={s.headHalo} /> : null}
          <circle cx={hx} cy={hy} r={compact ? 4 : 4.5} className={s.headDot} />
        </g>
      </g>

      {/* volume lane */}
      <g>
        <line x1={padL} x2={padL + pw} y1={laneBottom} y2={laneBottom} className={s.grid} />
        <text x={padL + 6} y={laneTop + (compact ? 9 : 11)} className={s.laneLabel}>
          {trading ? "Volume · illustration" : "Deposits"}
        </text>
        {bars.map((b) => {
          const x0 = x(b.t0);
          const x1 = x(Math.min(b.t1, STORY_T_END));
          const bw = Math.max(1, (x1 - x0) * 0.62);
          const bh = Math.max(1, b.v * (laneH - (compact ? 13 : 18)));
          return (
            <rect
              key={`${b.kind === "deposit" ? "d" : "t"}${b.b}`}
              x={(x0 + x1) / 2 - bw / 2}
              y={laneBottom - bh}
              width={bw}
              height={bh}
              rx={Math.min(2.5, bw / 3)}
              className={b.kind === "deposit" ? s.volDep : b.kind === "down" ? s.volDown : s.volUp}
              opacity={b.live ? 1 : 0.75}
            />
          );
        })}
      </g>

      {/* axis tags: pills like the landing's value chips */}
      {tags.map((t) => {
        const tw = Math.min(padR - 4, Math.max(compact ? 48 : 64, t.label.length * charW + 16));
        return (
          <g key={t.id} className={t.cls} opacity={t.opacity ?? 1} transform={`translate(${padL + pw + 3} ${t.ty})`}>
            <rect x={0} y={-tagH / 2} width={tw} height={tagH} rx={tagH / 2} />
            <text x={tw / 2} y={compact ? 3.5 : 4} textAnchor="middle">
              {t.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- presale / split ticket (a raised chip card on the midnight chart) ---------- */

function Allocation({ m, frame, top }: { m: LaunchMath; frame: StoryFrame; top?: number }) {
  const fade = 1 - range(frame.pos, 2.05, 2.4);
  if (fade <= 0) return null;
  const fill = m.raiseUsd > 0 ? frame.raisedUsd / m.raiseUsd : 0;
  const sp = frame.splitProgress;
  const pct = (v: number) => Math.round((v / m.raiseUsd) * 100);
  const segs = [
    { k: "floor", w: m.split.floorUsd, cls: s.segFloor },
    { k: "pool", w: m.split.poolUsd, cls: s.segPool },
    { k: "cr", w: m.split.creatorUsd, cls: s.segFees },
    { k: "pl", w: m.split.platformUsd, cls: s.segFees },
  ];
  const cuts = m.split.creatorUsd + m.split.platformUsd;
  return (
    <div className={s.alloc} style={{ opacity: fade, top }} aria-hidden>
      <div className={s.allocHead}>
        <span className={s.allocPhase} data-phase={sp > 0.5 ? "graduated" : "presale"}>
          {sp > 0.5 ? "Graduated" : "Presale"}
        </span>
        <b className="tnum">
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
            <dt>
              <i className={s.swFloor} />
              <span>
                {CHART_COPY.floorShare(pct(m.split.floorUsd))}<span className={s.rowWhere}> · vault</span>
              </span>
            </dt>
            <dd>{formatUsdWhole(m.split.floorUsd)}</dd>
          </div>
          <div>
            <dt>
              <i className={s.swPool} />
              <span>
                {CHART_COPY.market} {pct(m.split.poolUsd)}%<span className={s.rowWhere}> · pool</span>
              </span>
            </dt>
            <dd>{formatUsdWhole(m.split.poolUsd)}</dd>
          </div>
          <div className={s.rowDim}>
            <dt>
              <i className={s.swFees} />
              <span>
                Fees<span className={s.rowWhere}> {CHART_COPY.fees(pct(m.split.creatorUsd), pct(m.split.platformUsd))}</span>
              </span>
            </dt>
            <dd>{formatUsdWhole(cuts)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/* ---------- rail (the landing's) ---------- */

const Rail = memo(function Rail({ active, onJump }: { active: number; onJump?: (i: number) => void }) {
  return (
    <nav className={s.rail} aria-label="Story steps" data-rail>
      <ol className={s.railList}>
        {BEAT_KEYS.map((k, i) => (
          <li key={k} className={s.railItem}>
            <button
              type="button"
              className={s.railBtn}
              aria-label={railLabel(i)}
              aria-current={i === active ? "step" : undefined}
              style={{ "--fill": `var(--q${i}, 1)` } as CSSProperties}
              onClick={() => onJump?.(i)}
            >
              <span className={s.railTrack} aria-hidden>
                <span className={s.railFill} />
              </span>
              <span className={s.railLabel} aria-hidden>
                {BEAT_LABELS[k]}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
});

/* ---------- desk ---------- */

export interface DeskProps {
  m: LaunchMath;
  frame: StoryFrame;
  activeIndex: number;
  /** Live: header, rail and caption. Still: chart and status tiles only (StoryStills prints the caption). */
  mode: "live" | "still";
  caption?: string;
  onJump?: (i: number) => void;
}

export function Desk({ m, frame, activeIndex, mode, caption, onJump }: DeskProps) {
  const live = mode === "live";
  const { ref, w, h } = useSize(live ? { w: 960, h: 480 } : { w: 520, h: 300 });
  const { now, floor } = tileValues(frame);
  const vault = vaultUsd(m, frame);
  const key = BEAT_KEYS[activeIndex]!;
  const num = String(activeIndex + 1).padStart(2, "0");
  const up = frame.valueOf100 >= 100;
  // Compact charts park the ticket just under the $100 line, clear of the price and the floor.
  const box = plotBox(w, h);
  const ticketTop = box.compact ? box.padT + (1 - (100 - frame.y.min) / (frame.y.max - frame.y.min)) * box.ph + 16 : undefined;

  return (
    <div className={`${BRAND_CLASS.panel} ${s.desk} ${live ? s.deskLive : s.deskStill}`} data-desk={mode}>
      {live ? (
        <header className={s.head}>
          <span className={s.titleRow}>
            <span className={`${s.title} heading text-ink`}>{STORY_TITLE}</span>
            <span className={`chip ${s.wideOnly}`}>
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
          </span>
          <span className={`chip ${s.event}`} aria-hidden data-part="event">
            <span className={`${s.eventKey} ${s.wideOnly} tnum`}>T+{frame.t.toFixed(2)}</span>
            <span className={s.eventText}>{tickerEvent(m, frame)}</span>
          </span>
        </header>
      ) : null}

      <BrandChartFrame
        className={s.chart}
        size={live ? "stage" : "still"}
        style={live ? undefined : { height: w < 560 ? 360 : 300 }}
        inset="full"
        illustration={showsIllustration(frame)}
        scale={frame.zoom > 0.02 ? "real" : null}
        scaleOpacity={Math.min(1, frame.zoom * 2)}
      >
        <div ref={ref} className={s.plot}>
          <Chart m={m} frame={frame} w={w} h={h} activeIndex={live ? activeIndex : frame.beatIndex} />
        </div>
        <Allocation m={m} frame={frame} top={ticketTop} />
      </BrandChartFrame>

      <dl className={s.status}>
        <div className={`tile ${s.cell}`}>
          <IconTile tone="violet" size={40} className={s.beatIcon}>
            {num}
          </IconTile>
          <div className={s.cellText}>
            <dt>Beat {activeIndex + 1} of 8</dt>
            <dd className={s.value}>{BEAT_LABELS[key]}</dd>
          </div>
        </div>
        <div className={`tile ${s.cell}`}>
          <div className={s.cellText}>
            <dt>
              <i className={s.mkPrice} aria-hidden />
              {TILE_NOW}
            </dt>
            <dd className={`${s.value} tnum`}>
              <span data-part="tile-now">{now}</span>
              {frame.redeemProgress < 1 ? (
                <span className={`pill pill-sm ${up ? "pill-neutral" : "pill-risk"} ${s.delta}`}>{deltaPct(frame.valueOf100)}</span>
              ) : null}
            </dd>
          </div>
        </div>
        <div className={`tile-floor ${s.cell} ${s.cellFloor}`}>
          <div className={s.cellText}>
            <dt>
              <i className={s.mkFloor} aria-hidden />
              {TILE_FLOOR}
            </dt>
            <dd className={`${s.value} tnum`} data-part="tile-floor">
              {floor}
            </dd>
          </div>
        </div>
        <div className={`tile ${s.cell}`}>
          <div className={s.cellText}>
            <dt>Vault</dt>
            <dd className={`${s.value} tnum`}>{vault === null ? "—" : formatUsdWhole(vault)}</dd>
          </div>
        </div>
      </dl>

      {live ? <Rail active={activeIndex} onJump={onJump} /> : null}
      {live ? (
        <p className={s.captionLine} aria-hidden data-part="caption">
          <span className={`${s.prompt} tnum`}>{num}</span>
          <span key={key} className={s.captionText}>
            {caption}
          </span>
        </p>
      ) : null}
    </div>
  );
}
