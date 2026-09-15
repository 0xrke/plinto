/**
 * Read side: fetch a launch with every account the UI and the crank need, derive its phase and
 * progress, list launches, discover claimer-owned DAMM v2 positions and read the floor view.
 */
import { PublicKey } from "@solana/web3.js";
import {
  DAMM_V2_MIGRATION_CONFIGS,
  TOKEN_2022_PROGRAM_ID,
  claimerBaseAccount,
  dammV2PoolPda,
  dammV2PositionNftAccountPda,
  dammV2PositionPda,
  dbcPoolPda,
} from "./addresses";
import { base64ToBytes } from "./bytes";
import { TransactionFailedError, anchorErrorFromLogs, returnDataFromLogs, type ChainReader } from "./chain";
import {
  decodeDbcPoolConfig,
  decodeDbcVirtualPool,
  dbcPartnerSurplus,
  type DbcPoolConfig,
  type DbcVirtualPool,
} from "./dbc/accounts";
import { decodeDammV2Pool, decodeDammV2Position, pendingPositionFees, type DammV2Pool, type DammV2Position } from "./damm/accounts";
import { floorPerTokenUsd, maxLossFraction, rawToUi, redeemQuote, sqrtPriceX64ToUsd } from "./math";
import { authorityPda, launchPda, STOCKFLOOR_PROGRAM_ID, vaultAuthorityPda } from "./pda";
import {
  decodeFloorInfo,
  decodeLaunch,
  floorQ64,
  isLaunchAccountData,
  LAUNCH_ACCOUNT_SIZE,
  LAUNCH_DISCRIMINATOR,
  LAUNCH_OFFSETS,
  type FloorInfo,
  type LaunchAccount,
} from "./stockfloor/accounts";
import { floorIx, type LaunchKeys } from "./stockfloor/instructions";
import { decodeClock, decodeMint, decodeTokenAccount, effectiveMintMultiplier, SYSVAR_CLOCK, type MintInfo } from "./token";

/**
 * - presale: the bonding curve is live (quote reserve below the migration threshold).
 * - graduating: the curve is complete; DBC migration to DAMM v2 is pending.
 * - graduated: migrated to DAMM v2; the migration fee is not harvested into the vault yet.
 * - redeemable: migrated and the migration fee is in the vault; `redeem` is open.
 */
export type LaunchPhase = "presale" | "graduating" | "graduated" | "redeemable";

export interface ClaimerPosition {
  dammPool: PublicKey;
  position: PublicKey;
  positionNftMint: PublicKey;
  positionNftAccount: PublicKey;
  state: DammV2Position;
  /** Fees claim_position_fee would pay now: a = base (burned), b = quote (to the vault). */
  pending: { a: bigint; b: bigint };
}

export interface LaunchState {
  address: PublicKey;
  launch: LaunchAccount;
  keys: LaunchKeys;
  claimer: PublicKey;
  vaultAuthority: PublicKey;
  vault: PublicKey;
  claimerBaseAccount: PublicKey;
  dbcConfig: DbcPoolConfig;
  /** Null until the DBC pool exists (the second launch transaction). */
  dbcPool: DbcVirtualPool | null;
  baseMint: MintInfo | null;
  quoteMint: MintInfo;
  vaultBalance: bigint;
  /** Null when the claimer base ATA does not exist. */
  claimerBaseBalance: bigint | null;
  baseSupply: bigint;
  clock: { slot: bigint; unixTimestamp: bigint };
  /** Unix timestamp or slot, matching the DBC config activation type. */
  dbcCurrentPoint: bigint;
  /** Effective ScaledUiAmount multiplier of the quote mint at the cluster clock. */
  quoteMultiplier: number;
  curveComplete: boolean;
  /** DBC pool migrated (or the program latch set). */
  migrated: boolean;
  phase: LaunchPhase;
  progress: { quoteReserve: bigint; threshold: bigint; /** 0..1 */ fraction: number };
  /** DAMM v2 pool DBC migrates into (derived; `state` null until migration). */
  damm: { pool: PublicKey; config: PublicKey; state: DammV2Pool | null };
  /** Claimer-held DAMM v2 positions (loaded when migrated and `includePositions` is not false). */
  positions: ClaimerPosition[];
  /** Partner surplus harvest_surplus would move now. */
  partnerSurplus: bigint;
  /** Floor from the vault balance and base supply (the same numbers the floor view returns). */
  floor: FloorInfo;
  /** Current sqrt price (DBC curve before migration, DAMM v2 pool after). */
  sqrtPriceX64: bigint | null;
}

export type LaunchRef = { launch: PublicKey } | { config: PublicKey } | { baseMint: PublicKey };

