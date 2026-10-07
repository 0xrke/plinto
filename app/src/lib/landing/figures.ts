import {
  CREATOR_GRADUATION_BONUS_BPS,
  DEFAULT_EXIT_FEE_BPS,
  DEFAULT_THRESHOLD_USD,
  DEFAULT_VAULT_SHARE_PCT,
  PLATFORM_GRADUATION_FEE_BPS,
  VAULT_SHARE_MAX_PCT,
  VAULT_SHARE_MIN_PCT,
  floorPer100AtListingForPreset,
  poolSharePctForVaultShare,
} from "@stockfloor/sdk";

/**
 * Landing-page numbers, all derived from the SDK defaults so the page cannot drift from the program:
 * a $10,000 raise at the default 50% floor share, the flat curve the create form defaults to
 * (docs/DECISIONS.md) and the 2% exit fee.
 */

export type SplitKey = "floor" | "pool" | "creator" | "platform";

export interface SplitPart {
  key: SplitKey;
  label: string;
  pct: number;
  usd: number;
}

/** Example raise for the split bar: the SDK's default threshold. */
export const EXAMPLE_RAISE_USD = DEFAULT_THRESHOLD_USD;

/** Where a raise goes at graduation, in bar order: floor, locked pool, creator, platform. */
export function raiseSplit(raiseUsd: number = EXAMPLE_RAISE_USD, floorPct: number = DEFAULT_VAULT_SHARE_PCT): SplitPart[] {
  const parts: Omit<SplitPart, "usd">[] = [
    { key: "floor", label: "Floor", pct: floorPct },
    { key: "pool", label: "Locked pool", pct: poolSharePctForVaultShare(floorPct) },
    { key: "creator", label: "Creator", pct: CREATOR_GRADUATION_BONUS_BPS / 100 },
    { key: "platform", label: "Platform", pct: PLATFORM_GRADUATION_FEE_BPS / 100 },
  ];
  return parts.map((p) => ({ ...p, usd: (raiseUsd * p.pct) / 100 }));
}

/** "Floor 50%, locked pool 40%, creator 5%, platform 5%". */
export function splitAriaLabel(parts: SplitPart[]): string {
  return parts.map((p, i) => `${i === 0 ? p.label : p.label.toLowerCase()} ${p.pct}%`).join(", ");
}

export const FLOOR_SHARE_MIN_PCT = VAULT_SHARE_MIN_PCT;
export const FLOOR_SHARE_MAX_PCT = VAULT_SHARE_MAX_PCT;
export const EXIT_FEE_PCT = DEFAULT_EXIT_FEE_BPS / 100;

export interface WorstCase {
  /** USD back from the floor for $100 bought at the opening price, after the exit fee (cents). */
  backUsd: number;
  /** The rest of the $100 (cents). */
  atRiskUsd: number;
}

/**
 * Worst case at the default terms: "Floor per $100 at listing" (README: $34.88), rounded to cents, and
 * the rest of the $100 counted in whole cents so the two always add up to exactly $100.
 */
export function worstCasePer100(): WorstCase {
  const backCents = Math.round(floorPer100AtListingForPreset("flat", DEFAULT_VAULT_SHARE_PCT, DEFAULT_EXIT_FEE_BPS) * 100);
  return { backUsd: backCents / 100, atRiskUsd: (10_000 - backCents) / 100 };
}

const wholeUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const centsUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$5,000". */
export const formatWholeUsd = (value: number) => wholeUsd.format(value);
/** "$34.88". */
export const formatCentsUsd = (value: number) => centsUsd.format(value);
