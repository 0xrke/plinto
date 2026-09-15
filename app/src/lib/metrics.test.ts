import { describe, expect, it } from "vitest";
import { QUOTE_ALLOWLIST } from "@stockfloor/sdk";
import type { LaunchSummary, QuoteMarket } from "./data/types";
import { MINUS } from "./format";
import {
  buyButtonLabel,
  floorQuotePerToken,
  floorUsdPerToken,
  launchFloorUsd,
  presaleProgress,
  previewRedeem,
  priceToFloorMultiple,
  projectedFloorUsd,
  quoteRawToUsd,
} from "./metrics";

const spyx = QUOTE_ALLOWLIST.find((a) => a.symbol === "SPYx")!;

const market: QuoteMarket = { asset: spyx, priceUsd: 757.02, multiplier: 1.0057146, updatedAt: 0 };

function launch(overrides: Partial<LaunchSummary> = {}): LaunchSummary {
  return {
    mint: "mint",
    config: "config",
    pool: "pool",
    dammPool: "damm",
    vault: "vault",
    name: "Test",
    symbol: "TEST",
    imageUrl: null,
    creator: "creator",
    createdAt: 0,
    baseDecimals: 6,
    quote: market,
    preset: "gentle",
    vaultSharePct: 50,
    exitFeeBps: 200,
    phase: "graduated",
    thresholdQuoteRaw: 132_664_237n,
    quoteReserveRaw: 132_664_237n,
    priceUsd: 0.00000633,
    vaultRaw: 68_410_000n,
    supplyRaw: 987_315_402_118_204n,
    migrationFeeHarvested: true,
    projectedAtGraduation: null,
    ...overrides,
  };
}

describe("quote conversions", () => {
  it("applies decimals, the ScaledUiAmount multiplier and the USD price", () => {
    // 1 SPYx raw-equivalent (1e8 raw) = 1.0057146 UI tokens = $761.35
    expect(quoteRawToUsd(100_000_000n, market)).toBeCloseTo(761.3459, 3);
  });
});

describe("floor math", () => {
  it("computes the floor per whole token from vault and supply", () => {
    // 1 SPYx (raw 1e8) over 1B tokens (raw 1e15): 1e-9 SPYx raw-equivalent per token × multiplier
    const perToken = floorQuotePerToken(100_000_000n, 1_000_000_000_000_000n, 6, market);
    expect(perToken).toBeCloseTo(1.0057146e-9, 15);
    expect(floorUsdPerToken(100_000_000n, 1_000_000_000_000_000n, 6, market)).toBeCloseTo(7.613459e-7, 12);
  });

  it("returns 0 for an empty vault or zero supply", () => {
    expect(floorUsdPerToken(0n, 1_000n, 6, market)).toBe(0);
    expect(floorUsdPerToken(1_000n, 0n, 6, market)).toBe(0);
  });

  it("derives the launch floor and the projected floor", () => {
    expect(launchFloorUsd(launch())).toBeCloseTo(5.2753e-7, 10);
    expect(projectedFloorUsd(launch())).toBeNull();
    const presale = launch({
      phase: "presale",
      vaultRaw: 0n,
      projectedAtGraduation: { vaultQuoteRaw: 65_673_157n, baseSupplyRaw: 1_000_000_000_000_000n },
    });
    expect(launchFloorUsd(presale)).toBe(0);
    expect(projectedFloorUsd(presale)).toBeCloseTo(5.0e-7, 9);
  });

  it("computes the price-to-floor multiple", () => {
    expect(priceToFloorMultiple(12, 1)).toBe(12);
    expect(priceToFloorMultiple(1, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("presaleProgress", () => {
  it("is the reserve over the threshold, clamped to [0, 1]", () => {
    expect(presaleProgress({ quoteReserveRaw: 62n, thresholdQuoteRaw: 100n })).toBeCloseTo(0.62);
    expect(presaleProgress({ quoteReserveRaw: 150n, thresholdQuoteRaw: 100n })).toBe(1);
    expect(presaleProgress({ quoteReserveRaw: 0n, thresholdQuoteRaw: 100n })).toBe(0);
    expect(presaleProgress({ quoteReserveRaw: 10n, thresholdQuoteRaw: 0n })).toBe(0);
  });
});

describe("buyButtonLabel", () => {
  it("shows price, floor and max loss with the exact brief wording", () => {
    expect(buyButtonLabel(0.0000012, 0.0000001)).toBe(
      `Price $0.0000012 · Floor $0.0000001 · Max loss if you buy now: ${MINUS}91.7%`,
    );
  });

  it("shows 0% when the price is at or below the floor", () => {
    expect(buyButtonLabel(1, 1.2)).toBe("Price $1.00 · Floor $1.20 · Max loss if you buy now: 0%");
  });
});

describe("previewRedeem", () => {
  it("mirrors the on-chain rounding and keeps the floor from falling", () => {
    const l = launch({ vaultRaw: 1_000_000n, supplyRaw: 3_000_000n });
    const p = previewRedeem(l, 1_000_000n);
    // gross = floor(1e6 * 1e6 / 3e6) = 333333; fee = ceil(333333 * 200 / 10000) = 6667
    expect(p.gross).toBe(333_333n);
    expect(p.fee).toBe(6_667n);
    expect(p.net).toBe(326_666n);
    const before = launchFloorUsd(l);
    expect(p.floorAfterUsd).toBeGreaterThan(before);
    expect(p.netUsd).toBeCloseTo(quoteRawToUsd(326_666n, market), 10);
  });

  it("returns a zero floor after redeeming the entire supply", () => {
    const l = launch({ vaultRaw: 1_000n, supplyRaw: 10n });
    expect(previewRedeem(l, 10n).floorAfterUsd).toBe(0);
  });
});
