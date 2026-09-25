import {
  MIN_THRESHOLD_USD,
  STOCKFLOOR_PROGRAM_ID,
  buildDbcConfigParams,
  previewLaunch,
  priceImpactPct,
  type CurvePreset,
  type LaunchInput,
  type LaunchPreview,
} from "@stockfloor/sdk";
import type { PriceSource } from "./chain/prices";
import { THRESHOLD_POLICY, VAULT_SHARE_MAX, VAULT_SHARE_MIN, type ThresholdPolicy } from "./config";

export interface LaunchFormValues {
  name: string;
  symbol: string;
  /**
   * Token URI written into the immutable Metaplex metadata: a metadata JSON document
   * (`{ name, symbol, description, image }`, what wallets and explorers read) or, as a fallback, a
   * bare image URL.
   */
  metadataUri: string;
  quoteSymbol: string;
  preset: CurvePreset;
  vaultSharePct: number;
  /** Graduation threshold in USD, as typed. Parsed by `parseThresholdUsd`. */
  thresholdUsd: string;
}

export type LaunchFormErrors = Partial<Record<keyof LaunchFormValues, string>>;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$1,000" — for threshold presets and bounds, which are whole dollars. */
export function formatUsdWhole(value: number): string {
  return usdWhole.format(value);
}

/**
 * Parses the graduation threshold field: a dollar amount with optional grouping and at most two
 * decimals ("50", "1,000", "12.50"). Returns null when it is not such a number.
 */
export function parseThresholdUsd(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, "").replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Range check of the threshold field against the app's threshold policy (min $10,000, or the SDK's
 * `MIN_THRESHOLD_USD` in a demo build; max $100,000). The remaining on-chain limits (the raw u64
 * threshold at the live quote price, the DBC curve range) depend on the quote asset and are checked
 * by `previewLaunchInput`.
 */
export function validateThresholdUsd(input: string, policy: ThresholdPolicy = THRESHOLD_POLICY): string | undefined {
  if (input.trim() === "") return "Enter a graduation threshold in USD.";
  const value = parseThresholdUsd(input);
  if (value === null) return "Enter a dollar amount with at most two decimals, for example 10,000 or 25,000.";
  const min = Math.max(policy.minUsd, MIN_THRESHOLD_USD);
  if (value < min) {
    return min <= MIN_THRESHOLD_USD
      ? `Use at least ${formatUsdWhole(min)}: below that the raise rounds to a handful of raw units and the vault can round to zero.`
      : `Use at least ${formatUsdWhole(min)}: a smaller raise leaves the pool too thin for a real market.`;
  }
  if (value > policy.maxUsd) return `Use at most ${formatUsdWhole(policy.maxUsd)}.`;
  return undefined;
}

/** Client-side validation of the create form. The SDK and the program validate again. */
export function validateLaunchForm(values: LaunchFormValues, policy: ThresholdPolicy = THRESHOLD_POLICY): LaunchFormErrors {
  const errors: LaunchFormErrors = {};
  const name = values.name.trim();
  if (name.length === 0) errors.name = "Enter a token name.";
  // Token metadata limits are in UTF-8 bytes (32 for the name, 200 for the URI).
  else if (utf8Length(name) > 32) errors.name = "Use at most 32 bytes (fewer characters for emoji or accents).";

  const symbol = values.symbol.trim();
  if (symbol.length === 0) errors.symbol = "Enter a symbol.";
  else if (!/^[A-Z0-9]{2,10}$/.test(symbol.toUpperCase()))
    errors.symbol = "Use 2 to 10 letters or digits.";

  const url = values.metadataUri.trim();
  if (url.length > 0) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") errors.metadataUri = "Use an https:// URL.";
    } catch {
      errors.metadataUri = "Enter a valid URL.";
    }
    if (!errors.metadataUri && utf8Length(url) > 200) errors.metadataUri = "Use a URL of at most 200 bytes.";
  }

  if (
    !Number.isInteger(values.vaultSharePct) ||
    values.vaultSharePct < VAULT_SHARE_MIN ||
    values.vaultSharePct > VAULT_SHARE_MAX
  ) {
    errors.vaultSharePct = `Choose a vault share between ${VAULT_SHARE_MIN}% and ${VAULT_SHARE_MAX}%.`;
  }

  const threshold = validateThresholdUsd(values.thresholdUsd, policy);
  if (threshold) errors.thresholdUsd = threshold;
  return errors;
}

/**
 * A non-default pubkey to stand in for the claimer and leftover-receiver PDAs, which only exist
 * once the launch has a config keypair. `buildDbcConfigParams` rejects the default pubkey, and the
 * only check that reads either address (`InvalidLeftoverAddress`) applies to fixed-supply configs;
 * StockFloor launches are always dynamic supply, so the validation result does not depend on it.
 */
const PREVIEW_PLACEHOLDER_PDA = STOCKFLOOR_PROGRAM_ID;

/**
 * Preview of a launch, plus the port of everything DBC's `create_config` checks on chain
 * (`validateDbcConfigParams` + `assertCurveCanComplete` inside `buildDbcConfigParams`). This is
 * what catches a threshold that the range check accepts but the chain would reject — the raw u64
 * threshold at the live quote price and the DBC sqrt-price range.
 */
export function previewLaunchInput(input: LaunchInput): { preview: LaunchPreview | null; error: string | null } {
  try {
    const preview = previewLaunch(input);
    buildDbcConfigParams(input, PREVIEW_PLACEHOLDER_PDA, PREVIEW_PLACEHOLDER_PDA);
    return { preview, error: null };
  } catch (err) {
    return { preview: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * A launch prices its graduation threshold with the quote price. On chain data outside a local cluster
 * only a live Jupiter price is accepted: stale Jupiter reads and the dated reference table are refused.
 */
export function launchPriceError(dataSource: "mock" | "chain", priceSource: PriceSource, localRpc: boolean): string | null {
  if (dataSource !== "chain" || localRpc || priceSource === "jupiter") return null;
  return priceSource === "stale"
    ? "The quote price is more than 5 minutes old (Jupiter is unreachable). Launching needs a live price to set the graduation threshold."
    : "The live quote price is unavailable (Jupiter). Launching needs it to set the graduation threshold.";
}

/**
 * Relative price move after listing caused by a buy of `buyUsd` into the full-range DAMM v2 pool the
 * launch seeds, as a fraction (0.5625 = +56.25%): `(1 + buy / pool quote)^2 - 1`, pool fee ignored.
 * Zero when the preview has no pool quote.
 */
export function priceMoveOnBuy(preview: Pick<LaunchPreview, "poolQuoteAtGraduationUsd">, buyUsd: number): number {
  if (!(preview.poolQuoteAtGraduationUsd > 0) || !(buyUsd >= 0)) return 0;
  return priceImpactPct(buyUsd, preview.poolQuoteAtGraduationUsd) / 100;
}
