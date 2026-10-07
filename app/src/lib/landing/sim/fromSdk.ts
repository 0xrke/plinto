import {
  BASE_SUPPLY_TARGET_RAW,
  BASE_TOKEN_DECIMALS,
  CREATOR_GRADUATION_BONUS_BPS,
  CURVE_PRESETS,
  DEFAULT_EXIT_FEE_BPS,
  DEFAULT_THRESHOLD_USD,
  DEFAULT_VAULT_SHARE_PCT,
  PLATFORM_GRADUATION_FEE_BPS,
  VAULT_SHARE_MAX_PCT,
  VAULT_SHARE_MIN_PCT,
} from "@stockfloor/sdk";
import type { SimConstants } from "./types";

/**
 * Server-only: imports the SDK barrel. Only the landing's server component (LabSection) and tests may
 * import this file; the client island receives the result as props.
 */
export function simConstantsFromSdk(): SimConstants {
  const { num, den } = CURVE_PRESETS.flat.priceRatio;
  return {
    flatPriceRatio: Number(num) / Number(den),
    supplyTokens: Number(BASE_SUPPLY_TARGET_RAW / 10n ** BigInt(BASE_TOKEN_DECIMALS)),
    platformCutPct: PLATFORM_GRADUATION_FEE_BPS / 100,
    creatorCutPct: CREATOR_GRADUATION_BONUS_BPS / 100,
    vaultShareMinPct: VAULT_SHARE_MIN_PCT,
    vaultShareMaxPct: VAULT_SHARE_MAX_PCT,
    defaultVaultSharePct: DEFAULT_VAULT_SHARE_PCT,
    raiseUsd: DEFAULT_THRESHOLD_USD,
    exitFeeBps: DEFAULT_EXIT_FEE_BPS,
  };
}
