import { formatMaxLoss, formatMultiple, formatUsd } from "@/lib/format";

export interface FloorMeterProps {
  priceUsd: number;
  floorUsd: number;
  /** Max loss at the price shown, Z = 1 − floor/price, computed by the caller with the SDK. */
  maxLoss: number;
  /** Compact variant for list cards: a 12px track, no labels. */
  compact?: boolean;
}

/**
 * The hero visual: a rounded track from $0. The solid green segment is the floor the vault backs;
 * the rose hatch between floor and price is what a buyer at today's price can lose; a dark tick marks
 * the price. The scale runs to 110% of the larger of the two, so the tick never sits on the edge.
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

  const summary = `Price ${formatUsd(priceUsd)}, floor ${formatUsd(floorUsd)}, max loss at the current price ${formatMaxLoss(maxLoss)}`;

  if (compact) {
    return (
      <div role="img" aria-label={summary} className="relative h-3 w-full rounded-full bg-track">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-floor-bar" style={{ width: `${floorPct}%` }} />
        <div className="hatch-risk absolute inset-y-0" style={{ left: `${floorPct}%`, width: `${riskPct}%` }} />
        {safePrice > 0 ? (
          <div
            className="absolute -top-[5px] h-[22px] w-1 -translate-x-1/2 rounded-sm bg-ink"
            style={{ left: `${pricePct}%` }}
          />
        ) : null}
      </div>
    );
  }

  // The label of whichever mark is further right hangs off that mark, right-aligned; the other sits
  // at the start of the track. They never overlap, including when the price is below the floor.
  const floorLabel = (
    <span className="flex flex-col">
      <span className="text-xs text-ink-3">Floor</span>
      <span className="tnum text-[15px] font-extrabold text-floor">{formatUsd(floorUsd)}</span>
    </span>
  );
  const priceLabel = (
    <span className="flex flex-col">
      <span className="text-xs text-ink-3">Price</span>
      <span className="tnum text-[15px] font-extrabold text-ink">{formatUsd(priceUsd)}</span>
    </span>
  );
  const rightMark = belowFloor ? floorPct : pricePct;
  // Centre the loss pill under the hatch, but keep it inside the track and clear of the "$0".
  const bandCentre = floorPct + riskPct / 2;
  const pillStyle =
    bandCentre > 70
      ? { right: `${100 - Math.max(pricePct, floorPct)}%` }
      : bandCentre < 30
        ? { left: `max(2.75rem, ${floorPct}%)` }
        : { left: `${bandCentre}%`, transform: "translateX(-50%)" };

  return (
    <figure className="w-full" aria-label="Floor meter">
      <div role="img" aria-label={summary} className="relative">
        {/* Value labels above the track */}
        <div className="relative h-[42px]">
          <div className="absolute left-0 top-0 text-left">{belowFloor ? priceLabel : floorLabel}</div>
          <div
            className="absolute top-0 -translate-x-full whitespace-nowrap pr-3 text-right"
            style={{ left: `${rightMark}%` }}
          >
            {belowFloor ? floorLabel : priceLabel}
          </div>
        </div>

        {/* Track */}
        <div className="relative mt-2 h-[30px] rounded-full bg-track">
          <div
            className="absolute inset-y-0 left-0 rounded-l-full rounded-r-lg"
            style={{ width: `${floorPct}%`, backgroundImage: "linear-gradient(180deg, #34b58f, #1f9e7a)" }}
          />
          {riskPct > 0 ? (
            <div
              className="hatch-risk absolute inset-y-0 rounded-lg"
              style={{ left: `calc(${floorPct}% + 4px)`, width: `max(0px, calc(${riskPct}% - 4px))` }}
            />
          ) : null}
          {safePrice > 0 ? (
            <div
              aria-hidden
              className="absolute -top-2.5 h-[50px] w-1.5 -translate-x-1/2 rounded-[3px] bg-ink"
              style={{ left: `${pricePct}%` }}
            />
          ) : null}
        </div>

        {/* $0 at the start and the loss pill under the hatch */}
        <div className="relative mt-3 h-[26px]">
          <span className="absolute left-0 top-1 text-xs text-ink-3">$0</span>
          <span
            className={`pill pill-sm absolute top-0 h-[26px] whitespace-nowrap px-3 text-[12.5px] ${
              maxLoss > 0 ? "pill-risk" : "pill-floor"
            }`}
            style={pillStyle}
          >
            <span className="tnum">{formatMaxLoss(maxLoss)}</span> at risk above the floor
          </span>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-ink-2">
        {belowFloor
          ? "Price is below the floor: redeeming pays more than selling."
          : Number.isFinite(multiple)
            ? `Price is ${formatMultiple(multiple)} the floor`
            : "No floor yet"}
      </figcaption>
    </figure>
  );
}
