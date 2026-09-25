/**
 * Decoders: Launch v3 (and v2) by offsets vs the Anchor coder of the IDL, FloorInfo, token accounts and the
 * real SPYx mint (Token-2022 extensions from the mainnet fixture), bytes helpers, base58.
 */
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  base58Encode,
  base64ToBytes,
  bytesToBase64,
  curveProgress,
  decodeClock,
  decodeFloorInfo,
  decodeLaunch,
  decodeMint,
  decodeTokenAccount,
  derivePhase,
  effectiveMintMultiplier,
  ExtensionType,
  findTokenExtension,
  floorQ64,
  LAUNCH_ACCOUNT_SIZE,
  LAUNCH_DISCRIMINATOR,
  LAUNCH_OFFSETS,
  LAUNCH_VERSION,
  readU128,
  readUintLE,
  returnDataFromLogs,
  anchorErrorFromLogs,
  stockfloorProgram,
} from "../src";

const FIXTURES = join(__dirname, "..", "..", "..", "tests", "fixtures", "accounts");

function randomLaunch(seed: number, version = 3) {
  const r = (n: number) => (seed * 2654435761 + n * 40503) % 256;
  const key = () => Keypair.generate().publicKey;
  return {
    version,
    bump: r(1),
    claimerBump: r(2),
    vaultAuthorityBump: r(3),
    exitFeeBps: (seed * 37) % 501,
    migrationFeeHarvested: seed % 2 === 0,
    surplusHarvested: seed % 3 === 0,
    migrated: seed % 5 === 0,
    config: key(),
    creator: key(),
    pool: seed % 4 === 0 ? PublicKey.default : key(),
    baseMint: key(),
    quoteMint: key(),
    quoteTokenProgram: key(),
    vault: key(),
    createdAt: new BN(1_789_000_000 + seed),
    totalHarvestedQuote: new BN("18446744073709551615"),
    totalBurnedBase: new BN(seed * 1_000_003),
    totalRedeemedBase: new BN(seed * 7),
    totalRedeemedQuote: new BN(seed * 11),
    totalExitFees: new BN(seed * 13),
    totalPlatformQuote: new BN(seed * 17 + 1),
    totalCreatorQuote: seed % 2 === 0 ? new BN("18446744073709551615") : new BN(seed * 19),
    reserved: new Array(46).fill(0),
  };
}

