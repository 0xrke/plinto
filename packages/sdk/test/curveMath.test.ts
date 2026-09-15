/**
 * Cross-checks the bigint port of the DBC curve math against the Meteora DBC SDK (BN), which
 * implements the same program functions independently.
 */
import BN from "bn.js";
import {
  getBaseTokenForSwap as sdkGetBaseTokenForSwap,
  getFeeNumeratorOnExponentialFeeScheduler,
  getMigrationBaseToken,
  getMigrationThresholdPrice as sdkGetMigrationThresholdPrice,
  getSwapAmountWithBuffer as sdkGetSwapAmountWithBuffer,
  MigrationOption,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  dbcConstants,
  getBaseTokenForSwap,
  getMigrationThresholdPrice,
  getSwapAmountWithBuffer,
  isqrt,
} from "../src";
import {
  DbcMathError,
  divCeil,
  getConcentratedMigrationBaseAmount,
  getDeltaAmountQuote,
  getFeeInPeriod,
  getMigrationFeeDistribution,
  getMigrationQuoteAmount,
  mulDiv,
  powQ64,
} from "../src/dbc/curveMath";

const { MIN_SQRT_PRICE, MAX_SQRT_PRICE, U64_MAX } = dbcConstants;
const toBN = (v: bigint) => new BN(v.toString());
const toBig = (v: BN) => BigInt(v.toString());

/** Random strictly increasing curves inside realistic Q64.64 ranges. */
const curveArb = fc
  .record({
    start: fc.bigInt({ min: 1n << 40n, max: 1n << 90n }),
    steps: fc.array(
      fc.record({
        // relative step in ppm, at least 1 ppm
        stepPpm: fc.bigInt({ min: 1n, max: 2_000_000n }),
        liquidity: fc.bigInt({ min: 1n << 60n, max: 1n << 110n }),
      }),
      { minLength: 1, maxLength: 16 },
    ),
  })
  .map(({ start, steps }) => {
    let price = start;
    const curve = steps.map(({ stepPpm, liquidity }) => {
      price = price + (price * stepPpm) / 1_000_000n + 1n;
      return { sqrtPrice: price, liquidity };
    });
    return { start, curve };
  });

describe("integer helpers", () => {
  it("isqrt is the floor square root", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1n << 260n }), (n) => {
        const r = isqrt(n);
        expect(r * r <= n).toBe(true);
        expect((r + 1n) * (r + 1n) > n).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("mulDiv and divCeil round as requested", () => {
    expect(mulDiv(7n, 3n, 2n, false)).toBe(10n);
    expect(mulDiv(7n, 3n, 2n, true)).toBe(11n);
    expect(mulDiv(6n, 3n, 2n, true)).toBe(9n);
    expect(divCeil(10n, 5n)).toBe(2n);
    expect(divCeil(11n, 5n)).toBe(3n);
  });
});

