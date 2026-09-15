import type { BorshInstructionCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
import { validateConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertCurveCanComplete,
  authorityPda,
  BASE_SUPPLY_TARGET_RAW,
  buildDbcConfigParams,
  computeLaunchCurve,
  computeThresholdQuoteRaw,
  CURVE_PRESETS,
  type CurvePreset,
  dbcConstants,
  DEFAULT_QUOTE_ASSET,
  type LaunchInput,
  LaunchInputError,
  maxLossFraction,
  MIN_THRESHOLD_USD,
  previewLaunch,
  QUOTE_ALLOWLIST,
  rawToUi,
  validateDbcConfigParams,
  validateTokenMetadata,
} from "../src";

const { MAX_SQRT_PRICE, MIN_SQRT_PRICE, U64_MAX, U128_MAX } = dbcConstants;

// SPYx on 2026-09-15: Jupiter usdPrice 757.019436684184, effective multiplier 1.005714560286254.
const SPYX_PRICE = 757.019436684184;
const SPYX_MULTIPLIER = 1.005714560286254;

const baseInput = (overrides: Partial<LaunchInput> = {}): LaunchInput => ({
  name: "Community Token",
  symbol: "COMM",
  uri: "https://example.com/comm.json",
  quote: DEFAULT_QUOTE_ASSET,
  quotePriceUsd: SPYX_PRICE,
  quoteMultiplier: SPYX_MULTIPLIER,
  preset: "gentle",
  vaultSharePct: 50,
  ...overrides,
});

const authority = authorityPda(Keypair.generate().publicKey)[0];

/** Price of one base token in quote raw per base raw from a sqrt price, as a float. */
const priceOf = (sqrt: bigint) => (Number(sqrt) / 2 ** 64) ** 2;

describe("threshold conversion", () => {
  it("converts USD to quote raw with the Jupiter UI price and the multiplier, rounding up", () => {
    const raw = computeThresholdQuoteRaw(baseInput());
    // 1000 / 757.019436684184 UI SPYx = 1.320970... UI; raw = UI * 1e8 / 1.005714560286254
    expect(raw).toBe(131_346_418n);
    const usd = rawToUi(raw, 8, SPYX_MULTIPLIER) * SPYX_PRICE;
    expect(usd).toBeGreaterThanOrEqual(1000);
    expect(usd).toBeLessThan(1000.00001);
    // one raw unit less is worth less than $1000
    expect(rawToUi(raw - 1n, 8, SPYX_MULTIPLIER) * SPYX_PRICE).toBeLessThan(
      1000,
    );
  });

  it("a higher multiplier means fewer raw units for the same USD", () => {
    const a = computeThresholdQuoteRaw(baseInput({ quoteMultiplier: 1 }));
    const b = computeThresholdQuoteRaw(baseInput({ quoteMultiplier: 1.1 }));
    expect(b < a).toBe(true);
    const raw2000 = computeThresholdQuoteRaw(baseInput({ thresholdUsd: 2000 }));
    expect(
      rawToUi(raw2000, 8, SPYX_MULTIPLIER) * SPYX_PRICE,
    ).toBeGreaterThanOrEqual(2000);
    expect(rawToUi(raw2000 - 1n, 8, SPYX_MULTIPLIER) * SPYX_PRICE).toBeLessThan(
      2000,
    );
  });
});

describe("buildDbcConfigParams defaults (docs/BRIEF.md §4)", () => {
  const params = buildDbcConfigParams(baseInput(), authority, authority);

  it("sets every fixed parameter", () => {
    expect(params.poolFees.baseFee.cliffFeeNumerator.toString()).toBe(
      "10000000",
    ); // 1% of 1e9
    expect(params.poolFees.baseFee.firstFactor).toBe(0);
    expect(params.poolFees.baseFee.secondFactor.isZero()).toBe(true);
    expect(params.poolFees.baseFee.thirdFactor.isZero()).toBe(true);
    expect(params.poolFees.baseFee.baseFeeMode).toBe(0); // fee scheduler, constant
    expect(params.poolFees.dynamicFee).toBeNull();
    expect(params.collectFeeMode).toBe(0); // QuoteToken
    expect(params.migrationOption).toBe(1); // DAMM v2
    expect(params.tokenType).toBe(0); // SPL Token
    expect(params.tokenDecimal).toBe(6);
    expect(params.tokenUpdateAuthority).toBe(1); // Immutable
    expect(params.tokenSupply).toBeNull(); // dynamic supply
    expect(params.creatorTradingFeePercentage).toBe(30);
    expect(params.migrationFee).toEqual({
      feePercentage: 50,
      creatorFeePercentage: 0,
    });
    expect(params.migrationFeeOption).toBe(6); // Customizable
    expect(params.migratedPoolFee).toEqual({
      collectFeeMode: 0,
      dynamicFee: 0,
      poolFeeBps: 100,
    });
    expect(params.migratedPoolBaseFeeMode).toBe(0);
    expect(params.compoundingFeeBps).toBe(0);
    expect(params.partnerPermanentLockedLiquidityPercentage).toBe(100);
    expect(params.partnerLiquidityPercentage).toBe(0);
    expect(params.creatorLiquidityPercentage).toBe(0);
    expect(params.creatorPermanentLockedLiquidityPercentage).toBe(0);
    expect(params.poolCreationFee.isZero()).toBe(true);
    expect(params.enableFirstSwapWithMinFee).toBe(false);
    expect(params.padding).toEqual([0, 0]);
    for (const v of Object.values(params.lockedVesting))
      expect((v as BN).isZero()).toBe(true);
    expect(
      Object.values(params.partnerLiquidityVestingInfo).every((v) => v === 0),
    ).toBe(true);
    expect(
      Object.values(params.creatorLiquidityVestingInfo).every((v) => v === 0),
    ).toBe(true);
    expect(params.migratedPoolMarketCapFeeSchedulerParams.numberOfPeriod).toBe(
      0,
    );
    expect(
      params.migratedPoolMarketCapFeeSchedulerParams.reductionFactor.isZero(),
    ).toBe(true);
  });

  it("attaches the create_config accounts", () => {
    expect(params.feeClaimer.equals(authority)).toBe(true);
    expect(params.leftoverReceiver.equals(authority)).toBe(true);
    expect(params.quoteMint.toBase58()).toBe(DEFAULT_QUOTE_ASSET.mint);
    expect(params.migrationQuoteThreshold.toString()).toBe("131346418");
  });

  it("is accepted by the DBC SDK's own validateConfigParameters", () => {
    expect(() => validateConfigParameters(params)).not.toThrow();
  });

  it("uses fresh BN instances (no shared mutable state)", () => {
    expect(params.poolFees.baseFee.secondFactor).not.toBe(
      params.poolFees.baseFee.thirdFactor,
    );
    const again = buildDbcConfigParams(baseInput(), authority, authority);
    expect(again.sqrtStartPrice.eq(params.sqrtStartPrice)).toBe(true);
  });

  it("encodes with the Anchor coder the DBC SDK uses, ignoring the attached account keys", async () => {
    const { createDbcProgram } =
      await import("@meteora-ag/dynamic-bonding-curve-sdk");
    const { Connection } = await import("@solana/web3.js");
    // No request is sent: the program object is only used for its instruction coder.
    const { program } = createDbcProgram(new Connection("http://127.0.0.1:1"));
    const coder = program.coder.instruction as unknown as BorshInstructionCoder;
    const {
      feeClaimer: _f,
      leftoverReceiver: _l,
      quoteMint: _q,
      ...plain
    } = params;
    const withExtras = coder.encode("createConfig", {
      configParameters: params,
    });
    const withoutExtras = coder.encode("createConfig", {
      configParameters: plain,
    });
    expect(Buffer.compare(withExtras, withoutExtras)).toBe(0);
    const decoded = coder.decode(withExtras) as {
      name: string;
      data: { configParameters: typeof plain };
    } | null;
    expect(decoded?.name).toBe("createConfig");
    const cp = decoded!.data.configParameters;
    expect(cp.sqrtStartPrice.eq(params.sqrtStartPrice)).toBe(true);
    expect(cp.migrationQuoteThreshold.eq(params.migrationQuoteThreshold)).toBe(
      true,
    );
    expect(cp.curve).toHaveLength(1);
    expect(cp.curve[0]!.liquidity.eq(params.curve[0]!.liquidity)).toBe(true);
    expect(cp.migrationFee).toEqual(params.migrationFee);
    expect(cp.tokenSupply).toBeNull();
    // Round trip is byte-identical.
    expect(
      Buffer.compare(
        coder.encode("createConfig", { configParameters: cp }),
        withExtras,
      ),
    ).toBe(0);
  });
});

describe("curve presets", () => {
  for (const preset of Object.keys(CURVE_PRESETS) as CurvePreset[]) {
    for (const vaultSharePct of [30, 50, 70]) {
      it(`${preset} @ ${vaultSharePct}% passes the create_config validation port and can complete`, () => {
        const input = baseInput({ preset, vaultSharePct });
        const params = buildDbcConfigParams(input, authority, authority);
        const result = validateDbcConfigParams(params, {
          leftoverReceiver: authority,
        });
        const curve = computeLaunchCurve(input);

        // Strictly increasing sqrt prices, liquidity > 0, <= 16 points, within bounds.
        const start = BigInt(params.sqrtStartPrice.toString());
        expect(start >= MIN_SQRT_PRICE && start < MAX_SQRT_PRICE).toBe(true);
        let prev = start;
        for (const p of params.curve) {
          const sp = BigInt(p.sqrtPrice.toString());
          const l = BigInt(p.liquidity.toString());
          expect(sp > prev).toBe(true);
          expect(l > 0n && l <= U128_MAX).toBe(true);
          prev = sp;
        }
        expect(params.curve.length).toBeLessThanOrEqual(16);

        // Last price / first price = preset ratio.
        const { num, den } = CURVE_PRESETS[preset].priceRatio;
        const ratio =
          priceOf(BigInt(params.curve.at(-1)!.sqrtPrice.toString())) /
          priceOf(start);
        expect(ratio).toBeCloseTo(Number(num) / Number(den), 9);

        // The curve completes at (or one rounding step below) the last point.
        const last = BigInt(params.curve.at(-1)!.sqrtPrice.toString());
        expect(result.migrationSqrtPrice <= last).toBe(true);
        expect(
          Number(last - result.migrationSqrtPrice) / Number(last),
        ).toBeLessThan(1e-9);
        const quoteToComplete = assertCurveCanComplete(
          params,
          result.migrationSqrtPrice,
        );
        expect(quoteToComplete - curve.thresholdQuoteRaw).toBeLessThanOrEqual(
          1n,
        );

        // The SDK agrees too.
        expect(() => validateConfigParameters(params)).not.toThrow();

        // Derived values match the preview model. (Both are SDK code; the values the real DBC
        // program stores are compared on the fork in tests/integration/sdk-presets-fork.test.ts.)
        expect(result.swapBaseAmount).toBe(curve.swapBaseAmount);
        expect(result.migrationBaseThreshold).toBe(curve.migrationBaseAmount);
        expect(result.partnerMigrationFee).toBe(curve.partnerMigrationFee);
        expect(result.creatorMigrationFee).toBe(0n);
        expect(result.fixedTokenSupply).toBe(false);
        expect(result.lockedLiquidityBpsAtDay1).toBe(10_000);
        expect(result.initialBaseSupply <= U64_MAX).toBe(true);

        // Supply at graduation is on target (1B tokens) to 1 ppm.
        const supply = curve.baseSupplyAtGraduationRaw;
        const diff =
          supply > BASE_SUPPLY_TARGET_RAW
            ? supply - BASE_SUPPLY_TARGET_RAW
            : BASE_SUPPLY_TARGET_RAW - supply;
        expect(diff * 1_000_000n <= BASE_SUPPLY_TARGET_RAW).toBe(true);
      });
    }
  }

  it("works for every allowlisted quote asset at plausible prices", () => {
    const prices: Record<string, number> = {
      SPYx: 757.02,
      QQQx: 704.79,
      GLDx: 390,
      NVDAx: 210,
      AAPLx: 329.68,
      MSFTx: 520,
      GOOGLx: 260,
      TSLAx: 357.13,
    };
    for (const quote of QUOTE_ALLOWLIST) {
      for (const preset of ["gentle", "flat"] as const) {
        const params = buildDbcConfigParams(
          baseInput({
            quote,
            quotePriceUsd: prices[quote.symbol]!,
            quoteMultiplier: 1.002,
            preset,
          }),
          authority,
          authority,
        );
        expect(params.quoteMint.toBase58()).toBe(quote.mint);
        expect(() => validateConfigParameters(params)).not.toThrow();
      }
    }
  });

  it("property: random prices, multipliers, thresholds and vault shares always give valid, completable configs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100_000, noNaN: true }),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        fc.double({ min: 1, max: 10_000_000, noNaN: true }),
        fc.integer({ min: 30, max: 70 }),
        fc.constantFrom<CurvePreset>("gentle", "flat"),
        (
          quotePriceUsd,
          quoteMultiplier,
          thresholdUsd,
          vaultSharePct,
          preset,
        ) => {
          const input = baseInput({
            quotePriceUsd,
            quoteMultiplier,
            thresholdUsd,
            vaultSharePct,
            preset,
          });
          const params = buildDbcConfigParams(input, authority, authority); // runs the port + completion check
          const result = validateDbcConfigParams(params, {
            leftoverReceiver: authority,
          });
          expect(result.migrationSqrtPrice < MAX_SQRT_PRICE).toBe(true);
          expect(() => validateConfigParameters(params)).not.toThrow();
          const preview = previewLaunch(input);
          expect(preview.startPriceUsd).toBeLessThan(
            preview.graduationPriceUsd,
          );
          expect(preview.floorAtGraduationUsd).toBeLessThan(
            preview.graduationPriceUsd,
          );
          expect(
            preview.maxLossAtGraduationPrice > 0 &&
              preview.maxLossAtGraduationPrice < 1,
          ).toBe(true);
          // The raise at the threshold is worth at least thresholdUsd.
          expect(
            rawToUi(preview.thresholdQuoteRaw, 8, quoteMultiplier) *
              quotePriceUsd,
          ).toBeGreaterThanOrEqual(thresholdUsd * (1 - 1e-12));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("previewLaunch", () => {
  it("computes the floor from the partner migration fee and the supply at graduation", () => {
    const input = baseInput();
    const preview = previewLaunch(input);
    const curve = computeLaunchCurve(input);
    const t = preview.thresholdQuoteRaw;
    // fee = T - ceil(T * 50 / 100)
    expect(preview.vaultAtGraduationQuoteRaw).toBe(t - (t * 50n + 99n) / 100n);
    expect(preview.baseSupplyAtGraduationRaw).toBe(
      curve.swapBaseAmount + curve.migrationBaseAmount,
    );

    const usdPerQuoteRaw = (SPYX_MULTIPLIER * SPYX_PRICE) / 1e8;
    const floorUsd =
      ((Number(preview.vaultAtGraduationQuoteRaw) * usdPerQuoteRaw) /
        Number(preview.baseSupplyAtGraduationRaw)) *
      1e6;
    expect(preview.floorAtGraduationUsd).toBeCloseTo(floorUsd, 15);
    // ~$500 vault over ~1B tokens
    expect(preview.floorAtGraduationUsd).toBeCloseTo(5e-7, 10);

    const gradUsd =
      priceOf(curve.migrationSqrtPrice) * 1e-2 * SPYX_MULTIPLIER * SPYX_PRICE;
    expect(preview.graduationPriceUsd).toBeCloseTo(gradUsd, 15);
    expect(preview.graduationPriceUsd / preview.startPriceUsd).toBeCloseTo(
      1.2,
      6,
    );
    expect(preview.maxLossAtGraduationPrice).toBe(
      maxLossFraction(preview.graduationPriceUsd, preview.floorAtGraduationUsd),
    );
  });

  it("max loss at graduation follows f / (sqrt(r) + 1 - f)", () => {
    for (const preset of ["gentle", "flat"] as const) {
      for (const pct of [30, 50, 70]) {
        const p = previewLaunch(baseInput({ preset, vaultSharePct: pct }));
        const r = preset === "gentle" ? 1.2 : 1.01;
        const f = pct / 100;
        expect(1 - p.maxLossAtGraduationPrice).toBeCloseTo(
          f / (Math.sqrt(r) + 1 - f),
          5,
        );
      }
    }
  });

  it("does not depend on the token metadata strings", () => {
    const a = previewLaunch(baseInput({ name: "", symbol: "", uri: "" }));
    const b = previewLaunch(baseInput());
    expect(a).toEqual(b);
  });

  it("a bigger vault share gives a higher floor and a smaller max loss", () => {
    const low = previewLaunch(baseInput({ vaultSharePct: 30 }));
    const high = previewLaunch(baseInput({ vaultSharePct: 70 }));
    expect(high.floorAtGraduationUsd).toBeGreaterThan(low.floorAtGraduationUsd);
    expect(high.maxLossAtGraduationPrice).toBeLessThan(
      low.maxLossAtGraduationPrice,
    );
  });

  it("the USD preview does not depend on the quote price (same USD threshold)", () => {
    const a = previewLaunch(
      baseInput({ quotePriceUsd: 100, quoteMultiplier: 1 }),
    );
    const b = previewLaunch(
      baseInput({ quotePriceUsd: 900, quoteMultiplier: 1.3 }),
    );
    expect(b.graduationPriceUsd).toBeCloseTo(a.graduationPriceUsd, 9);
    expect(b.floorAtGraduationUsd).toBeCloseTo(a.floorAtGraduationUsd, 9);
    expect(b.maxLossAtGraduationPrice).toBeCloseTo(
      a.maxLossAtGraduationPrice,
      6,
    );
  });
});

describe("input validation", () => {
  it("rejects out-of-range launch inputs", () => {
    const bad: Partial<LaunchInput>[] = [
      { vaultSharePct: 29 },
      { vaultSharePct: 71 },
      { vaultSharePct: 50.5 },
      { quotePriceUsd: 0 },
      { quotePriceUsd: Number.NaN },
      { quoteMultiplier: 0 },
      { thresholdUsd: 0 },
      { thresholdUsd: -1 },
      { exitFeeBps: 501 },
      { exitFeeBps: -1 },
      { preset: "steep" as CurvePreset },
    ];
    for (const b of bad) {
      expect(() => previewLaunch(baseInput(b)), JSON.stringify(b)).toThrow(
        LaunchInputError,
      );
      expect(
        () => buildDbcConfigParams(baseInput(b), authority, authority),
        JSON.stringify(b),
      ).toThrow(LaunchInputError);
    }
  });

  it("rejects the default pubkey as fee claimer or leftover receiver", () => {
    expect(() =>
      buildDbcConfigParams(baseInput(), PublicKey.default, authority),
    ).toThrow(/feeClaimer/);
    expect(() =>
      buildDbcConfigParams(baseInput(), authority, PublicKey.default),
    ).toThrow(/leftoverReceiver/);
  });

  it("rejects a threshold that does not fit u64", () => {
    expect(() =>
      computeThresholdQuoteRaw(baseInput({ thresholdUsd: 1e30 })),
    ).toThrow(LaunchInputError);
  });

  it("rejects thresholds below MIN_THRESHOLD_USD and accepts it exactly", () => {
    expect(() => previewLaunch(baseInput({ thresholdUsd: 0.99 }))).toThrow(
      LaunchInputError,
    );
    const params = buildDbcConfigParams(
      baseInput({ thresholdUsd: MIN_THRESHOLD_USD }),
      authority,
      authority,
    );
    expect(() => validateConfigParameters(params)).not.toThrow();
    expect(
      previewLaunch(baseInput({ thresholdUsd: MIN_THRESHOLD_USD }))
        .vaultAtGraduationQuoteRaw > 0n,
    ).toBe(true);
  });

  it("validateTokenMetadata enforces the Metaplex limits", () => {
    expect(
      validateTokenMetadata("Community Token", "COMM", "https://x.y/z.json"),
    ).toEqual([]);
    expect(validateTokenMetadata("", "", "")).toEqual([
      "name is required",
      "symbol is required",
    ]);
    expect(
      validateTokenMetadata("x".repeat(33), "y".repeat(11), "z".repeat(201)),
    ).toHaveLength(3);
  });
});