/** More than one Launch account could be the launch of a base mint (see `resolveLaunchByBaseMint`). */
export class AmbiguousLaunchError extends Error {
  constructor(
    readonly baseMint: PublicKey,
    readonly candidates: PublicKey[],
  ) {
    super(`${candidates.length} StockFloor launches commit base mint ${baseMint.toBase58()} and none of them owns its DBC pool yet`);
    this.name = "AmbiguousLaunchError";
  }
}

export interface BaseMintLaunchMatch {
  address: PublicKey;
  launch: LaunchAccount;
  /**
   * True when this launch owns the base mint's DBC pool: the pool is registered, or the canonical
   * pool `dbcPoolPda(launch.config, baseMint, quoteMint)` exists and belongs to the launch config.
   * A base mint has exactly one DBC pool, so at most one launch can be canonical. False only for the
   * single launch of a mint whose pool does not exist yet (between the two launch transactions);
   * do not cache such a result.
   */
  canonical: boolean;
}

/**
 * The launch of a base mint. `create_launch` accepts any base mint, so anyone can create extra
 * pool-less Launch accounts that commit the mint of an existing launch, and getProgramAccounts
 * returns matches in no guaranteed order. Only the launch that owns the mint's DBC pool is returned
 * when one does; with no such launch, a single match is returned as not canonical and several
 * matches throw `AmbiguousLaunchError`. Returns null when no Launch commits the mint.
 */
export async function resolveLaunchByBaseMint(reader: ChainReader, baseMint: PublicKey): Promise<BaseMintLaunchMatch | null> {
  const found = await reader.getProgramAccounts(STOCKFLOOR_PROGRAM_ID, {
    dataSize: LAUNCH_ACCOUNT_SIZE,
    memcmp: [
      { offset: 0, bytes: LAUNCH_DISCRIMINATOR },
      { offset: LAUNCH_OFFSETS.baseMint, bytes: baseMint.toBytes() },
    ],
  });
  const candidates = found
    .filter((a) => a.account.owner.equals(STOCKFLOOR_PROGRAM_ID) && isLaunchAccountData(a.account.data))
    .map((a) => ({ address: a.pubkey, launch: decodeLaunch(a.account.data) }))
    .filter((c) => c.launch.baseMint.equals(baseMint));
  if (candidates.length === 0) return null;

  const pools = candidates.map((c) => dbcPoolPda(c.launch.config, baseMint, c.launch.quoteMint));
  const registered = candidates.filter((c, i) => c.launch.poolRegistered && c.launch.pool.equals(pools[i]!));
  let canonical = registered;
  if (canonical.length === 0) {
    const accounts = await reader.getMultipleAccountsInfo(pools);
    canonical = candidates.filter((c, i) => {
      const acc = accounts[i];
      if (!acc) return false;
      try {
        const pool = decodeDbcVirtualPool(acc);
        return pool.config.equals(c.launch.config) && pool.baseMint.equals(baseMint);
      } catch {
        return false;
      }
    });
  }
  if (canonical.length > 1) throw new AmbiguousLaunchError(baseMint, canonical.map((c) => c.address));
  if (canonical.length === 1) return { ...canonical[0]!, canonical: true };
  if (candidates.length > 1) throw new AmbiguousLaunchError(baseMint, candidates.map((c) => c.address));
  return { ...candidates[0]!, canonical: false };
}

/** Launch PDA for a reference; `baseMint` needs a getProgramAccounts lookup (`resolveLaunchByBaseMint`). */
export async function resolveLaunchAddress(reader: ChainReader, ref: LaunchRef): Promise<PublicKey> {
  if ("launch" in ref) return ref.launch;
  if ("config" in ref) return launchPda(ref.config)[0];
  const match = await resolveLaunchByBaseMint(reader, ref.baseMint);
  if (!match) throw new Error(`no StockFloor launch for base mint ${ref.baseMint.toBase58()}`);
  return match.address;
}

export async function getLaunch(reader: ChainReader, ref: LaunchRef): Promise<{ address: PublicKey; launch: LaunchAccount } | null> {
  let address: PublicKey;
  try {
    address = await resolveLaunchAddress(reader, ref);
  } catch (e) {
    if (e instanceof AmbiguousLaunchError) throw e;
    return null;
  }
  const acc = await reader.getAccountInfo(address);
  if (!acc || !acc.owner.equals(STOCKFLOOR_PROGRAM_ID) || !isLaunchAccountData(acc.data)) return null;
  return { address, launch: decodeLaunch(acc.data) };
}

