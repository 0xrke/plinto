import type { LaunchMath } from "@/lib/landing/sim/launch";
import { formatUsdWhole, splitAriaLabel } from "@/lib/landing/sim/format";

type SegmentKey = keyof LaunchMath["split"];

const SEGMENTS: ReadonlyArray<{ key: SegmentKey; className: string }> = [
  // The old RaiseSplit colours. White text never sits on these at 12px, so `floor-bar` is fine.
  { key: "floorUsd", className: "bg-floor-bar" },
  { key: "poolUsd", className: "bg-iris" },
  { key: "creatorUsd", className: "bg-butter" },
  { key: "platformUsd", className: "bg-ink-3/45" },
];

/** Stagger between segments, as a share of `progress` (the story splits the bar over ~1.2 s, 0.1 s apart). */
const STAGGER = 0.1;

/** How far segment `i` has grown when the whole bar is at `progress` (0..1). */
function segmentScale(progress: number, i: number): number {
  const span = 1 - STAGGER * (SEGMENTS.length - 1);
  return Math.min(1, Math.max(0, (progress - STAGGER * i) / span));
}

/** Whole percent of the raise, e.g. 40. */
const pctOf = (m: LaunchMath, usd: number) => Math.round((usd / m.raiseUsd) * 100);

/**
 * Where the raise goes: a 12px bar in four segments (floor, market, creator, platform) and a
 * three-item legend ("Floor $5,000 · Market $4,000 · Fees $1,000", or with `legend="pct"`
 * "Floor 50% · Market 40% · Fees 10%"). Shared by the sandbox, the story and the floor-share
 * chapter; the story passes `progress` to grow the segments one after another.
 */
export function SplitBar({
  m,
  progress = 1,
  legend = "usd",
  className = "",
}: {
  m: LaunchMath;
  progress?: number;
  legend?: "usd" | "pct";
  className?: string;
}) {
  const s = m.split;
  const fees = s.creatorUsd + s.platformUsd;
  const value = (usd: number) => (legend === "pct" ? `${pctOf(m, usd)}%` : formatUsdWhole(usd));
  return (
    <div className={className}>
      <div role="img" aria-label={splitAriaLabel(m)} className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-track">
        {SEGMENTS.map((seg, i) => (
          <span
            key={seg.key}
            className={`h-full origin-left ${seg.className}`}
            style={{
              flexBasis: `${(s[seg.key] / m.raiseUsd) * 100}%`,
              transform: progress >= 1 ? undefined : `scaleX(${segmentScale(progress, i)})`,
            }}
          />
        ))}
      </div>
      <p className="tnum mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-2">
        <LegendItem dot="bg-floor-bar" label="Floor" value={value(s.floorUsd)} strong />
        <LegendItem dot="bg-iris" label="Market" value={value(s.poolUsd)} />
        <LegendItem dot="bg-butter" label="Fees" value={value(fees)} />
      </p>
    </div>
  );
}

function LegendItem({ dot, label, value, strong = false }: { dot: string; label: string; value: string; strong?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {label} <span className={strong ? "font-bold text-floor" : "font-semibold text-ink"}>{value}</span>
    </span>
  );
}
