import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  LAUNCH_OFFSETS,
  PARTNER_MIGRATION_FEE_MASK,
  QUOTE_ALLOWLIST,
  STOCKFLOOR_PROGRAM_ID,
  SYSVAR_CLOCK,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  WSOL_MINT,
  associatedTokenAddress,
  getMigrationFeeDistribution,
  sqrtPriceX64ToUsd,
  type LaunchState,
} from "@stockfloor/sdk";
import { metadataAddress } from "../chain/metadata";
import { StaticPriceProvider } from "../chain/prices";
import {
  FakeReader,
  NOW,
  SPYX,
  SPYX_MULTIPLIER,
  SPYX_PRICE,
  account,
  encodeClock,
  encodeMetadata,
  encodeMint,
  launchState,
} from "../../test/chainFixtures";
import { ChainDataSource, detectPreset, toLaunchSummary, toUiPhase } from "./chain";
import { launchToJson } from "./serialize";

const prices = new StaticPriceProvider({ [SPYX.mint]: SPYX_PRICE, [USDC_MINT]: 1, [WSOL_MINT]: 210 }, "jupiter");
const price = { usd: SPYX_PRICE, source: "jupiter" as const, at: 1_000 };

describe("toLaunchSummary", () => {
  it("maps a presale launch: addresses, metadata, curve, progress, price and the graduation projection", () => {
    const { state, built } = launchState({ quoteReserve: 40_000_000n });
    const meta = { name: "Harbor Coffee Co-op", symbol: "HRBR", uri: "https://example.com/hrbr.png" };
    const s = toLaunchSummary(state, meta, price)!;

    expect(s.mint).toBe(built.addresses.baseMint.toBase58());
    expect(s.launchAddress).toBe(built.addresses.launch.toBase58());
    expect(s.config).toBe(built.addresses.config.toBase58());
    expect(s.pool).toBe(built.addresses.pool.toBase58());
    expect(s.vault).toBe(built.addresses.vault.toBase58());
    expect(s.dammPool).toBeNull();
    expect([s.name, s.symbol, s.imageUrl]).toEqual(["Harbor Coffee Co-op", "HRBR", "https://example.com/hrbr.png"]);
    expect(s.phase).toBe("presale");
    expect(s.preset).toBe("gentle");
    expect(s.vaultSharePct).toBe(50);
    expect(s.exitFeeBps).toBe(200);
    expect(s.createdAt).toBe(Number(NOW) * 1000);
    expect(s.thresholdQuoteRaw).toBe(built.curve.thresholdQuoteRaw);
    expect(s.quoteReserveRaw).toBe(40_000_000n);
    expect(s.quote).toEqual({ asset: SPYX, priceUsd: SPYX_PRICE, multiplier: SPYX_MULTIPLIER, updatedAt: 1_000, priceSource: "jupiter" });
    expect(s.priceUsd).toBe(sqrtPriceX64ToUsd(state.dbcPool!.sqrtPrice, 6, 8, SPYX_MULTIPLIER, SPYX_PRICE));
    expect(s.priceUsd).toBeCloseTo(built.preview.startPriceUsd, 12);
    // The API's buy label for a presale launch bounds the loss against the estimated floor at graduation.
    expect(launchToJson(s).buyLabel).toMatch(/^Price \$[\d.,]+ · Floor at graduation \(est\.\) \$[\d.,]+ · Max loss if it graduates: −[\d.]+%$/);
    // The projection equals the launch composer's own preview.
    expect(s.projectedAtGraduation).toEqual({
      vaultQuoteRaw: built.preview.vaultAtGraduationQuoteRaw,
      baseSupplyRaw: built.preview.baseSupplyAtGraduationRaw,
    });
    expect(s.migrationFeeHarvested).toBe(false);
    expect(s.quotePaused).toBe(false);
    expect(s.chain).toBe(state);
  });

  it("adds harvested curve fees already in the vault to the projected vault", () => {
    const { state } = launchState({ quoteReserve: 10n });
    const withFees: LaunchState = { ...state, vaultBalance: 481_750n };
    const cfg = state.dbcConfig;
    const { partnerMigrationFee } = getMigrationFeeDistribution(cfg.migrationQuoteThreshold, cfg.migrationFeePercentage, cfg.creatorMigrationFeePercentage);
    expect(toLaunchSummary(withFees, null, price)!.projectedAtGraduation!.vaultQuoteRaw).toBe(481_750n + partnerMigrationFee);
  });

  it("does not add the migration fee again once it was harvested before migration", () => {
    // Crank order: harvest_migration_fee runs on a complete curve, before migrate. The vault then
    // already holds the fee while the SDK phase is still "graduating".
    const { state, built } = launchState({ phase: "graduating" });
    const fee = built.curve.partnerMigrationFee;
    const harvested: LaunchState = {
      ...state,
      vaultBalance: 481_750n + fee,
      launch: { ...state.launch, migrationFeeHarvested: true },
      dbcPool: { ...state.dbcPool!, migrationFeeWithdrawStatus: state.dbcPool!.migrationFeeWithdrawStatus | PARTNER_MIGRATION_FEE_MASK },
    };
    const s = toLaunchSummary(harvested, null, price)!;
    expect(s.phase).toBe("graduating");
    expect(s.projectedAtGraduation).toEqual({ vaultQuoteRaw: 481_750n + fee, baseSupplyRaw: built.preview.baseSupplyAtGraduationRaw });

    // Either signal alone (the Launch flag, or the DBC partner withdraw bit) means the fee left DBC.
    const flagOnly: LaunchState = { ...harvested, dbcPool: state.dbcPool };
    expect(toLaunchSummary(flagOnly, null, price)!.projectedAtGraduation!.vaultQuoteRaw).toBe(481_750n + fee);
    const bitOnly: LaunchState = { ...harvested, launch: state.launch };
    expect(toLaunchSummary(bitOnly, null, price)!.projectedAtGraduation!.vaultQuoteRaw).toBe(481_750n + fee);
  });

  it("maps SDK phases to the three UI phases and keeps the redeemable flag", () => {
    expect(toUiPhase("presale")).toBe("presale");
    expect(toUiPhase("graduating")).toBe("graduating");
    expect(toUiPhase("graduated")).toBe("graduated");
    expect(toUiPhase("redeemable")).toBe("graduated");

    const graduating = toLaunchSummary(launchState({ phase: "graduating" }).state, null, price)!;
    expect(graduating.phase).toBe("graduating");
    expect(graduating.quoteReserveRaw).toBe(graduating.thresholdQuoteRaw);
    expect(graduating.dammPool).toBeNull();

    const migrated = toLaunchSummary(launchState({ phase: "graduated" }).state, null, price)!;
    expect(migrated.phase).toBe("graduated");
    expect(migrated.migrationFeeHarvested).toBe(false);
    expect(migrated.dammPool).not.toBeNull();
    expect(migrated.projectedAtGraduation).toBeNull();

    const { state, built } = launchState({ phase: "redeemable" });
    const redeemable = toLaunchSummary(state, null, price)!;
    expect(redeemable.phase).toBe("graduated");
    expect(redeemable.migrationFeeHarvested).toBe(true);
    expect(redeemable.vaultRaw).toBe(built.curve.partnerMigrationFee);
    expect(redeemable.supplyRaw).toBe(built.curve.baseSupplyAtGraduationRaw);
    const json = launchToJson(redeemable);
    expect(json.redeemable).toBe(true);
    expect(json.chainPhase).toBe("redeemable");
    expect(json.vaultRaw).toBe(built.curve.partnerMigrationFee.toString());
    expect(json.buyLabel).toMatch(/^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: −[\d.]+%$/);
  });

  it("detects the flat preset and a paused quote mint, and falls back when metadata is missing", () => {
    const { state } = launchState({ input: { preset: "flat", vaultSharePct: 70 } });
    const paused: LaunchState = { ...state, quoteMint: { ...state.quoteMint, paused: true } };
    const s = toLaunchSummary(paused, null, undefined)!;
    expect(s.preset).toBe("flat");
    expect(s.vaultSharePct).toBe(70);
    expect(s.quotePaused).toBe(true);
    expect(s.symbol).toBe(s.mint.slice(0, 4).toUpperCase());
    expect(s.name).toBe(`Launch ${s.symbol}`);
    expect(s.imageUrl).toBeNull();
    // No price: USD values are unknown rather than wrong.
    expect(s.priceUsd).toBe(0);
    expect(s.quote.priceSource).toBe("reference");
    expect(detectPreset(0n, 5n)).toBe("gentle");
  });

  it("hides launches the UI cannot show: unlisted quote mint or no pool yet", () => {
    const { state } = launchState();
    const unlisted: LaunchState = { ...state, launch: { ...state.launch, quoteMint: Keypair.generate().publicKey } };
    expect(toLaunchSummary(unlisted, null, price)).toBeNull();
    expect(toLaunchSummary({ ...state, dbcPool: null }, null, price)).toBeNull();
  });
});

