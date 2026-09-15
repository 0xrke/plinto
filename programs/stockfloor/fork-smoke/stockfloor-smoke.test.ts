// Seed for the stockfloor fork integration tests (written by the program-core agent).
//
// It drives every stockfloor instruction against the real DBC 0.2.1, DAMM v2 0.2.4,
// Token-2022 and SPYx fixtures through the LiteSVM harness in tests/src. It passed on
// 2026-09-15 ("ALL SMOKE CHECKS PASSED", 43 checks) with target/deploy/stockfloor.so built by
// `bash scripts/build-programs.sh -p stockfloor`.
//
// It lives here because this agent does not own tests/. To run it, copy it to
// tests/integration/stockfloor-smoke.test.ts and run `pnpm --filter @stockfloor/tests test`.
// The integration-test agent should split it into proper describe/it blocks.
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createTransferInstruction } from "@solana/spl-token";
import { expect, it } from "vitest";
import { parseEvents, targetProgram } from "../src/anchor.js";
import * as C from "../src/constants.js";
import { dammSwap2Ix } from "../src/damm.js";
import { bnToBig, fetchVirtualPool, initializeVirtualPoolWithSplTokenIx, migrationFeeSplit, MigrationProgress } from "../src/dbc.js";
import { anchorErrorFromLogs, Fork } from "../src/fork.js";
import { buyOnCurve, completeCurve, createLaunch, fundedWallet, migrateToDammV2, sellOnCurve } from "../src/scenario.js";
import { deriveAuthority } from "../src/spike.js";
import * as T from "../src/token.js";

