/**
 * First adversarial tests for checkpoint C1 on the mainnet fork (real stockfloor program, DBC 0.2.1,
 * DAMM v2 0.2.4, Token-2022, SPYx). Stage-specific rejections of the main flow (redeem before
 * migration / before harvest_migration_fee, harvest_migration_fee twice, register_pool of a second
 * pool) are in c1-lifecycle.test.ts, and the M1 review regressions in review-regressions.test.ts;
 * this file covers what needs a dedicated setup:
 *
 * - a random signer cannot redirect any harvest: every destination is pinned to the vault or the
 *   Authority's own base ATA (substitutions fail), and when it cranks honestly the vault receives
 *   exact amounts while the signer receives nothing;
 * - harvest_migration_fee before migration (allowed by DBC) does not open redemptions;
 * - a second pool on the same config (fees, migration fee, LP position all owned by the same
 *   Authority PDA on the DBC/DAMM side) can never feed or drain the launch vault;
 * - harvest_surplus pays DBC's exact partner share of a non-trivial surplus (cheatcode state:
 *   DBC 0.2.1 swaps cannot overshoot the threshold by more than rounding);
 * - the FloorTracker invariant checker itself rejects violations (it is not vacuous);
 * - quote issuer controls (pause, frozen vault, transfer hook) make every harvest and redeem fail
 *   cleanly with no state change, and a ScaledUiAmount multiplier change leaves raw math exact;
 * - redemption edge cases: SPYx donated to the vault, exit fees 0 and 500 bps, split redemptions,
 *   dust, and redeeming the entire supply (cheatcode).
 */
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { dbcProgram } from "../src/anchor.js";
import {
  DBC_EVENT_AUTHORITY,
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  DBC_TOKEN_BADGE_SPYX,
  SPYX_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/constants.js";
import { claimPositionFeeIx, dammSwap2Ix, fetchDammPool, fetchPosition } from "../src/damm.js";
import {
  bnToBig,
  claimTradingFeeIx,
  DbcPoolKeys,
  fetchVirtualPool,
  initializeVirtualPoolWithSplTokenIx,
  withdrawMigrationFeeIx,
} from "../src/dbc.js";
import { FloorTracker } from "../src/floor-invariants.js";
import { anchorErrorFromLogs, Fork, TxFailure } from "../src/fork.js";
import { buyOnCurve, fundedWallet, Migration, migrateToDammV2 } from "../src/scenario.js";
import {
  buyers,
  completeWithPartialFill,
  createStockfloorLaunch,
  graduate,
  StockfloorLaunch,
} from "../src/stockfloor-scenario.js";
import {
  deriveLaunch,
  deriveStockfloorAuthority,
  fetchLaunch,
  harvestCurveFeesIx,
  harvestLeftoverIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  redeemIx,
} from "../src/stockfloor.js";
import {
  createAta,
  createTokenAccountOwnedBy,
  ExtensionType,
  findExtension,
  fundSpyx,
  mintSupply,
  setMintPaused,
  setMintSupply,
  setScaledUiMultiplier,
  setTokenAmount,
  splAta,
  spyxAta,
  tokenAmount,
} from "../src/token.js";

const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;
/** Exact Anchor/program error name, or a pattern for runtime errors without an Anchor error log. */
function expectError(f: TxFailure, expected: string | RegExp, label: string): void {
  if (typeof expected === "string") expect(errName(f), label).toBe(expected);
  else expect(errName(f), label).toMatch(expected);
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const U128 = 1n << 128n;
const u256le = (bytes: number[] | Uint8Array) => BigInt("0x" + (Buffer.from(bytes).reverse().toString("hex") || "0"));

/** Expected DAMM v2 claim for a position (position.update_fee + pending). */
function pendingLpFee(fork: Fork, m: Migration): { a: bigint; b: bigint } {
  const pool = fetchDammPool(fork, m.dammPool);
  const pos = fetchPosition(fork, m.firstPosition);
  const liq = bnToBig(pos.unlockedLiquidity) + bnToBig(pos.vestedLiquidity) + bnToBig(pos.permanentLockedLiquidity);
  return {
    a: bnToBig(pos.feeAPending) + (liq * (u256le(pool.feeAPerLiquidity) - u256le(pos.feeAPerTokenCheckpoint))) / U128,
    b: bnToBig(pos.feeBPending) + (liq * (u256le(pool.feeBPerLiquidity) - u256le(pos.feeBPerTokenCheckpoint))) / U128,
  };
}

function lpArgs(l: StockfloorLaunch, m: Migration, payer: PublicKey, overrides: Partial<Record<string, PublicKey>> = {}) {
  return {
    payer,
    keys: l.keys,
    dammPool: m.dammPool,
    position: m.firstPosition,
    positionNftAccount: m.firstPositionNftAccount,
    dammTokenAVault: m.tokenAVault,
    dammTokenBVault: m.tokenBVault,
    overrides,
  };
}

async function dammTrade(fork: Fork, l: StockfloorLaunch, m: Migration, quoteIn: bigint): Promise<Keypair> {
  const w = fundedWallet(fork, quoteIn);
  const base = createAta(fork, w, w.publicKey, l.keys.baseMint, TOKEN_PROGRAM_ID);
  fork.send(
    [await dammSwap2Ix({ keys: m.dammKeys, payer: w.publicKey, inputTokenAccount: spyxAta(w.publicKey), outputTokenAccount: base, amount0: quoteIn, amount1: 0n, swapMode: 0 })],
    [w],
  );
  fork.send(
    [await dammSwap2Ix({ keys: m.dammKeys, payer: w.publicKey, inputTokenAccount: base, outputTokenAccount: spyxAta(w.publicKey), amount0: tokenAmount(fork, base) / 2n, amount1: 0n, swapMode: 0 })],
    [w],
  );
  return w;
}

// ====================================================================================================

describe("C1 adversarial: a random signer cannot redirect any harvest", () => {
  let fork: Fork;
  let L1: StockfloorLaunch; // graduated launch under attack
  let L2: StockfloorLaunch; // another live launch on the same fork
  let m1: Migration;
  let attacker: Keypair;
  let attackerQuote: PublicKey;
  let attackerBase: PublicKey;
  let authorityOwnedBase: PublicKey; // token accounts an attacker created with owner = Authority, not the ATAs
  let authorityOwnedQuote: PublicKey;

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    L1 = await createStockfloorLaunch(fork);
    L2 = await createStockfloorLaunch(fork);
    await buyers(fork, L2, [10n]);
    ({ migration: m1 } = await graduate(fork, L1, [20n, 15n]));
    fork.warp(60);
    await dammTrade(fork, L1, m1, L1.threshold / 5n);
    attacker = fork.newWallet();
    attackerQuote = fundSpyx(fork, attacker, attacker.publicKey, 1n);
    attackerBase = createAta(fork, attacker, attacker.publicKey, L1.keys.baseMint, TOKEN_PROGRAM_ID);
    authorityOwnedBase = createTokenAccountOwnedBy(fork, attacker, L1.authority, L1.keys.baseMint, TOKEN_PROGRAM_ID);
    const spyxAccountLen = fork.mustGetAccount(attackerQuote).data.length;
    authorityOwnedQuote = createTokenAccountOwnedBy(fork, attacker, L1.authority, SPYX_MINT, TOKEN_2022_PROGRAM_ID, spyxAccountLen);
  });

  it("harvest_curve_fees: substituted vault, base account, pool, config or launch are rejected", async () => {
    const a = attacker.publicKey;
    const cases: Array<[string, Partial<Record<string, PublicKey>>, string | RegExp]> = [
      ["vault = attacker SPYx account", { vault: attackerQuote }, "ConstraintAddress"],
      ["vault = another launch's vault", { vault: L2.vault }, "ConstraintAddress"],
      ["authority base account = attacker base account", { authorityBaseAccount: attackerBase }, "ConstraintTokenOwner"],
      ["authority base account = non-ATA base account owned by the Authority", { authorityBaseAccount: authorityOwnedBase }, "AccountNotAssociatedTokenAccount"],
      ["vault = non-ATA SPYx account owned by the Authority", { vault: authorityOwnedQuote }, "ConstraintAddress"],
      ["pool = another launch's pool", { pool: L2.keys.pool }, "InvalidDbcPool"],
      ["config = another launch's config", { config: L2.config }, "InvalidDbcConfig"],
      ["launch = another launch", { launch: deriveLaunch(L2.config) }, "ConstraintSeeds"],
      // Anchor runs `init_if_needed` of authority_base_account before the authority seeds check;
      // the ATA-create CPI references ATA(other authority, base mint), which is not in the
      // transaction, so the runtime rejects it with MissingAccount (verified from the logs).
      ["authority = another launch's authority", { authority: L2.authority }, /MissingAccount/],
      // With ATA(other authority, base mint) in the transaction the ATA is created (payer pays) and the
      // program's own seeds check on the Authority rejects the substitution; the tx rolls back.
      [
        "authority = another launch's authority, with its base ATA included",
        { authority: L2.authority, authorityBaseAccount: splAta(L2.authority, L1.keys.baseMint) },
        "ConstraintSeeds",
      ],
    ];
    for (const [label, overrides, expected] of cases) {
      const f = fork.sendExpectFail([await harvestCurveFeesIx({ payer: a, keys: L1.keys, overrides })], [attacker]);
      expectError(f, expected, label);
    }
  });

  it("harvest_migration_fee and harvest_surplus: substituted vault, pool, launch or authority are rejected", async () => {
    for (const build of [harvestMigrationFeeIx, harvestSurplusIx]) {
      const cases: Array<[string, Partial<Record<string, PublicKey>>, string]> = [
        ["vault = attacker SPYx account", { vault: attackerQuote }, "ConstraintAddress"],
        ["vault = another launch's vault", { vault: L2.vault }, "ConstraintAddress"],
        ["vault = non-ATA SPYx account owned by the Authority", { vault: authorityOwnedQuote }, "ConstraintAddress"],
        ["pool = another launch's pool", { pool: L2.keys.pool }, "InvalidDbcPool"],
        ["launch = another launch", { launch: deriveLaunch(L2.config) }, "ConstraintSeeds"],
        ["authority = another launch's authority", { authority: L2.authority }, "ConstraintSeeds"],
        ["DBC quote vault of another pool", { dbcQuoteVault: L2.keys.quoteVault }, "ConstraintHasOne"],
      ];
      for (const [label, overrides, expected] of cases) {
        const f = fork.sendExpectFail([await build({ keys: L1.keys, overrides })], [attacker]);
        expect(errName(f), `${build.name}: ${label}`).toBe(expected);
      }
    }
  });

  it("harvest_leftover and harvest_lp_fees: substituted destinations and foreign positions are rejected", async () => {
    const a = attacker.publicKey;
    let f = fork.sendExpectFail([await harvestLeftoverIx({ payer: a, keys: L1.keys, overrides: { authorityBaseAccount: attackerBase } })], [attacker]);
    expect(errName(f)).toBe("ConstraintTokenOwner");
    f = fork.sendExpectFail([await harvestLeftoverIx({ payer: a, keys: L1.keys, overrides: { authorityBaseAccount: authorityOwnedBase } })], [attacker]);
    expect(errName(f)).toBe("AccountNotAssociatedTokenAccount");
    f = fork.sendExpectFail([await harvestLeftoverIx({ payer: a, keys: L1.keys, overrides: { pool: L2.keys.pool } })], [attacker]);
    expect(errName(f)).toBe("InvalidDbcPool");

    const lpCases: Array<[string, Partial<Record<string, PublicKey>>, string | RegExp]> = [
      ["vault = attacker SPYx account", { vault: attackerQuote }, "ConstraintAddress"],
      ["vault = another launch's vault", { vault: L2.vault }, "ConstraintAddress"],
      ["authority base account = attacker base account", { authorityBaseAccount: attackerBase }, "ConstraintTokenOwner"],
      ["authority base account = non-ATA base account owned by the Authority", { authorityBaseAccount: authorityOwnedBase }, "AccountNotAssociatedTokenAccount"],
      ["vault = non-ATA SPYx account owned by the Authority", { vault: authorityOwnedQuote }, "ConstraintAddress"],
      ["position NFT account not owned by the Authority", { positionNftAccount: attackerQuote }, "PositionNftNotOwnedByAuthority"],
      ["authority = another launch's authority", { authority: L2.authority }, /MissingAccount/], // see harvest_curve_fees
      [
        "authority = another launch's authority, with its base ATA included",
        { authority: L2.authority, authorityBaseAccount: splAta(L2.authority, L1.keys.baseMint) },
        "ConstraintSeeds",
      ],
    ];
    for (const [label, overrides, expected] of lpCases) {
      f = fork.sendExpectFail([await harvestLpFeesIx(lpArgs(L1, m1, a, overrides))], [attacker]);
      expectError(f, expected, label);
    }
  });

  it("direct DBC / DAMM v2 claims signed by the attacker fail: only the Authority PDA can claim", async () => {
    const a = attacker.publicKey;
    let f = fork.sendExpectFail(
      [await claimTradingFeeIx({ keys: L1.keys, feeClaimer: a, tokenBaseAccount: attackerBase, tokenQuoteAccount: attackerQuote, maxBase: 1n, maxQuote: 1n })],
      [attacker],
    );
    expect(errName(f)).toBe("Unauthorized");
    f = fork.sendExpectFail([await withdrawMigrationFeeIx({ keys: L1.keys, sender: a, tokenQuoteAccount: attackerQuote, flag: 0 })], [attacker]);
    expect(errName(f)).toBe("NotPermitToDoThisAction");
    const surplusIx = await dbcProgram()
      .methods.partnerWithdrawSurplus()
      .accountsStrict({
        poolAuthority: DBC_POOL_AUTHORITY,
        config: L1.config,
        virtualPool: L1.keys.pool,
        tokenQuoteAccount: attackerQuote,
        quoteVault: L1.keys.quoteVault,
        quoteMint: SPYX_MINT,
        feeClaimer: a,
        tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
        eventAuthority: DBC_EVENT_AUTHORITY,
        program: DBC_PROGRAM_ID,
      })
      .instruction();
    f = fork.sendExpectFail([surplusIx], [attacker]);
    expect(errName(f)).toBe("Unauthorized");
    f = fork.sendExpectFail(
      [
        await claimPositionFeeIx({
          keys: m1.dammKeys,
          position: m1.firstPosition,
          positionNftAccount: m1.firstPositionNftAccount,
          signer: a,
          tokenAAccount: attackerBase,
          tokenBAccount: attackerQuote,
        }),
      ],
      [attacker],
    );
    expect(errName(f)).toBe("InvalidAuthority");
  });

  it("cranking honestly, the attacker pays only SOL; every harvest pays exact amounts into the vault", async () => {
    const a = attacker.publicKey;
    const q0 = tokenAmount(fork, attackerQuote);
    const b0 = tokenAmount(fork, attackerBase);
    const expectedCurve = bnToBig(fetchVirtualPool(fork, L1.keys.pool).partnerQuoteFee);
    const T = L1.threshold;
    const expectedMigration = T - ceilDiv(T * 50n, 100n);
    const surplus = bnToBig(fetchVirtualPool(fork, L1.keys.pool).quoteReserve) - T;
    const pc = (surplus * 80n) / 100n;
    const expectedSurplus = pc - (pc * 30n) / 100n;
    const lp = pendingLpFee(fork, m1);
    expect(expectedCurve).toBeGreaterThan(0n);
    expect(lp.b).toBeGreaterThan(0n);
    expect(lp.a).toBe(0n);

    const step = async (ix: Promise<TransactionInstruction>, expected: bigint) => {
      const v0 = tokenAmount(fork, L1.vault);
      fork.send([await ix], [attacker]);
      expect(tokenAmount(fork, L1.vault) - v0).toBe(expected);
    };
    await step(harvestCurveFeesIx({ payer: a, keys: L1.keys }), expectedCurve);
    await step(harvestMigrationFeeIx({ keys: L1.keys }), expectedMigration);
    await step(harvestSurplusIx({ keys: L1.keys }), expectedSurplus);
    await step(harvestLeftoverIx({ payer: a, keys: L1.keys }), 0n);
    await step(harvestLpFeesIx(lpArgs(L1, m1, a)), lp.b);

    expect(tokenAmount(fork, L1.vault)).toBe(expectedCurve + expectedMigration + expectedSurplus + lp.b);
    console.log(JSON.stringify({ honestCrank: { curveFees: expectedCurve, migrationFee: expectedMigration, surplus: expectedSurplus, lpFees: lp.b } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(tokenAmount(fork, attackerQuote)).toBe(q0);
    expect(tokenAmount(fork, attackerBase)).toBe(b0);
    expect(tokenAmount(fork, L1.authorityBaseAccount)).toBe(0n);
    // The other launch is untouched.
    expect(tokenAmount(fork, L2.vault)).toBe(0n);
  });
});

// ====================================================================================================

describe("C1 adversarial: harvest_migration_fee before migration does not open redemptions", () => {
  it("fee harvested after completion but before migration: redeem stays closed until migration completes", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    const [alice] = await buyers(fork, L, [25n]);
    await completeWithPartialFill(fork, L);

    const T = L.threshold;
    const expectedFee = T - ceilDiv(T * 50n, 100n);
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
    expect(tokenAmount(fork, L.vault)).toBe(expectedFee);
    expect(fetchLaunch(fork, L.config).migrationFeeHarvested).toBe(true);
    expect(fetchVirtualPool(fork, L.keys.pool).isMigrated).toBe(0);

    const amount = tokenAmount(fork, splAta(alice.publicKey, L.keys.baseMint)) / 2n;
    const f = fork.sendExpectFail([await redeemIx({ holder: alice.publicKey, keys: L.keys, amount })], [alice]);
    expect(errName(f)).toBe("MigrationNotComplete");

    // Migration still works and seeds DAMM v2 with the same quote as in the normal order.
    const m = await migrateToDammV2(fork, L.keys);
    const q = ceilDiv(T * 50n, 100n);
    expect(bnToBig(fetchDammPool(fork, m.dammPool).tokenBAmount)).toBe(q - (q * 20n) / 10_000n);

    const V = tokenAmount(fork, L.vault);
    const S = mintSupply(fork, L.keys.baseMint);
    const gross = (V * amount) / S;
    const net = gross - ceilDiv(gross * 200n, 10_000n);
    const q0 = tokenAmount(fork, spyxAta(alice.publicKey));
    fork.send([await redeemIx({ holder: alice.publicKey, keys: L.keys, amount })], [alice]);
    expect(tokenAmount(fork, spyxAta(alice.publicKey)) - q0).toBe(net);
    expect(tokenAmount(fork, L.vault)).toBe(V - net);
  });
});

// ====================================================================================================

describe("C1 adversarial: a second pool on the same config never feeds or drains the vault", () => {
  it("rogue pool fees, migration fee, surplus, leftover and LP position are unreachable; its tokens cannot redeem", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    await buyers(fork, L, [10n]);

    // A rogue pool on the launch's config: same fee_claimer (the Authority), different base mint.
    const rogueCreator = fork.newWallet();
    const rogueMint = Keypair.generate();
    const init = await initializeVirtualPoolWithSplTokenIx({
      config: L.config,
      creator: rogueCreator.publicKey,
      baseMint: rogueMint.publicKey,
      quoteMint: SPYX_MINT,
      payer: rogueCreator.publicKey,
      name: "Rogue",
      symbol: "RGE",
      uri: "https://example.com/rogue.json",
      tokenBadge: DBC_TOKEN_BADGE_SPYX,
    });
    fork.send([init.ix], [rogueCreator, rogueMint]);
    const rogueKeys: DbcPoolKeys = { ...L.keys, pool: init.pool, baseMint: rogueMint.publicKey, baseVault: init.baseVault, quoteVault: init.quoteVault };
    const rogueLaunch: StockfloorLaunch = { ...L, keys: rogueKeys };
    const rogueHolder = fundedWallet(fork, L.threshold);
    await buyOnCurve(fork, rogueKeys, rogueHolder, L.threshold / 4n);
    await completeWithPartialFill(fork, rogueLaunch);
    const rogueMigration = await migrateToDammV2(fork, rogueKeys);
    expect(fetchVirtualPool(fork, rogueKeys.pool).isMigrated).toBe(1);
    // DAMM v2 gave the rogue position NFT to the same Authority PDA.
    expect(fetchPosition(fork, rogueMigration.firstPosition).pool.equals(rogueMigration.dammPool)).toBe(true);
    expect(fetchDammPool(fork, rogueMigration.dammPool).tokenAMint.equals(rogueMint.publicKey)).toBe(true);

    const c = fork.newWallet();
    const cases: Array<[string, Promise<TransactionInstruction>, string]> = [
      ["harvest_curve_fees on the rogue pool", harvestCurveFeesIx({ payer: c.publicKey, keys: rogueKeys }), "InvalidDbcPool"],
      ["harvest_migration_fee on the rogue pool", harvestMigrationFeeIx({ keys: rogueKeys }), "InvalidDbcPool"],
      ["harvest_surplus on the rogue pool", harvestSurplusIx({ keys: rogueKeys }), "InvalidDbcPool"],
      ["harvest_leftover on the rogue pool", harvestLeftoverIx({ payer: c.publicKey, keys: rogueKeys }), "InvalidDbcPool"],
      [
        "harvest_lp_fees on the rogue DAMM v2 pool (launch base mint)",
        harvestLpFeesIx({ ...lpArgs(L, rogueMigration, c.publicKey) }),
        "DammPoolMintMismatch",
      ],
      [
        "harvest_lp_fees on the rogue DAMM v2 pool (rogue base mint)",
        harvestLpFeesIx({ ...lpArgs(rogueLaunch, rogueMigration, c.publicKey) }),
        "BaseMintMismatch",
      ],
    ];
    for (const [label, ix, expected] of cases) {
      const f = fork.sendExpectFail([await ix], [c]);
      expect(errName(f), label).toBe(expected);
    }
    // Rogue base tokens cannot be redeemed against the launch vault.
    const rogueAmount = tokenAmount(fork, splAta(rogueHolder.publicKey, rogueMint.publicKey));
    let f = fork.sendExpectFail([await redeemIx({ holder: rogueHolder.publicKey, keys: rogueKeys, amount: rogueAmount })], [rogueHolder]);
    expect(errName(f)).toBe("InvalidDbcPool");
    f = fork.sendExpectFail(
      [await redeemIx({ holder: rogueHolder.publicKey, keys: L.keys, amount: rogueAmount, overrides: { baseMint: rogueMint.publicKey, holderBaseAccount: splAta(rogueHolder.publicKey, rogueMint.publicKey) } })],
      [rogueHolder],
    );
    expect(errName(f)).toBe("BaseMintMismatch");

    expect(tokenAmount(fork, L.vault)).toBe(0n);
    const launch = fetchLaunch(fork, L.config);
    expect(launch.pool.equals(L.keys.pool)).toBe(true);
    expect(bnToBig(launch.totalHarvestedQuote)).toBe(0n);
    // The rogue pool's partner-side value stays in DBC / DAMM v2 (ignored forever).
    expect(fetchVirtualPool(fork, rogueKeys.pool).migrationFeeWithdrawStatus & 0b100).toBe(0);
  });
});

// ====================================================================================================

// Routing check on patched state: the CPI into the real DBC binary and the destination are real, but
// the surplus itself is a cheatcode (no DBC 0.2.1 swap can overshoot the threshold). In the real
// flow the surplus is rounding dust; c1-lifecycle 8e ties that amount to DBC's own surplus event.
describe("C1 edge: harvest_surplus routing with a non-trivial surplus (cheatcode state, not reachable by DBC 0.2.1 swaps)", () => {
  it("pays exactly floor(floor(surplus * 80%) * (100 - 30)%) of DBC's surplus into the vault", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    await graduate(fork, L, [30n]);
    // DBC 0.2.1 caps swaps at the migration price, so emulate an overshooting buy: raise the pool's
    // quote_reserve (VirtualPool offset 8 + 232) and the DBC quote vault balance by the same amount.
    const extra = 12_345_678n;
    fork.patchAccount(L.keys.pool, (d) => d.writeBigUInt64LE(d.readBigUInt64LE(240) + extra, 240));
    setTokenAmount(fork, L.keys.quoteVault, tokenAmount(fork, L.keys.quoteVault) + extra);
    setMintSupply(fork, SPYX_MINT, mintSupply(fork, SPYX_MINT) + extra);

    const surplus = bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve) - L.threshold;
    expect(surplus).toBeGreaterThanOrEqual(extra);
    const pc = (surplus * 80n) / 100n;
    const expected = pc - (pc * 30n) / 100n;
    const dbc0 = tokenAmount(fork, L.keys.quoteVault);
    fork.send([await harvestSurplusIx({ keys: L.keys })], [fork.newWallet(1)]);
    expect(tokenAmount(fork, L.vault)).toBe(expected);
    expect(dbc0 - tokenAmount(fork, L.keys.quoteVault)).toBe(expected);
    expect(expected).toBeGreaterThan(0n);
    console.log(JSON.stringify({ cheatSurplus: { surplus, partnerShare: expected } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });
});

// ====================================================================================================

describe("FloorTracker self-check: the invariant checker rejects violations", () => {
  let fork: Fork;
  let L: StockfloorLaunch;
  let holder: Keypair;
  let tracked: PublicKey[];

  const newTracker = () => {
    const t = new FloorTracker(fork, L.vault, L.keys.baseMint, L.authority, SPYX_MINT, L.authorityBaseAccount);
    t.trackBase(...tracked);
    t.start("start");
    return t;
  };

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    L = await createStockfloorLaunch(fork);
    const g = await graduate(fork, L, [20n, 10n]);
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
    holder = g.buyers[0];
    tracked = [L.keys.baseVault, g.migration.tokenAVault, g.whale, ...g.buyers].map((x) =>
      x instanceof PublicKey ? x : splAta(x.publicKey, L.keys.baseMint),
    );
    newTracker(); // the honest state passes
  });

  it("rejects quote leaving the vault outside redeem", async () => {
    const t = newTracker();
    const v = tokenAmount(fork, L.vault);
    await expect(t.step("cheat outflow", "no-outflow", () => setTokenAmount(fork, L.vault, v - 1n))).rejects.toThrow(/vault must not decrease/);
    setTokenAmount(fork, L.vault, v);
  });

  it("rejects a redeem whose vault outflow differs from the declared net, and a redeem declared as no-outflow", async () => {
    const amount = tokenAmount(fork, splAta(holder.publicKey, L.keys.baseMint)) / 10n;
    const V = tokenAmount(fork, L.vault);
    const S = mintSupply(fork, L.keys.baseMint);
    const gross = (V * amount) / S;
    const net = gross - ceilDiv(gross * 200n, 10_000n);
    let t = newTracker();
    await expect(
      t.step("redeem with a wrong net", "redeem", async () => fork.send([await redeemIx({ holder: holder.publicKey, keys: L.keys, amount })], [holder]), { vaultOut: net + 1n }),
    ).rejects.toThrow(/vault outflow equals/);
    t = newTracker();
    await expect(
      t.step("redeem declared as no-outflow", "no-outflow", async () => fork.send([await redeemIx({ holder: holder.publicKey, keys: L.keys, amount })], [holder])),
    ).rejects.toThrow(/vault must not decrease/);
  });

  it("rejects a floor decrease, a supply that does not reconcile, and base left at the Authority", async () => {
    let t = newTracker();
    const S = mintSupply(fork, L.keys.baseMint);
    const bal = tokenAmount(fork, tracked[tracked.length - 1]);
    // Minting base out of thin air (supply and a balance up) keeps the reconciliation but lowers the floor.
    await expect(
      t.step("cheat mint", "no-outflow", () => {
        setMintSupply(fork, L.keys.baseMint, S + S);
        setTokenAmount(fork, tracked[tracked.length - 1], bal + S);
      }),
    ).rejects.toThrow(/floor decreased/);
    setMintSupply(fork, L.keys.baseMint, S);
    setTokenAmount(fork, tracked[tracked.length - 1], bal);

    t = newTracker();
    await expect(t.step("cheat supply", "no-outflow", () => setMintSupply(fork, L.keys.baseMint, S - 1n))).rejects.toThrow(/sum of all base token accounts/);
    setMintSupply(fork, L.keys.baseMint, S);

    t = newTracker();
    createAta(fork, holder, deriveStockfloorAuthority(L.config), L.keys.baseMint, TOKEN_PROGRAM_ID);
    const hb = splAta(holder.publicKey, L.keys.baseMint);
    const hbal = tokenAmount(fork, hb);
    await expect(
      t.step("base parked at the Authority", "no-outflow", () => {
        setTokenAmount(fork, hb, hbal - 5n);
        setTokenAmount(fork, L.authorityBaseAccount, 5n);
      }),
    ).rejects.toThrow(/Authority holds no base tokens/);
    setTokenAmount(fork, L.authorityBaseAccount, 0n);
    setTokenAmount(fork, hb, hbal);
    newTracker();
  });
});


