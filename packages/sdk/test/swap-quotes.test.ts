/**
 * The bigint ports of the DBC swap2 and DAMM v2 ExactIn math against the Meteora SDKs' own
 * implementations (@meteora-ag/dynamic-bonding-curve-sdk 1.5.12, @meteora-ag/cp-amm-sdk 1.4.8) on
 * random states: fee schedulers, both collect fee modes, multi-segment curves, all swap modes and
 * directions. The fork tests (tests/sdk) additionally prove equality with the deployed programs.
 */
import BN from "bn.js";
import { getFeeMode as dammGetFeeMode, getSwapResultFromExactInput as dammSdkExactIn } from "@meteora-ag/cp-amm-sdk";
import { swapQuoteExactIn, swapQuoteExactOut, swapQuotePartialFill } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildDbcConfigParams,
  computeLaunchCurve,
  DbcMathError,
  DbcSwapMode,
  DbcTradeDirection,
  dbcSwapSlippageLimit,
  DEFAULT_QUOTE_ASSET,
  dammMinimumOut,
  DammTradeDirection,
  freshDbcState,
  quoteDammV2ExactIn,
  quoteDbcSwap,
  type DammV2Pool,
  type DbcPoolConfig,
  type DbcVirtualPool,
} from "../src";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "../src/dbc/constants";

const toBN = (v: bigint | number) => new BN(v.toString());
const big = (v: BN) => BigInt(v.toString());
const claimer = Keypair.generate().publicKey;

function sdkConfig(c: DbcPoolConfig) {
  return {
    collectFeeMode: c.collectFeeMode,
    creatorTradingFeePercentage: c.creatorTradingFeePercentage,
    migrationQuoteThreshold: toBN(c.migrationQuoteThreshold),
    migrationSqrtPrice: toBN(c.migrationSqrtPrice),
    sqrtStartPrice: toBN(c.sqrtStartPrice),
    curve: c.curve.map((p) => ({ sqrtPrice: toBN(p.sqrtPrice), liquidity: toBN(p.liquidity) })),
    poolFees: {
      baseFee: {
        cliffFeeNumerator: toBN(c.poolFees.baseFee.cliffFeeNumerator),
        firstFactor: c.poolFees.baseFee.firstFactor,
        secondFactor: toBN(c.poolFees.baseFee.secondFactor),
        thirdFactor: toBN(c.poolFees.baseFee.thirdFactor),
        baseFeeMode: c.poolFees.baseFee.baseFeeMode,
      },
      dynamicFee: { initialized: 0, maxVolatilityAccumulator: 0, variableFeeControl: 0, binStep: 0, filterPeriod: 0, decayPeriod: 0, reductionFactor: 0, binStepU128: toBN(0) },
    },
  } as never;
}

function sdkPool(p: DbcVirtualPool) {
  return {
    poolState: {
      sqrtPrice: toBN(p.sqrtPrice),
      quoteReserve: toBN(p.quoteReserve),
      activationPoint: toBN(p.activationPoint),
      volatilityTracker: { lastUpdateTimestamp: toBN(0), sqrtPriceReference: toBN(0), volatilityAccumulator: toBN(0), volatilityReference: toBN(0) },
    },
  } as never;
}

type Outcome = { ok: true; v: Record<string, bigint> } | { ok: false };
const run = (f: () => Record<string, bigint>): Outcome => {
  try {
    return { ok: true, v: f() };
  } catch {
    return { ok: false };
  }
};

