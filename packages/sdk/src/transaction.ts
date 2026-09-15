/**
 * Transaction helpers: compute budget instructions, per-instruction compute unit limits measured on
 * the fork (tests/integration/compute-budget.test.ts), and legacy transaction size checks.
 */
import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";

/** Maximum serialized transaction size (bytes). */
export const PACKET_DATA_SIZE = 1232;

/**
 * Recommended compute unit limits (enforced by the fork compute budget test; each is at least the
 * measured maximum plus a margin for PDA bump searches).
 */
export const CU_LIMITS = {
  createLaunch: 120_000,
  registerPool: 20_000,
  harvestCurveFeesCreatesAta: 100_000,
  harvestCurveFees: 80_000,
  harvestMigrationFee: 60_000,
  harvestSurplus: 60_000,
  burnClaimerBase: 40_000,
  harvestLpFees: 100_000,
  floor: 15_000,
  redeem: 40_000,
  dbcCreateConfig: 50_000,
  dbcInitializePool: 150_000,
  dbcSwap2: 60_000,
  dbcMigrationDammV2: 200_000,
  dammV2Swap2: 40_000,
  /** ATA CreateIdempotent (creating a Token-2022 ATA with extensions costs the most). */
  createAta: 35_000,
} as const;

/** Max compute units per transaction. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

export function computeBudgetInstructions(opts: { computeUnitLimit?: number; computeUnitPriceMicroLamports?: number }): TransactionInstruction[] {
  const out: TransactionInstruction[] = [];
  if (opts.computeUnitLimit !== undefined) {
    const units = Math.min(Math.ceil(opts.computeUnitLimit), MAX_COMPUTE_UNIT_LIMIT);
    if (!(units > 0)) throw new RangeError("computeUnitLimit must be positive");
    out.push(ComputeBudgetProgram.setComputeUnitLimit({ units }));
  }
  if (opts.computeUnitPriceMicroLamports !== undefined && opts.computeUnitPriceMicroLamports > 0) {
    out.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(opts.computeUnitPriceMicroLamports) }));
  }
  return out;
}

/** A dummy blockhash (32 zero-ish bytes) for size measurement only. */
const SIZE_BLOCKHASH = "11111111111111111111111111111111";

function shortvecLength(n: number): number {
  let len = 1;
  let rem = n >> 7;
  while (rem > 0) {
    len++;
    rem >>= 7;
  }
  return len;
}

/** Serialized size of a legacy transaction with these instructions, fee payer and all signatures. */
export function legacyTransactionSize(instructions: TransactionInstruction[], feePayer: PublicKey): number {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = SIZE_BLOCKHASH;
  tx.add(...instructions);
  const message = tx.compileMessage();
  const n = message.header.numRequiredSignatures;
  return shortvecLength(n) + 64 * n + message.serialize().length;
}

export class TransactionTooLargeError extends Error {
  constructor(
    readonly size: number,
    readonly label: string,
  ) {
    super(`${label}: serialized transaction is ${size} bytes (max ${PACKET_DATA_SIZE})`);
    this.name = "TransactionTooLargeError";
  }
}

/** Throws when the legacy transaction (with its compute budget instructions) exceeds 1232 bytes. */
export function assertTransactionFits(instructions: TransactionInstruction[], feePayer: PublicKey, label = "transaction"): number {
  const size = legacyTransactionSize(instructions, feePayer);
  if (size > PACKET_DATA_SIZE) throw new TransactionTooLargeError(size, label);
  return size;
}