// ====================================================================================================

/** Token account `state` byte (0 uninitialized, 1 initialized, 2 frozen). */
const setAccountState = (fork: Fork, account: PublicKey, state: number) => fork.patchAccount(account, (d) => (d[108] = state));

/** Cheatcode: set (or clear) the Token-2022 TransferHook program id of a mint (extension: authority 32 + program_id 32). */
function setTransferHookProgram(fork: Fork, mint: PublicKey, programId: PublicKey | null): void {
  fork.patchAccount(mint, (d) => {
    const { offset } = findExtension(d, ExtensionType.TransferHook);
    if (offset < 0) throw new Error("mint has no TransferHook extension");
    (programId ?? PublicKey.default).toBuffer().copy(d, offset + 32);
  });
}

describe("Quote issuer controls (pause, frozen vault, transfer hook) fail cleanly on every quote-moving instruction", () => {
  it("each harvest and redeem fails with a clear error and no state change, works after restore; a multiplier change leaves raw math exact", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    const g = await graduate(fork, L, [25n, 10n]);
    fork.warp(60);
    await dammTrade(fork, L, g.migration, L.threshold / 5n);
    const c = fork.newWallet(1);
    const hookProgram = Keypair.generate().publicKey;
    const modes: Array<[string, () => void, () => void, string]> = [
      ["SPYx paused", () => setMintPaused(fork, SPYX_MINT, true), () => setMintPaused(fork, SPYX_MINT, false), "QuoteMintPaused"],
      ["vault frozen", () => setAccountState(fork, L.vault, 2), () => setAccountState(fork, L.vault, 1), "VaultFrozen"],
      [
        "transfer hook program set",
        () => setTransferHookProgram(fork, SPYX_MINT, hookProgram),
        () => setTransferHookProgram(fork, SPYX_MINT, null),
        "QuoteMintTransferHookUnsupported",
      ],
    ];
    const snapshot = () => {
      const l = fetchLaunch(fork, L.config);
      return {
        vault: tokenAmount(fork, L.vault),
        supply: mintSupply(fork, L.keys.baseMint),
        dbcQuote: tokenAmount(fork, L.keys.quoteVault),
        dammQuote: tokenAmount(fork, g.migration.tokenBVault),
        flags: [l.migrationFeeHarvested, l.surplusHarvested, l.migrated],
        totals: [bnToBig(l.totalHarvestedQuote), bnToBig(l.totalRedeemedQuote)],
      };
    };

    // Phase A: harvests under each control.
    const harvests = () =>
      [
        ["harvest_curve_fees", harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys })],
        ["harvest_migration_fee", harvestMigrationFeeIx({ keys: L.keys })],
        ["harvest_surplus", harvestSurplusIx({ keys: L.keys })],
        ["harvest_lp_fees", harvestLpFeesIx(lpArgs(L, g.migration, c.publicKey))],
      ] as const;
    for (const [mode, set, restore, expected] of modes) {
      const before = snapshot();
      set();
      for (const [label, ix] of harvests()) {
        expect(errName(fork.sendExpectFail([await ix], [c])), `${label} with ${mode}`).toBe(expected);
      }
      restore();
      expect(snapshot(), mode).toEqual(before);
    }

    // Phase B: a multiplier change (dividend) before harvesting does not change any raw amount.
    const T = L.threshold;
    const expectedCurve = bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee);
    const lp = pendingLpFee(fork, g.migration);
    setScaledUiMultiplier(fork, SPYX_MINT, 1.5);
    const v0 = tokenAmount(fork, L.vault);
    for (const [, ix] of harvests()) fork.send([await ix], [c]);
    const surplus = bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve) - T;
    const pc = (surplus * 80n) / 100n;
    expect(tokenAmount(fork, L.vault) - v0).toBe(expectedCurve + (T - ceilDiv(T * 50n, 100n)) + (pc - (pc * 30n) / 100n) + lp.b);

    // Phase C: redeem under each control, then exact after restore (still at multiplier 1.5, then 0.8).
    const [holder] = g.buyers;
    const holderBase = splAta(holder.publicKey, L.keys.baseMint);
    const amount = tokenAmount(fork, holderBase) / 4n;
    for (const [mode, set, restore, expected] of modes) {
      const before = snapshot();
      const hb = tokenAmount(fork, holderBase);
      const hq = tokenAmount(fork, spyxAta(holder.publicKey));
      set();
      expect(errName(fork.sendExpectFail([await redeemIx({ holder: holder.publicKey, keys: L.keys, amount })], [holder])), `redeem with ${mode}`).toBe(expected);
      restore();
      expect(snapshot(), mode).toEqual(before);
      expect([tokenAmount(fork, holderBase), tokenAmount(fork, spyxAta(holder.publicKey))]).toEqual([hb, hq]);
    }
    for (const multiplier of [1.5, 0.8]) {
      setScaledUiMultiplier(fork, SPYX_MINT, multiplier);
      const V = tokenAmount(fork, L.vault);
      const S = mintSupply(fork, L.keys.baseMint);
      const gross = (V * amount) / S;
      const net = gross - ceilDiv(gross * 200n, 10_000n);
      const q0 = tokenAmount(fork, spyxAta(holder.publicKey));
      fork.send([await redeemIx({ holder: holder.publicKey, keys: L.keys, amount })], [holder]);
      expect(tokenAmount(fork, spyxAta(holder.publicKey)) - q0, `net at multiplier ${multiplier}`).toBe(net);
      expect(tokenAmount(fork, L.vault)).toBe(V - net);
      expect(mintSupply(fork, L.keys.baseMint)).toBe(S - amount);
    }
  });
});

