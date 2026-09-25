/**
 * Regression tests for the M1 review findings, on the mainnet fork with the real stockfloor
 * program, DBC 0.2.1, DAMM v2 0.2.4, Token-2022 and SPYx. Each block first reproduced the finding
 * against the pre-fix binary (it failed there) and now guards the fix:
 *
 * 1. create_launch accepted DBC configs that are not StockFloor-shaped: fixed supply (DBC leftover
 *    base stays in mint.supply after migration and underpays early redeemers), creator trading
 *    share up to 100%, curve fees up to 99%, dynamic fee, compounding / base-token LP fees,
 *    creator-updatable metadata, pool creation fee. The real DBC accepts every one of them.
 * 2. The creator could withhold register_pool forever (migration fee stuck in DBC, no floor).
 *    create_launch now commits the base mint and register_pool is permissionless.
 * 3. redeem decoded the upgradeable DBC VirtualPool (exact size) on every call. Migration is now
 *    latched in Launch.migrated and decoders accept grown accounts.
 * 4. Harvests signed with the vault owner into upgradeable DBC / DAMM v2 with the vault writable,
 *    and only compared balances. They now refuse a vault with a delegate, close authority or an
 *    owner other than the vault authority (CPI Guard and required memos are covered by the Rust
 *    unit tests). Since M2 the vault owner is a separate PDA that never signs those CPIs at all
 *    (see vault-authority.test.ts); this check remains as defence in depth.
 * 5. The floor view had no floor per token (see c1-lifecycle and the smoke test for the Q64 value).
 */
import { BN } from "@coral-xyz/anchor";
import { getDynamicFeeParams } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { authorityPda, buildDbcConfigParams, DEFAULT_QUOTE_ASSET } from "@stockfloor/sdk";
import { describe, expect, it } from "vitest";
import { DBC_TOKEN_BADGE_SPYX, SPYX_MINT, TOKEN_2022_PROGRAM_ID } from "../src/constants.js";
import { bnToBig, createConfigIx, fetchVirtualPool, initializeVirtualPoolWithSplTokenIx } from "../src/dbc.js";
import { applyFeeModelV3 } from "../src/fee-model.js";
import { anchorErrorFromLogs, Fork, TxFailure } from "../src/fork.js";
import { dammSwap2Ix } from "../src/damm.js";
import { fundedWallet, migrateToDammV2 } from "../src/scenario.js";
import {
  buyers,
  completeWithPartialFill,
  createStockfloorLaunch,
  graduate,
  SPYX_USD_PRICE,
  spyxMultiplier,
  StockfloorLaunch,
} from "../src/stockfloor-scenario.js";
import {
  createLaunchIx,
  decodeFloorReturn,
  deriveLaunch,
  deriveVault,
  expectedFloorQ64,
  fetchLaunch,
  floorIx,
  harvestCurveFeesIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  redeemIx,
  registerPoolIx,
} from "../src/stockfloor.js";
import { createAta, mintSupply, splAta, spyxAta, tokenAmount } from "../src/token.js";

const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Send create_launch for a launch built with `skipCreateLaunch` and return the failure. */
async function createLaunchExpectFail(fork: Fork, L: StockfloorLaunch, baseMint = L.keys.baseMint): Promise<TxFailure> {
  return fork.sendExpectFail(
    [await createLaunchIx({ payer: L.partner.publicKey, creator: L.creator.publicKey, config: L.config, baseMint, exitFeeBps: 200 })],
    [L.partner, L.creator, L.configKeypair],
  );
}

/** Exact redemption of `amount` by `holder`; returns the net paid. */
async function redeemExact(fork: Fork, L: StockfloorLaunch, holder: Keypair, amount: bigint): Promise<bigint> {
  const V = tokenAmount(fork, L.vault);
  const S = mintSupply(fork, L.keys.baseMint);
  const gross = (V * amount) / S;
  const net = gross - ceilDiv(gross * BigInt(L.exitFeeBps), 10_000n);
  const q0 = tokenAmount(fork, spyxAta(holder.publicKey));
  fork.send([await redeemIx({ holder: holder.publicKey, keys: L.keys, amount })], [holder]);
  expect(tokenAmount(fork, spyxAta(holder.publicKey)) - q0).toBe(net);
  expect(tokenAmount(fork, L.vault)).toBe(V - net);
  expect(mintSupply(fork, L.keys.baseMint)).toBe(S - amount);
  return net;
}