describe("Launch decoder", () => {
  it("v3 layout: 351 bytes, counters at 289 and 297, 46 reserved bytes at 305", () => {
    expect(LAUNCH_VERSION).toBe(3);
    expect(LAUNCH_ACCOUNT_SIZE).toBe(351);
    expect(LAUNCH_OFFSETS.totalPlatformQuote).toBe(289);
    expect(LAUNCH_OFFSETS.totalCreatorQuote).toBe(297);
    expect(LAUNCH_OFFSETS.reserved).toBe(305);
    expect(LAUNCH_OFFSETS.reserved + 46).toBe(LAUNCH_ACCOUNT_SIZE);
  });


  it("matches the Anchor coder built from the IDL for random accounts", async () => {
    const coder = stockfloorProgram().coder.accounts;
    for (let seed = 1; seed <= 40; seed++) {
      const version = seed % 3 === 0 ? 2 : 3;
      const l = randomLaunch(seed, version);
      const data = await coder.encode("launch", l);
      expect(data.length).toBe(LAUNCH_ACCOUNT_SIZE);
      expect(Array.from(data.subarray(0, 8))).toEqual(Array.from(LAUNCH_DISCRIMINATOR));
      const d = decodeLaunch(data);
      expect(d.version).toBe(version);
      expect(d.feeSplitEnabled).toBe(version >= 3);
      expect(d.totalPlatformQuote).toBe(BigInt(l.totalPlatformQuote.toString()));
      expect(d.totalCreatorQuote).toBe(BigInt(l.totalCreatorQuote.toString()));
      expect([d.bump, d.claimerBump, d.vaultAuthorityBump, d.exitFeeBps]).toEqual([l.bump, l.claimerBump, l.vaultAuthorityBump, l.exitFeeBps]);
      expect([d.migrationFeeHarvested, d.surplusHarvested, d.migrated]).toEqual([l.migrationFeeHarvested, l.surplusHarvested, l.migrated]);
      for (const k of ["config", "creator", "pool", "baseMint", "quoteMint", "quoteTokenProgram", "vault"] as const) {
        expect(d[k].equals(l[k]), k).toBe(true);
      }
      expect(d.poolRegistered).toBe(!l.pool.equals(PublicKey.default));
      expect(d.createdAt).toBe(BigInt(l.createdAt.toString()));
      expect(d.totalHarvestedQuote).toBe((1n << 64n) - 1n);
      expect([d.totalBurnedBase, d.totalRedeemedBase, d.totalRedeemedQuote, d.totalExitFees]).toEqual(
        [l.totalBurnedBase, l.totalRedeemedBase, l.totalRedeemedQuote, l.totalExitFees].map((b) => BigInt(b.toString())),
      );
      // Documented memcmp offsets.
      expect(new PublicKey(data.subarray(LAUNCH_OFFSETS.baseMint, LAUNCH_OFFSETS.baseMint + 32)).equals(l.baseMint)).toBe(true);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      expect(view.getBigUint64(LAUNCH_OFFSETS.totalPlatformQuote, true)).toBe(d.totalPlatformQuote);
      expect(view.getBigUint64(LAUNCH_OFFSETS.totalCreatorQuote, true)).toBe(d.totalCreatorQuote);
    }
  });

  it("rejects a wrong discriminator or a short account", async () => {
    const data = await stockfloorProgram().coder.accounts.encode("launch", randomLaunch(7));
    const bad = Uint8Array.from(data);
    bad[0] ^= 1;
    expect(() => decodeLaunch(bad)).toThrow(/not a StockFloor Launch/);
    expect(() => decodeLaunch(data.subarray(0, 300))).toThrow();
  });
});

describe("FloorInfo, phase and progress", () => {
  it("decodes the 34-byte floor view return data", () => {
    const b = new Uint8Array(34);
    const v = new DataView(b.buffer);
    v.setBigUint64(0, 49_095_490n, true);
    v.setBigUint64(8, 719_177_034_677_061n, true);
    v.setUint16(16, 200, true);
    const q = floorQ64(49_095_490n, 719_177_034_677_061n);
    v.setBigUint64(18, q & ((1n << 64n) - 1n), true);
    v.setBigUint64(26, q >> 64n, true);
    expect(decodeFloorInfo(b)).toEqual({ vaultRaw: 49_095_490n, supply: 719_177_034_677_061n, exitFeeBps: 200, floorQ64: q });
    expect(() => decodeFloorInfo(b.subarray(0, 33))).toThrow();
    expect(floorQ64(5n, 0n)).toBe(0n);
  });

  it("derivePhase covers the lifecycle", () => {
    expect(derivePhase({ curveComplete: false, migrated: false, migrationFeeHarvested: false })).toBe("presale");
    expect(derivePhase({ curveComplete: true, migrated: false, migrationFeeHarvested: true })).toBe("graduating");
    expect(derivePhase({ curveComplete: true, migrated: true, migrationFeeHarvested: false })).toBe("graduated");
    expect(derivePhase({ curveComplete: true, migrated: true, migrationFeeHarvested: true })).toBe("redeemable");
  });

  it("curveProgress is clamped to [0, 1]", () => {
    expect(curveProgress(0n, 100n)).toBe(0);
    expect(curveProgress(50n, 100n)).toBe(0.5);
    expect(curveProgress(150n, 100n)).toBe(1);
    expect(curveProgress(1n, 0n)).toBe(0);
    expect(curveProgress(1n, 3n)).toBeCloseTo(1 / 3, 5);
  });
});

