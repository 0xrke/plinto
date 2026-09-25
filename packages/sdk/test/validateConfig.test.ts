/**
 * Negative tests for the port of the DBC create_config validation: every rule found in
 * process_create_config.rs / fee_scheduler.rs / fee_parameters.rs must reject a mutated config
 * with the program's error name.
 */
import BN from "bn.js";
import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  assertCurveCanComplete,
  buildDbcConfigParams,
  DbcConfigValidationError,
  DEFAULT_QUOTE_ASSET,
  getSwapAmountWithBuffer,
  validateDbcConfigParams,
} from "../src";

const receiver = Keypair.generate().publicKey;

function validParams(): ConfigParameters {
  const {
    feeClaimer: _f,
    leftoverReceiver: _l,
    quoteMint: _q,
    ...params
  } = buildDbcConfigParams(
    {
      name: "T",
      symbol: "T",
      uri: "",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: 757.02,
      quoteMultiplier: 1.0057,
      preset: "gentle",
      vaultSharePct: 50,
    },
    receiver,
    receiver,
  );
  return params;
}

function expectCode(
  mutate: (p: ConfigParameters) => void,
  code: string,
  options = { leftoverReceiver: receiver },
) {
  const p = validParams();
  mutate(p);
  let error: unknown;
  try {
    validateDbcConfigParams(p, options);
  } catch (e) {
    error = e;
  }
  expect(error, `expected ${code}`).toBeInstanceOf(DbcConfigValidationError);
  expect((error as DbcConfigValidationError).code).toBe(code);
}

