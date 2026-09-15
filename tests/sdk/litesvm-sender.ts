/**
 * `TxSender` over the LiteSVM mainnet fork (tests/src/fork.ts), so SDK code paths that run against a
 * web3.js Connection in production run unchanged in the fork tests.
 *
 * Every transaction is a signed legacy transaction checked against the 1232-byte packet limit, with
 * the SDK's compute budget instructions, exactly as `ConnectionSender` builds it.
 */
import { Keypair, PublicKey, type Signer, type TransactionInstruction } from "@solana/web3.js";
import {
  base64ToBytes,
  computeBudgetInstructions,
  legacyTransactionSize,
  PACKET_DATA_SIZE,
  returnDataFromLogs,
  anchorErrorFromLogs,
  TransactionFailedError,
  type AccountData,
  type KeyedAccount,
  type ProgramAccountsFilter,
  type SendOptions,
  type SendResult,
  type SimulationResult,
  type TxSender,
} from "@stockfloor/sdk";
import { Fork } from "../src/fork.js";

export interface SentTransaction {
  label?: string;
  size: number;
  computeUnitLimit?: number;
  unitsConsumed: number;
  signature: string;
}

export class LiteSvmSender implements TxSender {
  readonly payer: PublicKey;
  /** Every successful transaction sent through this sender. */
  readonly sent: SentTransaction[] = [];
  /** Optional hook run before each send (race simulations). */
  beforeSend?: (label: string | undefined) => void | Promise<void>;

  constructor(
    readonly fork: Fork,
    readonly signer: Keypair,
  ) {
    this.payer = signer.publicKey;
  }

  /** Another sender on the same fork with a different fee payer. */
  withSigner(signer: Keypair): LiteSvmSender {
    return new LiteSvmSender(this.fork, signer);
  }

  async getAccountInfo(pubkey: PublicKey): Promise<AccountData | null> {
    const acc = this.fork.getAccount(pubkey);
    return acc ? { data: acc.data, owner: acc.owner, lamports: acc.lamports, executable: acc.executable } : null;
  }

  async getMultipleAccountsInfo(pubkeys: PublicKey[]): Promise<Array<AccountData | null>> {
    return Promise.all(pubkeys.map((p) => this.getAccountInfo(p)));
  }

  async getProgramAccounts(programId: PublicKey, filter: ProgramAccountsFilter = {}): Promise<KeyedAccount[]> {
    const all = this.fork.svm.getProgramAccounts(programId.toBase58() as never) as unknown as Array<{
      address: string;
      data: Uint8Array;
      lamports: bigint;
      executable: boolean;
      programAddress: string;
    }>;
    const out: KeyedAccount[] = [];
    for (const a of all) {
      const data = Buffer.from(a.data);
      if (filter.dataSize !== undefined && data.length !== filter.dataSize) continue;
      const ok = (filter.memcmp ?? []).every((m) => m.offset + m.bytes.length <= data.length && Buffer.from(m.bytes).equals(data.subarray(m.offset, m.offset + m.bytes.length)));
      if (!ok) continue;
      out.push({
        pubkey: new PublicKey(a.address),
        account: { data, owner: new PublicKey(a.programAddress), lamports: Number(a.lamports), executable: a.executable },
      });
    }
    return out;
  }

  async getTokenAccountsByOwner(owner: PublicKey, tokenProgram: PublicKey): Promise<KeyedAccount[]> {
    const accounts = await this.getProgramAccounts(tokenProgram);
    const ownerBytes = owner.toBuffer();
    return accounts.filter((a) => {
      const d = a.account.data;
      // Token accounts: 165 bytes (SPL) or > 165 with account type 2 at byte 165 (Token-2022).
      const isAccount = d.length === 165 || (d.length > 165 && d[165] === 2);
      return isAccount && Buffer.from(d.subarray(32, 64)).equals(ownerBytes);
    });
  }

  async simulate(instructions: TransactionInstruction[], feePayer: PublicKey): Promise<SimulationResult> {
    // LiteSVM verifies signatures, so the simulation is signed by this sender's key as fee payer.
    void feePayer;
    const res = this.fork.simulateTx(instructions, [this.signer], { computeUnits: 0 });
    if (!res.ok) return { ok: false, logs: res.logs, error: res.error };
    const rd = returnDataFromLogs(res.logs);
    return {
      ok: true,
      logs: res.logs,
      unitsConsumed: Number(res.computeUnits),
      returnData: rd ? { programId: new PublicKey(rd.programId), data: base64ToBytes(rd.base64) } : null,
    };
  }

  async send(instructions: TransactionInstruction[], opts: SendOptions = {}): Promise<SendResult> {
    await this.beforeSend?.(opts.label);
    const all = [
      ...computeBudgetInstructions({ computeUnitLimit: opts.computeUnitLimit, computeUnitPriceMicroLamports: opts.computeUnitPriceMicroLamports }),
      ...instructions,
    ];
    const size = legacyTransactionSize(all, this.payer);
    if (size > PACKET_DATA_SIZE) {
      throw new Error(`${opts.label ?? "transaction"} is ${size} bytes, above the ${PACKET_DATA_SIZE}-byte packet limit`);
    }
    const signers: Signer[] = [this.signer, ...(opts.signers ?? [])];
    const res = this.fork.sendTx(all, signers as Keypair[], { computeUnits: 0, feePayer: this.payer });
    if (!res.ok) {
      const anchor = anchorErrorFromLogs(res.logs);
      throw new TransactionFailedError(
        `${opts.label ?? "transaction"} failed: ${anchor ? `${anchor.name} (${anchor.code})` : res.error}`,
        res.logs,
        anchor?.name ?? null,
        anchor?.code ?? null,
        opts.label,
      );
    }
    const unitsConsumed = Number(res.computeUnits);
    this.sent.push({ label: opts.label, size, computeUnitLimit: opts.computeUnitLimit, unitsConsumed, signature: res.signature });
    return { signature: res.signature, logs: res.logs, unitsConsumed };
  }
}
