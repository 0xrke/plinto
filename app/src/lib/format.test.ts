import { describe, expect, it } from "vitest";
import {
  EMPTY,
  MINUS,
  formatCompact,
  formatMaxLoss,
  formatMultiple,
  formatNumber,
  formatPercent,
  formatProgress,
  formatTokenAmount,
  formatUsd,
  parseTokenInput,
  rawToDecimal,
  truncateAddress,
} from "./format";

describe("formatUsd", () => {
  it("uses two decimals with grouping at or above one dollar", () => {
    expect(formatUsd(1234.567)).toBe("$1,234.57");
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(668.4)).toBe("$668.40");
  });

  it("uses two to four decimals between one cent and one dollar", () => {
    expect(formatUsd(0.5)).toBe("$0.50");
    expect(formatUsd(0.012345)).toBe("$0.0123");
  });

  it("uses three significant digits for sub-cent token prices", () => {
    expect(formatUsd(0.000000512)).toBe("$0.000000512");
    expect(formatUsd(0.0000064567)).toBe("$0.00000646");
    expect(formatUsd(0.0000005)).toBe("$0.0000005");
  });

  it("handles zero, negatives and non-finite values", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-12.5)).toBe(`${MINUS}$12.50`);
    expect(formatUsd(Number.NaN)).toBe(EMPTY);
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe(EMPTY);
  });

  it("supports compact notation for large values only", () => {
    expect(formatUsd(1_234_567, { compact: true })).toBe("$1.2M");
    expect(formatUsd(12_500, { compact: true })).toBe("$12.5K");
    expect(formatUsd(9_999.99, { compact: true })).toBe("$9,999.99");
  });
});

describe("formatProgress", () => {
  it("never shows an incomplete curve as 100%", () => {
    // formatPercent rounds to nearest, which showed a 99.6% curve as complete.
    expect(formatPercent(0.996, { digits: 0 })).toBe("100%");
    expect(formatProgress(0.996)).toBe("99%");
    expect(formatProgress(0.999999)).toBe("99%");
    expect(formatProgress(1)).toBe("100%");
    expect(formatProgress(1.5)).toBe("100%");
    // Below the cap it rounds to nearest like before.
    expect(formatProgress(0.619999)).toBe("62%");
    expect(formatProgress(0.29)).toBe("29%");
    expect(formatProgress(0)).toBe("0%");
    expect(formatProgress(0.9996, 1)).toBe("99.9%");
    expect(formatProgress(0.1234, 1)).toBe("12.3%");
    expect(formatProgress(Number.NaN)).toBe(EMPTY);
  });
});

