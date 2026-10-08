import type { CSSProperties, JSX, ReactNode } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEATS, easeInOut, storyBand, type StoryFrame } from "@/lib/landing/sim/story";
import { formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";
import { CHART_COPY, ILLUSTRATION, pctOfRaise, storyTradedUsd } from "./storyChartCopy";
import {
  VB,
  areaUnderD,
  clampPct,
  labelSide,
  makeScales,
  monotonePathD,
  niceTicks,
  ramp,
  stepPathD,
  stripBetweenD,
  type Scales,
} from "./storyChartGeometry";

export interface StoryChartProps {
  m: LaunchMath;
  /** From storyFrame(m, pos). */
  frame: StoryFrame;
  /** stage: fills the parent's height; still: a fixed 180px card. */
  variant: "stage" | "still";
  className?: string;
}

/*
 * "Follow your $100" over story time, hand-drawn SVG. A pure function of the frame: no timers, no
 * CSS transitions on values, no focusables (the root is aria-hidden; the steps carry the sr text).
 * The SVG is a unit box stretched over the plot with non-scaling strokes; dots and labels are HTML
 * placed in percent, so nothing distorts at any width. The floor is drawn from its event list as a
 * true staircase (exact vertical risers); only the made-up price path is smoothed (monotone, so it
 * never overshoots its samples).
 */

const SPLIT = BEATS.find((b) => b.key === "split")!;
const PRESALE_END = BEATS[0]!.end;
/** Raise column in the split beat: x centre and width in story time, height in chart units. */
const COL_T = SPLIT.start + 0.4 * (SPLIT.end - SPLIT.start);
const COL_W = 0.42;
const COL_TOP = 80;

const stroke = (color: string, width: number, extra: CSSProperties = {}): CSSProperties => ({ stroke: `var(--color-${color})`, strokeWidth: width, ...extra });
const ns = { vectorEffect: "non-scaling-stroke" as const, fill: "none" };

export function StoryChart({ m, frame, variant, className = "" }: StoryChartProps): JSX.Element {
  const f = frame;
  const s = makeScales(f.y);
  const beat = f.beat;
  const bp = f.beatProgress;
  const at = (key: StoryFrame["beat"]) => beat === key;

  // Floor: hidden before the split reveal, then a staircase with a soft slab under it.
  const floorOpacity = f.floorSteps.length ? (at("split") ? ramp(f.floorReveal, 0.5, 1) : f.floorReveal) : 0;
  const slabOpacity = f.floorSteps.length ? f.floorReveal : 0;
  const stepD = f.floorSteps.length ? stepPathD(f.floorSteps, s) : "";

  // Arbitrage line and the strip between it and the floor: from the bounce on.
  const arbOpacity = f.arbLine100 === null ? 0 : at("bounce") ? ramp(bp, 0, 0.2) : 1;

  const band = storyBand(m);
  const ticks = f.zoom > 0 ? niceTicks(band.min, band.max, 3) : [];
  const tickOpacity = ramp(f.zoom, 0.6, 1);
  const tickStep = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const tickLabel = (v: number) => (Number.isInteger(tickStep) && Number.isInteger(v) ? formatUsdWhole(v) : formatUsdCents(v));

  const head = { left: clampPct(s.pctX(f.t)), top: clampPct(s.pctY(f.valueOf100)) };
  const side = labelSide(head.left, head.top);
  const headLabelOpacity = at("redeem") ? 1 - ramp(f.redeemProgress, 0, 0.5) : 1;

  const harvests = f.events.filter((e) => e.kind === "harvest");
  const holders = f.events.find((e) => e.kind === "redeem" && e.beat === "exits");
  const f0 = m.floorPer100GrossUsd;
  const lastFee = harvests[harvests.length - 1];
  const feesOpacity = f.feesPct === null || !lastFee ? 0 : at("steps") ? ramp(bp, 0.5, 1) : at("bounce") ? 1 - ramp(bp, 0, 0.25) : 0;
  const exitsOpacity = f.exitsPct === null || !holders ? 0 : at("exits") ? ramp(bp, 0.5, 0.65) : at("redeem") ? 1 - ramp(f.redeemProgress, 0, 0.3) : 0;

  // The bounce label yields to the exits marker; the dip dot stays.
  const bounceLabelOpacity = at("exits") ? 1 - ramp(bp, 0.25, 0.45) : at("redeem") ? 0 : 1;

  const pillLive = f.illustrative;
  // The volume behind the staircase stays named until the close-up has shown it.
  const pillText = at("pump") || at("selloff") || at("steps") ? CHART_COPY.traded(storyTradedUsd(m)) : ILLUSTRATION;

  const redeemNet = f.floorNet100 ?? 0;
  const redeemDrop = f.redeemProgress > 0 ? easeInOut(f.redeemProgress) : 0;
  const redeemDotValue = f.valueOf100 + (redeemNet - f.valueOf100) * redeemDrop;

  return (
    <div
      aria-hidden
      data-chart={variant}
      className={`relative overflow-hidden rounded-tile bg-midnight ${variant === "still" ? "h-[180px]" : "h-full min-h-[180px]"} ${className}`}
      style={variant === "still" ? { height: 180 } : undefined}
    >
      <span data-part="pill" className={`pill pill-sm absolute left-3 top-2.5 z-10 ${pillLive ? "bg-butter text-ink" : "bg-midnight-chip text-on-dark-3"}`}>
        {pillText}
      </span>
      {f.zoom > 0 ? (
        <span
          data-part="closeup"
          className="pill pill-sm absolute right-3 top-2.5 z-10 bg-midnight-chip text-on-dark-2"
          style={{ opacity: f.zoom }}
        >
          {CHART_COPY.closeUp}
        </span>
      ) : null}

      <div className={`absolute inset-x-4 ${variant === "still" ? "bottom-3 top-9" : "bottom-4 top-11"}`}>
        <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* Presale band: the raise filling up, bottom to top. Fades out in the close-up. */}
          <g opacity={1 - f.zoom}>
            <rect x={0} y={0} width={s.xOf(PRESALE_END)} height={VB} style={{ fill: "var(--color-presale-soft)" }} fillOpacity={0.07} />
            <rect
              data-part="raise-fill"
              x={0}
              y={VB * (1 - f.raisedUsd / m.raiseUsd)}
              width={s.xOf(PRESALE_END)}
              height={(VB * f.raisedUsd) / m.raiseUsd}
              style={{ fill: "var(--color-presale-ring)" }}
              fillOpacity={0.2}
            />
          </g>
          {BEATS.slice(1)
            .filter((b, i, all) => b.start > 0 && all.findIndex((o) => o.start === b.start) === i)
            .map((b) => (
              <line key={b.key} x1={s.xOf(b.start)} x2={s.xOf(b.start)} y1={0} y2={VB} {...ns} style={stroke("midnight-line", 1)} />
            ))}
          {ticks.map((v) => (
            <line key={v} data-part="tick" x1={0} x2={VB} y1={s.yOf(v)} y2={s.yOf(v)} {...ns} style={stroke("midnight-line", 1)} opacity={tickOpacity} />
          ))}
          {/* $100 reference: what you paid. Out of range in the close-up. */}
          <line x1={0} x2={VB} y1={s.yOf(100)} y2={s.yOf(100)} {...ns} style={stroke("on-dark-3", 1)} strokeOpacity={0.5 * (1 - f.zoom)} strokeDasharray="4 5" />

          {at("split") ? <SplitColumn m={m} f={f} s={s} /> : null}

          {stepD ? (
            <>
              <path data-part="floor-slab" d={areaUnderD(f.floorSteps, s)} style={{ fill: "var(--color-mint)" }} fillOpacity={0.14 * slabOpacity} />
              {f.arbLine100 !== null ? (
                <>
                  <path data-part="arb-strip" d={stripBetweenD(f.floorSteps, m.arbLineRatio, s)} style={{ fill: "var(--color-risk-on-dark)" }} fillOpacity={0.12 * arbOpacity} />
                  <path
                    data-part="arb-line"
                    d={stepPathD(f.floorSteps, s, m.arbLineRatio)}
                    {...ns}
                    style={stroke("risk-on-dark", 1.5)}
                    strokeDasharray="5 4"
                    opacity={arbOpacity}
                  />
                </>
              ) : null}
              {feesOpacity > 0 && lastFee ? (
                <g data-part="fees" opacity={feesOpacity}>
                  <line x1={s.xOf(1)} x2={s.xOf(lastFee.t)} y1={s.yOf(f0)} y2={s.yOf(f0)} {...ns} style={stroke("on-dark-3", 1)} strokeDasharray="3 4" />
                  <line x1={s.xOf(lastFee.t + 0.2)} x2={s.xOf(lastFee.t + 0.2)} y1={s.yOf(f0)} y2={s.yOf(lastFee.to)} {...ns} style={stroke("mint", 1.5)} />
                </g>
              ) : null}
              <path
                data-part="floor-steps"
                data-vertices={f.floorSteps.length}
                d={stepD}
                {...ns}
                style={stroke("mint", 2.5)}
                strokeLinejoin="miter"
                opacity={floorOpacity}
              />
            </>
          ) : null}

          <path
            data-part="price"
            d={monotonePathD(f.path, s)}
            {...ns}
            className="stroke-white"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={f.priceOpacity}
          />
        </svg>

        {/* ---------- HTML labels (percent placed) ---------- */}
        <At y={s.pctY(100)} opacity={1 - f.zoom}>
          <span className="tnum absolute right-0 top-0 -translate-y-full pb-0.5 text-[11px] font-semibold text-on-dark-3">{CHART_COPY.hundred}</span>
        </At>
        {ticks.map((v) => (
          <At key={v} y={s.pctY(v)} opacity={tickOpacity}>
            <span data-part="tick-label" className="tnum absolute left-0 top-0 -translate-y-full pb-px text-[10.5px] font-semibold text-on-dark-3">
              {tickLabel(v)}
            </span>
          </At>
        ))}
        {at("presale") ? (
          <span className="tnum absolute bottom-1 left-1 whitespace-nowrap text-[11px] font-bold text-white">{CHART_COPY.raised(f.raisedUsd)}</span>
        ) : null}
        {at("split") ? <SplitLabels m={m} f={f} s={s} /> : null}
        {f.floor100 !== null && floorOpacity > 0 ? (
          <At x={s.pctX(f.floorSteps[0]![0])} y={clampPct(s.pctY(f.floorSteps[0]![1]), 8, 100)} opacity={floorOpacity}>
            <span data-part="floor-label" className="absolute left-0 top-0 -translate-y-full whitespace-nowrap pb-0.5 text-[11px] font-bold text-mint">
              {CHART_COPY.floor}
            </span>
          </At>
        ) : null}
        {f.arbLine100 !== null && f.floorSteps.length ? (
          <At x={s.pctX(f.floorSteps[0]![0])} y={clampPct(s.pctY(f.floorSteps[0]![1] * m.arbLineRatio), 0, 90)} opacity={arbOpacity}>
            <span data-part="arb-label" className="absolute left-0 top-0 whitespace-nowrap pt-0.5 text-[11px] font-bold text-risk-on-dark">
              {CHART_COPY.arbLine}
            </span>
          </At>
        ) : null}

        {/* Harvest risers: one dot per LP fee harvest, shown as the camera closes in. */}
        {f.zoom > 0
          ? harvests.map((e) => (
              <Dot key={e.t} part="harvest" left={s.pctX(e.t)} top={s.pctY(e.to)} className="h-1.5 w-1.5 bg-mint" opacity={f.zoom} />
            ))
          : null}
        {feesOpacity > 0 && lastFee && f.feesPct !== null ? (
          <At x={s.pctX(lastFee.t + 0.2)} y={s.pctY(f0)} opacity={feesOpacity}>
            <span data-part="fees-label" className="tnum absolute left-0 top-0 -translate-x-full whitespace-nowrap pr-1.5 pt-1 text-[11.5px] font-bold text-mint">
              {CHART_COPY.fromFees(f.feesPct)}
            </span>
          </At>
        ) : null}
        {f.zoom > 0 ? (
          <At x={s.pctX(f.peak.t)} opacity={ramp(f.zoom, 0.4, 0.8)}>
            <span data-part="peak" className="tnum pill pill-sm absolute left-0 top-0 -translate-x-1/2 bg-tile text-white">
              {CHART_COPY.peak(f.peak.value)}
            </span>
          </At>
        ) : null}
        {f.dip ? (
          <>
            <Dot part="bounce" left={s.pctX(f.dip.t)} top={s.pctY(f.dip.value)} className="h-2.5 w-2.5 bg-risk-on-dark ring-4 ring-white/10" />
            <At x={s.pctX(f.dip.t)} y={clampPct(s.pctY(f.dip.value), 0, 88)} opacity={bounceLabelOpacity}>
              <span data-part="bounce-label" className="absolute left-0 top-0 -translate-x-1/2 whitespace-nowrap pt-2 text-[11.5px] font-bold text-risk-on-dark">
                {CHART_COPY.bounce}
              </span>
            </At>
          </>
        ) : null}
        {exitsOpacity > 0 && holders && f.exitsPct !== null ? (
          <>
            <Dot part="exits" left={s.pctX(holders.t)} top={s.pctY(holders.to)} className="h-1.5 w-1.5 bg-mint" opacity={exitsOpacity} />
            <At y={clampPct(Math.max(s.pctY(holders.from * m.arbLineRatio), f.dip ? s.pctY(f.dip.value) : 0), 0, 88)} opacity={exitsOpacity}>
              <span data-part="exits-label" className="tnum absolute right-0 top-0 whitespace-nowrap pt-1 text-[11.5px] font-bold text-mint">
                {CHART_COPY.fromExits(f.exitsPct)}
              </span>
            </At>
          </>
        ) : null}

        {/* Head: your $100 now. */}
        <Dot part="head" left={head.left} top={head.top} className="h-2.5 w-2.5 bg-white ring-4 ring-white/15" opacity={f.priceOpacity} />
        <At x={head.left} y={head.top} opacity={headLabelOpacity}>
          <span
            data-part="head-label"
            className={`tnum absolute left-0 top-0 whitespace-nowrap rounded-full bg-tile px-2 py-0.5 text-[12px] font-bold text-white ${
              side.x === "left" ? "-ml-2 -translate-x-full" : "ml-2"
            } ${side.y === "below" ? "mt-2" : "-mt-7"}`}
          >
            {formatUsdCents(f.valueOf100)}
          </span>
        </At>

        {f.redeemProgress > 0 ? (
          <>
            <Dot part="redeem-dot" left={head.left} top={clampPct(s.pctY(redeemDotValue))} className="h-2.5 w-2.5 bg-mint ring-4 ring-mint/20" />
            {/* Under the arbitrage line at the right edge: clear of the price, the floor and the dip. */}
            <At x={head.left} y={clampPct(s.pctY(m.arbLineRatio * (f.floor100 ?? 0)), 0, 86)} opacity={ramp(f.redeemProgress, 0.5, 1)}>
              <span data-part="redeem-chip" className="tnum pill pill-sm absolute left-0 top-0 mt-1.5 -translate-x-full whitespace-nowrap bg-mint text-ink">
                <span className="max-sm:hidden">{CHART_COPY.redeemWord} </span>
                {formatUsdCents(redeemNet)}
              </span>
            </At>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Places an overlay at (x %, y %) of the plot with a transform only: a plot-sized, click-through box
 * translated by percentages of its own (= the plot's) size; the child sits at its top-left corner.
 * Scroll frames move overlays without layout.
 */
function At({ x = 0, y = 0, opacity = 1, children }: { x?: number; y?: number; opacity?: number; children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute inset-0" style={{ transform: `translate(${x}%, ${y}%)`, opacity }}>
      {children}
    </span>
  );
}

function Dot({ part, left, top, className, opacity = 1 }: { part: string; left: number; top: number; className: string; opacity?: number }) {
  return (
    <At x={left} y={top} opacity={opacity}>
      <span data-part={part} className={`absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full ${className}`} />
    </At>
  );
}

/** Split beat: a stacked raise column (floor, market, creator + platform). The floor segment then slides down into the floor slab. */
function SplitColumn({ m, f, s }: { m: LaunchMath; f: StoryFrame; s: Scales }) {
  const segs = columnSegments(m);
  const grow = f.splitProgress;
  const reveal = f.floorReveal;
  const x0 = s.xOf(COL_T - COL_W / 2);
  const w = s.xOf(COL_W);
  const rest = 1 - ramp(reveal, 0.4, 1);
  // Floor segment morph: column → slab from graduation to the head.
  const fx0 = x0 + (s.xOf(f.floorSteps[0]?.[0] ?? COL_T) - x0) * reveal;
  const fx1 = x0 + w + (s.xOf(f.t) - (x0 + w)) * reveal;
  const floorTop = segs[0]!.to * COL_TOP + (m.floorPer100GrossUsd - segs[0]!.to * COL_TOP) * reveal;
  return (
    <g data-part="split-column">
      <rect
        x={fx0}
        y={s.yOf(floorTop * Math.min(1, grow / 0.4 || 0))}
        width={Math.max(0, fx1 - fx0)}
        height={Math.max(0, s.yOf(0) - s.yOf(floorTop * Math.min(1, grow / 0.4 || 0)))}
        style={{ fill: "var(--color-floor-bar)" }}
        opacity={1 - reveal}
      />
      {segs.slice(1).map((seg, i) => {
        const g = ramp(grow, 0.25 + 0.25 * i, 0.5 + 0.25 * i);
        const lo = seg.from * COL_TOP;
        const hi = lo + (seg.to - seg.from) * COL_TOP * g;
        return (
          <rect
            key={seg.key}
            x={x0}
            y={s.yOf(hi)}
            width={w}
            height={Math.max(0, s.yOf(lo) - s.yOf(hi))}
            style={{ fill: `var(--color-${seg.color})` }}
            opacity={rest}
            stroke="var(--color-midnight)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

function SplitLabels({ m, f, s }: { m: LaunchMath; f: StoryFrame; s: Scales }) {
  const segs = columnSegments(m);
  const left = `${s.pctX(COL_T + COL_W / 2)}%`;
  const rest = 1 - ramp(f.floorReveal, 0.4, 1);
  const labels = [
    { key: "floor", text: CHART_COPY.floorShare(Math.round(m.v * 100)), mid: segs[0]!, cls: "text-mint", o: ramp(f.splitProgress, 0.1, 0.4) * (1 - ramp(f.floorReveal, 0, 0.5)) },
    { key: "market", text: CHART_COPY.market, mid: segs[1]!, cls: "text-on-dark-2", o: ramp(f.splitProgress, 0.4, 0.6) * rest },
    {
      key: "fees",
      text: CHART_COPY.fees(pctOfRaise(m, m.split.creatorUsd), pctOfRaise(m, m.split.platformUsd)),
      mid: { from: segs[2]!.from, to: segs[3]!.to },
      cls: "text-butter",
      o: ramp(f.splitProgress, 0.7, 0.95) * rest,
    },
  ];
  return (
    <>
      {labels.map((l) => (
        <span
          key={l.key}
          data-part={`split-${l.key}`}
          className={`tnum absolute -translate-y-1/2 whitespace-nowrap pl-1.5 text-[11px] font-bold ${l.cls}`}
          style={{ left, top: `${s.pctY(((l.mid.from + l.mid.to) / 2) * COL_TOP)}%`, opacity: l.o }}
        >
          {l.text}
        </span>
      ))}
    </>
  );
}

/** Column segments as cumulative shares of the raise, bottom to top. */
function columnSegments(m: LaunchMath): Array<{ key: string; color: string; from: number; to: number }> {
  const parts: Array<[string, string, number]> = [
    ["floor", "floor-bar", m.split.floorUsd],
    ["market", "iris", m.split.poolUsd],
    ["creator", "butter", m.split.creatorUsd],
    ["platform", "on-dark-3", m.split.platformUsd],
  ];
  let acc = 0;
  return parts.map(([key, color, usd]) => {
    const from = acc / m.raiseUsd;
    acc += usd;
    return { key, color, from, to: acc / m.raiseUsd };
  });
}