// ====================================================================================================

describe("Redemption edge cases on the fork: vault donation, exit fee 0 / 500 bps, split redemptions, entire supply", () => {
  /** Graduated launch with the migration fee harvested; returns its curve buyers. */
  async function openLaunch(fork: Fork, exitFeeBps: number): Promise<{ L: StockfloorLaunch; holders: Keypair[]; migration: Migration }> {
    const L = await createStockfloorLaunch(fork, { exitFeeBps });
    const g = await graduate(fork, L, [25n, 15n]);
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
    return { L, holders: g.buyers, migration: g.migration };
  }

  async function redeemAndCheck(fork: Fork, L: StockfloorLaunch, holder: Keypair, amount: bigint): Promise<{ gross: bigint; fee: bigint; net: bigint }> {
    const V = tokenAmount(fork, L.vault);
    const S = mintSupply(fork, L.keys.baseMint);
    const gross = (V * amount) / S;
    const fee = ceilDiv(gross * BigInt(L.exitFeeBps), 10_000n);
    const net = gross - fee;
    const q0 = tokenAmount(fork, spyxAta(holder.publicKey));
    fork.send([await redeemIx({ holder: holder.publicKey, keys: L.keys, amount })], [holder]);
    expect(tokenAmount(fork, spyxAta(holder.publicKey)) - q0).toBe(net);
    expect(tokenAmount(fork, L.vault)).toBe(V - net);
    expect(mintSupply(fork, L.keys.baseMint)).toBe(S - amount);
    // Floor never decreases (strictly increases when a fee is retained and supply remains).
    const V1 = V - net;
    const S1 = S - amount;
    if (S1 > 0n) {
      expect(V1 * S >= V * S1).toBe(true);
      if (fee > 0n) expect(V1 * S > V * S1).toBe(true);
    }
    return { gross, fee, net };
  }

  it("SPYx donated straight to the vault raises the floor and is paid out pro rata", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const { L, holders } = await openLaunch(fork, 200);
    const [alice] = holders;
    const V0 = tokenAmount(fork, L.vault);
    const S0 = mintSupply(fork, L.keys.baseMint);
    const donation = 50_000_000n; // 0.5 SPYx
    const donor = fundedWallet(fork, donation);
    fork.send(
      [createTransferCheckedInstruction(spyxAta(donor.publicKey), SPYX_MINT, L.vault, donor.publicKey, donation, 8, [], TOKEN_2022_PROGRAM_ID)],
      [donor],
    );
    expect(tokenAmount(fork, L.vault)).toBe(V0 + donation);
    expect(mintSupply(fork, L.keys.baseMint)).toBe(S0);
    const amount = tokenAmount(fork, splAta(alice.publicKey, L.keys.baseMint)) / 2n;
    const r = await redeemAndCheck(fork, L, alice, amount);
    expect(r.gross).toBe(((V0 + donation) * amount) / S0);
    expect(r.gross).toBeGreaterThan((V0 * amount) / S0);
  });

  it("exit fee 0: net = gross = floor(V*a/S); a redemption split into 10 parts never pays more than one redemption of the total", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const { L, holders } = await openLaunch(fork, 0);
    const [alice, bob] = holders;
    const V0 = tokenAmount(fork, L.vault);
    const S0 = mintSupply(fork, L.keys.baseMint);
    const total = tokenAmount(fork, splAta(alice.publicKey, L.keys.baseMint));
    const part = total / 10n;
    let paid = 0n;
    for (let i = 0; i < 10; i++) {
      const r = await redeemAndCheck(fork, L, alice, part);
      expect(r.fee).toBe(0n);
      expect(r.net).toBe(r.gross);
      paid += r.net;
    }
    expect(paid <= (V0 * (part * 10n)) / S0).toBe(true);
    // Dust: an amount whose pro-rata share rounds to 0 is rejected rather than burned for nothing.
    const dust = mintSupply(fork, L.keys.baseMint) / tokenAmount(fork, L.vault) - 1n;
    expect(dust).toBeGreaterThan(0n);
    expect(tokenAmount(fork, splAta(bob.publicKey, L.keys.baseMint))).toBeGreaterThan(dust);
    expect(errName(fork.sendExpectFail([await redeemIx({ holder: bob.publicKey, keys: L.keys, amount: dust })], [bob]))).toBe("NothingToRedeem");
  });

  it("exit fee 500 bps (the cap): fee = ceil(gross * 5%) stays in the vault", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const { L, holders } = await openLaunch(fork, 500);
    for (const h of holders) {
      const r = await redeemAndCheck(fork, L, h, tokenAmount(fork, splAta(h.publicKey, L.keys.baseMint)));
      expect(r.fee).toBe(ceilDiv(r.gross * 500n, 10_000n));
      expect(r.fee).toBeGreaterThan(0n);
    }
  });

  it("redeeming the entire supply (cheatcode: one holder owns all base) pays vault minus fee and leaves only the fee", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const { L, holders, migration } = await openLaunch(fork, 200);
    const [alice, ...others] = holders;
    const S = mintSupply(fork, L.keys.baseMint);
    // Move every base balance to alice (DBC base vault, DAMM v2 base vault, other holders).
    for (const acc of [L.keys.baseVault, migration.tokenAVault, ...others.map((o) => splAta(o.publicKey, L.keys.baseMint))]) {
      setTokenAmount(fork, acc, 0n);
    }
    setTokenAmount(fork, splAta(alice.publicKey, L.keys.baseMint), S);
    const V = tokenAmount(fork, L.vault);
    const r = await redeemAndCheck(fork, L, alice, S);
    expect(r.gross).toBe(V);
    expect(tokenAmount(fork, L.vault)).toBe(r.fee);
    expect(mintSupply(fork, L.keys.baseMint)).toBe(0n);
    expect(errName(fork.sendExpectFail([await redeemIx({ holder: alice.publicKey, keys: L.keys, amount: 1n })], [alice]))).toBe("InsufficientBaseBalance");
  });
});
