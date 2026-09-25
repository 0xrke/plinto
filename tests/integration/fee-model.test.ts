/**
 * Fee model v3 on the mainnet fork (real stockfloor program, DBC 0.2.1, DAMM v2 0.2.4, Token-2022,
 * SPYx). docs/DECISIONS.md, 2026-09-25, D1-D11:
 *
 * - presale (curve) fees: 0.25%, the whole partner share (80% after Meteora's 20%) goes to the
 *   platform treasury's SPYx ATA; the vault and the creator get nothing from the presale;
 * - graduation: of the partner migration fee, 5% of the threshold T to the platform, 5% of T to
 *   the launch creator, the rest to the vault (vault share 30-60% of T, pool 60-30%);
 * - after graduation: DAMM v2 pool fee 1% with no dynamic fee; LP quote fees split creator 50% /
 *   platform 20% / vault 30% (the vault gets every rounding unit);
 * - payees can never block the floor: an unpayable creator or platform account's share goes to the
 *   vault (presale fees excepted: they stay in DBC);
 * - the split passes through the claimer's SPYx ATA (transit), which is empty after every
 *   instruction; any balance found in it is swept into the vault;
 * - version 2 launches keep paying 100% of every harvest into the vault.
 *
 * Every lifecycle step runs through the FloorTracker (floor monotonic, only redeem takes quote out of
 * the vault, supply reconciliation, transit empty, exact vault / platform / creator parts).
 */
import { BN } from "@coral-xyz/anchor";
import {
  createCloseAccountInstruction,
  createEnableRequiredMemoTransfersInstruction,
  createReallocateInstruction,
  createTransferCheckedInstruction,
  ExtensionType as SplExtensionType,
} from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { dammProgram, dbcProgram, parseCpiEvents, parseEvents } from "../src/anchor.js";
import { DAMM_V2_CONFIG_CUSTOMIZABLE, PLATFORM_TREASURY, SPYX_DECIMALS, SPYX_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/constants.js";
import { dammSwap2Ix, deriveDammPool, deriveDammTokenVault, fetchDammPool, pendingPositionFees } from "../src/damm.js";
import { bnToBig, fetchPoolConfig, fetchVirtualPool, SwapMode } from "../src/dbc.js";
import { CURVE_CLIFF_FEE_NUMERATOR, FeeSplit, graduationSplit, lpFeeSplit } from "../src/fee-model.js";
import { FloorTracker, StepOptions } from "../src/floor-invariants.js";
import { anchorErrorFromLogs, Fork, TxFailure, TxSuccess } from "../src/fork.js";
import { buyOnCurve, fundedWallet, Migration, migrateToDammV2 } from "../src/scenario.js";
import { createStockfloorLaunch, StockfloorLaunch, StockfloorLaunchOptions, trackerAccounts } from "../src/stockfloor-scenario.js";
import {
  createLaunchIx,
  deriveCreatorQuote,
  deriveLaunch,
  fetchLaunch,
  harvestCurveFeesIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  redeemIx,
  registerPoolIx,
  stockfloorProgram,
} from "../src/stockfloor.js";
import { createAta, extensionTypes, mintSupply, setMintPaused, splAta, spyxAta, tokenAccountOwner, tokenAmount } from "../src/token.js";

const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const FEE_DENOMINATOR = 1_000_000_000n;
const none: FeeSplit = { platform: 0n, creator: 0n, vault: 0n };
const opts = (s: FeeSplit): StepOptions => ({ vaultIn: s.vault, platformIn: s.platform, creatorIn: s.creator });

/** Token account `state` byte (1 initialized, 2 frozen). */
const setAccountState = (fork: Fork, account: PublicKey, state: number) => fork.patchAccount(account, (d) => (d[108] = state));

/** Cheatcode: SPL / Token-2022 delegate (COption at 72, delegated amount at 121). */
function setDelegate(fork: Fork, account: PublicKey, delegate: PublicKey | null): void {
  fork.patchAccount(account, (d) => {
    d.writeUInt32LE(delegate ? 1 : 0, 72);
    (delegate ?? PublicKey.default).toBuffer().copy(d, 76);
    d.writeBigUInt64LE(delegate ? 1_000_000n : 0n, 121);
  });
}

/** Cheatcode: append an enabled Token-2022 CpiGuard extension (type 11, 1 byte) to a token account. */
function enableCpiGuard(fork: Fork, account: PublicKey): Buffer {
  const acc = fork.mustGetAccount(account);
  const original = Buffer.from(acc.data);
  const tlv = Buffer.from([11, 0, 1, 0, 1]);
  fork.setAccount(account, { lamports: BigInt(acc.lamports) + 10_000_000n, owner: acc.owner, data: Buffer.concat([original, tlv]) });
  return original;
}

function restoreAccountData(fork: Fork, account: PublicKey, data: Buffer): void {
  const acc = fork.mustGetAccount(account);
  fork.setAccount(account, { lamports: acc.lamports, owner: acc.owner, data });
}

/** Partner share of one DBC swap from its EvtSwap2 (creator trading share is 0). */
function dbcSwapFees(res: TxSuccess) {
  const evs = parseCpiEvents(dbcProgram(), res).filter((e) => e.name.toLowerCase() === "evtswap2");
  expect(evs.length).toBe(1);
  const r = evs[0].data.swapResult;
  const trading = bnToBig(r.tradingFee);
  const protocol = bnToBig(r.protocolFee);
  const referral = bnToBig(r.referralFee);
  return { includedFeeInput: bnToBig(r.includedFeeInputAmount), totalFee: trading + protocol + referral, protocol, partner: trading };
}

function dammSwapFee(res: TxSuccess): bigint {
  const evs = parseCpiEvents(dammProgram(), res).filter((e) => e.name.toLowerCase() === "evtswap2");
  expect(evs.length).toBe(1);
  const r = evs[0].data.swapResult;
  return bnToBig(r.claimingFee) + bnToBig(r.protocolFee) + bnToBig(r.compoundingFee) + bnToBig(r.referralFee ?? new BN(0));
}

function feesDistributed(res: TxSuccess) {
  const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "feesDistributed");
  if (!ev) return null;
  const d = ev.data;
  return {
    source: d.source as number,
    received: bnToBig(d.received),
    platform: bnToBig(d.platformAmount),
    creator: bnToBig(d.creatorAmount),
    vault: bnToBig(d.vaultAmount),
    platformFallback: d.platformFallback as boolean,
    creatorFallback: d.creatorFallback as boolean,
  };
}

