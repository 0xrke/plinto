/**
 * Exact bigint port of the Meteora DBC 0.2.1 curve math that `create_config` runs.
 *
 * Units:
 * - A sqrt price is Q64.64: `sqrtPrice = sqrt(quoteRaw / baseRaw) * 2^64`.
 * - Liquidity `L` is stored as `L_real * 2^64`, so
 *   `Δquote = L * (√P_upper - √P_lower) / 2^128` and
 *   `Δbase  = L * (√P_upper - √P_lower) / (√P_upper * √P_lower)`.
 *
 * Every function mirrors a Rust function in vendor/dbc/programs/dynamic-bonding-curve/src
 * (the file is named in each doc comment), including the rounding direction and the
 * u64/u128 range checks that make the program fail.
 */
import {
  BASIS_POINT_MAX,
  DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  ONE_Q64,
  PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
  RESOLUTION,
  SWAP_BUFFER_PERCENTAGE,
  U128_MAX,
  U64_MAX,
} from "./constants";

export interface CurvePoint {
  sqrtPrice: bigint;
  liquidity: bigint;
}

/** Error thrown by the port where the program would fail. `code` is the DBC `PoolError` name. */
export class DbcMathError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = "DbcMathError";
  }
}

export function assertU64(value: bigint, what: string): bigint {
  if (value < 0n || value > U64_MAX)
    throw new DbcMathError(
      "MathOverflow",
      `${what} does not fit u64 (${value})`,
    );
  return value;
}

export function assertU128(value: bigint, what: string): bigint {
  if (value < 0n || value > U128_MAX)
    throw new DbcMathError(
      "MathOverflow",
      `${what} does not fit u128 (${value})`,
    );
  return value;
}

/** `x * y / denominator`, rounded down or up (u128x128_math::mul_div_u256). */
export function mulDiv(
  x: bigint,
  y: bigint,
  denominator: bigint,
  roundUp: boolean,
): bigint {
  if (denominator === 0n)
    throw new DbcMathError("MathOverflow", "division by zero");
  const prod = x * y;
  const q = prod / denominator;
  return roundUp && q * denominator !== prod ? q + 1n : q;
}

/** `ceil(a / b)` for non-negative integers. */
export function divCeil(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new DbcMathError("MathOverflow", "division by zero");
  return (a + b - 1n) / b;
}

/** Integer square root: the largest `r` with `r * r <= n`. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of a negative number");
  if (n < 2n) return n;
  // Newton iteration starting from a power of two above the root.
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** curve.rs `get_delta_amount_base_unsigned_256`: `L * (upper - lower) / (lower * upper)`. */
export function getDeltaAmountBase(
  lower: bigint,
  upper: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (upper < lower)
    throw new DbcMathError("MathOverflow", "upper sqrt price below lower");
  const denominator = lower * upper;
  if (denominator <= 0n)
    throw new DbcMathError("MathOverflow", "zero sqrt price");
  return mulDiv(liquidity, upper - lower, denominator, roundUp);
}

/** curve.rs `get_delta_amount_quote_unsigned_256`: `L * (upper - lower) / 2^128`. */
export function getDeltaAmountQuote(
  lower: bigint,
  upper: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (upper < lower)
    throw new DbcMathError("MathOverflow", "upper sqrt price below lower");
  const prod = liquidity * (upper - lower);
  return roundUp
    ? divCeil(prod, 1n << (RESOLUTION * 2n))
    : prod >> (RESOLUTION * 2n);
}

/** curve.rs `get_next_sqrt_price_from_quote_amount_in_rounding_down`: `√P + (Δq << 128) / L`. */
export function getNextSqrtPriceFromQuoteAmountIn(
  sqrtPrice: bigint,
  liquidity: bigint,
  amountIn: bigint,
): bigint {
  if (liquidity <= 0n) throw new DbcMathError("MathOverflow", "zero liquidity");
  const next = sqrtPrice + (amountIn << (RESOLUTION * 2n)) / liquidity;
  if (next > U128_MAX)
    throw new DbcMathError(
      "TypeCastFailed",
      "next sqrt price does not fit u128",
    );
  return next;
}

