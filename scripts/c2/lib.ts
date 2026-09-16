/**
 * Shared read-only helpers for the C2 scripts (`preflight.ts`, `checks.ts`, `report.ts`).
 *
 * Nothing here can send a transaction:
 * - `ReadOnlyRpc` refuses every JSON-RPC method that is not on the read allowlist below, so
 *   `sendTransaction`, `requestAirdrop` and `simulateTransaction` cannot be issued even by mistake;
 * - `ReadOnlyChainReader` implements just enough of the SDK `ChainReader` interface to decode launch
 *   state, and throws on `simulate`;
 * - `pubkeyOf` loads a repo keypair only to derive its public key (and refuses paths outside `keys/`).
 *
 * Run these scripts with the SDK's tsx so `@solana/web3.js` resolves to the same instance as the SDK:
 *   packages/sdk/node_modules/.bin/tsx scripts/c2/<script>.ts ...
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Web3 from "@solana/web3.js";
import type {
  AccountData,
  ChainReader,
  KeyedAccount,
} from "../../packages/sdk/src/index.ts";

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const KEYS_DIR = join(REPO_ROOT, "keys");

const requireFromSdk = createRequire(
  join(REPO_ROOT, "packages", "sdk", "package.json"),
);
export const web3 = requireFromSdk("@solana/web3.js") as typeof Web3;

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const SPYX_MINT = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
export const STOCKFLOOR_PROGRAM =
  "98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA";
export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
export const BPF_UPGRADEABLE_LOADER =
  "BPFLoaderUpgradeab1e11111111111111111111111";
export const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111";
export const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111";
/** Upgradeable programdata accounts start with a 45-byte header before the ELF. */
export const PROGRAMDATA_HEADER = 45;

// ------------------------------------------------------------------ read-only JSON-RPC

/** The only JSON-RPC methods the C2 scripts may call. No send, no airdrop, no simulate. */
const READ_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getGenesisHash",
  "getHealth",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountsByOwner",
  "getVersion",
]);

export class RpcError extends Error {
  constructor(
    readonly method: string,
    message: string,
  ) {
    super(`${method}: ${message}`);
    this.name = "RpcError";
  }
}

export class ReadOnlyRpc {
  private id = 0;

  constructor(
    readonly url: string,
    readonly timeoutMs = 30_000,
  ) {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:")
      throw new Error(`RPC URL must be http(s), got ${u.protocol}`);
  }

  get display(): string {
    return rpcDisplay(this.url);
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!READ_METHODS.has(method))
      throw new RpcError(method, "not a read-only method (refused)");
    let lastError = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      let res: Response;
      try {
        res = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.id,
            method,
            params,
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new RpcError(method, `HTTP ${res.status}`);
      const body = (await res.json()) as {
        result?: T;
        error?: { message: string };
      };
      if (body.error) throw new RpcError(method, body.error.message);
      return body.result as T;
    }
    throw new RpcError(method, lastError || "no response");
  }

  async accountInfo(address: string): Promise<{
    data: Buffer;
    owner: string;
    lamports: number;
    executable: boolean;
  } | null> {
    const res = await this.call<{
      value: {
        data: [string, string];
        owner: string;
        lamports: number;
        executable: boolean;
      } | null;
    }>("getAccountInfo", [address, { encoding: "base64" }]);
    if (!res?.value) return null;
    return {
      data: Buffer.from(res.value.data[0], "base64"),
      owner: res.value.owner,
      lamports: res.value.lamports,
      executable: res.value.executable,
    };
  }

  async balance(address: string): Promise<bigint> {
    const res = await this.call<{ value: number }>("getBalance", [address]);
    return BigInt(res.value);
  }
}

/** Scheme, host and port only: provider URLs carry API keys in the path or query string. */
export function rpcDisplay(url: string): string {
  try {
    const u = new URL(url);
    const hidden =
      u.pathname.replace(/\/+$/, "") !== "" ||
      u.search !== "" ||
      u.username !== "" ||
      u.password !== "";
    return hidden ? `${u.origin}/…` : u.origin;
  } catch {
    return "<invalid RPC URL>";
  }
}

export function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]"
    );
  } catch {
    return false;
  }
}

export type ClusterKind = "mainnet" | "surfnet" | "local" | "unknown";

export interface ClusterInfo {
  kind: ClusterKind;
  genesis: string | null;
  solanaCore: string | null;
  surfnetVersion: string | null;
  slot: number | null;
  healthy: boolean;
  error?: string;
}

