import {
  BASE_SUPPLY_TARGET_RAW,
  BASE_TOKEN_DECIMALS,
  CREATOR_GRADUATION_BONUS_BPS,
  CURVE_PRESETS,
  DEFAULT_EXIT_FEE_BPS,
  DEFAULT_THRESHOLD_USD,
  DEFAULT_VAULT_SHARE_PCT,
  LP_FEE_CREATOR_BPS,
  LP_FEE_PLATFORM_BPS,
  PLATFORM_GRADUATION_FEE_BPS,
  STOCKFLOOR_DBC_DEFAULTS,
  VAULT_SHARE_MAX_PCT,
  VAULT_SHARE_MIN_PCT,
} from "@stockfloor/sdk";
import type { SimConstants } from "./types";

/**
 * DAMM v2 `PROTOCOL_FEE_PERCENT`: vendor/damm-v2/programs/cp-amm/src/constants.rs:146, applied to every
 * pool by params/fee_parameters.rs:70. A program constant (no per-pool setting, no SDK export); a
 * referral cut comes out of this 20%, so LPs always keep 80% of the pool fee.
 */
const DAMM_PROTOCOL_FEE_PCT = 20;

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
    poolFeeBps: STOCKFLOOR_DBC_DEFAULTS.migratedPoolFeeBps,
    lpCreatorBps: LP_FEE_CREATOR_BPS,
    lpPlatformBps: LP_FEE_PLATFORM_BPS,
    dammProtocolFeePct: DAMM_PROTOCOL_FEE_PCT,
  };
}
