/**
 * Shared helpers for the local Surfpool scripts: a localhost-only guard, a JSON-RPC client for
 * Surfpool cheatcodes, repo keypair loading and small account-layout helpers.
 *
 * Dependencies are resolved from the @stockfloor/tests package (scripts/ has no package.json),
 * so the scripts share one @solana/web3.js instance with the fork harness in tests/src.
 * Run the scripts with scripts/surfpool/run.sh <script>.ts [args].
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Web3 from "../../../tests/node_modules/@solana/web3.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const KEYS_DIR = join(REPO_ROOT, "keys");

const requireFromTests = createRequire(join(REPO_ROOT, "tests", "package.json"));
export const web3 = requireFromTests("@solana/web3.js") as typeof Web3;

export const TOKEN_PROGRAM_ID = new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new web3.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const BPF_LOADER_UPGRADEABLE_ID = new web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

// ------------------------------------------------------------------ localhost guard

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Throws unless `url` is an http(s) URL on the loopback interface. Every script calls this before
 * it opens a connection, so no cheatcode or transaction can reach a remote cluster.
 */
export function assertLocalRpcUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`refusing to run: invalid RPC URL ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`refusing to run: RPC URL must be http(s), got ${parsed.protocol}`);
  }
  if (!LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(`refusing to run: RPC host ${parsed.hostname} is not localhost/127.0.0.1 (local Surfpool only)`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("refusing to run: RPC URL must not carry credentials");
  }
  return parsed;
}

/** `--rpc <url>`, else $SURFPOOL_RPC_URL, else http://127.0.0.1:$RPC_PORT (default 8899). Always guarded. */
export function resolveRpcUrl(args: CliArgs): string {
  const url =
    (typeof args.flags.rpc === "string" ? args.flags.rpc : undefined) ??
    process.env.SURFPOOL_RPC_URL ??
    `http://127.0.0.1:${process.env.RPC_PORT ?? "8899"}`;
  assertLocalRpcUrl(url);
  return url;
}

// ------------------------------------------------------------------ JSON-RPC

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | undefined,
    message: string,
    readonly data?: unknown,
  ) {
    super(`${method}: ${message}`);
  }
}

let rpcId = 0;

