import { Keypair, PublicKey } from "@solana/web3.js";
import { DAMM_V2_PROGRAM_ID, DBC_PROGRAM_ID } from "@stockfloor/sdk";
import { DAMM_SWAP2_BODY_LEN, DBC_SWAP2_BODY_LEN, EVENT_IX_TAG, EVT_SWAP2_DISC } from "./events";
import type { TxLike } from "./extract";

/* Test-only builders for swap event instructions and transactions (not imported by app code). */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!];
  return out;
}

export interface FakeSwap {
  pool: PublicKey;
  buy: boolean;
  sqrt: bigint;
  input: bigint;
  output: bigint;
  timestamp: number;
}

/** A DBC (179-byte body) or DAMM v2 (180-byte body) EvtSwap2 event instruction, at the offsets of the IDLs. */
export function swapEventIx(venue: "dbc" | "damm", s: FakeSwap): Uint8Array {
  const len = venue === "dbc" ? DBC_SWAP2_BODY_LEN : DAMM_SWAP2_BODY_LEN;
  const o = venue === "dbc" ? { dir: 64, input: 83, output: 107, sqrt: 115, ts: 171 } : { dir: 32, input: 52, output: 76, sqrt: 84, ts: 156 };
  const body = new Uint8Array(len);
  const view = new DataView(body.buffer);
  body.set(s.pool.toBytes(), 0);
  view.setUint8(o.dir, s.buy ? 1 : 0);
  view.setBigUint64(o.input, s.input, true);
  view.setBigUint64(o.output, s.output, true);
  view.setBigUint64(o.sqrt, s.sqrt & ((1n << 64n) - 1n), true);
  view.setBigUint64(o.sqrt + 8, s.sqrt >> 64n, true);
  view.setBigUint64(o.ts, BigInt(s.timestamp), true);
  return Uint8Array.from([...EVENT_IX_TAG, ...EVT_SWAP2_DISC, ...body]);
}

/** A successful transaction whose inner instructions are the given events (program ids as static keys). */
export function fakeTx(events: { venue: "dbc" | "damm"; data: Uint8Array }[], slot = 1, opts: { lookupPrograms?: boolean; err?: unknown } = {}): TxLike {
  const payer = Keypair.generate().publicKey;
  const programs = [DBC_PROGRAM_ID, DAMM_V2_PROGRAM_ID];
  const staticKeys = opts.lookupPrograms ? [payer] : [payer, ...programs];
  const programIndex = (venue: "dbc" | "damm") => (venue === "dbc" ? 1 : 2);
  return {
    slot,
    blockTime: 1_700_000_000,
    transaction: { message: { staticAccountKeys: staticKeys } },
    meta: {
      err: opts.err ?? null,
      loadedAddresses: opts.lookupPrograms ? { writable: [], readonly: programs } : { writable: [], readonly: [] },
      innerInstructions: [{ index: 0, instructions: events.map((e) => ({ programIdIndex: programIndex(e.venue), data: base58Encode(e.data) })) }],
    },
  };
}
