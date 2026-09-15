/**
 * Chain access abstraction shared by the web app (web3.js Connection + wallet adapter), the CLI
 * (Connection + Keypair) and the fork tests (LiteSVM, tests/sdk/litesvm-sender.ts).
 *
 * Readers only need a handful of calls; senders add transaction submission. All account data is
 * plain `Uint8Array`.
 */
import type { PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";

export interface AccountData {
  data: Uint8Array;
  owner: PublicKey;
  lamports: number;
  executable: boolean;
}

export interface KeyedAccount {
  pubkey: PublicKey;
  account: AccountData;
}

export interface ProgramAccountsFilter {
  /** Exact account data length. */
  dataSize?: number;
  /** Byte comparisons at offsets (raw bytes, not base58). */
  memcmp?: Array<{ offset: number; bytes: Uint8Array }>;
}

export interface SimulationResult {
  ok: boolean;
  logs: string[];
  unitsConsumed?: number;
  /** Return data of the last instruction that set it, if any. */
  returnData?: { programId: PublicKey; data: Uint8Array } | null;
  /** Error string when `ok` is false. */
  error?: string;
}

export interface ChainReader {
  getAccountInfo(pubkey: PublicKey): Promise<AccountData | null>;
  getMultipleAccountsInfo(pubkeys: PublicKey[]): Promise<Array<AccountData | null>>;
  getProgramAccounts(programId: PublicKey, filter?: ProgramAccountsFilter): Promise<KeyedAccount[]>;
  /** Token accounts owned by `owner` under one token program. */
  getTokenAccountsByOwner(owner: PublicKey, tokenProgram: PublicKey): Promise<KeyedAccount[]>;
  /**
   * Simulate instructions without signatures (no state change). `feePayer` must be an existing
   * funded account on the cluster; it never signs.
   */
  simulate(instructions: TransactionInstruction[], feePayer: PublicKey): Promise<SimulationResult>;
}

export interface SendOptions {
  /** Extra signers besides the fee payer (config keypair, base mint keypair, position NFT mints). */
  signers?: Signer[];
  /** Compute unit limit; a ComputeBudget instruction is prepended when set. */
  computeUnitLimit?: number;
  /** Priority fee in micro-lamports per compute unit (ComputeBudget setComputeUnitPrice). */
  computeUnitPriceMicroLamports?: number;
  /** Label used in errors and logs. */
  label?: string;
}

export interface SendResult {
  signature: string;
  logs: string[];
  unitsConsumed?: number;
}

export interface TxSender extends ChainReader {
  /** Fee payer and default signer (wallet or keypair). */
  readonly payer: PublicKey;
  send(instructions: TransactionInstruction[], opts?: SendOptions): Promise<SendResult>;
}

/** A failed transaction or simulation, with logs and the decoded Anchor / program error if any. */
export class TransactionFailedError extends Error {
  constructor(
    message: string,
    readonly logs: string[],
    readonly errorName: string | null,
    readonly errorCode: number | null,
    readonly label?: string,
  ) {
    super(message);
    this.name = "TransactionFailedError";
  }
}

/** Anchor error `{name, code}` from logs ("Error Code: X. Error Number: N"), if present. */
export function anchorErrorFromLogs(logs: readonly string[]): { name: string; code: number } | null {
  for (const l of logs) {
    const m = l.match(/Error Code: (\w+)\. Error Number: (\d+)/);
    if (m) return { name: m[1]!, code: Number(m[2]) };
  }
  return null;
}

/** "Program return: <program id> <base64>" log line (set_return_data), last one wins. */
export function returnDataFromLogs(logs: readonly string[]): { programId: string; base64: string } | null {
  let found: { programId: string; base64: string } | null = null;
  for (const l of logs) {
    const m = l.match(/^Program return: (\S+) (\S*)$/);
    if (m) found = { programId: m[1]!, base64: m[2]! };
  }
  return found;
}
