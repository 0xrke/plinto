import { PublicKey } from "@solana/web3.js";
import {
  CURVE_PRESETS,
  LAUNCH_ACCOUNT_SIZE,
  LAUNCH_DISCRIMINATOR,
  LAUNCH_OFFSETS,
  PARTNER_MIGRATION_FEE_MASK,
  QUOTE_ALLOWLIST,
  STOCKFLOOR_PROGRAM_ID,
  SYSVAR_CLOCK,
  USDC_MINT,
  WSOL_MINT,
  associatedTokenAddress,
  decodeClock,
  decodeMint,
  decodeTokenAccount,
  effectiveMintMultiplier,
  fetchLaunchState,
  findQuoteAsset,
  getMigrationFeeDistribution,
  listLaunches,
  sqrtPriceX64ToUsd,
  type ChainReader,
  type CurvePreset,
  type LaunchState,
} from "@stockfloor/sdk";
import { decodeMetaplexMetadata, imageUrlFromUri, metadataAddress, type TokenMetadata } from "../chain/metadata";
import type { PriceProvider, UsdPrice } from "../chain/prices";
import type { LaunchDataSource, LaunchPhase, LaunchSummary, PayToken, QuoteMarket } from "./types";

/** SDK read functions the data source uses (injectable for tests). */
export interface ChainReadFns {
  listLaunches: typeof listLaunches;
  fetchLaunchState: typeof fetchLaunchState;
}

export interface ChainDataSourceDeps {
  reader: ChainReader;
  prices: PriceProvider;
  sdk?: Partial<ChainReadFns>;
}

/** SDK phase → UI phase: the SDK's "graduated" (fee not yet harvested) and "redeemable" are both graduated. */
export function toUiPhase(phase: LaunchState["phase"]): LaunchPhase {
  if (phase === "presale") return "presale";
  if (phase === "graduating") return "graduating";
  return "graduated";
}

