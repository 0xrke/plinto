/**
 * Account and argument validation of every stockfloor instruction on the mainnet fork (real
 * stockfloor, DBC 0.2.1, DAMM v2 0.2.4, Token-2022, SPYx), one `it` per instruction.
 *
 * This file replaces the M1 monolithic `stockfloor-smoke.test.ts`. The smoke checks that were
 * unique to it (exit fee cap, second create_launch, missing config signature, foreign fee_claimer,
 * redeem with a zero amount, the vault as payout, a wrong vault, base mint or pool) are here with
 * exact error names; everything else it checked is covered with exact amounts elsewhere
 * (c1-lifecycle 3a-12, c1-adversarial, review-regressions). New in M2: the claimer and vault
 * authority PDAs cannot stand in for each other anywhere, and a DBC config that names the vault
 * authority as fee_claimer or leftover_receiver is rejected.
 *
 * Every rejected transaction is followed by a check that nothing moved, and each block ends with
 * one valid call whose amounts are exact.
 */
import { createInitializeMint2Instruction, MINT_SIZE } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEvents } from "../src/anchor.js";
import { SPYX_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/constants.js";
import { bnToBig, fetchVirtualPool } from "../src/dbc.js";
import { anchorErrorFromLogs, Fork, TxFailure } from "../src/fork.js";
import { Migration } from "../src/scenario.js";
import { createStockfloorLaunch, graduate, StockfloorLaunch } from "../src/stockfloor-scenario.js";
import {
  createLaunchIx,
  decodeFloorReturn,
  deriveLaunch,
  expectedFloorQ64,
  fetchLaunch,
  floorIx,
  harvestMigrationFeeIx,
  redeemIx,
  registerPoolIx,
  stockfloorProgram,
} from "../src/stockfloor.js";
import { createAta, getAta, mintSupply, splAta, spyxAta, tokenAccountOwner, tokenAmount } from "../src/token.js";

const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** A fresh SPL Token mint (6 decimals) that is not part of any launch. */
function createSplMint(fork: Fork, payer: Keypair): PublicKey {
  const mint = Keypair.generate();
  fork.send(
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: 10_000_000,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ],
    [payer, mint],
    { computeUnits: 0 },
  );
  return mint.publicKey;
}

async function createLaunchFor(L: StockfloorLaunch, exitFeeBps: number, extra: Partial<Parameters<typeof createLaunchIx>[0]> = {}): Promise<TransactionInstruction> {
  return createLaunchIx({ payer: L.partner.publicKey, creator: L.creator.publicKey, config: L.config, baseMint: L.keys.baseMint, exitFeeBps, ...extra });
}

// ====================================================================================================

