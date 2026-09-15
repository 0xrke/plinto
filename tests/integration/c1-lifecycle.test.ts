/**
 * Checkpoint C1: the full StockFloor flow on a LiteSVM mainnet fork with the REAL stockfloor
 * program (target/deploy/stockfloor.so) and the real DBC 0.2.1, DAMM v2 0.2.4, Token-2022,
 * SPL Token, ATA and Token Metadata binaries plus the real SPYx mint and its DBC token badge
 * (tests/fixtures, dumped from mainnet).
 *
 * Follows docs/BRIEF.md §8 in order:
 *  1. DBC config quoted in SPYx, built by @stockfloor/sdk buildDbcConfigParams
 *  2. DBC pool
 *  3. create_launch + register_pool
 *  4. buys and sells by several wallets
 *  5. harvest_curve_fees (exact partner share)
 *  6. curve completion (surplus)
 *  7. migration to DAMM v2
 *  8. harvest_migration_fee (exact), harvest_surplus (exact), harvest_leftover (supply effects)
 *  9. DAMM v2 trades
 * 10. harvest_lp_fees (exact)
 * 11. redeem by several holders (exact net / fee)
 * 12. floor invariants after every step (FloorTracker)
 * with the first adversarial checks at the stage where they apply.
 *
 * Every expected amount is computed independently of the stockfloor program: from DBC / DAMM v2
 * formulas (vendor sources), DBC swap events, DAMM v2 account state, or @stockfloor/sdk math.
 */