// ====================================================================================================

describe("1. create_launch binds the StockFloor shape of the DBC config", () => {
  const cases: Array<[string, (p: any) => void, string]> = [
    [
      "fixed token supply (pre = post = 2e15 raw)",
      (p) => (p.tokenSupply = { preMigrationTokenSupply: new BN("2000000000000000"), postMigrationTokenSupply: new BN("2000000000000000") }),
      "FixedTokenSupplyNotAllowed",
    ],
    ["creator trading fee share 1%", (p) => (p.creatorTradingFeePercentage = 1), "CreatorTradingFeeTooHigh"],
    ["creator trading fee share 30% (the v2 preset)", (p) => (p.creatorTradingFeePercentage = 30), "CreatorTradingFeeTooHigh"],
    ["creator trading fee share 100%", (p) => (p.creatorTradingFeePercentage = 100), "CreatorTradingFeeTooHigh"],
    ["flat 50% curve fee", (p) => (p.poolFees.baseFee.cliffFeeNumerator = new BN(500_000_000)), "CurveFeeTooHigh"],
    ["curve fee 20% + 1 numerator", (p) => (p.poolFees.baseFee.cliffFeeNumerator = new BN(200_000_001)), "CurveFeeTooHigh"],
    ["dynamic (volatility) fee enabled", (p) => (p.poolFees.dynamicFee = getDynamicFeeParams(100)), "DynamicFeeNotAllowed"],
    ["migrated LP fees in both tokens (OutputToken)", (p) => (p.migratedPoolFee.collectFeeMode = 1), "MigratedCollectFeeModeNotQuote"],
    [
      "migrated LP fees compounding (never claimable)",
      (p) => {
        p.migratedPoolFee.collectFeeMode = 2;
        p.compoundingFeeBps = 5000;
      },
      "MigratedCollectFeeModeNotQuote",
    ],
    ["creator can update token metadata", (p) => (p.tokenUpdateAuthority = 0), "TokenUpdateAuthorityNotImmutable"],
    ["partner update authority", (p) => (p.tokenUpdateAuthority = 2), "TokenUpdateAuthorityNotImmutable"],
    ["pool creation fee 0.01 SOL", (p) => (p.poolCreationFee = new BN(10_000_000)), "PoolCreationFeeNotZero"],
    // Brief §5.3.1 checks that were only unit tested before.
    ["creator migration fee share 10%", (p) => (p.migrationFee.creatorFeePercentage = 10), "CreatorMigrationFeeNotZero"],
    [
      "partner liquidity 90% permanent + 10% unlocked",
      (p) => {
        p.partnerPermanentLockedLiquidityPercentage = 90;
        p.partnerLiquidityPercentage = 10;
      },
      "LiquidityNotFullyPartnerLocked",
    ],
    ["curve fees collected in both tokens", (p) => (p.collectFeeMode = 1), "CollectFeeModeNotQuote"],
  ];

  it("the real DBC accepts each out-of-shape config; create_launch rejects it and creates nothing", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    for (const [label, mutate, expected] of cases) {
      const L = await createStockfloorLaunch(fork, { mutateParams: mutate, skipCreateLaunch: true });
      const f = await createLaunchExpectFail(fork, L);
      expect(errName(f), label).toBe(expected);
      expect(fork.getAccount(deriveLaunch(L.config)), label).toBeNull();
      expect(fork.getAccount(L.vault), label).toBeNull();
    }
  });

  it("a fixed-supply config really leaves DBC leftover base in the supply after migration (why it is rejected)", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, {
      mutateParams: (p) => (p.tokenSupply = { preMigrationTokenSupply: new BN("2000000000000000"), postMigrationTokenSupply: new BN("2000000000000000") }),
      skipCreateLaunch: true,
    });
    await buyers(fork, L, [30n]);
    await completeWithPartialFill(fork, L);
    await migrateToDammV2(fork, L.keys);
    const pool = fetchVirtualPool(fork, L.keys.pool);
    const leftover = tokenAmount(fork, L.keys.baseVault) - BigInt(pool.protocolMigrationBaseFeeAmount.toString());
    // Base that never circulates but counts in mint.supply until withdraw_leftover + burn.
    expect(leftover).toBeGreaterThan(mintSupply(fork, L.keys.baseMint) / 3n);
    expect(errName(await createLaunchExpectFail(fork, L))).toBe("FixedTokenSupplyNotAllowed");
  });

  it("the brief's anti-snipe schedule (exponential 20% -> ~1%, creator share 30%) is accepted at the bound", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, {
      mutateParams: (p) => {
        p.poolFees.baseFee = {
          cliffFeeNumerator: new BN(200_000_000),
          firstFactor: 10, // number_of_period
          secondFactor: new BN(180), // period_frequency (s)
          thirdFactor: new BN(2589), // reduction_factor (bps per period)
          baseFeeMode: 1, // FeeSchedulerExponential
        };
      },
    });
    const launch = fetchLaunch(fork, L.config);
    expect(launch.pool.equals(L.keys.pool)).toBe(true);
  });

  it("the committed base mint must be a real candidate: default pubkey or the quote mint are rejected", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, { skipCreateLaunch: true });
    expect(errName(await createLaunchExpectFail(fork, L, PublicKey.default))).toBe("InvalidBaseMint");
    expect(errName(await createLaunchExpectFail(fork, L, SPYX_MINT))).toBe("InvalidBaseMint");
  });
});

