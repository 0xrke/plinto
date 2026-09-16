import { describe, expect, it } from "vitest";
import { MIN_THRESHOLD_USD, QUOTE_ALLOWLIST, type LaunchInput } from "@stockfloor/sdk";
import { THRESHOLD_MAX_USD } from "./config";
import {
  launchPriceError,
  parseThresholdUsd,
  previewLaunchInput,
  validateLaunchForm,
  validateThresholdUsd,
  type LaunchFormValues,
} from "./launchForm";

const valid: LaunchFormValues = {
  name: "Harbor Coffee Co-op",
  symbol: "HRBR",
  metadataUri: "https://example.com/token.json",
  quoteSymbol: "SPYx",
  preset: "gentle",
  vaultSharePct: 50,
  thresholdUsd: "1000",
};

describe("validateLaunchForm", () => {
  it("accepts a valid form, including an empty metadata URI and a bare image URL", () => {
    expect(validateLaunchForm(valid)).toEqual({});
    expect(validateLaunchForm({ ...valid, metadataUri: "" })).toEqual({});
    expect(validateLaunchForm({ ...valid, metadataUri: "https://example.com/logo.png" })).toEqual({});
  });

  it("requires a name of at most 32 characters", () => {
    expect(validateLaunchForm({ ...valid, name: "  " }).name).toBeDefined();
    expect(validateLaunchForm({ ...valid, name: "x".repeat(33) }).name).toBeDefined();
    expect(validateLaunchForm({ ...valid, name: "x".repeat(32) }).name).toBeUndefined();
    // 11 × 3-byte characters = 33 bytes
    expect(validateLaunchForm({ ...valid, name: "\u20ac".repeat(11) }).name).toBeDefined();
  });

  it("requires a 2 to 10 character alphanumeric symbol", () => {
    expect(validateLaunchForm({ ...valid, symbol: "" }).symbol).toBeDefined();
    expect(validateLaunchForm({ ...valid, symbol: "A" }).symbol).toBeDefined();
    expect(validateLaunchForm({ ...valid, symbol: "TOO-LONG-SYMBOL" }).symbol).toBeDefined();
    expect(validateLaunchForm({ ...valid, symbol: "abc1" }).symbol).toBeUndefined();
  });

  it("only accepts an https metadata URI that fits the on-chain field", () => {
    expect(validateLaunchForm({ ...valid, metadataUri: "http://example.com/a.json" }).metadataUri).toBeDefined();
    expect(validateLaunchForm({ ...valid, metadataUri: "not a url" }).metadataUri).toBeDefined();
    expect(
      validateLaunchForm({ ...valid, metadataUri: `https://example.com/${"a".repeat(200)}` }).metadataUri,
    ).toBeDefined();
  });

  it("keeps the vault share within 30..70", () => {
    expect(validateLaunchForm({ ...valid, vaultSharePct: 29 }).vaultSharePct).toBeDefined();
    expect(validateLaunchForm({ ...valid, vaultSharePct: 71 }).vaultSharePct).toBeDefined();
    expect(validateLaunchForm({ ...valid, vaultSharePct: 30 }).vaultSharePct).toBeUndefined();
    expect(validateLaunchForm({ ...valid, vaultSharePct: 70 }).vaultSharePct).toBeUndefined();
  });

  it("reports a bad graduation threshold on its own field", () => {
    expect(validateLaunchForm({ ...valid, thresholdUsd: "50" }).thresholdUsd).toBeUndefined();
    expect(validateLaunchForm({ ...valid, thresholdUsd: "0.5" }).thresholdUsd).toBeDefined();
    expect(validateLaunchForm({ ...valid, thresholdUsd: "" }).thresholdUsd).toBeDefined();
  });
});

describe("parseThresholdUsd", () => {
  it("accepts dollar amounts with grouping and at most two decimals", () => {
    expect(parseThresholdUsd("50")).toBe(50);
    expect(parseThresholdUsd(" 1,000 ")).toBe(1000);
    expect(parseThresholdUsd("$2,500.25")).toBe(2500.25);
    expect(parseThresholdUsd("12.5")).toBe(12.5);
  });

  it("rejects anything that is not such an amount", () => {
    for (const bad of ["", "abc", "-50", "1e3", "12.345", "1 000", "50%"]) {
      expect(parseThresholdUsd(bad), bad).toBeNull();
    }
  });
});

describe("validateThresholdUsd", () => {
  it("accepts the demo threshold, the default and both bounds", () => {
    for (const ok of [String(MIN_THRESHOLD_USD), "50", "1000", "1,000", String(THRESHOLD_MAX_USD)]) {
      expect(validateThresholdUsd(ok), ok).toBeUndefined();
    }
  });

  it("refuses below the SDK minimum and above the app maximum", () => {
    expect(validateThresholdUsd("0")).toMatch(/at least \$1/);
    expect(validateThresholdUsd("0.99")).toMatch(/at least \$1/);
    expect(validateThresholdUsd(String(THRESHOLD_MAX_USD + 1))).toMatch(/at most \$10,000,000/);
  });

  it("refuses an unparseable amount and an empty field", () => {
    expect(validateThresholdUsd("")).toMatch(/Enter a graduation threshold/);
    expect(validateThresholdUsd("1000.005")).toMatch(/two decimals/);
  });
});

describe("previewLaunchInput", () => {
  const spyx = QUOTE_ALLOWLIST.find((a) => a.symbol === "SPYx")!;
  const input = (thresholdUsd: number, quotePriceUsd = 758): LaunchInput => ({
    name: "Preview",
    symbol: "PREVIEW",
    uri: "",
    quote: spyx,
    quotePriceUsd,
    quoteMultiplier: 1.0057,
    preset: "gentle",
    vaultSharePct: 50,
    thresholdUsd,
    exitFeeBps: 200,
  });

  it("previews the $50 demo threshold and scales the floor linearly with it", () => {
    const small = previewLaunchInput(input(50));
    const big = previewLaunchInput(input(1000));
    expect(small.error).toBeNull();
    expect(big.error).toBeNull();
    // 20× the threshold raises the vault and the floor about 20× (the supply target is fixed).
    expect(big.preview!.floorAtGraduationUsd / small.preview!.floorAtGraduationUsd).toBeCloseTo(20, 1);
    // Max loss depends only on the vault share and the preset, never on the threshold.
    expect(big.preview!.maxLossAtGraduationPrice).toBeCloseTo(small.preview!.maxLossAtGraduationPrice, 6);
  });

  it("returns the chain's own rejection when the threshold does not fit a u64 of quote raw units", () => {
    // A cheap quote asset turns a huge USD threshold into more raw units than a u64 holds.
    const { preview, error } = previewLaunchInput(input(THRESHOLD_MAX_USD, 0.000001));
    expect(preview).toBeNull();
    expect(error).toMatch(/outside \(0, u64::MAX\]/);
  });
});

describe("launchPriceError", () => {
  it("accepts only a live Jupiter price on chain data outside a local cluster", () => {
    expect(launchPriceError("chain", "jupiter", false)).toBeNull();
    expect(launchPriceError("chain", "stale", false)).toMatch(/more than 5 minutes old/);
    expect(launchPriceError("chain", "reference", false)).toMatch(/live quote price is unavailable/);
    // Local forks may use any price (offline demos); mock data never launches on chain.
    expect(launchPriceError("chain", "stale", true)).toBeNull();
    expect(launchPriceError("chain", "reference", true)).toBeNull();
    expect(launchPriceError("mock", "mock", false)).toBeNull();
  });
});