/** A StockFloor preset config, optionally with a fee schedule and OutputToken collection. */
function stateArb() {
  return fc
    .record({
      preset: fc.constantFrom("gentle" as const, "flat" as const),
      share: fc.integer({ min: 30, max: 60 }),
      thresholdUsd: fc.integer({ min: 10, max: 100_000 }),
      creatorPct: fc.integer({ min: 0, max: 30 }),
      collectFeeMode: fc.constantFrom(0, 1),
      feeMode: fc.constantFrom("constant", "linear", "exponential"),
      periods: fc.integer({ min: 1, max: 50 }),
      frequency: fc.integer({ min: 1, max: 600 }),
      elapsed: fc.integer({ min: 0, max: 40_000 }),
      priceFraction: fc.integer({ min: 0, max: 1_000_000 }),
    })
    .map((r) => {
      const input = { name: "Q", symbol: "Q", uri: "", quote: DEFAULT_QUOTE_ASSET, quotePriceUsd: 757.02, quoteMultiplier: 1.0057, preset: r.preset, vaultSharePct: r.share, thresholdUsd: r.thresholdUsd };
      const params = buildDbcConfigParams(input, claimer, claimer);
      const curve = computeLaunchCurve(input);
      const { config, pool } = freshDbcState(params, curve, 1_789_000_000n);
      config.creatorTradingFeePercentage = r.creatorPct;
      config.collectFeeMode = r.collectFeeMode;
      if (r.feeMode !== "constant") {
        config.poolFees.baseFee = {
          cliffFeeNumerator: 100_000_000n,
          firstFactor: r.periods,
          secondFactor: BigInt(r.frequency),
          thirdFactor: r.feeMode === "linear" ? 1_000_000n : 500n,
          baseFeeMode: r.feeMode === "linear" ? 0 : 1,
        };
      }
      // Move the pool price somewhere on the curve.
      const span = config.migrationSqrtPrice - config.sqrtStartPrice;
      pool.sqrtPrice = config.sqrtStartPrice + (span * BigInt(r.priceFraction)) / 1_000_000n;
      pool.quoteReserve = (config.migrationQuoteThreshold * BigInt(r.priceFraction)) / 1_000_001n;
      return { config, pool, currentPoint: pool.activationPoint + BigInt(r.elapsed) };
    });
}

