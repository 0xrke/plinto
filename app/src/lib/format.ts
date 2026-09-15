import Decimal from "decimal.js";

/**
 * Display formatting helpers. Pure functions with no SDK or chain dependency so they
 * can be unit tested in isolation. All on-chain amounts stay `bigint` raw units until
 * the very last step, where they become strings for display.
 */

/** Typographic minus sign (U+2212). Reads better than a hyphen next to numbers. */
export const MINUS = "−";

/** Placeholder shown when a value is unknown or not a finite number. */
export const EMPTY = "—";

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdSub1 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const usdTiny = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 3,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export interface FormatUsdOptions {
  /** Use compact notation ($12.5K, $1.2M) for values of at least 10,000. */
  compact?: boolean;
}

/**
 * Formats a USD value.
 * - |v| >= 1: two decimals with grouping ($1,234.56)
 * - 0.01 <= |v| < 1: two to four decimals ($0.50, $0.0123)
 * - |v| < 0.01: three significant digits ($0.000000512), which keeps sub-cent token
 *   prices readable without scientific notation.
 */
export function formatUsd(value: number, options: FormatUsdOptions = {}): string {
  if (!Number.isFinite(value)) return EMPTY;
  if (value === 0) return usd2.format(0);
  const abs = Math.abs(value);
  let body: string;
  if (options.compact && abs >= 10_000) body = usdCompact.format(abs);
  else if (abs >= 1) body = usd2.format(abs);
  else if (abs >= 0.01) body = usdSub1.format(abs);
  else body = usdTiny.format(abs);
  return value < 0 ? `${MINUS}${body}` : body;
}

export interface FormatPercentOptions {
  /** Maximum fraction digits of the percentage number. Default 1. */
  digits?: number;
  /** Prefix positive values with "+". Negative values always get a minus sign. */
  signed?: boolean;
}

/** Formats a fraction (0.917) as a percentage ("91.7%"). Trailing zeros are trimmed. */
export function formatPercent(fraction: number, options: FormatPercentOptions = {}): string {
  if (!Number.isFinite(fraction)) return EMPTY;
  const digits = options.digits ?? 1;
  const pct = Math.abs(fraction) * 100;
  const smallest = 10 ** -digits;
  let body: string;
  if (pct === 0) body = "0";
  else if (pct < smallest) body = `<${smallest.toFixed(digits)}`;
  else
    body = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(pct);
  const sign = fraction < 0 && pct !== 0 ? MINUS : options.signed && pct !== 0 ? "+" : "";
  return `${sign}${body}%`;
}

/**
 * Formats a progress fraction (0..1) as a percentage rounded to nearest at `digits` fraction digits,
 * except that a value below 1 never reads "100%" (it caps at 99%, or 99.9% with one digit). Values
 * above 1 are clamped.
 */
export function formatProgress(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return EMPTY;
  if (fraction >= 1) return "100%";
  const scale = 10 ** digits;
  const rounded = Math.round(Math.max(fraction, 0) * 100 * scale) / scale;
  const capped = Math.min(rounded, 100 - 1 / scale);
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(capped)}%`;
}

/**
 * Formats the maximum loss fraction Z (0..1) for the buy button: "−91.7%".
 * Zero renders as "0%" without a sign.
 */
export function formatMaxLoss(fraction: number): string {
  if (!Number.isFinite(fraction)) return EMPTY;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return formatPercent(-clamped, { digits: 1 });
}

/** Formats a price-to-floor multiple: 12.13 -> "12.1×". */
export function formatMultiple(multiple: number): string {
  if (!Number.isFinite(multiple) || multiple <= 0) return EMPTY;
  const digits = multiple >= 100 ? 0 : multiple >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(multiple)}×`;
}

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Formats a plain number compactly: 987315402 -> "987.3M". */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return EMPTY;
  return compactNumber.format(value);
}

