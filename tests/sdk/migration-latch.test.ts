/**
 * `Launch.migrated` latch with the SDK crank order, on the LiteSVM mainnet fork (real stockfloor,
 * DBC 0.2.1, DAMM v2 0.2.4, Token-2022, SPYx).
 *
 * Review finding (post-M5): the SDK crank harvests the migration fee and the surplus as soon as the
 * curve completes, BEFORE `migration_damm_v2`, so both harvests record `migrated = false` and can never
 * run again (`*AlreadyHarvested` fires before the pool is decoded). Nothing else latched the flag until
 * the first redemption, so every redemption until then decoded the upgradeable DBC VirtualPool: a DBC
 * upgrade that changes the VirtualPool discriminator or the migration encoding in that window would
 * block redemptions (permanently once our upgrade authority is revoked).
 *
 * Fix: the permissionless, idempotent `sync_migration`, which the crank sends right after the
 * migration. The DBC upgrade is emulated like review-regressions §3: the pool's discriminator and
 * migration_progress bytes are rewritten.
 *
 * 1. runCrank: curve fees, migration fee, surplus, migrate, sync_migration; then the re-typed pool
 *    cannot block redeem (exact payout) and sync_migration stays a no-op success.
 * 2. Control with the pre-fix order (no sync_migration): the latch stays unset, the one-shot harvests
 *    cannot latch it any more, and the same DBC change makes redeem and sync_migration fail with
 *    InvalidDbcPool; restoring the pool, syncing and re-typing it again redeems exactly.
 * 3. sync_migration validation: unregistered pool, presale (MigrationNotComplete), substituted pool.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  buildCrankAction,
  buildLaunchTransactions,
  buildTrade,
  computeThresholdQuoteRaw,
  CU_LIMITS,
  DEFAULT_QUOTE_ASSET,
  decodeLaunch,
  effectiveMintMultiplier,
  fetchLaunchState,
  getAtaBalance,
  getClock,
  getLaunch,
  getMintInfo,
  getTokenBalance,
  harvestSurplusIx,
  launchKeysFromAccount,
  planCrank,
  redeemIx,
  runCrank,
  syncMigrationIx,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransactionFailedError,
  type LaunchAccount,
  type LaunchInput,
  type LaunchState,
} from "@stockfloor/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { SPYX_MINT } from "../src/constants.js";
import { Fork } from "../src/fork.js";
import { fundSpyx } from "../src/token.js";
import { LiteSvmSender } from "./litesvm-sender.js";

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

describe("Launch.migrated is latched right after the migration (SDK crank order)", () => {
  let fork: Fork;
  let admin: LiteSvmSender;
  let input: LaunchInput;
  let threshold: bigint;
  let launches = 0;

  const walletSender = (spyx: bigint) => {
    const kp = fork.newWallet(20);
    if (spyx > 0n) fundSpyx(fork, kp, kp.publicKey, spyx);
    return { kp, sender: admin.withSigner(kp) };
  };
  const state = async (launch: PublicKey): Promise<LaunchState> => (await fetchLaunchState(admin, { launch }))!;
  const launchAccount = async (launch: PublicKey): Promise<LaunchAccount> => decodeLaunch((await admin.getAccountInfo(launch))!.data);

  /** Launch through the SDK composer; `onlyFirstTx` stops after create_config + create_launch. */
  async function launch(opts: { firstBuy?: bigint; onlyFirstTx?: boolean } = {}): Promise<PublicKey> {
    const creator = walletSender(threshold);
    const b = buildLaunchTransactions({ ...input, symbol: `LATCH${++launches}` }, creator.kp.publicKey, opts.firstBuy ? { firstBuy: { quoteAmount: opts.firstBuy } } : {});
    for (const t of opts.onlyFirstTx ? b.transactions.slice(0, 1) : b.transactions) {
      await creator.sender.send(t.instructions, { signers: t.signers, computeUnitLimit: t.computeUnitLimit, label: t.label });
    }
    return b.addresses.launch;
  }

  async function buy(launchAddress: PublicKey, amount: bigint): Promise<Keypair> {
    const w = walletSender(amount * 2n);
    const t = buildTrade(await state(launchAddress), w.kp.publicKey, "buy", amount);
    await w.sender.send(t.instructions, { computeUnitLimit: t.computeUnitLimit, label: "buy" });
    return w.kp;
  }

  /** Expect a send to fail with the given Anchor error name. */
  async function expectError(p: Promise<unknown>, name: string) {
    const e = await p.then(
      () => null,
      (err: unknown) => err,
    );
    expect(e, `expected ${name}`).toBeInstanceOf(TransactionFailedError);
    expect((e as TransactionFailedError).errorName).toBe(name);
  }

  /** redeem(amount) with instruction builders only (the SDK state reader decodes the DBC pool). */
  async function redeemExact(launchAddress: PublicKey, holder: Keypair, amount: bigint) {
    const L = await launchAccount(launchAddress);
    const V = await getTokenBalance(admin, L.vault);
    const { mint } = await getMintInfo(admin, L.baseMint);
    const S = mint.supply;
    const gross = (V * amount) / S;
    const net = gross - ceilDiv(gross * BigInt(L.exitFeeBps), 10_000n);
    const q0 = await getAtaBalance(admin, holder.publicKey, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    await admin.withSigner(holder).send([redeemIx({ holder: holder.publicKey, keys: launchKeysFromAccount(L), amount })], { computeUnitLimit: CU_LIMITS.redeem, label: "redeem" });
    expect((await getAtaBalance(admin, holder.publicKey, SPYX_MINT, TOKEN_2022_PROGRAM_ID)) - q0).toBe(net);
    expect(await getTokenBalance(admin, L.vault)).toBe(V - net);
    expect((await getMintInfo(admin, L.baseMint)).mint.supply).toBe(S - amount);
    return net;
  }

  /** Emulate a DBC upgrade that re-types VirtualPool: new discriminator, unknown migration_progress. */
  const retypePool = (pool: PublicKey) =>
    fork.patchAccount(pool, (d) => {
      d.fill(0xee, 0, 8);
      d[8 + 300] = 7; // migration_progress
    });

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    admin = new LiteSvmSender(fork, fork.newWallet(100));
    const { mint } = await getMintInfo(admin, SPYX_MINT);
    const clock = await getClock(admin);
    input = {
      name: "Latch",
      symbol: "LATCH",
      uri: "https://example.com/latch.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: 757.02,
      quoteMultiplier: effectiveMintMultiplier(mint, clock.unixTimestamp),
      preset: "gentle",
      vaultSharePct: 50,
      thresholdUsd: 1000,
      exitFeeBps: 200,
    };
    threshold = computeThresholdQuoteRaw(input);
  });

  it("runCrank latches the migration with sync_migration; a re-typed DBC pool afterwards cannot block redeem", async () => {
    const L = await launch({ firstBuy: threshold / 5n });
    const holder = await buy(L, threshold / 4n);
    await buy(L, threshold * 2n); // PartialFill completes the curve

    const res = await runCrank(admin, { launch: L });
    expect(res.steps.map((s) => [s.action.kind, s.status])).toEqual([
      ["harvest_curve_fees", "executed"],
      ["harvest_migration_fee", "executed"],
      ["harvest_surplus", "executed"],
      ["migrate", "executed"],
      ["sync_migration", "executed"],
    ]);
    expect(res.remaining).toEqual([]);
    const sync = res.steps.at(-1)!;
    expect(sync.unitsConsumed!).toBeLessThanOrEqual(CU_LIMITS.syncMigration);
    const s = await state(L);
    expect(s.phase).toBe("redeemable");
    expect(s.launch.migrated && s.launch.migrationFeeHarvested && s.launch.surplusHarvested).toBe(true);
    expect(planCrank(s)).toEqual([]);

    retypePool(s.keys.pool);
    // The SDK reader cannot decode the pool any more; the program no longer needs to.
    await expect(fetchLaunchState(admin, { launch: L })).rejects.toThrow(/VirtualPool/);
    // Idempotent: a second sync succeeds without reading the pool.
    await admin.send([syncMigrationIx({ config: s.launch.config, pool: s.keys.pool })], { computeUnitLimit: CU_LIMITS.syncMigration, label: "sync_migration again" });

    const balance = await getAtaBalance(admin, holder.publicKey, s.keys.baseMint, TOKEN_PROGRAM_ID);
    expect(await redeemExact(L, holder, balance / 3n)).toBeGreaterThan(0n);
    expect(await redeemExact(L, holder, await getAtaBalance(admin, holder.publicKey, s.keys.baseMint, TOKEN_PROGRAM_ID))).toBeGreaterThan(0n);
  });

  it("control, pre-fix crank order without sync_migration: the one-shot harvests cannot latch any more and the same DBC change blocks redeem", async () => {
    const L = await launch({ firstBuy: threshold / 5n });
    const holder = await buy(L, threshold / 4n);
    await buy(L, threshold * 2n);
    const s0 = await state(L);
    const plan = planCrank(s0);
    expect(plan.map((a) => a.kind)).toEqual(["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus", "migrate"]);
    for (const action of plan) {
      const s = await state(L);
      const b = buildCrankAction(s, action, admin.payer);
      await admin.send(b.instructions, { signers: b.signers, computeUnitLimit: b.computeUnitLimit, label: action.kind });
    }
    const s1 = await state(L);
    expect(s1.migrated).toBe(true); // DBC says migrated
    expect(s1.launch.migrated).toBe(false); // the program never saw it
    expect(planCrank(s1).map((a) => a.kind)).toEqual(["sync_migration"]);
    // The one-shot harvests fail before decoding the pool, so they cannot latch it.
    await expectError(admin.send([harvestSurplusIx({ keys: s1.keys })], { computeUnitLimit: CU_LIMITS.harvestSurplus, label: "harvest_surplus again" }), "SurplusAlreadyHarvested");
    expect((await launchAccount(L)).migrated).toBe(false);

    const saved = Buffer.from(fork.mustGetAccount(s1.keys.pool).data);
    retypePool(s1.keys.pool);
    const amount = (await getAtaBalance(admin, holder.publicKey, s1.keys.baseMint, TOKEN_PROGRAM_ID)) / 2n;
    await expectError(admin.withSigner(holder).send([redeemIx({ holder: holder.publicKey, keys: s1.keys, amount })], { computeUnitLimit: CU_LIMITS.redeem, label: "redeem" }), "InvalidDbcPool");
    await expectError(admin.send([syncMigrationIx({ config: s1.launch.config, pool: s1.keys.pool })], { computeUnitLimit: CU_LIMITS.syncMigration, label: "sync_migration" }), "InvalidDbcPool");
    expect((await launchAccount(L)).migrated).toBe(false);

    // Before the DBC change, sync_migration latches; after it the same change is harmless.
    fork.patchAccount(s1.keys.pool, (d) => saved.copy(d));
    const res = await runCrank(admin, { launch: L });
    expect(res.steps.map((s) => [s.action.kind, s.status])).toEqual([["sync_migration", "executed"]]);
    expect((await launchAccount(L)).migrated).toBe(true);
    retypePool(s1.keys.pool);
    expect(await redeemExact(L, holder, amount)).toBeGreaterThan(0n);
  });

  it("sync_migration rejects an unregistered pool, a launch that has not migrated and a substituted pool; nothing changes", async () => {
    // Only tx1 (config + create_launch): no pool registered yet.
    const unregistered = await launch({ onlyFirstTx: true });
    const u = (await getLaunch(admin, { launch: unregistered }))!.launch;
    expect(u.poolRegistered).toBe(false);
    await expectError(
      admin.send([syncMigrationIx({ config: u.config, pool: PublicKey.default })], { computeUnitLimit: CU_LIMITS.syncMigration, label: "sync unregistered" }),
      "PoolNotRegistered",
    );

    // Presale: the curve is not complete, DBC has not migrated.
    const presale = await launch({ firstBuy: threshold / 10n });
    const p = await state(presale);
    expect(p.phase).toBe("presale");
    await expectError(admin.send([syncMigrationIx({ config: p.launch.config, pool: p.keys.pool })], { computeUnitLimit: CU_LIMITS.syncMigration, label: "sync presale" }), "MigrationNotComplete");
    expect((await launchAccount(presale)).migrated).toBe(false);
    expect(planCrank(p).some((a) => a.kind === "sync_migration")).toBe(false);

    // A migrated DBC pool of another launch is not this launch's pool.
    const other = await launch({ firstBuy: threshold / 5n });
    await buy(other, threshold * 2n);
    await runCrank(admin, { launch: other });
    const o = await state(other);
    expect(o.launch.migrated).toBe(true);
    const substituted = syncMigrationIx({ config: p.launch.config, pool: o.keys.pool });
    await expectError(admin.send([substituted], { computeUnitLimit: CU_LIMITS.syncMigration, label: "sync substituted pool" }), "InvalidDbcPool");
    expect((await launchAccount(presale)).migrated).toBe(false);
  });
});