describe("DBC swap quote port vs the DBC SDK", () => {
  it("agrees on random StockFloor-shaped states for every mode and direction", () => {
    let compared = 0;
    fc.assert(
      fc.property(stateArb(), fc.bigInt({ min: 1n, max: 2_000_000n }), fc.boolean(), fc.boolean(), (s, ppm, sell, referral) => {
        const direction = sell ? DbcTradeDirection.BaseToQuote : DbcTradeDirection.QuoteToBase;
        // Up to 2x the threshold (buys) or 2x the curve's base (sells), at least 1 raw.
        const scaled = ((sell ? s.config.swapBaseAmount : s.config.migrationQuoteThreshold) * ppm) / 1_000_000n + 1n;
        for (const mode of [DbcSwapMode.ExactIn, DbcSwapMode.PartialFill, DbcSwapMode.ExactOut]) {
          const mine = run(() => {
            const q = quoteDbcSwap({ config: s.config, pool: s.pool, direction, mode, amount: scaled, currentPoint: s.currentPoint, hasReferral: referral });
            return {
              includedFeeInputAmount: q.includedFeeInputAmount,
              excludedFeeInputAmount: q.excludedFeeInputAmount,
              outputAmount: q.outputAmount,
              nextSqrtPrice: q.nextSqrtPrice,
              tradingFee: q.tradingFee,
              protocolFee: q.protocolFee,
              referralFee: q.referralFee,
              amountLeft: q.amountLeft,
            };
          });
          const fn = mode === DbcSwapMode.ExactIn ? swapQuoteExactIn : mode === DbcSwapMode.PartialFill ? swapQuotePartialFill : swapQuoteExactOut;
          const theirs = run(() => {
            const r = fn(sdkPool(s.pool), sdkConfig(s.config), sell, toBN(scaled), 0, referral, toBN(s.currentPoint), false);
            return {
              includedFeeInputAmount: big(r.includedFeeInputAmount),
              excludedFeeInputAmount: big(r.excludedFeeInputAmount),
              outputAmount: big(r.outputAmount),
              nextSqrtPrice: big(r.nextSqrtPrice),
              tradingFee: big(r.tradingFee),
              protocolFee: big(r.protocolFee),
              referralFee: big(r.referralFee),
              amountLeft: big(r.amountLeft),
            };
          });
          if (mine.ok && theirs.ok) {
            expect(mine.v).toEqual(theirs.v);
            compared++;
          } else if (mine.ok !== theirs.ok) {
            // The program rejects what the port rejects; the SDK may skip some u64 range checks.
            expect(mine.ok, `port succeeded where the SDK failed (mode ${mode}, sell ${sell})`).toBe(false);
          }
        }
      }),
      { numRuns: 400, seed: 20260915 },
    );
    expect(compared).toBeGreaterThan(500);
  });

  it("reports the program errors for completed pools, zero amounts and crossing ExactIn buys", () => {
    const input = { name: "Q", symbol: "Q", uri: "", quote: DEFAULT_QUOTE_ASSET, quotePriceUsd: 757.02, quoteMultiplier: 1.0057, preset: "gentle" as const, vaultSharePct: 50 };
    const { config, pool } = freshDbcState(buildDbcConfigParams(input, claimer, claimer), computeLaunchCurve(input), 0n);
    const base = { config, pool, direction: DbcTradeDirection.QuoteToBase, currentPoint: 0n };
    const code = (f: () => unknown) => {
      try {
        f();
        return "ok";
      } catch (e) {
        return (e as DbcMathError).code;
      }
    };
    expect(code(() => quoteDbcSwap({ ...base, mode: DbcSwapMode.ExactIn, amount: 0n }))).toBe("AmountIsZero");
    expect(code(() => quoteDbcSwap({ ...base, mode: DbcSwapMode.ExactIn, amount: config.migrationQuoteThreshold * 2n }))).toBe("InsufficientLiquidity");
    const partial = quoteDbcSwap({ ...base, mode: DbcSwapMode.PartialFill, amount: config.migrationQuoteThreshold * 2n });
    expect(partial.amountLeft).toBeGreaterThan(0n);
    expect(partial.nextSqrtPrice).toBe(config.migrationSqrtPrice);
    expect(partial.completesCurve).toBe(true);
    expect(partial.quoteReserveAfter).toBeGreaterThanOrEqual(config.migrationQuoteThreshold);
    const done = { ...pool, quoteReserve: config.migrationQuoteThreshold };
    expect(code(() => quoteDbcSwap({ ...base, pool: done, mode: DbcSwapMode.ExactIn, amount: 1n }))).toBe("PoolIsCompleted");
    const dyn = { ...config, poolFees: { ...config.poolFees, dynamicFee: { ...config.poolFees.dynamicFee, initialized: 1 } } };
    expect(code(() => quoteDbcSwap({ ...base, config: dyn, mode: DbcSwapMode.ExactIn, amount: 1000n }))).toBe("UnsupportedByPort");
  });

  it("ExactOut of an ExactIn output never costs more than the ExactIn input; slippage limits round safely", () => {
    const input = { name: "Q", symbol: "Q", uri: "", quote: DEFAULT_QUOTE_ASSET, quotePriceUsd: 757.02, quoteMultiplier: 1.0057, preset: "flat" as const, vaultSharePct: 40 };
    const { config, pool } = freshDbcState(buildDbcConfigParams(input, claimer, claimer), computeLaunchCurve(input), 0n);
    fc.assert(
      fc.property(fc.bigInt({ min: 1000n, max: config.migrationQuoteThreshold / 2n }), (amountIn) => {
        const base = { config, pool, direction: DbcTradeDirection.QuoteToBase, currentPoint: 0n };
        const exactIn = quoteDbcSwap({ ...base, mode: DbcSwapMode.ExactIn, amount: amountIn });
        const exactOut = quoteDbcSwap({ ...base, mode: DbcSwapMode.ExactOut, amount: exactIn.outputAmount });
        expect(exactOut.includedFeeInputAmount <= amountIn).toBe(true);
        expect(dbcSwapSlippageLimit(exactIn, DbcSwapMode.ExactIn, 100)).toBe((exactIn.outputAmount * 9_900n) / 10_000n);
        expect(dbcSwapSlippageLimit(exactOut, DbcSwapMode.ExactOut, 100) >= exactOut.includedFeeInputAmount).toBe(true);
      }),
      { numRuns: 200 },
    );
    expect(() => dbcSwapSlippageLimit({} as never, DbcSwapMode.ExactIn, 10_001)).toThrow(RangeError);
  });
});

