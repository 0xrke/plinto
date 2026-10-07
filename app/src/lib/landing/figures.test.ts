import { describe, expect, it } from "vitest";
import {
  EXIT_FEE_PCT,
  FLOOR_SHARE_MAX_PCT,
  FLOOR_SHARE_MIN_PCT,
  formatCentsUsd,
  formatWholeUsd,
  raiseSplit,
  splitAriaLabel,
  worstCasePer100,
} from "./figures";

describe("landing figures", () => {
  it("splits the default $10,000 raise 50 / 40 / 5 / 5 (README, Who pays for this)", () => {
    const parts = raiseSplit();
    expect(parts.map((p) => [p.key, p.pct, p.usd])).toEqual([
      ["floor", 50, 5_000],
      ["pool", 40, 4_000],
      ["creator", 5, 500],
      ["platform", 5, 500],
    ]);
    expect(parts.reduce((s, p) => s + p.pct, 0)).toBe(100);
  });

  it("keeps the split at 100% across the creator's floor-share range", () => {
    for (const floor of [FLOOR_SHARE_MIN_PCT, FLOOR_SHARE_MAX_PCT]) {
      expect(raiseSplit(10_000, floor).reduce((s, p) => s + p.pct, 0)).toBe(100);
    }
    expect([FLOOR_SHARE_MIN_PCT, FLOOR_SHARE_MAX_PCT, EXIT_FEE_PCT]).toEqual([30, 60, 2]);
  });

  it("labels the bar in words", () => {
    expect(splitAriaLabel(raiseSplit())).toBe("Floor 50%, locked pool 40%, creator 5%, platform 5%");
  });

  it("matches the README worst case: $34.88 back, $65.12 at risk", () => {
    expect(worstCasePer100()).toEqual({ backUsd: 34.88, atRiskUsd: 65.12 });
  });

  it("formats dollars", () => {
    expect(formatWholeUsd(5_000)).toBe("$5,000");
    expect(formatCentsUsd(34.88)).toBe("$34.88");
  });
});