/** The curve preset closest to the config's graduation / start price ratio. */
export function detectPreset(sqrtStartPrice: bigint, migrationSqrtPrice: bigint): CurvePreset {
  if (sqrtStartPrice <= 0n) return "gentle";
  const r = Number(migrationSqrtPrice) / Number(sqrtStartPrice);
  const ratio = r * r;
  let best: CurvePreset = "gentle";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const [id, info] of Object.entries(CURVE_PRESETS) as Array<[CurvePreset, (typeof CURVE_PRESETS)[CurvePreset]]>) {
    const target = Number(info.priceRatio.num) / Number(info.priceRatio.den);
    const diff = Math.abs(Math.log(ratio) - Math.log(target));
    if (diff < bestDiff) {
      best = id;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Map one on-chain launch to the UI summary. Returns null for launches the UI does not show: a quote
 * mint outside the allowlist (the allowlist is UI-level) or a DBC pool that does not exist yet.
 */
export function toLaunchSummary(state: LaunchState, meta: TokenMetadata | null, price: UsdPrice | undefined): LaunchSummary | null {
  const quoteMint = state.launch.quoteMint.toBase58();
  const asset = findQuoteAsset(quoteMint);
  if (!asset || asset.mint !== quoteMint) return null;
  if (!state.dbcPool) return null;

  const baseDecimals = state.baseMint?.decimals ?? state.dbcConfig.tokenDecimal;
  const quoteDecimals = state.quoteMint.decimals;
  const multiplier = state.quoteMultiplier;
  const quote: QuoteMarket = {
    asset: { ...asset, decimals: quoteDecimals },
    priceUsd: price?.usd ?? 0,
    multiplier,
    updatedAt: price?.at ?? 0,
    priceSource: price?.source ?? "reference",
  };
  const phase = toUiPhase(state.phase);
  const mint = state.launch.baseMint.toBase58();
  const cfg = state.dbcConfig;

  let projectedAtGraduation: LaunchSummary["projectedAtGraduation"] = null;
  if (phase !== "graduated") {
    const { partnerMigrationFee } = getMigrationFeeDistribution(cfg.migrationQuoteThreshold, cfg.migrationFeePercentage, cfg.creatorMigrationFeePercentage);
    // harvest_migration_fee only needs a complete curve, so it can land before migration. Once the
    // Launch flag or the DBC partner withdraw bit is set, the vault balance already holds the fee.
    const feeStillInDbc =
      !state.launch.migrationFeeHarvested && (state.dbcPool.migrationFeeWithdrawStatus & PARTNER_MIGRATION_FEE_MASK) === 0;
    projectedAtGraduation = {
      // Harvested curve fees already sit in the vault; the partner migration fee joins them.
      vaultQuoteRaw: state.vaultBalance + (feeStillInDbc ? partnerMigrationFee : 0n),
      baseSupplyRaw: cfg.swapBaseAmount + cfg.migrationBaseThreshold,
    };
  }

  const priceUsd =
    state.sqrtPriceX64 !== null && quote.priceUsd > 0
      ? sqrtPriceX64ToUsd(state.sqrtPriceX64, baseDecimals, quoteDecimals, multiplier, quote.priceUsd)
      : 0;

  const fallbackSymbol = mint.slice(0, 4).toUpperCase();
  return {
    mint,
    launchAddress: state.address.toBase58(),
    config: state.launch.config.toBase58(),
    pool: state.keys.pool.toBase58(),
    dammPool: state.migrated ? state.damm.pool.toBase58() : null,
    vault: state.vault.toBase58(),
    name: meta?.name || `Launch ${fallbackSymbol}`,
    symbol: meta?.symbol || fallbackSymbol,
    imageUrl: meta ? imageUrlFromUri(meta.uri) : null,
    creator: state.launch.creator.toBase58(),
    createdAt: Number(state.launch.createdAt) * 1000,
    baseDecimals,
    quote,
    preset: detectPreset(cfg.sqrtStartPrice, cfg.migrationSqrtPrice),
    vaultSharePct: cfg.migrationFeePercentage,
    exitFeeBps: state.launch.exitFeeBps,
    phase,
    thresholdQuoteRaw: cfg.migrationQuoteThreshold,
    quoteReserveRaw: state.dbcPool.quoteReserve,
    priceUsd,
    vaultRaw: state.vaultBalance,
    supplyRaw: state.baseSupply,
    migrationFeeHarvested: state.launch.migrationFeeHarvested,
    quotePaused: state.quoteMint.paused,
    projectedAtGraduation,
    chain: state,
  };
}

function isAllowlisted(quoteMint: PublicKey): boolean {
  return QUOTE_ALLOWLIST.some((a) => a.mint === quoteMint.toBase58());
}

/**
 * Launches from the chain through the SDK: `listLaunches` (getProgramAccounts) and
 * `fetchLaunchState` for each, token metadata from Metaplex, quote prices from a PriceProvider and
 * the ScaledUiAmount multiplier from the quote mint at the cluster clock.
 */
export class ChainDataSource implements LaunchDataSource {
  readonly kind = "chain" as const;
  private readonly reader: ChainReader;
  private readonly prices: PriceProvider;
  private readonly sdk: ChainReadFns;
  /** base mint → Launch address (never changes once created). */
  private readonly launchByMint = new Map<string, PublicKey>();
  /** Metadata is immutable (token update authority Immutable), so it is cached per mint. */
  private readonly metadata = new Map<string, TokenMetadata | null>();
  /** mint → token program. */
  private readonly tokenPrograms = new Map<string, PublicKey>();

  constructor(deps: ChainDataSourceDeps) {
    this.reader = deps.reader;
    this.prices = deps.prices;
    this.sdk = { listLaunches, fetchLaunchState, ...deps.sdk };
  }

  private async loadMetadata(mints: PublicKey[]): Promise<void> {
    const missing = mints.filter((m) => !this.metadata.has(m.toBase58()));
    if (missing.length === 0) return;
    const accounts = await this.reader.getMultipleAccountsInfo(missing.map(metadataAddress));
    missing.forEach((mint, i) => {
      const acc = accounts[i];
      let meta: TokenMetadata | null = null;
      if (acc) {
        try {
          meta = decodeMetaplexMetadata(acc.data);
        } catch {
          meta = null;
        }
      }
      // Only cache hits: the metadata account appears with the pool transaction.
      if (meta) this.metadata.set(mint.toBase58(), meta);
    });
  }

  private async summarize(states: LaunchState[]): Promise<LaunchSummary[]> {
    if (states.length === 0) return [];
    await this.loadMetadata(states.map((s) => s.launch.baseMint));
    const quoteMints = [...new Set(states.map((s) => s.launch.quoteMint.toBase58()))];
    const prices = await this.prices.getUsdPrices(quoteMints);
    const out: LaunchSummary[] = [];
    for (const s of states) {
      const summary = toLaunchSummary(s, this.metadata.get(s.launch.baseMint.toBase58()) ?? null, prices[s.launch.quoteMint.toBase58()]);
      if (summary) out.push(summary);
    }
    return out;
  }

  async listLaunches(): Promise<LaunchSummary[]> {
    const launches = (await this.sdk.listLaunches(this.reader)).filter((l) => isAllowlisted(l.launch.quoteMint));
    for (const l of launches) this.launchByMint.set(l.launch.baseMint.toBase58(), l.address);
    const results = await Promise.allSettled(
      launches.map((l) => this.sdk.fetchLaunchState(this.reader, { launch: l.address }, { includePositions: false })),
    );
    const states: LaunchState[] = [];
    let firstError: unknown = null;
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value) states.push(r.value);
      } else firstError ??= r.reason;
    }
    // One broken launch must not hide the others; a failure of every read is an RPC problem.
    if (states.length === 0 && firstError) throw firstError;
    const summaries = await this.summarize(states);
    return summaries.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Launch address for a base mint: cached, else getProgramAccounts on the Launch base_mint offset. */
  private async resolveLaunch(mint: PublicKey): Promise<PublicKey | null> {
    const key = mint.toBase58();
    const hit = this.launchByMint.get(key);
    if (hit) return hit;
    const found = await this.reader.getProgramAccounts(STOCKFLOOR_PROGRAM_ID, {
      dataSize: LAUNCH_ACCOUNT_SIZE,
      memcmp: [
        { offset: 0, bytes: LAUNCH_DISCRIMINATOR },
        { offset: LAUNCH_OFFSETS.baseMint, bytes: mint.toBytes() },
      ],
    });
    const address = found[0]?.pubkey ?? null;
    if (address) this.launchByMint.set(key, address);
    return address;
  }

  async getLaunch(mint: string): Promise<LaunchSummary | null> {
    let key: PublicKey;
    try {
      key = new PublicKey(mint);
    } catch {
      return null;
    }
    const address = await this.resolveLaunch(key);
    if (!address) return null;
    const state = await this.sdk.fetchLaunchState(this.reader, { launch: address }, { includePositions: true });
    if (!state) return null;
    const [summary] = await this.summarize([state]);
    return summary ?? null;
  }

  async getQuoteMarkets(): Promise<QuoteMarket[]> {
    const mints = QUOTE_ALLOWLIST.map((a) => new PublicKey(a.mint));
    const [accounts, prices] = await Promise.all([
      this.reader.getMultipleAccountsInfo([...mints, SYSVAR_CLOCK]),
      this.prices.getUsdPrices(QUOTE_ALLOWLIST.map((a) => a.mint)),
    ]);
    const clockAcc = accounts[mints.length];
    const now = clockAcc ? decodeClock(clockAcc.data).unixTimestamp : BigInt(Math.floor(Date.now() / 1000));
    return QUOTE_ALLOWLIST.map((asset, i) => {
      const acc = accounts[i];
      let multiplier = 1;
      let decimals = asset.decimals;
      if (acc) {
        const mintInfo = decodeMint(acc.data);
        multiplier = effectiveMintMultiplier(mintInfo, now);
        decimals = mintInfo.decimals;
        this.tokenPrograms.set(asset.mint, acc.owner);
      }
      const price = prices[asset.mint];
      return {
        asset: { ...asset, decimals },
        priceUsd: price?.usd ?? 0,
        multiplier,
        updatedAt: price?.at ?? 0,
        priceSource: price?.source ?? "reference",
      };
    });
  }

  async getPayTokenPricesUsd(): Promise<Record<Exclude<PayToken, "QUOTE">, number>> {
    const prices = await this.prices.getUsdPrices([USDC_MINT, WSOL_MINT]);
    return { USDC: prices[USDC_MINT]?.usd ?? 1, SOL: prices[WSOL_MINT]?.usd ?? 0 };
  }

  private async tokenProgramOf(mint: PublicKey): Promise<PublicKey | null> {
    const key = mint.toBase58();
    const hit = this.tokenPrograms.get(key);
    if (hit) return hit;
    const acc = await this.reader.getAccountInfo(mint);
    if (!acc) return null;
    this.tokenPrograms.set(key, acc.owner);
    return acc.owner;
  }

  async getTokenBalance(owner: string, mint: string): Promise<bigint> {
    const ownerKey = new PublicKey(owner);
    const mintKey = new PublicKey(mint);
    const program = await this.tokenProgramOf(mintKey);
    if (!program) return 0n;
    const acc = await this.reader.getAccountInfo(associatedTokenAddress(ownerKey, mintKey, program));
    return acc ? decodeTokenAccount(acc.data).amount : 0n;
  }

  async getSolBalance(owner: string): Promise<bigint> {
    const acc = await this.reader.getAccountInfo(new PublicKey(owner));
    return acc ? BigInt(acc.lamports) : 0n;
  }
}
