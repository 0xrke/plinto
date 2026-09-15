/**
 * Exact bigint port of the Meteora DBC 0.2.1 `swap2` math (ExactIn, PartialFill, ExactOut):
 * vendor/dbc/programs/dynamic-bonding-curve/src/state/virtual_pool.rs (get_swap_result_*,
 * calculate_*), state/config.rs (PoolFeesConfig), base_fee/fee_scheduler.rs and curve.rs,
 * including rounding directions and the checks that make the program fail.
 *
 * Scope: fee scheduler base fees (linear / exponential) without the dynamic (volatility) fee and
 * without the deprecated rate limiter, which is exactly what `create_launch` allows for StockFloor
 * launches. Other configs throw `DbcMathError("UnsupportedByPort")`.
 *
 * Fork tests (tests/sdk) assert that every quote equals the real program's result.
 */
import { assertU128, assertU64, DbcMathError, getDeltaAmountBase, getDeltaAmountQuote, getFeeInPeriod, getNextSqrtPriceFromQuoteAmountIn, mulDiv } from "./curveMath";
import { BaseFeeMode, CollectFeeMode, FEE_DENOMINATOR, MAX_FEE_NUMERATOR, U128_MAX } from "./constants";
import type { DbcPoolConfig, DbcVirtualPool } from "./accounts";

export const DbcTradeDirection = { BaseToQuote: 0, QuoteToBase: 1 } as const;
export type DbcTradeDirection = (typeof DbcTradeDirection)[keyof typeof DbcTradeDirection];

export const DbcSwapMode = { ExactIn: 0, PartialFill: 1, ExactOut: 2 } as const;
export type DbcSwapMode = (typeof DbcSwapMode)[keyof typeof DbcSwapMode];

const PROTOCOL_FEE_PERCENT = 20n;
const HOST_FEE_PERCENT = 20n;

export interface DbcSwapQuoteParams {
  config: DbcPoolConfig;
  pool: DbcVirtualPool;
  /** QuoteToBase = buy, BaseToQuote = sell. */
  direction: DbcTradeDirection;
  mode: DbcSwapMode;
  /** ExactIn / PartialFill: amount in. ExactOut: amount out. */
  amount: bigint;
  /** Unix timestamp for timestamp-activated configs, slot otherwise. */
  currentPoint: bigint;
  hasReferral?: boolean;
  /** Only for the creator's first buy in the pool-creation transaction when the config enables it. */
  eligibleForFirstSwapWithMinFee?: boolean;
}

export interface DbcSwapQuote {
  /** Input the payer transfers (fee included when fees are on the input). */
  includedFeeInputAmount: bigint;
  /** Input that moves the curve. */
  excludedFeeInputAmount: bigint;
  /** PartialFill: input the curve could not absorb (never transferred). */
  amountLeft: bigint;
  /** Output the user receives. */
  outputAmount: bigint;
  nextSqrtPrice: bigint;
  /** Trading fee after the protocol share (partner + creator). */
  tradingFee: bigint;
  protocolFee: bigint;
  referralFee: bigint;
  /** Partner (fee claimer) part of the trading fee: what harvest_curve_fees collects. */
  partnerFee: bigint;
  creatorFee: bigint;
  /** Fees are collected in the base token (OutputToken mode buys). */
  feesOnBaseToken: boolean;
  feesOnInput: boolean;
  tradeFeeNumerator: bigint;
  /** Pool reserves after the swap (as `apply_swap_result` updates them). */
  quoteReserveAfter: bigint;
  baseReserveAfter: bigint;
  /** quote_reserve >= migration threshold after the swap. */
  completesCurve: boolean;
}

// ------------------------------------------------------------------ fees

function mulDivU64(x: bigint, y: bigint, d: bigint, roundUp: boolean, what: string): bigint {
  const v = mulDiv(x, y, d, roundUp);
  if (v > (1n << 64n) - 1n) throw new DbcMathError("TypeCastFailed", `${what} does not fit u64`);
  return v;
}