describe("validateDbcConfigParams", () => {
  it("accepts the StockFloor config", () => {
    expect(() =>
      validateDbcConfigParams(validParams(), { leftoverReceiver: receiver }),
    ).not.toThrow();
  });

  describe("fees", () => {
    it("rejects a base fee below 0.25% or above 99%", () => {
      expectCode(
        (p) => (p.poolFees.baseFee.cliffFeeNumerator = new BN(2_499_999)),
        "ExceedMaxFeeBps",
      );
      expectCode(
        (p) => (p.poolFees.baseFee.cliffFeeNumerator = new BN(990_000_001)),
        "ExceedMaxFeeBps",
      );
      expectCode(
        (p) => (p.poolFees.baseFee.cliffFeeNumerator = new BN(1_000_000_000)),
        "InvalidFee",
      );
    });

    it("accepts the 0.25% minimum and the 99% maximum", () => {
      for (const n of [2_500_000, 990_000_000]) {
        const p = validParams();
        p.poolFees.baseFee.cliffFeeNumerator = new BN(n);
        expect(() => validateDbcConfigParams(p)).not.toThrow();
      }
    });

    it("rejects the deprecated rate limiter and unknown base fee modes", () => {
      expectCode(
        (p) => (p.poolFees.baseFee.baseFeeMode = 2),
        "DeprecatedBaseFeeMode",
      );
      expectCode(
        (p) => (p.poolFees.baseFee.baseFeeMode = 3),
        "InvalidBaseFeeMode",
      );
    });

    it("requires all fee scheduler factors when any is set", () => {
      expectCode(
        (p) => (p.poolFees.baseFee.firstFactor = 10),
        "InvalidFeeScheduler",
      );
      expectCode(
        (p) => (p.poolFees.baseFee.secondFactor = new BN(60)),
        "InvalidFeeScheduler",
      );
    });

    it("checks the minimum fee after the linear scheduler ends", () => {
      // 20% → 1% over 19 periods of 1% each is fine; 20% → 0% is not.
      const ok = validParams();
      Object.assign(ok.poolFees.baseFee, {
        cliffFeeNumerator: new BN(200_000_000),
        firstFactor: 19,
        secondFactor: new BN(60),
        thirdFactor: new BN(10_000_000),
      });
      expect(() => validateDbcConfigParams(ok)).not.toThrow();
      expectCode(
        (p) =>
          Object.assign(p.poolFees.baseFee, {
            cliffFeeNumerator: new BN(200_000_000),
            firstFactor: 20,
            secondFactor: new BN(60),
            thirdFactor: new BN(10_000_000),
          }),
        "ExceedMaxFeeBps",
      );
    });

    it("checks the exponential anti-snipe preset (20% → about 1% over 30 minutes)", () => {
      const ok = validParams();
      // reduction 950 bps per minute for 30 periods: 20% * 0.905^30 ≈ 0.99%
      Object.assign(ok.poolFees.baseFee, {
        cliffFeeNumerator: new BN(200_000_000),
        firstFactor: 30,
        secondFactor: new BN(60),
        thirdFactor: new BN(950),
        baseFeeMode: 1,
      });
      expect(() => validateDbcConfigParams(ok)).not.toThrow();
      expectCode(
        (p) =>
          Object.assign(p.poolFees.baseFee, {
            cliffFeeNumerator: new BN(200_000_000),
            firstFactor: 60,
            secondFactor: new BN(60),
            thirdFactor: new BN(950),
            baseFeeMode: 1,
          }),
        "ExceedMaxFeeBps",
      );
    });

    it("validates dynamic fee parameters", () => {
      const dyn = {
        binStep: 1,
        binStepU128: new BN("1844674407370955"),
        filterPeriod: 10,
        decayPeriod: 120,
        reductionFactor: 5000,
        maxVolatilityAccumulator: 100,
        variableFeeControl: 100,
      };
      const ok = validParams();
      ok.poolFees.dynamicFee = { ...dyn };
      expect(() => validateDbcConfigParams(ok)).not.toThrow();
      expectCode(
        (p) => (p.poolFees.dynamicFee = { ...dyn, binStep: 2 }),
        "InvalidInput",
      );
      expectCode(
        (p) => (p.poolFees.dynamicFee = { ...dyn, filterPeriod: 120 }),
        "InvalidInput",
      );
      expectCode(
        (p) => (p.poolFees.dynamicFee = { ...dyn, reductionFactor: 10_001 }),
        "InvalidInput",
      );
      expectCode(
        (p) =>
          (p.poolFees.dynamicFee = { ...dyn, variableFeeControl: 0x1000000 }),
        "InvalidInput",
      );
    });

    it("rejects creator trading fee above 100%", () => {
      expectCode(
        (p) => (p.creatorTradingFeePercentage = 101),
        "InvalidCreatorTradingFeePercentage",
      );
    });
  });

  describe("migration", () => {
    it("caps the migration fee at 99% and the creator share at 100%", () => {
      expectCode(
        (p) => (p.migrationFee.feePercentage = 100),
        "InvalidMigratorFeePercentage",
      );
      expectCode(
        (p) => (p.migrationFee.creatorFeePercentage = 101),
        "InvalidMigratorFeePercentage",
      );
      expectCode(
        (p) => (p.migrationFee = { feePercentage: 0, creatorFeePercentage: 1 }),
        "InvalidMigratorFeePercentage",
      );
      const ok = validParams();
      ok.migrationFee.feePercentage = 99;
      expect(() => validateDbcConfigParams(ok)).not.toThrow();
    });

    it("rejects DAMM v1 and unknown migration options", () => {
      expectCode((p) => (p.migrationOption = 0), "DeprecatedMigrationOption");
      expectCode((p) => (p.migrationOption = 2), "InvalidMigrationOption");
      expectCode(
        (p) => (p.migrationFeeOption = 7),
        "InvalidMigrationFeeOption",
      );
    });

    it("bounds the customizable migrated pool fee to 0.1%..10%", () => {
      expectCode(
        (p) => (p.migratedPoolFee.poolFeeBps = 9),
        "InvalidMigratedPoolFee",
      );
      expectCode(
        (p) => (p.migratedPoolFee.poolFeeBps = 1001),
        "InvalidMigratedPoolFee",
      );
      expectCode(
        (p) => (p.migratedPoolFee.collectFeeMode = 3),
        "InvalidCollectFeeMode",
      );
      expectCode(
        (p) => (p.migratedPoolFee.dynamicFee = 2),
        "InvalidMigratedPoolFee",
      );
      expectCode((p) => (p.compoundingFeeBps = 1), "InvalidMigratedPoolFee");
      expectCode(
        (p) => (p.migratedPoolBaseFeeMode = 2),
        "InvalidMigratedPoolFee",
      );
      expectCode(
        (p) => (p.migratedPoolMarketCapFeeSchedulerParams.numberOfPeriod = 1),
        "InvalidMigratedPoolFee",
      );
    });

    it("requires an empty migrated pool fee for fixed fee options", () => {
      expectCode((p) => (p.migrationFeeOption = 2), "InvalidMigratedPoolFee");
      const ok = validParams();
      ok.migrationFeeOption = 2;
      ok.migratedPoolFee = { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 0 };
      expect(() => validateDbcConfigParams(ok)).not.toThrow();
    });

    it("rejects a zero threshold and a threshold the curve cannot absorb", () => {
      expectCode(
        (p) => (p.migrationQuoteThreshold = new BN(0)),
        "InvalidQuoteThreshold",
      );
      expectCode(
        (p) => (p.migrationQuoteThreshold = p.migrationQuoteThreshold.muln(2)),
        "NotEnoughLiquidity",
      );
    });
  });

  describe("token and liquidity", () => {
    it("allows 6..9 decimals only", () => {
      expectCode((p) => (p.tokenDecimal = 5), "InvalidTokenDecimals");
      expectCode((p) => (p.tokenDecimal = 10), "InvalidTokenDecimals");
    });

    it("rejects mint-authority token options outside transfer-hook configs", () => {
      expectCode(
        (p) => (p.tokenUpdateAuthority = 3),
        "InvalidTokenAuthorityOption",
      );
      expectCode(
        (p) => (p.tokenUpdateAuthority = 5),
        "InvalidTokenAuthorityOption",
      );
      const hook = validParams();
      hook.tokenUpdateAuthority = 3;
      expect(() =>
        validateDbcConfigParams(hook, { isTransferHook: true }),
      ).not.toThrow();
    });

    it("requires liquidity percentages to sum to 100 and at least 10% locked at day 1", () => {
      expectCode(
        (p) => (p.partnerPermanentLockedLiquidityPercentage = 99),
        "InvalidFeePercentage",
      );
      expectCode(
        (p) =>
          Object.assign(p, {
            partnerPermanentLockedLiquidityPercentage: 9,
            partnerLiquidityPercentage: 91,
          }),
        "InvalidMigrationLockedLiquidity",
      );
      const ok = validParams();
      Object.assign(ok, {
        partnerPermanentLockedLiquidityPercentage: 10,
        creatorLiquidityPercentage: 90,
      });
      expect(() => validateDbcConfigParams(ok)).not.toThrow();
    });

    it("validates locked vesting and the pool creation fee", () => {
      expectCode(
        (p) => (p.lockedVesting.amountPerPeriod = new BN(1)),
        "InvalidVestingParameters",
      );
      expectCode(
        (p) => (p.poolCreationFee = new BN(999_999)),
        "InvalidPoolCreationFee",
      );
      expectCode(
        (p) => (p.poolCreationFee = new BN("100000000001")),
        "InvalidPoolCreationFee",
      );
    });

    it("checks fixed token supply bounds and the leftover receiver", () => {
      const base = validParams();
      const r = validateDbcConfigParams(base, { leftoverReceiver: receiver });
      const curve = base.curve.map((c) => ({
        sqrtPrice: BigInt(c.sqrtPrice.toString()),
        liquidity: BigInt(c.liquidity.toString()),
      }));
      const buffer = getSwapAmountWithBuffer(
        r.swapBaseAmount,
        BigInt(base.sqrtStartPrice.toString()),
        curve,
      );
      const pre = new BN((buffer + r.migrationBaseThreshold).toString());
      const post = new BN(
        (r.swapBaseAmount + r.migrationBaseThreshold).toString(),
      );
      const ok = validParams();
      ok.tokenSupply = {
        preMigrationTokenSupply: pre,
        postMigrationTokenSupply: post,
      };
      const fixed = validateDbcConfigParams(ok, { leftoverReceiver: receiver });
      expect(fixed.fixedTokenSupply).toBe(true);
      expect(fixed.initialBaseSupply.toString()).toBe(pre.toString());
      expectCode(
        (p) =>
          (p.tokenSupply = {
            preMigrationTokenSupply: pre,
            postMigrationTokenSupply: post,
          }),
        "InvalidLeftoverAddress",
        {
          leftoverReceiver: PublicKey.default,
        },
      );
      expectCode(
        (p) =>
          (p.tokenSupply = {
            preMigrationTokenSupply: pre,
            postMigrationTokenSupply: post.subn(1),
          }),
        "InvalidTokenSupply",
      );
      expectCode(
        (p) =>
          (p.tokenSupply = {
            preMigrationTokenSupply: pre.subn(1),
            postMigrationTokenSupply: post,
          }),
        "InvalidTokenSupply",
      );
      // post > pre (the buffer can be capped to the curve's capacity, so pre may equal post:
      // swap a strictly larger pre).
      expectCode(
        (p) =>
          (p.tokenSupply = {
            preMigrationTokenSupply: post,
            postMigrationTokenSupply: pre.addn(1),
          }),
        "InvalidTokenSupply",
      );
    });
  });

  describe("curve", () => {
    it("requires strictly increasing sqrt prices and positive liquidity", () => {
      expectCode((p) => (p.curve[0]!.liquidity = new BN(0)), "InvalidCurve");
      expectCode(
        (p) => (p.curve[0]!.sqrtPrice = p.sqrtStartPrice),
        "InvalidCurve",
      );
      expectCode(
        (p) =>
          p.curve.push({
            sqrtPrice: p.curve[0]!.sqrtPrice,
            liquidity: new BN(1),
          }),
        "InvalidCurve",
      );
      expectCode(
        (p) =>
          p.curve.push({
            sqrtPrice: p.curve[0]!.sqrtPrice.addn(1),
            liquidity: new BN(0),
          }),
        "InvalidCurve",
      );
    });

    it("bounds the start price and the number of points", () => {
      expectCode(
        (p) => (p.sqrtStartPrice = new BN("4295048015")),
        "InvalidCurve",
      );
      expectCode((p) => (p.curve = []), "InvalidCurve");
      expectCode((p) => {
        let price = p.curve[0]!.sqrtPrice;
        while (p.curve.length < 17) {
          price = price.muln(2);
          p.curve.push({ sqrtPrice: price, liquidity: new BN(1) });
        }
      }, "InvalidCurve");
    });

    it("rejects values that do not fit their integer type", () => {
      expectCode(
        (p) => (p.curve[0]!.liquidity = new BN(1).shln(128)),
        "TypeCastFailed",
      );
      expectCode(
        (p) => (p.migrationQuoteThreshold = new BN(1).shln(64)),
        "TypeCastFailed",
      );
      expectCode((p) => (p.tokenDecimal = 256), "TypeCastFailed");
    });

    it("reports what the port does not cover instead of guessing", () => {
      expectCode(
        (p) => (p.partnerLiquidityVestingInfo.vestingPercentage = 10),
        "UnsupportedByPort",
      );
      expectCode((p) => (p.migratedPoolBaseFeeMode = 3), "UnsupportedByPort");
    });
  });

  it("assertCurveCanComplete flags a curve whose migration price is reached below the threshold", () => {
    const p = validParams();
    const r = validateDbcConfigParams(p);
    expect(
      assertCurveCanComplete(p, r.migrationSqrtPrice) >=
        BigInt(p.migrationQuoteThreshold.toString()),
    ).toBe(true);
    // Only possible with liquidity >= 2^128 (not storable on-chain): a 1-unit price step then
    // carries more than one quote unit, so rounding the price down loses a whole unit.
    const bad = validParams();
    const s0 = new BN(1).shln(64);
    bad.sqrtStartPrice = s0;
    bad.curve = [{ sqrtPrice: s0.addn(3), liquidity: new BN(5).shln(128) }];
    bad.migrationQuoteThreshold = new BN(7);
    // sm = s0 + floor(7 * 2^128 / (5 * 2^128)) = s0 + 1 → reaching it takes 5 < 7
    expect(() =>
      assertCurveCanComplete(bad, BigInt(s0.addn(1).toString())),
    ).toThrow(/CurveCannotComplete/);
  });
});
