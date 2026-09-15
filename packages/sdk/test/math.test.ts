import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  effectiveScaledUiMultiplier,
  floorPerTokenRaw,
  floorPerTokenUsd,
  maxLossFraction,
  rawToUi,
  redeemQuote,
  sqrtPriceX64ToUsd,
  toRational,
  uiToRaw,
  usdToQuoteRaw,
} from "../src";

const U64_MAX = (1n << 64n) - 1n;

/** Cross-multiplication compare of a/b and c/d (b, d > 0). */
const cmpFrac = (a: bigint, b: bigint, c: bigint, d: bigint) => {
  const l = a * d;
  const r = c * b;
  return l < r ? -1 : l > r ? 1 : 0;
};

describe("floorPerTokenRaw", () => {
  it("returns vault / supply without reducing", () => {
    expect(floorPerTokenRaw(500n, 1000n)).toEqual({ num: 500n, den: 1000n });
    expect(floorPerTokenRaw(0n, 7n)).toEqual({ num: 0n, den: 7n });
  });

  it("returns 0/1 for a zero supply", () => {
    expect(floorPerTokenRaw(123n, 0n)).toEqual({ num: 0n, den: 1n });
  });

  it("rejects negative values", () => {
    expect(() => floorPerTokenRaw(-1n, 1n)).toThrow(RangeError);
    expect(() => floorPerTokenRaw(1n, -1n)).toThrow(RangeError);
  });
});