/** Every StockFloor Launch (getProgramAccounts with the discriminator and size filter), newest first. */
export async function listLaunches(reader: ChainReader): Promise<Array<{ address: PublicKey; launch: LaunchAccount }>> {
  const accounts = await reader.getProgramAccounts(STOCKFLOOR_PROGRAM_ID, {
    dataSize: LAUNCH_ACCOUNT_SIZE,
    memcmp: [{ offset: 0, bytes: LAUNCH_DISCRIMINATOR }],
  });
  return accounts
    .filter((a) => isLaunchAccountData(a.account.data))
    .map((a) => ({ address: a.pubkey, launch: decodeLaunch(a.account.data) }))
    .sort((x, y) => (x.launch.createdAt === y.launch.createdAt ? 0 : x.launch.createdAt > y.launch.createdAt ? -1 : 1));
}

export function derivePhase(a: { curveComplete: boolean; migrated: boolean; migrationFeeHarvested: boolean }): LaunchPhase {
  if (!a.curveComplete) return "presale";
  if (!a.migrated) return "graduating";
  return a.migrationFeeHarvested ? "redeemable" : "graduated";
}

/** quote_reserve / threshold as a number in [0, 1] (ppm precision). */
export function curveProgress(quoteReserve: bigint, threshold: bigint): number {
  if (threshold <= 0n) return 0;
  if (quoteReserve >= threshold) return 1;
  return Number((quoteReserve * 1_000_000n) / threshold) / 1_000_000;
}

export interface FetchLaunchStateOptions {
  /** Load claimer DAMM v2 positions and pending fees after migration (default true). */
  includePositions?: boolean;
}

/** Fetch and derive the full state of one launch. Returns null when the Launch does not exist. */
export async function fetchLaunchState(reader: ChainReader, ref: LaunchRef, opts: FetchLaunchStateOptions = {}): Promise<LaunchState | null> {
  const found = await getLaunch(reader, ref);
  if (!found) return null;
  const { address, launch } = found;
  const config = launch.config;
  const pool = launch.poolRegistered ? launch.pool : dbcPoolPda(config, launch.baseMint, launch.quoteMint);
  const keys: LaunchKeys = { config, pool, baseMint: launch.baseMint, quoteMint: launch.quoteMint, quoteTokenProgram: launch.quoteTokenProgram };
  const claimer = authorityPda(config)[0];
  const vaultAuthority = vaultAuthorityPda(config)[0];
  const claimerBase = claimerBaseAccount(config, launch.baseMint);

  const [configAcc, poolAcc, baseMintAcc, quoteMintAcc, vaultAcc, claimerBaseAcc, clockAcc] = await reader.getMultipleAccountsInfo([
    config,
    pool,
    launch.baseMint,
    launch.quoteMint,
    launch.vault,
    claimerBase,
    SYSVAR_CLOCK,
  ]);
  if (!configAcc) throw new Error(`DBC config ${config.toBase58()} of launch ${address.toBase58()} does not exist`);
  if (!quoteMintAcc) throw new Error(`quote mint ${launch.quoteMint.toBase58()} does not exist`);
  if (!clockAcc) throw new Error("Clock sysvar not available");
  const dbcConfig = decodeDbcPoolConfig(configAcc);
  const dbcPool = poolAcc ? decodeDbcVirtualPool(poolAcc) : null;
  const baseMint = baseMintAcc ? decodeMint(baseMintAcc.data) : null;
  const quoteMint = decodeMint(quoteMintAcc.data);
  const vaultBalance = vaultAcc ? decodeTokenAccount(vaultAcc.data).amount : 0n;
  const claimerBaseBalance = claimerBaseAcc ? decodeTokenAccount(claimerBaseAcc.data).amount : null;
  const clock = decodeClock(clockAcc.data);
  const dbcCurrentPoint = dbcConfig.activationType === 0 ? clock.slot : clock.unixTimestamp;

  const threshold = dbcConfig.migrationQuoteThreshold;
  const quoteReserve = dbcPool?.quoteReserve ?? 0n;
  const curveComplete = dbcPool !== null && quoteReserve >= threshold;
  const migrated = launch.migrated || (dbcPool !== null && dbcPool.isMigrated === 1);
  const phase = derivePhase({ curveComplete, migrated, migrationFeeHarvested: launch.migrationFeeHarvested });

  const dammConfig = DAMM_V2_MIGRATION_CONFIGS[dbcConfig.migrationFeeOption];
  if (!dammConfig) throw new Error(`unsupported DBC migration fee option ${dbcConfig.migrationFeeOption}`);
  const dammPoolAddress = dammV2PoolPda(dammConfig, launch.baseMint, launch.quoteMint);
  let dammState: DammV2Pool | null = null;
  let positions: ClaimerPosition[] = [];
  if (migrated) {
    const dammAcc = await reader.getAccountInfo(dammPoolAddress);
    dammState = dammAcc ? decodeDammV2Pool(dammAcc) : null;
    if (opts.includePositions !== false) {
      positions = await findClaimerPositions(reader, { claimer, baseMint: launch.baseMint, quoteMint: launch.quoteMint });
    }
  }

  const baseSupply = baseMint?.supply ?? 0n;
  return {
    address,
    launch,
    keys,
    claimer,
    vaultAuthority,
    vault: launch.vault,
    claimerBaseAccount: claimerBase,
    dbcConfig,
    dbcPool,
    baseMint,
    quoteMint,
    vaultBalance,
    claimerBaseBalance,
    baseSupply,
    clock,
    dbcCurrentPoint,
    quoteMultiplier: effectiveMintMultiplier(quoteMint, clock.unixTimestamp),
    curveComplete,
    migrated,
    phase,
    progress: { quoteReserve, threshold, fraction: curveProgress(quoteReserve, threshold) },
    damm: { pool: dammPoolAddress, config: dammConfig, state: dammState },
    positions,
    partnerSurplus: dbcPool && launch.poolRegistered && dbcPool.isPartnerWithdrawSurplus === 0 ? dbcPartnerSurplus(dbcConfig, dbcPool) : 0n,
    floor: {
      vaultRaw: vaultBalance,
      supply: launch.poolRegistered ? baseSupply : 0n,
      exitFeeBps: launch.exitFeeBps,
      floorQ64: launch.poolRegistered ? floorQ64(vaultBalance, baseSupply) : 0n,
    },
    sqrtPriceX64: migrated && dammState ? dammState.sqrtPrice : (dbcPool?.sqrtPrice ?? null),
  };
}

