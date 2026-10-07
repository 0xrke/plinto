import type { PublicKey } from "@solana/web3.js";
import { DAMM_V2_PROGRAM_ID, DBC_PROGRAM_ID } from "@stockfloor/sdk";
import { base58Decode } from "./base58";
import { decodeDammSwapEvent, decodeDbcSwapEvent, type SwapEvent } from "./events";

const DBC_PROGRAM = DBC_PROGRAM_ID.toBase58();
const DAMM_V2_PROGRAM = DAMM_V2_PROGRAM_ID.toBase58();

/** Minimal shape of a `getTransaction(sig, { maxSupportedTransactionVersion: 0 })` response. */
export interface TxLike {
  blockTime?: number | null;
  slot: number;
  transaction: { message: { staticAccountKeys?: PublicKey[]; accountKeys?: PublicKey[] } };
  meta: {
    err: unknown;
    innerInstructions?: Array<{ index: number; instructions: Array<{ programIdIndex: number; data: string }> }> | null;
    loadedAddresses?: { writable: PublicKey[]; readonly: PublicKey[] } | null;
  } | null;
}

/** A swap event with the slot it landed in, for a stable sort. */
export interface SlottedSwapEvent extends SwapEvent {
  slot: number;
}

/**
 * The swap events of one transaction for the given pools (DBC virtual pool, DAMM v2 pool). Failed
 * transactions give none. Inner-instruction program ids may point into lookup-table keys (Jupiter
 * routes); events of other pools touched by the same route are dropped.
 */
export function swapEventsFromTx(tx: TxLike, pools: { dbc: string; damm: string | null }): SlottedSwapEvent[] {
  if (!tx.meta || tx.meta.err) return [];
  const message = tx.transaction.message;
  const keys = [
    ...(message.staticAccountKeys ?? message.accountKeys ?? []),
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ].map((k) => k.toBase58());
  const out: SlottedSwapEvent[] = [];
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      const program = keys[ix.programIdIndex];
      let event: SwapEvent | null = null;
      if (program === DBC_PROGRAM) {
        const data = base58Decode(ix.data);
        event = data ? decodeDbcSwapEvent(data) : null;
        if (event && event.pool !== pools.dbc) event = null;
      } else if (program === DAMM_V2_PROGRAM && pools.damm) {
        const data = base58Decode(ix.data);
        event = data ? decodeDammSwapEvent(data) : null;
        if (event && event.pool !== pools.damm) event = null;
      }
      if (!event) continue;
      // The program's clock is authoritative; the block time is a fallback for a zero timestamp.
      if (event.timestamp <= 0 && tx.blockTime) event = { ...event, timestamp: tx.blockTime };
      out.push({ ...event, slot: tx.slot });
    }
  }
  return out;
}
