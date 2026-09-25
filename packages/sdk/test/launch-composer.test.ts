/**
 * buildLaunchTransactions: order, signers, compute unit limits, and the 1232-byte limit across
 * presets, vault shares, maximum-size metadata, first buys and priority fees. Plus the fresh-pool
 * reconstruction used to quote the creator's first buy.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorityPda,
  buildLaunchTransactions,
  computeBudgetInstructions,
  computeLaunchCurve,
  dbcPoolPda,
  DbcTradeDirection,
  DbcSwapMode,
  DEFAULT_QUOTE_ASSET,
  dbcTokenBadgePda,
  freshDbcState,
  launchPda,
  LaunchInputError,
  legacyTransactionSize,
  PACKET_DATA_SIZE,
  quoteDbcSwap,
  QUOTE_ALLOWLIST,
  STOCKFLOOR_PROGRAM_ID,
  DBC_PROGRAM_ID,
  vaultAddress,
  TOKEN_2022_PROGRAM_ID,
  validateDbcConfigParams,
  type LaunchInput,
  associatedTokenAddress,
  CU_LIMITS,
  PLATFORM_TREASURY,
} from "../src";

const base: LaunchInput = {
  name: "Floor Launch",
  symbol: "FLOOR",
  uri: "https://example.com/floor.json",
  quote: DEFAULT_QUOTE_ASSET,
  quotePriceUsd: 757.02,
  quoteMultiplier: 1.005714560286254,
  preset: "gentle",
  vaultSharePct: 50,
  thresholdUsd: 1000,
};

describe("buildLaunchTransactions", () => {
  it("builds tx1 (create_config + create_launch) and tx2 (pool + register_pool) with the right signers and accounts", () => {
    const creator = Keypair.generate().publicKey;
    const b = buildLaunchTransactions(base, creator);
    expect(b.transactions.map((t) => t.label)).toEqual(["create_config+create_launch", "create_pool+register_pool"]);
    const [tx1, tx2] = b.transactions;
    expect(tx1!.signers.map((s) => s.publicKey.toBase58())).toEqual([b.configKeypair.publicKey.toBase58()]);
    expect(tx2!.signers.map((s) => s.publicKey.toBase58())).toEqual([b.baseMintKeypair.publicKey.toBase58()]);
    expect(tx1!.instructions.map((i) => i.programId.toBase58())).toEqual([DBC_PROGRAM_ID.toBase58(), STOCKFLOOR_PROGRAM_ID.toBase58()]);
    expect(tx2!.instructions.map((i) => i.programId.toBase58())).toEqual([DBC_PROGRAM_ID.toBase58(), STOCKFLOOR_PROGRAM_ID.toBase58()]);
    expect(tx1!.computeUnitLimit).toBe(250_000);
    expect(tx2!.computeUnitLimit).toBe(170_000);
    const a = b.addresses;
    expect(a.claimer.equals(authorityPda(a.config)[0])).toBe(true);
    expect(a.launch.equals(launchPda(a.config)[0])).toBe(true);
    expect(a.vault.equals(vaultAddress(a.config, new PublicKey(DEFAULT_QUOTE_ASSET.mint), TOKEN_2022_PROGRAM_ID))).toBe(true);
    expect(a.pool.equals(dbcPoolPda(a.config, a.baseMint, a.quoteMint))).toBe(true);
    expect(a.tokenBadge!.equals(dbcTokenBadgePda(a.quoteMint)[0])).toBe(true);
    expect(b.dbcParams.feeClaimer.equals(a.claimer) && b.dbcParams.leftoverReceiver.equals(a.claimer)).toBe(true);
    expect(b.exitFeeBps).toBe(200);
    expect(b.preview.thresholdQuoteRaw).toBe(b.curve.thresholdQuoteRaw);
    // The payer signs create_config (config payer) and create_launch (payer and creator).
    const createLaunch = tx1!.instructions[1]!;
    expect(createLaunch.keys[0]!.pubkey.equals(creator) && createLaunch.keys[1]!.pubkey.equals(creator)).toBe(true);
    expect(createLaunch.keys[2]!.pubkey.equals(a.config) && createLaunch.keys[2]!.isSigner).toBe(true);
    // create_launch creates the creator, platform and transit quote ATAs (init_if_needed).
    const quote = (owner: PublicKey) => associatedTokenAddress(owner, a.quoteMint, a.quoteTokenProgram).toBase58();
    expect(createLaunch.keys.slice(12).map((k) => [k.pubkey.toBase58(), k.isWritable])).toEqual([
      [quote(creator), true],
      [PLATFORM_TREASURY.toBase58(), false],
      [quote(PLATFORM_TREASURY), true],
      [quote(a.claimer), true],
    ]);
    expect(tx1!.size).toBeLessThanOrEqual(PACKET_DATA_SIZE);
  });

  it("CU_LIMITS follow the production limits of the fork compute budget test", () => {
    const src = readFileSync(join(__dirname, "..", "..", "..", "tests", "integration", "compute-budget.test.ts"), "utf8");
    const limit = (step: string) => {
      const m = new RegExp(`"${step.replace(/[()+]/g, (c) => `\\${c}`)}":\\s*([0-9_]+)`).exec(src);
      if (!m) throw new Error(`no fork limit for ${step}`);
      return Number(m[1]!.replace(/_/g, ""));
    };
    expect(CU_LIMITS.createLaunch).toBe(limit("stockfloor create_launch"));
    expect(CU_LIMITS.registerPool).toBe(limit("stockfloor register_pool"));
    expect(CU_LIMITS.harvestCurveFeesCreatesAta).toBe(limit("stockfloor harvest_curve_fees (creates the claimer base ATA)"));
    expect(CU_LIMITS.harvestCurveFees).toBe(limit("stockfloor harvest_curve_fees"));
    expect(CU_LIMITS.harvestMigrationFee).toBe(limit("stockfloor harvest_migration_fee"));
    expect(CU_LIMITS.harvestSurplus).toBe(limit("stockfloor harvest_surplus"));
    expect(CU_LIMITS.syncMigration).toBe(limit("stockfloor sync_migration"));
    expect(CU_LIMITS.harvestLpFees).toBe(limit("stockfloor harvest_lp_fees"));
    expect(CU_LIMITS.redeem).toBe(limit("stockfloor redeem"));
    expect(CU_LIMITS.floor).toBe(limit("stockfloor floor (view)"));
    expect(CU_LIMITS.dbcCreateConfig).toBe(limit("DBC create_config"));
    expect(CU_LIMITS.dbcMigrationDammV2).toBe(limit("DBC migration_damm_v2"));
  });

  it("every transaction fits 1232 bytes for all quotes, presets, shares, max metadata, first buys and priority fees", () => {
    fc.assert(
      fc.property(
        fc.record({
          quote: fc.constantFrom(...QUOTE_ALLOWLIST),
          preset: fc.constantFrom("gentle" as const, "flat" as const),
          share: fc.integer({ min: 30, max: 60 }),
          nameLen: fc.integer({ min: 1, max: 32 }),
          symbolLen: fc.integer({ min: 1, max: 10 }),
          uriLen: fc.integer({ min: 0, max: 200 }),
          firstBuy: fc.boolean(),
          price: fc.option(fc.integer({ min: 1, max: 5_000_000 }), { nil: undefined }),
          payerIsCreator: fc.boolean(),
        }),
        (r) => {
          const input: LaunchInput = { ...base, quote: r.quote, preset: r.preset, vaultSharePct: r.share, name: "N".repeat(r.nameLen), symbol: "S".repeat(r.symbolLen), uri: "u".repeat(r.uriLen) };
          const creator = Keypair.generate().publicKey;
          const b = buildLaunchTransactions(input, creator, {
            payer: r.payerIsCreator ? undefined : Keypair.generate().publicKey,
            firstBuy: r.firstBuy ? { quoteAmount: 1_000_000n } : undefined,
            computeUnitPriceMicroLamports: r.price,
          });
          expect(b.transactions.length).toBeGreaterThanOrEqual(2);
          expect(b.transactions.length).toBeLessThanOrEqual(r.firstBuy ? 3 : 2);
          const payer = r.payerIsCreator ? creator : (b.transactions[0]!.instructions[0]!.keys[4]!.pubkey as PublicKey);
          for (const t of b.transactions) {
            const withBudget = [...computeBudgetInstructions({ computeUnitLimit: t.computeUnitLimit, computeUnitPriceMicroLamports: r.price }), ...t.instructions];
            expect(legacyTransactionSize(withBudget, payer)).toBe(t.size);
            expect(t.size).toBeLessThanOrEqual(PACKET_DATA_SIZE);
          }
        },
      ),
      { numRuns: 60, seed: 20260916 },
    );
  });

  it("moves the first buy into a third transaction only when it does not fit the pool transaction", () => {
    const creator = Keypair.generate().publicKey;
    const small = buildLaunchTransactions(base, creator, { firstBuy: { quoteAmount: 1_000_000n } });
    expect(small.transactions.map((t) => t.label)).toEqual(["create_config+create_launch", "create_pool+register_pool+first_buy"]);
    const big = buildLaunchTransactions({ ...base, name: "N".repeat(32), symbol: "S".repeat(10), uri: "u".repeat(200) }, creator, {
      payer: Keypair.generate().publicKey,
      firstBuy: { quoteAmount: 1_000_000n },
      computeUnitPriceMicroLamports: 1_000,
    });
    expect(big.transactions.map((t) => t.label)).toEqual(["create_config+create_launch", "create_pool+register_pool", "first_buy"]);
    expect(big.transactions[2]!.signers).toEqual([]);
  });

  it("the first buy quote is taken on the reconstructed fresh pool; a crossing first buy uses PartialFill", () => {
    const creator = Keypair.generate().publicKey;
    const b = buildLaunchTransactions(base, creator, { firstBuy: { quoteAmount: 10_000_000n, slippageBps: 0 } });
    const q = b.firstBuyQuote!;
    expect(q.includedFeeInputAmount).toBe(10_000_000n);
    const swap = b.transactions[1]!.instructions[3]!;
    const data = swap.data;
    expect(data[24]).toBe(DbcSwapMode.ExactIn);
    expect(new DataView(data.buffer, data.byteOffset).getBigUint64(16, true)).toBe(q.outputAmount);
    const huge = buildLaunchTransactions(base, creator, { firstBuy: { quoteAmount: b.curve.thresholdQuoteRaw * 3n } });
    expect(huge.firstBuyQuote!.amountLeft).toBeGreaterThan(0n);
    const hugeSwap = huge.transactions.at(-1)!.instructions.at(-1)!;
    expect(hugeSwap.data[24]).toBe(DbcSwapMode.PartialFill);

    const fresh = freshDbcState(b.dbcParams, computeLaunchCurve(base), 5n);
    const v = validateDbcConfigParams(b.dbcParams);
    expect(fresh.pool.baseReserve).toBe(v.initialBaseSupply);
    expect(fresh.config.migrationSqrtPrice).toBe(v.migrationSqrtPrice);
    expect(fresh.pool.sqrtPrice).toBe(b.curve.sqrtStartPrice);
    expect(fresh.config.curve.length).toBe(20);
    expect(quoteDbcSwap({ config: fresh.config, pool: fresh.pool, direction: DbcTradeDirection.QuoteToBase, mode: DbcSwapMode.ExactIn, amount: 10_000_000n, currentPoint: 5n })).toEqual(q);
  });

  it("rejects invalid metadata and launch inputs before building anything", () => {
    const creator = Keypair.generate().publicKey;
    expect(() => buildLaunchTransactions({ ...base, name: "N".repeat(33) }, creator)).toThrow(LaunchInputError);
    expect(() => buildLaunchTransactions({ ...base, symbol: "" }, creator)).toThrow(/symbol is required/);
    expect(() => buildLaunchTransactions({ ...base, vaultSharePct: 80 }, creator)).toThrow(LaunchInputError);
    expect(() => buildLaunchTransactions(base, creator, { exitFeeBps: 600 })).toThrow(/exitFeeBps/);
  });
});