/** Base fee numerator of a fee scheduler (fee_scheduler.rs). */
export function dbcBaseFeeNumerator(
  config: DbcPoolConfig,
  pool: DbcVirtualPool,
  currentPoint: bigint,
  minFee = false,
): bigint {
  const f = config.poolFees.baseFee;
  if (f.baseFeeMode === BaseFeeMode.RateLimiter) {
    throw new DbcMathError("UnsupportedByPort", "rate limiter base fee");
  }
  if (f.baseFeeMode !== BaseFeeMode.FeeSchedulerLinear && f.baseFeeMode !== BaseFeeMode.FeeSchedulerExponential) {
    throw new DbcMathError("InvalidBaseFeeMode");
  }
  const numberOfPeriod = BigInt(f.firstFactor);
  const byPeriod = (periodIn: bigint): bigint => {
    const period = periodIn < numberOfPeriod ? periodIn : numberOfPeriod;
    if (f.baseFeeMode === BaseFeeMode.FeeSchedulerLinear) {
      const v = f.cliffFeeNumerator - f.thirdFactor * period;
      if (v < 0n) throw new DbcMathError("MathOverflow", "linear fee below zero");
      return v;
    }
    return getFeeInPeriod(f.cliffFeeNumerator, f.thirdFactor, Number(period));
  };
  if (minFee) return byPeriod(numberOfPeriod);
  if (f.secondFactor === 0n) return f.cliffFeeNumerator;
  if (currentPoint < pool.activationPoint) throw new DbcMathError("MathOverflow", "current point before activation");
  return byPeriod((currentPoint - pool.activationPoint) / f.secondFactor);
}

/** Total trade fee numerator (base + dynamic, capped at 99%). */
export function dbcTradeFeeNumerator(config: DbcPoolConfig, pool: DbcVirtualPool, currentPoint: bigint, minFee = false): bigint {
  if (config.poolFees.dynamicFee.initialized !== 0) {
    throw new DbcMathError("UnsupportedByPort", "dynamic (volatility) fee");
  }
  const base = dbcBaseFeeNumerator(config, pool, currentPoint, minFee);
  return base > MAX_FEE_NUMERATOR ? MAX_FEE_NUMERATOR : base;
}

interface FeeOnAmount {
  amount: bigint;
  tradingFee: bigint;
  protocolFee: bigint;
  referralFee: bigint;
}

/** PoolFeesConfig::get_fee_on_amount: fee = ceil(amount * num / 1e9), split protocol 20% (referral 20% of it). */
export function dbcFeeOnAmount(numerator: bigint, amount: bigint, hasReferral: boolean): FeeOnAmount {
  const fee = mulDivU64(amount, numerator, FEE_DENOMINATOR, true, "trading fee");
  const excluded = amount - fee;
  if (excluded < 0n) throw new DbcMathError("MathOverflow", "fee above amount");
  let protocolFee = mulDivU64(fee, PROTOCOL_FEE_PERCENT, 100n, false, "protocol fee");
  const tradingFee = fee - protocolFee;
  const referralFee = hasReferral ? mulDivU64(protocolFee, HOST_FEE_PERCENT, 100n, false, "referral fee") : 0n;
  protocolFee -= referralFee;
  return { amount: excluded, tradingFee, protocolFee, referralFee };
}

/** PoolFeesConfig::get_included_fee_amount: included = ceil(excluded * 1e9 / (1e9 - num)). */
export function dbcIncludedFeeAmount(numerator: bigint, excluded: bigint): { included: bigint; fee: bigint } {
  const included = mulDivU64(excluded, FEE_DENOMINATOR, FEE_DENOMINATOR - numerator, true, "included fee amount");
  return { included, fee: included - excluded };
}

function splitFees(fee: bigint, hasReferral: boolean): { tradingFee: bigint; protocolFee: bigint; referralFee: bigint } {
  let protocolFee = mulDivU64(fee, PROTOCOL_FEE_PERCENT, 100n, false, "protocol fee");
  const tradingFee = fee - protocolFee;
  const referralFee = hasReferral ? mulDivU64(protocolFee, HOST_FEE_PERCENT, 100n, false, "referral fee") : 0n;
  protocolFee -= referralFee;
  return { tradingFee, protocolFee, referralFee };
}

