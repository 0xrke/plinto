/**
 * Launch sessions for `create-launch`: everything needed to finish a launch after a failed or
 * interrupted run, written BEFORE the first transaction is sent.
 *
 * A launch spans two or three transactions and two throwaway keypairs: the DBC config (signs tx1)
 * and the base mint (signs the pool creation). `create_launch` commits the base mint in tx1, so if
 * the process dies after tx1 without the base-mint keypair, the Launch can never get its DBC pool.
 * The session file keeps both secret keys and the exact launch input, so `--resume <file>` rebuilds
 * the same transactions and sends only what is not on chain yet.
 *
 * Session files hold secret keys: they are written with mode 0600 and only inside the repository
 * `keys/` directory (gitignored) or a test temp directory, with the same path rules as keypairs.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findQuoteAsset, type BuiltLaunch, type LaunchInput } from "../../src";
import { REPO_KEYS_DIR, resolveKeypairPath } from "../../src/node";

export const LAUNCH_SESSION_KIND = "stockfloor-launch-session";

export interface LaunchSession {
  kind: typeof LAUNCH_SESSION_KIND;
  version: 1;
  createdAt: string;
  creator: string;
  input: {
    name: string;
    symbol: string;
    uri: string;
    quoteMint: string;
    quotePriceUsd: number;
    quoteMultiplier: number;
    preset: LaunchInput["preset"];
    vaultSharePct: number;
    thresholdUsd: number;
    exitFeeBps: number;
  };
  firstBuy: { quoteAmountRaw: string; slippageBps: number } | null;
  configSecretKey: number[];
  baseMintSecretKey: number[];
  addresses: { launch: string; config: string; baseMint: string; pool: string; vault: string };
}

/** Default session path: `keys/launches/<config>.json`. */
export function defaultSessionPath(config: PublicKey): string {
  return join(REPO_KEYS_DIR, "launches", `${config.toBase58()}.json`);
}

export function newLaunchSession(a: {
  creator: PublicKey;
  input: LaunchInput;
  firstBuy: { quoteAmount: bigint; slippageBps: number } | null;
  configKeypair: Keypair;
  baseMintKeypair: Keypair;
  addresses: BuiltLaunch["addresses"];
  now?: Date;
}): LaunchSession {
  const i = a.input;
  return {
    kind: LAUNCH_SESSION_KIND,
    version: 1,
    createdAt: (a.now ?? new Date()).toISOString(),
    creator: a.creator.toBase58(),
    input: {
      name: i.name,
      symbol: i.symbol,
      uri: i.uri,
      quoteMint: i.quote.mint,
      quotePriceUsd: i.quotePriceUsd,
      quoteMultiplier: i.quoteMultiplier,
      preset: i.preset,
      vaultSharePct: i.vaultSharePct,
      thresholdUsd: i.thresholdUsd ?? 1000,
      exitFeeBps: i.exitFeeBps ?? 200,
    },
    firstBuy: a.firstBuy ? { quoteAmountRaw: a.firstBuy.quoteAmount.toString(), slippageBps: a.firstBuy.slippageBps } : null,
    configSecretKey: Array.from(a.configKeypair.secretKey),
    baseMintSecretKey: Array.from(a.baseMintKeypair.secretKey),
    addresses: {
      launch: a.addresses.launch.toBase58(),
      config: a.addresses.config.toBase58(),
      baseMint: a.addresses.baseMint.toBase58(),
      pool: a.addresses.pool.toBase58(),
      vault: a.addresses.vault.toBase58(),
    },
  };
}

/** Write a session (0600) after the keys/ path check; refuses to overwrite a different launch. */
export function writeLaunchSession(path: string, session: LaunchSession, opts: { repoKeysDir?: string } = {}): string {
  const target = resolveKeypairPath(path, opts);
  if (existsSync(target)) {
    const prev = JSON.parse(readFileSync(target, "utf8")) as Partial<LaunchSession>;
    if (prev.addresses?.config !== session.addresses.config) {
      throw new Error(`refusing to overwrite ${target}: it holds the session of another launch (config ${prev.addresses?.config})`);
    }
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, JSON.stringify(session, null, 2) + "\n", { mode: 0o600 });
  return target;
}