describe("formatPercent", () => {
  it("formats fractions and trims trailing zeros", () => {
    expect(formatPercent(0.917)).toBe("91.7%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.12345, { digits: 2 })).toBe("12.35%");
  });

  it("signs values when asked and always signs negatives", () => {
    expect(formatPercent(0.034, { signed: true })).toBe("+3.4%");
    expect(formatPercent(-0.034)).toBe(`${MINUS}3.4%`);
    expect(formatPercent(0, { signed: true })).toBe("0%");
  });

  it("shows a floor marker for tiny non-zero values", () => {
    expect(formatPercent(0.0004)).toBe("<0.1%");
  });
});

describe("formatMaxLoss", () => {
  it("renders the loss with a typographic minus", () => {
    expect(formatMaxLoss(1 - 1 / 12)).toBe(`${MINUS}91.7%`);
    expect(formatMaxLoss(0.13)).toBe(`${MINUS}13%`);
  });

  it("clamps to [0, 1] and renders zero without a sign", () => {
    expect(formatMaxLoss(0)).toBe("0%");
    expect(formatMaxLoss(-0.2)).toBe("0%");
    expect(formatMaxLoss(1.5)).toBe(`${MINUS}100%`);
  });
});

describe("formatMultiple", () => {
  it("adapts precision to magnitude", () => {
    expect(formatMultiple(12.13)).toBe("12.1×");
    expect(formatMultiple(1.149)).toBe("1.15×");
    expect(formatMultiple(250.4)).toBe("250×");
  });

  it("rejects non-positive values", () => {
    expect(formatMultiple(0)).toBe(EMPTY);
    expect(formatMultiple(Number.NaN)).toBe(EMPTY);
  });
});

describe("formatTokenAmount", () => {
  it("formats raw base token amounts (6 decimals)", () => {
    expect(formatTokenAmount(25_000_000_000_000n, 6)).toBe("25,000,000");
    expect(formatTokenAmount(1_234_567n, 6)).toBe("1.2345");
    expect(formatTokenAmount(999_999n, 6)).toBe("0.999999");
    expect(formatTokenAmount(0n, 6)).toBe("0");
  });

  it("applies the ScaledUiAmount multiplier for quote amounts (8 decimals)", () => {
    // 0.78412907 SPYx raw-equivalent × 1.0057 = 0.788598...
    expect(formatTokenAmount(78_412_907n, 8, { multiplier: 1.0057 })).toBe("0.788598");
    expect(formatTokenAmount(100_000_000n, 8, { multiplier: 1.0057 })).toBe("1.0057");
  });

  it("rounds down so amounts are never overstated", () => {
    expect(formatTokenAmount(1_999_999n, 6, { maxFractionDigits: 2 })).toBe("1.99");
    expect(formatTokenAmount(19_999_999n, 8, { multiplier: 1.5, maxFractionDigits: 2 })).toBe("0.29");
  });

  it("rounds to nearest only when asked (amounts that already moved)", () => {
    // 0.1 UI SPYx typed → 9,943,179 raw → 0.0999999976 UI: shown as paid 0.1, never as a balance of 0.1.
    expect(formatTokenAmount(9_943_179n, 8, { multiplier: 1.005714560286254, maxFractionDigits: 8 })).toBe("0.09999999");
    expect(formatTokenAmount(9_943_179n, 8, { multiplier: 1.005714560286254, maxFractionDigits: 8, roundNearest: true })).toBe("0.1");
  });

  it("marks tiny non-zero amounts instead of showing zero", () => {
    expect(formatTokenAmount(1n, 8)).toBe("<0.000001");
    expect(formatTokenAmount(1n, 6, { maxFractionDigits: 2 })).toBe("<0.01");
  });

  it("supports compact notation and negative values", () => {
    expect(formatTokenAmount(987_315_402_118_204n, 6, { compact: true })).toBe("987.3M");
    expect(formatTokenAmount(-1_500_000n, 6)).toBe(`${MINUS}1.5`);
  });
});

describe("rawToDecimal", () => {
  it("is exact for large raw values", () => {
    expect(rawToDecimal(123_456_789_012_345_678n, 6).toFixed()).toBe("123456789012.345678");
  });
});

describe("parseTokenInput", () => {
  it("parses decimal strings into raw units without floating point", () => {
    expect(parseTokenInput("1", 6)).toBe(1_000_000n);
    expect(parseTokenInput("1.5", 6)).toBe(1_500_000n);
    expect(parseTokenInput(".25", 6)).toBe(250_000n);
    expect(parseTokenInput("1,000.000001", 6)).toBe(1_000_000_001n);
    expect(parseTokenInput("12.", 6)).toBe(12_000_000n);
    expect(parseTokenInput("123456789012.345678", 6)).toBe(123_456_789_012_345_678n);
  });

  it("rejects invalid input and excess precision", () => {
    expect(parseTokenInput("", 6)).toBeNull();
    expect(parseTokenInput("abc", 6)).toBeNull();
    expect(parseTokenInput("-1", 6)).toBeNull();
    expect(parseTokenInput("1.2.3", 6)).toBeNull();
    expect(parseTokenInput("0.0000001", 6)).toBeNull();
    expect(parseTokenInput("1e3", 6)).toBeNull();
  });
});

describe("formatNumber", () => {
  it("groups digits and rounds down", () => {
    expect(formatNumber(67_808_219.9)).toBe("67,808,219");
    expect(formatNumber(1.239, 2)).toBe("1.23");
    expect(formatNumber(-2.5)).toBe(`${MINUS}2`);
    expect(formatNumber(Number.NaN)).toBe(EMPTY);
  });
});

describe("formatCompact and truncateAddress", () => {
  it("formats compact numbers", () => {
    expect(formatCompact(987_315_402)).toBe("987.3M");
    expect(formatCompact(Number.NaN)).toBe(EMPTY);
  });

  it("shortens long addresses and leaves short strings alone", () => {
    expect(truncateAddress("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W")).toBe("XsoC…DF2W");
    expect(truncateAddress("short")).toBe("short");
  });
});
