/*
 * Copy for chapter 03, "Floor share". Percentages only: no dollar figures, no payouts. A thinner
 * market moves the price harder in both directions, so the copy says "moves", never only "flies".
 */

export const FLOOR_SHARE_ID = "floor-share";
export const FLOOR_SHARE_NUMERAL = "03";
export const FLOOR_SHARE_EYEBROW = "Floor share";

export const FLOOR_SHARE_STEPS = [
  "More floor leaves less money in the market.",
  "Thinner market: the same buy moves price harder. Both ways.",
  "Set the floor share.",
] as const;

export const SLIDER_LABEL = "Floor share";
export const SLIDER_ENDS = { low: "Deeper market", high: "Higher floor" } as const;

/** The marker for the fixed buy every curve is compared at. */
export const SAME_BUY = "Same buy";
export const FLOOR_LABEL = "Floor";

/** "+56%" (whole percent, rounded). */
export const movePct = (move: number) => `${move >= 0 ? "+" : "−"}${Math.abs(Math.round(move * 100))}%`;

/** The slider's aria-valuetext: "50% to the floor, 40% to the market, 10% to fees." */
export const sliderValueText = (floor: number, market: number, fees: number) =>
  `${floor}% to the floor, ${market}% to the market, ${fees}% to fees.`;

/** The chart's accessible name (shown to assistive tech in the reduced-motion stills). */
export function chartLabel(curves: ReadonlyArray<{ share: number; move: number }>, symbol: string): string {
  const parts = curves.map((c) => `at a ${c.share}% floor it moves the price ${movePct(c.move)}`);
  return `The same buy: ${parts.join("; ")}. Floor held in ${symbol}.`;
}
