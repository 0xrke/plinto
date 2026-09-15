import { describe, expect, it } from "vitest";
import {
  afterFee,
  estimateSellUsd,
  estimateTokensOut,
  floorValueUsd,
  parseUiNumber,
  validateRedeemAmount,
} from "./estimates";

describe("trade estimates", () => {
  it("applies basis-point fees", () => {
    expect(afterFee(100, 100)).toBeCloseTo(99);
    expect(afterFee(100, 0)).toBe(100);
  });

  it("estimates tokens out for a USD amount after the curve fee", () => {
    // $100 at $0.00000146 with a 1% fee -> 67,808,219 tokens
    expect(estimateTokensOut(100, 0.00000146, 100)).toBeCloseTo(67_808_219.18, 0);
    expect(estimateTokensOut(0, 0.00000146, 100)).toBe(0);
    expect(estimateTokensOut(100, 0, 100)).toBe(0);
  });

  it("estimates sell proceeds", () => {
    expect(estimateSellUsd(1_000_000, 0.00000646, 100)).toBeCloseTo(6.3954, 4);
    expect(estimateSellUsd(-1, 1, 0)).toBe(0);
  });

  it("values tokens at the floor after the exit fee", () => {
    // 1M tokens at a $0.0000005 floor with a 2% exit fee -> $0.49
    expect(floorValueUsd(1_000_000, 0.0000005, 200)).toBeCloseTo(0.49, 10);
    expect(floorValueUsd(1_000_000, 0, 200)).toBe(0);
  });

  it("parses UI numbers strictly", () => {
    expect(parseUiNumber("1,250.5")).toBe(1250.5);
    expect(parseUiNumber(".5")).toBe(0.5);
    expect(parseUiNumber("")).toBeNull();
    expect(parseUiNumber("1e5")).toBeNull();
    expect(parseUiNumber("-3")).toBeNull();
  });
});

describe("validateRedeemAmount", () => {
  const supply = 1_000_000_000_000n;
  it("accepts amounts within balance and supply", () => {
    expect(validateRedeemAmount(5n, 10n, supply)).toBeNull();
    expect(validateRedeemAmount(5n, null, supply)).toBeNull();
  });
  it("rejects invalid, zero, over-balance and over-supply amounts", () => {
    expect(validateRedeemAmount(null, 10n, supply)).toMatch(/valid amount/);
    expect(validateRedeemAmount(0n, 10n, supply)).toMatch(/greater than zero/);
    expect(validateRedeemAmount(11n, 10n, supply)).toMatch(/balance/);
    expect(validateRedeemAmount(supply + 1n, null, supply)).toMatch(/supply/);
  });
});
