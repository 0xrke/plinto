/**
 * The claimer PDA never holds or controls the vault (M2 vault-authority split), on the mainnet fork
 * with the real stockfloor program, DBC 0.2.1, DAMM v2 0.2.4, Token-2022 and SPYx.
 *
 * - The claimer ["authority", config] is the DBC fee_claimer and the DAMM v2 position NFT owner and
 *   signs every CPI into those (upgradeable) programs. The vault is the SPYx ATA of a different PDA,
 *   ["vault_authority", config], which signs only the payout transfer of `redeem`.
 * - Launch v3: the claimer also owns a quote transit account that the fee-split harvests pass
 *   through (DBC / DAMM v2 pay into it, the claimer pays platform, creator and vault out of it). It
 *   is empty after every instruction, and the vault is only ever a destination.
 * - DBC `claim_trading_fee` / `withdraw_migration_fee` / `partner_withdraw_surplus` and DAMM v2
 *   `claim_position_fee` accept a destination token account of any owner (vendor sources: the
 *   destination accounts carry no owner constraint; DAMM v2's owner path skips destination checks).
 *   The harvests below prove it on the real binaries: quote lands directly in a vault the signer
 *   does not own, and the vault authority is not even an account of those transactions.
 * - A transaction that carries the claimer's signature (forged here with LiteSVM signature
 *   verification off, which is exactly the privilege an upgraded DBC or DAMM v2 would receive through
 *   the CPI) cannot transfer, burn, approve, set a close authority on, re-own or close the vault.
 *   Closing is checked on an empty vault (a fresh launch before any harvest), the only state in which
 *   Token-2022 checks the closing authority at all; a non-empty vault cannot be closed by anyone.
 *   Positive controls show the forged signatures are effective where the key has authority.
 */