function lpArgs(L: StockfloorLaunch, m: Migration, payer: PublicKey, overrides: Partial<Record<string, PublicKey>> = {}) {
  return {
    payer,
    keys: L.keys,
    dammPool: m.dammPool,
    position: m.firstPosition,
    positionNftAccount: m.firstPositionNftAccount,
    dammTokenAVault: m.tokenAVault,
    dammTokenBVault: m.tokenBVault,
    overrides,
  };
}

/** DAMM v2 base vault of the pool DBC migrates the launch into (receives base at migration). */
const dammBaseVault = (L: StockfloorLaunch) => deriveDammTokenVault(deriveDammPool(DAMM_V2_CONFIG_CUSTOMIZABLE, L.keys.baseMint, SPYX_MINT), L.keys.baseMint);

/** Partner migration fee DBC pays for threshold T at migration_fee_percentage mf (creator share 0). */
const partnerFee = (T: bigint, mf: number) => T - ceilDiv(T * BigInt(100 - mf), 100n);

interface Graduated {
  L: StockfloorLaunch;
  m: Migration;
  tracker: FloorTracker;
  holders: Keypair[];
  cranker: Keypair;
}

/**
 * A launch taken through curve buys (tracked), a PartialFill completion and the migration, with a
 * FloorTracker that also watches the transit and the payee accounts.
 */
async function graduated(fork: Fork, o: StockfloorLaunchOptions = {}, fractionsPct: bigint[] = [25n, 15n]): Promise<Graduated> {
  const L = await createStockfloorLaunch(fork, o);
  const tracker = new FloorTracker(fork, trackerAccounts(L));
  tracker.trackBase(L.keys.baseVault);
  tracker.start("registered");
  const holders: Keypair[] = [];
  for (const pct of fractionsPct) {
    const w = fundedWallet(fork, L.threshold);
    tracker.trackBase(splAta(w.publicKey, L.keys.baseMint));
    await tracker.step(`curve buy ${pct}%`, "no-outflow", () => buyOnCurve(fork, L.keys, w, (L.threshold * pct) / 100n));
    holders.push(w);
  }
  const remaining = L.threshold - bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve);
  const offered = (remaining * 11n) / 10n + 1_000_000n;
  const whale = fundedWallet(fork, offered);
  tracker.trackBase(splAta(whale.publicKey, L.keys.baseMint));
  await tracker.step("completing buy", "no-outflow", () => buyOnCurve(fork, L.keys, whale, offered, SwapMode.PartialFill));
  holders.push(whale);
  let m!: Migration;
  tracker.trackBase(dammBaseVault(L));
  await tracker.step("migration", "no-outflow", async () => {
    m = await migrateToDammV2(fork, L.keys);
  });
  tracker.trackBase(m.tokenAVault);
  return { L, m, tracker, holders, cranker: fork.newWallet(10) };
}

/** A DAMM v2 buy and a sell by a new trader, tracked; returns the trader. */
async function dammTrades(fork: Fork, g: Graduated, quoteIn: bigint): Promise<Keypair> {
  const { L, m, tracker } = g;
  const w = fundedWallet(fork, quoteIn);
  const base = createAta(fork, w, w.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID);
  tracker.trackBase(base);
  await tracker.step("damm buy", "no-outflow", async () =>
    fork.send([await dammSwap2Ix({ keys: m.dammKeys, payer: w.publicKey, inputTokenAccount: spyxAta(w.publicKey), outputTokenAccount: base, amount0: quoteIn, amount1: 0n, swapMode: 0 })], [w]),
  );
  await tracker.step("damm sell", "no-outflow", async () =>
    fork.send([await dammSwap2Ix({ keys: m.dammKeys, payer: w.publicKey, inputTokenAccount: base, outputTokenAccount: spyxAta(w.publicKey), amount0: tokenAmount(fork, base) / 2n, amount1: 0n, swapMode: 0 })], [w]),
  );
  g.holders.push(w);
  return w;
}

const balances = (fork: Fork, L: StockfloorLaunch) => ({
  vault: tokenAmount(fork, L.vault),
  platform: fork.getAccount(L.platformQuoteAccount) ? tokenAmount(fork, L.platformQuoteAccount) : 0n,
  creator: fork.getAccount(L.creatorQuoteAccount) ? tokenAmount(fork, L.creatorQuoteAccount) : 0n,
  transit: tokenAmount(fork, L.claimerQuoteAccount),
});

/** Exact redemption as a tracked step. */
async function redeemTracked(fork: Fork, g: Graduated, holder: Keypair, amount: bigint): Promise<bigint> {
  const V = tokenAmount(fork, g.L.vault);
  const S = mintSupply(fork, g.L.keys.baseMint);
  const gross = (V * amount) / S;
  const fee = ceilDiv(gross * BigInt(g.L.exitFeeBps), 10_000n);
  await g.tracker.step("redeem", "redeem", async () => fork.send([await redeemIx({ holder: holder.publicKey, keys: g.L.keys, amount })], [holder]), {
    vaultOut: gross - fee,
    feeRetained: fee,
  });
  return gross - fee;
}

