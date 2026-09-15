/**
 * Shared helpers for the C2 rehearsal on a LOCAL Surfpool mainnet fork (scripts/e2e/rehearsal.sh).
 *
 * - Every write goes to a loopback surfnet only (`assertLocalRpcUrl` + `connectSurfnet` from
 *   scripts/surfpool/lib/surfnet.ts: loopback host AND getVersion.surfnet-version).
 * - Mainnet is used strictly read-only through `mainnetRead`, which only accepts an allowlist of
 *   read methods (no sendTransaction, no airdrop, no simulate).
 * - Keypairs are only loaded from the repo keys/ directory (`loadRepoKeypair`).
 *
 * Run with the SDK's tsx (it resolves @solana/web3.js to the same instance as the SDK and the
 * Surfpool helpers): packages/sdk/node_modules/.bin/tsx scripts/e2e/<script>.ts ...
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Web3 from "@solana/web3.js";
import {
  assertLocalRpcUrl,
  connectSurfnet,
  loadRepoKeypair,
  rpcCall,
} from "../surfpool/lib/surfnet.ts";

export { assertLocalRpcUrl, connectSurfnet, loadRepoKeypair, rpcCall };

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const requireFromSdk = createRequire(
  join(REPO_ROOT, "packages", "sdk", "package.json"),
);
export const web3 = requireFromSdk("@solana/web3.js") as typeof Web3;

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const SPYX_MINT = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111";

export const PROGRAM_NAMES: Record<string, string> = {
  "98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA": "stockfloor",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "DBC",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "DAMM v2",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "ATA",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Token Metadata",
  "11111111111111111111111111111111": "System",
  ComputeBudget111111111111111111111111111111: "ComputeBudget",
  BPFLoaderUpgradeab1e11111111111111111111111: "BPF Upgradeable Loader",
  ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S: "Program Metadata",
};

export const programName = (id: string) => PROGRAM_NAMES[id] ?? id;

// ------------------------------------------------------------------ mainnet: read-only

const MAINNET_READ_METHODS = new Set([
  "getSignatureStatuses",
  "getMultipleAccounts",
  "getAccountInfo",
  "getMinimumBalanceForRentExemption",
  "getGenesisHash",
  "getBalance",
]);

/** Read-only JSON-RPC call to mainnet (MAINNET_READ_RPC_URL or the public endpoint), with 429 retries. */
export async function mainnetRead<T>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  if (!MAINNET_READ_METHODS.has(method))
    throw new Error(
      `mainnetRead: ${method} is not an allowed read-only method`,
    );
  const url =
    process.env.MAINNET_READ_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const body = (await res.json()) as {
      result?: T;
      error?: { message: string };
    };
    if (body.error) throw new Error(`mainnet ${method}: ${body.error.message}`);
    return body.result as T;
  }
  throw new Error(`mainnet ${method}: rate limited`);
}

/** Jupiter Price V3 (public, read-only). */
export async function jupiterPrices(
  mints: string[],
): Promise<Record<string, { usdPrice: number } | undefined>> {
  const res = await fetch(
    `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`,
  );
  if (!res.ok) throw new Error(`Jupiter price: HTTP ${res.status}`);
  return (await res.json()) as Record<string, { usdPrice: number } | undefined>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ rent

export interface RentParams {
  lamportsPerByteYear: bigint;
  exemptionThreshold: number;
  burnPercent: number;
}

/** Rent sysvar layout: u64 lamports_per_byte_year, f64 exemption_threshold, u8 burn_percent. */
export function decodeRent(data: Uint8Array): RentParams {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    lamportsPerByteYear: view.getBigUint64(0, true),
    exemptionThreshold: view.getFloat64(8, true),
    burnPercent: view.getUint8(16),
  };
}

/** Rent-exempt minimum for `space` bytes (Agave: (128 + space) * lamports_per_byte_year * threshold). */
export function rentExempt(rent: RentParams, space: number): bigint {
  return BigInt(
    Math.floor(
      Number((128n + BigInt(space)) * rent.lamportsPerByteYear) *
        rent.exemptionThreshold,
    ),
  );
}

export async function readRentSysvar(
  get: (method: string, params: unknown[]) => Promise<unknown>,
): Promise<{ raw: string; params: RentParams }> {
  const res = (await get("getAccountInfo", [
    RENT_SYSVAR,
    { encoding: "base64" },
  ])) as { value: { data: [string, string] } | null };
  if (!res.value) throw new Error("rent sysvar not found");
  const bytes = Buffer.from(res.value.data[0], "base64");
  return { raw: bytes.toString("base64"), params: decodeRent(bytes) };
}

// ------------------------------------------------------------------ JSON files

export const jsonReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint"
    ? v.toString()
    : v instanceof web3.PublicKey
      ? v.toBase58()
      : v;

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, jsonReplacer, 2) + "\n");
  renameSync(tmp, path);
}

export function runDir(): string {
  const dir = process.env.E2E_RUN_DIR;
  if (!dir || !existsSync(dir))
    throw new Error("E2E_RUN_DIR is not set or does not exist");
  return dir;
}

export function localRpcUrl(): string {
  const url = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8899";
  assertLocalRpcUrl(url);
  return url;
}

/** Minimal `--flag value` / `--switch` parser. */
export function parseFlags(
  argv: string[],
  switches: string[] = [],
): { positional: string[]; flags: Record<string, string | true> } {
  const out: { positional: string[]; flags: Record<string, string | true> } = {
    positional: [],
    flags: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      out.positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (switches.includes(name)) {
      out.flags[name] = true;
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    out.flags[name] = v;
    i++;
  }
  return out;
}

export function flag(
  f: Record<string, string | true>,
  name: string,
): string | undefined {
  const v = f[name];
  return typeof v === "string" ? v : undefined;
}

export function main(fn: () => Promise<void>): void {
  fn().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      const logs = (e as { logs?: string[] })?.logs;
      if (Array.isArray(logs)) console.error(logs.slice(-15).join("\n"));
      process.exit(1);
    },
  );
}

/** Integer division rounding up. */
export const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function rawToUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const lamportsToSol = (l: bigint | number) => Number(l) / 1e9;
