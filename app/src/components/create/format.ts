import { formatUsd } from "@/lib/format";

const usdPrice3 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumSignificantDigits: 3,
  maximumSignificantDigits: 3,
});

/**
 * Per-token USD price at a fixed 3 significant figures ("$0.000000500", "$0.00000133"), so the
 * floor, start and graduation prices in the preview read with the same precision.
 */
export function formatPriceUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value >= 0.01) return formatUsd(value);
  return usdPrice3.format(value);
}
