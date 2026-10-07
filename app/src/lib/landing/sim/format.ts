import type { LaunchMath } from "./launch";

const centsUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "$34.88". */
export const formatUsdCents = (n: number): string => centsUsd.format(n);
/** "$1,614". */
export const formatUsdWhole = (n: number): string => wholeUsd.format(n);
/** "2.8×". */
export const formatMultiple = (n: number): string => `${n.toFixed(1)}×`;

/** "Floor 50%, market 40%, creator 5%, platform 5%" (same words as the visible legend). */
export function splitAriaLabel(m: LaunchMath): string {
  const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;
  const s = m.split;
  return `Floor ${pct(s.floorUsd)}%, market ${pct(s.poolUsd)}%, creator ${pct(s.creatorUsd)}%, platform ${pct(s.platformUsd)}%`;
}