export interface FormatTokenOptions {
  /** Token-2022 ScaledUiAmount multiplier. UI = raw / 10^decimals × multiplier. Default 1. */
  multiplier?: number;
  /** Maximum fraction digits. Defaults depend on magnitude (2 for >= 1,000, 4 for >= 1, else 6). */
  maxFractionDigits?: number;
  /** Compact notation for values of at least one million ("987.3M"). */
  compact?: boolean;
  /**
   * Round to the nearest digit instead of down. Only for amounts that already moved (a paid or
   * received amount), never for balances or limits, which must not be overstated.
   */
  roundNearest?: boolean;
}

/** Converts raw units to an exact decimal UI amount (raw / 10^decimals × multiplier). */
export function rawToDecimal(raw: bigint, decimals: number, multiplier = 1): Decimal {
  return new Decimal(raw.toString()).div(new Decimal(10).pow(decimals)).mul(multiplier);
}

/**
 * Formats a raw token amount for display. Rounds down so balances and payouts are never
 * overstated. Tiny non-zero amounts render as "<0.000001" instead of "0".
 */
export function formatTokenAmount(raw: bigint, decimals: number, options: FormatTokenOptions = {}): string {
  const negative = raw < 0n;
  const ui = rawToDecimal(negative ? -raw : raw, decimals, options.multiplier ?? 1);
  const sign = negative ? MINUS : "";
  if (ui.isZero()) return "0";
  if (options.compact && ui.gte(1_000_000)) {
    return `${sign}${compactNumber.format(ui.toNumber())}`;
  }
  const maxDigits =
    options.maxFractionDigits ?? (ui.gte(1000) ? 2 : ui.gte(1) ? 4 : Math.min(6, decimals));
  const rounded = ui.toDecimalPlaces(maxDigits, options.roundNearest ? Decimal.ROUND_HALF_UP : Decimal.ROUND_DOWN);
  if (rounded.isZero()) {
    return `${sign}<${new Decimal(10).pow(-maxDigits).toFixed(maxDigits)}`;
  }
  const [intPart, fracPart = ""] = rounded.toFixed(maxDigits).split(".");
  const grouped = BigInt(intPart).toLocaleString("en-US");
  const trimmed = fracPart.replace(/0+$/, "");
  return `${sign}${grouped}${trimmed ? `.${trimmed}` : ""}`;
}

/**
 * Formats a positive amount with `digits` significant digits, rounding **down** and grouping the
 * integer part. Used for money figures that are not raw amounts (the floor per token in the quote
 * asset), so they are never shown above their real value. Zero and non-finite values render "0".
 */
export function formatSignificantDown(value: number, digits = 4): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const rounded = new Decimal(value).toSignificantDigits(digits, Decimal.ROUND_DOWN);
  if (rounded.isZero()) return "0";
  const [intPart = "0", fracPart = ""] = rounded.toFixed().split(".");
  const grouped = BigInt(intPart).toLocaleString("en-US");
  return fracPart ? `${grouped}.${fracPart}` : grouped;
}

/**
 * Parses a user-typed token amount into raw units without floating point.
 * Accepts "1", "1.5", ".5", "1,000.25". Returns null for invalid input or when the
 * input has more fraction digits than the token supports.
 */
export function parseTokenInput(input: string, decimals: number): bigint | null {
  const cleaned = input.trim().replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const [intPart = "", fracPart = ""] = cleaned.split(".");
  if (fracPart.length > decimals) return null;
  const whole = BigInt(intPart === "" ? "0" : intPart);
  const frac = BigInt((fracPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole * 10n ** BigInt(decimals) + frac;
}

/** Formats a plain number with grouping, rounding down to `maxFractionDigits` (default 0). */
export function formatNumber(value: number, maxFractionDigits = 0): string {
  if (!Number.isFinite(value)) return EMPTY;
  const factor = 10 ** maxFractionDigits;
  const floored = Math.floor(Math.abs(value) * factor) / factor;
  const body = new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(floored);
  return value < 0 && floored !== 0 ? `${MINUS}${body}` : body;
}

/** Shortens a base58 address: "XsoCS1Tf...BDF2W" -> "XsoC…DF2W". */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
