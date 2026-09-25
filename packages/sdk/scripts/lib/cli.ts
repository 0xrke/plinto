/**
 * Shared CLI plumbing for the SDK scripts: argument parsing, the mainnet send guard, keypair loading
 * (repo keys/ only), the ConnectionSender, launch lookup and printing.
 *
 * Every script that sends transactions calls `sendingContext()`, which refuses to continue unless
 * `evaluateSendGuard` allows the RPC (see src/guard.ts for the exact rules), and re-checks the guard
 * before every transaction.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ConnectionSender,
  evaluateSendGuard,
  fetchLaunchState,
  findQuoteAsset,
  isLoopbackRpcUrl,
  probeCluster,
  type LaunchRef,
  type LaunchState,
  type SendGuardDecision,
  vaultSharePctFromMigrationFeePct,
} from "../../src";
import { loadKeypair } from "../../src/node";

export const DEFAULT_RPC = "http://127.0.0.1:8899";

export interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

/** `--flag value`, `--flag=value` and boolean `--switch` (listed in `switches`). */
export function parseArgs(argv: string[], switches: readonly string[] = []): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const name = a.slice(2);
    if (switches.includes(name)) {
      flags.set(name, true);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new CliError(`missing value for --${name}`);
    flags.set(name, v);
    i++;
  }
  return { positional, flags };
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function str(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

export function need(args: Args, name: string): string {
  const v = str(args, name);
  if (v === undefined) throw new CliError(`--${name} is required`);
  return v;
}

export function bool(args: Args, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === "true";
}

export function int(args: Args, name: string, fallback?: number): number | undefined {
  const v = str(args, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new CliError(`--${name} must be an integer`);
  return n;
}

/** Decimal token units to raw (`raw / 10^decimals`; the ScaledUiAmount multiplier is not applied). */
export function unitsToRaw(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new CliError(`invalid amount ${JSON.stringify(value)}`);
  const [whole, frac = ""] = value.split(".");
  if (frac.length > decimals) throw new CliError(`amount ${value} has more than ${decimals} decimals`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function rawToUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** `--amount <units>` or `--raw <raw>`. */
export function amountArg(args: Args, decimals: number): bigint | undefined {
  const raw = str(args, "raw");
  if (raw !== undefined) {
    if (!/^\d+$/.test(raw)) throw new CliError("--raw must be a non-negative integer");
    return BigInt(raw);
  }
  const units = str(args, "amount");
  return units === undefined ? undefined : unitsToRaw(units, decimals);
}

export function rpcUrl(args: Args): string {
  return str(args, "rpc") ?? DEFAULT_RPC;
}

/**
 * The RPC endpoint for logs: scheme, host and port only. Provider URLs carry API keys in the query
 * string (`?api-key=`) or the path (`/v2/<key>`), and CLI output may be recorded for the demo.
 */
export function rpcDisplay(url: string): string {
  try {
    const u = new URL(url);
    const hidden = u.pathname.replace(/\/+$/, "") !== "" || u.search !== "" || u.username !== "" || u.password !== "";
    return hidden ? `${u.origin}/…` : u.origin;
  } catch {
    return "<invalid RPC URL>";
  }
}

export function connectionFor(url: string): Connection {
  return new Connection(url, { commitment: "confirmed" });
}

export async function guardDecision(args: Args): Promise<SendGuardDecision> {
  const url = rpcUrl(args);
  const input = { rpcUrl: url, allowMainnetFlag: bool(args, "allow-mainnet"), allowMainnetEnv: process.env.STOCKFLOOR_ALLOW_MAINNET };
  // Without the full override a non-loopback RPC is refused outright: do not even probe it.
  const overridden = input.allowMainnetFlag && input.allowMainnetEnv === "1";
  const probe = overridden || isLoopbackRpcUrl(url) ? await probeCluster(url) : { genesisHash: null, surfnetVersion: null, surfnetMethodOk: false };
  return evaluateSendGuard({ ...input, probe });
}

export interface SendingContext {
  rpcUrl: string;
  connection: Connection;
  sender: ConnectionSender;
  decision: Extract<SendGuardDecision, { allowed: true }>;
}

/** Guard + keypair + sender for commands that send transactions. */
export async function sendingContext(args: Args): Promise<SendingContext> {
  const url = rpcUrl(args);
  const decision = await guardDecision(args);
  if (!decision.allowed) throw new CliError(decision.reason);
  const keypair = loadKeypair(need(args, "keypair"));
  const connection = connectionFor(url);
  let lastCheck = Date.now();
  const sender = new ConnectionSender(connection, keypair, {
    computeUnitPriceMicroLamports: int(args, "priority-fee"),
    beforeSend: async ({ label }) => {
      // Re-check the cluster at most every 30 s (long-running crank loops).
      if (Date.now() - lastCheck < 30_000) return;
      const again = await guardDecision(args);
      if (!again.allowed) throw new CliError(`${label ?? "transaction"}: ${again.reason}`);
      lastCheck = Date.now();
    },
  });
  log(`rpc ${rpcDisplay(url)} (${decision.mode}: ${decision.reason})`);
  log(`fee payer ${keypair.publicKey.toBase58()}`);
  return { rpcUrl: url, connection, sender, decision };
}

/** A read-only sender-like reader (no keypair needed): ConnectionSender with a throwaway signer that never signs. */
export function readerFor(args: Args): ConnectionSender {
  const connection = connectionFor(rpcUrl(args));
  return new ConnectionSender(connection, { publicKey: PublicKey.default, signTransaction: async () => { throw new CliError("read-only command"); } });
}

export function launchRef(args: Args): LaunchRef | null {
  const launch = str(args, "launch");
  const mint = str(args, "mint");
  const config = str(args, "config");
  const set = [launch, mint, config].filter((x) => x !== undefined).length;
  if (set > 1) throw new CliError("pass only one of --launch, --mint, --config");
  if (launch) return { launch: new PublicKey(launch) };
  if (mint) return { baseMint: new PublicKey(mint) };
  if (config) return { config: new PublicKey(config) };
  return null;
}

export async function requireLaunchState(reader: ConnectionSender, args: Args): Promise<LaunchState> {
  const ref = launchRef(args);
  if (!ref) throw new CliError("pass --launch <address>, --mint <base mint> or --config <dbc config>");
  const s = await fetchLaunchState(reader, ref);
  if (!s) throw new CliError("launch not found");
  return s;
}

export function quoteAssetArg(args: Args) {
  const q = str(args, "quote") ?? "SPYx";
  const asset = findQuoteAsset(q);
  if (!asset) throw new CliError(`--quote ${q} is not on the StockFloor quote allowlist`);
  return asset;
}

export const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof PublicKey ? x.toBase58() : x), 2);

export function log(...parts: unknown[]): void {
  console.log(...parts);
}

export function stateSummary(s: LaunchState) {
  return {
    launch: s.address.toBase58(),
    version: s.launch.version,
    feeSplit: s.launch.feeSplitEnabled ? "v3: platform / creator / vault" : "v2: 100% to the vault",
    phase: s.phase,
    progress: `${(s.progress.fraction * 100).toFixed(2)}% (${s.progress.quoteReserve} / ${s.progress.threshold} raw quote)`,
    config: s.launch.config.toBase58(),
    baseMint: s.launch.baseMint.toBase58(),
    pool: s.keys.pool.toBase58(),
    poolRegistered: s.launch.poolRegistered,
    dammPool: s.migrated ? s.damm.pool.toBase58() : null,
    vault: s.vault.toBase58(),
    vaultRaw: s.vaultBalance.toString(),
    baseSupplyRaw: s.baseSupply.toString(),
    floorQ64: s.floor.floorQ64.toString(),
    exitFeeBps: s.launch.exitFeeBps,
    migrationFeeHarvested: s.launch.migrationFeeHarvested,
    surplusHarvested: s.launch.surplusHarvested,
    vaultSharePct: vaultSharePctFromMigrationFeePct(s.dbcConfig.migrationFeePercentage, s.launch.version),
    creator: s.launch.creator.toBase58(),
    totalHarvestedQuote: s.launch.totalHarvestedQuote.toString(),
    totalPlatformQuote: s.launch.totalPlatformQuote.toString(),
    totalCreatorQuote: s.launch.totalCreatorQuote.toString(),
    partnerQuoteFeePending: (s.dbcPool?.partnerQuoteFee ?? 0n).toString(),
    claimerBaseRaw: s.claimerBaseBalance?.toString() ?? null,
    positions: s.positions.map((p) => ({ position: p.position.toBase58(), pendingQuote: p.pending.b.toString(), pendingBase: p.pending.a.toString() })),
  };
}

/** Run `main` with uniform error output and exit codes. */
export function runCli(main: () => Promise<void>): void {
  main().then(
    () => process.exit(0),
    (e: unknown) => {
      if (e instanceof CliError) console.error(`error: ${e.message}`);
      else if (e instanceof Error) {
        console.error(`error: ${e.message}`);
        const logs = (e as { logs?: string[] }).logs;
        if (logs?.length) console.error(logs.slice(-12).join("\n"));
      } else console.error(e);
      process.exit(1);
    },
  );
}
