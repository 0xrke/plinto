/**
 * The SDK launch builder against the real DBC 0.2.1 binary, the real stockfloor program and SPYx on
 * the fork, for every curve preset and vault share the product offers (not only gentle / 50% as in
 * c1-lifecycle):
 *
 * - DBC create_config accepts `buildDbcConfigParams`, and the SDK port `validateDbcConfigParams`
 *   plus `computeLaunchCurve` predict exactly what DBC stores (migration sqrt price, swap base
 *   amount, migration base threshold, start price, threshold) and the initial base supply;
 * - stockfloor create_launch / register_pool accept the config (it is StockFloor-shaped);
 * - after graduation the vault receives exactly `previewLaunch().vaultAtGraduationQuoteRaw`, DAMM v2
 *   receives the predicted quote, and the supply is within 1,000 raw below the preview.
 *
 * It also cross-checks the port's negative codes: configs the port rejects are sent to the real
 * DBC create_config, which must fail with the same PoolError name.
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  authorityPda,
  buildDbcConfigParams,
  computeLaunchCurve,
  DbcConfigValidationError,
  DEFAULT_QUOTE_ASSET,
  type CurvePreset,
  type LaunchInput,
  previewLaunch,
  validateDbcConfigParams,
  VAULT_SHARE_MAX_PCT,
  VAULT_SHARE_MIN_PCT,
} from "@stockfloor/sdk";
import { describe, expect, it } from "vitest";
import { DBC_TOKEN_BADGE_SPYX } from "../src/constants.js";
import { fetchDammPool } from "../src/damm.js";
import { bnToBig, createConfigIx, fetchPoolConfig } from "../src/dbc.js";
import { anchorErrorFromLogs, Fork } from "../src/fork.js";
import { graduationSplit } from "../src/fee-model.js";
import { createStockfloorLaunch, graduate, SPYX_USD_PRICE, spyxMultiplier } from "../src/stockfloor-scenario.js";
import { fetchLaunch, harvestMigrationFeeIx } from "../src/stockfloor.js";
import { mintSupply, tokenAmount } from "../src/token.js";

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

describe("SDK presets x vault shares on the real DBC and stockfloor programs", () => {
  const presets: CurvePreset[] = ["gentle", "flat"];
  const shares = [VAULT_SHARE_MIN_PCT, 50, VAULT_SHARE_MAX_PCT];

  for (const preset of presets) {
    for (const share of shares) {
      it(`${preset} / ${share}%: DBC stores what the SDK port predicts; the vault gets the preview amount at graduation`, async () => {
        const fork = Fork.create({ stockfloor: true, spike: false });
        // The SDK's own parameters, unpinned: this is the acceptance test of the SDK v3 presets
        // (migration fee = vault share + 10, 25 bps presale fee, no creator trading share).
        const L = await createStockfloorLaunch(fork, { preset, vaultSharePct: share, rawSdkParams: true });
        const built = buildDbcConfigParams(L.input, L.claimer, L.claimer);
        const port = validateDbcConfigParams(built, { leftoverReceiver: L.claimer });
        const curve = computeLaunchCurve(L.input);
        const preview = previewLaunch(L.input);

        const cfg = fetchPoolConfig(fork, L.config);
        expect(bnToBig(cfg.migrationQuoteThreshold)).toBe(curve.thresholdQuoteRaw);
        expect(cfg.migrationFeePercentage).toBe(share + 10);
        expect(cfg.creatorTradingFeePercentage).toBe(0);
        expect(bnToBig(cfg.poolFees.baseFee.cliffFeeNumerator)).toBe(2_500_000n);
        expect(bnToBig(cfg.sqrtStartPrice)).toBe(curve.sqrtStartPrice);
        expect(bnToBig(cfg.migrationSqrtPrice)).toBe(port.migrationSqrtPrice);
        expect(bnToBig(cfg.swapBaseAmount)).toBe(port.swapBaseAmount);
        expect(bnToBig(cfg.migrationBaseThreshold)).toBe(port.migrationBaseThreshold);
        expect(port.migrationSqrtPrice).toBe(curve.migrationSqrtPrice);
        expect(port.swapBaseAmount).toBe(curve.swapBaseAmount);
        expect(port.migrationBaseThreshold).toBe(curve.migrationBaseAmount);
        expect(mintSupply(fork, L.keys.baseMint)).toBe(port.initialBaseSupply);
        expect(fetchLaunch(fork, L.config).pool.equals(L.keys.pool)).toBe(true);

        const { migration } = await graduate(fork, L, [20n, 15n]);
        const [platform0, creator0] = [tokenAmount(fork, L.platformQuoteAccount), tokenAmount(fork, L.creatorQuoteAccount)];
        fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
        // The SDK preview predicts every payout of the graduation split.
        expect(tokenAmount(fork, L.platformQuoteAccount) - platform0).toBe(preview.platformGraduationFeeQuoteRaw);
        expect(tokenAmount(fork, L.creatorQuoteAccount) - creator0).toBe(preview.creatorGraduationBonusQuoteRaw);
        expect(tokenAmount(fork, L.claimerQuoteAccount)).toBe(0n);
        expect(preview.poolSharePct).toBe(90 - share);
        const T = curve.thresholdQuoteRaw;
        const partnerFee = T - ceilDiv(T * BigInt(90 - share), 100n);
        expect(tokenAmount(fork, L.vault)).toBe(preview.vaultAtGraduationQuoteRaw);
        expect(preview.vaultAtGraduationQuoteRaw).toBe(graduationSplit(T, partnerFee).vault);
        expect(port.partnerMigrationFee).toBe(partnerFee);
        const q = curve.migrationQuoteAmount;
        expect(bnToBig(fetchDammPool(fork, migration.dammPool).tokenBAmount)).toBe(q - (q * 20n) / 10_000n);
        const diff = preview.baseSupplyAtGraduationRaw - mintSupply(fork, L.keys.baseMint);
        expect(diff >= 0n && diff <= 1_000n, `preview supply - actual = ${diff}`).toBe(true);
      });
    }
  }
});

describe("SDK validateDbcConfigParams negative codes match the real DBC create_config errors", () => {
  const cases: Array<[string, (p: any) => void]> = [
    ["activation type 2", (p) => (p.activationType = 2)],
    ["curve base fee 0.1% (below the 0.25% minimum)", (p) => (p.poolFees.baseFee.cliffFeeNumerator = new BN(1_000_000))],
    ["creator trading fee 101%", (p) => (p.creatorTradingFeePercentage = 101)],
    ["migration fee 100%", (p) => (p.migrationFee.feePercentage = 100)],
    ["collect fee mode 2", (p) => (p.collectFeeMode = 2)],
    ["DAMM v1 migration option", (p) => (p.migrationOption = 0)],
    ["creator update and mint authority on a non-transfer-hook config", (p) => (p.tokenUpdateAuthority = 3)],
    ["token decimals 5", (p) => (p.tokenDecimal = 5)],
    ["liquidity percentages sum to 50", (p) => (p.partnerPermanentLockedLiquidityPercentage = 50)],
    [
      "5% locked at day 1",
      (p) => {
        p.partnerPermanentLockedLiquidityPercentage = 5;
        p.partnerLiquidityPercentage = 95;
      },
    ],
    ["migration quote threshold 0", (p) => (p.migrationQuoteThreshold = new BN(0))],
    ["pool creation fee 1 lamport", (p) => (p.poolCreationFee = new BN(1))],
    ["start price equal to the first curve point", (p) => (p.sqrtStartPrice = p.curve[0].sqrtPrice)],
    [
      "fixed supply with post > pre",
      (p) => (p.tokenSupply = { preMigrationTokenSupply: new BN("2000000000000000"), postMigrationTokenSupply: new BN("2000000000000001") }),
    ],
    ["migrated pool fee 5 bps", (p) => (p.migratedPoolFee.poolFeeBps = 5)],
  ];

  it("each mutated SDK config fails in the port and on-chain with the same PoolError name", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const partner = fork.newWallet();
    const rows: Array<{ case: string; port: string; dbc: string }> = [];
    for (const [label, mutate] of cases) {
      const configKp = Keypair.generate();
      const authority = authorityPda(configKp.publicKey)[0];
      const input: LaunchInput = {
        name: "Neg",
        symbol: "NEG",
        uri: "https://example.com/neg.json",
        quote: DEFAULT_QUOTE_ASSET,
        quotePriceUsd: SPYX_USD_PRICE,
        quoteMultiplier: spyxMultiplier(fork),
        preset: "gentle",
        vaultSharePct: 50,
      };
      const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams(input, authority, authority);
      mutate(params);
      let portCode = "ACCEPTED";
      try {
        validateDbcConfigParams(params as never, { leftoverReceiver });
      } catch (e) {
        if (!(e instanceof DbcConfigValidationError)) throw e;
        portCode = e.code;
      }
      const res = fork.sendTx(
        [await createConfigIx({ config: configKp.publicKey, feeClaimer, leftoverReceiver, quoteMint, payer: partner.publicKey, params: params as never, tokenBadge: DBC_TOKEN_BADGE_SPYX })],
        [partner, configKp],
      );
      const dbcCode = res.ok ? "ACCEPTED" : (anchorErrorFromLogs(res.logs)?.name ?? res.error);
      rows.push({ case: label, port: portCode, dbc: dbcCode });
    }
    console.log(JSON.stringify(rows, null, 2));
    for (const r of rows) {
      expect(r.port, r.case).not.toBe("ACCEPTED");
      expect(r.dbc, r.case).toBe(r.port);
    }
  });
});
