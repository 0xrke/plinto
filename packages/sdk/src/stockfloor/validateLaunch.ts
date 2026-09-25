/**
 * Port of the program's `external::validate_launch_config` (the checks `create_launch` runs on the
 * DBC config), applied to the DBC `ConfigParameters` a launch is built from. `buildDbcConfigParams`
 * runs it, so a preset that drifts from what the program accepts fails in the SDK instead of in
 * `create_launch` after the DBC config was paid for.
 *
 * Each failure carries the program's error name (`code`). Where the program checks a stored field
 * that DBC derives from the parameters, the port checks the parameters that produce it:
 * `migrated_pool_base_fee_bytes` is the serialized `migratedPoolMarketCapFeeSchedulerParams`, so
 * those must be all zero; the liquidity vesting infos must be all zero (DBC initializes them from
 * any non-zero field).
 */
import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { PublicKey } from "@solana/web3.js";
import { graduationSplit } from "../math";

/** Program bounds (programs/stockfloor/src/constants.rs). */
export const MIN_MIGRATION_FEE_PERCENTAGE = 40;
export const MAX_MIGRATION_FEE_PERCENTAGE = 70;
export const MAX_CREATOR_TRADING_FEE_PERCENTAGE = 0;
/** 20% of the 1e9 DBC fee denominator. */
export const MAX_CURVE_FEE_NUMERATOR = 200_000_000n;
export const REQUIRED_MIGRATED_POOL_FEE_BPS = 100;
export const DBC_MIGRATION_FEE_OPTION_CUSTOMIZABLE = 6;
const MAX_EXIT_FEE_BPS_ONCHAIN = 500;

/** Program error names this port can raise (a subset of the IDL `errors`). */
export type LaunchConfigErrorCode =
  | "ExitFeeTooHigh"
  | "QuoteMintMismatch"
  | "FeeClaimerMismatch"
  | "LeftoverReceiverMismatch"
  | "CreatorMigrationFeeNotZero"
  | "MigrationFeePercentageOutOfRange"
  | "MigrationQuoteThresholdTooSmall"
  | "LiquidityNotFullyPartnerLocked"
  | "LiquidityVestingNotAllowed"
  | "LockedVestingNotAllowed"
  | "CollectFeeModeNotQuote"
  | "MigrationOptionNotDammV2"
  | "BaseTokenTypeNotSplToken"
  | "FixedTokenSupplyNotAllowed"
  | "CreatorTradingFeeTooHigh"
  | "CurveFeeTooHigh"
  | "DynamicFeeNotAllowed"
  | "MigratedCollectFeeModeNotQuote"
  | "MigratedPoolFeeInvalid"
  | "MigratedDynamicFeeNotAllowed"
  | "FirstSwapWithMinFeeNotAllowed"
  | "TokenUpdateAuthorityNotImmutable"
  | "PoolCreationFeeNotZero";

export class LaunchConfigError extends Error {
  constructor(
    readonly code: LaunchConfigErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LaunchConfigError";
  }
}

export interface ValidateLaunchConfigOptions {
  /** The launch's claimer PDA; checked against `feeClaimer` / `leftoverReceiver` when both are given. */
  claimer?: PublicKey;
  feeClaimer?: PublicKey;
  leftoverReceiver?: PublicKey;
  /** The config's quote mint and the launch's quote mint; compared when both are given. */
  configQuoteMint?: PublicKey;
  quoteMint?: PublicKey;
  exitFeeBps?: number;
}

type BnLike = { toString(): string };
const big = (v: BnLike | number | bigint) => BigInt(v.toString());
const isZero = (v: BnLike | number | bigint) => big(v) === 0n;

/**
 * DBC `get_migration_quote_amount` fee `T - ceil(T * (100 - mf) / 100)`, all to the partner
 * (the creator migration fee share must be 0).
 */
export function partnerMigrationFee(thresholdRaw: bigint, migrationFeePercentage: number): bigint {
  return thresholdRaw - (thresholdRaw * BigInt(100 - migrationFeePercentage) + 99n) / 100n;
}

/** `external::vault_at_graduation`: the vault's part of the partner migration fee (launch v3). */
export function vaultAtGraduation(thresholdRaw: bigint, migrationFeePercentage: number): bigint {
  return graduationSplit(thresholdRaw, partnerMigrationFee(thresholdRaw, migrationFeePercentage)).vault;
}

