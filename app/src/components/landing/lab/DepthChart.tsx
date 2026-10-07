import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { paperValueOf100 } from "@/lib/landing/sim/market";

/** Fixed y domain: "your $100" from $0 to $300 (the steepest curve, 60% floor, peaks at $277.78 at +$2,000). */
const Y_MAX = 300;
const SAMPLES = 80;

/**
 * Fixed x domain for a $10,000 raise (scaled with the raise). The left end sits past the floor at
 * the lowest floor share (30%: $3,406 of selling), so the floor point is on the chart at every share.
 */
const X_MIN_USD = -3500;
const X_MAX_USD = 2000;

/** Plot coordinates in percent of the plot box: x from the flow, y from the dollar value (0 at the top). */
export function depthScales(m: LaunchMath) {
  const scale = m.raiseUsd / 10_000;
  const x0 = X_MIN_USD * scale;
  const x1 = X_MAX_USD * scale;
  const px = (x: number) => ((x - x0) / (x1 - x0)) * 100;
  const py = (usd: number) => 100 - (Math.min(Y_MAX, Math.max(0, usd)) / Y_MAX) * 100;
  return { x0, x1, px, py };
}

const pct = (n: number) => `${n.toFixed(3)}%`;

/**
 * The sandbox chart: what "your $100" is worth on paper after net trading of x dollars, against
 * the floor. Hand-drawn SVG in a 100×100 viewBox stretched to the box (strokes stay crisp with
 * `non-scaling-stroke`); dots and labels are HTML layered on top in percent, so they
 * keep their shape at any aspect ratio. Pure: renders the same on the server and the client.
 */
export function DepthChart({ m, flowUsd, label, className = "" }: { m: LaunchMath; flowUsd: number; label: string; className?: string }) {
  const { x0, x1, px, py } = depthScales(m);
  const floorY = py(m.floorPer100GrossUsd);
  const xF = -m.sellToFloorUsd;

  // The curve, split at the floor point: left of it the pool price is under the floor, where
  // holders would redeem rather than sell, so that part is drawn faint and dashed.
  const sample = (x: number): [number, number] => [px(x), py(paperValueOf100(m, x))];
  const above: Array<[number, number]> = [sample(xF)];
  // A thin pool can be drained before the left edge: the curve then starts at $0 where x = −Q.
  const below: Array<[number, number]> = -m.poolUsd > x0 ? [[px(-m.poolUsd), py(0)]] : [];
  for (let i = 0; i < SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / (SAMPLES - 1);
    if (x <= -m.poolUsd) continue;
    if (x < xF) below.push(sample(x));
    else if (x > xF) above.push(sample(x));
  }
  below.push(sample(xF));
  const toPath = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(3)} ${y.toFixed(3)}`).join("");

  const you = { x: px(flowUsd), y: py(paperValueOf100(m, flowUsd)) };
  const listing = { x: px(0), y: py(100) };
  const floorDot = { x: px(xF), y: floorY };

  return (
    <div role="img" aria-label={label} className={`relative overflow-hidden rounded-tile bg-midnight ${className}`}>
      <div aria-hidden className="absolute inset-x-4 bottom-7 top-5">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {/* The floor: a mint slab from $0 up to the floor value. */}
          <rect x="0" y={floorY} width="100" height={100 - floorY} className="fill-mint/25" />
          <line x1="0" x2="100" y1={floorY} y2={floorY} className="stroke-mint" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {/* $100 reference. */}
          <line
            x1="0"
            x2="100"
            y1={listing.y}
            y2={listing.y}
            className="stroke-on-dark-3/50"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          {/* Your position: dashed drop line to the axis. */}
          <line
            x1={you.x}
            x2={you.x}
            y1={you.y}
            y2="100"
            className="stroke-white/60"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={toPath(below)}
            fill="none"
            className="stroke-white/35"
            strokeWidth="1.5"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
          <path d={toPath(above)} fill="none" className="stroke-white" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>

        <span className="tnum absolute -translate-y-full pb-0.5 text-[11px] font-semibold text-on-dark-3" style={{ left: 0, top: pct(listing.y) }}>
          $100
        </span>
        <span
          className="absolute -translate-y-full pb-0.5 text-[11px] font-bold text-mint"
          style={{ right: 0, top: pct(floorY) }}
        >
          Floor
        </span>

        <Dot at={listing} className="h-2.5 w-2.5 bg-on-dark-2" />
        {flowUsd !== 0 ? <DotLabel at={listing} text="Listing" className="text-on-dark-2" /> : null}
        <Dot at={floorDot} className="h-3 w-3 bg-mint ring-2 ring-midnight" data-testid="depth-floor-dot" />
        <Dot at={you} className="h-3.5 w-3.5 bg-butter ring-2 ring-midnight" />
        <DotLabel at={you} text="You" className="text-butter" />
      </div>
      <span aria-hidden className="absolute bottom-1.5 left-4 text-[11px] font-semibold text-on-dark-3">
        ← Sold
      </span>
      <span aria-hidden className="absolute bottom-1.5 right-4 text-[11px] font-semibold text-on-dark-3">
        Bought →
      </span>
    </div>
  );
}

function Dot({ at, className, ...rest }: { at: { x: number; y: number }; className: string; "data-testid"?: string }) {
  return (
    <span
      {...rest}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${className}`}
      style={{ left: pct(at.x), top: pct(at.y) }}
    />
  );
}

/** A label above a dot; flips below it near the top edge and hugs the side near either end. */
function DotLabel({ at, text, className }: { at: { x: number; y: number }; text: string; className: string }) {
  const style: CSSProperties = { left: pct(at.x), top: pct(at.y) };
  const flip = at.y < 12;
  const anchor = at.x < 6 ? "translate-x-1.5" : at.x > 94 ? "-translate-x-[calc(100%+6px)]" : "-translate-x-1/2";
  const vertical = at.x < 6 || at.x > 94 ? "-translate-y-[calc(100%+6px)]" : flip ? "translate-y-2" : "-translate-y-[calc(100%+8px)]";
  return (
    <span className={`absolute whitespace-nowrap text-[11px] font-bold ${anchor} ${vertical} ${className}`} style={style}>
      {text}
    </span>
  );
}