/** PoolConfig::split_partner_and_creator_fee. */
export function dbcSplitPartnerCreatorFee(config: DbcPoolConfig, tradingFee: bigint): { partnerFee: bigint; creatorFee: bigint } {
  if (config.creatorTradingFeePercentage === 0) return { partnerFee: tradingFee, creatorFee: 0n };
  const creatorFee = mulDivU64(tradingFee, BigInt(config.creatorTradingFeePercentage), 100n, false, "creator fee");
  return { partnerFee: tradingFee - creatorFee, creatorFee };
}

/** FeeMode::get_fee_mode. */
export function dbcFeeMode(collectFeeMode: number, direction: DbcTradeDirection): { feesOnInput: boolean; feesOnBaseToken: boolean } {
  if (collectFeeMode === CollectFeeMode.QuoteToken) {
    return { feesOnInput: direction === DbcTradeDirection.QuoteToBase, feesOnBaseToken: false };
  }
  if (collectFeeMode === CollectFeeMode.OutputToken) {
    return { feesOnInput: false, feesOnBaseToken: direction === DbcTradeDirection.QuoteToBase };
  }
  throw new DbcMathError("InvalidCollectFeeMode");
}

// ------------------------------------------------------------------ curve.rs

const U256_SHIFT = 128n;

function deltaBaseU64(lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const v = getDeltaAmountBase(lower, upper, liquidity, roundUp);
  if (v > (1n << 64n) - 1n) throw new DbcMathError("MathOverflow", "base delta does not fit u64");
  return v;
}

function deltaQuoteU64(lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const v = getDeltaAmountQuote(lower, upper, liquidity, roundUp);
  if (v > (1n << 64n) - 1n) throw new DbcMathError("MathOverflow", "quote delta does not fit u64");
  return v;
}

/** `√P' = √P * L / (L + Δx * √P)`, rounded up. */
export function nextSqrtPriceFromBaseAmountInRoundingUp(sqrtPrice: bigint, liquidity: bigint, amount: bigint): bigint {
  if (amount === 0n) return sqrtPrice;
  const denominator = liquidity + amount * sqrtPrice;
  return assertU128(mulDiv(liquidity, sqrtPrice, denominator, true), "next sqrt price");
}

/** `√P' = √P - ceil(Δy << 128 / L)`. */
export function nextSqrtPriceFromQuoteAmountOutRoundingDown(sqrtPrice: bigint, liquidity: bigint, amount: bigint): bigint {
  const quotient = (amount << U256_SHIFT) / liquidity + ((amount << U256_SHIFT) % liquidity === 0n ? 0n : 1n);
  const next = sqrtPrice - quotient;
  if (next < 0n) throw new DbcMathError("MathOverflow", "sqrt price underflow");
  return assertU128(next, "next sqrt price");
}

/** `√P' = √P * L / (L - Δx * √P)`, rounded up. */
export function nextSqrtPriceFromBaseAmountOutRoundingUp(sqrtPrice: bigint, liquidity: bigint, amount: bigint): bigint {
  if (amount === 0n) return sqrtPrice;
  const denominator = liquidity - amount * sqrtPrice;
  if (denominator < 0n) throw new DbcMathError("MathOverflow", "denominator underflow");
  if (denominator === 0n) throw new DbcMathError("TypeCastFailed", "division by zero");
  const v = mulDiv(liquidity, sqrtPrice, denominator, true);
  if (v > U128_MAX) throw new DbcMathError("TypeCastFailed", "next sqrt price does not fit u128");
  return v;
}

interface AmountFromInput {
  amountLeft: bigint;
  outputAmount: bigint;
  nextSqrtPrice: bigint;
}

function checkedAdd64(a: bigint, b: bigint): bigint {
  return assertU64(a + b, "amount");
}

function toU64Cast(v: bigint): bigint {
  if (v > (1n << 64n) - 1n) throw new DbcMathError("TypeCastFailed", "amount does not fit u64");
  return v;
}