// ====================================================================================================

describe("fee model v3: lifecycle (flat preset, vault 50% / pool 40%, $1,000)", () => {
  it("presale fees to the platform, graduation 5/5/rest, 1% DAMM v2 pool, LP fees 50/20/30, redeem; the floor never decreases", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, { preset: "flat", vaultSharePct: 50 });
    const T = L.threshold;
    const cfg = fetchPoolConfig(fork, L.config);
    expect(cfg.migrationFeePercentage).toBe(60);
    expect(cfg.creatorTradingFeePercentage).toBe(0);
    expect(bnToBig(cfg.poolFees.baseFee.cliffFeeNumerator)).toBe(CURVE_CLIFF_FEE_NUMERATOR);
    expect(fetchLaunch(fork, L.config).version).toBe(3);
    const tracker = new FloorTracker(fork, trackerAccounts(L));
    tracker.trackBase(L.keys.baseVault);
    tracker.start("registered");
    const c = fork.newWallet(10);
    const g: Graduated = { L, m: undefined as never, tracker, holders: [], cranker: c };
    const paid = { platform: 0n, creator: 0n, vault: 0n };

    // ---- presale: buys, then harvest_curve_fees pays exactly the partner share to the platform.
    let partner = 0n;
    for (const pct of [20n, 15n, 10n]) {
      const w = fundedWallet(fork, T);
      tracker.trackBase(splAta(w.publicKey, L.keys.baseMint));
      const quoteIn = (T * pct) / 100n;
      const res = await tracker.step(`curve buy ${pct}%`, "no-outflow", () => buyOnCurve(fork, L.keys, w, quoteIn));
      const s = dbcSwapFees(res);
      expect(s.totalFee).toBe(ceilDiv(quoteIn * CURVE_CLIFF_FEE_NUMERATOR, FEE_DENOMINATOR)); // 0.25%, rounded up
      expect(s.protocol).toBe((s.totalFee * 20n) / 100n); // Meteora's 20%
      partner += s.partner; // the other 80%, all of it the partner's (creator trading share 0)
      g.holders.push(w);
    }
    expect(bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee)).toBe(partner);
    expect(bnToBig(fetchVirtualPool(fork, L.keys.pool).creatorQuoteFee)).toBe(0n);
    let res = await tracker.step("harvest_curve_fees", "no-outflow", async () => fork.send([await harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys })], [c]), {
      ...opts({ ...none, platform: partner }),
    });
    expect(feesDistributed(res)).toEqual({ source: 0, received: partner, platform: partner, creator: 0n, vault: 0n, platformFallback: false, creatorFallback: false });
    paid.platform += partner;
    // A second harvest finds nothing and changes no balance.
    const b0 = balances(fork, L);
    await tracker.step("harvest_curve_fees again", "no-outflow", async () => fork.send([await harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys })], [c]), opts(none));
    expect(balances(fork, L)).toEqual(b0);

    // ---- completion and migration: the DAMM v2 pool has a fixed 1% fee and no dynamic fee.
    const remaining = T - bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve);
    const whale = fundedWallet(fork, remaining * 2n);
    tracker.trackBase(splAta(whale.publicKey, L.keys.baseMint));
    res = await tracker.step("completing buy", "no-outflow", () => buyOnCurve(fork, L.keys, whale, (remaining * 11n) / 10n + 1_000_000n, SwapMode.PartialFill));
    const completionPartner = dbcSwapFees(res).partner;
    g.holders.push(whale);
    tracker.trackBase(dammBaseVault(L));
  await tracker.step("migration", "no-outflow", async () => {
      g.m = await migrateToDammV2(fork, L.keys);
    });
    tracker.trackBase(g.m.tokenAVault);
    const damm = fetchDammPool(fork, g.m.dammPool);
    expect(Buffer.from(damm.poolFees.baseFee.baseFeeInfo.data).readBigUInt64LE(0)).toBe(10_000_000n); // 1% of 1e9
    expect(damm.poolFees.dynamicFee.initialized).toBe(0);
    expect(damm.poolFees.compoundingFeeBps).toBe(0);
    expect(damm.collectFeeMode).toBe(1); // OnlyB: quote only
    // Pool share 40% of the raise (DBC: ceil(T * (100 - 60) / 100), minus 0.2% protocol liquidity fee).
    const q = ceilDiv(T * 40n, 100n);
    expect(bnToBig(damm.tokenBAmount)).toBe(q - (q * 20n) / 10_000n);

    // ---- graduation: 5% of T to the platform, 5% of T to launch.creator, the rest to the vault.
    const mig = graduationSplit(T, partnerFee(T, 60));
    expect([mig.platform, mig.creator]).toEqual([T / 20n, T / 20n]);
    res = await tracker.step("harvest_migration_fee", "no-outflow", async () => fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [c]), opts(mig));
    expect(feesDistributed(res)).toEqual({ source: 1, received: partnerFee(T, 60), ...mig, platformFallback: false, creatorFallback: false });
    expect(tokenAccountOwner(fork, L.creatorQuoteAccount).equals(L.creator.publicKey)).toBe(true);
    expect(tokenAccountOwner(fork, L.platformQuoteAccount).equals(PLATFORM_TREASURY)).toBe(true);
    paid.platform += mig.platform;
    paid.creator += mig.creator;
    paid.vault += mig.vault;
    expect(errName(fork.sendExpectFail([await harvestMigrationFeeIx({ keys: L.keys })], [c]))).toBe("MigrationFeeAlreadyHarvested");
    // The completing buy's presale fee still goes to the platform, after migration too.
    await tracker.step("harvest_curve_fees after migration", "no-outflow", async () => fork.send([await harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys })], [c]), {
      ...opts({ ...none, platform: completionPartner }),
    });
    paid.platform += completionPartner;
    const surplus = ((bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve) - T) * 80n) / 100n;
    await tracker.step("harvest_surplus", "no-outflow", async () => fork.send([await harvestSurplusIx({ keys: L.keys })], [c]), opts({ ...none, vault: surplus }));
    paid.vault += surplus;

    // ---- DAMM v2 trading at 1%, then harvest_lp_fees splits 50 / 20 / 30.
    fork.warp(60);
    const trader = fundedWallet(fork, T);
    const traderBase = createAta(fork, trader, trader.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID);
    tracker.trackBase(traderBase);
    const buyIn = T / 5n;
    res = await tracker.step("damm buy", "no-outflow", async () =>
      fork.send([await dammSwap2Ix({ keys: g.m.dammKeys, payer: trader.publicKey, inputTokenAccount: spyxAta(trader.publicKey), outputTokenAccount: traderBase, amount0: buyIn, amount1: 0n, swapMode: 0 })], [trader]),
    );
    const fee = dammSwapFee(res);
    expect(fee >= buyIn / 100n && fee <= buyIn / 100n + 1n, `DAMM v2 fee ${fee} on ${buyIn}`).toBe(true);
    await tracker.step("damm sell", "no-outflow", async () =>
      fork.send([await dammSwap2Ix({ keys: g.m.dammKeys, payer: trader.publicKey, inputTokenAccount: traderBase, outputTokenAccount: spyxAta(trader.publicKey), amount0: tokenAmount(fork, traderBase) / 2n, amount1: 0n, swapMode: 0 })], [trader]),
    );
    g.holders.push(trader);
    const pending = pendingPositionFees(fork, g.m.dammPool, g.m.firstPosition);
    expect(pending.a).toBe(0n);
    const lp = lpFeeSplit(pending.b);
    const s0 = mintSupply(fork, L.keys.baseMint);
    res = await tracker.step("harvest_lp_fees", "no-outflow", async () => fork.send([await harvestLpFeesIx(lpArgs(L, g.m, c.publicKey))], [c]), opts(lp));
    expect(mintSupply(fork, L.keys.baseMint)).toBe(s0);
    expect(feesDistributed(res)).toEqual({ source: 2, received: pending.b, ...lp, platformFallback: false, creatorFallback: false });
    expect([lp.creator, lp.platform]).toEqual([pending.b / 2n, pending.b / 5n]);
    paid.platform += lp.platform;
    paid.creator += lp.creator;
    paid.vault += lp.vault;
    // A second LP harvest pays 0 and changes no balance.
    const b1 = balances(fork, L);
    res = await tracker.step("harvest_lp_fees again", "no-outflow", async () => fork.send([await harvestLpFeesIx(lpArgs(L, g.m, c.publicKey))], [c]), opts(none));
    expect(balances(fork, L)).toEqual(b1);
    expect(feesDistributed(res)).toEqual({ source: 2, received: 0n, platform: 0n, creator: 0n, vault: 0n, platformFallback: false, creatorFallback: false });

    // ---- redemptions; the counters reconcile.
    for (const h of g.holders.slice(0, 3)) await redeemTracked(fork, g, h, tokenAmount(fork, splAta(h.publicKey, L.keys.baseMint)) / 2n);
    const launch = fetchLaunch(fork, L.config);
    expect(bnToBig(launch.totalPlatformQuote)).toBe(paid.platform);
    expect(bnToBig(launch.totalCreatorQuote)).toBe(paid.creator);
    expect(bnToBig(launch.totalHarvestedQuote)).toBe(paid.vault);
    expect(tokenAmount(fork, L.platformQuoteAccount)).toBe(paid.platform);
    expect(tokenAmount(fork, L.creatorQuoteAccount)).toBe(paid.creator);
    expect(tokenAmount(fork, L.claimerQuoteAccount)).toBe(0n);
    console.log(JSON.stringify({ feeModelLifecycle: { T, paid, migration: mig, lp, presalePlatform: partner + completionPartner } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });
});

