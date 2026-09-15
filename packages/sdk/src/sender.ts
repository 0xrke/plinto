/**
 * `ConnectionSender`: a `TxSender` over a web3.js `Connection`, signing with a `Keypair` (CLI,
 * crank) or a wallet adapter's `signTransaction` (web app). It adds compute budget instructions,
 * sends legacy transactions, waits for confirmation and turns program failures into
 * `TransactionFailedError` with logs and the Anchor error name.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Commitment,
  type GetProgramAccountsFilter,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import { base64ToBytes } from "./bytes";
import {
  anchorErrorFromLogs,
  TransactionFailedError,
  type AccountData,
  type KeyedAccount,
  type ProgramAccountsFilter,
  type SendOptions,
  type SendResult,
  type SimulationResult,
  type TxSender,
} from "./chain";
import { computeBudgetInstructions } from "./transaction";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 encoding (for RPC memcmp filters). */
export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % 58n)]! + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

/** The part of a wallet adapter the sender needs. */
export interface WalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
}

export interface ConnectionSenderOptions {
  commitment?: Commitment;
  /** Default priority fee for every send (micro-lamports per CU). */
  computeUnitPriceMicroLamports?: number;
  skipPreflight?: boolean;
  /** Called with the serialized transaction right before it is sent (e.g. a mainnet guard). */
  beforeSend?: (info: { label?: string; instructions: TransactionInstruction[] }) => void | Promise<void>;
}

function toAccountData(a: { data: Uint8Array; owner: PublicKey; lamports: number; executable: boolean }): AccountData {
  return { data: a.data, owner: a.owner, lamports: a.lamports, executable: a.executable };
}

export class ConnectionSender implements TxSender {
  readonly payer: PublicKey;
  private readonly commitment: Commitment;

  constructor(
    readonly connection: Connection,
    private readonly signer: Keypair | WalletLike,
    private readonly opts: ConnectionSenderOptions = {},
  ) {
    this.payer = signer.publicKey;
    this.commitment = opts.commitment ?? "confirmed";
  }

  async getAccountInfo(pubkey: PublicKey): Promise<AccountData | null> {
    const acc = await this.connection.getAccountInfo(pubkey, this.commitment);
    return acc ? toAccountData(acc) : null;
  }

  async getMultipleAccountsInfo(pubkeys: PublicKey[]): Promise<Array<AccountData | null>> {
    const out: Array<AccountData | null> = [];
    for (let i = 0; i < pubkeys.length; i += 100) {
      const chunk = await this.connection.getMultipleAccountsInfo(pubkeys.slice(i, i + 100), this.commitment);
      for (const a of chunk) out.push(a ? toAccountData(a) : null);
    }
    return out;
  }

  async getProgramAccounts(programId: PublicKey, filter: ProgramAccountsFilter = {}): Promise<KeyedAccount[]> {
    const filters: GetProgramAccountsFilter[] = [];
    if (filter.dataSize !== undefined) filters.push({ dataSize: filter.dataSize });
    for (const m of filter.memcmp ?? []) filters.push({ memcmp: { offset: m.offset, bytes: base58Encode(m.bytes) } });
    const res = await this.connection.getProgramAccounts(programId, { commitment: this.commitment, filters });
    return res.map((r) => ({ pubkey: r.pubkey, account: toAccountData(r.account) }));
  }

  async getTokenAccountsByOwner(owner: PublicKey, tokenProgram: PublicKey): Promise<KeyedAccount[]> {
    const res = await this.connection.getTokenAccountsByOwner(owner, { programId: tokenProgram }, this.commitment);
    return res.value.map((r) => ({ pubkey: r.pubkey, account: toAccountData(r.account) }));
  }

  async simulate(instructions: TransactionInstruction[], feePayer: PublicKey): Promise<SimulationResult> {
    const { blockhash } = await this.connection.getLatestBlockhash(this.commitment);
    const message = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const res = await this.connection.simulateTransaction(new VersionedTransaction(message), {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: this.commitment,
    });
    const v = res.value;
    const rd = v.returnData;
    return {
      ok: v.err === null,
      logs: v.logs ?? [],
      unitsConsumed: v.unitsConsumed,
      returnData: rd ? { programId: new PublicKey(rd.programId), data: base64ToBytes(rd.data[0]) } : null,
      error: v.err === null ? undefined : JSON.stringify(v.err),
    };
  }

  async send(instructions: TransactionInstruction[], opts: SendOptions = {}): Promise<SendResult> {
    const all = [
      ...computeBudgetInstructions({
        computeUnitLimit: opts.computeUnitLimit,
        computeUnitPriceMicroLamports: opts.computeUnitPriceMicroLamports ?? this.opts.computeUnitPriceMicroLamports,
      }),
      ...instructions,
    ];
    await this.opts.beforeSend?.({ label: opts.label, instructions: all });
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.commitment);
    let tx = new Transaction({ feePayer: this.payer, blockhash, lastValidBlockHeight }).add(...all);
    const extra: Signer[] = (opts.signers ?? []).filter((s) => !s.publicKey.equals(this.payer));
    if (this.signer instanceof Keypair) {
      tx.sign(this.signer, ...extra);
    } else {
      // Wallets may rewrite the transaction (priority fees, guards): let the wallet sign first,
      // then add the local signatures.
      tx = await this.signer.signTransaction(tx);
      if (extra.length > 0) tx.partialSign(...extra);
    }
    let signature: string;
    try {
      signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: this.opts.skipPreflight ?? false,
        preflightCommitment: this.commitment,
      });
    } catch (e) {
      let logs: string[] = [];
      if (e instanceof SendTransactionError) {
        logs = (await e.getLogs(this.connection).catch(() => undefined)) ?? e.logs ?? [];
      }
      const anchor = anchorErrorFromLogs(logs);
      throw new TransactionFailedError(
        `${opts.label ?? "transaction"} failed: ${anchor ? `${anchor.name} (${anchor.code})` : e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
        logs,
        anchor?.name ?? null,
        anchor?.code ?? null,
        opts.label,
      );
    }
    const confirmation = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, this.commitment);
    const details = await this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = details?.meta?.logMessages ?? [];
    const err = confirmation.value.err ?? details?.meta?.err ?? null;
    if (err) {
      const anchor = anchorErrorFromLogs(logs);
      throw new TransactionFailedError(
        `${opts.label ?? "transaction"} ${signature} failed: ${anchor ? `${anchor.name} (${anchor.code})` : JSON.stringify(err)}`,
        logs,
        anchor?.name ?? null,
        anchor?.code ?? null,
        opts.label,
      );
    }
    return { signature, logs, unitsConsumed: details?.meta?.computeUnitsConsumed ?? undefined };
  }
}