/** calculate_quote_to_base_from_amount_in (buy), stopping at `stopSqrtPrice`. */
export function dbcQuoteToBaseFromAmountIn(config: DbcPoolConfig, sqrtPrice: bigint, amountIn: bigint, stopSqrtPrice: bigint): AmountFromInput {
  let total = 0n;
  let current = sqrtPrice;
  let left = amountIn;
  for (const point of config.curve) {
    if (point.sqrtPrice === 0n || point.liquidity === 0n) break;
    const reference = stopSqrtPrice < point.sqrtPrice ? stopSqrtPrice : point.sqrtPrice;
    if (reference > current) {
      const maxAmountIn = getDeltaAmountQuote(current, reference, point.liquidity, true);
      if (left < maxAmountIn) {
        const next = getNextSqrtPriceFromQuoteAmountIn(current, point.liquidity, left);
        total = checkedAdd64(total, deltaBaseU64(current, next, point.liquidity, false));
        current = next;
        left = 0n;
        break;
      }
      total = checkedAdd64(total, deltaBaseU64(current, reference, point.liquidity, false));
      current = reference;
      left -= toU64Cast(maxAmountIn);
      if (reference === stopSqrtPrice) break;
    }
  }
  return { amountLeft: left, outputAmount: total, nextSqrtPrice: current };
}

/** calculate_base_to_quote_from_amount_in (sell). */
export function dbcBaseToQuoteFromAmountIn(config: DbcPoolConfig, sqrtPrice: bigint, amountIn: bigint): AmountFromInput {
  const curve = config.curve;
  let total = 0n;
  let current = sqrtPrice;
  let left = amountIn;
  for (let i = curve.length - 2; i >= 0; i--) {
    const point = curve[i]!;
    if (point.sqrtPrice === 0n || point.liquidity === 0n) continue;
    if (point.sqrtPrice < current) {
      const liquidity = curve[i + 1]!.liquidity;
      const maxAmountIn = getDeltaAmountBase(point.sqrtPrice, current, liquidity, true);
      if (left < maxAmountIn) {
        const next = nextSqrtPriceFromBaseAmountInRoundingUp(current, liquidity, left);
        total = checkedAdd64(total, deltaQuoteU64(next, current, liquidity, false));
        current = next;
        left = 0n;
        break;
      }
      total = checkedAdd64(total, deltaQuoteU64(point.sqrtPrice, current, liquidity, false));
      current = point.sqrtPrice;
      left -= toU64Cast(maxAmountIn);
    }
  }
  if (left !== 0n) {
    const liquidity = curve[0]!.liquidity;
    let next = nextSqrtPriceFromBaseAmountInRoundingUp(current, liquidity, left);
    if (next < config.sqrtStartPrice) {
      next = config.sqrtStartPrice;
      const used = deltaBaseU64(next, current, liquidity, true);
      if (used > left) throw new DbcMathError("MathOverflow", "amount left underflow");
      left -= used;
    } else {
      left = 0n;
    }
    total = checkedAdd64(total, deltaQuoteU64(next, current, liquidity, false));
    current = next;
  }
  return { amountLeft: left, outputAmount: total, nextSqrtPrice: current };
}

interface AmountFromOutput {
  amountIn: bigint;
  nextSqrtPrice: bigint;
}

/** calculate_quote_to_base_from_amount_out (exact-out buy). */
export function dbcQuoteToBaseFromAmountOut(config: DbcPoolConfig, sqrtPrice: bigint, amountOut: bigint): AmountFromOutput {
  let total = 0n;
  let left = amountOut;
  let current = sqrtPrice;
  for (const point of config.curve) {
    if (point.sqrtPrice === 0n || point.liquidity === 0n) break;
    if (point.sqrtPrice > current) {
      const maxAmountOut = getDeltaAmountBase(current, point.sqrtPrice, point.liquidity, false);
      if (left < maxAmountOut) {
        const next = nextSqrtPriceFromBaseAmountOutRoundingUp(current, point.liquidity, left);
        total = checkedAdd64(total, deltaQuoteU64(current, next, point.liquidity, true));
        current = next;
        left = 0n;
        break;
      }
      total = checkedAdd64(total, deltaQuoteU64(current, point.sqrtPrice, point.liquidity, true));
      current = point.sqrtPrice;
      left -= toU64Cast(maxAmountOut);
    }
  }
  if (left !== 0n) throw new DbcMathError("AmountLeftIsNotZero");
  return { amountIn: total, nextSqrtPrice: current };
}

