import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { swapEventsFromTx } from "./extract";
import { base58Decode } from "./base58";
import { base58Encode, fakeTx, swapEventIx, type FakeSwap } from "./testUtils";

const dbcPool = Keypair.generate().publicKey;
const dammPool = Keypair.generate().publicKey;
const pools = { dbc: dbcPool.toBase58(), damm: dammPool.toBase58() };
const swap = (over: Partial<FakeSwap> = {}): FakeSwap => ({
  pool: dbcPool,
  buy: true,
  sqrt: 1n << 64n,
  input: 500n,
  output: 900n,
  timestamp: 1_758_000_000,
  ...over,
});

describe("swapEventsFromTx", () => {
  it("decodes a DBC buy and a DAMM sell with the right volume fields", () => {
    const tx = fakeTx(
      [
        { venue: "dbc", data: swapEventIx("dbc", swap()) },
        { venue: "damm", data: swapEventIx("damm", swap({ pool: dammPool, buy: false, timestamp: 1_758_000_001 })) },
      ],
      42,
    );
    const events = swapEventsFromTx(tx, pools);
    expect(events.map((e) => [e.venue, e.buy, e.quoteVolumeRaw, e.slot])).toEqual([
      ["dbc", true, 500n, 42],
      ["damm", false, 900n, 42],
    ]);
  });

  it("resolves program ids loaded through an address lookup table", () => {
    const tx = fakeTx([{ venue: "damm", data: swapEventIx("damm", swap({ pool: dammPool })) }], 1, { lookupPrograms: true });
    // Payer is static key 0; the programs are lookup keys 1 (DBC) and 2 (DAMM v2).
    expect(swapEventsFromTx(tx, pools)).toHaveLength(1);
  });

  it("picks the layout from the program id, not the shared discriminator", () => {
    // A DBC-layout event under the DAMM v2 program id is not read as DAMM (and not as DBC either).
    const tx = fakeTx([{ venue: "damm", data: swapEventIx("dbc", swap({ pool: dammPool })) }]);
    expect(swapEventsFromTx(tx, pools)).toEqual([]);
  });

  it("drops events of other pools and skips failed transactions", () => {
    const other = Keypair.generate().publicKey;
    expect(swapEventsFromTx(fakeTx([{ venue: "dbc", data: swapEventIx("dbc", swap({ pool: other })) }]), pools)).toEqual([]);
    const failed = fakeTx([{ venue: "dbc", data: swapEventIx("dbc", swap()) }], 1, { err: { InstructionError: [0, "Custom"] } });
    expect(swapEventsFromTx(failed, pools)).toEqual([]);
  });

  it("ignores DAMM events when the launch has no DAMM pool yet", () => {
    const tx = fakeTx([{ venue: "damm", data: swapEventIx("damm", swap({ pool: dammPool })) }]);
    expect(swapEventsFromTx(tx, { dbc: pools.dbc, damm: null })).toEqual([]);
  });

  it("test base58 encoder round-trips through the decoder", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255, 128, 7]);
    expect([...base58Decode(base58Encode(bytes))!]).toEqual([...bytes]);
  });
});