function sourceWith(reader: FakeReader, states: LaunchState[], fetchImpl?: (ref: { launch: PublicKey }) => Promise<LaunchState | null>) {
  const listLaunches = vi.fn(async () => states.map((s) => ({ address: s.address, launch: s.launch })));
  const fetchLaunchState = vi.fn(async (_r: unknown, ref: { launch: PublicKey }, _opts?: { includePositions?: boolean }) =>
    fetchImpl ? fetchImpl(ref) : (states.find((s) => s.address.equals(ref.launch)) ?? null),
  );
  const source = new ChainDataSource({
    reader,
    prices,
    sdk: { listLaunches: listLaunches as never, fetchLaunchState: fetchLaunchState as never },
  });
  return { source, listLaunches, fetchLaunchState };
}

describe("ChainDataSource", () => {
  it("lists launches newest first with metadata from Metaplex accounts, skipping unlisted quotes", async () => {
    const older = launchState({ createdAt: NOW - 100n }).state;
    const newer = launchState({ createdAt: NOW, input: { name: "Tidepool", symbol: "TIDE" } }).state;
    const unlisted = launchState().state;
    unlisted.launch = { ...unlisted.launch, quoteMint: Keypair.generate().publicKey };
    const reader = new FakeReader();
    reader.set(metadataAddress(older.launch.baseMint), account(encodeMetadata(older.launch.baseMint, "Older", "OLD", "https://x.test/meta.json"), PublicKey.default));
    reader.set(metadataAddress(newer.launch.baseMint), account(encodeMetadata(newer.launch.baseMint, "Tidepool", "TIDE", ""), PublicKey.default));
    const { source, fetchLaunchState } = sourceWith(reader, [older, unlisted, newer]);

    const list = await source.listLaunches();
    expect(list.map((l) => l.symbol)).toEqual(["TIDE", "OLD"]);
    expect(list[1]!.name).toBe("Older");
    expect(list[1]!.imageUrl).toBeNull(); // a metadata JSON URI is not an image
    // The unlisted launch is filtered before its state is fetched; the list skips positions.
    expect(fetchLaunchState).toHaveBeenCalledTimes(2);
    expect(fetchLaunchState.mock.calls[0]![2]).toEqual({ includePositions: false });

    // Metadata is immutable: the second listing does not read it again.
    const metadataReads = () => reader.calls.filter((c) => c.method === "getMultipleAccountsInfo").length;
    const before = metadataReads();
    await source.listLaunches();
    expect(metadataReads()).toBe(before);
  });

  it("keeps the other launches when one state read fails, and throws when every read fails", async () => {
    const good = launchState().state;
    const bad = launchState().state;
    const reader = new FakeReader();
    const { source } = sourceWith(reader, [good, bad], async (ref) => {
      if (ref.launch.equals(bad.address)) throw new Error("DBC config missing");
      return good;
    });
    expect((await source.listLaunches()).map((l) => l.mint)).toEqual([good.launch.baseMint.toBase58()]);

    const { source: broken } = sourceWith(new FakeReader(), [bad], async () => {
      throw new Error("fetch failed");
    });
    await expect(broken.listLaunches()).rejects.toThrow("fetch failed");
  });

  it("resolves a token page by base mint with a memcmp on the Launch base_mint offset", async () => {
    const { state } = launchState();
    const reader = new FakeReader();
    reader.programAccounts = async (programId, filter) => {
      expect(programId.equals(STOCKFLOOR_PROGRAM_ID)).toBe(true);
      const memcmp = filter!.memcmp!;
      expect(memcmp[1]!.offset).toBe(LAUNCH_OFFSETS.baseMint);
      const wanted = new PublicKey(memcmp[1]!.bytes);
      return wanted.equals(state.launch.baseMint) ? [{ pubkey: state.address, account: account(new Uint8Array(351), STOCKFLOOR_PROGRAM_ID) }] : [];
    };
    const { source, fetchLaunchState } = sourceWith(reader, [state]);

    const found = await source.getLaunch(state.launch.baseMint.toBase58());
    expect(found?.launchAddress).toBe(state.address.toBase58());
    expect(fetchLaunchState.mock.calls[0]![2]).toEqual({ includePositions: true });
    expect(await source.getLaunch(Keypair.generate().publicKey.toBase58())).toBeNull();
    expect(await source.getLaunch("not-a-mint")).toBeNull();

    // The mint → launch mapping is cached.
    const gpa = reader.calls.filter((c) => c.method === "getProgramAccounts").length;
    await source.getLaunch(state.launch.baseMint.toBase58());
    expect(reader.calls.filter((c) => c.method === "getProgramAccounts").length).toBe(gpa);
  });

  it("surfaces RPC failures of a token page as errors, not as 'not found'", async () => {
    const reader = new FakeReader();
    reader.failWith = new Error("429 Too Many Requests");
    const { source } = sourceWith(reader, []);
    await expect(source.getLaunch(Keypair.generate().publicKey.toBase58())).rejects.toThrow("429");
  });

  it("builds quote markets from Jupiter prices and the on-chain ScaledUiAmount multiplier at the cluster clock", async () => {
    const reader = new FakeReader();
    reader.set(SYSVAR_CLOCK, account(encodeClock(1n, NOW), PublicKey.default));
    // SPYx: the new multiplier is already effective at the cluster clock.
    reader.set(new PublicKey(SPYX.mint), account(encodeMint({ supply: 1n, decimals: 8, multiplier: { multiplier: 1.0039, newMultiplier: 1.0057, effectiveAt: NOW - 1n } }), TOKEN_2022_PROGRAM_ID));
    const qqqx = QUOTE_ALLOWLIST.find((a) => a.symbol === "QQQx")!;
    reader.set(new PublicKey(qqqx.mint), account(encodeMint({ supply: 1n, decimals: 8, multiplier: { multiplier: 1.002, newMultiplier: 1.01, effectiveAt: NOW + 1000n } }), TOKEN_2022_PROGRAM_ID));
    const { source } = sourceWith(reader, []);

    const markets = await source.getQuoteMarkets();
    expect(markets.map((m) => m.asset.symbol)).toEqual(QUOTE_ALLOWLIST.map((a) => a.symbol));
    const spyx = markets[0]!;
    expect([spyx.priceUsd, spyx.multiplier, spyx.priceSource]).toEqual([SPYX_PRICE, 1.0057, "jupiter"]);
    expect(markets.find((m) => m.asset.symbol === "QQQx")!.multiplier).toBe(1.002);
    // No price and no mint account: price 0 (unknown), multiplier 1.
    const gldx = markets.find((m) => m.asset.symbol === "GLDx")!;
    expect([gldx.priceUsd, gldx.multiplier]).toEqual([0, 1]);
    expect(await source.getPayTokenPricesUsd()).toEqual({ USDC: 1, SOL: 210 });
  });

  it("reads wallet balances from the associated token account of the mint's token program", async () => {
    const reader = new FakeReader();
    const owner = Keypair.generate().publicKey;
    const base = Keypair.generate().publicKey;
    reader.set(base, account(encodeMint({ supply: 10n, decimals: 6 }), TOKEN_PROGRAM_ID));
    reader.setTokenBalance(owner, base, TOKEN_PROGRAM_ID, associatedTokenAddress(owner, base, TOKEN_PROGRAM_ID), 123_456n);
    reader.set(owner, account(new Uint8Array(0), PublicKey.default, 2_500_000_000));
    const { source } = sourceWith(reader, []);

    expect(await source.getTokenBalance(owner.toBase58(), base.toBase58())).toBe(123_456n);
    expect(await source.getTokenBalance(Keypair.generate().publicKey.toBase58(), base.toBase58())).toBe(0n);
    expect(await source.getTokenBalance(owner.toBase58(), Keypair.generate().publicKey.toBase58())).toBe(0n);
    expect(await source.getSolBalance(owner.toBase58())).toBe(2_500_000_000n);
    expect(await source.getSolBalance(Keypair.generate().publicKey.toBase58())).toBe(0n);
  });
});