// ====================================================================================================

describe("2. register_pool is permissionless for the committed base mint: the creator cannot withhold the floor", () => {
  it("the creator never registers; a random wallet registers, harvests the migration fee and holders redeem", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, { skipRegister: true });
    const [alice] = await buyers(fork, L, [25n]);

    // Unregistered: every crank and redeem fails with PoolNotRegistered.
    const c = fork.newWallet(1);
    for (const [label, ix] of [
      ["harvest_curve_fees", harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys })],
      ["harvest_migration_fee", harvestMigrationFeeIx({ keys: L.keys })],
      ["harvest_surplus", harvestSurplusIx({ keys: L.keys })],
    ] as const) {
      expect(errName(fork.sendExpectFail([await ix], [c])), label).toBe("PoolNotRegistered");
    }
    const aliceBase = tokenAmount(fork, splAta(alice.publicKey, L.keys.baseMint));
    expect(errName(fork.sendExpectFail([await redeemIx({ holder: alice.publicKey, keys: L.keys, amount: aliceBase })], [alice]))).toBe("PoolNotRegistered");

    // The creator also made a second pool on the config with another mint: it cannot be registered.
    const otherMint = Keypair.generate();
    const other = await initializeVirtualPoolWithSplTokenIx({
      config: L.config,
      creator: L.creator.publicKey,
      baseMint: otherMint.publicKey,
      quoteMint: SPYX_MINT,
      payer: L.creator.publicKey,
      name: "Other",
      symbol: "OTH",
      uri: "https://example.com/other.json",
      tokenBadge: DBC_TOKEN_BADGE_SPYX,
    });
    fork.send([other.ix], [L.creator, otherMint]);
    const stranger = fork.newWallet(1);
    let f = fork.sendExpectFail([await registerPoolIx({ config: L.config, pool: other.pool, baseMint: otherMint.publicKey })], [stranger]);
    expect(errName(f)).toBe("BaseMintMismatch");
    f = fork.sendExpectFail([await registerPoolIx({ config: L.config, pool: other.pool, baseMint: L.keys.baseMint })], [stranger]);
    expect(errName(f)).toBe("BaseMintMismatch");

    fork.send([await registerPoolIx({ config: L.config, pool: L.keys.pool, baseMint: L.keys.baseMint })], [stranger]);
    expect(fetchLaunch(fork, L.config).pool.equals(L.keys.pool)).toBe(true);

    await completeWithPartialFill(fork, L);
    await migrateToDammV2(fork, L.keys);
    const T = L.threshold;
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [stranger]);
    expect(tokenAmount(fork, L.vault)).toBe(T - ceilDiv(T * 50n, 100n));
    await redeemExact(fork, L, alice, tokenAmount(fork, splAta(alice.publicKey, L.keys.baseMint)) / 2n);
  });

  it("a creator who creates the committed pool under another creator key still cannot block registration", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const partner = fork.newWallet();
    const creator = fork.newWallet();
    const sockPuppet = fork.newWallet(); // a second wallet of the same creator
    const configKp = Keypair.generate();
    const config = configKp.publicKey;
    const claimer = authorityPda(config)[0];
    const input = {
      name: "Sock",
      symbol: "SOCK",
      uri: "https://example.com/sock.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: SPYX_USD_PRICE,
      quoteMultiplier: spyxMultiplier(fork),
      preset: "gentle" as const,
      vaultSharePct: 50,
    };
    const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams(input, claimer, claimer);
    applyFeeModelV3(params, input.vaultSharePct);
    fork.send(
      [await createConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer: partner.publicKey, params: params as never, tokenBadge: DBC_TOKEN_BADGE_SPYX })],
      [partner, configKp],
    );
    const baseMint = Keypair.generate();
    fork.send(
      [await createLaunchIx({ payer: partner.publicKey, creator: creator.publicKey, config, baseMint: baseMint.publicKey, exitFeeBps: 200 })],
      [partner, creator, configKp],
    );
    const init = await initializeVirtualPoolWithSplTokenIx({
      config,
      creator: sockPuppet.publicKey,
      baseMint: baseMint.publicKey,
      quoteMint: SPYX_MINT,
      payer: sockPuppet.publicKey,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      tokenBadge: DBC_TOKEN_BADGE_SPYX,
    });
    fork.send([init.ix], [sockPuppet, baseMint]);
    const c = fork.newWallet(1);
    fork.send([await registerPoolIx({ config, pool: init.pool, baseMint: baseMint.publicKey })], [c]);
    expect(fetchLaunch(fork, config).pool.equals(init.pool)).toBe(true);
  });

  it("create_launch can commit the base mint before the pool exists; registration works once DBC creates it", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const partner = fork.newWallet();
    const creator = fork.newWallet();
    const configKp = Keypair.generate();
    const config = configKp.publicKey;
    const claimer = authorityPda(config)[0];
    const input = {
      name: "Commit First",
      symbol: "CMT",
      uri: "https://example.com/cmt.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: SPYX_USD_PRICE,
      quoteMultiplier: spyxMultiplier(fork),
      preset: "gentle" as const,
      vaultSharePct: 50,
      thresholdUsd: 1000,
      exitFeeBps: 200,
    };
    const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams(input, claimer, claimer);
    applyFeeModelV3(params, input.vaultSharePct);
    fork.send(
      [await createConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer: partner.publicKey, params: params as never, tokenBadge: DBC_TOKEN_BADGE_SPYX })],
      [partner, configKp],
    );
    const baseMint = Keypair.generate();
    fork.send(
      [await createLaunchIx({ payer: partner.publicKey, creator: creator.publicKey, config, baseMint: baseMint.publicKey, exitFeeBps: 200 })],
      [partner, creator, configKp],
    );
    const init = await initializeVirtualPoolWithSplTokenIx({
      config,
      creator: creator.publicKey,
      baseMint: baseMint.publicKey,
      quoteMint: SPYX_MINT,
      payer: creator.publicKey,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      tokenBadge: DBC_TOKEN_BADGE_SPYX,
    });
    // Before the pool (and the mint) exist, registration cannot succeed.
    const c = fork.newWallet(1);
    const early = fork.sendExpectFail([await registerPoolIx({ config, pool: init.pool, baseMint: baseMint.publicKey })], [c]);
    expect(errName(early)).toBe("AccountNotInitialized"); // the base mint does not exist yet
    fork.send([init.ix], [creator, baseMint]);
    fork.send([await registerPoolIx({ config, pool: init.pool, baseMint: baseMint.publicKey })], [c]);
    const launch = fetchLaunch(fork, config);
    expect(launch.pool.equals(init.pool)).toBe(true);
    expect(launch.baseMint.equals(baseMint.publicKey)).toBe(true);
    expect(deriveVault(config).equals(launch.vault)).toBe(true);
  });
});

