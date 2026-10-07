import { useId, useMemo } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { STAGES, STORY_END, type StoryFrame } from "@/lib/landing/sim/story";
import { formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";
import { ILLUSTRATION, storyChartLabel } from "./storyCopy";

/*
 * "Your $100" over story time, hand-drawn SVG. The viewBox is a unit box stretched to the plot area
 * (preserveAspectRatio none) with non-scaling strokes; dots and labels are HTML placed in percent,
 * so nothing distorts at any width.
 */
const VB = 1000;
const presaleEnd = STAGES[0]!.end;
const slabStart = STAGES[1]!.start;

const xOf = (t: number) => (t / STORY_END) * VB;
const pctX = (t: number) => (t / STORY_END) * 100;

export function StoryChart({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const gid = useId().replace(/:/g, "");
  // Depends on the launch only; the clock re-renders this ~60 times a second.
  const label = useMemo(() => storyChartLabel(m), [m]);
  const raised = frame.raisedUsd / m.raiseUsd;
  const yMax = frame.yMax;
  const yOf = (v: number) => VB * (1 - v / yMax);
  const pctY = (v: number) => (1 - v / yMax) * 100;

  const line = frame.path.map(([t, v], i) => `${i ? "L" : "M"}${xOf(t).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const slabTop = m.floorPer100GrossUsd * frame.floorSlabProgress;
  const redeem = frame.stage === "redeem";
  const head = { left: pctX(frame.t), top: pctY(frame.valueOf100) };
  // Keep the head label inside the plot: flip it left near the right edge, below near the top.
  const labelX = head.left > 78 ? "-translate-x-full -ml-2" : "ml-2";
  const labelY = head.top < 14 ? "mt-2" : "-mt-7";

  return (
    <div role="img" aria-label={label} className="relative h-[210px] overflow-hidden rounded-tile bg-midnight lg:h-[300px]">
      <span
        aria-hidden
        className={`pill pill-sm absolute left-3 top-3 z-10 motion-safe:transition-colors ${
          frame.illustrative ? "bg-butter text-ink" : "bg-midnight-chip text-on-dark-3"
        }`}
      >
        {ILLUSTRATION}
      </span>
      <div aria-hidden className="absolute inset-x-4 bottom-5 top-11">
        <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={`slab-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--color-mint)", stopOpacity: 0.45 }} />
              <stop offset="1" style={{ stopColor: "var(--color-floor-bar)", stopOpacity: 0.15 }} />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={xOf(presaleEnd)} height={VB} style={{ fill: "var(--color-presale-soft)" }} fillOpacity={0.07} />
          {/* The raise filling up, bottom to top. */}
          <rect
            x={0}
            y={VB * (1 - raised)}
            width={xOf(presaleEnd)}
            height={VB * raised}
            style={{ fill: "var(--color-presale-ring)" }}
            fillOpacity={0.2}
          />
          {STAGES.slice(1).map((s) => (
            <line
              key={s.key}
              x1={xOf(s.start)}
              x2={xOf(s.start)}
              y1={0}
              y2={VB}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: "var(--color-midnight-line)" }}
              strokeWidth={1}
            />
          ))}
          {slabTop > 0 ? (
            <>
              <rect x={xOf(slabStart)} y={yOf(slabTop)} width={VB - xOf(slabStart)} height={VB - yOf(slabTop)} fill={`url(#slab-${gid})`} />
              <line
                x1={xOf(slabStart)}
                x2={VB}
                y1={yOf(slabTop)}
                y2={yOf(slabTop)}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: "var(--color-mint)" }}
                strokeWidth={2}
              />
            </>
          ) : null}
          <line
            x1={0}
            x2={VB}
            y1={yOf(100)}
            y2={yOf(100)}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--color-on-dark-3)" }}
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="4 5"
          />
          <path
            d={line}
            fill="none"
            className="stroke-white"
            strokeOpacity={redeem ? 0.4 : 1}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="tnum absolute right-0 -translate-y-full pb-0.5 text-[11px] font-semibold text-on-dark-3" style={{ top: `${pctY(100)}%` }}>
          $100
        </span>
        {slabTop > 0 ? (
          <span
            className="absolute ml-1.5 pt-0.5 text-[11px] font-bold text-mint"
            style={{ left: `${pctX(slabStart)}%`, top: `${Math.min(92, pctY(slabTop))}%` }}
          >
            Floor
          </span>
        ) : null}
        {frame.stage === "presale" ? (
          <span className="tnum absolute bottom-1 left-1 whitespace-nowrap text-[11px] font-bold text-white">
            Raised {formatUsdWhole(frame.raisedUsd)}
          </span>
        ) : null}
        <span
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-4 ring-white/15"
          style={{ left: `${head.left}%`, top: `${head.top}%` }}
        />
        <span
          className={`tnum absolute whitespace-nowrap rounded-full bg-tile px-2 py-0.5 text-[12px] font-bold text-white ${labelX} ${labelY}`}
          style={{ left: `${head.left}%`, top: `${head.top}%` }}
        >
          {formatUsdCents(frame.valueOf100)}
        </span>
      </div>
    </div>
  );
}