/** calculate_base_to_quote_from_amount_out (exact-out sell). */
export function dbcBaseToQuoteFromAmountOut(config: DbcPoolConfig, sqrtPrice: bigint, amountOut: bigint): AmountFromOutput {
  const curve = config.curve;
  let current = sqrtPrice;
  let left = amountOut;
  let total = 0n;
  for (let i = curve.length - 2; i >= 0; i--) {
    const point = curve[i]!;
    if (point.sqrtPrice === 0n || point.liquidity === 0n) continue;
    if (point.sqrtPrice < current) {
      const liquidity = curve[i + 1]!.liquidity;
      const maxAmountOut = getDeltaAmountQuote(point.sqrtPrice, current, liquidity, false);
      if (left < maxAmountOut) {
        const next = nextSqrtPriceFromQuoteAmountOutRoundingDown(current, liquidity, left);
        total = checkedAdd64(total, deltaBaseU64(next, current, liquidity, true));
        current = next;
        left = 0n;
        break;
      }
      total = checkedAdd64(total, deltaBaseU64(point.sqrtPrice, current, liquidity, true));
      current = point.sqrtPrice;
      left -= toU64Cast(maxAmountOut);
    }
  }
  if (left !== 0n) {
    const liquidity = curve[0]!.liquidity;
    const maxAmountOut = getDeltaAmountQuote(config.sqrtStartPrice, current, liquidity, false);
    if (left > maxAmountOut) throw new DbcMathError("InsufficientLiquidity");
    const next = nextSqrtPriceFromQuoteAmountOutRoundingDown(current, liquidity, left);
    if (next < config.sqrtStartPrice) throw new DbcMathError("InsufficientLiquidity");
    total = checkedAdd64(total, deltaBaseU64(next, current, liquidity, true));
    current = next;
  }
  return { amountIn: total, nextSqrtPrice: current };
}

// ------------------------------------------------------------------ swap results

/**
 * Quote a DBC swap2 exactly as the program computes it. Throws `DbcMathError` with the program's
 * error name where the swap would fail (`PoolIsCompleted`, `AmountIsZero`,
 * `InsufficientLiquidity`, ...). Slippage checks are separate (`dbcSwapSlippageLimit`).
 */
