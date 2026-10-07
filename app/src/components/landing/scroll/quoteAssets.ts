/*
 * The landing's copy of the quote allowlist: labels only, no mints. The client island must not import
 * the SDK barrel (web3.js, bn.js), so this list is kept by hand and quoteAssets.test.ts checks it
 * against `QUOTE_ALLOWLIST` (symbols, order, calm/volatile, underlying).
 */

export interface QuoteAsset {
  symbol: string;
  /** What the stock token follows, for "Tracks {tracks}." */
  tracks: string;
  /** The allowlist's underlying, e.g. "S&P 500 index ETF (SPY)". */
  underlying: string;
  calm: boolean;
}

export const QUOTE_ASSETS: readonly QuoteAsset[] = [
  { symbol: "SPYx", tracks: "the S&P 500", underlying: "S&P 500 index ETF (SPY)", calm: true },
  { symbol: "QQQx", tracks: "the Nasdaq-100", underlying: "Nasdaq-100 index ETF (QQQ)", calm: true },
  { symbol: "GLDx", tracks: "gold", underlying: "Gold ETF (GLD)", calm: true },
  { symbol: "NVDAx", tracks: "NVIDIA", underlying: "NVIDIA Corp. (NVDA)", calm: false },
  { symbol: "AAPLx", tracks: "Apple", underlying: "Apple Inc. (AAPL)", calm: false },
  { symbol: "MSFTx", tracks: "Microsoft", underlying: "Microsoft Corp. (MSFT)", calm: false },
  { symbol: "GOOGLx", tracks: "Alphabet", underlying: "Alphabet Inc. Class A (GOOGL)", calm: false },
  { symbol: "TSLAx", tracks: "Tesla", underlying: "Tesla Inc. (TSLA)", calm: false },
];

export const DEFAULT_SYMBOL = "SPYx";

/** Up to three letters for a coin badge: "SPYx" → "SPY", "GOOGLx" → "GOO". */
export const coinLetters = (s: string) => s.replace(/x$/, "").slice(0, 3);

/** The asset for a symbol (exact match), or undefined. */
export const findQuoteAsset = (symbol: string): QuoteAsset | undefined => QUOTE_ASSETS.find((a) => a.symbol === symbol);

/** The accessible name of a pick, e.g. "SPYx, S&P 500 index ETF (SPY)". */
export const quoteAssetLabel = (a: QuoteAsset) => `${a.symbol}, ${a.underlying}`;
