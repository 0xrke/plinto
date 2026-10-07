import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  DAMM_SWAP2_BODY_LEN,
  DBC_EVT_SWAP2_HOOK_DISC,
  DBC_SWAP2_BODY_LEN,
  EVENT_IX_TAG,
  EVT_SWAP2_DISC,
  decodeDammSwapEvent,
  decodeDbcSwapEvent,
  sqrtPriceToPrice,
} from "./events";
import { base58Decode } from "./base58";
import dbcIdlJson from "../../../../idls/dynamic_bonding_curve.json";
import dammIdlJson from "../../../../idls/cp_amm.json";

/*
 * The decoders' fixed offsets are checked against the IDLs: a test-only Borsh encoder driven by the IDL
 * type definitions writes each event, and the decoder must read back the same fields.
 */

type IdlType = string | { defined: { name: string } };
interface Idl {
  events: { name: string; discriminator: number[] }[];
  types: { name: string; type: { kind: string; fields: { name: string; type: IdlType }[] } }[];
}

const dbcIdl = dbcIdlJson as unknown as Idl;
const dammIdl = dammIdlJson as unknown as Idl;

type Value = bigint | number | boolean | Uint8Array | { [k: string]: Value };

/** Borsh-encodes `value` as the IDL type `name`. Missing numeric fields are written as distinct filler. */
function encode(idl: Idl, name: string, value: Record<string, Value>): Uint8Array {
  const out: number[] = [];
  let filler = 1n;
  const write = (type: IdlType, v: Value | undefined) => {
    if (typeof type === "object") {
      const def = idl.types.find((t) => t.name === type.defined.name)!;
      for (const f of def.type.fields) write(f.type, (v as Record<string, Value> | undefined)?.[f.name]);
      return;
    }
    const uint = (bytes: number) => {
      let n = v === undefined ? filler++ : BigInt(v as bigint | number);
      for (let i = 0; i < bytes; i++) {
        out.push(Number(n & 0xffn));
        n >>= 8n;
      }
    };
    switch (type) {
      case "pubkey":
        out.push(...((v as Uint8Array | undefined) ?? new Uint8Array(32).fill(7)));
        return;
      case "bool":
        out.push(v ? 1 : 0);
        return;
      case "u8":
        return uint(1);
      case "u64":
        return uint(8);
      case "u128":
        return uint(16);
      default:
        throw new Error(`unsupported IDL type ${type}`);
    }
  };
  write({ defined: { name } }, value);
  return Uint8Array.from(out);
}

function eventIx(disc: Uint8Array, body: Uint8Array): Uint8Array {
  return Uint8Array.from([...EVENT_IX_TAG, ...disc, ...body]);
}

const sha8 = (s: string) => [...createHash("sha256").update(s).digest().subarray(0, 8)];

describe("event constants", () => {
  it("match the Anchor hashes and the IDL discriminators", () => {
    expect([...EVENT_IX_TAG]).toEqual(sha8("anchor:event").reverse());
    expect([...EVT_SWAP2_DISC]).toEqual(sha8("event:EvtSwap2"));
    expect([...DBC_EVT_SWAP2_HOOK_DISC]).toEqual(sha8("event:EvtSwap2WithTransferHook"));
    const disc = (idl: Idl, n: string) => idl.events.find((e) => e.name === n)!.discriminator;
    expect([...EVT_SWAP2_DISC]).toEqual(disc(dbcIdl, "EvtSwap2"));
    expect([...EVT_SWAP2_DISC]).toEqual(disc(dammIdl, "EvtSwap2"));
    expect([...DBC_EVT_SWAP2_HOOK_DISC]).toEqual(disc(dbcIdl, "EvtSwap2WithTransferHook"));
  });

  it("body lengths match the IDL layouts", () => {
    expect(encode(dbcIdl, "EvtSwap2", {}).length).toBe(DBC_SWAP2_BODY_LEN);
    expect(encode(dbcIdl, "EvtSwap2WithTransferHook", {}).length).toBe(DBC_SWAP2_BODY_LEN);
    expect(encode(dammIdl, "EvtSwap2", {}).length).toBe(DAMM_SWAP2_BODY_LEN);
  });
});