// ====================================================================================================

describe("fee model v3: graduation bounds (vault 30-60% of the raise, pool 60-30%)", () => {
  it("vault shares 30% and 60% (migration fee 40% and 70%) are accepted; 39% and 71% are accepted by DBC and rejected by create_launch", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    for (const [share, mf] of [
      [30, 40],
      [60, 70],
    ] as const) {
      const L = await createStockfloorLaunch(fork, { vaultSharePct: share });
      expect(fetchPoolConfig(fork, L.config).migrationFeePercentage).toBe(mf);
      expect(fetchLaunch(fork, L.config).version).toBe(3);
    }
    for (const mf of [39, 71]) {
      const L = await createStockfloorLaunch(fork, { skipCreateLaunch: true, mutateParams: (p) => (p.migrationFee.feePercentage = mf) });
      expect(fetchPoolConfig(fork, L.config).migrationFeePercentage).toBe(mf);
      const f = fork.sendExpectFail(
        [await createLaunchIx({ payer: L.partner.publicKey, creator: L.creator.publicKey, config: L.config, baseMint: L.keys.baseMint, exitFeeBps: 200 })],
        [L.partner, L.creator, L.configKeypair],
      );
      expect(errName(f), `mf ${mf}`).toBe("MigrationFeePercentageOutOfRange");
      expect(fork.getAccount(deriveLaunch(L.config))).toBeNull();
    }
  });

  it("a threshold whose vault part rounds to zero is rejected; the smallest one that pays the vault is accepted (mf 40)", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    for (const [threshold, expected] of [
      [2n, "MigrationQuoteThresholdTooSmall"], // partner fee 2 - ceil(1.2) = 0
      [3n, null], // partner fee 1, cuts 0 (T < 20): all of it to the vault
    ] as const) {
      const L = await createStockfloorLaunch(fork, {
        skipCreateLaunch: true,
        vaultSharePct: 30,
        mutateParams: (p) => (p.migrationQuoteThreshold = new BN(threshold.toString())),
      });
      expect(bnToBig(fetchPoolConfig(fork, L.config).migrationQuoteThreshold)).toBe(threshold);
      const ix = await createLaunchIx({ payer: L.partner.publicKey, creator: L.creator.publicKey, config: L.config, baseMint: L.keys.baseMint, exitFeeBps: 200 });
      const signers = [L.partner, L.creator, L.configKeypair];
      if (expected) expect(errName(fork.sendExpectFail([ix], signers)), `T=${threshold}`).toBe(expected);
      else fork.send([ix], signers);
    }
  });
});

