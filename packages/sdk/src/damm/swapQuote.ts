/**
 * Exact bigint port of Meteora DAMM v2 0.2.4 `swap2` ExactIn for concentrated-liquidity pools
 * (state/pool.rs `get_swap_result_from_exact_input`, state/fee.rs `PoolFeesStruct`,
 * base_fee/fee_time_scheduler.rs, liquidity_handler/concentrated_liquidity.rs).
 *
 * Scope: fee time scheduler base fees without the dynamic fee, collect fee modes BothToken and
 * OnlyB, tokens without transfer fees. This covers pools created by DBC migration with the
 * StockFloor config (Customizable option, flat 1%, OnlyB). Anything else throws
 * `DbcMathError("UnsupportedByPort")`. Fork tests assert quotes equal the real program.
 */
import { DbcMathError, getDeltaAmountBase, getDeltaAmountQuote, getFeeInPeriod, mulDiv } from "../dbc/curveMath";
import { readU16, readU64, readU8 } from "../bytes";
import { nextSqrtPriceFromBaseAmountInRoundingUp } from "../dbc/swapQuote";
import { DammCollectFeeMode, type DammV2Pool } from "./accounts";

export const DammTradeDirection = { AtoB: 0, BtoA: 1 } as const;
export type DammTradeDirection = (typeof DammTradeDirection)[keyof typeof DammTradeDirection];

const FEE_DENOMINATOR = 1_000_000_000n;
const MAX_FEE_NUMERATOR_V0 = 500_000_000n;
const MAX_FEE_NUMERATOR_V1 = 990_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

/** DAMM v2 `BaseFeeMode`. */
export const DammBaseFeeMode = {
  FeeTimeSchedulerLinear: 0,
  FeeTimeSchedulerExponential: 1,
  RateLimiter: 2,
  FeeMarketCapSchedulerLinear: 3,
  FeeMarketCapSchedulerExponential: 4,
} as const;

export interface DammSwapQuote {
  includedFeeInputAmount: bigint;
  excludedFeeInputAmount: bigint;
  outputAmount: bigint;
  nextSqrtPrice: bigint;
  /** LP fee (goes to positions, claimable with claim_position_fee). */
  claimingFee: bigint;
  compoundingFee: bigint;
  protocolFee: bigint;
  referralFee: bigint;
  tradeFeeNumerator: bigint;
  /** Fees are charged in token A (BothToken buys of A). */
  feesOnTokenA: boolean;
  feesOnInput: boolean;
}

/** PodAlignedFeeTimeScheduler inside `base_fee_info.data` (32 bytes). */
export function decodeDammFeeTimeScheduler(data: ArrayLike<number>) {
  const bytes = Uint8Array.from(data as number[]);
  return {
    cliffFeeNumerator: readU64(bytes, 0),
    baseFeeMode: readU8(bytes, 8),
    numberOfPeriod: readU16(bytes, 14),
    periodFrequency: readU64(bytes, 16),
    reductionFactor: readU64(bytes, 24),
  };
}

export function dammTradeFeeNumerator(pool: DammV2Pool, currentPoint: bigint): bigint {
  if (pool.poolFees.dynamicFee.initialized !== 0) throw new DbcMathError("UnsupportedByPort", "DAMM v2 dynamic fee");
  const s = decodeDammFeeTimeScheduler(pool.poolFees.baseFee.baseFeeInfo.data);
  if (s.baseFeeMode !== DammBaseFeeMode.FeeTimeSchedulerLinear && s.baseFeeMode !== DammBaseFeeMode.FeeTimeSchedulerExponential) {
    throw new DbcMathError("UnsupportedByPort", `DAMM v2 base fee mode ${s.baseFeeMode}`);
  }
  const n = BigInt(s.numberOfPeriod);
  let base: bigint;
  if (s.periodFrequency === 0n) {
    base = s.cliffFeeNumerator;
  } else {
    let period = currentPoint < pool.activationPoint ? n : (currentPoint - pool.activationPoint) / s.periodFrequency;
    if (period > n) period = n;
    if (s.baseFeeMode === DammBaseFeeMode.FeeTimeSchedulerLinear) {
      base = s.cliffFeeNumerator - s.reductionFactor * period;
      if (base < 0n) throw new DbcMathError("MathOverflow", "linear fee below zero");
    } else {
      base = getFeeInPeriod(s.cliffFeeNumerator, s.reductionFactor, Number(period));
    }
  }
  const max = pool.feeVersion === 0 ? MAX_FEE_NUMERATOR_V0 : pool.feeVersion === 1 ? MAX_FEE_NUMERATOR_V1 : null;
  if (max === null) throw new DbcMathError("InvalidPoolVersion");
  return base > max ? max : base;
}

function mulDivU64(x: bigint, y: bigint, d: bigint, up: boolean): bigint {
  const v = mulDiv(x, y, d, up);
  if (v > U64_MAX) throw new DbcMathError("TypeCastFailed");
  return v;
}

