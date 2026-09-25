/**
 * Extra DAMM v2 positions held by the claimer PDA, on the mainnet fork (real stockfloor, DBC 0.2.1,
 * DAMM v2 0.2.4, Token-2022, SPYx and its DAMM v2 token badge).
 *
 * `harvest_lp_fees` accepts any DAMM v2 position whose NFT the claimer holds, on any pool with mints
 * (launch base mint, launch quote mint). This file checks that such positions cannot break an
 * invariant and are harvested exactly:
 *
 * 1. a second position on the migrated pool, funded by a third party (create_position +
 *    add_liquidity) and then transferred to the claimer (NFT moved to the claimer's Token-2022 ATA):
 *    both positions pay exactly their pending quote fee, the donor keeps no claim, and the donated
 *    liquidity stays locked (the program has no way to remove liquidity);
 * 2. a position created directly for the claimer with no liquidity harvests exactly 0;
 * 3. a position on a second DAMM v2 pool with the same mints and both-token fees (created with the
 *    claimer as pool creator): the quote fee is split (launch v3: creator 50%, platform 20%, vault
 *    the rest) and the base fee is burned in the same instruction, so the supply falls by exactly the
 *    base fee (the burn path of `harvest_lp_fees`, which the quote-only migrated pool never takes).
 *
 * 4. the SDK finds all of them (including the NFT held in the claimer's ATA, not the DAMM v2 NFT
 *    account PDA) and, by default, runCrank harvests only the positions on the launch's own pool with
 *    at least 0.00001 SPYx pending; the second pool's position is harvested only when opted in.
 *
 * FloorTracker checks every step: floor monotonic, vault outflow only through redeem, supply equals
 * the sum of all base accounts (including both DAMM v2 base vaults), the claimer holds no base, the
 * vault stays the vault authority's.
 */