describe("token decoders", () => {
  it("decode the real SPYx mint with its Token-2022 extensions", () => {
    const json = JSON.parse(readFileSync(join(FIXTURES, "spyx_mint.json"), "utf8"));
    const data = base64ToBytes(json.account.data[0]);
    const m = decodeMint(data);
    expect(m.decimals).toBe(8);
    expect(m.supply).toBeGreaterThan(0n);
    expect(m.paused).toBe(false);
    expect(m.transferHookProgramId).toBeNull();
    expect(m.freezeAuthority?.toBase58()).toBe("JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs");
    expect(m.scaledUiAmount).not.toBeNull();
    const s = m.scaledUiAmount!;
    expect(s.multiplier).toBeCloseTo(1.003909240011759, 12);
    expect(s.newMultiplier).toBeCloseTo(1.005714560286254, 12);
    expect(s.newMultiplierEffectiveTimestamp).toBe(1781755200n);
    expect(effectiveMintMultiplier(m, 1781755199n)).toBe(s.multiplier);
    expect(effectiveMintMultiplier(m, 1781755200n)).toBe(s.newMultiplier);
    // Flip the Pausable flag (PausableConfig: authority 32 bytes, then paused) and decode again.
    const paused = Uint8Array.from(data);
    const ext = findTokenExtension(paused, ExtensionType.PausableConfig)!;
    paused[ext.offset + 32] = 1;
    expect(decodeMint(paused).paused).toBe(true);
  });

  it("decodes token accounts (delegate, close authority, state)", () => {
    const d = new Uint8Array(165);
    const mint = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const delegate = Keypair.generate().publicKey;
    d.set(mint.toBytes(), 0);
    d.set(owner.toBytes(), 32);
    new DataView(d.buffer).setBigUint64(64, 123n, true);
    new DataView(d.buffer).setUint32(72, 1, true);
    d.set(delegate.toBytes(), 76);
    d[108] = 2;
    const t = decodeTokenAccount(d);
    expect(t.mint.equals(mint) && t.owner.equals(owner)).toBe(true);
    expect(t.amount).toBe(123n);
    expect(t.delegate!.equals(delegate)).toBe(true);
    expect(t.state).toBe(2);
    expect(t.closeAuthority).toBeNull();
    expect(() => decodeTokenAccount(d.subarray(0, 100))).toThrow();
  });

  it("decodes the Clock sysvar", () => {
    const d = new Uint8Array(40);
    new DataView(d.buffer).setBigUint64(0, 447_000_000n, true);
    new DataView(d.buffer).setBigInt64(32, 1_789_494_970n, true);
    expect(decodeClock(d)).toEqual({ slot: 447_000_000n, unixTimestamp: 1_789_494_970n });
  });
});

describe("bytes and log helpers", () => {
  it("base58Encode matches PublicKey.toBase58 (with leading zeros)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (bytes) => {
        expect(base58Encode(bytes)).toBe(new PublicKey(bytes).toBase58());
      }),
      { numRuns: 300 },
    );
    expect(base58Encode(new Uint8Array(32))).toBe(PublicKey.default.toBase58());
    // Base58 test vector ("Hello World!").
    expect(base58Encode(new TextEncoder().encode("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(base58Encode(Uint8Array.from([0, 0, 1]))).toBe("112");
  });

  it("base64 and little-endian readers round-trip", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
      }),
    );
    const b = new Uint8Array(16);
    b[15] = 1;
    b[0] = 5;
    expect(readU128(b, 0)).toBe((1n << 120n) + 5n);
    expect(readUintLE([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2])).toBe((2n << 128n) + 1n);
  });

  it("parses Anchor errors and return data from logs", () => {
    const logs = [
      "Program 98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA invoke [1]",
      "Program log: AnchorError occurred. Error Code: NothingToRedeem. Error Number: 6045. Error Message: x.",
      "Program return: 98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA AQID",
    ];
    expect(anchorErrorFromLogs(logs)).toEqual({ name: "NothingToRedeem", code: 6045 });
    expect(returnDataFromLogs(logs)).toEqual({ programId: "98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA", base64: "AQID" });
    expect(anchorErrorFromLogs([])).toBeNull();
    expect(returnDataFromLogs(["nothing"])).toBeNull();
  });
});
