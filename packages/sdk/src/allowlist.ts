/**
 * UI-level quote asset allowlist (docs/BRIEF.md §4 and §6).
 *
 * Decimals and token programs verified with a read-only mainnet `getMultipleAccounts`
 * (jsonParsed) at slot 447309061 on 2026-09-15: all eight mints are Token-2022 with 8 decimals
 * and the extensions metadataPointer, permanentDelegate, defaultAccountState,
 * scaledUiAmountConfig, pausableConfig, confidentialTransferMint, transferHook (program null)
 * and tokenMetadata. Names are the on-chain token metadata names.
 *
 * Excluded on purpose: leveraged products (TQQQx) and hyper-volatile names (MSTRx).
 */
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

export type Volatility = "calm" | "volatile";

export interface QuoteAsset {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  volatility: Volatility;
  underlying: string;
}

export const QUOTE_ALLOWLIST: QuoteAsset[] = [
  {
    symbol: "SPYx",
    name: "SP500 xStock",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
    volatility: "calm",
    underlying: "S&P 500 index ETF (SPY)",
  },
  {
    symbol: "QQQx",
    name: "Nasdaq xStock",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    decimals: 8,
    volatility: "calm",
    underlying: "Nasdaq-100 index ETF (QQQ)",
  },
  {
    symbol: "GLDx",
    name: "Gold xStock",
    mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    decimals: 8,
    volatility: "calm",
    underlying: "Gold ETF (GLD)",
  },
  {
    symbol: "NVDAx",
    name: "NVIDIA xStock",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
    volatility: "volatile",
    underlying: "NVIDIA Corp. (NVDA)",
  },
  {
    symbol: "AAPLx",
    name: "Apple xStock",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    decimals: 8,
    volatility: "volatile",
    underlying: "Apple Inc. (AAPL)",
  },
  {
    symbol: "MSFTx",
    name: "Microsoft xStock",
    mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    decimals: 8,
    volatility: "volatile",
    underlying: "Microsoft Corp. (MSFT)",
  },
  {
    symbol: "GOOGLx",
    name: "Alphabet xStock",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    decimals: 8,
    volatility: "volatile",
    underlying: "Alphabet Inc. Class A (GOOGL)",
  },
  {
    symbol: "TSLAx",
    name: "Tesla xStock",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    volatility: "volatile",
    underlying: "Tesla Inc. (TSLA)",
  },
];

/** SPYx, the default quote asset. */
export const DEFAULT_QUOTE_ASSET: QuoteAsset = QUOTE_ALLOWLIST[0]!;

/** Every allowlisted quote mint is a Token-2022 mint. */
export const QUOTE_TOKEN_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;

/** Find an allowlisted quote asset by mint address or symbol (case-insensitive symbol match). */
export function findQuoteAsset(mintOrSymbol: string): QuoteAsset | undefined {
  const key = mintOrSymbol.trim();
  return (
    QUOTE_ALLOWLIST.find((a) => a.mint === key) ??
    QUOTE_ALLOWLIST.find((a) => a.symbol.toLowerCase() === key.toLowerCase())
  );
}

/** True when the mint is on the allowlist. */
export function isAllowlistedQuoteMint(mint: string): boolean {
  return QUOTE_ALLOWLIST.some((a) => a.mint === mint);
}