/**
 * liquidity_distribution.rs `get_migration_threshold_price`: the sqrt price reached once
 * `migrationThreshold` quote has been swapped in from `sqrtStartPrice`.
 * Throws `NotEnoughLiquidity` when the curve cannot absorb the threshold.
 */
export function getMigrationThresholdPrice(
  migrationThreshold: bigint,
  sqrtStartPrice: bigint,
  curve: readonly CurvePoint[],
): bigint {
  if (curve.length === 0) throw new DbcMathError("InvalidCurve", "empty curve");
  const first = curve[0]!;
  const totalAmount = getDeltaAmountQuote(
    sqrtStartPrice,
    first.sqrtPrice,
    first.liquidity,
    true,
  );
  if (totalAmount > migrationThreshold) {
    return getNextSqrtPriceFromQuoteAmountIn(
      sqrtStartPrice,
      first.liquidity,
      migrationThreshold,
    );
  }
  let amountLeft = migrationThreshold - totalAmount;
  let nextSqrtPrice = first.sqrtPrice;
  for (let i = 1; i < curve.length; i++) {
    const point = curve[i]!;
    const maxAmount = getDeltaAmountQuote(
      nextSqrtPrice,
      point.sqrtPrice,
      point.liquidity,
      true,
    );
    if (maxAmount > amountLeft) {
      nextSqrtPrice = getNextSqrtPriceFromQuoteAmountIn(
        nextSqrtPrice,
        point.liquidity,
        amountLeft,
      );
      amountLeft = 0n;
      break;
    }
    assertU64(maxAmount, "segment quote amount");
    amountLeft -= maxAmount;
    nextSqrtPrice = point.sqrtPrice;
  }
  if (amountLeft !== 0n)
    throw new DbcMathError(
      "NotEnoughLiquidity",
      `curve is short by ${amountLeft} quote raw`,
    );
  return nextSqrtPrice;
}

/**
 * liquidity_distribution.rs `get_base_token_for_swap`: base tokens sold between the start
 * price and `sqrtMigrationPrice` (rounded up, as in the program).
 */
export function getBaseTokenForSwap(
  sqrtStartPrice: bigint,
  sqrtMigrationPrice: bigint,
  curve: readonly CurvePoint[],
): bigint {
  let total = 0n;
  for (let i = 0; i < curve.length; i++) {
    const point = curve[i]!;
    const lower = i === 0 ? sqrtStartPrice : curve[i - 1]!.sqrtPrice;
    if (point.sqrtPrice > sqrtMigrationPrice) {
      total += getDeltaAmountBase(
        lower,
        sqrtMigrationPrice,
        point.liquidity,
        true,
      );
      break;
    }
    total += getDeltaAmountBase(lower, point.sqrtPrice, point.liquidity, true);
  }
  return total;
}

/**
 * config.rs `get_migration_quote_amount`:
 * `quoteAmount = ceil(threshold * (100 - pct) / 100)`, `fee = threshold - quoteAmount`.
 */
export function getMigrationQuoteAmount(
  migrationQuoteThreshold: bigint,
  migrationFeePercentage: number,
): { quoteAmount: bigint; fee: bigint } {
  const quoteAmount = assertU64(
    mulDiv(
      migrationQuoteThreshold,
      BigInt(100 - migrationFeePercentage),
      100n,
      true,
    ),
    "migration quote amount",
  );
  return { quoteAmount, fee: migrationQuoteThreshold - quoteAmount };
}

/**
 * config.rs `get_migration_fee_distribution`: the creator gets
 * `floor(fee * creatorPct / 100)`, the partner (fee claimer) gets the rest.
 */