describe("redeemQuote", () => {
  it("matches the on-chain formulas on hand-computed cases", () => {
    // gross = floor(1000 * 10 / 30) = 333; fee = ceil(333 * 200 / 10000) = ceil(6.66) = 7
    expect(redeemQuote(1000n, 30n, 10n, 200)).toEqual({
      gross: 333n,
      fee: 7n,
      net: 326n,
    });
    expect(redeemQuote(10_000n, 100n, 50n, 200)).toEqual({
      gross: 5000n,
      fee: 100n,
      net: 4900n,
    });
    // fee rounds up even for a tiny gross
    expect(redeemQuote(1n, 1n, 1n, 1)).toEqual({ gross: 1n, fee: 1n, net: 0n });
    // gross rounds down to zero: nothing paid, nothing charged
    expect(redeemQuote(1n, 3n, 1n, 200)).toEqual({
      gross: 0n,
      fee: 0n,
      net: 0n,
    });
    // zero fee
    expect(redeemQuote(999n, 1000n, 1000n, 0)).toEqual({
      gross: 999n,
      fee: 0n,
      net: 999n,
    });
  });

  it("rejects invalid input", () => {
    expect(() => redeemQuote(1n, 0n, 0n, 200)).toThrow(/supplyRaw/);
    expect(() => redeemQuote(1n, 10n, 11n, 200)).toThrow(/exceeds/);
    expect(() => redeemQuote(1n, 10n, 1n, -1)).toThrow(/exitFeeBps/);
    expect(() => redeemQuote(1n, 10n, 1n, 10_001)).toThrow(/exitFeeBps/);
    expect(() => redeemQuote(1n, 10n, 1n, 1.5)).toThrow(/exitFeeBps/);
    expect(() => redeemQuote(-1n, 10n, 1n, 1)).toThrow(RangeError);
    expect(() => redeemQuote(1n, 10n, -1n, 1)).toThrow(RangeError);
  });

  const state = fc
    .tuple(
      fc.bigInt({ min: 0n, max: U64_MAX }),
      fc.bigInt({ min: 1n, max: U64_MAX }),
      fc.integer({ min: 0, max: 500 }),
    )
    .chain(([vault, supply, bps]) =>
      fc
        .bigInt({ min: 0n, max: supply })
        .map((amount) => ({ vault, supply, bps, amount })),
    );

  it("property: rounding is exactly floor for gross and ceil for fee", () => {
    fc.assert(
      fc.property(state, ({ vault, supply, bps, amount }) => {
        const { gross, fee, net } = redeemQuote(vault, supply, amount, bps);
        // gross = floor(vault * amount / supply)
        expect(gross * supply <= vault * amount).toBe(true);
        expect((gross + 1n) * supply > vault * amount).toBe(true);
        // fee = ceil(gross * bps / 10000)
        expect(fee * 10_000n >= gross * BigInt(bps)).toBe(true);
        expect((fee - 1n) * 10_000n < gross * BigInt(bps)).toBe(true);
        expect(net + fee).toBe(gross);
        expect(net >= 0n && fee >= 0n).toBe(true);
        expect(gross <= vault).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("property: the floor never decreases after a redemption, and rises when a fee is charged", () => {
    fc.assert(
      fc.property(state, ({ vault, supply, bps, amount }) => {
        fc.pre(amount < supply);
        const { fee, net } = redeemQuote(vault, supply, amount, bps);
        const cmp = cmpFrac(vault - net, supply - amount, vault, supply);
        expect(cmp).toBeGreaterThanOrEqual(0);
        if (fee > 0n) expect(cmp).toBe(1);
        if (bps > 0 && amount > 0n && vault > 0n) expect(cmp).toBe(1);
      }),
      { numRuns: 2000 },
    );
  });

  it("property: over random sequences the floor is monotone and redeemers never get more than their starting pro-rata share", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.integer({ min: 0, max: 500 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: 1,
          maxLength: 40,
        }),
        (vault0, supply0, bps, fractions) => {
          let vault = vault0;
          let supply = supply0;
          let redeemed = 0n;
          let paid = 0n;
          for (const f of fractions) {
            if (supply === 0n) break;
            const amount = BigInt(Math.floor(f * Number(supply)));
            const clamped = amount > supply ? supply : amount;
            const { net } = redeemQuote(vault, supply, clamped, bps);
            const nextVault = vault - net;
            const nextSupply = supply - clamped;
            if (nextSupply > 0n)
              expect(
                cmpFrac(nextVault, nextSupply, vault, supply),
              ).toBeGreaterThanOrEqual(0);
            vault = nextVault;
            supply = nextSupply;
            redeemed += clamped;
            paid += net;
          }
          // Total paid out <= floor(vault0 * redeemed / supply0) (the fee-less share at the start).
          expect(paid * supply0 <= vault0 * redeemed).toBe(true);
          expect(vault >= 0n).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("property: with a zero exit fee, many tiny redemptions never extract more than one large one", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 6n }), {
          minLength: 1,
          maxLength: 50,
        }),
        (vault0, supply0, pieces) => {
          const total = pieces.reduce((a, b) => a + b, 0n);
          fc.pre(total <= supply0);
          let vault = vault0;
          let supply = supply0;
          let paid = 0n;
          for (const a of pieces) {
            const { net } = redeemQuote(vault, supply, a, 0);
            vault -= net;
            supply -= a;
            paid += net;
          }
          expect(paid <= redeemQuote(vault0, supply0, total, 0).net).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("documents that with an exit fee, splitting can return more than one large redemption (fee rebate), yet stays below the fee-less share", () => {
    // 50% of supply in two steps vs 100% at once, 2% fee: the first step's fee stays in the
    // vault and part of it comes back on the second step.
    const one = redeemQuote(1_000_000n, 1_000_000n, 1_000_000n, 200).net; // 980000
    const first = redeemQuote(1_000_000n, 1_000_000n, 500_000n, 200);
    const second = redeemQuote(1_000_000n - first.net, 500_000n, 500_000n, 200);
    expect(one).toBe(980_000n);
    expect(first.net + second.net).toBe(989_800n);
    expect(first.net + second.net <= 1_000_000n).toBe(true);
  });
});

describe("maxLossFraction", () => {
  it("computes 1 - floor / price", () => {
    expect(maxLossFraction(12, 1)).toBeCloseTo(11 / 12, 12);
    expect(maxLossFraction(2, 1)).toBe(0.5);
    expect(maxLossFraction(1, 0)).toBe(1);
  });

  it("is 0 at or below the floor and for non-positive prices", () => {
    expect(maxLossFraction(1, 1)).toBe(0);
    expect(maxLossFraction(0.5, 1)).toBe(0);
    expect(maxLossFraction(0, 0)).toBe(0);
    expect(maxLossFraction(-1, 0)).toBe(0);
    expect(maxLossFraction(Number.NaN, 1)).toBe(0);
  });

  it("treats an unknown or negative floor as zero", () => {
    expect(maxLossFraction(1, Number.NaN)).toBe(1);
    expect(maxLossFraction(1, -5)).toBe(1);
  });

  it("property: always within [0, 1] and monotone in the floor", () => {
    fc.assert(
      fc.property(
        fc.double(),
        fc.double(),
        fc.double({ min: 0, max: 1e12, noNaN: true }),
        (price, floor, bump) => {
          const z = maxLossFraction(price, floor);
          expect(z >= 0 && z <= 1).toBe(true);
          if (
            Number.isFinite(floor) &&
            floor >= 0 &&
            price > 0 &&
            Number.isFinite(price)
          ) {
            expect(maxLossFraction(price, floor + bump)).toBeLessThanOrEqual(z);
          }
        },
      ),
      { numRuns: 5000 },
    );
  });
});

describe("rawToUi / uiToRaw", () => {
  it("converts with decimals and the ScaledUiAmount multiplier", () => {
    expect(rawToUi(123_456_789n, 8)).toBeCloseTo(1.23456789, 12);
    expect(rawToUi(100_000_000n, 8, 1.005714560286254)).toBeCloseTo(
      1.005714560286254,
      12,
    );
    expect(uiToRaw("1.23456789", 8)).toBe(123_456_789n);
    expect(uiToRaw("1.005714560286254", 8, 1.005714560286254)).toBe(
      100_000_000n,
    );
    expect(uiToRaw(0.1, 6)).toBe(100_000n);
    expect(uiToRaw("1e-8", 8)).toBe(1n);
    expect(uiToRaw("0.000000009", 8)).toBe(0n); // rounds down
    expect(uiToRaw(1, 8, 2)).toBe(50_000_000n);
    expect(uiToRaw(1, 8, "0.5")).toBe(200_000_000n);
  });

  it("keeps precision for large raw amounts", () => {
    const raw = 9_523_194_875_528n;
    expect(rawToUi(raw, 8)).toBe(95231.94875528);
    expect(uiToRaw("95231.94875528", 8)).toBe(raw);
  });

  it("rejects invalid input", () => {
    expect(() => uiToRaw(-1, 8)).toThrow(RangeError);
    expect(() => uiToRaw(Number.NaN, 8)).toThrow(RangeError);
    expect(() => uiToRaw(Infinity, 8)).toThrow(RangeError);
    expect(() => uiToRaw("abc", 8)).toThrow(RangeError);
    expect(() => uiToRaw(1, 8, 0)).toThrow(RangeError);
    expect(() => uiToRaw(1, -1)).toThrow(RangeError);
    expect(() => rawToUi(1n, 8, -1)).toThrow(RangeError);
  });

  const multiplier = fc.oneof(
    fc.constant(1),
    fc.double({ min: 0.5, max: 2, noNaN: true }),
  );

  it("property: uiToRaw(rawToUi(raw)) is within 1 raw unit for raw <= 2^50 (1.1e15)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1n << 50n }),
        fc.integer({ min: 0, max: 9 }),
        multiplier,
        (raw, decimals, m) => {
          const back = uiToRaw(rawToUi(raw, decimals, m), decimals, m);
          const diff = back > raw ? back - raw : raw - back;
          expect(diff <= 1n).toBe(true);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it("property: for any u64 raw the round trip error is bounded by double precision (1e-15 relative + 1)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: U64_MAX }),
        fc.integer({ min: 0, max: 9 }),
        multiplier,
        (raw, decimals, m) => {
          const back = uiToRaw(rawToUi(raw, decimals, m), decimals, m);
          const diff = back > raw ? back - raw : raw - back;
          expect(Number(diff)).toBeLessThanOrEqual(Number(raw) * 1e-15 + 1);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it("property: with an exact decimal string and multiplier 1 the round trip is exact", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: U64_MAX }),
        fc.integer({ min: 0, max: 12 }),
        (raw, decimals) => {
          const scale = 10n ** BigInt(decimals);
          const text =
            decimals === 0
              ? raw.toString()
              : `${raw / scale}.${(raw % scale).toString().padStart(decimals, "0")}`;
          expect(uiToRaw(text, decimals)).toBe(raw);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("property: uiToRaw rounds down (never worth more than the UI amount)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e9, noNaN: true }),
        fc.integer({ min: 0, max: 9 }),
        multiplier,
        (ui, decimals, m) => {
          const raw = uiToRaw(ui, decimals, m);
          const u = toRational(ui);
          const mr = toRational(m);
          // raw / 10^d * m <= ui < (raw + 1) / 10^d * m
          const scale = 10n ** BigInt(decimals);
          expect(raw * mr.n * u.d <= u.n * scale * mr.d).toBe(true);
          expect((raw + 1n) * mr.n * u.d > u.n * scale * mr.d).toBe(true);
        },
      ),
      { numRuns: 3000 },
    );
  });
});

describe("USD helpers", () => {
  it("usdToQuoteRaw uses usdPrice per UI token and the multiplier", () => {
    // $1000 of SPYx at $757.019436684184 per UI token, multiplier 1.005714560286254
    const raw = usdToQuoteRaw(1000, 757.019436684184, 8, 1.005714560286254);
    const exact = ((1000 / 757.019436684184) * 1e8) / 1.005714560286254;
    expect(Number(raw)).toBeGreaterThanOrEqual(exact);
    expect(Number(raw) - exact).toBeLessThan(1.0001);
    expect(raw).toBe(131_346_418n);
    // worth at least $1000
    expect(
      rawToUi(raw, 8, 1.005714560286254) * 757.019436684184,
    ).toBeGreaterThanOrEqual(1000);
    expect(usdToQuoteRaw(1, 1, 0, 1, "down")).toBe(1n);
    expect(usdToQuoteRaw("10", "3", 0, 1, "down")).toBe(3n);
    expect(usdToQuoteRaw("10", "3", 0, 1, "up")).toBe(4n);
    expect(() => usdToQuoteRaw(1, 0, 8)).toThrow(RangeError);
  });

  it("sqrtPriceX64ToUsd converts Q64.64 sqrt prices", () => {
    // sqrt price of exactly 1 quote raw per base raw
    expect(sqrtPriceX64ToUsd(1n << 64n, 6, 8, 1, 1)).toBeCloseTo(0.01, 12);
    expect(sqrtPriceX64ToUsd(2n << 64n, 6, 6, 1.5, 2)).toBeCloseTo(12, 12);
  });

  it("floorPerTokenUsd matches vault / supply", () => {
    // vault 0.5 UI SPYx, supply 1000 tokens → 0.0005 SPYx per token
    expect(
      floorPerTokenUsd(50_000_000n, 1_000_000_000n, 6, 8, 1, 700),
    ).toBeCloseTo(0.35, 12);
    expect(floorPerTokenUsd(50_000_000n, 0n, 6, 8, 1, 700)).toBe(0);
  });

  it("effectiveScaledUiMultiplier switches at the effective timestamp", () => {
    const cfg = {
      multiplier: "1.003909240011759",
      newMultiplier: "1.005714560286254",
      newMultiplierEffectiveTimestamp: 1781755200,
    };
    expect(effectiveScaledUiMultiplier(cfg, 1781755199)).toBe(
      1.003909240011759,
    );
    expect(effectiveScaledUiMultiplier(cfg, 1781755200)).toBe(
      1.005714560286254,
    );
  });

  it("toRational parses exponents exactly", () => {
    expect(toRational("1.5e3")).toEqual({ n: 15000n, d: 10n });
    expect(toRational(1e-7)).toEqual({ n: 1n, d: 10000000n });
    expect(toRational("-2.25")).toEqual({ n: -225n, d: 100n });
    expect(() => toRational(".")).toThrow(RangeError);
  });
});