/** Identify the cluster behind an RPC endpoint with read calls only. */
export async function classifyCluster(rpc: ReadOnlyRpc): Promise<ClusterInfo> {
  const info: ClusterInfo = {
    kind: "unknown",
    genesis: null,
    solanaCore: null,
    surfnetVersion: null,
    slot: null,
    healthy: false,
  };
  try {
    const health = await rpc.call<string>("getHealth");
    info.healthy = health === "ok";
    const version = await rpc.call<Record<string, string>>("getVersion");
    info.solanaCore = version["solana-core"] ?? null;
    info.surfnetVersion = version["surfnet-version"] ?? null;
    info.genesis = await rpc.call<string>("getGenesisHash");
    info.slot = await rpc.call<number>("getSlot");
  } catch (e) {
    info.error = e instanceof Error ? e.message : String(e);
    return info;
  }
  const loopback = isLoopback(rpc.url);
  // An endpoint that reports `surfnet-version` is a Surfpool surfnet whatever its host name: a local
  // surfnet is reachable as http://localtest.me:8899, through a container name or over a LAN address,
  // and classifying those as "mainnet" because the host is not one of four literal spellings would
  // print "genesis mainnet" for a fork. (Sending is a different question: the SDK guard in
  // packages/sdk/src/guard.ts additionally requires a loopback host.)
  if (info.surfnetVersion) info.kind = "surfnet";
  else if (info.genesis === MAINNET_GENESIS && !loopback) info.kind = "mainnet";
  else if (loopback) info.kind = "local";
  return info;
}

// ------------------------------------------------------------------ ChainReader (read-only)

/** Enough of the SDK `ChainReader` to decode launch state. `simulate` always throws. */
export class ReadOnlyChainReader implements ChainReader {
  constructor(readonly rpc: ReadOnlyRpc) {}

  private toAccount(value: {
    data: [string, string];
    owner: string;
    lamports: number;
    executable: boolean;
  }): AccountData {
    return {
      // A Node Buffer (a Uint8Array subclass): some decoders in the SDK's dependency chain call
      // Buffer-only methods such as readUIntLE on the account data.
      data: Buffer.from(value.data[0], "base64"),
      owner: new web3.PublicKey(value.owner),
      lamports: value.lamports,
      executable: value.executable,
    };
  }

  async getAccountInfo(pubkey: Web3.PublicKey): Promise<AccountData | null> {
    const res = await this.rpc.call<{ value: never | null }>("getAccountInfo", [
      pubkey.toBase58(),
      { encoding: "base64" },
    ]);
    return res?.value ? this.toAccount(res.value) : null;
  }

  async getMultipleAccountsInfo(
    pubkeys: Web3.PublicKey[],
  ): Promise<Array<AccountData | null>> {
    const out: Array<AccountData | null> = [];
    for (let i = 0; i < pubkeys.length; i += 100) {
      const res = await this.rpc.call<{ value: Array<never | null> }>(
        "getMultipleAccounts",
        [
          pubkeys.slice(i, i + 100).map((p) => p.toBase58()),
          { encoding: "base64" },
        ],
      );
      for (const v of res.value) out.push(v ? this.toAccount(v) : null);
    }
    return out;
  }

  async getProgramAccounts(): Promise<KeyedAccount[]> {
    // getProgramAccounts is deliberately not used by the C2 checks: public mainnet RPCs throttle or
    // refuse it. Address the launch with --launch instead.
    throw new Error(
      "the C2 read-only client does not use getProgramAccounts: pass --launch <address>",
    );
  }

  async getTokenAccountsByOwner(
    owner: Web3.PublicKey,
    tokenProgram: Web3.PublicKey,
  ): Promise<KeyedAccount[]> {
    const res = await this.rpc.call<{
      value: Array<{ pubkey: string; account: never }>;
    }>("getTokenAccountsByOwner", [
      owner.toBase58(),
      { programId: tokenProgram.toBase58() },
      { encoding: "base64" },
    ]);
    return res.value.map((v) => ({
      pubkey: new web3.PublicKey(v.pubkey),
      account: this.toAccount(v.account),
    }));
  }

  async simulate(): Promise<never> {
    throw new Error(
      "the C2 read-only client never simulates or sends transactions",
    );
  }
}

// ------------------------------------------------------------------ keys, hashes, rent