export function quoteDbcSwap(p: DbcSwapQuoteParams): DbcSwapQuote {
  const { config, pool, direction, mode, amount } = p;
  const hasReferral = p.hasReferral ?? false;
  const minFee = p.eligibleForFirstSwapWithMinFee ?? false;
  if (amount <= 0n) throw new DbcMathError("AmountIsZero");
  assertU64(amount, "amount");
  if (pool.quoteReserve >= config.migrationQuoteThreshold) throw new DbcMathError("PoolIsCompleted");

  const { feesOnInput, feesOnBaseToken } = dbcFeeMode(config.collectFeeMode, direction);
  const numerator = dbcTradeFeeNumerator(config, pool, p.currentPoint, minFee);

  let tradingFee = 0n;
  let protocolFee = 0n;
  let referralFee = 0n;
  let includedFeeInputAmount: bigint;
  let excludedFeeInputAmount: bigint;
  let outputAmount: bigint;
  let nextSqrtPrice: bigint;
  let amountLeft = 0n;

  const swapIn = (actualIn: bigint): AmountFromInput =>
    direction === DbcTradeDirection.BaseToQuote
      ? dbcBaseToQuoteFromAmountIn(config, pool.sqrtPrice, actualIn)
      : dbcQuoteToBaseFromAmountIn(config, pool.sqrtPrice, actualIn, config.migrationSqrtPrice);

  if (mode === DbcSwapMode.ExactIn || mode === DbcSwapMode.PartialFill) {
    let actualIn = amount;
    if (feesOnInput) {
      const f = dbcFeeOnAmount(numerator, amount, hasReferral);
      ({ tradingFee, protocolFee, referralFee } = f);
      actualIn = f.amount;
    }
    const res = swapIn(actualIn);
    nextSqrtPrice = res.nextSqrtPrice;
    amountLeft = res.amountLeft;
    if (mode === DbcSwapMode.ExactIn) {
      if (res.amountLeft !== 0n) throw new DbcMathError("InsufficientLiquidity");
      includedFeeInputAmount = amount;
    } else if (res.amountLeft !== 0n) {
      actualIn -= res.amountLeft;
      if (feesOnInput) {
        const inc = dbcIncludedFeeAmount(numerator, actualIn);
        ({ tradingFee, protocolFee, referralFee } = splitFees(inc.fee, hasReferral));
        includedFeeInputAmount = inc.included;
      } else {
        includedFeeInputAmount = actualIn;
      }
    } else {
      includedFeeInputAmount = amount;
    }
    excludedFeeInputAmount = actualIn;
    outputAmount = res.outputAmount;
    if (!feesOnInput) {
      const f = dbcFeeOnAmount(numerator, res.outputAmount, hasReferral);
      ({ tradingFee, protocolFee, referralFee } = f);
      outputAmount = f.amount;
    }
  } else if (mode === DbcSwapMode.ExactOut) {
    let includedFeeOut = amount;
    if (!feesOnInput) {
      const inc = dbcIncludedFeeAmount(numerator, amount);
      ({ tradingFee, protocolFee, referralFee } = splitFees(inc.fee, hasReferral));
      includedFeeOut = inc.included;
    }
    const res =
      direction === DbcTradeDirection.BaseToQuote
        ? dbcBaseToQuoteFromAmountOut(config, pool.sqrtPrice, includedFeeOut)
        : dbcQuoteToBaseFromAmountOut(config, pool.sqrtPrice, includedFeeOut);
    if (res.nextSqrtPrice > config.migrationSqrtPrice) throw new DbcMathError("InsufficientLiquidity");
    nextSqrtPrice = res.nextSqrtPrice;
    excludedFeeInputAmount = res.amountIn;
    includedFeeInputAmount = res.amountIn;
    if (feesOnInput) {
      const inc = dbcIncludedFeeAmount(numerator, res.amountIn);
      ({ tradingFee, protocolFee, referralFee } = splitFees(inc.fee, hasReferral));
      includedFeeInputAmount = inc.included;
    }
    outputAmount = amount;
  } else {
    throw new DbcMathError("TypeCastFailed", `unknown swap mode ${String(mode)}`);
  }

  const { partnerFee, creatorFee } = dbcSplitPartnerCreatorFee(config, tradingFee);
  const actualOutput = feesOnInput ? outputAmount : outputAmount + tradingFee + protocolFee + referralFee;
  let quoteReserveAfter = pool.quoteReserve;
  let baseReserveAfter = pool.baseReserve;
  if (direction === DbcTradeDirection.BaseToQuote) {
    baseReserveAfter += excludedFeeInputAmount;
    quoteReserveAfter -= actualOutput;
  } else {
    quoteReserveAfter += excludedFeeInputAmount;
    baseReserveAfter -= actualOutput;
  }
  if (quoteReserveAfter < 0n || baseReserveAfter < 0n) throw new DbcMathError("MathOverflow", "reserve underflow");

  return {
    includedFeeInputAmount,
    excludedFeeInputAmount,
    amountLeft,
    outputAmount,
    nextSqrtPrice,
    tradingFee,
    protocolFee,
    referralFee,
    partnerFee,
    creatorFee,
    feesOnBaseToken,
    feesOnInput,
    tradeFeeNumerator: numerator,
    quoteReserveAfter,
    baseReserveAfter,
    completesCurve: quoteReserveAfter >= config.migrationQuoteThreshold,
  };
}

/** `amount_1` for swap2: minimum out (ExactIn / PartialFill) or maximum in (ExactOut) with slippage in bps. */
export function dbcSwapSlippageLimit(quote: DbcSwapQuote, mode: DbcSwapMode, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new RangeError("slippageBps must be an integer in [0, 10000]");
  }
  const bps = BigInt(slippageBps);
  if (mode === DbcSwapMode.ExactOut) {
    return (quote.includedFeeInputAmount * (10_000n + bps) + 9_999n) / 10_000n;
  }
  return (quote.outputAmount * (10_000n - bps)) / 10_000n;
}
