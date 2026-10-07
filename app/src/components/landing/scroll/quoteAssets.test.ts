import { describe, expect, it } from "vitest";
import { QUOTE_ALLOWLIST } from "@stockfloor/sdk";
import { coinLetters, DEFAULT_SYMBOL, findQuoteAsset, QUOTE_ASSETS, quoteAssetLabel } from "./quoteAssets";

describe("QUOTE_ASSETS", () => {
  it("matches the SDK allowlist: symbols, order, calm/volatile and underlying", () => {
    expect(QUOTE_ASSETS.map((a) => a.symbol)).toEqual(QUOTE_ALLOWLIST.map((a) => a.symbol));
    QUOTE_ASSETS.forEach((a, i) => {
      const sdk = QUOTE_ALLOWLIST[i]!;
      expect(a.calm).toBe(sdk.volatility === "calm");
      expect(a.underlying).toBe(sdk.underlying);
    });
  });

  it("defaults to SPYx, the SDK's default quote asset", () => {
    expect(DEFAULT_SYMBOL).toBe(QUOTE_ALLOWLIST[0]!.symbol);
    expect(findQuoteAsset(DEFAULT_SYMBOL)?.tracks).toBe("the S&P 500");
  });

  it("builds coin letters and accessible names", () => {
    expect(coinLetters("SPYx")).toBe("SPY");
    expect(coinLetters("GOOGLx")).toBe("GOO");
    expect(quoteAssetLabel(findQuoteAsset("SPYx")!)).toBe("SPYx, S&P 500 index ETF (SPY)");
    expect(findQuoteAsset("DOGEx")).toBeUndefined();
  });
});