/**
 * DAMM v2 positions whose NFT is held by the claimer, on any DAMM v2 pool with the launch mints
 * (what harvest_lp_fees accepts), with their pending fees.
 *
 * The NFT may sit in any Token-2022 account the claimer owns: the DAMM v2 position NFT account PDA
 * (positions created with the claimer as owner, including the migrated one) or the claimer's ATA
 * (a position NFT transferred to it). A candidate counts only when its amount is 1 and the DAMM v2
 * position derived from the mint exists, decodes and names that mint as its `nft_mint`.
 */
export async function findClaimerPositions(
  reader: ChainReader,
  a: { claimer: PublicKey; baseMint: PublicKey; quoteMint: PublicKey },
): Promise<ClaimerPosition[]> {
  const tokenAccounts = await reader.getTokenAccountsByOwner(a.claimer, TOKEN_2022_PROGRAM_ID);
  const byMint = new Map<string, { pubkey: PublicKey; info: ReturnType<typeof decodeTokenAccount> }>();
  for (const t of tokenAccounts) {
    let info: ReturnType<typeof decodeTokenAccount>;
    try {
      info = decodeTokenAccount(t.account.data);
    } catch {
      continue;
    }
    if (info.amount !== 1n || !info.owner.equals(a.claimer)) continue;
    const key = info.mint.toBase58();
    // A 1-supply NFT cannot sit in two accounts with amount 1; prefer the canonical NFT account if it ever did.
    const prev = byMint.get(key);
    if (!prev || t.pubkey.equals(dammV2PositionNftAccountPda(info.mint))) byMint.set(key, { pubkey: t.pubkey, info });
  }
  const nfts = [...byMint.values()];
  if (nfts.length === 0) return [];
  const positionKeys = nfts.map((n) => dammV2PositionPda(n.info.mint));
  const positionAccs = await reader.getMultipleAccountsInfo(positionKeys);
  const decoded: Array<{ nft: (typeof nfts)[number]; position: PublicKey; state: DammV2Position }> = [];
  positionAccs.forEach((acc, i) => {
    if (!acc) return;
    try {
      const state = decodeDammV2Position(acc);
      if (state.nftMint.equals(nfts[i]!.info.mint)) decoded.push({ nft: nfts[i]!, position: positionKeys[i]!, state });
    } catch {
      // not a DAMM v2 position
    }
  });
  const poolKeys = [...new Map(decoded.map((d) => [d.state.pool.toBase58(), d.state.pool])).values()];
  const poolAccs = await reader.getMultipleAccountsInfo(poolKeys);
  const pools = new Map<string, DammV2Pool>();
  poolAccs.forEach((acc, i) => {
    if (!acc) return;
    try {
      const p = decodeDammV2Pool(acc);
      if (p.tokenAMint.equals(a.baseMint) && p.tokenBMint.equals(a.quoteMint)) pools.set(poolKeys[i]!.toBase58(), p);
    } catch {
      // not a pool
    }
  });
  const out: ClaimerPosition[] = [];
  for (const d of decoded) {
    const pool = pools.get(d.state.pool.toBase58());
    if (!pool) continue;
    out.push({
      dammPool: d.state.pool,
      position: d.position,
      positionNftMint: d.nft.info.mint,
      positionNftAccount: d.nft.pubkey,
      state: d.state,
      pending: pendingPositionFees(pool, d.state),
    });
  }
  return out;
}

