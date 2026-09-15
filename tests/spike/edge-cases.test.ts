/**
 * M1 spike edge cases that shape the stockfloor design:
 * - harvest order: the partner migration fee can be withdrawn before migration;
 * - SPYx Pausable: harvest fails atomically while paused and succeeds after unpause;
 * - ScaledUiAmount multiplier changes do not affect raw amounts;
 * - anyone can create a second pool on the same DBC config;
 * - withdraw_leftover is not available for dynamic-supply configs.
 */
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { DBC_TOKEN_BADGE_SPYX, SPIKE_PROGRAM_ID, SPYX_MINT, SPYX_ONE, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/constants.js";
import { fetchDammPool } from "../src/damm.js";
import {
  bnToBig,
  deriveDbcPool,
  fetchVirtualPool,
  initializeVirtualPoolWithSplTokenIx,
  migrationFeeSplit,
  MigrationProgress,
  withdrawLeftoverIx,
} from "../src/dbc.js";
import { anchorErrorFromLogs, Fork } from "../src/fork.js";
import { buyOnCurve, completeCurve, createLaunch, fundedWallet, migrateToDammV2 } from "../src/scenario.js";
import { deriveAuthority, spikeWithdrawPartnerMigrationFeeIx } from "../src/spike.js";
import {
  createAta,
  effectiveMultiplier,
  getScaledUiAmount,
  isMintPaused,
  setMintPaused,
  setScaledUiMultiplier,
  spyxAta,
  tokenAmount,
} from "../src/token.js";

const THRESHOLD = 5n * SPYX_ONE;
const PARTNER_FEE = migrationFeeSplit(THRESHOLD, 50, 0).partner; // 250_000_000

async function launchWithSpikePda(fork: Fork) {
  const configKp = Keypair.generate();
  const authority = deriveAuthority(configKp.publicKey, SPIKE_PROGRAM_ID);
  const launch = await createLaunch(fork, { feeClaimer: authority, configKeypair: configKp, migrationQuoteThreshold: THRESHOLD });
  const pdaQuoteAta = createAta(fork, launch.partner, authority, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
  return { ...launch, authority, pdaQuoteAta };
}

describe("M1 spike edge cases (LiteSVM fork)", () => {
  it("partner migration fee can be withdrawn before migration; migration still succeeds with identical DAMM v2 reserves", async () => {
    const fork = Fork.create({ spike: true });
    const l = await launchWithSpikePda(fork);
    await buyOnCurve(fork, l.keys, fundedWallet(fork, 3n * SPYX_ONE), 2n * SPYX_ONE);

    // Not claimable before the curve is complete.
    const early = fork.sendExpectFail([await spikeWithdrawPartnerMigrationFeeIx({ keys: l.keys, tokenQuoteAccount: l.pdaQuoteAta })], [l.partner]);
    expect(anchorErrorFromLogs(early.logs)?.name).toBe("NotPermitToDoThisAction");

    await completeCurve(fork, l.keys, THRESHOLD);
    expect(fetchVirtualPool(fork, l.keys.pool).migrationProgress).toBe(MigrationProgress.LockedVesting);

    fork.send([await spikeWithdrawPartnerMigrationFeeIx({ keys: l.keys, tokenQuoteAccount: l.pdaQuoteAta })], [l.partner]);
    expect(tokenAmount(fork, l.pdaQuoteAta)).toBe(PARTNER_FEE);

    const m = await migrateToDammV2(fork, l.keys);
    const damm = fetchDammPool(fork, m.dammPool);
    const { quoteAmount } = migrationFeeSplit(THRESHOLD, 50, 0);
    expect(bnToBig(damm.tokenBAmount)).toBe(quoteAmount - (quoteAmount * 20n) / 10_000n);
    expect(fetchVirtualPool(fork, l.keys.pool).migrationProgress).toBe(MigrationProgress.CreatedPool);
  });

  it("paused SPYx: curve trades and the PDA harvest fail atomically; after unpause the harvest succeeds", async () => {
    const fork = Fork.create({ spike: true });
    const l = await launchWithSpikePda(fork);
    await completeCurve(fork, l.keys, THRESHOLD);

    setMintPaused(fork, SPYX_MINT, true);
    expect(isMintPaused(fork, SPYX_MINT)).toBe(true);

    const trader = fundedWallet(fork, SPYX_ONE);
    // A plain Token-2022 transfer fails while paused.
    const tradeFail = fork.sendTx(
      [createTransferCheckedInstruction(spyxAta(trader.publicKey), SPYX_MINT, l.pdaQuoteAta, trader.publicKey, 1n, 8, [], TOKEN_2022_PROGRAM_ID)],
      [trader],
    );
    expect(tradeFail.ok).toBe(false);
    expect(tradeFail.logs.join("\n")).toContain("Transferring, minting, and burning is paused on this mint");

    const statusBefore = fetchVirtualPool(fork, l.keys.pool).migrationFeeWithdrawStatus;
    const harvestFail = fork.sendExpectFail([await spikeWithdrawPartnerMigrationFeeIx({ keys: l.keys, tokenQuoteAccount: l.pdaQuoteAta })], [l.partner]);
    // Token-2022 TokenError::MintPaused = custom error 0x43 (67), bubbled up through DBC and the spike.
    expect(harvestFail.logs.join("\n")).toContain("Transferring, minting, and burning is paused on this mint");
    expect(harvestFail.error).toContain("code: 67");
    expect(fetchVirtualPool(fork, l.keys.pool).migrationFeeWithdrawStatus).toBe(statusBefore);
    expect(tokenAmount(fork, l.pdaQuoteAta)).toBe(0n);

    const migrateFail = await migrateToDammV2(fork, l.keys).then(
      () => null,
      (e: Error) => e,
    );
    expect(migrateFail).toBeInstanceOf(Error);

    setMintPaused(fork, SPYX_MINT, false);
    fork.send([await spikeWithdrawPartnerMigrationFeeIx({ keys: l.keys, tokenQuoteAccount: l.pdaQuoteAta })], [l.partner]);
    expect(tokenAmount(fork, l.pdaQuoteAta)).toBe(PARTNER_FEE);
    await migrateToDammV2(fork, l.keys);
  });

  it("ScaledUiAmount multiplier change mid-lifecycle leaves raw amounts unchanged", async () => {
    const fork = Fork.create({ spike: true });
    const l = await launchWithSpikePda(fork);
    const original = getScaledUiAmount(fork, SPYX_MINT)!;
    expect(original.multiplier).toBeGreaterThan(0.9);

    const buyer = fundedWallet(fork, 3n * SPYX_ONE);
    await buyOnCurve(fork, l.keys, buyer, SPYX_ONE);
    setScaledUiMultiplier(fork, SPYX_MINT, 2.5);
    expect(effectiveMultiplier(fork, SPYX_MINT)).toBe(2.5);
    await buyOnCurve(fork, l.keys, buyer, SPYX_ONE);
    expect(tokenAmount(fork, spyxAta(buyer.publicKey))).toBe(SPYX_ONE);

    await completeCurve(fork, l.keys, THRESHOLD);
    setScaledUiMultiplier(fork, SPYX_MINT, 1.01, { newMultiplier: 3, effectiveTimestamp: fork.now() + 10n });
    fork.send([await spikeWithdrawPartnerMigrationFeeIx({ keys: l.keys, tokenQuoteAccount: l.pdaQuoteAta })], [l.partner]);
    expect(tokenAmount(fork, l.pdaQuoteAta)).toBe(PARTNER_FEE);
    fork.warp(20);
    expect(effectiveMultiplier(fork, SPYX_MINT)).toBe(3);
    await migrateToDammV2(fork, l.keys);
    expect(tokenAmount(fork, l.pdaQuoteAta)).toBe(PARTNER_FEE);
  });

  it("anyone can create a second pool on the same DBC config (fee claimer PDA is shared)", async () => {
    const fork = Fork.create({ spike: true });
    const l = await launchWithSpikePda(fork);
    const stranger = fork.newWallet();
    const baseMint2 = Keypair.generate();
    const init = await initializeVirtualPoolWithSplTokenIx({
      config: l.config,
      creator: stranger.publicKey,
      baseMint: baseMint2.publicKey,
      quoteMint: SPYX_MINT,
      payer: stranger.publicKey,
      name: "Copycat",
      symbol: "COPY",
      uri: "https://example.com/copy.json",
      tokenBadge: DBC_TOKEN_BADGE_SPYX,
    });
    fork.send([init.ix], [stranger, baseMint2]);
    expect(init.pool.equals(deriveDbcPool(l.config, baseMint2.publicKey, SPYX_MINT))).toBe(true);
    expect(init.pool.equals(l.keys.pool)).toBe(false);
    expect(fetchVirtualPool(fork, init.pool).config.equals(l.config)).toBe(true);
  });

  it("withdraw_leftover is rejected for dynamic-supply configs (unsold base is burned at migration instead)", async () => {
    const fork = Fork.create({ spike: true });
    const l = await launchWithSpikePda(fork);
    await completeCurve(fork, l.keys, THRESHOLD);
    await migrateToDammV2(fork, l.keys);
    const pdaBaseAta = createAta(fork, l.partner, l.authority, l.keys.baseMint, TOKEN_PROGRAM_ID);
    const fail = fork.sendExpectFail(
      [await withdrawLeftoverIx({ keys: l.keys, leftoverReceiver: l.authority, tokenBaseAccount: pdaBaseAta })],
      [l.partner],
    );
    expect(anchorErrorFromLogs(fail.logs)?.name).toBe("NotPermitToDoThisAction");
    expect(tokenAmount(fork, pdaBaseAta)).toBe(0n);
  });
});