it("stockfloor smoke", async () => {

const sf = targetProgram("stockfloor");
const PID = C.STOCKFLOOR_PROGRAM_ID as PublicKey;
const THRESHOLD = 5n * C.SPYX_ONE;
const results: Record<string, unknown> = {};
let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra !== undefined ? " " + JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : ""}`);
}
function expectErr(name: string, res: any, errName: string) {
  const got = res.ok ? "SUCCESS" : anchorErrorFromLogs(res.logs)?.name ?? res.error;
  check(`${name} -> ${errName}`, got === errName, got === errName ? undefined : { got, logs: res.ok ? undefined : res.logs.slice(-6) });
}

const fork = Fork.create({ stockfloor: true, spike: false });
const configKp = Keypair.generate();
const config = configKp.publicKey;
const authority = deriveAuthority(config, PID);
const launchPda = PublicKey.findProgramAddressSync([Buffer.from("launch"), config.toBuffer()], PID)[0];
const vault = T.spyxAta(authority);

const launch = await createLaunch(fork, {
  feeClaimer: authority,
  leftoverReceiver: authority,
  configKeypair: configKp,
  migrationQuoteThreshold: THRESHOLD,
  config: { tradingFeeBps: 100, migrationFeePercentage: 50, creatorMigrationFeePercentage: 0, creatorTradingFeePercentage: 30, migratedPoolFeeBps: 100 },
});
const { partner, creator, keys } = launch;
const baseAtaAuth = T.splAta(authority, keys.baseMint);

const dbcCommon = {
  dbcPoolAuthority: C.DBC_POOL_AUTHORITY,
  dbcEventAuthority: C.DBC_EVENT_AUTHORITY,
  dbcProgram: C.DBC_PROGRAM_ID,
};

const createLaunchIx = (feeBps: number, cfg = config, creatorPk = creator.publicKey) =>
  sf.methods.createLaunch(feeBps).accountsStrict({
    payer: partner.publicKey,
    creator: creatorPk,
    config: cfg,
    authority: deriveAuthority(cfg, PID),
    launch: PublicKey.findProgramAddressSync([Buffer.from("launch"), cfg.toBuffer()], PID)[0],
    quoteMint: C.SPYX_MINT,
    vault: T.spyxAta(deriveAuthority(cfg, PID)),
    quoteTokenProgram: C.TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: C.ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).instruction();

// ---- create_launch
expectErr("create_launch exit fee 501", fork.sendTx([await createLaunchIx(501)], [partner, creator, configKp]), "ExitFeeTooHigh");
let res = fork.send([await createLaunchIx(200)], [partner, creator, configKp]);
results.cuCreateLaunch = res.computeUnits;
const L = () => sf.coder.accounts.decode("launch", fork.mustGetAccount(launchPda).data);
check("launch created", L().exitFeeBps === 200 && L().vault.equals(vault) && L().quoteTokenProgram.equals(C.TOKEN_2022_PROGRAM_ID));
check("LaunchCreated event", parseEvents(sf, res.logs).some((e: any) => e.name === "launchCreated"));
{
  const r2 = fork.sendTx([await createLaunchIx(200)], [partner, creator, configKp]);
  check("create_launch twice fails (launch PDA in use)", !r2.ok && r2.logs.some((l: string) => l.includes("already in use")));
  // create_launch without the config signature is rejected by the signer constraint.
  const cfgNs = Keypair.generate();
  await createLaunch(fork, { feeClaimer: deriveAuthority(cfgNs.publicKey, PID), configKeypair: cfgNs, partner, creator, migrationQuoteThreshold: THRESHOLD });
  const ix = await createLaunchIx(200, cfgNs.publicKey);
  ix.keys.forEach((k) => { if (k.pubkey.equals(cfgNs.publicKey)) k.isSigner = false; });
  expectErr("create_launch without config signer", fork.sendTx([ix], [partner, creator]), "AccountNotSigner");
}
// Floor view before registration (supply 0), on a second launch.
{
  const cfg2 = Keypair.generate();
  const auth2 = deriveAuthority(cfg2.publicKey, PID);
  await createLaunch(fork, { feeClaimer: auth2, configKeypair: cfg2, partner, creator, migrationQuoteThreshold: THRESHOLD });
  fork.send([await createLaunchIx(0, cfg2.publicKey)], [partner, creator, cfg2]);
  const launch2 = PublicKey.findProgramAddressSync([Buffer.from("launch"), cfg2.publicKey.toBuffer()], PID)[0];
  const r = fork.send([await sf.methods.floor().accountsStrict({ launch: launch2, vault: T.spyxAta(auth2), baseMint: SystemProgram.programId }).instruction()], [partner]);
  const b = Buffer.from(r.meta.returnData().data());
  check("floor view before registration", b.readBigUInt64LE(0) === 0n && b.readBigUInt64LE(8) === 0n && b.readUInt16LE(16) === 0);
  // A config whose fee_claimer is not the authority is rejected.
  const cfg3 = Keypair.generate();
  await createLaunch(fork, { feeClaimer: partner.publicKey, leftoverReceiver: deriveAuthority(cfg3.publicKey, PID), configKeypair: cfg3, partner, creator, migrationQuoteThreshold: THRESHOLD });
  expectErr("create_launch with foreign fee_claimer", fork.sendTx([await createLaunchIx(200, cfg3.publicKey)], [partner, creator, cfg3]), "FeeClaimerNotAuthority");
  // Wrong quote mint account.
}

// ---- register_pool
const registerIx = (signer: PublicKey, pool = keys.pool, baseMint = keys.baseMint) =>
  sf.methods.registerPool().accountsStrict({ creator: signer, launch: launchPda, config, pool, baseMint, tokenProgram: C.TOKEN_PROGRAM_ID }).instruction();
const rando = fork.newWallet();
expectErr("register_pool by non-creator", fork.sendTx([await registerIx(rando.publicKey)], [rando]), "PoolCreatorMismatch");
// Rogue pool on our config by someone else.
const rogueCreator = fork.newWallet();
{
  const bm = Keypair.generate();
  const init = await initializeVirtualPoolWithSplTokenIx({ config, creator: rogueCreator.publicKey, baseMint: bm.publicKey, quoteMint: C.SPYX_MINT, payer: rogueCreator.publicKey, name: "Rogue", symbol: "RGE", uri: "https://x", tokenBadge: C.DBC_TOKEN_BADGE_SPYX });
  fork.send([init.ix], [rogueCreator, bm]);
  expectErr("register rogue pool (creator signs)", fork.sendTx([await registerIx(creator.publicKey, init.pool, bm.publicKey)], [creator]), "PoolCreatorMismatch");
}
res = fork.send([await registerIx(creator.publicKey)], [creator]);
check("pool registered", L().pool.equals(keys.pool) && L().baseMint.equals(keys.baseMint));
expectErr("register_pool twice", fork.sendTx([await registerIx(creator.publicKey)], [creator]), "PoolAlreadyRegistered");

// ---- trades
const buyers: Keypair[] = [];
for (const amt of [1n * C.SPYX_ONE, (3n * C.SPYX_ONE) / 2n]) {
  const b = fundedWallet(fork, 10n * C.SPYX_ONE);
  buyers.push(b);
  await buyOnCurve(fork, keys, b, amt);
}
await sellOnCurve(fork, keys, buyers[0], T.tokenAmount(fork, T.splAta(buyers[0].publicKey, keys.baseMint)) / 3n);

const harvestCurveIx = (payer: PublicKey) =>
  sf.methods.harvestCurveFees().accountsStrict({
    payer, launch: launchPda, authority, config, pool: keys.pool, vault, authorityBaseAccount: baseAtaAuth,
    dbcBaseVault: keys.baseVault, dbcQuoteVault: keys.quoteVault, baseMint: keys.baseMint, quoteMint: C.SPYX_MINT,
    tokenProgram: C.TOKEN_PROGRAM_ID, quoteTokenProgram: C.TOKEN_2022_PROGRAM_ID, associatedTokenProgram: C.ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, ...dbcCommon,
  }).instruction();

const partnerFee = bnToBig(fetchVirtualPool(fork, keys.pool).partnerQuoteFee);
const cranker = fork.newWallet();
res = fork.send([await harvestCurveIx(cranker.publicKey)], [cranker]);
results.cuHarvestCurveFees = res.computeUnits;
check("curve fees harvested into vault", T.tokenAmount(fork, vault) === partnerFee && partnerFee > 0n, { partnerFee });
const ev = parseEvents(sf, res.logs).find((e: any) => e.name === "curveFeesHarvested");
check("CurveFeesHarvested event amount", ev && bnToBig(ev.data.quoteAmount) === partnerFee);

const quoteIx = (method: "harvestMigrationFee" | "harvestSurplus") =>
  (sf.methods as any)[method]().accountsStrict({
    launch: launchPda, authority, config, pool: keys.pool, vault, dbcQuoteVault: keys.quoteVault, quoteMint: C.SPYX_MINT,
    quoteTokenProgram: C.TOKEN_2022_PROGRAM_ID, ...dbcCommon,
  }).instruction();
expectErr("harvest_migration_fee before curve complete", fork.sendTx([await quoteIx("harvestMigrationFee")], [cranker]), "CurveNotComplete");

// ---- redeem helpers
const redeemIx = (holder: PublicKey, amount: bigint, over: Partial<Record<string, PublicKey>> = {}) =>
  sf.methods.redeem(new BN(amount.toString())).accountsStrict({
    holder, launch: launchPda, authority, pool: keys.pool, baseMint: keys.baseMint,
    holderBaseAccount: T.splAta(holder, keys.baseMint), vault, holderQuoteAccount: T.spyxAta(holder),
    quoteMint: C.SPYX_MINT, tokenProgram: C.TOKEN_PROGRAM_ID, quoteTokenProgram: C.TOKEN_2022_PROGRAM_ID, ...over,
  }).instruction();
expectErr("redeem before migration", fork.sendTx([await redeemIx(buyers[1].publicKey, 1000n)], [buyers[1]]), "MigrationNotComplete");

// ---- complete + migrate
buyers.push(await completeCurve(fork, keys, THRESHOLD));
const migration = await migrateToDammV2(fork, keys);
check("migrated", fetchVirtualPool(fork, keys.pool).migrationProgress === MigrationProgress.CreatedPool);
expectErr("redeem before migration fee harvested", fork.sendTx([await redeemIx(buyers[1].publicKey, 1000n)], [buyers[1]]), "MigrationFeeNotHarvested");

let vBefore = T.tokenAmount(fork, vault);
res = fork.send([await quoteIx("harvestMigrationFee")], [cranker]);
results.cuHarvestMigrationFee = res.computeUnits;
const split = migrationFeeSplit(THRESHOLD, 50, 0);
check("migration fee into vault", T.tokenAmount(fork, vault) - vBefore === split.partner, { got: T.tokenAmount(fork, vault) - vBefore, want: split.partner });
check("migration_fee_harvested flag", L().migrationFeeHarvested === true);
expectErr("harvest_migration_fee twice", fork.sendTx([await quoteIx("harvestMigrationFee")], [cranker]), "MigrationFeeAlreadyHarvested");

vBefore = T.tokenAmount(fork, vault);
res = fork.send([await quoteIx("harvestSurplus")], [cranker]);
check("surplus harvested", L().surplusHarvested === true, { surplus: T.tokenAmount(fork, vault) - vBefore });
expectErr("harvest_surplus twice", fork.sendTx([await quoteIx("harvestSurplus")], [cranker]), "SurplusAlreadyHarvested");

const leftoverIx = () =>
  sf.methods.harvestLeftover().accountsStrict({
    payer: cranker.publicKey, launch: launchPda, authority, config, pool: keys.pool, authorityBaseAccount: baseAtaAuth,
    dbcBaseVault: keys.baseVault, baseMint: keys.baseMint, tokenProgram: C.TOKEN_PROGRAM_ID,
    associatedTokenProgram: C.ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, ...dbcCommon,
  }).instruction();
// Donate base tokens to the authority base ATA; harvest_leftover must burn them (dynamic supply: no DBC leftover).
const donor = buyers[1];
const donation = 12345n;
const supplyPreDonation = T.mintSupply(fork, keys.baseMint);
{
  fork.send([createTransferInstruction(T.splAta(donor.publicKey, keys.baseMint), baseAtaAuth, donor.publicKey, donation)], [donor]);
}
res = fork.send([await leftoverIx()], [cranker]);
check("harvest_leftover burns donated base", T.tokenAmount(fork, baseAtaAuth) === 0n && T.mintSupply(fork, keys.baseMint) === supplyPreDonation - donation);
const lev = parseEvents(sf, res.logs).find((e: any) => e.name === "leftoverHarvested");
check("LeftoverHarvested event", lev && lev.data.leftoverWithdrawn === false && bnToBig(lev.data.baseBurned) === donation);

// ---- DAMM trades + LP fees
const trader = fundedWallet(fork, 5n * C.SPYX_ONE);
const dammKeys = migration.dammKeys;
const traderBase = T.createAta(fork, trader, trader.publicKey, keys.baseMint, C.TOKEN_PROGRAM_ID);
fork.warp(60);
fork.send([await dammSwap2Ix({ keys: dammKeys, payer: trader.publicKey, inputTokenAccount: T.spyxAta(trader.publicKey), outputTokenAccount: traderBase, amount0: C.SPYX_ONE, amount1: 0n, swapMode: 0 })], [trader]);
const lpIx = (over: Partial<Record<string, PublicKey>> = {}) =>
  sf.methods.harvestLpFees().accountsStrict({
    payer: cranker.publicKey, launch: launchPda, authority, dammPool: migration.dammPool, position: migration.firstPosition,
    positionNftAccount: migration.firstPositionNftAccount, authorityBaseAccount: baseAtaAuth, vault,
    dammTokenAVault: migration.tokenAVault, dammTokenBVault: migration.tokenBVault, baseMint: keys.baseMint, quoteMint: C.SPYX_MINT,
    tokenProgram: C.TOKEN_PROGRAM_ID, quoteTokenProgram: C.TOKEN_2022_PROGRAM_ID, associatedTokenProgram: C.ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, dammPoolAuthority: C.DAMM_V2_POOL_AUTHORITY, dammEventAuthority: C.DAMM_V2_EVENT_AUTHORITY,
    dammProgram: C.DAMM_V2_PROGRAM_ID, ...over,
  }).instruction();
vBefore = T.tokenAmount(fork, vault);
res = fork.send([await lpIx()], [cranker]);
results.cuHarvestLpFees = res.computeUnits;
check("LP fees into vault", T.tokenAmount(fork, vault) > vBefore, { gain: T.tokenAmount(fork, vault) - vBefore });

// ---- floor view (return data)
const floorIx = await sf.methods.floor().accountsStrict({ launch: launchPda, vault, baseMint: keys.baseMint }).instruction();
res = fork.send([floorIx], [cranker]);
const rd = res.meta.returnData();
const rdBytes = Buffer.from(rd.data());
const vaultRaw = rdBytes.readBigUInt64LE(0), supplyRd = rdBytes.readBigUInt64LE(8), bpsRd = rdBytes.readUInt16LE(16);
check("floor view return data", vaultRaw === T.tokenAmount(fork, vault) && supplyRd === T.mintSupply(fork, keys.baseMint) && bpsRd === 200, { vaultRaw, supplyRd, bpsRd });

// ---- redeem
const holder = buyers[1];
const bal = T.tokenAmount(fork, T.splAta(holder.publicKey, keys.baseMint));
const V0 = T.tokenAmount(fork, vault), S0 = T.mintSupply(fork, keys.baseMint);
const amount = bal / 2n;
const gross = (V0 * amount) / S0, fee = (gross * 200n + 9999n) / 10000n, net = gross - fee;
const q0 = T.tokenAmount(fork, T.spyxAta(holder.publicKey));
expectErr("redeem zero", fork.sendTx([await redeemIx(holder.publicKey, 0n)], [holder]), "ZeroAmount");
expectErr("redeem more than balance", fork.sendTx([await redeemIx(holder.publicKey, bal + 1n)], [holder]), "InsufficientBaseBalance");
expectErr("redeem tiny (net 0)", fork.sendTx([await redeemIx(holder.publicKey, 1n)], [holder]), "NothingToRedeem");
expectErr("redeem to vault", fork.sendTx([await redeemIx(holder.publicKey, amount, { holderQuoteAccount: vault })], [holder]), "ConstraintDuplicateMutableAccount");
expectErr("redeem with wrong vault", fork.sendTx([await redeemIx(holder.publicKey, amount, { vault: T.spyxAta(trader.publicKey) })], [holder]), "ConstraintAddress");
expectErr("redeem with wrong base mint", fork.sendTx([await redeemIx(holder.publicKey, amount, { baseMint: C.SPYX_MINT })], [holder]), "BaseMintMismatch");
expectErr("redeem with wrong pool", fork.sendTx([await redeemIx(holder.publicKey, amount, { pool: migration.dammPool })], [holder]), "InvalidDbcPool");
expectErr("harvest_lp_fees with a position NFT account not owned by authority", fork.sendTx([await lpIx({ positionNftAccount: T.spyxAta(trader.publicKey) })], [cranker]), "PositionNftNotOwnedByAuthority");
expectErr("harvest_curve_fees with wrong vault", fork.sendTx([await (async () => { const ix = await harvestCurveIx(cranker.publicKey); ix.keys[5].pubkey = T.spyxAta(trader.publicKey); return ix; })()], [cranker]), "ConstraintAddress");
res = fork.send([await redeemIx(holder.publicKey, amount)], [holder]);
results.cuRedeem = res.computeUnits;
const V1 = T.tokenAmount(fork, vault), S1 = T.mintSupply(fork, keys.baseMint);
check("redeem exact payout", T.tokenAmount(fork, T.spyxAta(holder.publicKey)) - q0 === net, { net, gross, fee });
check("redeem vault/supply", V1 === V0 - net && S1 === S0 - amount);
check("floor increased", V1 * S0 > V0 * S1);
const rev = parseEvents(sf, res.logs).find((e: any) => e.name === "redeemed");
check("Redeemed event", rev && bnToBig(rev.data.net) === net && bnToBig(rev.data.fee) === fee);

// ---- paused quote mint
T.setMintPaused(fork, C.SPYX_MINT, true);
expectErr("redeem when SPYx paused", fork.sendTx([await redeemIx(holder.publicKey, amount / 2n)], [holder]), "QuoteMintPaused");
expectErr("harvest_lp_fees when SPYx paused", fork.sendTx([await lpIx()], [cranker]), "QuoteMintPaused");
check("paused failure left state intact", T.tokenAmount(fork, vault) === V1 && T.mintSupply(fork, keys.baseMint) === S1);
T.setMintPaused(fork, C.SPYX_MINT, false);

// ---- holder redeems everything
const rest = T.tokenAmount(fork, T.splAta(holder.publicKey, keys.baseMint));
res = fork.send([await redeemIx(holder.publicKey, rest)], [holder]);
check("second redeem ok", T.tokenAmount(fork, T.splAta(holder.publicKey, keys.baseMint)) === 0n);

console.log(JSON.stringify(results, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
console.log(failures === 0 ? "ALL SMOKE CHECKS PASSED" : `${failures} SMOKE CHECK(S) FAILED`);
expect(failures).toBe(0);
});