export function getMigrationFeeDistribution(
  migrationQuoteThreshold: bigint,
  migrationFeePercentage: number,
  creatorMigrationFeePercentage: number,
): { partnerMigrationFee: bigint; creatorMigrationFee: bigint } {
  const { fee } = getMigrationQuoteAmount(
    migrationQuoteThreshold,
    migrationFeePercentage,
  );
  const creatorMigrationFee = mulDiv(
    fee,
    BigInt(creatorMigrationFeePercentage),
    100n,
    false,
  );
  return {
    partnerMigrationFee: fee - creatorMigrationFee,
    creatorMigrationFee,
  };
}

/** concentrated_liquidity.rs `get_initial_liquidity_from_delta_quote`: `(Δq << 128) / (√P - √P_min)`. */
export function getInitialLiquidityFromDeltaQuote(
  quoteAmount: bigint,
  sqrtMinPrice: bigint,
  sqrtPrice: bigint,
): bigint {
  if (sqrtPrice < sqrtMinPrice)
    throw new DbcMathError("MathOverflow", "sqrt price below min");
  const delta = sqrtPrice - sqrtMinPrice;
  if (delta === 0n) throw new DbcMathError("MathOverflow", "division by zero");
  const liquidity = (quoteAmount << 128n) / delta;
  if (liquidity > U128_MAX)
    throw new DbcMathError("TypeCastFailed", "liquidity does not fit u128");
  return liquidity;
}

/**
 * Base amount DBC reserves for the DAMM v2 pool in create_config
 * (`ConcentratedLiquidity::get_included_protocol_fee_migration_amounts_1`): a full-range
 * position at the migration price holding `quoteAmount` of quote.
 */
export function getConcentratedMigrationBaseAmount(
  quoteAmount: bigint,
  sqrtMigrationPrice: bigint,
): bigint {
  const liquidity = getInitialLiquidityFromDeltaQuote(
    quoteAmount,
    MIN_SQRT_PRICE,
    sqrtMigrationPrice,
  );
  return assertU64(
    getDeltaAmountBase(sqrtMigrationPrice, MAX_SQRT_PRICE, liquidity, true),
    "migration base amount",
  );
}

/** compounding_liquidity.rs `get_constant_product_base_from_quote`: `ceil((q << 128) / √P²)`. */
export function getConstantProductBaseFromQuote(
  quoteAmount: bigint,
  sqrtMigrationPrice: bigint,
): bigint {
  const price = sqrtMigrationPrice * sqrtMigrationPrice;
  return assertU64(
    divCeil(quoteAmount << 128n, price),
    "migration base amount",
  );
}

/**
 * compounding_liquidity.rs `calculate_compounding_initial_sqrt_price_and_liquidity`.
 * Returns `null` where the program returns `None`.
 */
export function calculateCompoundingInitialSqrtPriceAndLiquidity(
  tokenAAmount: bigint,
  tokenBAmount: bigint,
): { sqrtPrice: bigint; liquidity: bigint } | null {
  if (tokenAAmount === 0n) return null;
  const sqrtPrice1 = isqrt(divCeil(tokenBAmount << 128n, tokenAAmount));
  if (
    sqrtPrice1 > U128_MAX ||
    sqrtPrice1 < MIN_SQRT_PRICE ||
    sqrtPrice1 > MAX_SQRT_PRICE
  )
    return null;
  const sqrtPrice2 = isqrt((tokenBAmount << 128n) / tokenAAmount);
  const liquidity = sqrtPrice2 * tokenAAmount;
  if (liquidity > U128_MAX) return null;
  return { sqrtPrice: sqrtPrice1, liquidity };
}

/**
 * Protocol liquidity migration fee of a concentrated (non-compounding) DAMM v2 migration
 * (`ConcentratedLiquidity::get_migration_protocol_fees`, 0.2% of the migrated quote).
 * The base part stays in the DBC base vault and therefore stays in the mint supply.
 */
