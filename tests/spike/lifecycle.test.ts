/**
 * M1 fork spike: full DBC lifecycle for a SPYx-quoted pool on a LiteSVM mainnet fork, with
 * config.fee_claimer = config.leftover_receiver = spike PDA ["authority", config].
 *
 * Real mainnet binaries: DBC, DAMM v2, Token-2022, SPL Token, ATA, Token Metadata.
 * Real mainnet accounts: SPYx mint, DBC token badge for SPYx, DBC/DAMM v2 pool authorities,
 * DAMM v2 Customizable migration config.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEvents } from "../src/anchor.js";
import {
  DBC_POOL_AUTHORITY,
  SPIKE_PROGRAM_ID,
  SPYX_DECIMALS,
  SPYX_MINT,
  SPYX_ONE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/constants.js";
import { claimPositionFeeIx, dammSwap2Ix, fetchDammPool, fetchPosition } from "../src/damm.js";
import {
  bnToBig,
  claimTradingFeeIx,
  DbcPoolKeys,
  fetchPoolConfig,
  fetchVirtualPool,
  migrationFeeSplit,
  MigrationProgress,
  priceFromSqrt,
  swap2Ix,
  SwapMode,
  withdrawMigrationFeeIx,
} from "../src/dbc.js";
import { anchorErrorFromLogs, Fork } from "../src/fork.js";
import { buyOnCurve, createLaunch, fundedWallet, Migration, migrateToDammV2, sellOnCurve } from "../src/scenario.js";
import {
  deriveAuthority,
  spikeClaimDammPositionFeeIx,
  spikeClaimPartnerTradingFeeIx,
  spikeProgram,
  spikeWithdrawPartnerMigrationFeeIx,
  spikeWithdrawPartnerSurplusIx,
} from "../src/spike.js";
import { createAta, mintAuthority, mintSupply, splAta, spyxAta, tokenAccountOwner, tokenAmount } from "../src/token.js";

const THRESHOLD = 5n * SPYX_ONE; // 500_000_000 raw
const MIGRATION_FEE_PCT = 50;
const BASE_DECIMALS = 6;
const PARTNER_MIGRATION_FEE_MASK = 0b100; // DBC state/virtual_pool.rs
const U64_MAX = 2n ** 64n - 1n;

describe("M1 spike: SPYx-quoted DBC lifecycle with a PDA fee_claimer (LiteSVM fork)", () => {
  let fork: Fork;
  let partner: Keypair;
  let creator: Keypair;
  let config: PublicKey;
  let authority: PublicKey;
  let keys: DbcPoolKeys;
  let pdaQuoteAta: PublicKey;
  let pdaBaseAta: PublicKey;
  let migration: Migration;
  const buyers: Keypair[] = [];
  const log: Record<string, unknown> = {};

  beforeAll(async () => {
    fork = Fork.create({ spike: true });
    const configKp = Keypair.generate();
    config = configKp.publicKey;
    authority = deriveAuthority(config, SPIKE_PROGRAM_ID);
    const launch = await createLaunch(fork, {
      feeClaimer: authority,
      leftoverReceiver: authority,
      configKeypair: configKp,
      migrationQuoteThreshold: THRESHOLD,
      config: {
        tradingFeeBps: 100,
        migrationFeePercentage: MIGRATION_FEE_PCT,
        creatorMigrationFeePercentage: 0,
        creatorTradingFeePercentage: 30,
        migratedPoolFeeBps: 100,
      },
    });
    ({ partner, creator, keys } = launch);
    // PDA-owned token accounts, created permissionlessly through the ATA program.
    pdaQuoteAta = createAta(fork, partner, authority, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    pdaBaseAta = createAta(fork, partner, authority, keys.baseMint, TOKEN_PROGRAM_ID);
  });

  it("creates a SPYx-quoted config whose fee_claimer and leftover_receiver are the spike PDA", () => {
    const cfg = fetchPoolConfig(fork, config);
    expect(cfg.quoteMint.equals(SPYX_MINT)).toBe(true);
    expect(cfg.feeClaimer.equals(authority)).toBe(true);
    expect(cfg.leftoverReceiver.equals(authority)).toBe(true);
    expect(cfg.migrationFeePercentage).toBe(MIGRATION_FEE_PCT);
    expect(cfg.creatorMigrationFeePercentage).toBe(0);
    expect(cfg.creatorTradingFeePercentage).toBe(30);
    expect(cfg.partnerPermanentLockedLiquidityPercentage).toBe(100);
    expect(cfg.quoteTokenFlag).toBe(1); // Token-2022 quote
    expect(cfg.fixedTokenSupplyFlag).toBe(0); // dynamic supply
    expect(bnToBig(cfg.migrationQuoteThreshold)).toBe(THRESHOLD);
    const pool = fetchVirtualPool(fork, keys.pool);
    expect(pool.config.equals(config)).toBe(true);
    expect(mintAuthority(fork, keys.baseMint)).toBeNull();
    log.initialBaseSupply = mintSupply(fork, keys.baseMint);
    log.startPriceUi = priceFromSqrt(bnToBig(cfg.sqrtStartPrice), BASE_DECIMALS, SPYX_DECIMALS);
    log.migrationPriceUi = priceFromSqrt(bnToBig(cfg.migrationSqrtPrice), BASE_DECIMALS, SPYX_DECIMALS);
    log.migrationBaseThreshold = bnToBig(cfg.migrationBaseThreshold);
    log.swapBaseAmount = bnToBig(cfg.swapBaseAmount);
  });

  it("processes several buys by different wallets and a sell", async () => {
    for (const amount of [1n * SPYX_ONE, (3n * SPYX_ONE) / 2n, (4n * SPYX_ONE) / 5n]) {
      const b = fundedWallet(fork, 10n * SPYX_ONE);
      buyers.push(b);
      await buyOnCurve(fork, keys, b, amount);
      expect(tokenAmount(fork, spyxAta(b.publicKey))).toBe(10n * SPYX_ONE - amount);
      expect(tokenAmount(fork, splAta(b.publicKey, keys.baseMint))).toBeGreaterThan(0n);
    }
    const seller = buyers[0];
    const baseBal = tokenAmount(fork, splAta(seller.publicKey, keys.baseMint));
    const quoteBefore = tokenAmount(fork, spyxAta(seller.publicKey));
    await sellOnCurve(fork, keys, seller, baseBal / 2n);
    expect(tokenAmount(fork, spyxAta(seller.publicKey))).toBeGreaterThan(quoteBefore);
    const pool = fetchVirtualPool(fork, keys.pool);
    expect(bnToBig(pool.quoteReserve)).toBeLessThan(THRESHOLD);
    expect(bnToBig(pool.partnerQuoteFee)).toBeGreaterThan(0n);
    expect(bnToBig(pool.partnerBaseFee)).toBe(0n); // collect fee mode = quote token
    log.feesBeforeClaim = {
      partnerQuote: bnToBig(pool.partnerQuoteFee),
      creatorQuote: bnToBig(pool.creatorQuoteFee),
      protocolQuote: bnToBig(pool.protocolQuoteFee),
    };
  });

  it("claims the partner trading fee via spike CPI (PDA signer) into the PDA SPYx ATA", async () => {
    const partnerQuoteFee = bnToBig(fetchVirtualPool(fork, keys.pool).partnerQuoteFee);
    const ataBefore = tokenAmount(fork, pdaQuoteAta);
    const vaultBefore = tokenAmount(fork, keys.quoteVault);
    const res = fork.send(
      [await spikeClaimPartnerTradingFeeIx({ keys, tokenBaseAccount: pdaBaseAta, tokenQuoteAccount: pdaQuoteAta, maxBase: U64_MAX, maxQuote: U64_MAX })],
      [fork.newWallet()], // any payer: permissionless crank
    );
    expect(tokenAmount(fork, pdaQuoteAta) - ataBefore).toBe(partnerQuoteFee);
    expect(vaultBefore - tokenAmount(fork, keys.quoteVault)).toBe(partnerQuoteFee);
    expect(bnToBig(fetchVirtualPool(fork, keys.pool).partnerQuoteFee)).toBe(0n);
    const ev = parseEvents(spikeProgram(), res.logs).find((e) => e.name === "partnerTradingFeeClaimed");
    expect(ev).toBeDefined();
    expect(bnToBig(ev!.data.quoteClaimed)).toBe(partnerQuoteFee);
    log.partnerTradingFeeClaimed = partnerQuoteFee;
    log.cuClaimTradingFee = res.computeUnits;
  });

  it("rejects a random signer claiming the partner trading fee directly from DBC", async () => {
    const attacker = fundedWallet(fork, 1n);
    const fail = fork.sendExpectFail(
      [
        await claimTradingFeeIx({
          keys,
          feeClaimer: attacker.publicKey,
          tokenBaseAccount: createAta(fork, attacker, attacker.publicKey, keys.baseMint, TOKEN_PROGRAM_ID),
          tokenQuoteAccount: spyxAta(attacker.publicKey),
          maxBase: 1n,
          maxQuote: 1n,
        }),
      ],
      [attacker],
    );
    expect(anchorErrorFromLogs(fail.logs)?.name).toBe("Unauthorized");
  });

  it("rejects an exact-in buy that crosses the migration price (DBC 0.2.1 behavior)", async () => {
    const whale = fundedWallet(fork, 10n * SPYX_ONE);
    const remaining = THRESHOLD - bnToBig(fetchVirtualPool(fork, keys.pool).quoteReserve);
    const baseAta = createAta(fork, whale, whale.publicKey, keys.baseMint, TOKEN_PROGRAM_ID);
    const fail = fork.sendExpectFail(
      [
        await swap2Ix({
          keys,
          payer: whale.publicKey,
          inputTokenAccount: spyxAta(whale.publicKey),
          outputTokenAccount: baseAta,
          amount0: (remaining * 101n) / 100n + SPYX_ONE / 5n,
          amount1: 0n,
          swapMode: SwapMode.ExactIn,
        }),
      ],
      [whale],
    );
    expect(anchorErrorFromLogs(fail.logs)?.name).toBe("InsufficientLiquidity");
  });

  it("completes the curve with a partial-fill buy", async () => {
    const whale = fundedWallet(fork, 10n * SPYX_ONE);
    buyers.push(whale);
    const remaining = THRESHOLD - bnToBig(fetchVirtualPool(fork, keys.pool).quoteReserve);
    const offered = (remaining * 101n) / 100n + SPYX_ONE / 5n;
    const res = await buyOnCurve(fork, keys, whale, offered, SwapMode.PartialFill);
    const spent = 10n * SPYX_ONE - tokenAmount(fork, spyxAta(whale.publicKey));
    expect(spent).toBeLessThan(offered); // the unfilled remainder stays with the buyer
    const pool = fetchVirtualPool(fork, keys.pool);
    expect(bnToBig(pool.quoteReserve)).toBeGreaterThanOrEqual(THRESHOLD);
    expect(pool.migrationProgress).toBe(MigrationProgress.LockedVesting);
    log.completingBuy = { offered, spent, cu: res.computeUnits };
    log.quoteReserveAtCompletion = bnToBig(pool.quoteReserve);

    const late = fundedWallet(fork, SPYX_ONE);
    const lateFail = fork.sendExpectFail(
      [
        await swap2Ix({
          keys,
          payer: late.publicKey,
          inputTokenAccount: spyxAta(late.publicKey),
          outputTokenAccount: createAta(fork, late, late.publicKey, keys.baseMint, TOKEN_PROGRAM_ID),
          amount0: SPYX_ONE / 10n,
          amount1: 0n,
          swapMode: SwapMode.ExactIn,
        }),
      ],
      [late],
    );
    expect(anchorErrorFromLogs(lateFail.logs)?.name).toBe("PoolIsCompleted");
  });

  it("migrates to DAMM v2 (permissionless migration_damm_v2, Customizable config)", async () => {
    migration = await migrateToDammV2(fork, keys);
    log.cuMigration = migration.tx.computeUnits;
    const pool = fetchVirtualPool(fork, keys.pool);
    expect(pool.isMigrated).toBe(1);
    expect(pool.migrationProgress).toBe(MigrationProgress.CreatedPool);
    const damm = fetchDammPool(fork, migration.dammPool);
    expect(damm.tokenAMint.equals(keys.baseMint)).toBe(true);
    expect(damm.tokenBMint.equals(SPYX_MINT)).toBe(true);
    expect(damm.collectFeeMode).toBe(1); // OnlyB = quote-only LP fees
    const { quoteAmount } = migrationFeeSplit(THRESHOLD, MIGRATION_FEE_PCT, 0);
    // 0.2% protocol liquidity migration fee is taken from the migrated quote.
    expect(bnToBig(damm.tokenBAmount)).toBe(quoteAmount - (quoteAmount * 20n) / 10_000n);
    log.dammPool = migration.dammPool.toBase58();
    log.dammTokenAAmount = bnToBig(damm.tokenAAmount);
    log.dammTokenBAmount = bnToBig(damm.tokenBAmount);
  });

  it("withdraws the partner migration fee via spike CPI into the PDA SPYx ATA (exact amount)", async () => {
    const split = migrationFeeSplit(THRESHOLD, MIGRATION_FEE_PCT, 0);
    // fee = threshold - ceil(threshold * (100 - pct) / 100); creator share 0 -> all to partner.
    const ceil = (THRESHOLD * BigInt(100 - MIGRATION_FEE_PCT) + 99n) / 100n;
    expect(split.partner).toBe(THRESHOLD - ceil);
    expect(split.partner).toBe(250_000_000n);

    const ataBefore = tokenAmount(fork, pdaQuoteAta);
    const vaultBefore = tokenAmount(fork, keys.quoteVault);
    const res = fork.send([await spikeWithdrawPartnerMigrationFeeIx({ keys, tokenQuoteAccount: pdaQuoteAta })], [fork.newWallet()]);
    expect(tokenAmount(fork, pdaQuoteAta) - ataBefore).toBe(250_000_000n);
    expect(vaultBefore - tokenAmount(fork, keys.quoteVault)).toBe(250_000_000n);
    expect(tokenAccountOwner(fork, pdaQuoteAta).equals(authority)).toBe(true);
    expect(fetchVirtualPool(fork, keys.pool).migrationFeeWithdrawStatus & PARTNER_MIGRATION_FEE_MASK).toBe(PARTNER_MIGRATION_FEE_MASK);
    const ev = parseEvents(spikeProgram(), res.logs).find((e) => e.name === "partnerMigrationFeeWithdrawn");
    expect(bnToBig(ev!.data.quoteReceived)).toBe(250_000_000n);
    log.partnerMigrationFee = split.partner;
    log.cuWithdrawMigrationFee = res.computeUnits;
  });

  it("rejects a random signer calling DBC withdraw_migration_fee(flag=0) directly", async () => {
    const attacker = fundedWallet(fork, 1n);
    const fail = fork.sendExpectFail(
      [await withdrawMigrationFeeIx({ keys, sender: attacker.publicKey, tokenQuoteAccount: spyxAta(attacker.publicKey), flag: 0 })],
      [attacker],
    );
    expect(anchorErrorFromLogs(fail.logs)?.name).toBe("NotPermitToDoThisAction");
  });

  it("rejects a second partner migration fee withdrawal", async () => {
    const fail = fork.sendExpectFail([await spikeWithdrawPartnerMigrationFeeIx({ keys, tokenQuoteAccount: pdaQuoteAta })], [partner]);
    expect(anchorErrorFromLogs(fail.logs)?.name).toBe("MigrationFeeHasBeenWithdraw");
  });

  it("rejects routing a spike harvest into a token account not owned by the PDA", async () => {
    const attacker = fundedWallet(fork, 1n);
    const fail = fork.sendExpectFail([await spikeWithdrawPartnerSurplusIx({ keys, tokenQuoteAccount: spyxAta(attacker.publicKey) })], [attacker]);
    expect(anchorErrorFromLogs(fail.logs)?.name).toBe("ConstraintTokenOwner");
  });

  it("withdraws the partner surplus via spike CPI (80% x (100 - 30)% of surplus; rounding-only here)", async () => {
    const surplus = bnToBig(fetchVirtualPool(fork, keys.pool).quoteReserve) - THRESHOLD;
    const partnerAndCreator = (surplus * 80n) / 100n;
    const expected = partnerAndCreator - (partnerAndCreator * 30n) / 100n;
    const before = tokenAmount(fork, pdaQuoteAta);
    fork.send([await spikeWithdrawPartnerSurplusIx({ keys, tokenQuoteAccount: pdaQuoteAta })], [partner]);
    expect(tokenAmount(fork, pdaQuoteAta) - before).toBe(expected);
    expect(fetchVirtualPool(fork, keys.pool).isPartnerWithdrawSurplus).toBe(1);
    log.surplus = surplus;
    log.partnerSurplus = expected;
  });

  it("records DAMM v2 position ownership and the post-migration base supply", () => {
    const first = fetchPosition(fork, migration.firstPosition);
    const firstNftOwner = tokenAccountOwner(fork, migration.firstPositionNftAccount);
    expect(firstNftOwner.equals(authority)).toBe(true);
    expect(bnToBig(first.permanentLockedLiquidity)).toBeGreaterThan(0n);
    expect(bnToBig(first.unlockedLiquidity)).toBe(0n);
    expect(bnToBig(first.vestedLiquidity)).toBe(0n);
    // With creator liquidity 0% and ConcentratedLiquidity rounding, no second (creator) position is created.
    expect(fork.getAccount(migration.secondPosition)).toBeNull();
    log.firstPosition = {
      address: migration.firstPosition.toBase58(),
      nftMint: migration.firstPositionNftMint.publicKey.toBase58(),
      nftAccount: migration.firstPositionNftAccount.toBase58(),
      nftOwner: firstNftOwner.toBase58(),
      permanentLockedLiquidity: bnToBig(first.permanentLockedLiquidity),
    };
    log.secondPosition = null;

    const supply = mintSupply(fork, keys.baseMint);
    const holders = buyers.reduce((s, b) => s + tokenAmount(fork, splAta(b.publicKey, keys.baseMint)), 0n);
    const dammBase = tokenAmount(fork, migration.tokenAVault);
    const dbcBase = tokenAmount(fork, keys.baseVault);
    expect(mintAuthority(fork, keys.baseMint)).toBeNull();
    // Every base token is accounted for: curve buyers + DAMM v2 vault + DBC vault (protocol migration base fee).
    expect(holders + dammBase + dbcBase).toBe(supply);
    expect(supply).toBeLessThan(log.initialBaseSupply as bigint); // unsold buffer burned at migration
    log.postMigrationBaseSupply = supply;
    log.baseHeldByBuyers = holders;
    log.baseInDammVault = dammBase;
    log.baseLeftInDbcVault = dbcBase;
    log.quoteLeftInDbcVault = tokenAmount(fork, keys.quoteVault);
  });

  it("stretch: claims DAMM v2 LP fees for the PDA-owned position via spike CPI", async () => {
    const trader = fundedWallet(fork, 5n * SPYX_ONE);
    const dammKeys = migration.dammKeys;
    const traderBase = createAta(fork, trader, trader.publicKey, keys.baseMint, TOKEN_PROGRAM_ID);
    fork.warp(60);
    const swap = async (input: PublicKey, output: PublicKey, amount: bigint) =>
      fork.send(
        [await dammSwap2Ix({ keys: dammKeys, payer: trader.publicKey, inputTokenAccount: input, outputTokenAccount: output, amount0: amount, amount1: 0n, swapMode: 0 })],
        [trader],
      );
    await swap(spyxAta(trader.publicKey), traderBase, SPYX_ONE);
    await swap(traderBase, spyxAta(trader.publicKey), tokenAmount(fork, traderBase) / 2n);

    const attacker = fundedWallet(fork, 1n);
    const attackerFail = fork.sendExpectFail(
      [
        await claimPositionFeeIx({
          keys: dammKeys,
          position: migration.firstPosition,
          positionNftAccount: migration.firstPositionNftAccount,
          signer: attacker.publicKey,
          tokenAAccount: createAta(fork, attacker, attacker.publicKey, keys.baseMint, TOKEN_PROGRAM_ID),
          tokenBAccount: spyxAta(attacker.publicKey),
        }),
      ],
      [attacker],
    );
    log.dammDirectClaimByAttackerError = anchorErrorFromLogs(attackerFail.logs)?.name ?? attackerFail.error;

    const quoteBefore = tokenAmount(fork, pdaQuoteAta);
    const baseBefore = tokenAmount(fork, pdaBaseAta);
    const res = fork.send(
      [
        await spikeClaimDammPositionFeeIx({
          config,
          keys: dammKeys,
          position: migration.firstPosition,
          positionNftAccount: migration.firstPositionNftAccount,
          tokenAAccount: pdaBaseAta,
          tokenBAccount: pdaQuoteAta,
        }),
      ],
      [fork.newWallet()],
    );
    const quoteGain = tokenAmount(fork, pdaQuoteAta) - quoteBefore;
    const baseGain = tokenAmount(fork, pdaBaseAta) - baseBefore;
    expect(quoteGain).toBeGreaterThan(0n);
    expect(baseGain).toBe(0n); // OnlyB: LP fees accrue in the quote token only
    log.dammLpFeeClaimed = { quote: quoteGain, base: baseGain };
    log.cuClaimPositionFee = res.computeUnits;
  });

  it("prints the spike log", () => {
    console.log(
      JSON.stringify(
        { ...log, dbcPoolAuthority: DBC_POOL_AUTHORITY.toBase58(), spikePda: authority.toBase58(), creator: creator.publicKey.toBase58() },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
  });
});