// ====================================================================================================

describe("fee model v3: create_launch closes the migrated-pool validation gaps (regression of audit F04 / F05)", () => {
  const cases: Array<[string, (p: any) => void, string]> = [
    [
      "fixed migration fee option FixedBps100 (Meteora's static DAMM v2 config)",
      (p) => {
        p.migrationFeeOption = 2;
        p.migratedPoolFee = { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 0 };
      },
      "MigratedPoolFeeInvalid",
    ],
    ["Customizable with a 0.99% migrated pool fee", (p) => (p.migratedPoolFee.poolFeeBps = 99), "MigratedPoolFeeInvalid"],
    ["Customizable with a 2% migrated pool fee", (p) => (p.migratedPoolFee.poolFeeBps = 200), "MigratedPoolFeeInvalid"],
    ["migrated pool dynamic fee on", (p) => (p.migratedPoolFee.dynamicFee = 1), "MigratedDynamicFeeNotAllowed"],
    ["migrated pool base fee mode 1 (exponential time scheduler)", (p) => (p.migratedPoolBaseFeeMode = 1), "MigratedPoolFeeInvalid"],
    [
      "migrated pool base fee mode 3 (market-cap scheduler)",
      (p) => {
        p.migratedPoolBaseFeeMode = 3;
        p.migratedPoolMarketCapFeeSchedulerParams = { numberOfPeriod: 10, sqrtPriceStepBps: 100, schedulerExpirationDuration: 86_400, reductionFactor: new BN(5) };
      },
      "MigratedPoolFeeInvalid",
    ],
    ["first swap with the minimum fee", (p) => (p.enableFirstSwapWithMinFee = true), "FirstSwapWithMinFeeNotAllowed"],
    ["creator trading fee share 1%", (p) => (p.creatorTradingFeePercentage = 1), "CreatorTradingFeeTooHigh"],
  ];

  it("the real DBC accepts each config; create_launch rejects it with the named error and creates nothing", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    for (const [label, mutate, expected] of cases) {
      const L = await createStockfloorLaunch(fork, { mutateParams: mutate, skipCreateLaunch: true });
      expect(fork.getAccount(L.config)?.owner.toBase58(), `${label}: DBC stored the config`).toBe("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
      const f = fork.sendExpectFail(
        [await createLaunchIx({ payer: L.partner.publicKey, creator: L.creator.publicKey, config: L.config, baseMint: L.keys.baseMint, exitFeeBps: 200 })],
        [L.partner, L.creator, L.configKeypair],
      );
      expect(errName(f), label).toBe(expected);
      expect(fork.getAccount(deriveLaunch(L.config)), label).toBeNull();
    }
  });
});

// ====================================================================================================