export function getConcentratedProtocolMigrationFees(
  depositQuoteAmount: bigint,
  sqrtMigrationPrice: bigint,
  migrationFeeBps: bigint = PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
): { baseFee: bigint; quoteFee: bigint } {
  const quoteFee = mulDiv(
    depositQuoteAmount,
    migrationFeeBps,
    BASIS_POINT_MAX,
    false,
  );
  const feeLiquidity = getInitialLiquidityFromDeltaQuote(
    quoteFee,
    MIN_SQRT_PRICE,
    sqrtMigrationPrice,
  );
  const baseFee = assertU64(
    getDeltaAmountBase(sqrtMigrationPrice, MAX_SQRT_PRICE, feeLiquidity, false),
    "protocol base fee",
  );
  return { baseFee, quoteFee };
}

/**
 * config.rs `get_swap_amount_with_buffer`: `min(swap * 1.25, base available on the whole curve)`.
 * For dynamic-supply configs this plus the migration base amount is the initial mint.
 */
export function getSwapAmountWithBuffer(
  swapBaseAmount: bigint,
  sqrtStartPrice: bigint,
  curve: readonly CurvePoint[],
): bigint {
  const buffered =
    swapBaseAmount + (swapBaseAmount * SWAP_BUFFER_PERCENTAGE) / 100n;
  const maxOnCurve = getBaseTokenForSwap(sqrtStartPrice, MAX_SQRT_PRICE, curve);
  return assertU64(
    buffered < maxOnCurve ? buffered : maxOnCurve,
    "swap amount with buffer",
  );
}

/** fee_math.rs `pow`: Q64.64 exponentiation with the program's truncation. `null` = `None`. */
export function powQ64(base: bigint, exp: number): bigint | null {
  const MAX_EXPONENTIAL = 0x80000;
  if (!Number.isInteger(exp) || exp === -2147483648) return null;
  let invert = exp < 0;
  if (exp === 0) return ONE_Q64;
  const e = Math.abs(exp);
  if (e >= MAX_EXPONENTIAL) return null;

  const mul = (a: bigint, b: bigint): bigint | null => {
    const p = a * b;
    return p > U128_MAX ? null : p >> 64n;
  };

  let squaredBase = base;
  let result: bigint | null = ONE_Q64;
  if (squaredBase >= result) {
    if (squaredBase === 0n) return null;
    squaredBase = U128_MAX / squaredBase;
    invert = !invert;
  }
  for (let bit = 0; bit < 19; bit++) {
    if (bit > 0) {
      const next = mul(squaredBase, squaredBase);
      if (next === null) return null;
      squaredBase = next;
    }
    if ((e & (1 << bit)) !== 0) {
      result = mul(result, squaredBase);
      if (result === null) return null;
    }
  }
  if (result === 0n) return null;
  if (invert) result = U128_MAX / result;
  return result;
}

/** fee_math.rs `get_fee_in_period`: `cliff * (1 - reduction / 10_000)^period`. */
export function getFeeInPeriod(
  cliffFeeNumerator: bigint,
  reductionFactor: bigint,
  passedPeriod: number,
): bigint {
  const bps = (reductionFactor << 64n) / BASIS_POINT_MAX;
  if (bps > ONE_Q64)
    throw new DbcMathError("MathOverflow", "reduction factor above 100%");
  const base = ONE_Q64 - bps;
  const result = powQ64(base, passedPeriod);
  if (result === null) throw new DbcMathError("MathOverflow", "pow overflow");
  const product = result * cliffFeeNumerator;
  // The program multiplies in u128 and shifts; a product above u128 fails `safe_mul`.
  if (product > U128_MAX)
    throw new DbcMathError("MathOverflow", "fee product overflow");
  return assertU64(product >> 64n, "fee numerator");
}

/** Re-exported for the compounding migration check. */
export { DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY };
