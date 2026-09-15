/**
 * Port of the checks the DBC 0.2.1 program runs in `create_config`:
 * `ConfigParameters::validate` and `process_create_config`
 * (vendor/dbc/programs/dynamic-bonding-curve/src/instructions/partner/create_config/process_create_config.rs).
 *
 * Not ported (they need on-chain accounts or are outside what StockFloor configs use):
 * - the quote mint token badge check (`validate_quote_mint_with_token_badge`);
 * - non-zero liquidity vesting infos and the DAMM v2 market-cap fee scheduler
 *   (the port throws `UnsupportedByPort` instead of guessing);
 * - transfer-hook configs (`create_config_with_transfer_hook`), except the token authority rule.
 *
 * On success it returns the values the program derives and stores in the config account.
 */
import type BN from "bn.js";
import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";
import {
  BaseFeeMode,
  BIN_STEP_BPS_DEFAULT,
  BIN_STEP_BPS_U128_DEFAULT,
  CollectFeeMode,
  DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY,
  DAMM_V2_MAX_BASIS_POINT,
  DammV2BaseFeeMode,
  FEE_DENOMINATOR,
  MAX_CURVE_POINT,
  MAX_FEE_NUMERATOR,
  MAX_MIGRATED_POOL_FEE_BPS,
  MAX_MIGRATION_FEE_PERCENTAGE,
  MAX_POOL_CREATION_FEE,
  MAX_SQRT_PRICE,
  MIN_FEE_NUMERATOR,
  MIN_LOCKED_LIQUIDITY_BPS,
  MIN_MIGRATED_POOL_FEE_BPS,
  MIN_POOL_CREATION_FEE,
  MIN_SQRT_PRICE,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
  TokenAuthorityOption,
  U128_MAX,
  U16_MAX,
  U24_MAX,
  U32_MAX,
  U64_MAX,
  U8_MAX,
} from "./constants";
import {
  type CurvePoint,
  DbcMathError,
  calculateCompoundingInitialSqrtPriceAndLiquidity,
  getBaseTokenForSwap,
  getConcentratedMigrationBaseAmount,
  getConstantProductBaseFromQuote,
  getDeltaAmountQuote,
  getFeeInPeriod,
  getMigrationFeeDistribution,
  getMigrationQuoteAmount,
  getMigrationThresholdPrice,
  getSwapAmountWithBuffer,
  mulDiv,
} from "./curveMath";

/** Thrown when params would be rejected by `create_config`. `code` is the DBC `PoolError` name. */
export class DbcConfigValidationError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = "DbcConfigValidationError";
  }
}

export interface DbcCreateConfigResult {
  /** `config.migration_sqrt_price`: the sqrt price at which the curve completes. */
  migrationSqrtPrice: bigint;
  /** `config.swap_base_amount`: base sold on the curve from start to migration price (rounded up). */
  swapBaseAmount: bigint;
  /** `config.migration_base_threshold`: base reserved for the DAMM v2 pool (incl. protocol fee). */
  migrationBaseThreshold: bigint;
  /** Quote that migrates to DAMM v2: `ceil(threshold * (100 - pct) / 100)`. */
  migrationQuoteAmount: bigint;
  /** Total migration fee: `threshold - migrationQuoteAmount`. */
  migrationFee: bigint;
  partnerMigrationFee: bigint;
  creatorMigrationFee: bigint;
  /** Base minted at pool creation (`PoolConfig::get_initial_base_supply`). */
  initialBaseSupply: bigint;
  fixedTokenSupply: boolean;
  /** Locked liquidity at day 1 in bps (`get_total_liquidity_locked_bps_at_n_seconds`). */
  lockedLiquidityBpsAtDay1: number;
}

export interface ValidateDbcConfigOptions {
  /** Needed for fixed-supply configs (the program rejects the default pubkey). */
  leftoverReceiver?: PublicKey;
  /** `create_config_with_transfer_hook` allows mint-authority token options. Default false. */
  isTransferHook?: boolean;
}

const fail = (code: string, message?: string): never => {
  throw new DbcConfigValidationError(code, message);
};

function require(condition: boolean, code: string, message?: string): void {
  if (!condition) fail(code, message);
}

function bnToBigInt(value: BN | bigint | number, what: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      fail("TypeCastFailed", `${what} is not a safe integer`);
    return BigInt(value);
  }
  if (value === null || value === undefined)
    return fail("TypeCastFailed", `${what} is missing`);
  return BigInt(value.toString());
}

function checkUint(value: bigint | number, max: bigint, what: string): bigint {
  const v =
    typeof value === "number"
      ? Number.isInteger(value)
        ? BigInt(value)
        : -1n
      : value;
  if (v < 0n || v > max)
    fail("TypeCastFailed", `${what} is out of range (${value})`);
  return v;
}

const u8 = (v: number, what: string) => Number(checkUint(v, U8_MAX, what));
const u16 = (v: number, what: string) => Number(checkUint(v, U16_MAX, what));
const u32 = (v: number, what: string) => Number(checkUint(v, U32_MAX, what));
const u64 = (v: BN | bigint | number, what: string) =>
  checkUint(bnToBigInt(v, what), U64_MAX, what);
const u128 = (v: BN | bigint | number, what: string) =>
  checkUint(bnToBigInt(v, what), U128_MAX, what);

function isZeroVesting(
  info: ConfigParameters["partnerLiquidityVestingInfo"],
): boolean {
  return (
    info.vestingPercentage === 0 &&
    info.bpsPerPeriod === 0 &&
    info.numberOfPeriods === 0 &&
    info.cliffDurationFromMigrationTime === 0 &&
    info.frequency === 0
  );
}

/** base_fee/fee_scheduler.rs `FeeScheduler::validate` (+ rate limiter rejection). */
function validateBaseFee(
  baseFee: ConfigParameters["poolFees"]["baseFee"],
): void {
  const mode = u8(baseFee.baseFeeMode, "baseFeeMode");
  require(mode !== BaseFeeMode.RateLimiter, "DeprecatedBaseFeeMode");
  require(mode === BaseFeeMode.FeeSchedulerLinear ||
    mode === BaseFeeMode.FeeSchedulerExponential, "InvalidBaseFeeMode");

  const cliff = u64(baseFee.cliffFeeNumerator, "cliffFeeNumerator");
  const numberOfPeriod = u16(baseFee.firstFactor, "firstFactor");
  const periodFrequency = u64(baseFee.secondFactor, "secondFactor");
  const reductionFactor = u64(baseFee.thirdFactor, "thirdFactor");

  if (
    periodFrequency !== 0n ||
    numberOfPeriod !== 0 ||
    reductionFactor !== 0n
  ) {
    require(numberOfPeriod !== 0 &&
      periodFrequency !== 0n &&
      reductionFactor !==
        0n, "InvalidFeeScheduler", "number_of_period, period_frequency and reduction_factor must all be set");
  }

  let minFee: bigint;
  if (mode === BaseFeeMode.FeeSchedulerLinear) {
    minFee = cliff - reductionFactor * BigInt(numberOfPeriod);
    require(minFee >= 0n, "MathOverflow", "linear fee scheduler underflows");
  } else {
    try {
      minFee = getFeeInPeriod(cliff, reductionFactor, numberOfPeriod);
    } catch (e) {
      return fail(
        e instanceof DbcMathError ? e.code : "MathOverflow",
        String(e),
      );
    }
  }
  // validate_fee_fraction: numerator < denominator
  require(minFee < FEE_DENOMINATOR && cliff < FEE_DENOMINATOR, "InvalidFee");
  require(minFee >= MIN_FEE_NUMERATOR &&
    cliff <=
      MAX_FEE_NUMERATOR, "ExceedMaxFeeBps", `min ${minFee}, max ${cliff}`);
}

/** fee_parameters.rs `DynamicFeeParameters::validate`. */
function validateDynamicFee(
  dynamicFee: NonNullable<ConfigParameters["poolFees"]["dynamicFee"]>,
): void {
  require(u16(dynamicFee.binStep, "binStep") ===
    BIN_STEP_BPS_DEFAULT, "InvalidInput", "bin_step");
  require(u128(dynamicFee.binStepU128, "binStepU128") ===
    BIN_STEP_BPS_U128_DEFAULT, "InvalidInput", "bin_step_u128");
  require(u16(dynamicFee.filterPeriod, "filterPeriod") <
    u16(dynamicFee.decayPeriod, "decayPeriod"), "InvalidInput");
  require(u16(dynamicFee.reductionFactor, "reductionFactor") <=
    10_000, "InvalidInput");
  require(BigInt(u32(dynamicFee.variableFeeControl, "variableFeeControl")) <=
    U24_MAX, "InvalidInput");
  require(BigInt(
    u32(dynamicFee.maxVolatilityAccumulator, "maxVolatilityAccumulator"),
  ) <= U24_MAX, "InvalidInput");
}

/** process_create_config.rs `MigratedPoolFeeValidator`. */
function validateMigratedPoolFee(params: ConfigParameters): void {
  const fee = params.migratedPoolFee;
  const scheduler = params.migratedPoolMarketCapFeeSchedulerParams;
  const collectFeeMode = u8(
    fee.collectFeeMode,
    "migratedPoolFee.collectFeeMode",
  );
  const dynamicFee = u8(fee.dynamicFee, "migratedPoolFee.dynamicFee");
  const poolFeeBps = u16(fee.poolFeeBps, "migratedPoolFee.poolFeeBps");
  const compoundingFeeBps = u16(params.compoundingFeeBps, "compoundingFeeBps");
  const baseFeeMode = u8(
    params.migratedPoolBaseFeeMode,
    "migratedPoolBaseFeeMode",
  );
  const schedulerIsZero =
    u16(scheduler.numberOfPeriod, "numberOfPeriod") === 0 &&
    u16(scheduler.sqrtPriceStepBps, "sqrtPriceStepBps") === 0 &&
    u32(
      scheduler.schedulerExpirationDuration,
      "schedulerExpirationDuration",
    ) === 0 &&
    u64(scheduler.reductionFactor, "reductionFactor") === 0n;

  const isCustomizable =
    u8(params.migrationFeeOption, "migrationFeeOption") ===
    MigrationFeeOption.Customizable;
  if (!isCustomizable) {
    require(collectFeeMode === 0 &&
      dynamicFee === 0 &&
      poolFeeBps === 0 &&
      compoundingFeeBps === 0 &&
      baseFeeMode === 0 &&
      schedulerIsZero, "InvalidMigratedPoolFee", "migrated pool fee must be empty unless migration_fee_option is Customizable");
    return;
  }

  require(poolFeeBps >= MIN_MIGRATED_POOL_FEE_BPS &&
    poolFeeBps <=
      MAX_MIGRATED_POOL_FEE_BPS, "InvalidMigratedPoolFee", "pool_fee_bps");
  require(collectFeeMode <=
    MigratedCollectFeeMode.Compounding, "InvalidCollectFeeMode");
  if (collectFeeMode === MigratedCollectFeeMode.Compounding) {
    require(compoundingFeeBps > 0 &&
      compoundingFeeBps <=
        DAMM_V2_MAX_BASIS_POINT, "InvalidMigratedPoolFee", "compounding_fee_bps");
  } else {
    require(compoundingFeeBps ===
      0, "InvalidMigratedPoolFee", "compounding_fee_bps must be 0");
  }
  require(dynamicFee <= 1, "InvalidMigratedPoolFee", "dynamic_fee");
  require(baseFeeMode <=
    DammV2BaseFeeMode.FeeMarketCapSchedulerExponential, "TypeCastFailed", "migrated_pool_base_fee_mode");
  switch (baseFeeMode) {
    case DammV2BaseFeeMode.FeeTimeSchedulerLinear:
    case DammV2BaseFeeMode.FeeTimeSchedulerExponential:
      require(schedulerIsZero, "InvalidMigratedPoolFee", "market cap scheduler params must be zero");
      break;
    case DammV2BaseFeeMode.FeeMarketCapSchedulerLinear:
    case DammV2BaseFeeMode.FeeMarketCapSchedulerExponential:
      fail(
        "UnsupportedByPort",
        "DAMM v2 market-cap fee scheduler validation is not ported",
      );
      break;
    default:
      fail(
        "InvalidMigratedPoolFee",
        "rate limiter is not allowed for migrated pools",
      );
  }
}