describe("fee model v3: payees can never block the floor", () => {
  /**
   * The migration and LP harvests as tracked steps; `unpayable` names the payee whose share must
   * fall back to the vault. Returns the nominal splits and the FeesDistributed events.
   */
  async function harvestAll(fork: Fork, g: Graduated, unpayable: "platform" | "creator") {
    const T = g.L.threshold;
    const fallback = (s: FeeSplit): StepOptions => ({
      vaultIn: s.vault + s[unpayable],
      platformIn: unpayable === "platform" ? 0n : s.platform,
      creatorIn: unpayable === "creator" ? 0n : s.creator,
    });
    const mig = graduationSplit(T, partnerFee(T, 60));
    const migRes = await g.tracker.step("harvest_migration_fee", "no-outflow", async () => fork.send([await harvestMigrationFeeIx({ keys: g.L.keys })], [g.cranker]), fallback(mig));
    const lp = lpFeeSplit(pendingPositionFees(fork, g.m.dammPool, g.m.firstPosition).b);
    const lpRes = await g.tracker.step("harvest_lp_fees", "no-outflow", async () => fork.send([await harvestLpFeesIx(lpArgs(g.L, g.m, g.cranker.publicKey))], [g.cranker]), fallback(lp));
    return { mig, lp, migEvent: feesDistributed(migRes)!, lpEvent: feesDistributed(lpRes)!, T };
  }

  it("creator ATA closed, frozen or requiring memos: the creator's shares go to the vault; harvests and redeem succeed", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const blockers: Array<[string, (L: StockfloorLaunch) => void]> = [
      ["closed by the creator", (L) => fork.send([createCloseAccountInstruction(L.creatorQuoteAccount, L.creator.publicKey, L.creator.publicKey, [], TOKEN_2022_PROGRAM_ID)], [L.creator])],
      ["frozen by the issuer (cheatcode)", (L) => setAccountState(fork, L.creatorQuoteAccount, 2)],
      [
        "incoming memos required (real Token-2022 instructions)",
        (L) =>
          fork.send(
            [
              createReallocateInstruction(L.creatorQuoteAccount, L.creator.publicKey, [SplExtensionType.MemoTransfer], L.creator.publicKey, [], TOKEN_2022_PROGRAM_ID),
              createEnableRequiredMemoTransfersInstruction(L.creatorQuoteAccount, L.creator.publicKey, [], TOKEN_2022_PROGRAM_ID),
            ],
            [L.creator],
          ),
      ],
    ];
    for (const [label, block] of blockers) {
      const g = await graduated(fork);
      fork.warp(60);
      await dammTrades(fork, g, g.L.threshold / 5n);
      block(g.L);
      if (label.startsWith("incoming")) expect(extensionTypes(fork.mustGetAccount(g.L.creatorQuoteAccount).data)).toContain(8); // MemoTransfer
      const b0 = balances(fork, g.L);
      const { mig, lp, migEvent, lpEvent } = await harvestAll(fork, g, "creator");
      const b1 = balances(fork, g.L);
      expect(b1.vault - b0.vault, label).toBe(mig.vault + mig.creator + lp.vault + lp.creator);
      expect(b1.platform - b0.platform, label).toBe(mig.platform + lp.platform);
      expect(b1.creator, label).toBe(b0.creator); // nothing reached the creator
      expect(b1.transit, label).toBe(0n);
      expect([migEvent.creator, migEvent.creatorFallback, migEvent.vault], label).toEqual([0n, true, mig.vault + mig.creator]);
      expect([lpEvent.creator, lpEvent.creatorFallback, lpEvent.platformFallback], label).toEqual([0n, true, false]);
      expect(fetchLaunch(fork, g.L.config).migrationFeeHarvested, label).toBe(true);
      expect(bnToBig(fetchLaunch(fork, g.L.config).totalCreatorQuote), label).toBe(0n);
      // Redemptions are open.
      const h = g.holders[0];
      await redeemTracked(fork, g, h, tokenAmount(fork, splAta(h.publicKey, g.L.keys.baseMint)) / 3n);
    }
  });

  it("platform ATA frozen: migration and LP platform shares go to the vault; presale fees fail with PlatformQuoteAccountUnavailable and stay in DBC", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const g = await graduated(fork);
    fork.warp(60);
    await dammTrades(fork, g, g.L.threshold / 5n);
    const L = g.L;
    setAccountState(fork, L.platformQuoteAccount, 2);

    // Presale fees: the harvest fails and changes nothing; the fees stay claimable in DBC.
    const pendingCurve = bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee);
    expect(pendingCurve).toBeGreaterThan(0n);
    const b0 = balances(fork, L);
    expect(errName(fork.sendExpectFail([await harvestCurveFeesIx({ payer: g.cranker.publicKey, keys: L.keys })], [g.cranker]))).toBe("PlatformQuoteAccountUnavailable");
    expect(balances(fork, L)).toEqual(b0);
    expect(bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee)).toBe(pendingCurve);

    // Migration fee and LP fees: the platform's share falls back to the vault.
    const { mig, lp, migEvent, lpEvent } = await harvestAll(fork, g, "platform");
    const b1 = balances(fork, L);
    expect(b1.vault - b0.vault).toBe(mig.vault + mig.platform + lp.vault + lp.platform);
    expect(b1.creator - b0.creator).toBe(mig.creator + lp.creator);
    expect(b1.platform).toBe(b0.platform);
    expect([migEvent.platformFallback, migEvent.creatorFallback, lpEvent.platformFallback]).toEqual([true, false, true]);

    // Unfrozen: the presale fees reach the platform.
    setAccountState(fork, L.platformQuoteAccount, 1);
    fork.send([await harvestCurveFeesIx({ payer: g.cranker.publicKey, keys: L.keys })], [g.cranker]);
    expect(tokenAmount(fork, L.platformQuoteAccount) - b1.platform).toBe(pendingCurve);
  });

  it("SPYx paused: every harvest fails with QuoteMintPaused and changes nothing; after unpause they pay the exact split", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const g = await graduated(fork);
    fork.warp(60);
    await dammTrades(fork, g, g.L.threshold / 5n);
    const L = g.L;
    setMintPaused(fork, SPYX_MINT, true);
    const b0 = balances(fork, L);
    const ixs: Array<[string, Promise<TransactionInstruction>]> = [
      ["harvest_curve_fees", harvestCurveFeesIx({ payer: g.cranker.publicKey, keys: L.keys })],
      ["harvest_migration_fee", harvestMigrationFeeIx({ keys: L.keys })],
      ["harvest_surplus", harvestSurplusIx({ keys: L.keys })],
      ["harvest_lp_fees", harvestLpFeesIx(lpArgs(L, g.m, g.cranker.publicKey))],
    ];
    for (const [label, ix] of ixs) expect(errName(fork.sendExpectFail([await ix], [g.cranker])), label).toBe("QuoteMintPaused");
    expect(balances(fork, L)).toEqual(b0);
    expect(fetchLaunch(fork, L.config).migrationFeeHarvested).toBe(false);
    setMintPaused(fork, SPYX_MINT, false);
    const curve = bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee);
    await g.tracker.step("harvest_curve_fees after unpause", "no-outflow", async () => fork.send([await harvestCurveFeesIx({ payer: g.cranker.publicKey, keys: L.keys })], [g.cranker]), {
      ...opts({ ...none, platform: curve }),
    });
    const mig = graduationSplit(L.threshold, partnerFee(L.threshold, 60));
    await g.tracker.step("harvest_migration_fee after unpause", "no-outflow", async () => fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [g.cranker]), opts(mig));
  });
});

// ====================================================================================================