describe("migration fee math (config.rs)", () => {
  it("matches the brief: fee = T - ceil(T * (100 - pct) / 100), creator share floored", () => {
    expect(getMigrationQuoteAmount(1001n, 50)).toEqual({
      quoteAmount: 501n,
      fee: 500n,
    });
    expect(getMigrationQuoteAmount(100n, 99)).toEqual({
      quoteAmount: 1n,
      fee: 99n,
    });
    expect(getMigrationQuoteAmount(100n, 0)).toEqual({
      quoteAmount: 100n,
      fee: 0n,
    });
    expect(getMigrationFeeDistribution(1001n, 50, 0)).toEqual({
      partnerMigrationFee: 500n,
      creatorMigrationFee: 0n,
    });
    expect(getMigrationFeeDistribution(1001n, 50, 33)).toEqual({
      partnerMigrationFee: 335n,
      creatorMigrationFee: 165n,
    });
  });

  it("property: partner + creator = fee and fee <= pct% of the threshold", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: U64_MAX }),
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 100 }),
        (t, pct, creator) => {
          const { quoteAmount, fee } = getMigrationQuoteAmount(t, pct);
          const { partnerMigrationFee, creatorMigrationFee } =
            getMigrationFeeDistribution(t, pct, creator);
          expect(quoteAmount + fee).toBe(t);
          expect(fee * 100n <= t * BigInt(pct)).toBe(true);
          expect(partnerMigrationFee + creatorMigrationFee).toBe(fee);
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("curve math vs the DBC SDK", () => {
  it("property: getMigrationThresholdPrice and getBaseTokenForSwap agree with the SDK", () => {
    let compared = 0;
    let bothFailed = 0;
    fc.assert(
      fc.property(
        curveArb,
        fc.bigInt({ min: 1n, max: 1n << 50n }),
        ({ start, curve }, threshold) => {
          let ours: bigint | Error;
          try {
            ours = getMigrationThresholdPrice(threshold, start, curve);
          } catch (e) {
            ours = e as Error;
          }
          const bnCurve = curve.map((p) => ({
            sqrtPrice: toBN(p.sqrtPrice),
            liquidity: toBN(p.liquidity),
          }));
          let theirs: bigint | Error;
          try {
            theirs = toBig(
              sdkGetMigrationThresholdPrice(
                toBN(threshold),
                toBN(start),
                bnCurve,
              ),
            );
          } catch (e) {
            theirs = e as Error;
          }
          if (theirs instanceof Error) {
            // The SDK throws "Not enough liquidity": the port must reject too.
            expect(ours).toBeInstanceOf(DbcMathError);
            expect((ours as DbcMathError).code).toBe("NotEnoughLiquidity");
            bothFailed++;
            return;
          }
          if (ours instanceof Error) {
            // Only a u128 cast failure (checked by the program, not by the SDK) may differ.
            expect((ours as DbcMathError).code).toBe("TypeCastFailed");
            return;
          }
          expect(ours).toBe(theirs);
          expect(getBaseTokenForSwap(start, ours, curve)).toBe(
            toBig(sdkGetBaseTokenForSwap(toBN(start), toBN(ours), bnCurve)),
          );
          compared++;
        },
      ),
      { numRuns: 1000 },
    );
    // Guard against a vacuous property: both branches must be exercised.
    expect(compared).toBeGreaterThan(100);
    expect(bothFailed).toBeGreaterThan(10);
  });

  it("property: swap buffer and DAMM v2 migration base amount agree with the SDK", () => {
    fc.assert(
      fc.property(
        curveArb,
        fc.bigInt({ min: 0n, max: 1n << 60n }),
        fc.bigInt({ min: 1n, max: 1n << 50n }),
        ({ start, curve }, swap, quote) => {
          const bnCurve = curve.map((p) => ({
            sqrtPrice: toBN(p.sqrtPrice),
            liquidity: toBN(p.liquidity),
          }));
          let ours: bigint | null = null;
          try {
            ours = getSwapAmountWithBuffer(swap, start, curve);
          } catch {
            ours = null; // exceeds u64 in the program
          }
          const theirs = toBig(
            sdkGetSwapAmountWithBuffer(toBN(swap), toBN(start), bnCurve),
          );
          if (ours === null) expect(theirs > U64_MAX).toBe(true);
          else expect(ours).toBe(theirs);

          const sm = curve[0]!.sqrtPrice;
          let base: bigint | null = null;
          try {
            base = getConcentratedMigrationBaseAmount(quote, sm);
          } catch {
            base = null;
          }
          const sdkBase = toBig(
            getMigrationBaseToken(
              toBN(quote),
              toBN(sm),
              MigrationOption.MET_DAMM_V2,
            ),
          );
          if (base === null) expect(sdkBase > U64_MAX).toBe(true);
          else expect(base).toBe(sdkBase);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("getDeltaAmountQuote rounding brackets the exact value", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: MIN_SQRT_PRICE, max: MAX_SQRT_PRICE }),
        fc.bigInt({ min: 0n, max: 1n << 90n }),
        fc.bigInt({ min: 1n, max: 1n << 120n }),
        (lower, delta, liquidity) => {
          const upper = lower + delta;
          const down = getDeltaAmountQuote(lower, upper, liquidity, false);
          const up = getDeltaAmountQuote(lower, upper, liquidity, true);
          expect(up - down === 0n || up - down === 1n).toBe(true);
          expect(down << 128n <= liquidity * delta).toBe(true);
          expect(up << 128n >= liquidity * delta).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("exponential fee scheduler (fee_math.rs)", () => {
  it("property: getFeeInPeriod matches the SDK for reduction factors below 100%", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 2_500_000n, max: 990_000_000n }),
        fc.bigInt({ min: 1n, max: 9_999n }),
        fc.integer({ min: 0, max: 5000 }),
        (cliff, reduction, period) => {
          const theirs = toBig(
            getFeeNumeratorOnExponentialFeeScheduler(
              toBN(cliff),
              toBN(reduction),
              period,
            ),
          );
          let ours: bigint;
          try {
            ours = getFeeInPeriod(cliff, reduction, period);
          } catch {
            // The program's pow returns None once the Q64.64 result truncates to 0 (MathOverflow);
            // the SDK returns 0 there.
            expect(theirs).toBe(0n);
            return;
          }
          expect(ours).toBe(theirs);
          expect(ours <= cliff).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("powQ64 handles the edge cases like the program", () => {
    const one = 1n << 64n;
    expect(powQ64(one / 2n, 0)).toBe(one);
    expect(powQ64(one / 2n, 1)).toBe(one / 2n);
    expect(powQ64(one / 2n, 2)).toBe(one / 4n);
    expect(powQ64(one, 0x80000)).toBeNull();
  });
});