import { BaseFeeMode, getBaseFeeParams, MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "@meteora-ag/cp-amm-sdk";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEvents } from "../src/anchor.js";
import { SPYX_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/constants.js";
import {
  addLiquidityIx,
  claimPositionFeeIx,
  createPositionIx,
  dammSwap2Ix,
  DammPoolKeys,
  deriveDammTokenBadge,
  fetchDammPool,
  fetchPosition,
  initializeCustomizablePoolIx,
  pendingPositionFees,
} from "../src/damm.js";
import { bnToBig } from "../src/dbc.js";
import { lpFeeSplit } from "../src/fee-model.js";
import { FloorTracker } from "../src/floor-invariants.js";
import { anchorErrorFromLogs, Fork, TxFailure } from "../src/fork.js";
import { fundedWallet, Migration } from "../src/scenario.js";
import { createStockfloorLaunch, graduate, StockfloorLaunch, trackerAccounts } from "../src/stockfloor-scenario.js";
import { fetchLaunch, harvestLpFeesIx, harvestMigrationFeeIx, stockfloorProgram } from "../src/stockfloor.js";
import { createAta, createAtaIdempotentIx, getAta, mintSupply, spyxAta, tokenAccountOwner, tokenAmount } from "../src/token.js";
import { defaultMinLpFeeQuote, fetchLaunchState, findClaimerPositions, planCrank, runCrank } from "@stockfloor/sdk";
import { LiteSvmSender } from "../sdk/litesvm-sender.js";

const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;

describe("extra DAMM v2 positions held by the claimer", () => {
  let fork: Fork;
  let L: StockfloorLaunch;
  let migration: Migration;
  let tracker: FloorTracker;
  let cranker: Keypair;
  /** Positions created by the tests, for the SDK discovery test at the end. */
  const made: { transferred?: { position: PublicKey; nftAccount: PublicKey }; empty?: { position: PublicKey; nftAccount: PublicKey }; second?: { keys: DammPoolKeys; position: PublicKey; nftAccount: PublicKey } } = {};

  const baseAta = (w: Keypair) => createAta(fork, w, w.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID);

  /** A DAMM v2 swap as one tracked step. */
  async function swap(label: string, keys: DammPoolKeys, w: Keypair, direction: "buy" | "sell", amount: bigint) {
    const base = getAta(w.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID);
    const [input, output] = direction === "buy" ? [spyxAta(w.publicKey), base] : [base, spyxAta(w.publicKey)];
    return tracker.step(label, "no-outflow", async () =>
      fork.send([await dammSwap2Ix({ keys, payer: w.publicKey, inputTokenAccount: input, outputTokenAccount: output, amount0: amount, amount1: 0n, swapMode: 0 })], [w]),
    );
  }

  /** harvest_lp_fees as one tracked step with the exact v3 split of `quoteFee`; returns the stockfloor event. */
  async function harvest(label: string, keys: DammPoolKeys, position: PublicKey, positionNftAccount: PublicKey, quoteFee: bigint) {
    const split = lpFeeSplit(quoteFee);
    const res = await tracker.step(label, "no-outflow", async () =>
      fork.send(
        [
          await harvestLpFeesIx({
            payer: cranker.publicKey,
            keys: L.keys,
            dammPool: keys.pool,
            position,
            positionNftAccount,
            dammTokenAVault: keys.tokenAVault,
            dammTokenBVault: keys.tokenBVault,
          }),
        ],
        [cranker],
      ),
      { vaultIn: split.vault, platformIn: split.platform, creatorIn: split.creator },
    );
    return parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "lpFeesHarvested")!;
  }

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    L = await createStockfloorLaunch(fork);
    const g = await graduate(fork, L, [25n, 15n]);
    migration = g.migration;
    cranker = fork.newWallet(10);
    fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [cranker]);
    fork.warp(60);
    tracker = new FloorTracker(fork, trackerAccounts(L));
    tracker.trackBase(L.keys.baseVault, migration.tokenAVault, ...[...g.buyers, g.whale].map((w) => getAta(w.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID)));
    tracker.start("graduated, migration fee harvested");
  });

  it("a second position on the migrated pool, funded by a third party and transferred to the claimer, is harvested exactly; the donor keeps no claim", async () => {
    const dk = migration.dammKeys;
    const donor = fundedWallet(fork, 10n * L.threshold);
    tracker.trackBase(baseAta(donor));
    await swap("donor buys base on DAMM v2", dk, donor, "buy", L.threshold);

    const nftMint = Keypair.generate();
    const created = await createPositionIx({ keys: dk, owner: donor.publicKey, positionNftMint: nftMint.publicKey, payer: donor.publicKey });
    await tracker.step("donor create_position", "no-outflow", () => fork.send([created.ix], [donor, nftMint]));
    const liquidityDelta = bnToBig(fetchDammPool(fork, dk.pool).liquidity) / 10n;
    await tracker.step("donor add_liquidity (10% of the pool)", "no-outflow", async () =>
      fork.send(
        [
          await addLiquidityIx({
            keys: dk,
            position: created.position,
            positionNftAccount: created.positionNftAccount,
            signer: donor.publicKey,
            tokenAAccount: getAta(donor.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID),
            tokenBAccount: spyxAta(donor.publicKey),
            liquidityDelta,
          }),
        ],
        [donor],
      ),
    );
    expect(bnToBig(fetchPosition(fork, created.position).unlockedLiquidity)).toBe(liquidityDelta);

    // The donor gives the position NFT to the claimer (Token-2022 ATA of the claimer for the NFT mint).
    const claimerNft = getAta(L.claimer, nftMint.publicKey, TOKEN_2022_PROGRAM_ID);
    await tracker.step("donor transfers the position NFT to the claimer", "no-outflow", () =>
      fork.send(
        [
          createAtaIdempotentIx(donor.publicKey, L.claimer, nftMint.publicKey, TOKEN_2022_PROGRAM_ID),
          createTransferCheckedInstruction(created.positionNftAccount, nftMint.publicKey, claimerNft, donor.publicKey, 1n, 0, [], TOKEN_2022_PROGRAM_ID),
        ],
        [donor],
      ),
    );
    expect(tokenAccountOwner(fork, claimerNft).equals(L.claimer)).toBe(true);
    expect(tokenAmount(fork, claimerNft)).toBe(1n);
    expect(tokenAmount(fork, created.positionNftAccount)).toBe(0n);
    made.transferred = { position: created.position, nftAccount: claimerNft };

    // Trades generate LP fees for both positions (quote only: the migrated pool collects OnlyB).
    const trader = fundedWallet(fork, 10n * L.threshold);
    tracker.trackBase(baseAta(trader));
    await swap("trader buy", dk, trader, "buy", L.threshold / 2n);
    await swap("trader sell", dk, trader, "sell", tokenAmount(fork, getAta(trader.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID)) / 2n);

    const p1 = pendingPositionFees(fork, dk.pool, migration.firstPosition);
    const p2 = pendingPositionFees(fork, dk.pool, created.position);
    expect([p1.a, p2.a]).toEqual([0n, 0n]);
    expect(p1.b > 0n && p2.b > 0n).toBe(true);

    // Mismatched NFT accounts are rejected; the donor cannot claim any more.
    const lp = (position: PublicKey, positionNftAccount: PublicKey) =>
      harvestLpFeesIx({ payer: cranker.publicKey, keys: L.keys, dammPool: dk.pool, position, positionNftAccount, dammTokenAVault: dk.tokenAVault, dammTokenBVault: dk.tokenBVault });
    for (const [label, position, nft] of [
      ["position 2 with the donor's emptied NFT account", created.position, created.positionNftAccount],
      ["position 2 with the NFT account of position 1", created.position, migration.firstPositionNftAccount],
      ["position 1 with the NFT account of position 2", migration.firstPosition, claimerNft],
    ] as const) {
      expect(errName(fork.sendExpectFail([await lp(position, nft)], [cranker])), label).toBe("PositionNftNotOwnedByClaimer");
    }
    const donorClaim = fork.sendExpectFail(
      [await claimPositionFeeIx({ keys: dk, position: created.position, positionNftAccount: created.positionNftAccount, signer: donor.publicKey, tokenAAccount: getAta(donor.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID), tokenBAccount: spyxAta(donor.publicKey) })],
      [donor],
    );
    expect(errName(donorClaim)).toBe("ConstraintRaw"); // DAMM v2: position_nft_account.amount == 1

    const v0 = tokenAmount(fork, L.vault);
    const h0 = bnToBig(fetchLaunch(fork, L.config).totalHarvestedQuote);
    const [v1, v2] = [lpFeeSplit(p1.b).vault, lpFeeSplit(p2.b).vault];
    const e1 = await harvest("harvest_lp_fees position 1 (migrated)", dk, migration.firstPosition, migration.firstPositionNftAccount, p1.b);
    expect(tokenAmount(fork, L.vault) - v0).toBe(v1);
    const e2 = await harvest("harvest_lp_fees position 2 (transferred to the claimer)", dk, created.position, claimerNft, p2.b);
    expect(tokenAmount(fork, L.vault) - v0).toBe(v1 + v2);
    expect([bnToBig(e1.data.quoteAmount), bnToBig(e2.data.quoteAmount), bnToBig(e2.data.baseBurned)]).toEqual([v1, v2, 0n]);
    expect(e2.data.position.equals(created.position)).toBe(true);
    expect(bnToBig(fetchLaunch(fork, L.config).totalHarvestedQuote) - h0).toBe(v1 + v2);
    expect(bnToBig(fetchPosition(fork, created.position).feeBPending)).toBe(0n);
    // The donated liquidity stays in the pool: only the NFT owner (the claimer) could remove it, and
    // the program has no instruction that does.
    expect(bnToBig(fetchPosition(fork, created.position).unlockedLiquidity)).toBe(liquidityDelta);
    console.log(JSON.stringify({ secondPosition: { liquidityDelta, position1Fee: p1.b, position2Fee: p2.b } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });

  it("a position created directly for the claimer without liquidity harvests exactly 0", async () => {
    const payer = fork.newWallet(1);
    const nftMint = Keypair.generate();
    const created = await createPositionIx({ keys: migration.dammKeys, owner: L.claimer, positionNftMint: nftMint.publicKey, payer: payer.publicKey });
    fork.send([created.ix], [payer, nftMint]);
    expect(tokenAccountOwner(fork, created.positionNftAccount).equals(L.claimer)).toBe(true);
    made.empty = { position: created.position, nftAccount: created.positionNftAccount };
    const v0 = tokenAmount(fork, L.vault);
    const ev = await harvest("harvest_lp_fees empty position", migration.dammKeys, created.position, created.positionNftAccount, 0n);
    expect(tokenAmount(fork, L.vault)).toBe(v0);
    expect([bnToBig(ev.data.quoteAmount), bnToBig(ev.data.baseBurned)]).toEqual([0n, 0n]);
  });

  it("a position on a second DAMM v2 pool (same mints, both-token fees): quote fee into the vault, base fee burned in the same instruction", async () => {
    const lpWallet = fundedWallet(fork, 10n * L.threshold);
    tracker.trackBase(baseAta(lpWallet));
    await swap("pool creator buys base on the migrated pool", migration.dammKeys, lpWallet, "buy", L.threshold);

    const migrated = fetchDammPool(fork, migration.dammPool);
    const nftMint = Keypair.generate();
    const badge = deriveDammTokenBadge(SPYX_MINT);
    expect(fork.getAccount(badge)?.owner.toBase58()).toBe("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
    const init = await initializeCustomizablePoolIx({
      creator: L.claimer, // the first position NFT goes to the claimer
      payer: lpWallet.publicKey,
      positionNftMint: nftMint.publicKey,
      tokenAMint: L.keys.baseMint,
      tokenBMint: SPYX_MINT,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_2022_PROGRAM_ID,
      payerTokenA: getAta(lpWallet.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID),
      payerTokenB: spyxAta(lpWallet.publicKey),
      baseFeeData: getBaseFeeParams({
        baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
        feeTimeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
      }).data,
      sqrtMinPrice: BigInt(MIN_SQRT_PRICE.toString()),
      sqrtMaxPrice: BigInt(MAX_SQRT_PRICE.toString()),
      sqrtPrice: bnToBig(migrated.sqrtPrice),
      liquidity: bnToBig(migrated.liquidity) / 20n,
      collectFeeMode: 0, // BothToken: fees on the output token
      remainingAccounts: [badge, badge], // token A (SPL base) needs no badge; index 1 is SPYx's
    });
    tracker.trackBase(init.keys.tokenAVault);
    await tracker.step("second DAMM v2 pool created, position NFT to the claimer", "no-outflow", () => fork.send([init.ix], [lpWallet, nftMint]));
    const custom = fetchDammPool(fork, init.keys.pool);
    expect(custom.tokenAMint.equals(L.keys.baseMint) && custom.tokenBMint.equals(SPYX_MINT)).toBe(true);
    expect(custom.collectFeeMode).toBe(0);
    expect(tokenAccountOwner(fork, init.positionNftAccount).equals(L.claimer)).toBe(true);
    made.second = { keys: init.keys, position: init.position, nftAccount: init.positionNftAccount };

    fork.warp(10);
    const trader = fundedWallet(fork, 10n * L.threshold);
    tracker.trackBase(baseAta(trader));
    await swap("buy on the second pool (fee in base)", init.keys, trader, "buy", L.threshold / 10n);
    await swap("sell on the second pool (fee in quote)", init.keys, trader, "sell", tokenAmount(fork, getAta(trader.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID)) / 2n);

    const pending = pendingPositionFees(fork, init.keys.pool, init.position);
    expect(pending.a > 0n && pending.b > 0n).toBe(true);
    const v0 = tokenAmount(fork, L.vault);
    const s0 = mintSupply(fork, L.keys.baseMint);
    const dammA0 = tokenAmount(fork, init.keys.tokenAVault);
    const burned0 = bnToBig(fetchLaunch(fork, L.config).totalBurnedBase);
    const ev = await harvest("harvest_lp_fees on the second pool (burns the base fee)", init.keys, init.position, init.positionNftAccount, pending.b);
    const vaultPart = lpFeeSplit(pending.b).vault;
    expect(tokenAmount(fork, L.vault) - v0).toBe(vaultPart);
    expect(s0 - mintSupply(fork, L.keys.baseMint)).toBe(pending.a);
    expect(dammA0 - tokenAmount(fork, init.keys.tokenAVault)).toBe(pending.a);
    expect(tokenAmount(fork, L.claimerBaseAccount)).toBe(0n);
    expect([bnToBig(ev.data.quoteAmount), bnToBig(ev.data.baseBurned)]).toEqual([vaultPart, pending.a]);
    expect(bnToBig(fetchLaunch(fork, L.config).totalBurnedBase) - burned0).toBe(pending.a);
    // Vault up and supply down in one instruction: the floor strictly rises.
    const prev = tracker.history[tracker.history.length - 2];
    const last = tracker.last;
    expect(last.vault * prev.supply > prev.vault * last.supply).toBe(true);
    console.log(JSON.stringify({ bothTokenPool: { pool: init.keys.pool.toBase58(), quoteFee: pending.b, baseFeeBurned: pending.a } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });

  it("the SDK finds every claimer position (the NFT in the claimer's ATA included); runCrank harvests the launch pool by default and the second pool only when opted in", async () => {
    const { transferred, empty, second } = made;
    expect(transferred && empty && second).toBeTruthy();
    const sender = new LiteSvmSender(fork, cranker);
    const launch = PublicKey.findProgramAddressSync([Buffer.from("launch"), L.config.toBuffer()], stockfloorProgram().programId)[0];
    fork.warp(10);
    const trader = fundedWallet(fork, 10n * L.threshold);
    tracker.trackBase(baseAta(trader));
    const base = () => tokenAmount(fork, getAta(trader.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID));
    await swap("buy on the migrated pool", migration.dammKeys, trader, "buy", L.threshold / 2n);
    await swap("sell on the migrated pool", migration.dammKeys, trader, "sell", base() / 2n);
    await swap("buy on the second pool", second!.keys, trader, "buy", L.threshold / 10n);
    await swap("sell on the second pool", second!.keys, trader, "sell", base() / 4n);

    // Discovery: position NFT account PDAs and the claimer's ATA.
    const found = await findClaimerPositions(sender, { claimer: L.claimer, baseMint: L.keys.baseMint, quoteMint: SPYX_MINT });
    const byPosition = new Map(found.map((p) => [p.position.toBase58(), p]));
    expect(found.length).toBe(4);
    const pMigrated = byPosition.get(migration.firstPosition.toBase58())!;
    const pTransferred = byPosition.get(transferred!.position.toBase58())!;
    const pEmpty = byPosition.get(empty!.position.toBase58())!;
    const pSecond = byPosition.get(second!.position.toBase58())!;
    expect(pMigrated.positionNftAccount.equals(migration.firstPositionNftAccount)).toBe(true);
    expect(pTransferred.positionNftAccount.equals(transferred!.nftAccount)).toBe(true); // the claimer's ATA
    expect(pEmpty.positionNftAccount.equals(empty!.nftAccount)).toBe(true);
    expect(pSecond.dammPool.equals(second!.keys.pool)).toBe(true);
    expect(pMigrated.pending).toEqual(pendingPositionFees(fork, migration.dammPool, migration.firstPosition));
    expect(pTransferred.pending).toEqual(pendingPositionFees(fork, migration.dammPool, transferred!.position));
    expect(pSecond.pending).toEqual(pendingPositionFees(fork, second!.keys.pool, second!.position));
    expect(pEmpty.pending).toEqual({ a: 0n, b: 0n });
    const min = defaultMinLpFeeQuote(8);
    expect(pMigrated.pending.b >= min && pTransferred.pending.b >= min && pSecond.pending.b >= min && pSecond.pending.a > 0n).toBe(true);

    // Default plan: the migrated pool's two funded positions only, largest pending quote first.
    const s0 = (await fetchLaunchState(sender, { launch }))!;
    expect(s0.positions.length).toBe(4);
    const lpPlan = planCrank(s0).filter((a) => a.kind === "harvest_lp_fees");
    const expectedOrder = [pMigrated, pTransferred].sort((x, y) => (x.pending.b > y.pending.b ? -1 : 1)).map((p) => p.position.toBase58());
    expect(lpPlan.map((a) => (a.kind === "harvest_lp_fees" ? a.position.toBase58() : ""))).toEqual(expectedOrder);
    expect(planCrank(s0, { includeForeignPositions: true }).filter((a) => a.kind === "harvest_lp_fees").length).toBe(3);

    // runCrank with defaults (also harvests the pending curve fees and surplus of this launch; v3
    // curve fees go to the platform treasury, the surplus to the vault, LP fees are split).
    const v0 = tokenAmount(fork, L.vault);
    const expectedOther = s0.partnerSurplus;
    const res = await tracker.step("runCrank (defaults)", "no-outflow", () => runCrank(sender, { launch }));
    expect(res.steps.every((st) => st.status === "executed")).toBe(true);
    expect(res.steps.filter((st) => st.action.kind === "harvest_lp_fees").length).toBe(2);
    expect(tokenAmount(fork, L.vault) - v0).toBe(expectedOther + lpFeeSplit(pMigrated.pending.b).vault + lpFeeSplit(pTransferred.pending.b).vault);
    expect(pendingPositionFees(fork, second!.keys.pool, second!.position)).toEqual(pSecond.pending);

    // Opted in: the second pool's position, quote into the vault and base burned.
    const v1 = tokenAmount(fork, L.vault);
    const s1 = mintSupply(fork, L.keys.baseMint);
    const opted = await tracker.step("runCrank (includeForeignPositions)", "no-outflow", () => runCrank(sender, { launch }, { includeForeignPositions: true }));
    expect(opted.steps.map((st) => [st.action.kind, st.status])).toEqual([["harvest_lp_fees", "executed"]]);
    expect(tokenAmount(fork, L.vault) - v1).toBe(lpFeeSplit(pSecond.pending.b).vault);
    expect(s1 - mintSupply(fork, L.keys.baseMint)).toBe(pSecond.pending.a);
    expect(planCrank((await fetchLaunchState(sender, { launch }))!, { includeForeignPositions: true })).toEqual([]);
  });
});
