/**
 * Public runtime configuration.
 *
 * NEXT_PUBLIC_RPC_URL      RPC endpoint for the wallet adapter connection.
 *                          Defaults to a local mainnet fork (Surfpool) at http://127.0.0.1:8899.
 * NEXT_PUBLIC_DATA_SOURCE  "mock" (default) or "chain". The chain source lands in M4; until then
 *                          "chain" falls back to mock data and the UI says so.
 */
export const DEFAULT_RPC_URL = "http://127.0.0.1:8899";

export const RPC_URL: string = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC_URL;

export type DataSourceKind = "mock" | "chain";

export const DATA_SOURCE: DataSourceKind =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "chain" ? "chain" : "mock";

/** Short network label for the header badge. */
export function networkLabel(url: string): string {
  if (/127\.0\.0\.1|localhost/.test(url)) return "Local fork";
  if (/devnet/.test(url)) return "Devnet";
  if (/mainnet/.test(url)) return "Mainnet";
  return "Custom RPC";
}

/** Base token parameters from docs/BRIEF.md section 4. */
export const BASE_DECIMALS = 6;
export const DEFAULT_THRESHOLD_USD = 1000;
export const DEFAULT_EXIT_FEE_BPS = 200;
export const CURVE_TRADING_FEE_BPS = 100;
export const VAULT_SHARE_MIN = 30;
export const VAULT_SHARE_MAX = 70;
export const VAULT_SHARE_DEFAULT = 50;