/**
 * The on-chain `floor` view via simulation (return data). `feePayer` must be an existing funded
 * account on the cluster (it does not sign); the DBC pool authority is used when omitted.
 */
export async function getFloor(
  reader: ChainReader,
  launch: Pick<LaunchAccount, "config" | "quoteMint" | "quoteTokenProgram" | "baseMint" | "poolRegistered">,
  feePayer?: PublicKey,
): Promise<FloorInfo> {
  const payer = feePayer ?? new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
  const res = await reader.simulate(
    [floorIx({ config: launch.config, quoteMint: launch.quoteMint, quoteTokenProgram: launch.quoteTokenProgram, baseMint: launch.poolRegistered ? launch.baseMint : null })],
    payer,
  );
  if (!res.ok) {
    const e = anchorErrorFromLogs(res.logs);
    throw new TransactionFailedError(`floor view failed: ${res.error ?? "unknown"}`, res.logs, e?.name ?? null, e?.code ?? null, "floor");
  }
  let data = res.returnData && res.returnData.programId.equals(STOCKFLOOR_PROGRAM_ID) ? res.returnData.data : null;
  if (!data) {
    const fromLogs = returnDataFromLogs(res.logs);
    if (fromLogs && fromLogs.programId === STOCKFLOOR_PROGRAM_ID.toBase58()) data = base64ToBytes(fromLogs.base64);
  }
  if (!data) throw new Error("floor view returned no data");
  return decodeFloorInfo(data);
}

/** Display metrics for the UI from a state and the quote market (Jupiter usdPrice per UI token). */
export function launchMetrics(
  state: LaunchState,
  market: { quotePriceUsd: number; quoteMultiplier?: number },
  baseDecimals = 6,
): {
  priceUsd: number | null;
  floorUsd: number;
  maxLossIfBuyNow: number | null;
  vaultUi: number;
  vaultUsd: number;
  supplyUi: number;
} {
  const m = market.quoteMultiplier ?? state.quoteMultiplier;
  const qd = state.quoteMint.decimals;
  const priceUsd = state.sqrtPriceX64 === null ? null : sqrtPriceX64ToUsd(state.sqrtPriceX64, baseDecimals, qd, m, market.quotePriceUsd);
  const floorUsd = state.floor.supply > 0n ? floorPerTokenUsd(state.vaultBalance, state.baseSupply, baseDecimals, qd, m, market.quotePriceUsd) : 0;
  const vaultUi = rawToUi(state.vaultBalance, qd, m);
  return {
    priceUsd,
    floorUsd,
    maxLossIfBuyNow: priceUsd === null ? null : maxLossFraction(priceUsd, floorUsd),
    vaultUi,
    vaultUsd: vaultUi * market.quotePriceUsd,
    supplyUi: rawToUi(state.baseSupply, baseDecimals),
  };
}

export interface RedeemPreview {
  gross: bigint;
  fee: bigint;
  net: bigint;
  /** Why redeem would fail now, null when it can succeed (balance not checked). */
  blockedReason: string | null;
}

/** Preview `redeem(amount)` on the current state with the on-chain formula. */
export function previewRedeem(state: LaunchState, amount: bigint): RedeemPreview {
  let blockedReason: string | null = null;
  if (state.phase !== "redeemable") blockedReason = `redeem opens after migration and the migration-fee harvest (phase: ${state.phase})`;
  if (amount <= 0n) blockedReason = "amount must be positive";
  if (amount > state.baseSupply) blockedReason = "amount exceeds the base supply";
  if (state.quoteMint.paused) blockedReason = "the quote asset is paused by its issuer";
  if (state.baseSupply === 0n || amount <= 0n || amount > state.baseSupply) return { gross: 0n, fee: 0n, net: 0n, blockedReason };
  const q = redeemQuote(state.vaultBalance, state.baseSupply, amount, state.launch.exitFeeBps);
  if (!blockedReason && q.net === 0n) blockedReason = "the redemption would pay nothing (NothingToRedeem)";
  return { ...q, blockedReason };
}