export async function rpcCall<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  assertLocalRpcUrl(url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new RpcError(method, res.status, `HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (body.error) throw new RpcError(method, body.error.code, body.error.message, body.error.data);
  return body.result as T;
}

export interface SurfnetVersion {
  "surfnet-version": string;
  "solana-core": string;
  "feature-set": number;
}

/** Guards the URL, then requires a Surfpool surfnet (getVersion has `surfnet-version`) that is healthy. */
export async function connectSurfnet(url: string): Promise<{ connection: Web3.Connection; version: SurfnetVersion }> {
  assertLocalRpcUrl(url);
  let version: SurfnetVersion;
  try {
    version = await rpcCall<SurfnetVersion>(url, "getVersion");
  } catch (e) {
    throw new Error(`no surfnet at ${url} (start one with scripts/surfpool/start.sh): ${(e as Error).message}`);
  }
  if (!version["surfnet-version"]) {
    throw new Error(`${url} is not a Surfpool surfnet (getVersion has no surfnet-version); cheatcodes need Surfpool`);
  }
  const health = await rpcCall<string>(url, "getHealth");
  if (health !== "ok") throw new Error(`surfnet at ${url} is not healthy: ${health}`);
  // web3.js derives the WebSocket endpoint as RPC port + 1 (start.sh's default WS_PORT); honour an
  // explicit local SURFPOOL_WS_URL otherwise.
  const ws = process.env.SURFPOOL_WS_URL;
  if (ws) {
    const wsUrl = new URL(ws);
    if (!LOCAL_HOSTNAMES.has(wsUrl.hostname)) throw new Error(`refusing to run: SURFPOOL_WS_URL host ${wsUrl.hostname} is not local`);
  }
  return { connection: new web3.Connection(url, { commitment: "confirmed", wsEndpoint: ws || undefined }), version };
}

// ------------------------------------------------------------------ cheatcodes

export interface AccountUpdate {
  lamports?: number | bigint;
  /** Full account data (Surfpool expects hex). */
  data?: Uint8Array;
  owner?: Web3.PublicKey;
  executable?: boolean;
  rentEpoch?: number;
}

/** surfnet_setAccount(pubkey, { lamports?, data? (hex), owner?, executable?, rent_epoch? }) */
export async function setAccount(url: string, pubkey: Web3.PublicKey, u: AccountUpdate): Promise<void> {
  const update: Record<string, unknown> = {};
  if (u.lamports !== undefined) update.lamports = Number(u.lamports);
  if (u.data !== undefined) update.data = Buffer.from(u.data).toString("hex");
  if (u.owner !== undefined) update.owner = u.owner.toBase58();
  if (u.executable !== undefined) update.executable = u.executable;
  if (u.rentEpoch !== undefined) update.rent_epoch = u.rentEpoch;
  if (update.lamports !== undefined && !Number.isSafeInteger(update.lamports)) {
    throw new Error(`lamports ${u.lamports} exceed the JSON safe integer range`);
  }
  await rpcCall(url, "surfnet_setAccount", [pubkey.toBase58(), update]);
}

/**
 * surfnet_writeProgram(programId, hexChunk, offset, authority): creates/updates the
 * BPF upgradeable program account and its programdata account, writing `elf` at `offset`.
 */
export async function writeProgram(
  url: string,
  programId: Web3.PublicKey,
  elf: Uint8Array,
  authority: Web3.PublicKey,
  chunkBytes = 2 * 1024 * 1024,
): Promise<number> {
  let chunks = 0;
  for (let offset = 0; offset < elf.length; offset += chunkBytes) {
    const chunk = Buffer.from(elf.subarray(offset, Math.min(elf.length, offset + chunkBytes)));
    await rpcCall(url, "surfnet_writeProgram", [programId.toBase58(), chunk.toString("hex"), offset, authority.toBase58()]);
    chunks++;
  }
  return chunks;
}

// ------------------------------------------------------------------ keypairs

/** Load a keypair JSON that must live under keys/ (never a user wallet such as ~/.config/solana/id.json). */
export function loadRepoKeypair(path: string): Web3.Keypair {
  const abs = isAbsolute(path) ? path : join(REPO_ROOT, path);
  if (!existsSync(abs)) throw new Error(`keypair not found: ${abs}`);
  const real = realpathSync(abs);
  const keysReal = realpathSync(KEYS_DIR);
  if (!real.startsWith(keysReal + sep)) {
    throw new Error(`refusing keypair outside ${KEYS_DIR}: ${real}`);
  }
  const bytes = JSON.parse(readFileSync(real, "utf8")) as number[];
  return web3.Keypair.fromSecretKey(Uint8Array.from(bytes));
}

// ------------------------------------------------------------------ token helpers

export function getAta(owner: Web3.PublicKey, mint: Web3.PublicKey, tokenProgram: Web3.PublicKey): Web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/** ATA program CreateIdempotent (instruction 1); the payer may differ from the owner. */
export function createAtaIdempotentIx(
  payer: Web3.PublicKey,
  owner: Web3.PublicKey,
  mint: Web3.PublicKey,
  tokenProgram: Web3.PublicKey,
): Web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: getAta(owner, mint, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** Base token account layout (SPL Token and Token-2022): mint 0..32, owner 32..64, amount 64..72. */
export const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
/** Base mint layout: supply 36..44, decimals 44. */
export const MINT_SUPPLY_OFFSET = 36;
export const MINT_DECIMALS_OFFSET = 44;

// ------------------------------------------------------------------ CLI args

export interface CliArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Minimal `--flag value` / `--flag=value` / `--switch` parser. */
export function parseArgs(argv: string[], switches: string[] = []): CliArgs {
  const out: CliArgs = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out.positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      out.flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (switches.includes(a.slice(2))) {
      out.flags[a.slice(2)] = true;
    } else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`missing value for ${a}`);
      out.flags[a.slice(2)] = v;
      i++;
    }
  }
  return out;
}

export function flagString(args: CliArgs, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse a decimal UI amount into raw units without floating point. */
export function uiToRaw(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`invalid amount ${JSON.stringify(amount)}`);
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) throw new Error(`amount ${amount} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Run `main` when the file is the process entry point. */
export function runMain(importMetaUrl: string, main: () => Promise<void>): void {
  const entry = process.argv[1] ? resolve(process.argv[1]) : "";
  if (entry && resolve(fileURLToPath(importMetaUrl)) === entry) {
    main().catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
  }
}
