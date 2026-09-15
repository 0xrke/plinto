/**
 * LiteSVM "mainnet fork": LiteSVM loaded with mainnet program binaries and accounts dumped by
 * tests/fixtures/dump.ts, plus our own programs from target/deploy.
 *
 * Transactions are built with @solana/web3.js v1 and sent as raw bytes.
 */
import {
  AccountInfo,
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURES_DIR,
  SPIKE_PROGRAM_ID,
  STOCKFLOOR_PROGRAM_ID,
  TARGET_DEPLOY_DIR,
} from "./constants.js";

export interface FixtureManifestProgram {
  name: string;
  address: string;
  file: string;
  slot: number;
}

export interface FixtureManifestAccount {
  name: string;
  address: string;
  file: string;
  slot: number;
}

export interface FixtureManifest {
  generatedAt: string;
  programs: FixtureManifestProgram[];
  accounts: FixtureManifestAccount[];
}

export interface ForkOptions {
  /** Load target/deploy/spike.so (default true if the file exists). */
  spike?: boolean;
  /** Load target/deploy/stockfloor.so (default true if the file exists). */
  stockfloor?: boolean;
  /** Extra programs to load: [programId, absolute .so path]. */
  extraPrograms?: Array<[PublicKey, string]>;
  /** Initial unix timestamp for the Clock sysvar. Default: fixture dump time. */
  unixTimestamp?: bigint;
}

export interface TxSuccess {
  ok: true;
  signature: string;
  logs: string[];
  computeUnits: bigint;
  meta: TransactionMetadata;
}

export interface TxFailure {
  ok: false;
  logs: string[];
  error: string;
  meta: FailedTransactionMetadata;
}

export type TxResult = TxSuccess | TxFailure;

export interface SendOptions {
  /** Compute unit limit (default 1_400_000). Set to 0 to skip the ComputeBudget instruction. */
  computeUnits?: number;
  /** Fee payer (default: first signer). */
  feePayer?: PublicKey;
}

export class TxError extends Error {
  constructor(
    message: string,
    public readonly logs: string[],
  ) {
    super(`${message}\n--- logs ---\n${logs.join("\n")}`);
  }
}

export function loadManifest(): FixtureManifest {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, "manifest.json"), "utf8"));
}

interface InnerLiteSvm {
  sendLegacyTransaction(bytes: Uint8Array): TransactionMetadata | FailedTransactionMetadata;
}

export class Fork {
  readonly svm: LiteSVM;
  readonly manifest: FixtureManifest;
  private airdropped = 0;

  private constructor(svm: LiteSVM, manifest: FixtureManifest) {
    this.svm = svm;
    this.manifest = manifest;
  }

  /** Create a fork with every fixture program/account plus our built programs. */
  static create(opts: ForkOptions = {}): Fork {
    const manifest = loadManifest();
    const svm = new LiteSVM().withTransactionHistory(0n);

    for (const p of manifest.programs) {
      svm.addProgramFromFile(p.address as never, join(FIXTURES_DIR, p.file));
    }
    for (const a of manifest.accounts) {
      const json = JSON.parse(readFileSync(join(FIXTURES_DIR, a.file), "utf8"));
      svm.setAccount({
        address: json.pubkey,
        lamports: BigInt(json.account.lamports),
        programAddress: json.account.owner,
        executable: json.account.executable,
        data: Buffer.from(json.account.data[0], "base64"),
        space: BigInt(json.account.space),
      } as never);
    }

    const ours: Array<[PublicKey, string, boolean | undefined]> = [
      [SPIKE_PROGRAM_ID, join(TARGET_DEPLOY_DIR, "spike.so"), opts.spike],
      [STOCKFLOOR_PROGRAM_ID, join(TARGET_DEPLOY_DIR, "stockfloor.so"), opts.stockfloor],
    ];
    for (const [id, path, wanted] of ours) {
      if (wanted === false) continue;
      if (!existsSync(path)) {
        if (wanted === true) throw new Error(`missing ${path}; build it with scripts/build-programs.sh`);
        continue;
      }
      svm.addProgramFromFile(id.toBase58() as never, path);
    }
    for (const [id, path] of opts.extraPrograms ?? []) {
      svm.addProgramFromFile(id.toBase58() as never, path);
    }

    const fork = new Fork(svm, manifest);
    const ts = opts.unixTimestamp ?? BigInt(Math.floor(Date.parse(manifest.generatedAt) / 1000));
    fork.setUnixTimestamp(ts);
    return fork;
  }

  /** List fixture program names (for diagnostics). */
  static fixturePrograms(): string[] {
    return readdirSync(join(FIXTURES_DIR, "programs"));
  }

  // ---------------------------------------------------------------- accounts