function timeSchedulerData(cliff: bigint, mode: number, periods: number, frequency: bigint, reduction: bigint): number[] {
  const b = new Uint8Array(32);
  const v = new DataView(b.buffer);
  v.setBigUint64(0, cliff, true);
  b[8] = mode;
  v.setUint16(14, periods, true);
  v.setBigUint64(16, frequency, true);
  v.setBigUint64(24, reduction, true);
  return Array.from(b);
}

describe("DAMM v2 ExactIn quote port vs the cp-amm SDK", () => {
  it("agrees on random concentrated pools, fee schedules and both collect fee modes", () => {
    let compared = 0;
    fc.assert(
      fc.property(
        fc.record({
          sqrtPrice: fc.bigInt({ min: 1n << 45n, max: 1n << 90n }),
          liquidity: fc.bigInt({ min: 1n << 70n, max: 1n << 120n }),
          collectFeeMode: fc.constantFrom(0, 1),
          protocolFeePercent: fc.integer({ min: 0, max: 50 }),
          referralFeePercent: fc.integer({ min: 0, max: 50 }),
          feeVersion: fc.constantFrom(0, 1),
          cliff: fc.bigInt({ min: 2_500_000n, max: 500_000_000n }),
          scheduled: fc.boolean(),
          elapsed: fc.bigInt({ min: 0n, max: 100_000n }),
          amountBits: fc.integer({ min: 0, max: 64 }),
          amountLow: fc.bigInt({ min: 1n, max: (1n << 64n) - 1n }),
          aToB: fc.boolean(),
          referral: fc.boolean(),
        }),
        (r) => {
          const data = r.scheduled ? timeSchedulerData(r.cliff, 0, 10, 60n, r.cliff / 20n) : timeSchedulerData(r.cliff, 0, 0, 0n, 0n);
          const pool = {
            poolFees: {
              baseFee: { baseFeeInfo: { data } },
              protocolFeePercent: r.protocolFeePercent,
              referralFeePercent: r.referralFeePercent,
              compoundingFeeBps: 0,
              dynamicFee: { initialized: 0 },
              initSqrtPrice: r.sqrtPrice,
            },
            liquidity: r.liquidity,
            sqrtMinPrice: MIN_SQRT_PRICE,
            sqrtMaxPrice: MAX_SQRT_PRICE,
            sqrtPrice: r.sqrtPrice,
            activationPoint: 1_000n,
            activationType: 1,
            poolStatus: 0,
            collectFeeMode: r.collectFeeMode,
            feeVersion: r.feeVersion,
          } as unknown as DammV2Pool;
          const direction = r.aToB ? DammTradeDirection.AtoB : DammTradeDirection.BtoA;
          const currentPoint = 1_000n + r.elapsed;
          const amount = (r.amountLow % (1n << BigInt(r.amountBits))) + 1n;
          const mine = run(() => {
            const q = quoteDammV2ExactIn({ pool, direction, amountIn: amount, currentPoint, hasReferral: r.referral });
            return { out: q.outputAmount, next: q.nextSqrtPrice, claiming: q.claimingFee, protocol: q.protocolFee, referral: q.referralFee, excluded: q.excludedFeeInputAmount };
          });
          const theirs = run(() => {
            const sdkPoolState = {
              poolFees: {
                baseFee: { baseFeeInfo: { data } },
                protocolFeePercent: r.protocolFeePercent,
                referralFeePercent: r.referralFeePercent,
                compoundingFeeBps: 0,
                dynamicFee: { initialized: 0, variableFeeControl: 0, binStep: 0, volatilityAccumulator: toBN(0) },
                initSqrtPrice: toBN(r.sqrtPrice),
              },
              liquidity: toBN(r.liquidity),
              sqrtMinPrice: toBN(MIN_SQRT_PRICE),
              sqrtMaxPrice: toBN(MAX_SQRT_PRICE),
              sqrtPrice: toBN(r.sqrtPrice),
              activationPoint: toBN(1_000n),
              collectFeeMode: r.collectFeeMode,
              feeVersion: r.feeVersion,
              tokenAAmount: toBN(0),
              tokenBAmount: toBN(0),
            };
            const feeMode = dammGetFeeMode(r.collectFeeMode as never, direction as never, r.referral);
            const res = dammSdkExactIn(sdkPoolState as never, toBN(amount), feeMode, direction as never, toBN(currentPoint));
            return { out: big(res.outputAmount), next: big(res.nextSqrtPrice), claiming: big(res.claimingFee), protocol: big(res.protocolFee), referral: big(res.referralFee), excluded: big(res.excludedFeeInputAmount) };
          });
          if (mine.ok && theirs.ok) {
            expect(mine.v).toEqual(theirs.v);
            compared++;
            expect(dammMinimumOut({ outputAmount: mine.v.out } as never, 50)).toBe((mine.v.out! * 9_950n) / 10_000n);
          } else if (mine.ok !== theirs.ok) {
            expect(mine.ok, "port succeeded where the SDK failed").toBe(false);
          }
        },
      ),
      { numRuns: 500, seed: 20260915 },
    );
    expect(compared).toBeGreaterThan(300);
  });

  it("rejects disabled pools, zero input and unsupported fee setups", () => {
    const pool = {
      poolFees: { baseFee: { baseFeeInfo: { data: timeSchedulerData(10_000_000n, 0, 0, 0n, 0n) } }, protocolFeePercent: 20, referralFeePercent: 20, compoundingFeeBps: 0, dynamicFee: { initialized: 0 }, initSqrtPrice: 1n << 64n },
      liquidity: 1n << 100n,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      sqrtPrice: 1n << 64n,
      activationPoint: 100n,
      activationType: 1,
      poolStatus: 0,
      collectFeeMode: 1,
      feeVersion: 1,
    } as unknown as DammV2Pool;
    const code = (p: DammV2Pool, amountIn: bigint, currentPoint = 200n) => {
      try {
        quoteDammV2ExactIn({ pool: p, direction: DammTradeDirection.BtoA, amountIn, currentPoint });
        return "ok";
      } catch (e) {
        return (e as DbcMathError).code;
      }
    };
    expect(code(pool, 1000n)).toBe("ok");
    expect(code(pool, 1000n, 50n)).toBe("PoolDisabled");
    expect(code({ ...pool, poolStatus: 1 }, 1000n)).toBe("PoolDisabled");
    expect(code(pool, 0n)).toBe("AmountIsZero");
    expect(code({ ...pool, collectFeeMode: 2 }, 1000n)).toBe("UnsupportedByPort");
    expect(code({ ...pool, poolFees: { ...pool.poolFees, dynamicFee: { initialized: 1 } } }, 1000n)).toBe("UnsupportedByPort");
    expect(code({ ...pool, poolFees: { ...pool.poolFees, baseFee: { baseFeeInfo: { data: timeSchedulerData(1n, 3, 0, 0n, 0n) } } } }, 1000n)).toBe("UnsupportedByPort");
  });
});

void PublicKey;
