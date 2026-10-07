/**
 * Serializable launch constants for the landing simulator. The server builds them from the SDK
 * (`fromSdk.ts`) and passes them to the client island as props, so the client never imports the SDK
 * barrel (which pulls @solana/web3.js, bn.js and Anchor).
 */
export interface SimConstants {
  /** Flat curve preset: graduation / start price, `CURVE_PRESETS.flat` num/den (1.01). */
  flatPriceRatio: number;
  /** Base supply at graduation in tokens, `BASE_SUPPLY_TARGET_RAW / 10^6` (1e9). */
  supplyTokens: number;
  /** Graduation cuts of the raise in percent: `PLATFORM_GRADUATION_FEE_BPS / 100`, `CREATOR_GRADUATION_BONUS_BPS / 100`. */
  platformCutPct: number;
  creatorCutPct: number;
  /** Floor (vault) share of the raise: `VAULT_SHARE_MIN_PCT`, `VAULT_SHARE_MAX_PCT`, `DEFAULT_VAULT_SHARE_PCT`. */
  vaultShareMinPct: number;
  vaultShareMaxPct: number;
  defaultVaultSharePct: number;
  /** Example raise in USD, `DEFAULT_THRESHOLD_USD`. */
  raiseUsd: number;
  /** Exit fee in bps, `DEFAULT_EXIT_FEE_BPS`. */
  exitFeeBps: number;
}