describe("fee model v3: the transit account", () => {
  it("a donation to the transit is swept into the vault by the next split (migration fee, LP fees); the transit ends empty", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const g = await graduated(fork);
    fork.warp(60);
    await dammTrades(fork, g, g.L.threshold / 5n);
    const L = g.L;
    const donor = fundedWallet(fork, 10_000_000n);
    for (const [label, donation, harvest, split] of [
      ["harvest_migration_fee", 1_234_567n, () => harvestMigrationFeeIx({ keys: L.keys }), () => graduationSplit(L.threshold, partnerFee(L.threshold, 60))],
      ["harvest_lp_fees", 7n, () => harvestLpFeesIx(lpArgs(L, g.m, g.cranker.publicKey)), () => lpFeeSplit(pendingPositionFees(fork, g.m.dammPool, g.m.firstPosition).b)],
    ] as const) {
      await g.tracker.step(`donation to the transit before ${label}`, "donation", async () =>
        fork.send([createTransferCheckedInstruction(spyxAta(donor.publicKey), SPYX_MINT, L.claimerQuoteAccount, donor.publicKey, donation, SPYX_DECIMALS, [], TOKEN_2022_PROGRAM_ID)], [donor]),
      );
      expect(tokenAmount(fork, L.claimerQuoteAccount)).toBe(donation);
      const s = split();
      const res = await g.tracker.step(label, "no-outflow", async () => fork.send([await harvest()], [g.cranker]), opts({ ...s, vault: s.vault + donation }));
      const ev = feesDistributed(res)!;
      expect([ev.received, ev.platform, ev.creator, ev.vault], label).toEqual([s.platform + s.creator + s.vault, s.platform, s.creator, s.vault + donation]);
      expect(tokenAmount(fork, L.claimerQuoteAccount), label).toBe(0n);
    }
  });

  it("a delegate or an enabled CPI Guard on the transit (cheatcodes) fails the split harvests with ClaimerQuoteAccountEncumbered; nothing changes", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const g = await graduated(fork);
    fork.warp(60);
    await dammTrades(fork, g, g.L.threshold / 5n);
    const L = g.L;
    const harvests = () =>
      [
        ["harvest_migration_fee", harvestMigrationFeeIx({ keys: L.keys })],
        ["harvest_lp_fees", harvestLpFeesIx(lpArgs(L, g.m, g.cranker.publicKey))],
      ] as const;
    const b0 = balances(fork, L);
    setDelegate(fork, L.claimerQuoteAccount, Keypair.generate().publicKey);
    for (const [label, ix] of harvests()) expect(errName(fork.sendExpectFail([await ix], [g.cranker])), `${label}, delegate`).toBe("ClaimerQuoteAccountEncumbered");
    setDelegate(fork, L.claimerQuoteAccount, null);
    const original = enableCpiGuard(fork, L.claimerQuoteAccount);
    expect(extensionTypes(fork.mustGetAccount(L.claimerQuoteAccount).data)).toContain(11);
    for (const [label, ix] of harvests()) expect(errName(fork.sendExpectFail([await ix], [g.cranker])), `${label}, CPI Guard`).toBe("ClaimerQuoteAccountEncumbered");
    restoreAccountData(fork, L.claimerQuoteAccount, original);
    expect(balances(fork, L)).toEqual(b0);
    expect(fetchLaunch(fork, L.config).migrationFeeHarvested).toBe(false);
    for (const [, ix] of harvests()) fork.send([await ix], [g.cranker]);
    expect(fetchLaunch(fork, L.config).migrationFeeHarvested).toBe(true);
  });
});

// ====================================================================================================

describe("fee model v3: the creator payee is launch.creator (the create_launch signer), not the pool creator", () => {
  it("a pool created by another wallet: the bonus and LP share reach launch.creator; the pool creator's ATA is rejected", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    // createStockfloorLaunch creates the DBC pool with L.creator; create_launch is then signed by
    // another wallet, which becomes launch.creator.
    const L = await createStockfloorLaunch(fork, { skipCreateLaunch: true });
    const launchCreator = fork.newWallet();
    fork.send(
      [await createLaunchIx({ payer: L.partner.publicKey, creator: launchCreator.publicKey, config: L.config, baseMint: L.keys.baseMint, exitFeeBps: 200 })],
      [L.partner, launchCreator, L.configKeypair],
    );
    fork.send([await registerPoolIx({ config: L.config, pool: L.keys.pool, baseMint: L.keys.baseMint })], [fork.newWallet(1)]);
    expect(fetchLaunch(fork, L.config).creator.equals(launchCreator.publicKey)).toBe(true);
    expect(fetchVirtualPool(fork, L.keys.pool).creator.equals(L.creator.publicKey)).toBe(true);
    const launchCreatorQuote = deriveCreatorQuote(launchCreator.publicKey);
    expect(tokenAccountOwner(fork, launchCreatorQuote).equals(launchCreator.publicKey)).toBe(true);

    const buyer = fundedWallet(fork, L.threshold);
    await buyOnCurve(fork, L.keys, buyer, (L.threshold * 30n) / 100n);
    const remaining = L.threshold - bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve);
    const whale = fundedWallet(fork, remaining * 2n);
    await buyOnCurve(fork, L.keys, whale, (remaining * 11n) / 10n + 1_000_000n, SwapMode.PartialFill);
    await migrateToDammV2(fork, L.keys);
    const c = fork.newWallet(1);
    // The pool creator's ATA (the builder pointed at pool.creator) is rejected.
    createAta(fork, c, L.creator.publicKey, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    expect(errName(fork.sendExpectFail([await harvestMigrationFeeIx({ keys: L.keys, creator: L.creator.publicKey })], [c]))).toBe("PayeeAccountMismatch");
    const mig = graduationSplit(L.threshold, partnerFee(L.threshold, 60));
    fork.send([await harvestMigrationFeeIx({ keys: L.keys, creator: launchCreator.publicKey })], [c]);
    expect(tokenAmount(fork, launchCreatorQuote)).toBe(mig.creator);
    expect(tokenAmount(fork, spyxAta(L.creator.publicKey))).toBe(0n);
  });
});

// ====================================================================================================

