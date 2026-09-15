/**
 * Every instruction builder against its IDL: account count and order, signer and writable flags,
 * fixed addresses, PDA seeds resolved from the IDL (including `launch.config` paths and the ATA
 * program), and instruction data equal to the Anchor coder's encoding.
 */
import BN from "bn.js";
import { type Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  burnClaimerBaseIx,
  buildDbcConfigParams,
  createLaunchIx,
  DAMM_V2_CONFIG_CUSTOMIZABLE,
  DAMM_V2_IDL,
  DAMM_V2_PROGRAM_ID,
  dammV2Program,
  dammV2PoolKeys,
  dammV2PoolPda,
  dammV2Swap2Ix,
  DBC_IDL,
  DBC_PROGRAM_ID,
  dbcCreateConfigIx,
  dbcInitializePoolWithSplTokenIx,
  dbcMigrationDammV2Ix,
  dbcPoolKeys,
  dbcProgram,
  dbcSwap2Ix,
  dbcTokenBadgePda,
  DEFAULT_QUOTE_ASSET,
  floorIx,
  harvestCurveFeesIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  launchKeysFromAccount,
  launchPda,
  syncMigrationIx,
  redeemIx,
  registerPoolIx,
  STOCKFLOOR_IDL,
  STOCKFLOOR_PROGRAM_ID,
  stockfloorProgram,
  TOKEN_2022_PROGRAM_ID,
  authorityPda,
  dbcPoolPda,
  type LaunchKeys,
} from "../src";

const SPYX = new PublicKey(DEFAULT_QUOTE_ASSET.mint);
const pk = () => Keypair.generate().publicKey;

type IdlAccount = {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: { seeds: Array<{ kind: string; value?: number[]; path?: string }>; program?: { kind: string; value?: number[]; path?: string } };
};