describe("decodeDbcSwapEvent", () => {
  const pool = Keypair.generate().publicKey;
  const sqrt = (3n << 64n) + 12345n;
  const swapResult = { included_fee_input_amount: 1_000_000n, output_amount: 777_000n, next_sqrt_price: sqrt };
  const body = (direction: number) =>
    encode(dbcIdl, "EvtSwap2", {
      pool: pool.toBytes(),
      trade_direction: direction,
      swap_result: swapResult,
      current_timestamp: 1_758_000_000n,
    });

  it("reads a buy (QuoteToBase): input with fee is the quote volume", () => {
    const e = decodeDbcSwapEvent(eventIx(EVT_SWAP2_DISC, body(1)));
    expect(e).toEqual({ venue: "dbc", pool: pool.toBase58(), buy: true, nextSqrtPrice: sqrt, quoteVolumeRaw: 1_000_000n, timestamp: 1_758_000_000 });
  });

  it("reads a sell (BaseToQuote): the output is the quote volume", () => {
    const e = decodeDbcSwapEvent(eventIx(EVT_SWAP2_DISC, body(0)))!;
    expect([e.buy, e.quoteVolumeRaw]).toEqual([false, 777_000n]);
  });

  it("reads the transfer-hook variant and tolerates appended bytes", () => {
    const hook = encode(dbcIdl, "EvtSwap2WithTransferHook", { pool: pool.toBytes(), trade_direction: 1, swap_result: swapResult });
    const e = decodeDbcSwapEvent(eventIx(DBC_EVT_SWAP2_HOOK_DISC, Uint8Array.from([...hook, 9, 9, 9])))!;
    expect(e.nextSqrtPrice).toBe(sqrt);
  });

  it("ignores EvtSwap (v1), other tags, short data and bad directions", () => {
    const evtSwap = Uint8Array.from(dbcIdl.events.find((x) => x.name === "EvtSwap")!.discriminator);
    expect(decodeDbcSwapEvent(eventIx(evtSwap, body(1)))).toBeNull();
    const wrongTag = eventIx(EVT_SWAP2_DISC, body(1));
    wrongTag[0] = 0;
    expect(decodeDbcSwapEvent(wrongTag)).toBeNull();
    expect(decodeDbcSwapEvent(eventIx(EVT_SWAP2_DISC, body(1)).subarray(0, 100))).toBeNull();
    expect(decodeDbcSwapEvent(eventIx(EVT_SWAP2_DISC, body(2)))).toBeNull();
  });
});

describe("decodeDammSwapEvent", () => {
  const pool = Keypair.generate().publicKey;
  const sqrt = (5n << 64n) + 99n;

  it("reads the DAMM v2 layout (BtoA = buy base)", () => {
    const body = encode(dammIdl, "EvtSwap2", {
      pool: pool.toBytes(),
      trade_direction: 1,
      collect_fee_mode: 1,
      swap_result: { included_fee_input_amount: 42n, output_amount: 43n, next_sqrt_price: sqrt },
      current_timestamp: 1_759_000_000n,
    });
    expect(decodeDammSwapEvent(eventIx(EVT_SWAP2_DISC, body))).toEqual({
      venue: "damm",
      pool: pool.toBase58(),
      buy: true,
      nextSqrtPrice: sqrt,
      quoteVolumeRaw: 42n,
      timestamp: 1_759_000_000,
    });
  });

  it("does not read a DBC body as DAMM (same discriminator, different layout)", () => {
    const dbcBody = encode(dbcIdl, "EvtSwap2", { pool: pool.toBytes(), trade_direction: 1 });
    // DBC data is one byte shorter than a DAMM body.
    expect(decodeDammSwapEvent(eventIx(EVT_SWAP2_DISC, dbcBody))).toBeNull();
  });
});

describe("sqrtPriceToPrice", () => {
  it("squares the Q64.64 sqrt price and scales by the decimals", () => {
    expect(sqrtPriceToPrice(1n << 64n, 6, 6)).toBe(1);
    expect(sqrtPriceToPrice(2n << 64n, 9, 6)).toBe(4000);
    expect(sqrtPriceToPrice(1n << 63n, 6, 8)).toBeCloseTo(0.0025, 12);
  });
});

describe("base58Decode", () => {
  it("round-trips public keys and keeps leading zero bytes", () => {
    const key = Keypair.generate().publicKey;
    expect([...base58Decode(key.toBase58())!]).toEqual([...key.toBytes()]);
    expect([...base58Decode("11111111111111111111111111111111")!]).toEqual(new Array(32).fill(0));
    expect([...base58Decode("")!]).toEqual([]);
    expect(base58Decode("0OIl")).toBeNull();
  });
});
