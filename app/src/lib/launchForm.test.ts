import { describe, expect, it } from "vitest";
import { validateLaunchForm, type LaunchFormValues } from "./launchForm";

const valid: LaunchFormValues = {
  name: "Harbor Coffee Co-op",
  symbol: "HRBR",
  imageUrl: "https://example.com/logo.png",
  quoteSymbol: "SPYx",
  preset: "gentle",
  vaultSharePct: 50,
};

describe("validateLaunchForm", () => {
  it("accepts a valid form, including an empty image URL", () => {
    expect(validateLaunchForm(valid)).toEqual({});
    expect(validateLaunchForm({ ...valid, imageUrl: "" })).toEqual({});
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

  it("only accepts https image URLs", () => {
    expect(validateLaunchForm({ ...valid, imageUrl: "http://example.com/a.png" }).imageUrl).toBeDefined();
    expect(validateLaunchForm({ ...valid, imageUrl: "not a url" }).imageUrl).toBeDefined();
    expect(
      validateLaunchForm({ ...valid, imageUrl: `https://example.com/${"a".repeat(200)}` }).imageUrl,
    ).toBeDefined();
  });

  it("keeps the vault share within 30..70", () => {
    expect(validateLaunchForm({ ...valid, vaultSharePct: 29 }).vaultSharePct).toBeDefined();
    expect(validateLaunchForm({ ...valid, vaultSharePct: 71 }).vaultSharePct).toBeDefined();
    expect(validateLaunchForm({ ...valid, vaultSharePct: 30 }).vaultSharePct).toBeUndefined();
    expect(validateLaunchForm({ ...valid, vaultSharePct: 70 }).vaultSharePct).toBeUndefined();
  });
});