describe("create_launch validation", () => {
  it("exit fee above 500 bps is rejected; exactly 500 bps (the cap) is accepted and stored", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, { skipCreateLaunch: true });
    const signers = [L.partner, L.creator, L.configKeypair];
    for (const bps of [501, 10_000, 65_535]) {
      expect(errName(fork.sendExpectFail([await createLaunchFor(L, bps)], signers)), `${bps} bps`).toBe("ExitFeeTooHigh");
    }
    expect(fork.getAccount(deriveLaunch(L.config))).toBeNull();
    fork.send([await createLaunchFor(L, 500)], signers);
    expect(fetchLaunch(fork, L.config).exitFeeBps).toBe(500);
  });

  it("the DBC config must name the claimer PDA as fee_claimer and leftover_receiver (not the vault authority, not a wallet)", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const probe = await createStockfloorLaunch(fork, { skipCreateLaunch: true });
    const wallet = fork.newWallet(1).publicKey;
    // The PDAs depend on the config, so each case builds its own config and passes a resolver.
    const cases: Array<[string, (claimer: PublicKey, vaultAuthority: PublicKey) => { feeClaimer?: PublicKey; leftoverReceiver?: PublicKey }, string]> = [
      ["fee_claimer = vault authority PDA", (_c, va) => ({ feeClaimer: va }), "FeeClaimerMismatch"],
      ["fee_claimer = a wallet", () => ({ feeClaimer: wallet }), "FeeClaimerMismatch"],
      ["leftover_receiver = vault authority PDA", (_c, va) => ({ leftoverReceiver: va }), "LeftoverReceiverMismatch"],
      ["leftover_receiver = a wallet", () => ({ leftoverReceiver: wallet }), "LeftoverReceiverMismatch"],
    ];
    expect(probe.claimer.equals(probe.vaultAuthority)).toBe(false);
    for (const [label, pick, expected] of cases) {
      const configKeypair = Keypair.generate();
      const claimer = PublicKey.findProgramAddressSync([Buffer.from("authority"), configKeypair.publicKey.toBuffer()], stockfloorProgram().programId)[0];
      const vaultAuthority = PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), configKeypair.publicKey.toBuffer()], stockfloorProgram().programId)[0];
      const L = await createStockfloorLaunch(fork, { skipCreateLaunch: true, configKeypair, ...pick(claimer, vaultAuthority) });
      expect(L.claimer.equals(claimer) && L.vaultAuthority.equals(vaultAuthority)).toBe(true);
      const f = fork.sendExpectFail([await createLaunchFor(L, 200)], [L.partner, L.creator, L.configKeypair]);
      expect(errName(f), label).toBe(expected);
      expect(fork.getAccount(deriveLaunch(L.config)), label).toBeNull();
      expect(fork.getAccount(L.vault), label).toBeNull();
    }
  });

  it("swapped or foreign PDAs, a vault at the claimer's ATA, a wrong quote mint, a missing config signature and a second call are rejected", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, { skipCreateLaunch: true });
    const other = await createStockfloorLaunch(fork, { skipCreateLaunch: true });
    const signers = [L.partner, L.creator, L.configKeypair];
    const otherMint = createSplMint(fork, L.partner);
    const cases: Array<[string, Promise<TransactionInstruction>, string | RegExp]> = [
      ["claimer = vault authority", createLaunchFor(L, 200, { overrides: { claimer: L.vaultAuthority } }), "ConstraintSeeds"],
      // Anchor runs the vault's init_if_needed before the seeds checks: the ATA-create CPI for the
      // substituted owner references an ATA that is not in the transaction (MissingAccount). With that
      // ATA included it is created and the seeds check rejects the substitution; the tx rolls back.
      ["vault authority = claimer", createLaunchFor(L, 200, { overrides: { vaultAuthority: L.claimer } }), /MissingAccount/],
      ["vault authority = claimer, with ATA(claimer, SPYx) as the vault", createLaunchFor(L, 200, { overrides: { vaultAuthority: L.claimer, vault: spyxAta(L.claimer) } }), "ConstraintSeeds"],
      ["claimer of another config", createLaunchFor(L, 200, { overrides: { claimer: other.claimer } }), "ConstraintSeeds"],
      ["vault authority of another config, with its vault", createLaunchFor(L, 200, { overrides: { vaultAuthority: other.vaultAuthority, vault: other.vault } }), "ConstraintSeeds"],
      // init_if_needed creates ATA(vault_authority, quote mint) through the ATA program, which references
      // that derived address; it is not in the transaction, so the runtime rejects the CPI.
      ["vault = ATA(claimer, SPYx)", createLaunchFor(L, 200, { overrides: { vault: spyxAta(L.claimer) } }), /MissingAccount/],
      ["quote mint = an SPL mint that is not the config's quote mint", createLaunchFor(L, 200, { quoteMint: otherMint, quoteTokenProgram: TOKEN_PROGRAM_ID }), "QuoteMintMismatch"],
    ];
    for (const [label, ix, expected] of cases) {
      const f = fork.sendExpectFail([await ix], signers);
      if (typeof expected === "string") expect(errName(f), label).toBe(expected);
      else expect(errName(f), `${label}: ${f.logs.slice(-4).join(" / ")}`).toMatch(expected);
      expect(fork.getAccount(deriveLaunch(L.config)), label).toBeNull();
    }

    // With ATA(claimer, SPYx) created by a third party, it is validated as an existing vault and fails on its owner.
    const claimerQuoteAta = createAta(fork, fork.newWallet(1), L.claimer, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    expect(errName(fork.sendExpectFail([await createLaunchFor(L, 200, { overrides: { vault: claimerQuoteAta } })], signers))).toBe("ConstraintTokenOwner");

    // The config keypair must sign.
    const unsigned = await createLaunchFor(L, 200);
    unsigned.keys.forEach((k) => {
      if (k.pubkey.equals(L.config)) k.isSigner = false;
    });
    expect(errName(fork.sendExpectFail([unsigned], [L.partner, L.creator]))).toBe("AccountNotSigner");

    // A vault pre-created by a third party (the canonical ATA) does not block the launch.
    const stranger = fork.newWallet(1);
    createAta(fork, stranger, L.vaultAuthority, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    const res = fork.send([await createLaunchFor(L, 200)], signers);
    const launch = fetchLaunch(fork, L.config);
    expect(launch.vault.equals(L.vault)).toBe(true);
    expect(tokenAccountOwner(fork, L.vault).equals(L.vaultAuthority)).toBe(true);
    const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "launchCreated");
    expect(ev!.data.claimer.equals(L.claimer) && ev!.data.vaultAuthority.equals(L.vaultAuthority)).toBe(true);

    // A second create_launch for the same config fails: the Launch PDA is in use.
    const again = fork.sendExpectFail([await createLaunchFor(L, 200)], signers);
    expect(again.logs.some((l) => l.includes("already in use"))).toBe(true);
    expect(fetchLaunch(fork, L.config).exitFeeBps).toBe(200);
  });
});

// ====================================================================================================

describe("register_pool validation of the base mint and pool (cheatcode state DBC itself never produces)", () => {
  it("a live mint authority, a freeze authority, wrong decimals, a foreign config or a non-SPL pool type are rejected", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, { skipRegister: true });
    const c = fork.newWallet(1);
    const register = async () => fork.sendTx([await registerPoolIx({ config: L.config, pool: L.keys.pool, baseMint: L.keys.baseMint })], [c]);
    const mintData = Buffer.from(fork.mustGetAccount(L.keys.baseMint).data);
    const poolData = Buffer.from(fork.mustGetAccount(L.keys.pool).data);
    const restore = () => {
      fork.patchAccount(L.keys.baseMint, (d) => mintData.copy(d));
      fork.patchAccount(L.keys.pool, (d) => poolData.copy(d));
    };
    // SPL mint: mint_authority COption at 0, decimals at 44, freeze_authority COption at 46.
    // DBC VirtualPool (after the 8-byte discriminator): config at 64, pool_type at 296.
    const cases: Array<[string, () => void, string]> = [
      ["mint authority set", () => fork.patchAccount(L.keys.baseMint, (d) => { d.writeUInt32LE(1, 0); c.publicKey.toBuffer().copy(d, 4); }), "BaseMintAuthorityNotRevoked"],
      ["freeze authority set", () => fork.patchAccount(L.keys.baseMint, (d) => { d.writeUInt32LE(1, 46); c.publicKey.toBuffer().copy(d, 50); }), "BaseMintHasFreezeAuthority"],
      ["decimals 9 instead of the config's 6", () => fork.patchAccount(L.keys.baseMint, (d) => (d[44] = 9)), "BaseMintDecimalsMismatch"],
      ["pool.config of another config", () => fork.patchAccount(L.keys.pool, (d) => Keypair.generate().publicKey.toBuffer().copy(d, 8 + 64)), "PoolConfigMismatch"],
      ["pool_type Token-2022", () => fork.patchAccount(L.keys.pool, (d) => (d[8 + 296] = 1)), "PoolTypeNotSplToken"],
    ];
    for (const [label, cheat, expected] of cases) {
      cheat();
      const r = await register();
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(errName(r), label).toBe(expected);
      restore();
      expect(fetchLaunch(fork, L.config).pool.equals(PublicKey.default), label).toBe(true);
    }
    const ok = await register();
    expect(ok.ok).toBe(true);
    expect(fetchLaunch(fork, L.config).pool.equals(L.keys.pool)).toBe(true);
    expect(bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve)).toBe(0n);
  });
});

// ====================================================================================================

