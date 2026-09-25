import {
  CREATOR_GRADUATION_BONUS_BPS,
  DEFAULT_VAULT_SHARE_PCT,
  LP_FEE_CREATOR_BPS,
  LP_FEE_PLATFORM_BPS,
  MIN_THRESHOLD_USD,
  PLATFORM_GRADUATION_FEE_BPS,
  STOCKFLOOR_DBC_DEFAULTS,
  VAULT_SHARE_MAX_PCT,
  VAULT_SHARE_MIN_PCT,
  isLoopbackRpcUrl,
  poolSharePctForVaultShare,
} from "@stockfloor/sdk";

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
 * NEXT_PUBLIC_SITE_URL       Public origin of this deployment. Used as the metadata base for link
 *                            previews (Open Graph / Twitter cards).
 * NEXT_PUBLIC_REPO_URL       Source repository (https). When set, the footer links to the code, the
 *                            architecture document and the security model.
 * NEXT_PUBLIC_LIVE_APP_URL   Where the chain-connected deployment lives. Shown in the demo-data
 *                            banner of a preview build.
 * NEXT_PUBLIC_DEMO_THRESHOLDS "1" switches the create form to the demo threshold policy: quick picks
 *                            $50 / $100 / $1,000 (default $1,000) and a minimum of $1 (the SDK's
 *                            MIN_THRESHOLD_USD), for cheap demo launches. Unset: quick picks
 *                            $10,000 (default) / $25,000 / $50,000 and a minimum of $10,000. The
 *                            maximum is $100,000 either way. UI-level only: the program has no USD
 *                            oracle and accepts any threshold the DBC config does.
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

/** An https URL from the environment, or undefined. Never a relative or non-https value. */
function httpsEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value.replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/** Public origin of this deployment (link previews). Vercel's own value is used when nothing is set. */
export const SITE_URL: string | undefined =
  httpsEnv(process.env.NEXT_PUBLIC_SITE_URL) ??
  httpsEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);

/** Source repository, for the footer links. Undefined hides them rather than guessing a URL. */
export const REPO_URL: string | undefined = httpsEnv(process.env.NEXT_PUBLIC_REPO_URL);

/** A file in the repository (default branch), or undefined when the repository is not configured. */
export function repoFileUrl(path: string): string | undefined {
  return REPO_URL ? `${REPO_URL}/blob/main/${path}` : undefined;
}

/** The chain-connected deployment, named by a preview build's demo-data banner. */
export const LIVE_APP_URL: string | undefined = httpsEnv(process.env.NEXT_PUBLIC_LIVE_APP_URL);

/** Base token parameters from docs/BRIEF.md section 4. */
export const BASE_DECIMALS = 6;

/** Graduation-threshold rules of the create form (docs/DECISIONS.md D12). */
export interface ThresholdPolicy {
  /** The demo policy (`NEXT_PUBLIC_DEMO_THRESHOLDS=1`). */
  demo: boolean;
  minUsd: number;
  maxUsd: number;
  defaultUsd: number;
  /** Quick picks, in the order the form shows them. */
  presetsUsd: readonly number[];
}

/**
 * Upper bound of the threshold field in both policies. The chain accepts far more (the real limit is
 * the raw u64 threshold, checked by the SDK against the live quote price), but a launch this size is
 * not a plausible xStock presale, and an unbounded field turns one extra zero into a 10x raise.
 */
export const THRESHOLD_MAX_USD = 100_000;

/**
 * Normal: min $10,000, picks $10,000 (default) / $25,000 / $50,000. Demo: the SDK minimum ($1) and the
 * old picks $50 / $100 / $1,000 (default $1,000); $50 is the C2 mainnet demo threshold
 * (docs/research/surfpool-e2e.md §3).
 */
export function thresholdPolicy(demo: boolean): ThresholdPolicy {
  return demo
    ? { demo: true, minUsd: MIN_THRESHOLD_USD, maxUsd: THRESHOLD_MAX_USD, defaultUsd: 1_000, presetsUsd: [50, 100, 1_000] }
    : { demo: false, minUsd: 10_000, maxUsd: THRESHOLD_MAX_USD, defaultUsd: 10_000, presetsUsd: [10_000, 25_000, 50_000] };
}