  getAccount(pubkey: PublicKey): AccountInfo<Buffer> | null {
    const acc = this.svm.getAccount(pubkey.toBase58() as never);
    if (!acc.exists) return null;
    return {
      lamports: Number(acc.lamports),
      owner: new PublicKey(acc.programAddress),
      executable: acc.executable,
      data: Buffer.from(acc.data),
      rentEpoch: 0,
    };
  }

  mustGetAccount(pubkey: PublicKey): AccountInfo<Buffer> {
    const acc = this.getAccount(pubkey);
    if (!acc) throw new Error(`account ${pubkey.toBase58()} does not exist`);
    return acc;
  }

  /** Cheatcode: create or overwrite an account. */
  setAccount(
    pubkey: PublicKey,
    account: { lamports: number | bigint; data: Uint8Array; owner: PublicKey; executable?: boolean },
  ): void {
    this.svm.setAccount({
      address: pubkey.toBase58(),
      lamports: BigInt(account.lamports),
      programAddress: account.owner.toBase58(),
      executable: account.executable ?? false,
      data: account.data,
      space: BigInt(account.data.length),
    } as never);
  }

  /** Cheatcode: mutate an existing account's data in place. */
  patchAccount(pubkey: PublicKey, mutate: (data: Buffer) => void): void {
    const acc = this.mustGetAccount(pubkey);
    const data = Buffer.from(acc.data);
    mutate(data);
    this.setAccount(pubkey, { ...acc, data });
  }

  lamports(pubkey: PublicKey): bigint {
    return BigInt(this.svm.getBalance(pubkey.toBase58() as never) ?? 0n);
  }

  airdrop(pubkey: PublicKey, lamports: bigint): void {
    const res = this.svm.airdrop(pubkey.toBase58() as never, lamports as never);
    if (res && res instanceof FailedTransactionMetadata) {
      throw new Error(`airdrop failed: ${res.toString()}`);
    }
    this.svm.expireBlockhash();
    this.airdropped++;
  }

  /** A new in-memory keypair funded with `sol` SOL. */
  newWallet(sol = 100): Keypair {
    const kp = Keypair.generate();
    this.airdrop(kp.publicKey, BigInt(sol) * BigInt(LAMPORTS_PER_SOL));
    return kp;
  }

  // ---------------------------------------------------------------- clock

  now(): bigint {
    return this.svm.getClock().unixTimestamp;
  }

  setUnixTimestamp(ts: bigint): void {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, ts));
  }

  /** Advance the clock by `seconds` (and slots at 400ms per slot). */
  warp(seconds: number | bigint): void {
    const s = BigInt(seconds);
    const c = this.svm.getClock();
    const slot = c.slot + (s * 5n) / 2n + 1n;
    this.svm.setClock(
      new Clock(slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + s),
    );
    this.svm.expireBlockhash();
  }

  // ---------------------------------------------------------------- transactions

  /** Build, sign and process a legacy transaction. Never throws on program failure. */
  sendTx(ixs: TransactionInstruction[], signers: Keypair[], opts: SendOptions = {}): TxResult {
    if (signers.length === 0) throw new Error("at least one signer (fee payer) is required");
    const tx = new Transaction();
    const cu = opts.computeUnits ?? 1_400_000;
    if (cu > 0) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }));
    tx.add(...ixs);
    tx.feePayer = opts.feePayer ?? signers[0].publicKey;
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.sign(...dedupeSigners(signers));
    const bytes = tx.serialize();
    const inner = (this.svm as unknown as { inner: InnerLiteSvm }).inner;
    const res = inner.sendLegacyTransaction(bytes);
    this.svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) {
      return { ok: false, logs: res.meta().logs(), error: res.err().toString(), meta: res };
    }
    return {
      ok: true,
      signature: Buffer.from(res.signature()).toString("hex"),
      logs: res.logs(),
      computeUnits: res.computeUnitsConsumed(),
      meta: res,
    };
  }

  /** Like sendTx, but throws TxError (with logs) on failure. */
  send(ixs: TransactionInstruction[], signers: Keypair[], opts: SendOptions = {}): TxSuccess {
    const res = this.sendTx(ixs, signers, opts);
    if (!res.ok) throw new TxError(`transaction failed: ${res.error}`, res.logs);
    return res;
  }

  /** Expect a failure; returns the failure (throws if the tx succeeded). */
  sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[], opts: SendOptions = {}): TxFailure {
    const res = this.sendTx(ixs, signers, opts);
    if (res.ok) throw new TxError("transaction unexpectedly succeeded", res.logs);
    return res;
  }
}

function dedupeSigners(signers: Keypair[]): Keypair[] {
  const seen = new Set<string>();
  return signers.filter((s) => {
    const k = s.publicKey.toBase58();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Extract an Anchor error name/code from logs, if present. */
export function anchorErrorFromLogs(logs: string[]): { name: string; code: number } | null {
  for (const l of logs) {
    const m = l.match(/Error Code: (\w+)\. Error Number: (\d+)/);
    if (m) return { name: m[1], code: Number(m[2]) };
  }
  return null;
}