/** Throws `LaunchConfigError` with the program's error name on the first failed check. */
export function validateLaunchConfigParams(params: ConfigParameters, opts: ValidateLaunchConfigOptions = {}): void {
  const fail = (code: LaunchConfigErrorCode, detail?: string): never => {
    throw new LaunchConfigError(code, detail);
  };
  if (opts.exitFeeBps !== undefined && (opts.exitFeeBps < 0 || opts.exitFeeBps > MAX_EXIT_FEE_BPS_ONCHAIN)) fail("ExitFeeTooHigh");
  if (opts.configQuoteMint && opts.quoteMint && !opts.configQuoteMint.equals(opts.quoteMint)) fail("QuoteMintMismatch");
  if (opts.claimer && opts.feeClaimer && !opts.feeClaimer.equals(opts.claimer)) fail("FeeClaimerMismatch");
  if (opts.claimer && opts.leftoverReceiver && !opts.leftoverReceiver.equals(opts.claimer)) fail("LeftoverReceiverMismatch");

  const mf = params.migrationFee.feePercentage;
  if (params.migrationFee.creatorFeePercentage !== 0) fail("CreatorMigrationFeeNotZero");
  if (!(mf >= MIN_MIGRATION_FEE_PERCENTAGE && mf <= MAX_MIGRATION_FEE_PERCENTAGE)) {
    fail("MigrationFeePercentageOutOfRange", `${mf} is outside [${MIN_MIGRATION_FEE_PERCENTAGE}, ${MAX_MIGRATION_FEE_PERCENTAGE}]`);
  }
  if (vaultAtGraduation(big(params.migrationQuoteThreshold), mf) === 0n) fail("MigrationQuoteThresholdTooSmall");

  if (
    params.partnerPermanentLockedLiquidityPercentage !== 100 ||
    params.partnerLiquidityPercentage !== 0 ||
    params.creatorPermanentLockedLiquidityPercentage !== 0 ||
    params.creatorLiquidityPercentage !== 0
  ) {
    fail("LiquidityNotFullyPartnerLocked");
  }
  for (const v of [params.partnerLiquidityVestingInfo, params.creatorLiquidityVestingInfo]) {
    if (v && Object.values(v).some((x) => !isZero(x as BnLike))) fail("LiquidityVestingNotAllowed");
  }
  const lv = params.lockedVesting;
  if (!isZero(lv.amountPerPeriod) || !isZero(lv.cliffUnlockAmount) || !isZero(lv.numberOfPeriod)) fail("LockedVestingNotAllowed");
  if (params.collectFeeMode !== 0) fail("CollectFeeModeNotQuote");
  if (params.migrationOption !== 1) fail("MigrationOptionNotDammV2");
  if (params.tokenType !== 0) fail("BaseTokenTypeNotSplToken");
  if (params.tokenSupply) fail("FixedTokenSupplyNotAllowed");
  if (params.creatorTradingFeePercentage > MAX_CREATOR_TRADING_FEE_PERCENTAGE) fail("CreatorTradingFeeTooHigh", "must be 0");
  const bf = params.poolFees.baseFee;
  if (bf.baseFeeMode > 1 || big(bf.cliffFeeNumerator) > MAX_CURVE_FEE_NUMERATOR) fail("CurveFeeTooHigh");
  if (params.poolFees.dynamicFee) fail("DynamicFeeNotAllowed");
  if (params.migratedPoolFee.collectFeeMode !== 0) fail("MigratedCollectFeeModeNotQuote");
  const mc = params.migratedPoolMarketCapFeeSchedulerParams;
  if (
    params.migrationFeeOption !== DBC_MIGRATION_FEE_OPTION_CUSTOMIZABLE ||
    params.migratedPoolFee.poolFeeBps !== REQUIRED_MIGRATED_POOL_FEE_BPS ||
    params.migratedPoolBaseFeeMode !== 0 ||
    params.compoundingFeeBps !== 0 ||
    (mc && Object.values(mc).some((x) => !isZero(x as BnLike)))
  ) {
    fail("MigratedPoolFeeInvalid", "the migrated DAMM v2 pool must be a fixed 1% fee (Customizable option)");
  }
  if (params.migratedPoolFee.dynamicFee !== 0) fail("MigratedDynamicFeeNotAllowed");
  if (params.enableFirstSwapWithMinFee) fail("FirstSwapWithMinFeeNotAllowed");
  if (params.tokenUpdateAuthority !== 1) fail("TokenUpdateAuthorityNotImmutable");
  if (!isZero(params.poolCreationFee)) fail("PoolCreationFeeNotZero");
}