/** Validate DBC `ConfigParameters` like `create_config` does and return the derived config values. */
export function validateDbcConfigParams(
  params: ConfigParameters,
  options: ValidateDbcConfigOptions = {},
): DbcCreateConfigResult {
  const isTransferHook = options.isTransferHook ?? false;

  // ---- ConfigParameters::validate ----
  const activationType = u8(params.activationType, "activationType");
  require(activationType <= 1, "TypeCastFailed", "activation_type");

  validateBaseFee(params.poolFees.baseFee);
  if (params.poolFees.dynamicFee)
    validateDynamicFee(params.poolFees.dynamicFee);

  require(u8(
    params.creatorTradingFeePercentage,
    "creatorTradingFeePercentage",
  ) <= 100, "InvalidCreatorTradingFeePercentage");

  const feePercentage = u8(
    params.migrationFee.feePercentage,
    "migrationFee.feePercentage",
  );
  const creatorFeePercentage = u8(
    params.migrationFee.creatorFeePercentage,
    "migrationFee.creatorFeePercentage",
  );
  require(feePercentage <=
    MAX_MIGRATION_FEE_PERCENTAGE, "InvalidMigratorFeePercentage");
  if (feePercentage === 0)
    require(creatorFeePercentage === 0, "InvalidMigratorFeePercentage");
  else require(creatorFeePercentage <= 100, "InvalidMigratorFeePercentage");

  require(u8(params.collectFeeMode, "collectFeeMode") <=
    CollectFeeMode.OutputToken, "InvalidCollectFeeMode");
  const migrationOption = u8(params.migrationOption, "migrationOption");
  require(migrationOption <= MigrationOption.DammV2, "InvalidMigrationOption");
  require(u8(params.migrationFeeOption, "migrationFeeOption") <=
    MigrationFeeOption.Customizable, "InvalidMigrationFeeOption");
  require(u8(params.tokenType, "tokenType") <= 1, "InvalidTokenType");

  require(migrationOption !==
    MigrationOption.MeteoraDamm, "DeprecatedMigrationOption");
  validateMigratedPoolFee(params);
  if (
    !isZeroVesting(params.partnerLiquidityVestingInfo) ||
    !isZeroVesting(params.creatorLiquidityVestingInfo)
  ) {
    fail("UnsupportedByPort", "liquidity vesting validation is not ported");
  }

  const tokenAuthority = u8(
    params.tokenUpdateAuthority,
    "tokenUpdateAuthority",
  );
  require(tokenAuthority <=
    TokenAuthorityOption.PartnerUpdateAndMintAuthority, "InvalidTokenAuthorityOption");
  const hasMintAuthority =
    tokenAuthority === TokenAuthorityOption.CreatorUpdateAndMintAuthority ||
    tokenAuthority === TokenAuthorityOption.PartnerUpdateAndMintAuthority;
  require(isTransferHook ||
    !hasMintAuthority, "InvalidTokenAuthorityOption", "mint authority options need a transfer-hook config");

  const tokenDecimal = u8(params.tokenDecimal, "tokenDecimal");
  require(tokenDecimal >= 6 && tokenDecimal <= 9, "InvalidTokenDecimals");

  const partnerPermanentLocked = u8(
    params.partnerPermanentLockedLiquidityPercentage,
    "partnerPermanentLockedLiquidityPercentage",
  );
  const creatorPermanentLocked = u8(
    params.creatorPermanentLockedLiquidityPercentage,
    "creatorPermanentLockedLiquidityPercentage",
  );
  const liquiditySum =
    u8(params.partnerLiquidityPercentage, "partnerLiquidityPercentage") +
    partnerPermanentLocked +
    u8(params.creatorLiquidityPercentage, "creatorLiquidityPercentage") +
    creatorPermanentLocked +
    u8(
      params.partnerLiquidityVestingInfo.vestingPercentage,
      "partnerLiquidityVestingInfo.vestingPercentage",
    ) +
    u8(
      params.creatorLiquidityVestingInfo.vestingPercentage,
      "creatorLiquidityVestingInfo.vestingPercentage",
    );
  // The program sums u8 values with safe_add, so an overflow above 255 is a MathOverflow.
  require(liquiditySum <=
    255, "MathOverflow", "liquidity percentage sum overflows u8");
  require(liquiditySum ===
    100, "InvalidFeePercentage", `liquidity percentages sum to ${liquiditySum}`);

  const threshold = u64(
    params.migrationQuoteThreshold,
    "migrationQuoteThreshold",
  );
  require(threshold > 0n, "InvalidQuoteThreshold");

  const lv = params.lockedVesting;
  const amountPerPeriod = u64(
    lv.amountPerPeriod,
    "lockedVesting.amountPerPeriod",
  );
  const cliffDuration = u64(
    lv.cliffDurationFromMigrationTime,
    "lockedVesting.cliffDurationFromMigrationTime",
  );
  const frequency = u64(lv.frequency, "lockedVesting.frequency");
  const numberOfPeriod = u64(lv.numberOfPeriod, "lockedVesting.numberOfPeriod");
  const cliffUnlockAmount = u64(
    lv.cliffUnlockAmount,
    "lockedVesting.cliffUnlockAmount",
  );
  const hasVesting =
    amountPerPeriod !== 0n ||
    cliffDuration !== 0n ||
    frequency !== 0n ||
    numberOfPeriod !== 0n ||
    cliffUnlockAmount !== 0n;
  const totalVestingAmount =
    cliffUnlockAmount + amountPerPeriod * numberOfPeriod;
  require(totalVestingAmount <=
    U64_MAX, "MathOverflow", "locked vesting total");
  if (hasVesting)
    require(frequency !== 0n &&
      totalVestingAmount !== 0n, "InvalidVestingParameters");

  const poolCreationFee = u64(params.poolCreationFee, "poolCreationFee");
  if (poolCreationFee > 0n) {
    require(poolCreationFee >= MIN_POOL_CREATION_FEE &&
      poolCreationFee <= MAX_POOL_CREATION_FEE, "InvalidPoolCreationFee");
  }

  const sqrtStartPrice = u128(params.sqrtStartPrice, "sqrtStartPrice");
  require(sqrtStartPrice >= MIN_SQRT_PRICE &&
    sqrtStartPrice <
      MAX_SQRT_PRICE, "InvalidCurve", "sqrt_start_price out of range");
  require(params.curve.length > 0 &&
    params.curve.length <=
      MAX_CURVE_POINT, "InvalidCurve", `curve has ${params.curve.length} points`);
  const curve: CurvePoint[] = params.curve.map((p, i) => ({
    sqrtPrice: u128(p.sqrtPrice, `curve[${i}].sqrtPrice`),
    liquidity: u128(p.liquidity, `curve[${i}].liquidity`),
  }));
  require(curve[0]!.sqrtPrice > sqrtStartPrice &&
    curve[0]!.liquidity > 0n &&
    curve[0]!.sqrtPrice <=
      MAX_SQRT_PRICE, "InvalidCurve", "first curve point must be above the start price with liquidity > 0");
  for (let i = 1; i < curve.length; i++) {
    require(curve[i]!.sqrtPrice > curve[i - 1]!.sqrtPrice &&
      curve[i]!.liquidity >
        0n, "InvalidCurve", `curve point ${i} must have a strictly higher sqrt price and liquidity > 0`);
  }
  require(curve[curve.length - 1]!.sqrtPrice <=
    MAX_SQRT_PRICE, "InvalidCurve", "last sqrt price above max");

  // ---- process_create_config ----
  try {
    const migrationSqrtPrice = getMigrationThresholdPrice(
      threshold,
      sqrtStartPrice,
      curve,
    );
    require(migrationSqrtPrice <
      MAX_SQRT_PRICE, "InvalidCurve", "migration sqrt price must be below max");

    const swapBaseAmount = getBaseTokenForSwap(
      sqrtStartPrice,
      migrationSqrtPrice,
      curve,
    );
    require(swapBaseAmount <=
      U64_MAX, "TypeCastFailed", "swap base amount does not fit u64");

    const migratedCollectFeeMode = params.migratedPoolFee.collectFeeMode;
    const { quoteAmount: migrationQuoteAmount, fee: migrationFee } =
      getMigrationQuoteAmount(threshold, feePercentage);
    const migrationBaseThreshold =
      migratedCollectFeeMode === MigratedCollectFeeMode.Compounding
        ? getConstantProductBaseFromQuote(
            migrationQuoteAmount,
            migrationSqrtPrice,
          )
        : getConcentratedMigrationBaseAmount(
            migrationQuoteAmount,
            migrationSqrtPrice,
          );
    require(migrationBaseThreshold > 0n &&
      swapBaseAmount >
        0n, "InvalidCurve", "swap and migration base amounts must be > 0");

    if (migratedCollectFeeMode === MigratedCollectFeeMode.Compounding) {
      const baseFee = mulDiv(
        migrationBaseThreshold,
        PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
        10_000n,
        false,
      );
      const quoteFee = mulDiv(
        migrationQuoteAmount,
        PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
        10_000n,
        false,
      );
      const info = calculateCompoundingInitialSqrtPriceAndLiquidity(
        migrationBaseThreshold - baseFee,
        migrationQuoteAmount - quoteFee,
      );
      if (info === null)
        return fail("MathOverflow", "compounding initial price");
      require(info.sqrtPrice >= MIN_SQRT_PRICE &&
        info.sqrtPrice <= MAX_SQRT_PRICE, "InvalidCompoundingParameters");
      require(info.liquidity >
        DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY, "InsufficientLiquidityForMigration");
      const diff =
        migrationSqrtPrice > info.sqrtPrice
          ? migrationSqrtPrice - info.sqrtPrice
          : info.sqrtPrice - migrationSqrtPrice;
      const max =
        migrationSqrtPrice > info.sqrtPrice
          ? migrationSqrtPrice
          : info.sqrtPrice;
      require(diff * 100n <=
        max, "InvalidCurve", "compounding price deviates more than 1%");
    }

    const swapAmountWithBuffer = getSwapAmountWithBuffer(
      swapBaseAmount,
      sqrtStartPrice,
      curve,
    );
    let fixedTokenSupply = false;
    let initialBaseSupply: bigint;
    if (params.tokenSupply) {
      fixedTokenSupply = true;
      const pre = u64(
        params.tokenSupply.preMigrationTokenSupply,
        "preMigrationTokenSupply",
      );
      const post = u64(
        params.tokenSupply.postMigrationTokenSupply,
        "postMigrationTokenSupply",
      );
      const minWithBuffer =
        swapAmountWithBuffer + migrationBaseThreshold + totalVestingAmount;
      const minWithoutBuffer =
        swapBaseAmount + migrationBaseThreshold + totalVestingAmount;
      require(minWithBuffer <= U64_MAX, "MathOverflow", "token supply");
      require(options.leftoverReceiver !== undefined &&
        !options.leftoverReceiver.equals(
          PublicKey.default,
        ), "InvalidLeftoverAddress");
      require(minWithoutBuffer <= post &&
        post <= pre &&
        minWithBuffer <= pre, "InvalidTokenSupply");
      initialBaseSupply = pre;
    } else {
      initialBaseSupply =
        swapAmountWithBuffer + migrationBaseThreshold + totalVestingAmount;
      // get_initial_base_supply is computed with safe_add at pool creation.
      require(initialBaseSupply <=
        U64_MAX, "MathOverflow", "initial base supply does not fit u64");
    }

    // Vesting infos are zero (enforced above), so only permanent locks count.
    const lockedLiquidityBpsAtDay1 =
      partnerPermanentLocked * 100 + creatorPermanentLocked * 100;
    require(lockedLiquidityBpsAtDay1 >=
      MIN_LOCKED_LIQUIDITY_BPS, "InvalidMigrationLockedLiquidity");

    const { partnerMigrationFee, creatorMigrationFee } =
      getMigrationFeeDistribution(
        threshold,
        feePercentage,
        creatorFeePercentage,
      );

    return {
      migrationSqrtPrice,
      swapBaseAmount,
      migrationBaseThreshold,
      migrationQuoteAmount,
      migrationFee,
      partnerMigrationFee,
      creatorMigrationFee,
      initialBaseSupply,
      fixedTokenSupply,
      lockedLiquidityBpsAtDay1,
    };
  } catch (e) {
    if (e instanceof DbcMathError)
      throw new DbcConfigValidationError(e.code, e.message);
    throw e;
  }
}