export interface LoadedLaunchSession {
  session: LaunchSession;
  input: LaunchInput;
  creator: PublicKey;
  configKeypair: Keypair;
  baseMintKeypair: Keypair;
  firstBuy: { quoteAmount: bigint; slippageBps: number } | null;
}

/** Read and validate a session file (keys/ path rules, keypairs match the recorded addresses). */
export function readLaunchSession(path: string, opts: { repoKeysDir?: string } = {}): LoadedLaunchSession {
  const target = resolveKeypairPath(path, opts);
  const session = JSON.parse(readFileSync(target, "utf8")) as LaunchSession;
  if (session.kind !== LAUNCH_SESSION_KIND || session.version !== 1) throw new Error(`${target} is not a StockFloor launch session`);
  const configKeypair = Keypair.fromSecretKey(Uint8Array.from(session.configSecretKey));
  const baseMintKeypair = Keypair.fromSecretKey(Uint8Array.from(session.baseMintSecretKey));
  if (configKeypair.publicKey.toBase58() !== session.addresses.config) throw new Error(`${target}: config keypair does not match ${session.addresses.config}`);
  if (baseMintKeypair.publicKey.toBase58() !== session.addresses.baseMint) throw new Error(`${target}: base mint keypair does not match ${session.addresses.baseMint}`);
  const quote = findQuoteAsset(session.input.quoteMint);
  if (!quote) throw new Error(`${target}: quote mint ${session.input.quoteMint} is not on the allowlist`);
  const { quoteMint: _q, ...rest } = session.input;
  return {
    session,
    input: { ...rest, quote },
    creator: new PublicKey(session.creator),
    configKeypair,
    baseMintKeypair,
    firstBuy: session.firstBuy ? { quoteAmount: BigInt(session.firstBuy.quoteAmountRaw), slippageBps: session.firstBuy.slippageBps } : null,
  };
}

/** What is already on chain for a launch (read before sending anything). */
export interface LaunchChainProgress {
  /** The stockfloor Launch account exists (tx1 landed: DBC config + create_launch are atomic). */
  launchExists: boolean;
  /** The DBC pool of the committed base mint exists. */
  poolExists: boolean;
  /** `Launch.pool` is set (register_pool ran; atomic with the pool creation in tx2). */
  poolRegistered: boolean;
  /** Creator base token balance (0 when the ATA does not exist). */
  creatorBaseBalance: bigint;
}

export interface LaunchStepDecision {
  label: string;
  send: boolean;
  reason: string;
}

/**
 * Which planned launch transactions still need to be sent. Pure; the labels are those of
 * `buildLaunchTransactions`. Throws on states the launch transactions cannot produce.
 */
export function pendingLaunchSteps(labels: string[], p: LaunchChainProgress): LaunchStepDecision[] {
  if (!p.launchExists && (p.poolExists || p.poolRegistered)) {
    throw new Error("the DBC pool exists but the Launch does not: not a state this launch's transactions produce");
  }
  if (p.poolExists && !p.poolRegistered) {
    throw new Error("the DBC pool exists but is not registered: run `crank` (register_pool is permissionless), then `buy`");
  }
  return labels.map((label) => {
    if (label === "create_config+create_launch") {
      return p.launchExists ? { label, send: false, reason: "Launch account exists" } : { label, send: true, reason: "Launch account missing" };
    }
    if (label.startsWith("create_pool+register_pool")) {
      return p.poolExists ? { label, send: false, reason: "DBC pool exists and is registered" } : { label, send: true, reason: "DBC pool missing" };
    }
    if (label === "first_buy") {
      if (p.creatorBaseBalance > 0n) return { label, send: false, reason: "creator already holds base tokens" };
      return { label, send: true, reason: "creator holds no base tokens" };
    }
    throw new Error(`unknown launch transaction ${label}`);
  });
}