/** Public key of a repo keypair file. The secret is only used to derive the key and then dropped. */
export function pubkeyOf(path: string): string {
  const abs = path.startsWith("/") ? path : join(REPO_ROOT, path);
  if (!existsSync(abs)) throw new Error(`keypair not found: ${path}`);
  const real = realpathSync(abs);
  const keysReal = realpathSync(KEYS_DIR);
  if (!real.startsWith(keysReal + sep))
    throw new Error(`refusing keypair outside ${KEYS_DIR}: ${path}`);
  const secret = Uint8Array.from(
    JSON.parse(readFileSync(real, "utf8")) as number[],
  );
  return web3.Keypair.fromSecretKey(secret).publicKey.toBase58();
}

export const sha256 = (data: Uint8Array | Buffer): string =>
  createHash("sha256").update(data).digest("hex");

export const sha256File = (path: string): string => sha256(readFileSync(path));

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

export async function readRent(rpc: ReadOnlyRpc): Promise<RentParams> {
  const acc = await rpc.accountInfo(RENT_SYSVAR);
  if (!acc) throw new Error("rent sysvar not found");
  return decodeRent(acc.data);
}

export async function readClockUnixTimestamp(
  rpc: ReadOnlyRpc,
): Promise<bigint> {
  const acc = await rpc.accountInfo(CLOCK_SYSVAR);
  if (!acc) throw new Error("clock sysvar not found");
  return acc.data.readBigInt64LE(32);
}

export interface ProgramElf {
  /** sha256 of the whole programdata payload, padding included (comparable to tests/fixtures). */
  sha256: string;
  /** Payload length: `--max-len`, so usually the ELF plus zero padding. */
  size: number;
  programData: string;
  /** sha256 of the first `prefixBytes` bytes, set when `prefixBytes` was passed. */
  prefixSha256?: string;
  /** True when everything after `prefixBytes` is zero, i.e. only deploy padding follows. */
  paddingZero?: boolean;
}

/**
 * The ELF behind an upgradeable program id (programdata minus the 45-byte header).
 *
 * `solana program deploy --max-len N` stores the ELF followed by zero padding up to N, so a local
 * `.so` is compared through `prefixBytes` (the CLI's own check is `cmp <(head -c <size> dump) so`).
 */
export async function programElfSha256(
  rpc: ReadOnlyRpc,
  programId: string,
  prefixBytes?: number,
): Promise<ProgramElf | null> {
  const program = await rpc.accountInfo(programId);
  if (!program) return null;
  if (program.owner !== BPF_UPGRADEABLE_LOADER)
    throw new Error(`${programId} is not owned by the upgradeable loader`);
  const programData = new web3.PublicKey(
    program.data.subarray(4, 36),
  ).toBase58();
  const pd = await rpc.accountInfo(programData);
  if (!pd) throw new Error(`programdata ${programData} not found`);
  const elf = pd.data.subarray(PROGRAMDATA_HEADER);
  const out: ProgramElf = {
    sha256: sha256(elf),
    size: elf.length,
    programData,
  };
  if (prefixBytes !== undefined && elf.length >= prefixBytes) {
    out.prefixSha256 = sha256(elf.subarray(0, prefixBytes));
    out.paddingZero = elf.subarray(prefixBytes).every((b) => b === 0);
  }
  return out;
}

/**
 * Upgradeable loader buffer accounts: a 4-byte enum tag (`Buffer` = 1) plus `Option<Pubkey>`
 * authority = 37 bytes of metadata, then the ELF written so far, zero-padded to the buffer's size.
 */
export const BUFFER_HEADER = 37;
export const BUFFER_TAG = 1;

export interface DeployBufferState {
  /** The account's loader enum tag; 1 is `Buffer`. */
  tag: number;
  /** Who may write to and close the buffer (null when it was frozen). */
  authority: string | null;
  /** Leading bytes that already equal the local ELF. */
  written: number;
  /** Payload capacity (`--max-len`). */
  capacity: number;
  /** First offset holding a non-zero byte that the local ELF does not have there. */
  firstMismatch: number | null;
  /** No written byte contradicts the local ELF, so `--buffer` can safely resume into it. */
  resumable: boolean;
}

/**
 * Compare a deploy buffer with the local ELF.
 *
 * `solana program deploy --buffer <keypair>` writes the ELF into this account in ~960-byte chunks and
 * only then deploys, so after any interrupted deploy the account exists and holds a prefix of the
 * binary. Re-running the same command resumes into it; that is the documented recovery, not a fault.
 * What must not happen is resuming into a buffer holding a *different* ELF, which is exactly what
 * `firstMismatch` detects (bytes past the written region are zero and prove nothing either way).
 */
