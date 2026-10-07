import type { CSSProperties } from "react";
import { launchMath, type LaunchMath } from "@/lib/landing/sim/launch";
import { DEFAULT_FLOW_INDEX, flowUsdAt, priceMove } from "@/lib/landing/sim/market";
import type { SimConstants } from "@/lib/landing/sim/types";
import { FLOOR_LABEL, SAME_BUY, movePct } from "./floorShare.copy";

/*
 * "Bigger floor, the price moves harder": the pool price relative to listing (1 = listing) against
 * net buying, for one or more floor shares. No ticks, no dollar labels: x is "buying", y is "price".
 * Hand-drawn SVG in a 100×100 viewBox stretched to the box (strokes stay crisp with
 * `non-scaling-stroke`); balls and labels are HTML layered on top in percent. Pure: the same on the
 * server and the client. Scale math follows lab/DepthChart's depthScales, but the domain is fixed
 * by the SDK constants so every floor share is drawn on the same axes.
 */

const SAMPLES = 64;

/** A curve to draw. */
export interface FlightCurve {
  m: LaunchMath;
  tone: "bright" | "ghost";
  /** Ball position as net flow in USD (0 = listing); omitted, no ball. */
  ballUsd?: number;
  /** Price-move arrow at the same buy, 0..1 opacity; omitted or 0, none. */
  arrow?: number;
  /** Draw this curve's floor line. */
  floor?: boolean;
}

/** Fixed plot domain for a set of launch constants. */
export function flightScales(k: SimConstants) {
  const lo = launchMath(k, k.vaultShareMinPct);
  const hi = launchMath(k, k.vaultShareMaxPct);
  /** The "Same buy": the sandbox's default buy (+$1,000 on a $10,000 raise). */
  const buyUsd = flowUsdAt(lo, DEFAULT_FLOW_INDEX);
  // Left edge just past the lowest share's floor point (the most selling to reach a floor).
  const x0 = -1.04 * lo.sellToFloorUsd;
  const x1 = 2 * buyUsd;
  const yMax = 1.08 * (1 + priceMove(hi, x1));
  const px = (x: number) => ((x - x0) / (x1 - x0)) * 100;
  const py = (rel: number) => 100 - (Math.min(yMax, Math.max(0, rel)) / yMax) * 100;
  return { buyUsd, x0, x1, yMax, px, py };
}

const pct = (n: number) => `${n.toFixed(3)}%`;

export interface PriceFlightChartProps {
  k: SimConstants;
  curves: readonly FlightCurve[];
  /** Label on the bright curve's floor line, e.g. "Floor · SPYx". */
  floorLabel?: string;
  /** Accessible name; the chart is a single image. */
  label: string;
  className?: string;
}

export function PriceFlightChart({ k, curves, floorLabel = FLOOR_LABEL, label, className = "" }: PriceFlightChartProps) {
  const { buyUsd, x0, x1, px, py } = flightScales(k);
  const buyX = px(buyUsd);
  const listingY = py(1);

  const pathOf = (m: LaunchMath) => {
    const xF = -m.sellToFloorUsd;
    const pts: string[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = Math.max(xF, x0) + ((x1 - Math.max(xF, x0)) * i) / (SAMPLES - 1);
      pts.push(`${i ? "L" : "M"}${px(x).toFixed(3)} ${py(1 + priceMove(m, x)).toFixed(3)}`);
    }
    return pts.join("");
  };

  // Draw ghosts under the bright curve.
  const ordered = [...curves].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "ghost" ? -1 : 1));
  const bright = ordered.filter((c) => c.tone === "bright").at(-1);

  return (
    <div role="img" aria-label={label} className={`relative overflow-hidden rounded-tile bg-midnight ${className}`}>
      <div aria-hidden className="absolute inset-x-4 bottom-7 top-7">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {/* Listing level, unlabelled. */}
          <line
            x1="0"
            x2="100"
            y1={listingY}
            y2={listingY}
            className="stroke-on-dark-3/40"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          {/* The same buy. */}
          <line
            x1={buyX}
            x2={buyX}
            y1="0"
            y2="100"
            className="stroke-butter/60"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          {ordered.map((c, i) =>
            c.floor ? (
              <line
                key={`f${i}`}
                data-floor-line={Math.round(c.m.v * 100)}
                x1="0"
                x2="100"
                y1={py(c.m.floorToListing)}
                y2={py(c.m.floorToListing)}
                className={c.tone === "bright" ? "stroke-mint" : "stroke-mint/40"}
                strokeWidth={c.tone === "bright" ? 2 : 1}
                strokeDasharray={c.tone === "bright" ? undefined : "4 3"}
                vectorEffect="non-scaling-stroke"
              />
            ) : null,
          )}
          {ordered.map((c, i) => (
            <path
              key={`c${i}`}
              data-curve={Math.round(c.m.v * 100)}
              d={pathOf(c.m)}
              fill="none"
              className={c.tone === "bright" ? "stroke-white" : "stroke-white/30"}
              strokeWidth={c.tone === "bright" ? 2.5 : 1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {ordered.map((c, i) => {
            const a = c.arrow ?? 0;
            if (a <= 0) return null;
            const top = py(1 + priceMove(c.m, buyUsd));
            return (
              <line
                key={`a${i}`}
                x1={buyX}
                x2={buyX}
                y1={listingY}
                y2={top}
                opacity={a}
                className={c.tone === "bright" ? "stroke-butter" : "stroke-butter/50"}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <span
          className="absolute -translate-x-full whitespace-nowrap pr-1.5 text-[11px] font-bold text-butter"
          style={{ left: pct(buyX), top: 0 }}
        >
          {SAME_BUY}
        </span>

        {bright?.floor ? (
          <span
            data-testid="flight-floor-label"
            className="absolute -translate-y-full whitespace-nowrap pb-0.5 text-[11px] font-bold text-mint"
            style={{ left: 0, top: pct(py(bright.m.floorToListing)) }}
          >
            {floorLabel}
          </span>
        ) : null}

        {ordered.map((c, i) => {
          const a = c.arrow ?? 0;
          if (a <= 0) return null;
          const move = priceMove(c.m, buyUsd);
          return (
            <span
              key={`l${i}`}
              data-testid="flight-move"
              className={`tnum absolute -translate-y-1/2 whitespace-nowrap pl-2 text-[12px] font-bold ${c.tone === "bright" ? "text-butter" : "text-butter/60"}`}
              style={{ left: pct(buyX), top: pct(py(1 + move)), opacity: a }}
            >
              {movePct(move)}
            </span>
          );
        })}

        {ordered.map((c, i) => {
          if (c.ballUsd === undefined) return null;
          const x = Math.max(-c.m.sellToFloorUsd, c.ballUsd);
          const at = { left: pct(px(x)), top: pct(py(1 + priceMove(c.m, x))) } satisfies CSSProperties;
          return (
            <span
              key={`b${i}`}
              data-ball={Math.round(c.m.v * 100)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                c.tone === "bright" ? "h-3.5 w-3.5 bg-white ring-2 ring-midnight" : "h-2.5 w-2.5 bg-white/50"
              }`}
              style={at}
            />
          );
        })}
      </div>
      <span aria-hidden className="absolute left-4 top-1.5 text-[11px] font-semibold text-on-dark-3">
        Price
      </span>
      <span aria-hidden className="absolute bottom-1.5 right-4 text-[11px] font-semibold text-on-dark-3">
        Buying →
      </span>
    </div>
  );
}
