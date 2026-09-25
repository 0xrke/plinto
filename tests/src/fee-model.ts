/**
 * Fee model (launch v3) restated independently of the program, for the fork tests:
 * the graduation and LP splits (programs/stockfloor/src/math.rs), the presale fee parameters and a
 * check that SDK-built DBC config parameters carry the v3 fee fields.
 */
/** 25 bps presale fee (DBC's minimum fee numerator). */
export const CURVE_FEE_BPS = 25;
export const CURVE_CLIFF_FEE_NUMERATOR = 2_500_000n;
/** Meteora's protocol share of every DBC / DAMM v2 fee. */
export const PROTOCOL_FEE_PCT = 20n;
export const PLATFORM_GRADUATION_FEE_BPS = 500n;
export const CREATOR_GRADUATION_BONUS_BPS = 500n;
export const LP_FEE_CREATOR_BPS = 5_000n;
export const LP_FEE_PLATFORM_BPS = 2_000n;
export const BPS = 10_000n;

export interface FeeSplit {
  platform: bigint;
  creator: bigint;
  vault: bigint;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** platform = min(floor(T/20), r), creator = min(floor(T/20), r - platform), vault = rest. */
export function graduationSplit(threshold: bigint, received: bigint): FeeSplit {
  const platform = min((threshold * PLATFORM_GRADUATION_FEE_BPS) / BPS, received);
  const creator = min((threshold * CREATOR_GRADUATION_BONUS_BPS) / BPS, received - platform);
  return { platform, creator, vault: received - platform - creator };
}

/** creator = floor(q/2), platform = floor(q/5), vault = rest. */
export function lpFeeSplit(q: bigint): FeeSplit {
  const creator = (q * LP_FEE_CREATOR_BPS) / BPS;
  const platform = (q * LP_FEE_PLATFORM_BPS) / BPS;
  return { platform, creator, vault: q - creator - platform };
}

/** DBC migration_fee_percentage for a vault share of the raise (platform 5% + creator 5% on top). */
export const migrationFeePctForVaultShare = (vaultSharePct: number): number => vaultSharePct + 10;

/**
 * Assert that DBC ConfigParameters built by the SDK carry the v3 fee fields: 25 bps presale fee, no
 * creator share of curve fees, `migration_fee_percentage = vault share + 10`. The fork tests use the
 * SDK parameters verbatim; this guards against the SDK presets drifting from the fee model.
 */
export function expectFeeModelV3(params: any, vaultSharePct: number): void {
  const got = {
    cliffFeeNumerator: BigInt(params.poolFees.baseFee.cliffFeeNumerator.toString()),
    creatorTradingFeePercentage: params.creatorTradingFeePercentage,
    migrationFeePercentage: params.migrationFee.feePercentage,
  };
  const want = {
    cliffFeeNumerator: CURVE_CLIFF_FEE_NUMERATOR,
    creatorTradingFeePercentage: 0,
    migrationFeePercentage: migrationFeePctForVaultShare(vaultSharePct),
  };
  if (JSON.stringify(got, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) !== JSON.stringify(want, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) {
    throw new Error(`SDK DBC params are not on the v3 fee model: ${JSON.stringify(got, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  }
}