export function inspectDeployBuffer(
  data: Uint8Array,
  localElf: Uint8Array,
): DeployBufferState {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = data.byteLength >= 4 ? view.getUint32(0, true) : -1;
  const authority =
    tag === BUFFER_TAG && data.byteLength >= BUFFER_HEADER && data[4] === 1
      ? new web3.PublicKey(data.subarray(5, BUFFER_HEADER)).toBase58()
      : null;
  const payload = data.subarray(BUFFER_HEADER);
  let written = 0;
  while (
    written < payload.length &&
    written < localElf.length &&
    payload[written] === localElf[written]
  )
    written++;
  let firstMismatch: number | null = null;
  for (let i = 0; i < payload.length; i++) {
    const expected = i < localElf.length ? localElf[i]! : 0;
    if (payload[i] !== expected && payload[i] !== 0) {
      firstMismatch = i;
      break;
    }
  }
  return {
    tag,
    authority,
    written,
    capacity: payload.length,
    firstMismatch,
    resumable: tag === BUFFER_TAG && firstMismatch === null,
  };
}

/** Does the on-chain program carry exactly this local ELF (plus deploy padding)? */
export function elfMatches(
  deployed: ProgramElf | null,
  localSha: string,
  localBytes: number,
): boolean {
  if (!deployed || localSha === "") return false;
  if (deployed.size === localBytes) return deployed.sha256 === localSha;
  return deployed.prefixSha256 === localSha && deployed.paddingZero === true;
}

// ------------------------------------------------------------------ rehearsal baseline

export interface RehearsalBaseline {
  file: string;
  runId: string;
  params: Record<string, string>;
  deploy: {
    measured: Record<string, string | number>;
    maxLenOptions: Array<{ name: string; len: number; total: string }>;
  };
  wallets: Array<{
    role: string;
    pubkey: string;
    keyFile: string;
    txCount: number;
    spent: string;
    recommendedLamports: string;
    recommendedSpyxRaw: string;
    spyxPlanned: string;
  }>;
  totals: Record<string, string>;
  prices: Record<string, number | string>;
}

/** Rehearsal run ids: a UTC timestamp, so their names sort chronologically. */
const REHEARSAL_REPORT = /^\d{8}T\d{6}Z\.json$/;

/**
 * The newest saved C2 rehearsal report (`scripts/e2e/reports/<run id>.json`).
 *
 * Only files whose name is a run-id timestamp count: those sort chronologically, while any other
 * name dropped into the directory (a `dry-…` copy, a hand-written `baseline.json`) could otherwise
 * sort last and silently become the accepted binary hash. Pass `--rehearsal <file>` to name one.
 */
export function loadRehearsalBaseline(explicit?: string): RehearsalBaseline {
  const dir = join(REPO_ROOT, "scripts", "e2e", "reports");
  let file: string;
  if (explicit) {
    file = explicit.startsWith("/") ? explicit : join(REPO_ROOT, explicit);
  } else {
    const candidates = readdirSync(dir)
      .filter((f) => REHEARSAL_REPORT.test(f))
      .sort();
    if (candidates.length === 0)
      throw new Error(
        `no rehearsal report named <run id>.json in ${dir} (run bash scripts/e2e/rehearsal.sh with SAVE_REPORT=1, or pass --rehearsal <file>)`,
      );
    file = join(dir, candidates[candidates.length - 1]!);
  }
  const report = JSON.parse(readFileSync(file, "utf8")) as RehearsalBaseline;
  return { ...report, file };
}

// ------------------------------------------------------------------ small utilities

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;

export const groupDigits = (v: bigint | number | string): string =>
  String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const sol = (lamports: bigint | number): string =>
  `${(Number(lamports) / 1e9).toFixed(6)} SOL`;

export function rawToUnits(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}`;
}

/** Minimal `--flag value` / `--switch` parser (same shape as the other repo scripts). */
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
    const eq = a.indexOf("=");
    if (eq > 0) {
      out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const name = a.slice(2);
    if (switches.includes(name)) {
      out.flags[name] = true;
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--"))
      throw new Error(`missing value for ${a}`);
    out.flags[name] = v;
    i++;
  }
  return out;
}

export function flag(
  flags: Record<string, string | true>,
  name: string,
): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

export const switchOn = (
  flags: Record<string, string | true>,
  name: string,
): boolean => flags[name] === true || flags[name] === "true";

/** Run `fn`, print errors uniformly and exit with `code` (default 1) on failure. */
export function main(fn: () => Promise<number | void>): void {
  fn().then(
    (code) => process.exit(typeof code === "number" ? code : 0),
    (e: unknown) => {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