describe("redeem and floor validation on a graduated launch", () => {
  let fork: Fork;
  let L: StockfloorLaunch;
  let L2: StockfloorLaunch;
  let migration: Migration;
  let holder: Keypair;
  let other: Keypair;

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    L = await createStockfloorLaunch(fork);
    L2 = await createStockfloorLaunch(fork);
    const g = await graduate(fork, L, [25n, 15n]);
    migration = g.migration;
    [holder, other] = g.buyers;
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
  });

  it("zero amount, the vault as payout, substituted vault / vault authority / mint / pool / accounts are rejected; then an exact redeem", async () => {
    const amount = tokenAmount(fork, splAta(holder.publicKey, L.keys.baseMint)) / 3n;
    const attacker = fork.newWallet(1);
    const attackerQuote = createAta(fork, attacker, attacker.publicKey, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    const claimerQuoteAta = createAta(fork, attacker, L.claimer, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    const r = (a: bigint, overrides: Partial<Record<string, PublicKey>> = {}) => redeemIx({ holder: holder.publicKey, keys: L.keys, amount: a, overrides });
    const cases: Array<[string, Promise<TransactionInstruction>, string]> = [
      ["amount 0", r(0n), "ZeroAmount"],
      ["payout account = the vault", r(amount, { holderQuoteAccount: L.vault }), "ConstraintDuplicateMutableAccount"],
      ["vault = attacker SPYx account", r(amount, { vault: attackerQuote }), "ConstraintAddress"],
      ["vault = ATA(claimer, SPYx)", r(amount, { vault: claimerQuoteAta }), "ConstraintAddress"],
      ["vault = another launch's vault", r(amount, { vault: L2.vault }), "ConstraintAddress"],
      ["vault authority = the claimer", r(amount, { vaultAuthority: L.claimer }), "ConstraintSeeds"],
      ["vault authority = another launch's vault authority", r(amount, { vaultAuthority: L2.vaultAuthority }), "ConstraintSeeds"],
      ["launch = another launch", r(amount, { launch: deriveLaunch(L2.config) }), "ConstraintSeeds"],
      ["base mint = SPYx", r(amount, { baseMint: SPYX_MINT }), "BaseMintMismatch"],
      ["pool = the DAMM v2 pool", r(amount, { pool: migration.dammPool }), "InvalidDbcPool"],
      // holder_quote_account (token::mint = quote_mint) is validated before quote_mint's address check.
      ["quote mint = the base mint", r(amount, { quoteMint: L.keys.baseMint }), "ConstraintTokenMint"],
      ["quote token program = SPL Token", r(amount, { quoteTokenProgram: TOKEN_PROGRAM_ID }), "ConstraintTokenTokenProgram"],
      ["holder base account of another holder", r(amount, { holderBaseAccount: splAta(other.publicKey, L.keys.baseMint) }), "ConstraintTokenOwner"],
      ["payout account holds the base mint", r(amount, { holderQuoteAccount: splAta(holder.publicKey, L.keys.baseMint) }), "ConstraintDuplicateMutableAccount"],
    ];
    const V = tokenAmount(fork, L.vault);
    const S = mintSupply(fork, L.keys.baseMint);
    const hq = tokenAmount(fork, spyxAta(holder.publicKey));
    for (const [label, ix, expected] of cases) {
      const f = fork.sendExpectFail([await ix], [holder]);
      expect(errName(f), label).toBe(expected);
    }
    expect([tokenAmount(fork, L.vault), mintSupply(fork, L.keys.baseMint), tokenAmount(fork, spyxAta(holder.publicKey))]).toEqual([V, S, hq]);
    expect(tokenAmount(fork, attackerQuote)).toBe(0n);

    const gross = (V * amount) / S;
    const fee = ceilDiv(gross * 200n, 10_000n);
    fork.send([await r(amount)], [holder]);
    expect(tokenAmount(fork, spyxAta(holder.publicKey)) - hq).toBe(gross - fee);
    expect(tokenAmount(fork, L.vault)).toBe(V - (gross - fee));
    expect(mintSupply(fork, L.keys.baseMint)).toBe(S - amount);
  });

  it("a payout account with the base mint is rejected by its mint constraint when it is not also a duplicate", async () => {
    const amount = tokenAmount(fork, splAta(holder.publicKey, L.keys.baseMint)) / 3n;
    // `other`'s base ATA: a base-mint account that is not the holder's burn account.
    const f = fork.sendExpectFail(
      [await redeemIx({ holder: holder.publicKey, keys: L.keys, amount, overrides: { holderQuoteAccount: splAta(other.publicKey, L.keys.baseMint) } })],
      [holder],
    );
    expect(errName(f)).toMatch(/ConstraintTokenMint|ConstraintTokenTokenProgram/);
  });

  it("floor view: a vault other than the launch vault and a base mint other than the launch base mint are rejected", async () => {
    const c = fork.newWallet(1);
    let f = fork.sendExpectFail([await floorIx({ config: L.config, baseMint: L.keys.baseMint, overrides: { vault: L2.vault } })], [c]);
    expect(errName(f)).toBe("ConstraintAddress");
    f = fork.sendExpectFail([await floorIx({ config: L.config, baseMint: SPYX_MINT })], [c]);
    expect(errName(f)).toBe("FloorAccountMismatch");
    f = fork.sendExpectFail([await floorIx({ config: L.config, baseMint: SystemProgram.programId })], [c]);
    expect(errName(f)).toBe("FloorAccountMismatch");
    const view = decodeFloorReturn(fork.send([await floorIx({ config: L.config, baseMint: L.keys.baseMint })], [c]));
    const V = tokenAmount(fork, L.vault);
    const S = mintSupply(fork, L.keys.baseMint);
    expect(view).toEqual({ vaultRaw: V, supply: S, exitFeeBps: 200, floorQ64: expectedFloorQ64(V, S) });
    expect(getAta(L.vaultAuthority, SPYX_MINT, TOKEN_2022_PROGRAM_ID).equals(L.vault)).toBe(true);
  });
});
