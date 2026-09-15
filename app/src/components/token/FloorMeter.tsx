import { formatMaxLoss, formatMultiple, formatUsd } from "@/lib/format";

export interface FloorMeterProps {
  priceUsd: number;
  floorUsd: number;
  /** Max loss if you buy now, Z = 1 − floor/price, computed by the caller with the SDK. */
  maxLoss: number;
  /** Compact variant for list cards: thinner bar, no labels. */
  compact?: boolean;
}

/**
 * The hero visual: price sits above a solid floor. The floor segment is backed by the
 * vault; the hatched band between floor and price is what a buyer can lose.
 */
export function FloorMeter({ priceUsd, floorUsd, maxLoss, compact = false }: FloorMeterProps) {
  const safePrice = Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : 0;
  const safeFloor = Number.isFinite(floorUsd) && floorUsd > 0 ? floorUsd : 0;
  const scaleMax = Math.max(safePrice, safeFloor) * 1.1 || 1;
  const floorPct = (safeFloor / scaleMax) * 100;
  const pricePct = (safePrice / scaleMax) * 100;
  const riskPct = Math.max(pricePct - floorPct, 0);
  const belowFloor = safePrice > 0 && safePrice < safeFloor;
  const multiple = safeFloor > 0 ? safePrice / safeFloor : Number.POSITIVE_INFINITY;

  const summary = `Price ${formatUsd(priceUsd)}, floor ${formatUsd(floorUsd)}, max loss if you buy now ${formatMaxLoss(maxLoss)}`;

  if (compact) {
    return (
      <div role="img" aria-label={summary} className="relative h-2 w-full overflow-hidden rounded-full bg-sunken">
        <div className="absolute inset-y-0 left-0 bg-floor" style={{ width: `${floorPct}%` }} />
        <div className="hatch-risk absolute inset-y-0" style={{ left: `${floorPct}%`, width: `${riskPct}%` }} />
        <div
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink"
          style={{ left: `${pricePct}%` }}
        />
      </div>
    );
  }

  // Keep the price label inside the meter near either edge.
  const labelShift = pricePct > 75 ? "-translate-x-full" : pricePct < 25 ? "translate-x-0" : "-translate-x-1/2";

  return (
    <figure className="w-full" aria-label="Floor meter">
      <div role="img" aria-label={summary} className="relative pt-9">
        <div
          className={`absolute top-0 whitespace-nowrap text-sm ${labelShift}`}
          style={{ left: `${pricePct}%` }}
        >
          <span className="text-ink-3">Price </span>
          <span className="font-semibold text-ink">{formatUsd(priceUsd)}</span>
        </div>
        <div className="relative h-11 w-full overflow-hidden rounded-lg bg-sunken">
          <div
            className="absolute inset-y-0 left-0 flex items-center bg-floor"
            style={{ width: `${floorPct}%` }}
          />
          <div
            className="hatch-risk absolute inset-y-0 border-l-2 border-surface"
            style={{ left: `${floorPct}%`, width: `${riskPct}%` }}
          />
        </div>
        <div
          aria-hidden
          className="absolute bottom-0 top-6 w-0.5 -translate-x-1/2 rounded bg-ink"
          style={{ left: `${pricePct}%` }}
        />
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-3 w-3 rounded-sm bg-floor" />
          <span className="text-ink-2">Floor</span>
          <span className="font-semibold text-floor-strong">{formatUsd(floorUsd)}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="hatch-risk h-3 w-3 rounded-sm border border-risk-line" />
          <span className="text-ink-2">At risk above the floor</span>
          <span className="font-semibold text-risk">{formatMaxLoss(maxLoss)}</span>
        </span>
        <span className="text-ink-3">
          {belowFloor
            ? "Price is below the floor: redeeming pays more than selling."
            : Number.isFinite(multiple)
              ? `Price is ${formatMultiple(multiple)} the floor`
              : "No floor yet"}
        </span>
      </figcaption>
    </figure>
  );
}