/**
 * Extra liveness check that the program does NOT perform: the quote needed to push the price
 * from the start to the migration price (rounded up, as every swap rounds its input up) must
 * reach the threshold. Otherwise the pool could stop at the migration price (swaps are capped
 * there) with `quote_reserve < threshold` and never complete. For liquidity values below 2^128
 * this holds by construction (the price rounding loses less than one quote unit), so this is a
 * defensive check against future curve builders. Returns that quote amount.
 */
export function assertCurveCanComplete(
  params: ConfigParameters,
  migrationSqrtPrice: bigint,
): bigint {
  const threshold = bnToBigInt(
    params.migrationQuoteThreshold,
    "migrationQuoteThreshold",
  );
  let current = bnToBigInt(params.sqrtStartPrice, "sqrtStartPrice");
  let quote = 0n;
  for (const p of params.curve) {
    const upper = bnToBigInt(p.sqrtPrice, "sqrtPrice");
    const liquidity = bnToBigInt(p.liquidity, "liquidity");
    const target = upper < migrationSqrtPrice ? upper : migrationSqrtPrice;
    if (target > current) {
      quote += getDeltaAmountQuote(current, target, liquidity, true);
      current = target;
    }
    if (current >= migrationSqrtPrice) break;
  }
  require(quote >=
    threshold, "CurveCannotComplete", `reaching the migration price takes ${quote} < threshold ${threshold}`);
  return quote;
}