/** Only the exact value "1" turns the demo thresholds on. */
export function isDemoThresholds(value: string | undefined): boolean {
  return value === "1";
}

export const DEMO_THRESHOLDS: boolean = isDemoThresholds(process.env.NEXT_PUBLIC_DEMO_THRESHOLDS);
export const THRESHOLD_POLICY: ThresholdPolicy = thresholdPolicy(DEMO_THRESHOLDS);

export const DEFAULT_EXIT_FEE_BPS = 200;

/** Vault share of the raise, chosen by the creator (SDK bounds). The pool gets `90 - vault share`. */
export const VAULT_SHARE_MIN = VAULT_SHARE_MIN_PCT;
export const VAULT_SHARE_MAX = VAULT_SHARE_MAX_PCT;
export const VAULT_SHARE_DEFAULT = DEFAULT_VAULT_SHARE_PCT;

/** Share of the raise that seeds the DAMM v2 pool for a vault share: `90 - vault share` (30..60). */
export function poolSharePct(vaultSharePct: number): number {
  return poolSharePctForVaultShare(vaultSharePct);
}

/** Presale (DBC curve) trading fee of every new launch: 0.25%, DBC's minimum. */
export const CURVE_TRADING_FEE_BPS: number = STOCKFLOOR_DBC_DEFAULTS.curveTradingFeeBps;
/** DAMM v2 pool fee after graduation: 1%, dynamic fee off. */
export const MIGRATED_POOL_FEE_BPS: number = STOCKFLOOR_DBC_DEFAULTS.migratedPoolFeeBps;
/** Meteora's protocol share of every DBC and DAMM v2 trading fee. */
export const METEORA_PROTOCOL_FEE_PCT = 20;
/** Paid out of the raise at graduation, as a share of the threshold. */
export const PLATFORM_GRADUATION_FEE_PCT = PLATFORM_GRADUATION_FEE_BPS / 100;
export const CREATOR_GRADUATION_BONUS_PCT = CREATOR_GRADUATION_BONUS_BPS / 100;
/** Split of the pool's trading fees after Meteora's share (the floor vault gets the rest). */
export const LP_FEE_SPLIT_PCT = {
  creator: LP_FEE_CREATOR_BPS / 100,
  floor: 100 - LP_FEE_CREATOR_BPS / 100 - LP_FEE_PLATFORM_BPS / 100,
  platform: LP_FEE_PLATFORM_BPS / 100,
} as const;

/** One sentence per fee of a launch (launch v3), for the create form, the preview and the token page. */
export const FEE_COPY = {
  presale: `Presale: a ${CURVE_TRADING_FEE_BPS / 100}% curve trading fee. Meteora keeps ${METEORA_PROTOCOL_FEE_PCT}% and the rest goes to the StockFloor platform, whether or not the presale graduates. The creator and the vault get none of it.`,
  graduation: `Graduation: platform ${PLATFORM_GRADUATION_FEE_PCT}% and creator ${CREATOR_GRADUATION_BONUS_PCT}% of the raise (a one-off bonus). The other ${100 - PLATFORM_GRADUATION_FEE_PCT - CREATOR_GRADUATION_BONUS_PCT}% splits between the floor vault (the vault share) and the locked pool.`,
  trading: `Trading: a ${MIGRATED_POOL_FEE_BPS / 100}% pool fee. After Meteora's ${METEORA_PROTOCOL_FEE_PCT}%, creator ${LP_FEE_SPLIT_PCT.creator}%, floor vault ${LP_FEE_SPLIT_PCT.floor}%, platform ${LP_FEE_SPLIT_PCT.platform}%.`,
  exit: `Exit: a ${DEFAULT_EXIT_FEE_BPS / 100}% fee on redemption stays in the floor vault and raises the floor.`,
} as const;

/** React Query polling intervals for on-chain data (milliseconds). */
export const POLL_MS = {
  launches: 15_000,
  launch: 6_000,
  balances: 10_000,
  markets: 60_000,
} as const;

/** Default slippage for trades (bps). */
export const DEFAULT_SLIPPAGE_BPS = 100;