import { createTransferInstruction } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  authorityPda,
  buildDbcConfigParams,
  computeLaunchCurve,
  DEFAULT_QUOTE_ASSET,
  dbcTokenBadgePda,
  effectiveScaledUiMultiplier,
  getMigrationFeeDistribution,
  launchPda,
  type LaunchInput,
  previewLaunch,
  redeemQuote,
  validateDbcConfigParams,
  vaultAddress,
} from "@stockfloor/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { dbcProgram, dammProgram, parseCpiEvents, parseEvents } from "../src/anchor.js";
import {
  DAMM_V2_CONFIG_CUSTOMIZABLE,
  DBC_TOKEN_BADGE_SPYX,
  SPYX_DECIMALS,
  SPYX_MINT,
  STOCKFLOOR_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/constants.js";
import { dammSwap2Ix, deriveDammPool, deriveDammTokenVault, fetchDammPool, fetchPosition } from "../src/damm.js";
import {
  bnToBig,
  createConfigIx,
  DbcPoolKeys,
  fetchPoolConfig,
  fetchVirtualPool,
  initializeVirtualPoolWithSplTokenIx,
  MigrationProgress,
  swap2Ix,
  SwapMode,
} from "../src/dbc.js";
import { FloorTracker } from "../src/floor-invariants.js";
import { anchorErrorFromLogs, Fork, TxFailure, TxSuccess } from "../src/fork.js";
import { buyOnCurve, fundedWallet, Migration, migrateToDammV2, sellOnCurve } from "../src/scenario.js";
import {
  createLaunchIx,
  decodeFloorReturn,
  deriveAuthorityBaseAccount,
  expectedFloorQ64,
  deriveLaunch,
  deriveStockfloorAuthority,
  deriveVault,
  fetchLaunch,
  floorIx,
  harvestCurveFeesIx,
  harvestLeftoverIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  redeemIx,
  registerPoolIx,
  stockfloorProgram,
} from "../src/stockfloor.js";
import {
  createAta,
  getScaledUiAmount,
  mintAuthority,
  mintDecimals,
  mintSupply,
  splAta,
  spyxAta,
  tokenAccountOwner,
  tokenAmount,
} from "../src/token.js";

// ------------------------------------------------------------------ launch parameters

/** Jupiter Price V3 `usdPrice` of SPYx observed on 2026-09-15 (docs/research, SDK tests). */
const SPYX_USD_PRICE = 757.02;
const THRESHOLD_USD = 1000; // BRIEF §4 default; ~1.31 SPYx, cheap to fund with cheatcodes
const VAULT_SHARE_PCT = 50;
const EXIT_FEE_BPS = 200;
const CREATOR_TRADING_FEE_PCT = 30n;
const PROTOCOL_FEE_PCT = 20n;
const CURVE_FEE_NUMERATOR = 10_000_000n; // 1% of 1e9
const FEE_DENOMINATOR = 1_000_000_000n;
const PARTNER_MIGRATION_FEE_MASK = 0b100;
const U128 = 1n << 128n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

/** Decode the single DBC EvtSwap2 of a swap transaction and derive the partner fee share. */
function dbcSwap(res: TxSuccess) {
  const evs = parseCpiEvents(dbcProgram(), res).filter((e) => e.name.toLowerCase() === "evtswap2");
  expect(evs.length).toBe(1);
  const r = evs[0].data.swapResult;
  const trading = bnToBig(r.tradingFee); // total fee minus protocol (and referral) fee
  const protocol = bnToBig(r.protocolFee);
  const referral = bnToBig(r.referralFee);
  const creator = (trading * CREATOR_TRADING_FEE_PCT) / 100n; // DBC split_partner_and_creator_fee: floor
  return {
    tradeDirection: evs[0].data.tradeDirection as number,
    includedFeeInput: bnToBig(r.includedFeeInputAmount),
    excludedFeeInput: bnToBig(r.excludedFeeInputAmount),
    output: bnToBig(r.outputAmount),
    trading,
    protocol,
    referral,
    totalFee: trading + protocol + referral,
    creator,
    partner: trading - creator,
  };
}

function dammSwap(res: TxSuccess) {
  const evs = parseCpiEvents(dammProgram(), res).filter((e) => e.name.toLowerCase() === "evtswap2");
  expect(evs.length).toBe(1);
  const r = evs[0].data.swapResult;
  return {
    output: bnToBig(r.outputAmount),
    includedFeeInput: bnToBig(r.includedFeeInputAmount),
    claimingFee: bnToBig(r.claimingFee),
    compoundingFee: bnToBig(r.compoundingFee),
    protocolFee: bnToBig(r.protocolFee),
  };
}

const u256le = (bytes: number[] | Uint8Array) => BigInt("0x" + (Buffer.from(bytes).reverse().toString("hex") || "0"));

describe("C1: StockFloor lifecycle on a mainnet fork (real stockfloor + DBC + DAMM v2 + SPYx)", () => {
  let fork: Fork;
  let partner: Keypair; // pays for the DBC config (the launchpad operator)
  let creator: Keypair;
  let configKp: Keypair;
  let config: PublicKey;
  let authority: PublicKey;
  let vault: PublicKey;
  let launchPk: PublicKey;
  let input: LaunchInput;
  let threshold: bigint;
  let curve: ReturnType<typeof computeLaunchCurve>;
  let preview: ReturnType<typeof previewLaunch>;
  let keys: DbcPoolKeys;
  let authorityBase: PublicKey;
  let tracker: FloorTracker;
  let rogue: { creator: Keypair; keys: DbcPoolKeys };
  let migration: Migration;
  let migrationFeeHarvested = 0n;
  const wallets: Record<string, Keypair> = {};
  const harvested: Record<string, bigint> = {};
  const redemptions: Array<{ holder: string; amount: bigint; gross: bigint; fee: bigint; net: bigint }> = [];
  let expectedPartnerTradingFee = 0n;
  let donation = 0n;
  const log: Record<string, unknown> = {};

  const baseOf = (w: Keypair) => splAta(w.publicKey, keys.baseMint);
  const cranker = () => fork.newWallet(1); // a fresh random key for every permissionless crank

  beforeAll(() => {
    fork = Fork.create({ stockfloor: true, spike: false });
    partner = fork.newWallet();
    creator = fork.newWallet();
    configKp = Keypair.generate();
    config = configKp.publicKey;
    authority = authorityPda(config)[0];
    vault = vaultAddress(config, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    launchPk = launchPda(config)[0];
    log.fixtures = { generatedAt: fork.manifest.generatedAt, slots: [...new Set(fork.manifest.accounts.map((a) => a.slot).concat(fork.manifest.programs.map((p) => p.slot)))].sort() };
  });

  // ---------------------------------------------------------------- 1. config

  it("1. creates the SPYx-quoted DBC config from SDK buildDbcConfigParams (fee_claimer = leftover_receiver = Authority PDA)", async () => {
    // SDK PDAs match the harness derivations and the on-chain seeds.
    expect(authority.equals(deriveStockfloorAuthority(config))).toBe(true);
    expect(launchPk.equals(deriveLaunch(config))).toBe(true);
    expect(vault.equals(deriveVault(config))).toBe(true);
    expect(dbcTokenBadgePda(SPYX_MINT)[0].equals(DBC_TOKEN_BADGE_SPYX)).toBe(true);

    // Effective ScaledUiAmount multiplier of the real SPYx mint at the fork clock.
    const sua = getScaledUiAmount(fork, SPYX_MINT)!;
    const multiplier = effectiveScaledUiMultiplier(
      { multiplier: sua.multiplier, newMultiplier: sua.newMultiplier, newMultiplierEffectiveTimestamp: sua.newMultiplierEffectiveTimestamp },
      Number(fork.now()),
    );
    expect(fork.now() >= sua.newMultiplierEffectiveTimestamp).toBe(true);
    expect(multiplier).toBe(sua.newMultiplier);

    input = {
      name: "Floor C1",
      symbol: "FLRC1",
      uri: "https://example.com/c1.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: SPYX_USD_PRICE,
      quoteMultiplier: multiplier,
      preset: "gentle",
      vaultSharePct: VAULT_SHARE_PCT,
      thresholdUsd: THRESHOLD_USD,
      exitFeeBps: EXIT_FEE_BPS,
    };
    expect(DEFAULT_QUOTE_ASSET.mint).toBe(SPYX_MINT.toBase58());
    const built = buildDbcConfigParams(input, authority, authority);
    curve = computeLaunchCurve(input);
    preview = previewLaunch(input);
    threshold = curve.thresholdQuoteRaw;
    const port = validateDbcConfigParams(built);
    const { feeClaimer, leftoverReceiver, quoteMint, ...params } = built;
    expect(feeClaimer.equals(authority) && leftoverReceiver.equals(authority) && quoteMint.equals(SPYX_MINT)).toBe(true);

    fork.send(
      [
        await createConfigIx({
          config,
          feeClaimer,
          leftoverReceiver,
          quoteMint,
          payer: partner.publicKey,
          params: params as never,
          tokenBadge: DBC_TOKEN_BADGE_SPYX,
        }),
      ],
      [partner, configKp],
    );

    const cfg = fetchPoolConfig(fork, config);
    expect(cfg.quoteMint.equals(SPYX_MINT)).toBe(true);
    expect(cfg.feeClaimer.equals(authority)).toBe(true);
    expect(cfg.leftoverReceiver.equals(authority)).toBe(true);
    expect(bnToBig(cfg.migrationQuoteThreshold)).toBe(threshold);
    expect(cfg.migrationFeePercentage).toBe(VAULT_SHARE_PCT);
    expect(cfg.creatorMigrationFeePercentage).toBe(0);
    expect(cfg.creatorTradingFeePercentage).toBe(Number(CREATOR_TRADING_FEE_PCT));
    expect(cfg.partnerPermanentLockedLiquidityPercentage).toBe(100);
    expect(cfg.partnerLiquidityPercentage + cfg.creatorLiquidityPercentage + cfg.creatorPermanentLockedLiquidityPercentage).toBe(0);
    expect(cfg.collectFeeMode).toBe(0); // QuoteToken
    expect(cfg.migrationOption).toBe(1); // DAMM v2
    expect(cfg.tokenType).toBe(0); // SPL Token base
    expect(cfg.quoteTokenFlag).toBe(1); // Token-2022 quote
    expect(cfg.fixedTokenSupplyFlag).toBe(0); // dynamic supply
    expect(cfg.tokenDecimal).toBe(6);
    expect(bnToBig(cfg.poolFees.baseFee.cliffFeeNumerator)).toBe(CURVE_FEE_NUMERATOR);
    // The SDK's port of create_config computes exactly what the real DBC program stored.
    expect(bnToBig(cfg.migrationSqrtPrice)).toBe(port.migrationSqrtPrice);
    expect(bnToBig(cfg.swapBaseAmount)).toBe(port.swapBaseAmount);
    expect(bnToBig(cfg.migrationBaseThreshold)).toBe(port.migrationBaseThreshold);
    expect(bnToBig(cfg.migrationSqrtPrice)).toBe(curve.migrationSqrtPrice);
    expect(bnToBig(cfg.sqrtStartPrice)).toBe(curve.sqrtStartPrice);

    log.config = {
      address: config.toBase58(),
      authority: authority.toBase58(),
      vault: vault.toBase58(),
      multiplier,
      thresholdRaw: threshold,
      sqrtStartPrice: curve.sqrtStartPrice,
      migrationSqrtPrice: curve.migrationSqrtPrice,
      swapBaseAmount: port.swapBaseAmount,
      migrationBaseThreshold: port.migrationBaseThreshold,
      initialBaseSupply: port.initialBaseSupply,
      previewVaultAtGraduation: preview.vaultAtGraduationQuoteRaw,
      previewSupplyAtGraduation: preview.baseSupplyAtGraduationRaw,
    };
    (log as any).port = port;
  });

  // ---------------------------------------------------------------- 2. pool

  it("2. creates the DBC pool (SPL base mint, authority revoked, full initial supply in the DBC base vault)", async () => {
    const baseMintKp = Keypair.generate();
    const init = await initializeVirtualPoolWithSplTokenIx({
      config,
      creator: creator.publicKey,
      baseMint: baseMintKp.publicKey,
      quoteMint: SPYX_MINT,
      payer: creator.publicKey,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      tokenBadge: DBC_TOKEN_BADGE_SPYX,
    });
    fork.send([init.ix], [creator, baseMintKp]);
    keys = {
      config,
      pool: init.pool,
      baseMint: baseMintKp.publicKey,
      quoteMint: SPYX_MINT,
      baseVault: init.baseVault,
      quoteVault: init.quoteVault,
      baseTokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
    };
    authorityBase = deriveAuthorityBaseAccount(config, keys.baseMint);

    const pool = fetchVirtualPool(fork, keys.pool);
    expect(pool.config.equals(config)).toBe(true);
    expect(pool.creator.equals(creator.publicKey)).toBe(true);
    expect(pool.baseMint.equals(keys.baseMint)).toBe(true);
    expect(mintAuthority(fork, keys.baseMint)).toBeNull();
    expect(fork.mustGetAccount(keys.baseMint).owner.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(mintDecimals(fork, keys.baseMint)).toBe(6);
    const initialSupply = mintSupply(fork, keys.baseMint);
    expect(initialSupply).toBe((log as any).port.initialBaseSupply);
    expect(tokenAmount(fork, keys.baseVault)).toBe(initialSupply);

    // A second pool on the same config by an unrelated wallet (anyone can do this on DBC 0.2.1).
    const rogueCreator = fork.newWallet();
    const rogueMint = Keypair.generate();
    const r = await initializeVirtualPoolWithSplTokenIx({
      config,
      creator: rogueCreator.publicKey,
      baseMint: rogueMint.publicKey,
      quoteMint: SPYX_MINT,
      payer: rogueCreator.publicKey,
      name: "Rogue",
      symbol: "RGE",
      uri: "https://example.com/rogue.json",
      tokenBadge: DBC_TOKEN_BADGE_SPYX,
    });
    fork.send([r.ix], [rogueCreator, rogueMint]);
    rogue = { creator: rogueCreator, keys: { ...keys, pool: r.pool, baseMint: rogueMint.publicKey, baseVault: r.baseVault, quoteVault: r.quoteVault } };
    log.pool = { pool: keys.pool.toBase58(), baseMint: keys.baseMint.toBase58(), initialSupply, roguePool: r.pool.toBase58() };
  });

  // ---------------------------------------------------------------- 3. create_launch + register_pool

  it("3a. create_launch validates the config, commits the base mint and creates the Launch registry and the empty floor vault", async () => {
    const res = fork.send(
      [await createLaunchIx({ payer: partner.publicKey, creator: creator.publicKey, config, baseMint: keys.baseMint, exitFeeBps: EXIT_FEE_BPS })],
      [partner, creator, configKp],
    );
    const L = fetchLaunch(fork, config);
    expect(L.config.equals(config)).toBe(true);
    expect(L.creator.equals(creator.publicKey)).toBe(true);
    expect(L.exitFeeBps).toBe(EXIT_FEE_BPS);
    expect(L.quoteMint.equals(SPYX_MINT)).toBe(true);
    expect(L.quoteTokenProgram.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(L.vault.equals(vault)).toBe(true);
    expect(L.pool.equals(PublicKey.default)).toBe(true);
    expect(L.baseMint.equals(keys.baseMint)).toBe(true); // committed: identifies the one DBC pool of this launch
    expect(L.migrated).toBe(false);
    expect(L.migrationFeeHarvested).toBe(false);
    expect(fork.mustGetAccount(launchPk).owner.equals(STOCKFLOOR_PROGRAM_ID)).toBe(true);
    expect(tokenAccountOwner(fork, vault).equals(authority)).toBe(true);
    expect(tokenAmount(fork, vault)).toBe(0n);
    const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "launchCreated");
    expect(ev?.data.migrationFeePercentage).toBe(VAULT_SHARE_PCT);
    expect(ev!.data.baseMint.equals(keys.baseMint)).toBe(true);
    expect(bnToBig(ev!.data.migrationQuoteThreshold)).toBe(threshold);
    log.cu = { createLaunch: res.computeUnits };
  });

  it("3b. adversarial: a second pool on the same config can never be registered, whoever sends register_pool", async () => {
    // The rogue pool with its own base mint, sent by the rogue creator.
    let f = fork.sendExpectFail([await registerPoolIx({ config, pool: rogue.keys.pool, baseMint: rogue.keys.baseMint })], [rogue.creator]);
    expect(errName(f)).toBe("BaseMintMismatch");
    // The rogue pool with the committed base mint account, sent by the launch creator.
    f = fork.sendExpectFail([await registerPoolIx({ config, pool: rogue.keys.pool, baseMint: keys.baseMint })], [creator]);
    expect(errName(f)).toBe("BaseMintMismatch");
    // The canonical pool with the rogue base mint.
    f = fork.sendExpectFail([await registerPoolIx({ config, pool: keys.pool, baseMint: rogue.keys.baseMint })], [cranker()]);
    expect(errName(f)).toBe("BaseMintMismatch");
    // Not a DBC pool at all (the DBC config account).
    f = fork.sendExpectFail([await registerPoolIx({ config, pool: config, baseMint: keys.baseMint })], [cranker()]);
    expect(errName(f)).toBe("InvalidDbcPool");
    expect(fetchLaunch(fork, config).pool.equals(PublicKey.default)).toBe(true);
  });

  it("3c. register_pool by a random key (permissionless) records the canonical pool; floor invariants tracking starts", async () => {
    tracker = new FloorTracker(fork, vault, keys.baseMint, authority, SPYX_MINT, authorityBase);
    tracker.trackBase(keys.baseVault);
    tracker.start("launch created");
    const res = await tracker.step("register_pool", "no-outflow", async () =>
      fork.send([await registerPoolIx({ config, pool: keys.pool, baseMint: keys.baseMint })], [cranker()]),
    );
    const L = fetchLaunch(fork, config);
    expect(L.pool.equals(keys.pool)).toBe(true);
    expect(L.baseMint.equals(keys.baseMint)).toBe(true);
    expect(parseEvents(stockfloorProgram(), res.logs).some((e) => e.name === "poolRegistered")).toBe(true);

    const f = fork.sendExpectFail([await registerPoolIx({ config, pool: keys.pool, baseMint: keys.baseMint })], [creator]);
    expect(errName(f)).toBe("PoolAlreadyRegistered");

    const view = decodeFloorReturn(fork.send([await floorIx({ config, baseMint: keys.baseMint })], [cranker()]));
    expect(view).toEqual({ vaultRaw: 0n, supply: mintSupply(fork, keys.baseMint), exitFeeBps: EXIT_FEE_BPS, floorQ64: 0n });
  });

  // ---------------------------------------------------------------- 4. trades on the curve

  it("4. several wallets buy and sell on the curve; DBC fee accounting matches the independent formula", async () => {
    const buy = async (name: string, quoteIn: bigint) => {
      const w = (wallets[name] ??= fundedWallet(fork, threshold));
      tracker.trackBase(baseOf(w));
      const q0 = tokenAmount(fork, spyxAta(w.publicKey));
      const b0 = tokenAmount(fork, baseOf(w));
      const res = await tracker.step(`curve buy ${name}`, "no-outflow", () => buyOnCurve(fork, keys, w, quoteIn));
      const s = dbcSwap(res);
      // ExactIn buy, fees on the quote input: total = ceil(in * 1% ), protocol = floor(total * 20%).
      expect(s.includedFeeInput).toBe(quoteIn);
      expect(s.totalFee).toBe(ceilDiv(quoteIn * CURVE_FEE_NUMERATOR, FEE_DENOMINATOR));
      expect(s.protocol).toBe((s.totalFee * PROTOCOL_FEE_PCT) / 100n);
      expect(s.referral).toBe(0n);
      expect(s.excludedFeeInput).toBe(quoteIn - s.totalFee);
      expect(q0 - tokenAmount(fork, spyxAta(w.publicKey))).toBe(quoteIn);
      expect(tokenAmount(fork, baseOf(w)) - b0).toBe(s.output);
      expectedPartnerTradingFee += s.partner;
      return s;
    };
    const sell = async (name: string, baseIn: bigint) => {
      const w = wallets[name];
      const q0 = tokenAmount(fork, spyxAta(w.publicKey));
      const res = await tracker.step(`curve sell ${name}`, "no-outflow", () => sellOnCurve(fork, keys, w, baseIn));
      const s = dbcSwap(res);
      // Sell, fees on the quote output: total = ceil(grossOut * 1%), user receives grossOut - total.
      expect(s.totalFee).toBe(ceilDiv((s.output + s.totalFee) * CURVE_FEE_NUMERATOR, FEE_DENOMINATOR));
      expect(s.protocol).toBe((s.totalFee * PROTOCOL_FEE_PCT) / 100n);
      expect(tokenAmount(fork, spyxAta(w.publicKey)) - q0).toBe(s.output);
      expectedPartnerTradingFee += s.partner;
      return s;
    };

    await buy("alice", (threshold * 20n) / 100n);
    await buy("bob", (threshold * 15n) / 100n);
    await buy("carol", (threshold * 10n) / 100n);
    await sell("alice", tokenAmount(fork, baseOf(wallets.alice)) / 2n);
    await buy("dave", (threshold * 5n) / 100n);
    await sell("bob", tokenAmount(fork, baseOf(wallets.bob)) / 3n);

    const pool = fetchVirtualPool(fork, keys.pool);
    expect(bnToBig(pool.partnerQuoteFee)).toBe(expectedPartnerTradingFee);
    expect(bnToBig(pool.partnerBaseFee)).toBe(0n);
    expect(bnToBig(pool.quoteReserve)).toBeLessThan(threshold);
    expect(tokenAmount(fork, vault)).toBe(0n);

    // Fees also accrue on the rogue pool (fee_claimer is the same Authority); they must never reach the vault.
    const rogueBuyer = fundedWallet(fork, threshold);
    await buyOnCurve(fork, rogue.keys, rogueBuyer, threshold / 10n);
    expect(bnToBig(fetchVirtualPool(fork, rogue.keys.pool).partnerQuoteFee)).toBeGreaterThan(0n);
    log.curveTrading = { partnerFeeAccrued: expectedPartnerTradingFee, quoteReserve: bnToBig(pool.quoteReserve) };
  });

  // ---------------------------------------------------------------- 5. harvest_curve_fees

  it("5a. adversarial: harvest_curve_fees for the rogue pool or into a non-vault account fails; redeem and harvest_migration_fee before completion fail", async () => {
    const c = cranker();
    const attackerQuote = createAta(fork, c, c.publicKey, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    let f = fork.sendExpectFail([await harvestCurveFeesIx({ payer: c.publicKey, keys: rogue.keys })], [c]);
    expect(errName(f)).toBe("InvalidDbcPool");
    f = fork.sendExpectFail([await harvestCurveFeesIx({ payer: c.publicKey, keys, overrides: { vault: attackerQuote } })], [c]);
    expect(errName(f)).toBe("ConstraintAddress");
    f = fork.sendExpectFail([await harvestMigrationFeeIx({ keys })], [c]);
    expect(errName(f)).toBe("CurveNotComplete");
    const alice = wallets.alice;
    f = fork.sendExpectFail([await redeemIx({ holder: alice.publicKey, keys, amount: tokenAmount(fork, baseOf(alice)) / 2n })], [alice]);
    expect(errName(f)).toBe("MigrationNotComplete");
    expect(tokenAmount(fork, attackerQuote)).toBe(0n);
  });

  it("5b. harvest_curve_fees by a random key moves exactly the partner share into the vault", async () => {
    const c = cranker();
    const dbcQuote0 = tokenAmount(fork, keys.quoteVault);
    const v0 = tokenAmount(fork, vault);
    const res = await tracker.step("harvest_curve_fees #1", "no-outflow", async () =>
      fork.send([await harvestCurveFeesIx({ payer: c.publicKey, keys })], [c]),
    );
    expect(tokenAmount(fork, vault) - v0).toBe(expectedPartnerTradingFee);
    expect(dbcQuote0 - tokenAmount(fork, keys.quoteVault)).toBe(expectedPartnerTradingFee);
    expect(bnToBig(fetchVirtualPool(fork, keys.pool).partnerQuoteFee)).toBe(0n);
    // The random signer received nothing (it has no token accounts at all).
    expect(fork.getAccount(spyxAta(c.publicKey))).toBeNull();
    expect(fork.getAccount(baseOf(c))).toBeNull();
    const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "curveFeesHarvested");
    expect(bnToBig(ev!.data.quoteAmount)).toBe(expectedPartnerTradingFee);
    expect(bnToBig(ev!.data.baseBurned)).toBe(0n);
    expect(bnToBig(fetchLaunch(fork, config).totalHarvestedQuote)).toBe(expectedPartnerTradingFee);
    harvested.curveFees1 = expectedPartnerTradingFee;
    expectedPartnerTradingFee = 0n;
    (log.cu as any).harvestCurveFees = res.computeUnits;

    // The rogue pool's partner fees are untouched and unreachable through StockFloor.
    expect(bnToBig(fetchVirtualPool(fork, rogue.keys.pool).partnerQuoteFee)).toBeGreaterThan(0n);
  });

  // ---------------------------------------------------------------- 6. complete the curve

  it("6. a PartialFill buy completes the curve at the migration price; surplus = quote_reserve - threshold", async () => {
    const pool0 = fetchVirtualPool(fork, keys.pool);
    const reserve0 = bnToBig(pool0.quoteReserve);
    const remaining = threshold - reserve0;
    const offered = (remaining * 11n) / 10n + 1_000_000n;
    const erin = (wallets.erin = fundedWallet(fork, offered));
    tracker.trackBase(baseOf(erin));
    const res = await tracker.step("curve completing buy (PartialFill)", "no-outflow", () =>
      buyOnCurve(fork, keys, erin, offered, SwapMode.PartialFill),
    );
    const s = dbcSwap(res);
    expect(s.includedFeeInput).toBeLessThan(offered);
    expect(offered - tokenAmount(fork, spyxAta(erin.publicKey))).toBe(s.includedFeeInput);
    expect(tokenAmount(fork, baseOf(erin))).toBe(s.output);
    expect(s.totalFee).toBe(ceilDiv(s.includedFeeInput * CURVE_FEE_NUMERATOR, FEE_DENOMINATOR));
    expectedPartnerTradingFee += s.partner;

    const pool = fetchVirtualPool(fork, keys.pool);
    const reserve = bnToBig(pool.quoteReserve);
    expect(reserve).toBe(reserve0 + s.excludedFeeInput);
    expect(reserve).toBeGreaterThanOrEqual(threshold);
    expect(bnToBig(pool.sqrtPrice)).toBe(curve.migrationSqrtPrice);
    expect(pool.migrationProgress).toBe(MigrationProgress.LockedVesting);
    expect(bnToBig(pool.partnerQuoteFee)).toBe(expectedPartnerTradingFee);

    // Late buys are rejected once the curve is complete.
    const late = fundedWallet(fork, threshold);
    const f = fork.sendExpectFail(
      [
        await swap2Ix({
          keys,
          payer: late.publicKey,
          inputTokenAccount: spyxAta(late.publicKey),
          outputTokenAccount: createAta(fork, late, late.publicKey, keys.baseMint, TOKEN_PROGRAM_ID),
          amount0: threshold / 100n,
          amount1: 0n,
          swapMode: SwapMode.ExactIn,
        }),
      ],
      [late],
    );
    expect(errName(f)).toBe("PoolIsCompleted");
    tracker.trackBase(baseOf(late));

    // Redeem is still closed: the curve is complete but not migrated.
    const g = fork.sendExpectFail([await redeemIx({ holder: erin.publicKey, keys, amount: s.output / 2n })], [erin]);
    expect(errName(g)).toBe("MigrationNotComplete");
    log.completion = { offered, spent: s.includedFeeInput, baseOut: s.output, quoteReserve: reserve, surplus: reserve - threshold, completingBuyPartnerFee: s.partner };
  });

  // ---------------------------------------------------------------- 7. migration

  it("7. permissionless migration to DAMM v2 burns the unsold base; the Authority owns the permanently locked position", async () => {
    const supply0 = mintSupply(fork, keys.baseMint);
    const payer = fork.newWallet();
    const dammPool = deriveDammPool(DAMM_V2_CONFIG_CUSTOMIZABLE, keys.baseMint, SPYX_MINT);
    tracker.trackBase(deriveDammTokenVault(dammPool, keys.baseMint)); // receives the migrated base
    migration = await tracker.step("migration_damm_v2", "no-outflow", () => migrateToDammV2(fork, keys, payer));
    expect(migration.dammPool.equals(dammPool)).toBe(true);

    const pool = fetchVirtualPool(fork, keys.pool);
    expect(pool.isMigrated).toBe(1);
    expect(pool.migrationProgress).toBe(MigrationProgress.CreatedPool);

    const damm = fetchDammPool(fork, migration.dammPool);
    expect(damm.tokenAMint.equals(keys.baseMint)).toBe(true);
    expect(damm.tokenBMint.equals(SPYX_MINT)).toBe(true);
    expect(damm.collectFeeMode).toBe(1); // OnlyB: LP fees in the quote token only
    // Quote into DAMM v2 = ceil(T * (100 - pct) / 100) minus the 0.2% protocol liquidity migration fee.
    const migrationQuote = ceilDiv(threshold * BigInt(100 - VAULT_SHARE_PCT), 100n);
    expect(migrationQuote).toBe(curve.migrationQuoteAmount);
    expect(bnToBig(damm.tokenBAmount)).toBe(migrationQuote - (migrationQuote * 20n) / 10_000n);
    expect(tokenAmount(fork, migration.tokenBVault)).toBe(bnToBig(damm.tokenBAmount));
    expect(tokenAmount(fork, migration.tokenAVault)).toBe(bnToBig(damm.tokenAAmount));

    const position = fetchPosition(fork, migration.firstPosition);
    expect(tokenAccountOwner(fork, migration.firstPositionNftAccount).equals(authority)).toBe(true);
    expect(tokenAmount(fork, migration.firstPositionNftAccount)).toBe(1n);
    expect(bnToBig(position.permanentLockedLiquidity)).toBeGreaterThan(0n);
    expect(bnToBig(position.unlockedLiquidity)).toBe(0n);
    expect(bnToBig(position.vestedLiquidity)).toBe(0n);
    expect(bnToBig(position.permanentLockedLiquidity)).toBe(bnToBig(damm.liquidity));
    expect(fork.getAccount(migration.secondPosition)).toBeNull();

    // Supply effects: DBC burned everything but the buyers' tokens, the DAMM v2 deposit and the
    // protocol migration base fee (which stays in the DBC base vault). The tracker already checked
    // supply == sum of all base accounts.
    const supply = mintSupply(fork, keys.baseMint);
    expect(tokenAmount(fork, keys.baseVault)).toBe(bnToBig(pool.protocolMigrationBaseFeeAmount));
    expect(supply).toBeLessThan(supply0);
    const previewDiff = preview.baseSupplyAtGraduationRaw - supply;
    expect(previewDiff >= 0n && previewDiff <= 1_000n).toBe(true); // SDK preview: slight over-estimate, < 0.001 token
    log.migration = {
      dammPool: migration.dammPool.toBase58(),
      position: migration.firstPosition.toBase58(),
      supplyBefore: supply0,
      supplyAfter: supply,
      burned: supply0 - supply,
      dammBase: tokenAmount(fork, migration.tokenAVault),
      dammQuote: bnToBig(damm.tokenBAmount),
      dbcBaseVaultLeft: tokenAmount(fork, keys.baseVault),
      previewSupplyMinusActual: previewDiff,
      cu: migration.tx.computeUnits,
    };
  });

  // ---------------------------------------------------------------- 8. migration fee, surplus, leftover

  it("8a. adversarial: redeem after migration but before harvest_migration_fee is rejected", async () => {
    const bob = wallets.bob;
    const f = fork.sendExpectFail([await redeemIx({ holder: bob.publicKey, keys, amount: tokenAmount(fork, baseOf(bob)) / 2n })], [bob]);
    expect(errName(f)).toBe("MigrationFeeNotHarvested");
  });

  it("8b. harvest_migration_fee moves exactly the partner migration fee into the vault", async () => {
    const expected = threshold - ceilDiv(threshold * BigInt(100 - VAULT_SHARE_PCT), 100n); // creator share 0%
    expect(expected).toBe(getMigrationFeeDistribution(threshold, VAULT_SHARE_PCT, 0).partnerMigrationFee);
    expect(expected).toBe(preview.vaultAtGraduationQuoteRaw);
    const c = cranker();
    const dbcQuote0 = tokenAmount(fork, keys.quoteVault);
    const v0 = tokenAmount(fork, vault);
    const res = await tracker.step("harvest_migration_fee", "no-outflow", async () => fork.send([await harvestMigrationFeeIx({ keys })], [c]));
    expect(tokenAmount(fork, vault) - v0).toBe(expected);
    expect(dbcQuote0 - tokenAmount(fork, keys.quoteVault)).toBe(expected);
    expect(fetchVirtualPool(fork, keys.pool).migrationFeeWithdrawStatus & PARTNER_MIGRATION_FEE_MASK).toBe(PARTNER_MIGRATION_FEE_MASK);
    const L = fetchLaunch(fork, config);
    expect(L.migrationFeeHarvested).toBe(true);
    expect(L.migrated).toBe(true); // latched: the pool was migrated when the fee was harvested
    const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "migrationFeeHarvested");
    expect(bnToBig(ev!.data.quoteAmount)).toBe(expected);
    expect(bnToBig(ev!.data.vaultBalance)).toBe(tokenAmount(fork, vault));
    expect(fork.getAccount(spyxAta(c.publicKey))).toBeNull();
    harvested.migrationFee = expected;
    migrationFeeHarvested = expected;
    (log.cu as any).harvestMigrationFee = res.computeUnits;
  });

  it("8c. adversarial: harvest_migration_fee twice is rejected and leaves the vault unchanged", async () => {
    const v0 = tokenAmount(fork, vault);
    const f = fork.sendExpectFail([await harvestMigrationFeeIx({ keys })], [cranker()]);
    expect(errName(f)).toBe("MigrationFeeAlreadyHarvested");
    expect(tokenAmount(fork, vault)).toBe(v0);
  });

  it("8d. harvest_curve_fees again collects exactly the completing buy's partner fee", async () => {
    const c = cranker();
    const v0 = tokenAmount(fork, vault);
    await tracker.step("harvest_curve_fees #2 (post-migration)", "no-outflow", async () =>
      fork.send([await harvestCurveFeesIx({ payer: c.publicKey, keys })], [c]),
    );
    expect(expectedPartnerTradingFee).toBeGreaterThan(0n);
    expect(tokenAmount(fork, vault) - v0).toBe(expectedPartnerTradingFee);
    expect(bnToBig(fetchVirtualPool(fork, keys.pool).partnerQuoteFee)).toBe(0n);
    harvested.curveFees2 = expectedPartnerTradingFee;
    expectedPartnerTradingFee = 0n;
  });

  it("8e. harvest_surplus moves exactly 80% x (100 - 30)% of the surplus (DBC formula) and only once", async () => {
    const pool = fetchVirtualPool(fork, keys.pool);
    const surplus = bnToBig(pool.quoteReserve) - threshold;
    const partnerAndCreator = (surplus * 80n) / 100n;
    const expected = partnerAndCreator - (partnerAndCreator * CREATOR_TRADING_FEE_PCT) / 100n;
    const v0 = tokenAmount(fork, vault);
    const res = await tracker.step("harvest_surplus", "no-outflow", async () => fork.send([await harvestSurplusIx({ keys })], [cranker()]));
    expect(tokenAmount(fork, vault) - v0).toBe(expected);
    // Tie the (rounding-only) amount to DBC's own number: the partner surplus DBC reports transferring.
    const dbcEvents = parseCpiEvents(dbcProgram(), res).filter((e) => e.name.toLowerCase() === "evtpartnerwithdrawsurplus");
    expect(dbcEvents.length).toBe(1);
    expect(dbcEvents[0].data.pool.equals(keys.pool)).toBe(true);
    expect(bnToBig(dbcEvents[0].data.surplusAmount)).toBe(tokenAmount(fork, vault) - v0);
    expect(fetchVirtualPool(fork, keys.pool).isPartnerWithdrawSurplus).toBe(1);
    expect(fetchLaunch(fork, config).surplusHarvested).toBe(true);
    const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "surplusHarvested");
    expect(bnToBig(ev!.data.quoteAmount)).toBe(expected);
    const f = fork.sendExpectFail([await harvestSurplusIx({ keys })], [cranker()]);
    expect(errName(f)).toBe("SurplusAlreadyHarvested");
    harvested.surplus = expected;
    log.surplus = { surplus, partnerShare: expected };
  });

  it("8f. harvest_leftover: no DBC leftover for dynamic supply (burn 0), then burns a base donation to the Authority exactly", async () => {
    const supply0 = mintSupply(fork, keys.baseMint);
    let res = await tracker.step("harvest_leftover (nothing to burn)", "no-outflow", async () => {
      const c = cranker();
      return fork.send([await harvestLeftoverIx({ payer: c.publicKey, keys })], [c]);
    });
    let ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "leftoverHarvested");
    expect(ev!.data.leftoverWithdrawn).toBe(false);
    expect(bnToBig(ev!.data.baseBurned)).toBe(0n);
    expect(mintSupply(fork, keys.baseMint)).toBe(supply0);
    expect(fetchVirtualPool(fork, keys.pool).isWithdrawLeftover).toBe(0);

    // A holder donates base tokens to the Authority's base ATA (a plain SPL transfer).
    const bob = wallets.bob;
    donation = tokenAmount(fork, baseOf(bob)) / 10n;
    await tracker.step("donation of base to the Authority", "donation", () =>
      fork.send([createTransferInstruction(baseOf(bob), authorityBase, bob.publicKey, donation)], [bob]),
    );
    expect(tokenAmount(fork, authorityBase)).toBe(donation);

    res = await tracker.step("harvest_leftover (burns the donation)", "no-outflow", async () => {
      const c = cranker();
      return fork.send([await harvestLeftoverIx({ payer: c.publicKey, keys })], [c]);
    });
    ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "leftoverHarvested");
    expect(bnToBig(ev!.data.baseBurned)).toBe(donation);
    expect(mintSupply(fork, keys.baseMint)).toBe(supply0 - donation);
    expect(tokenAmount(fork, authorityBase)).toBe(0n);
    expect(bnToBig(fetchLaunch(fork, config).totalBurnedBase)).toBe(donation);
    log.leftover = { dbcLeftoverWithdrawn: false, donationBurned: donation };
  });

  // ---------------------------------------------------------------- 9. DAMM v2 trades

  let lpClaimingFees = 0n;
  let dammSwapCount = 0n;

  it("9. several wallets trade on the migrated DAMM v2 pool (quote-only fees)", async () => {
    fork.warp(60);
    const dk = migration.dammKeys;
    const trade = async (label: string, w: Keypair, input: PublicKey, output: PublicKey, amount: bigint) => {
      const res = await tracker.step(label, "no-outflow", async () =>
        fork.send([await dammSwap2Ix({ keys: dk, payer: w.publicKey, inputTokenAccount: input, outputTokenAccount: output, amount0: amount, amount1: 0n, swapMode: 0 })], [w]),
      );
      const s = dammSwap(res);
      expect(s.compoundingFee).toBe(0n);
      lpClaimingFees += s.claimingFee;
      dammSwapCount += 1n;
      return s;
    };
    for (const [name, quoteIn] of [["frank", (threshold * 30n) / 100n], ["grace", (threshold * 10n) / 100n]] as const) {
      const w = (wallets[name] = fundedWallet(fork, threshold));
      const b = createAta(fork, w, w.publicKey, keys.baseMint, TOKEN_PROGRAM_ID);
      tracker.trackBase(b);
      const s = await trade(`damm buy ${name}`, w, spyxAta(w.publicKey), b, quoteIn);
      expect(tokenAmount(fork, b)).toBe(s.output);
    }
    const frank = wallets.frank;
    const q0 = tokenAmount(fork, spyxAta(frank.publicKey));
    const s = await trade("damm sell frank", frank, baseOf(frank), spyxAta(frank.publicKey), tokenAmount(fork, baseOf(frank)) / 2n);
    expect(tokenAmount(fork, spyxAta(frank.publicKey)) - q0).toBe(s.output);
    // A curve buyer also sells on DAMM v2.
    const dave = wallets.dave;
    await trade("damm sell dave", dave, baseOf(dave), spyxAta(dave.publicKey), tokenAmount(fork, baseOf(dave)) / 4n);
    expect(lpClaimingFees).toBeGreaterThan(0n);
    expect(tokenAmount(fork, vault)).toBe(tracker.last.vault);
    log.damm = { swaps: dammSwapCount, lpClaimingFeesFromEvents: lpClaimingFees };
  });

  // ---------------------------------------------------------------- 10. harvest_lp_fees

  it("10. harvest_lp_fees moves exactly the position's pending quote fee into the vault; base side is zero", async () => {
    const lpArgs = (payer: PublicKey, overrides = {}) => ({
      payer,
      keys,
      dammPool: migration.dammPool,
      position: migration.firstPosition,
      positionNftAccount: migration.firstPositionNftAccount,
      dammTokenAVault: migration.tokenAVault,
      dammTokenBVault: migration.tokenBVault,
      overrides,
    });
    // Adversarial: a position NFT account that the Authority does not own.
    const c0 = cranker();
    const f = fork.sendExpectFail([await harvestLpFeesIx(lpArgs(c0.publicKey, { positionNftAccount: spyxAta(wallets.frank.publicKey) }))], [c0]);
    expect(errName(f)).toBe("PositionNftNotOwnedByAuthority");

    // Expected claim from DAMM v2 state (position.update_fee): pending + liquidity * (fee_b_per_liquidity - checkpoint) >> 128.
    const damm = fetchDammPool(fork, migration.dammPool);
    const pos = fetchPosition(fork, migration.firstPosition);
    const liquidity = bnToBig(pos.unlockedLiquidity) + bnToBig(pos.vestedLiquidity) + bnToBig(pos.permanentLockedLiquidity);
    const expectedB = bnToBig(pos.feeBPending) + (liquidity * (u256le(damm.feeBPerLiquidity) - u256le(pos.feeBPerTokenCheckpoint))) / U128;
    const expectedA = bnToBig(pos.feeAPending) + (liquidity * (u256le(damm.feeAPerLiquidity) - u256le(pos.feeAPerTokenCheckpoint))) / U128;
    expect(expectedA).toBe(0n);
    // Bounded by the LP (claiming) fees reported by the swaps: each swap rounds down at most 1 raw.
    expect(expectedB <= lpClaimingFees && expectedB >= lpClaimingFees - dammSwapCount).toBe(true);

    const c = cranker();
    const v0 = tokenAmount(fork, vault);
    const dammB0 = tokenAmount(fork, migration.tokenBVault);
    const dammA0 = tokenAmount(fork, migration.tokenAVault);
    const supply0 = mintSupply(fork, keys.baseMint);
    const res = await tracker.step("harvest_lp_fees", "no-outflow", async () => fork.send([await harvestLpFeesIx(lpArgs(c.publicKey))], [c]));
    expect(tokenAmount(fork, vault) - v0).toBe(expectedB);
    expect(dammB0 - tokenAmount(fork, migration.tokenBVault)).toBe(expectedB);
    expect(tokenAmount(fork, migration.tokenAVault)).toBe(dammA0);
    expect(mintSupply(fork, keys.baseMint)).toBe(supply0);
    const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "lpFeesHarvested");
    expect(bnToBig(ev!.data.quoteAmount)).toBe(expectedB);
    expect(bnToBig(ev!.data.baseBurned)).toBe(0n);
    expect(bnToBig(fetchPosition(fork, migration.firstPosition).feeBPending)).toBe(0n);
    expect(fork.getAccount(spyxAta(c.publicKey))).toBeNull();
    harvested.lpFees = expectedB;
    (log.cu as any).harvestLpFees = res.computeUnits;
    log.lpFees = { claimed: expectedB, claimingFeesFromEvents: lpClaimingFees };
  });

  // ---------------------------------------------------------------- 11. redeem

  it("11. several holders redeem; each payout, fee and burn is exact and the floor rises", async () => {
    const view = decodeFloorReturn(fork.send([await floorIx({ config, baseMint: keys.baseMint })], [cranker()]));
    const V0 = tokenAmount(fork, vault);
    const S0 = mintSupply(fork, keys.baseMint);
    expect(view).toEqual({ vaultRaw: V0, supply: S0, exitFeeBps: EXIT_FEE_BPS, floorQ64: expectedFloorQ64(V0, S0) });
    expect(view.floorQ64).toBeGreaterThan(0n);
    expect(view.vaultRaw).toBe(Object.values(harvested).reduce((a, b) => a + b, 0n));

    // Adversarial basics: dust redemption (net 0) and more than the balance.
    const carol = wallets.carol;
    let f = fork.sendExpectFail([await redeemIx({ holder: carol.publicKey, keys, amount: 1n })], [carol]);
    expect(errName(f)).toBe("NothingToRedeem");
    f = fork.sendExpectFail([await redeemIx({ holder: carol.publicKey, keys, amount: tokenAmount(fork, baseOf(carol)) + 1n })], [carol]);
    expect(errName(f)).toBe("InsufficientBaseBalance");

    const redeem = async (name: string, amount: bigint) => {
      const w = wallets[name];
      const V = tokenAmount(fork, vault);
      const S = mintSupply(fork, keys.baseMint);
      const q = redeemQuote(V, S, amount, EXIT_FEE_BPS); // SDK mirror of the on-chain formula
      // Independent restatement: gross = floor(V * a / S), fee = ceil(gross * bps / 1e4).
      expect(q.gross).toBe((V * amount) / S);
      expect(q.fee).toBe(ceilDiv(q.gross * BigInt(EXIT_FEE_BPS), 10_000n));
      expect(q.net).toBeGreaterThan(0n);
      const quote0 = tokenAmount(fork, spyxAta(w.publicKey));
      const base0 = tokenAmount(fork, baseOf(w));
      const res = await tracker.step(`redeem ${name}`, "redeem", async () => fork.send([await redeemIx({ holder: w.publicKey, keys, amount })], [w]), {
        vaultOut: q.net,
        feeRetained: q.fee,
      });
      expect(tokenAmount(fork, spyxAta(w.publicKey)) - quote0).toBe(q.net);
      expect(base0 - tokenAmount(fork, baseOf(w))).toBe(amount);
      expect(mintSupply(fork, keys.baseMint)).toBe(S - amount);
      expect(tokenAmount(fork, vault)).toBe(V - q.net);
      const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "redeemed");
      expect([bnToBig(ev!.data.gross), bnToBig(ev!.data.fee), bnToBig(ev!.data.net)]).toEqual([q.gross, q.fee, q.net]);
      expect([bnToBig(ev!.data.vaultBefore), bnToBig(ev!.data.supplyBefore)]).toEqual([V, S]);
      redemptions.push({ holder: name, amount, ...q });
      (log.cu as any).redeem = res.computeUnits;
    };

    await redeem("carol", tokenAmount(fork, baseOf(carol))); // entire balance
    await redeem("alice", tokenAmount(fork, baseOf(wallets.alice)) / 2n);
    await redeem("erin", tokenAmount(fork, baseOf(wallets.erin)) / 4n);
    await redeem("frank", tokenAmount(fork, baseOf(wallets.frank))); // bought on DAMM v2, redeems everything
    expect(tokenAmount(fork, baseOf(carol))).toBe(0n);
    expect(tokenAmount(fork, baseOf(wallets.frank))).toBe(0n);
    log.redemptions = redemptions;
  });

  // ---------------------------------------------------------------- 12. final invariants

  it("12. floor invariants held after every step; Launch counters reconcile with the vault", async () => {
    const L = fetchLaunch(fork, config);
    const totalHarvested = Object.values(harvested).reduce((a, b) => a + b, 0n);
    const totalNet = redemptions.reduce((a, r) => a + r.net, 0n);
    const totalFees = redemptions.reduce((a, r) => a + r.fee, 0n);
    const totalBase = redemptions.reduce((a, r) => a + r.amount, 0n);
    expect(bnToBig(L.totalHarvestedQuote)).toBe(totalHarvested);
    expect(bnToBig(L.totalRedeemedQuote)).toBe(totalNet);
    expect(bnToBig(L.totalExitFees)).toBe(totalFees);
    expect(bnToBig(L.totalRedeemedBase)).toBe(totalBase);
    expect(bnToBig(L.totalBurnedBase)).toBe(donation);
    expect(tokenAmount(fork, vault)).toBe(totalHarvested - totalNet);
    expect(migrationFeeHarvested).toBeGreaterThan(0n);

    // The floor ratio never decreased across the whole history (re-checked end to end).
    const h = tracker.history;
    for (let i = 1; i < h.length; i++) {
      if (h[i - 1].supply > 0n && h[i].supply > 0n) {
        expect(h[i].vault * h[i - 1].supply >= h[i - 1].vault * h[i].supply, `floor decreased at ${h[i].label}`).toBe(true);
      }
    }
    const final = tracker.last;
    expect(final.authorityBase).toBe(0n);
    expect(final.trackedBase).toBe(final.supply);
    expect(tokenAccountOwner(fork, vault).equals(authority)).toBe(true);

    console.log(
      json({
        ...log,
        harvested,
        vaultFinal: final.vault,
        supplyFinal: final.supply,
        steps: h.length,
        floorHistory: tracker.table(),
        spyxDecimals: SPYX_DECIMALS,
      }),
    );
  });
});