/** PoolFeesStruct::get_fee_on_amount. */
export function dammFeeOnAmount(pool: DammV2Pool, amount: bigint, numerator: bigint, hasReferral: boolean) {
  const tradingFeeTotal = mulDivU64(amount, numerator, FEE_DENOMINATOR, true);
  const excluded = amount - tradingFeeTotal;
  if (excluded < 0n) throw new DbcMathError("MathOverflow");
  let protocolFee = mulDivU64(tradingFeeTotal, BigInt(pool.poolFees.protocolFeePercent), 100n, false);
  const tradingFee = tradingFeeTotal - protocolFee;
  let compoundingFee = 0n;
  let claimingFee = tradingFee;
  if (pool.poolFees.compoundingFeeBps > 0) {
    compoundingFee = mulDivU64(tradingFee, BigInt(pool.poolFees.compoundingFeeBps), 10_000n, false);
    claimingFee = tradingFee - compoundingFee;
  }
  const referralFee = hasReferral ? mulDivU64(protocolFee, BigInt(pool.poolFees.referralFeePercent), 100n, false) : 0n;
  protocolFee -= referralFee;
  return { amount: excluded, claimingFee, compoundingFee, protocolFee, referralFee };
}

export function dammFeeMode(collectFeeMode: number, direction: DammTradeDirection): { feesOnInput: boolean; feesOnTokenA: boolean } {
  switch (collectFeeMode) {
    case DammCollectFeeMode.BothToken:
      return { feesOnInput: false, feesOnTokenA: direction === DammTradeDirection.BtoA };
    case DammCollectFeeMode.OnlyB:
      return { feesOnInput: direction === DammTradeDirection.BtoA, feesOnTokenA: false };
    case DammCollectFeeMode.Compounding:
      throw new DbcMathError("UnsupportedByPort", "compounding DAMM v2 pools");
    default:
      throw new DbcMathError("InvalidCollectFeeMode");
  }
}

function u64(v: bigint): bigint {
  if (v > U64_MAX) throw new DbcMathError("MathOverflow", "amount does not fit u64");
  return v;
}

/**
 * Quote DAMM v2 swap2 ExactIn. `AtoB` sells token A (the launch base token) for token B (quote);
 * `BtoA` buys token A with token B. Throws `PoolDisabled`, `AmountIsZero`, `PriceRangeViolation`.
 */
export function quoteDammV2ExactIn(p: {
  pool: DammV2Pool;
  direction: DammTradeDirection;
  amountIn: bigint;
  currentPoint: bigint;
  hasReferral?: boolean;
}): DammSwapQuote {
  const { pool, direction, amountIn } = p;
  if (pool.poolStatus !== 0 || p.currentPoint < pool.activationPoint) throw new DbcMathError("PoolDisabled");
  if (amountIn <= 0n) throw new DbcMathError("AmountIsZero");
  u64(amountIn);
  const hasReferral = p.hasReferral ?? false;
  const { feesOnInput, feesOnTokenA } = dammFeeMode(pool.collectFeeMode, direction);
  const numerator = dammTradeFeeNumerator(pool, p.currentPoint);

  let claimingFee = 0n;
  let compoundingFee = 0n;
  let protocolFee = 0n;
  let referralFee = 0n;
  let actualIn = amountIn;
  if (feesOnInput) {
    const f = dammFeeOnAmount(pool, amountIn, numerator, hasReferral);
    ({ claimingFee, compoundingFee, protocolFee, referralFee } = f);
    actualIn = f.amount;
  }

  let nextSqrtPrice: bigint;
  let output: bigint;
  if (direction === DammTradeDirection.AtoB) {
    nextSqrtPrice = nextSqrtPriceFromBaseAmountInRoundingUp(pool.sqrtPrice, pool.liquidity, actualIn);
    if (nextSqrtPrice < pool.sqrtMinPrice) throw new DbcMathError("PriceRangeViolation");
    output = u64(getDeltaAmountQuote(nextSqrtPrice, pool.sqrtPrice, pool.liquidity, false));
  } else {
    nextSqrtPrice = actualIn === 0n ? pool.sqrtPrice : pool.sqrtPrice + (actualIn << 128n) / pool.liquidity;
    if (nextSqrtPrice > U128_MAX) throw new DbcMathError("TypeCastFailed");
    if (nextSqrtPrice > pool.sqrtMaxPrice) throw new DbcMathError("PriceRangeViolation");
    output = u64(getDeltaAmountBase(pool.sqrtPrice, nextSqrtPrice, pool.liquidity, false));
  }

  let outputAmount = output;
  if (!feesOnInput) {
    const f = dammFeeOnAmount(pool, output, numerator, hasReferral);
    ({ claimingFee, compoundingFee, protocolFee, referralFee } = f);
    outputAmount = f.amount;
  }
  return {
    includedFeeInputAmount: amountIn,
    excludedFeeInputAmount: actualIn,
    outputAmount,
    nextSqrtPrice,
    claimingFee,
    compoundingFee,
    protocolFee,
    referralFee,
    tradeFeeNumerator: numerator,
    feesOnTokenA,
    feesOnInput,
  };
}

/** Minimum out for an ExactIn quote with slippage in bps. */
export function dammMinimumOut(quote: DammSwapQuote, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new RangeError("slippageBps must be an integer in [0, 10000]");
  }
  return (quote.outputAmount * BigInt(10_000 - slippageBps)) / 10_000n;
}
