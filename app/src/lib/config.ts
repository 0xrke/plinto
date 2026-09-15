import { isLoopbackRpcUrl } from "@stockfloor/sdk";

/**
 * Public runtime configuration. `NEXT_PUBLIC_*` values are inlined at build time.
 *
 * NEXT_PUBLIC_RPC_URL        RPC endpoint for reads, the wallet connection and sends.
 *                            Defaults to a local mainnet fork (Surfpool) at http://127.0.0.1:8899.
 * NEXT_PUBLIC_WS_URL         Optional WebSocket endpoint. Default: web3.js derives it (RPC port + 1).
 * NEXT_PUBLIC_DATA_SOURCE    "mock" (default, design work and tests) or "chain" (on-chain launches).
 * NEXT_PUBLIC_ALLOW_MAINNET  "1" is one of the two switches for sending through a non-loopback RPC.
 * STOCKFLOOR_ALLOW_MAINNET   "1" is the other one (the variable the CLI also requires); next.config.ts
 *                            inlines it at build time. Mainnet sends need both (checkpoint C2 only);
 *                            otherwise the app sends only to a loopback surfnet or local validator.
 * NEXT_PUBLIC_PRIORITY_FEE_MICROLAMPORTS  Priority fee per compute unit for app transactions. Default:
 *                            100000 on mainnet, 0 on local clusters.
 */
export const DEFAULT_RPC_URL = "http://127.0.0.1:8899";

export const RPC_URL: string = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC_URL;

export const WS_URL: string | undefined = process.env.NEXT_PUBLIC_WS_URL || undefined;

export type DataSourceKind = "mock" | "chain";

export const DATA_SOURCE: DataSourceKind =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "chain" ? "chain" : "mock";

/** A non-negative integer setting, or undefined when unset or invalid. */
export function parseMicroLamports(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * Cluster settings (see lib/chain/cluster.ts): both mainnet send switches, each alone keeps mainnet
 * sends refused, and the optional priority fee override.
 */
export const CLUSTER_SETTINGS: { allowMainnetFlag: boolean; allowMainnetEnv: string | undefined; priorityFeeMicroLamports?: number } = {
  allowMainnetFlag: process.env.NEXT_PUBLIC_ALLOW_MAINNET === "1",
  allowMainnetEnv: process.env.STOCKFLOOR_ALLOW_MAINNET || undefined,
  priorityFeeMicroLamports: parseMicroLamports(process.env.NEXT_PUBLIC_PRIORITY_FEE_MICROLAMPORTS),
};

/** True when the RPC host is loopback (127.0.0.1, localhost, ::1): a local fork or validator. */
export function isLocalRpcUrl(url: string): boolean {
  return isLoopbackRpcUrl(url);
}

/** The configured RPC is a local cluster. Local-fork helpers (faucet, badge) show only then. */
export const IS_LOCAL_RPC: boolean = isLocalRpcUrl(RPC_URL);

/** Short network label for the header badge, from the parsed host (never a substring match). */
export function networkLabel(url: string): string {
  if (isLocalRpcUrl(url)) return "Local fork";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Custom RPC";
  }
  const labels = host.split(".");
  if (labels.some((l) => l.includes("devnet"))) return "Devnet";
  if (labels.some((l) => l.includes("mainnet"))) return "Mainnet";
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

/** React Query polling intervals for on-chain data (milliseconds). */
export const POLL_MS = {
  launches: 15_000,
  launch: 6_000,
  balances: 10_000,
  markets: 60_000,
} as const;

/** Default slippage for trades (bps). */
export const DEFAULT_SLIPPAGE_BPS = 100;