describe("fee model v3: exact rounding on the fork", () => {
  it("thresholds T = 20k + r (r = 0, 1, 7, 13, 19): platform and creator get exactly floor(T/20), the vault the rest", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    for (const r of [0n, 1n, 7n, 13n, 19n]) {
      let T = 0n;
      const g = await graduated(
        fork,
        {
          mutateParams: (p) => {
            const t0 = bnToBig(p.migrationQuoteThreshold);
            T = t0 - (t0 % 20n) - 20n + r; // below the designed threshold, so the curve still reaches it
            p.migrationQuoteThreshold = new BN(T.toString());
          },
        },
        [30n],
      );
      expect(g.L.threshold % 20n).toBe(r);
      const mig = graduationSplit(T, partnerFee(T, 60));
      expect(mig.platform + mig.creator + mig.vault).toBe(partnerFee(T, 60));
      expect([mig.platform, mig.creator]).toEqual([T / 20n, T / 20n]);
      await g.tracker.step(`harvest_migration_fee T mod 20 = ${r}`, "no-outflow", async () => fork.send([await harvestMigrationFeeIx({ keys: g.L.keys })], [g.cranker]), opts(mig));
    }
  });

  it("LP fees q = 1, 2, 3, 9, 11 raw (position fee patched): creator floor(q/2), platform floor(q/5), vault the rest", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const g = await graduated(fork);
    const mig = graduationSplit(g.L.threshold, partnerFee(g.L.threshold, 60));
    await g.tracker.step("harvest_migration_fee", "no-outflow", async () => fork.send([await harvestMigrationFeeIx({ keys: g.L.keys })], [g.cranker]), opts(mig));
    for (const q of [1n, 2n, 3n, 9n, 11n]) {
      // Position.fee_b_pending (8 + 136); no swaps in between, so the claim is exactly q.
      fork.patchAccount(g.m.firstPosition, (d) => d.writeBigUInt64LE(q, 8 + 136));
      expect(pendingPositionFees(fork, g.m.dammPool, g.m.firstPosition).b).toBe(q);
      const s = lpFeeSplit(q);
      expect(s.platform + s.creator + s.vault).toBe(q);
      const res = await g.tracker.step(`harvest_lp_fees q=${q}`, "no-outflow", async () => fork.send([await harvestLpFeesIx(lpArgs(g.L, g.m, g.cranker.publicKey))], [g.cranker]), opts(s));
      expect(feesDistributed(res)!.received).toBe(q);
    }
  });
});

// ====================================================================================================

describe("fee model: version 2 launches keep their original promise (cheatcode version = 2)", () => {
  it("every harvest pays 100% into the vault; the platform, the creator and the transit are untouched", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    fork.patchAccount(deriveLaunch(L.config), (d) => (d[8] = 2));
    expect(fetchLaunch(fork, L.config).version).toBe(2);
    const tracker = new FloorTracker(fork, trackerAccounts(L));
    tracker.trackBase(L.keys.baseVault);
    tracker.start("v2 launch");
    const g: Graduated = { L, m: undefined as never, tracker, holders: [], cranker: fork.newWallet(10) };
    const c = g.cranker;
    const buyer = fundedWallet(fork, L.threshold);
    tracker.trackBase(splAta(buyer.publicKey, L.keys.baseMint));
    await tracker.step("curve buy", "no-outflow", () => buyOnCurve(fork, L.keys, buyer, (L.threshold * 30n) / 100n));
    g.holders.push(buyer);
    const curve = bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee);
    let res = await tracker.step("harvest_curve_fees (v2)", "no-outflow", async () => fork.send([await harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys })], [c]), {
      ...opts({ ...none, vault: curve }),
    });
    expect(feesDistributed(res)).toBeNull();
    const remaining = L.threshold - bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve);
    const whale = fundedWallet(fork, remaining * 2n);
    tracker.trackBase(splAta(whale.publicKey, L.keys.baseMint));
    await tracker.step("completing buy", "no-outflow", () => buyOnCurve(fork, L.keys, whale, (remaining * 11n) / 10n + 1_000_000n, SwapMode.PartialFill));
    g.holders.push(whale);
    tracker.trackBase(dammBaseVault(L));
  await tracker.step("migration", "no-outflow", async () => {
      g.m = await migrateToDammV2(fork, L.keys);
    });
    tracker.trackBase(g.m.tokenAVault);
    const fee = partnerFee(L.threshold, 60);
    res = await tracker.step("harvest_migration_fee (v2)", "no-outflow", async () => fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [c]), opts({ ...none, vault: fee }));
    expect(feesDistributed(res)).toBeNull();
    fork.warp(60);
    await dammTrades(fork, g, L.threshold / 5n);
    const lp = pendingPositionFees(fork, g.m.dammPool, g.m.firstPosition).b;
    expect(lp).toBeGreaterThan(0n);
    await tracker.step("harvest_lp_fees (v2)", "no-outflow", async () => fork.send([await harvestLpFeesIx(lpArgs(L, g.m, c.publicKey))], [c]), opts({ ...none, vault: lp }));
    const launch = fetchLaunch(fork, L.config);
    expect(bnToBig(launch.totalPlatformQuote)).toBe(0n);
    expect(bnToBig(launch.totalCreatorQuote)).toBe(0n);
    expect(bnToBig(launch.totalHarvestedQuote)).toBe(curve + fee + lp);
    expect([tokenAmount(fork, L.platformQuoteAccount), tokenAmount(fork, L.creatorQuoteAccount), tokenAmount(fork, L.claimerQuoteAccount)]).toEqual([0n, 0n, 0n]);
    await redeemTracked(fork, g, buyer, tokenAmount(fork, splAta(buyer.publicKey, L.keys.baseMint)) / 2n);
  });
});