// ====================================================================================================

describe("3. redeem does not depend on DBC state once the migration is latched", () => {
  it("after harvest_migration_fee latches Launch.migrated, a grown or re-typed DBC VirtualPool cannot lock redemptions", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    const g = await graduate(fork, L, [30n, 10n]);
    expect(fetchLaunch(fork, L.config).migrated).toBe(false);
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
    expect(fetchLaunch(fork, L.config).migrated).toBe(true);

    // A future DBC upgrade reallocs VirtualPool (appends fields). Emulated without DBC's own loader
    // being upgraded, so only stockfloor paths that do not call DBC are meaningful: redeem is exact.
    // (The minimum-size decoder itself is exercised by the unlatched first redeem in the next test.)
    const acc = fork.mustGetAccount(L.keys.pool);
    fork.setAccount(L.keys.pool, { ...acc, data: Buffer.concat([acc.data, Buffer.alloc(64)]) });
    const c = fork.newWallet(1);
    const [h1, h2] = g.buyers;
    await redeemExact(fork, L, h1, tokenAmount(fork, splAta(h1.publicKey, L.keys.baseMint)) / 3n);

    // Worse: the account is re-typed (discriminator changes, unknown migration state). Instructions
    // that decode it now fail (harvest_surplus decodes the pool before its CPI), but redemptions no
    // longer read DBC state.
    fork.patchAccount(L.keys.pool, (d) => {
      d.fill(0xee, 0, 8);
      d[8 + 300] = 7; // migration_progress
    });
    expect(errName(fork.sendExpectFail([await harvestSurplusIx({ keys: L.keys })], [c]))).toBe("InvalidDbcPool");
    await redeemExact(fork, L, h2, tokenAmount(fork, splAta(h2.publicKey, L.keys.baseMint)));
    await redeemExact(fork, L, h1, tokenAmount(fork, splAta(h1.publicKey, L.keys.baseMint)));
  });

  it("without the latch (fee harvested before migration) the first redeem decodes DBC, then latches", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    const [alice, bob] = await buyers(fork, L, [20n, 20n]);
    await completeWithPartialFill(fork, L);
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
    expect(fetchLaunch(fork, L.config).migrated).toBe(false);
    const amount = tokenAmount(fork, splAta(alice.publicKey, L.keys.baseMint)) / 2n;
    expect(errName(fork.sendExpectFail([await redeemIx({ holder: alice.publicKey, keys: L.keys, amount })], [alice]))).toBe("MigrationNotComplete");
    expect(fetchLaunch(fork, L.config).migrated).toBe(false);

    await migrateToDammV2(fork, L.keys);
    expect(fetchLaunch(fork, L.config).migrated).toBe(false);
    // The pool grows before the first (latching) redeem: the minimum-size decoder accepts it.
    const acc = fork.mustGetAccount(L.keys.pool);
    fork.setAccount(L.keys.pool, { ...acc, data: Buffer.concat([acc.data, Buffer.alloc(64)]) });
    await redeemExact(fork, L, alice, amount);
    expect(fetchLaunch(fork, L.config).migrated).toBe(true);

    fork.patchAccount(L.keys.pool, (d) => d.fill(0xee, 0, 8));
    await redeemExact(fork, L, bob, tokenAmount(fork, splAta(bob.publicKey, L.keys.baseMint)));
  });
});