import {
  AuthorityType,
  createApproveCheckedInstruction,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { SPYX_DECIMALS, SPYX_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/constants.js";
import { dammSwap2Ix, fetchDammPool, fetchPosition } from "../src/damm.js";
import { bnToBig, fetchVirtualPool } from "../src/dbc.js";
import { FloorTracker, tokenAccountCloseAuthority, tokenAccountDelegate } from "../src/floor-invariants.js";
import { Fork, TxResult, TxSuccess } from "../src/fork.js";
import { graduationSplit, lpFeeSplit } from "../src/fee-model.js";
import { fundedWallet, Migration } from "../src/scenario.js";
import { createStockfloorLaunch, graduate, StockfloorLaunch, trackerAccounts } from "../src/stockfloor-scenario.js";
import {
  burnClaimerBaseIx,
  harvestCurveFeesIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  redeemIx,
} from "../src/stockfloor.js";
import { createAta, getAta, mintSupply, splAta, spyxAta, tokenAccountOwner, tokenAmount } from "../src/token.js";

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const U128 = 1n << 128n;
const u256le = (bytes: number[] | Uint8Array) => BigInt("0x" + (Buffer.from(bytes).reverse().toString("hex") || "0"));
const has = (res: TxSuccess, key: PublicKey) => res.accountKeys.some((k) => k.equals(key));

/** SPL Token / Token-2022 error of a failed instruction, from the runtime error string. */
function tokenErrorCode(res: TxResult): number | null {
  if (res.ok) return null;
  const m = res.error.match(/Custom(?:\((\d+)\)| { code: (\d+) })/);
  return m ? Number(m[1] ?? m[2]) : null;
}
/** Token-2022 `TokenError` codes. */
const TokenError = { OwnerMismatch: 4, NonNativeHasBalance: 11, ImmutableOwner: 34 } as const;

describe("the claimer PDA never holds or controls the vault", () => {
  let fork: Fork;
  let L: StockfloorLaunch;
  let migration: Migration;
  let holders: Keypair[];
  let tracker: FloorTracker;

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    L = await createStockfloorLaunch(fork);
    const g = await graduate(fork, L, [25n, 15n]);
    migration = g.migration;
    holders = [...g.buyers, g.whale];
    fork.warp(60);
    // DAMM v2 trades so that LP fees are pending.
    const trader = fundedWallet(fork, L.threshold);
    const traderBase = createAta(fork, trader, trader.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID);
    const dk = migration.dammKeys;
    fork.send([await dammSwap2Ix({ keys: dk, payer: trader.publicKey, inputTokenAccount: spyxAta(trader.publicKey), outputTokenAccount: traderBase, amount0: L.threshold / 4n, amount1: 0n, swapMode: 0 })], [trader]);
    fork.send([await dammSwap2Ix({ keys: dk, payer: trader.publicKey, inputTokenAccount: traderBase, outputTokenAccount: spyxAta(trader.publicKey), amount0: tokenAmount(fork, traderBase) / 2n, amount1: 0n, swapMode: 0 })], [trader]);
    holders.push(trader);

    tracker = new FloorTracker(fork, trackerAccounts(L));
    tracker.trackBase(L.keys.baseVault, migration.tokenAVault, ...holders.map((h) => splAta(h.publicKey, L.keys.baseMint)));
    tracker.start("graduated, DAMM v2 traded");
  });

  it("every harvest pays its vault part into the vault authority's ATA; the vault authority is not an account of any harvest, the claimer's quote transit ends empty", async () => {
    expect(L.claimer.equals(L.vaultAuthority)).toBe(false);
    expect(L.vault.equals(getAta(L.vaultAuthority, SPYX_MINT, TOKEN_2022_PROGRAM_ID))).toBe(true);
    const claimerQuoteAta = spyxAta(L.claimer);
    expect(claimerQuoteAta.equals(L.claimerQuoteAccount)).toBe(true);
    const T = L.threshold;
    const c = fork.newWallet(1);

    // v3: presale fees to the platform, the migration fee split 5% / 5% / rest, the surplus to the
    // vault (no creator trading share), LP fees split 50 / 20 / 30.
    const expectedCurve = bnToBig(fetchVirtualPool(fork, L.keys.pool).partnerQuoteFee);
    const migrationSplit = graduationSplit(T, T - ceilDiv(T * 40n, 100n));
    const surplus = bnToBig(fetchVirtualPool(fork, L.keys.pool).quoteReserve) - T;
    const expectedSurplus = (surplus * 80n) / 100n;
    const pool = fetchDammPool(fork, migration.dammPool);
    const pos = fetchPosition(fork, migration.firstPosition);
    const liq = bnToBig(pos.unlockedLiquidity) + bnToBig(pos.vestedLiquidity) + bnToBig(pos.permanentLockedLiquidity);
    const expectedLp = bnToBig(pos.feeBPending) + (liq * (u256le(pool.feeBPerLiquidity) - u256le(pos.feeBPerTokenCheckpoint))) / U128;
    expect(expectedCurve > 0n && expectedLp > 0n).toBe(true);

    const lpSplit = lpFeeSplit(expectedLp);
    const harvests: Array<[string, Promise<TransactionInstruction>, { vault: bigint; platform: bigint; creator: bigint }]> = [
      ["harvest_curve_fees", harvestCurveFeesIx({ payer: c.publicKey, keys: L.keys }), { vault: 0n, platform: expectedCurve, creator: 0n }],
      ["harvest_migration_fee", harvestMigrationFeeIx({ keys: L.keys }), migrationSplit],
      ["harvest_surplus", harvestSurplusIx({ keys: L.keys }), { vault: expectedSurplus, platform: 0n, creator: 0n }],
      [
        "harvest_lp_fees",
        harvestLpFeesIx({
          payer: c.publicKey,
          keys: L.keys,
          dammPool: migration.dammPool,
          position: migration.firstPosition,
          positionNftAccount: migration.firstPositionNftAccount,
          dammTokenAVault: migration.tokenAVault,
          dammTokenBVault: migration.tokenBVault,
        }),
        lpSplit,
      ],
    ];
    for (const [label, ix, expected] of harvests) {
      const v0 = tokenAmount(fork, L.vault);
      const res = await tracker.step(label, "no-outflow", async () => fork.send([await ix], [c]), {
        vaultIn: expected.vault,
        platformIn: expected.platform,
        creatorIn: expected.creator,
      });
      expect(tokenAmount(fork, L.vault) - v0, label).toBe(expected.vault);
      expect(has(res, L.claimer), `${label}: the claimer signs the CPI`).toBe(true);
      expect(has(res, L.vaultAuthority), `${label}: the vault authority is not part of the transaction`).toBe(false);
      expect(tokenAccountOwner(fork, L.vault).equals(L.vaultAuthority), label).toBe(true);
      expect(tokenAccountOwner(fork, claimerQuoteAta).equals(L.claimer), label).toBe(true);
      expect(tokenAmount(fork, claimerQuoteAta), `${label}: the claimer's quote transit is empty`).toBe(0n);
      expect(tokenAccountDelegate(fork, claimerQuoteAta), `${label}: transit has no delegate`).toBeNull();
    }
    expect(migrationSplit.platform > 0n && migrationSplit.creator > 0n && lpSplit.platform > 0n).toBe(true);
    // The position NFT, the DBC fee claim and the migration fee claim all belong to the claimer.
    expect(tokenAccountOwner(fork, migration.firstPositionNftAccount).equals(L.claimer)).toBe(true);

    // burn_claimer_base involves the claimer only; redeem involves the vault authority only.
    const burn = fork.send([await burnClaimerBaseIx({ config: L.config, baseMint: L.keys.baseMint })], [c]);
    expect(has(burn, L.claimer) && !has(burn, L.vaultAuthority) && !has(burn, L.vault)).toBe(true);
    const h = holders[0];
    const amount = tokenAmount(fork, splAta(h.publicKey, L.keys.baseMint)) / 4n;
    const V = tokenAmount(fork, L.vault);
    const S = mintSupply(fork, L.keys.baseMint);
    const gross = (V * amount) / S;
    const net = gross - ceilDiv(gross * 200n, 10_000n);
    const res = await tracker.step("redeem", "redeem", async () => fork.send([await redeemIx({ holder: h.publicKey, keys: L.keys, amount })], [h]), {
      vaultOut: net,
      feeRetained: gross - net,
    });
    expect(has(res, L.vaultAuthority) && !has(res, L.claimer)).toBe(true);
  });

  it("a transaction carrying the claimer's signature cannot transfer, burn, approve, set a close authority on, re-own or close the vault", async () => {
    const attacker = fork.newWallet(1);
    const attackerQuote = createAta(fork, attacker, attacker.publicKey, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
    const V = tokenAmount(fork, L.vault);
    expect(V).toBeGreaterThan(0n);
    const claimer = L.claimer;
    const attempts: Array<[string, TransactionInstruction, number]> = [
      ["transfer_checked vault -> attacker", createTransferCheckedInstruction(L.vault, SPYX_MINT, attackerQuote, claimer, V, SPYX_DECIMALS, [], TOKEN_2022_PROGRAM_ID), TokenError.OwnerMismatch],
      ["burn_checked from the vault", createBurnCheckedInstruction(L.vault, SPYX_MINT, claimer, V, SPYX_DECIMALS, [], TOKEN_2022_PROGRAM_ID), TokenError.OwnerMismatch],
      ["approve_checked the attacker as delegate", createApproveCheckedInstruction(L.vault, SPYX_MINT, attacker.publicKey, claimer, V, SPYX_DECIMALS, [], TOKEN_2022_PROGRAM_ID), TokenError.OwnerMismatch],
      ["set close authority to the attacker", createSetAuthorityInstruction(L.vault, claimer, AuthorityType.CloseAccount, attacker.publicKey, [], TOKEN_2022_PROGRAM_ID), TokenError.OwnerMismatch],
      ["set owner to the attacker", createSetAuthorityInstruction(L.vault, claimer, AuthorityType.AccountOwner, attacker.publicKey, [], TOKEN_2022_PROGRAM_ID), TokenError.OwnerMismatch],
      // A non-empty token account cannot be closed by anyone.
      ["close the vault", createCloseAccountInstruction(L.vault, attacker.publicKey, claimer, [], TOKEN_2022_PROGRAM_ID), TokenError.NonNativeHasBalance],
    ];
    const snapshot = () => [tokenAmount(fork, L.vault), tokenAccountOwner(fork, L.vault).toBase58(), tokenAccountDelegate(fork, L.vault), tokenAccountCloseAuthority(fork, L.vault)];
    const before = snapshot();
    for (const [label, ix, code] of attempts) {
      const res = fork.sendTxForgedSigners([ix], [attacker]);
      expect(res.ok, label).toBe(false);
      expect(tokenErrorCode(res), `${label}: ${res.ok ? "" : res.error}`).toBe(code);
      expect(snapshot(), label).toEqual(before);
    }
    expect(tokenAmount(fork, attackerQuote)).toBe(0n);

    // Positive control 1: the forged claimer signature is effective where the claimer has authority:
    // it moves base tokens out of the claimer's own base ATA (a donation, normally burned at once).
    const donor = holders[1];
    const donorBase = splAta(donor.publicKey, L.keys.baseMint);
    fork.send([createTransferInstruction(donorBase, L.claimerBaseAccount, donor.publicKey, 1_000n)], [donor]);
    const attackerBase = createAta(fork, attacker, attacker.publicKey, L.keys.baseMint, TOKEN_PROGRAM_ID);
    const moved = fork.sendTxForgedSigners([createTransferInstruction(L.claimerBaseAccount, attackerBase, claimer, 1_000n, [], TOKEN_PROGRAM_ID)], [attacker]);
    expect(moved.ok).toBe(true);
    expect(tokenAmount(fork, attackerBase)).toBe(1_000n);
    expect(tokenAmount(fork, L.claimerBaseAccount)).toBe(0n);

    // The vault is a Token-2022 ATA with ImmutableOwner: not even the vault authority can re-own it.
    const reown = fork.sendTxForgedSigners(
      [createSetAuthorityInstruction(L.vault, L.vaultAuthority, AuthorityType.AccountOwner, attacker.publicKey, [], TOKEN_2022_PROGRAM_ID)],
      [attacker],
    );
    expect(tokenErrorCode(reown)).toBe(TokenError.ImmutableOwner);

    // Positive control 2: the same forged signature for the vault authority does move vault funds,
    // which is why that key signs nothing but the redeem payout.
    const ctl = fork.sendTxForgedSigners(
      [createTransferCheckedInstruction(L.vault, SPYX_MINT, attackerQuote, L.vaultAuthority, 1n, SPYX_DECIMALS, [], TOKEN_2022_PROGRAM_ID)],
      [attacker],
    );
    expect(ctl.ok).toBe(true);
    expect(tokenAmount(fork, L.vault)).toBe(V - 1n);
    expect(tokenAmount(fork, attackerQuote)).toBe(1n);
    // Signature verification is back on: an unsigned PDA signer is rejected again.
    expect(() => fork.sendTx([createTransferCheckedInstruction(L.vault, SPYX_MINT, attackerQuote, L.vaultAuthority, 1n, SPYX_DECIMALS, [], TOKEN_2022_PROGRAM_ID)], [attacker])).toThrow();
  });

  it("an empty vault (fresh launch, before any harvest) cannot be closed with the claimer's signature; the vault authority's forged signature can (control)", async () => {
    const fresh = await createStockfloorLaunch(fork);
    const attacker = fork.newWallet(1);
    expect(tokenAmount(fork, fresh.vault)).toBe(0n);
    expect(tokenAccountCloseAuthority(fork, fresh.vault)).toBeNull();
    const lamports = fork.lamports(fresh.vault);

    // With a zero balance Token-2022 checks the closing authority (close authority, else owner).
    for (const [label, signer] of [
      ["the claimer", fresh.claimer],
      ["the attacker", attacker.publicKey],
      ["another launch's vault authority", L.vaultAuthority],
    ] as const) {
      const res = fork.sendTxForgedSigners([createCloseAccountInstruction(fresh.vault, attacker.publicKey, signer, [], TOKEN_2022_PROGRAM_ID)], [attacker]);
      expect(res.ok, label).toBe(false);
      expect(tokenErrorCode(res), `${label}: ${res.ok ? "" : res.error}`).toBe(TokenError.OwnerMismatch);
      expect(fork.getAccount(fresh.vault), label).not.toBeNull();
      expect(tokenAccountOwner(fork, fresh.vault).equals(fresh.vaultAuthority), label).toBe(true);
    }

    // Control: the same close signed (forged) by this launch's vault authority succeeds, so the checks
    // above are the owner check itself. That key signs nothing but redeem payouts in the program.
    const before = fork.lamports(attacker.publicKey);
    const ctl = fork.sendTxForgedSigners([createCloseAccountInstruction(fresh.vault, attacker.publicKey, fresh.vaultAuthority, [], TOKEN_2022_PROGRAM_ID)], [attacker]);
    expect(ctl.ok).toBe(true);
    expect(fork.getAccount(fresh.vault)).toBeNull();
    // The rent goes to the destination; the fee payer pays 5,000 lamports per signature (itself + the forged signer).
    expect(fork.lamports(attacker.publicKey) - before).toBe(lamports - 2n * 5_000n);
  });
});