/** Resolve a PDA from IDL seeds; `context` provides account keys by name and `launch.config` style paths. */
function resolvePda(idl: Idl, acc: IdlAccount, byName: Map<string, PublicKey>, context: Record<string, PublicKey>): PublicKey {
  const key = (path: string) => {
    const k = context[path] ?? byName.get(path);
    if (!k) throw new Error(`no key for seed path ${path}`);
    return k;
  };
  const seeds = acc.pda!.seeds.map((s) => {
    if (s.kind === "const") return Uint8Array.from(s.value!);
    if (s.kind === "account") return key(s.path!).toBytes();
    throw new Error(`unsupported seed kind ${s.kind}`);
  });
  const p = acc.pda!.program;
  const programId = !p ? new PublicKey(idl.address) : p.kind === "const" ? new PublicKey(Uint8Array.from(p.value!)) : key(p.path!);
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function expectMatchesIdl(
  idl: Idl,
  name: string,
  ix: TransactionInstruction,
  context: Record<string, PublicKey> = {},
  opts: { remaining?: number } = {},
): Map<string, PublicKey> {
  const def = idl.instructions.find((i) => i.name === name);
  if (!def) throw new Error(`no IDL instruction ${name}`);
  expect(ix.programId.equals(new PublicKey(idl.address)), `${name} program id`).toBe(true);
  const accounts = def.accounts as unknown as IdlAccount[];
  expect(ix.keys.length, `${name} account count`).toBe(accounts.length + (opts.remaining ?? 0));
  const byName = new Map<string, PublicKey>();
  accounts.forEach((a, i) => byName.set(a.name, ix.keys[i]!.pubkey));
  accounts.forEach((a, i) => {
    const meta = ix.keys[i]!;
    const omittedOptional = a.optional && meta.pubkey.equals(new PublicKey(idl.address));
    if (!omittedOptional) {
      expect(meta.isWritable, `${name}.${a.name} writable`).toBe(!!a.writable);
      expect(meta.isSigner, `${name}.${a.name} signer`).toBe(!!a.signer);
    }
    if (a.address) expect(meta.pubkey.toBase58(), `${name}.${a.name} address`).toBe(a.address);
    if (a.pda) expect(meta.pubkey.toBase58(), `${name}.${a.name} pda`).toBe(resolvePda(idl, a, byName, context).toBase58());
  });
  expect(Array.from(ix.data.subarray(0, 8)), `${name} discriminator`).toEqual(def.discriminator);
  return byName;
}

const launchKeys = (): LaunchKeys => {
  const config = pk();
  const baseMint = pk();
  return { config, baseMint, quoteMint: SPYX, quoteTokenProgram: TOKEN_2022_PROGRAM_ID, pool: dbcPoolPda(config, baseMint, SPYX) };
};

describe("stockfloor instruction builders match target/idl/stockfloor.json", () => {
  const coder = () => stockfloorProgram().coder.instruction;

  it("create_launch", () => {
    const k = launchKeys();
    const ix = createLaunchIx({ payer: pk(), creator: pk(), config: k.config, baseMint: k.baseMint, quoteMint: SPYX, exitFeeBps: 200 });
    expectMatchesIdl(STOCKFLOOR_IDL, "create_launch", ix);
    expect(Buffer.from(ix.data).equals(coder().encode("createLaunch", { exitFeeBps: 200 }))).toBe(true);
    expect(() => createLaunchIx({ payer: pk(), creator: pk(), config: k.config, baseMint: k.baseMint, quoteMint: SPYX, exitFeeBps: 70_000 })).toThrow(RangeError);
  });

  it("register_pool", () => {
    const k = launchKeys();
    const ix = registerPoolIx({ config: k.config, pool: k.pool, baseMint: k.baseMint });
    expectMatchesIdl(STOCKFLOOR_IDL, "register_pool", ix, { "launch.config": k.config });
    expect(Buffer.from(ix.data).equals(coder().encode("registerPool", {}))).toBe(true);
  });

  it("harvest_curve_fees, harvest_migration_fee, harvest_surplus", () => {
    const k = launchKeys();
    const ctx = { "launch.config": k.config };
    expectMatchesIdl(STOCKFLOOR_IDL, "harvest_curve_fees", harvestCurveFeesIx({ payer: pk(), keys: k }), ctx);
    const m = harvestMigrationFeeIx({ keys: k });
    const s = harvestSurplusIx({ keys: k });
    expectMatchesIdl(STOCKFLOOR_IDL, "harvest_migration_fee", m, ctx);
    expectMatchesIdl(STOCKFLOOR_IDL, "harvest_surplus", s, ctx);
    // The vault is the vault authority's quote ATA; the claimer is authorityPda.
    expect(m.keys[1]!.pubkey.equals(authorityPda(k.config)[0])).toBe(true);
  });

  it("sync_migration (no payer, no signer: launch and the registered DBC pool)", () => {
    const k = launchKeys();
    const ix = syncMigrationIx({ config: k.config, pool: k.pool });
    expectMatchesIdl(STOCKFLOOR_IDL, "sync_migration", ix, { "launch.config": k.config });
    expect(ix.keys.map((m) => m.pubkey.toBase58())).toEqual([launchPda(k.config)[0].toBase58(), k.pool.toBase58()]);
    expect(Buffer.from(ix.data).equals(coder().encode("syncMigration", {}))).toBe(true);
  });

  it("burn_claimer_base", () => {
    const k = launchKeys();
    expectMatchesIdl(STOCKFLOOR_IDL, "burn_claimer_base", burnClaimerBaseIx({ config: k.config, baseMint: k.baseMint }), { "launch.config": k.config });
  });

  it("harvest_lp_fees", () => {
    const k = launchKeys();
    const dammPool = dammV2PoolPda(DAMM_V2_CONFIG_CUSTOMIZABLE, k.baseMint, SPYX);
    const ix = harvestLpFeesIx({ payer: pk(), keys: k, dammPool, position: pk(), positionNftAccount: pk() });
    expectMatchesIdl(STOCKFLOOR_IDL, "harvest_lp_fees", ix, { "launch.config": k.config });
  });

  it("redeem (amount encoded as u64 LE) and floor", () => {
    const k = launchKeys();
    const holder = pk();
    const amount = 123_456_789_012_345n;
    const ix = redeemIx({ holder, keys: k, amount });
    expectMatchesIdl(STOCKFLOOR_IDL, "redeem", ix, { "launch.config": k.config });
    expect(Buffer.from(ix.data).equals(coder().encode("redeem", { amount: new BN(amount.toString()) }))).toBe(true);
    expect(() => redeemIx({ holder, keys: k, amount: 0n })).toThrow(RangeError);
    const f = floorIx({ config: k.config, quoteMint: SPYX, quoteTokenProgram: TOKEN_2022_PROGRAM_ID, baseMint: k.baseMint });
    expectMatchesIdl(STOCKFLOOR_IDL, "floor", f, { "launch.config": k.config });
    // The vault account of the floor view is the launch vault.
    expect(f.keys[1]!.pubkey.equals(ix.keys[6]!.pubkey)).toBe(true);
  });

  it("launchKeysFromAccount requires a registered pool unless one is given", () => {
    const k = launchKeys();
    const launch = { config: k.config, baseMint: k.baseMint, quoteMint: SPYX, quoteTokenProgram: TOKEN_2022_PROGRAM_ID, pool: PublicKey.default, poolRegistered: false } as never;
    expect(() => launchKeysFromAccount(launch)).toThrow(/registered pool/);
    expect(launchKeysFromAccount(launch, k.pool).pool.equals(k.pool)).toBe(true);
  });
});

describe("DBC and DAMM v2 builders match the trimmed IDLs", () => {
  const input = {
    name: "Floor",
    symbol: "FLR",
    uri: "https://example.com/f.json",
    quote: DEFAULT_QUOTE_ASSET,
    quotePriceUsd: 757.02,
    quoteMultiplier: 1.0057,
    preset: "gentle" as const,
    vaultSharePct: 50,
  };

  it("create_config with the SPYx token badge as remaining account 0", () => {
    const config = pk();
    const claimer = authorityPda(config)[0];
    const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams(input, claimer, claimer);
    const ix = dbcCreateConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer: pk(), params });
    expectMatchesIdl(DBC_IDL, "create_config", ix, {}, { remaining: 1 });
    expect(ix.keys.at(-1)!.pubkey.equals(dbcTokenBadgePda(SPYX)[0])).toBe(true);
    expect(ix.keys.at(-1)!.isWritable || ix.keys.at(-1)!.isSigner).toBe(false);
    expect(Buffer.from(ix.data).equals(dbcProgram().coder.instruction.encode("createConfig", { configParameters: params }))).toBe(true);
    // No badge for an SPL Token quote mint unless given.
    const spl = dbcCreateConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer: pk(), params, quoteTokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
    expect(spl.keys.length).toBe(8);
  });

  it("initialize_virtual_pool_with_spl_token", () => {
    const config = pk();
    const baseMint = pk();
    const ix = dbcInitializePoolWithSplTokenIx({ config, creator: pk(), baseMint, quoteMint: SPYX, payer: pk(), name: "N", symbol: "S", uri: "u" });
    const byName = expectMatchesIdl(DBC_IDL, "initialize_virtual_pool_with_spl_token", ix, {}, { remaining: 1 });
    expect(byName.get("pool")!.equals(dbcPoolPda(config, baseMint, SPYX))).toBe(true);
    expect(Buffer.from(ix.data).equals(dbcProgram().coder.instruction.encode("initializeVirtualPoolWithSplToken", { params: { name: "N", symbol: "S", uri: "u" } }))).toBe(true);
  });

  it("swap2 (with and without referral) encodes SwapParameters2", () => {
    const keys = dbcPoolKeys({ config: pk(), baseMint: pk(), quoteMint: SPYX });
    const args = { amount0: 5_000_000n, amount1: 42n, swapMode: 1 as const };
    const ix = dbcSwap2Ix({ keys, payer: pk(), inputTokenAccount: pk(), outputTokenAccount: pk(), ...args });
    expectMatchesIdl(DBC_IDL, "swap2", ix);
    expect(ix.keys[12]!.pubkey.equals(DBC_PROGRAM_ID)).toBe(true);
    const enc = dbcProgram().coder.instruction.encode("swap2", { params: { amount0: new BN(5_000_000), amount1: new BN(42), swapMode: 1 } });
    expect(Buffer.from(ix.data).equals(enc)).toBe(true);
    const withRef = dbcSwap2Ix({ keys, payer: pk(), inputTokenAccount: pk(), outputTokenAccount: pk(), ...args, referralTokenAccount: pk() });
    expectMatchesIdl(DBC_IDL, "swap2", withRef);
  });

  it("migration_damm_v2 with both position NFT mints and the DAMM v2 config as remaining account", () => {
    const keys = dbcPoolKeys({ config: pk(), baseMint: pk(), quoteMint: SPYX });
    const m = dbcMigrationDammV2Ix({ keys, payer: pk(), dammConfig: DAMM_V2_CONFIG_CUSTOMIZABLE });
    const byName = expectMatchesIdl(DBC_IDL, "migration_damm_v2", m.instruction, {}, { remaining: 1 });
    expect(m.instruction.keys.at(-1)!.pubkey.equals(DAMM_V2_CONFIG_CUSTOMIZABLE)).toBe(true);
    expect(byName.get("pool")!.equals(m.dammPool)).toBe(true);
    expect(m.signers.map((s) => s.publicKey.toBase58())).toEqual([m.firstPositionNftMint.toBase58(), m.secondPositionNftMint.toBase58()]);
  });

  it("DAMM v2 swap2", () => {
    const keys = dammV2PoolKeys({ pool: pk(), tokenAMint: pk(), tokenBMint: SPYX });
    const ix = dammV2Swap2Ix({ keys, payer: pk(), inputTokenAccount: pk(), outputTokenAccount: pk(), amount0: 9n, amount1: 3n, swapMode: 0 });
    expectMatchesIdl(DAMM_V2_IDL, "swap2", ix);
    expect(ix.keys[11]!.pubkey.equals(DAMM_V2_PROGRAM_ID)).toBe(true);
    const enc = dammV2Program().coder.instruction.encode("swap2", { params: { amount0: new BN(9), amount1: new BN(3), swapMode: 0 } });
    expect(Buffer.from(ix.data).equals(enc)).toBe(true);
  });

  it("the stockfloor IDL address is the SDK program id", () => {
    expect(STOCKFLOOR_IDL.address).toBe(STOCKFLOOR_PROGRAM_ID.toBase58());
  });
});