// ====================================================================================================

/** SPL / Token-2022 base account layout: delegate COption at 72, delegated_amount at 121, close_authority COption at 129. */
function setVaultDelegate(fork: Fork, vault: PublicKey, delegate: PublicKey | null): void {
  fork.patchAccount(vault, (d) => {
    d.writeUInt32LE(delegate ? 1 : 0, 72);
    (delegate ?? PublicKey.default).toBuffer().copy(d, 76);
    d.writeBigUInt64LE(delegate ? 1_000_000n : 0n, 121);
  });
}

function setVaultCloseAuthority(fork: Fork, vault: PublicKey, closeAuthority: PublicKey | null): void {
  fork.patchAccount(vault, (d) => {
    d.writeUInt32LE(closeAuthority ? 1 : 0, 129);
    (closeAuthority ?? PublicKey.default).toBuffer().copy(d, 133);
  });
}

describe("4. harvests refuse an encumbered vault (the vault owner signs into upgradeable DBC / DAMM v2)", () => {
  it("delegate, close authority or a foreign owner on the vault: every harvest that pays the vault fails atomically; redeem still works", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork);
    const g = await graduate(fork, L, [30n, 10n]);
    fork.warp(60);
    // DAMM v2 trades so that LP fees are pending.
    const trader = fundedWallet(fork, L.threshold);
    const traderBase = createAta(fork, trader, trader.publicKey, L.keys.baseMint, L.keys.baseTokenProgram);
    fork.send(
      [await dammSwap2Ix({ keys: g.migration.dammKeys, payer: trader.publicKey, inputTokenAccount: spyxAta(trader.publicKey), outputTokenAccount: traderBase, amount0: L.threshold / 5n, amount1: 0n, swapMode: 0 })],
      [trader],
    );

    const evil = Keypair.generate().publicKey;
    const c = fork.newWallet(1);
    const lp = () =>
      harvestLpFeesIx({
        payer: c.publicKey,
        keys: L.keys,
        dammPool: g.migration.dammPool,
        position: g.migration.firstPosition,
        positionNftAccount: g.migration.firstPositionNftAccount,
        dammTokenAVault: g.migration.tokenAVault,
        dammTokenBVault: g.migration.tokenBVault,
      });
    // v3: harvest_curve_fees pays the platform and never touches the vault, so an encumbered vault
    // does not stop it (checked first, with a delegate on the vault).
    setVaultDelegate(fork, L.vault, evil);
    const vc0 = tokenAmount(fork, L.vault);
    const pc0 = tokenAmount(fork, L.platformQuoteAccount);
    const curveFee = bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee);
    expect(curveFee).toBeGreaterThan(0n);
    fork.send([await harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys })], [c]);
    expect(tokenAmount(fork, L.vault)).toBe(vc0);
    expect(tokenAmount(fork, L.platformQuoteAccount) - pc0).toBe(curveFee);
    setVaultDelegate(fork, L.vault, null);

    const harvests = () =>
      [
        ["harvest_migration_fee", harvestMigrationFeeIx({ keys: L.keys })],
        ["harvest_surplus", harvestSurplusIx({ keys: L.keys })],
        ["harvest_lp_fees", lp()],
      ] as const;

    const encumbrances: Array<[string, () => void, () => void]> = [
      ["delegate", () => setVaultDelegate(fork, L.vault, evil), () => setVaultDelegate(fork, L.vault, null)],
      ["close authority", () => setVaultCloseAuthority(fork, L.vault, evil), () => setVaultCloseAuthority(fork, L.vault, null)],
      [
        "foreign owner",
        () => fork.patchAccount(L.vault, (d) => evil.toBuffer().copy(d, 32)),
        () => fork.patchAccount(L.vault, (d) => L.vaultAuthority.toBuffer().copy(d, 32)),
      ],
    ];
    for (const [what, set, clear] of encumbrances) {
      set();
      const v0 = tokenAmount(fork, L.vault);
      const launch0 = fetchLaunch(fork, L.config);
      for (const [label, ix] of harvests()) {
        const f = fork.sendExpectFail([await ix], [c]);
        expect(errName(f), `${label} with vault ${what}`).toBe("VaultEncumbered");
      }
      expect(tokenAmount(fork, L.vault)).toBe(v0);
      const launch1 = fetchLaunch(fork, L.config);
      expect(launch1.migrationFeeHarvested).toBe(launch0.migrationFeeHarvested);
      expect(launch1.surplusHarvested).toBe(launch0.surplusHarvested);
      clear();
    }

    // Clean vault: all harvests succeed, and with a delegate set afterwards holders can still redeem.
    for (const [, ix] of harvests()) fork.send([await ix], [c]);
    expect(fetchLaunch(fork, L.config).migrationFeeHarvested).toBe(true);
    setVaultDelegate(fork, L.vault, evil);
    const [h] = g.buyers;
    await redeemExact(fork, L, h, tokenAmount(fork, splAta(h.publicKey, L.keys.baseMint)) / 2n);
  });
});

// ====================================================================================================

describe("5. floor view returns the floor per token", () => {
  it("floor_q64 = (vault << 64) / supply, 0 before registration and with an empty vault", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, { skipRegister: true });
    const c = fork.newWallet(1);
    let view = decodeFloorReturn(fork.send([await floorIx({ config: L.config, baseMint: SystemProgram.programId })], [c]));
    expect(view).toEqual({ vaultRaw: 0n, supply: 0n, exitFeeBps: 200, floorQ64: 0n });
    fork.send([await registerPoolIx({ config: L.config, pool: L.keys.pool, baseMint: L.keys.baseMint })], [c]);
    await graduate(fork, L, [30n]);
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [c]);
    view = decodeFloorReturn(fork.send([await floorIx({ config: L.config, baseMint: L.keys.baseMint })], [c]));
    const V = tokenAmount(fork, L.vault);
    const S = mintSupply(fork, L.keys.baseMint);
    expect(view).toEqual({ vaultRaw: V, supply: S, exitFeeBps: 200, floorQ64: expectedFloorQ64(V, S) });
    // Cross-check against the Token-2022 program id used for the vault (sanity of the fixture state).
    expect(fork.mustGetAccount(L.vault).owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });
});
