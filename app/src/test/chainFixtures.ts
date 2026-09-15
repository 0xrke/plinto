/**
 * Test fixtures for the chain layer: a realistic `LaunchState` built with the SDK's own launch
 * composer (the DBC config and fresh pool state the program would create), hand-encoded account data
 * (mints, token accounts, Metaplex metadata, clock) and a fake `ChainReader`.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  QUOTE_ALLOWLIST,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  buildLaunchTransactions,
  claimerBaseAccount,
  dammV2PoolPda,
  dbcConstants,
  DAMM_V2_MIGRATION_CONFIGS,
  floorQ64,
  freshDbcState,
  type AccountData,
  type ChainReader,
  type DammV2Pool,
  type KeyedAccount,
  type LaunchInput,
  type LaunchState,
  type MintInfo,
  type ProgramAccountsFilter,
  type SimulationResult,
} from "@stockfloor/sdk";

export const SPYX = QUOTE_ALLOWLIST.find((a) => a.symbol === "SPYx")!;
export const SPYX_PRICE = 757.02;
export const SPYX_MULTIPLIER = 1.005714560286254;
export const NOW = 1_789_500_000n;

export function launchInput(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    name: "Harbor Coffee Co-op",
    symbol: "HRBR",
    uri: "https://example.com/hrbr.png",
    quote: SPYX,
    quotePriceUsd: SPYX_PRICE,
    quoteMultiplier: SPYX_MULTIPLIER,
    preset: "gentle",
    vaultSharePct: 50,
    thresholdUsd: 1000,
    exitFeeBps: 200,
    ...overrides,
  };
}

function mintInfo(supply: bigint, decimals: number, extra: Partial<MintInfo> = {}): MintInfo {
  return {
    mintAuthority: null,
    supply,
    decimals,
    isInitialized: true,
    freezeAuthority: null,
    scaledUiAmount: null,
    paused: false,
    transferHookProgramId: null,
    ...extra,
  };
}

export type FixturePhase = "presale" | "graduating" | "graduated" | "redeemable";

/**
 * A LaunchState in the given phase. Presale: the fresh pool with `quoteReserve` added. Later phases
 * move the reserve to the threshold and set the migration flags; the vault holds the partner fee
 * once "redeemable".
 */
export function launchState(opts: { phase?: FixturePhase; input?: Partial<LaunchInput>; quoteReserve?: bigint; createdAt?: bigint; creator?: PublicKey } = {}) {
  const phase = opts.phase ?? "presale";
  const creator = opts.creator ?? Keypair.generate().publicKey;
  const input = launchInput(opts.input);
  const built = buildLaunchTransactions(input, creator, { nowUnixSeconds: NOW });
  const fresh = freshDbcState(built.dbcParams, built.curve, NOW);
  const a = built.addresses;
  const threshold = built.curve.thresholdQuoteRaw;
  const curveComplete = phase !== "presale";
  const migrated = phase === "graduated" || phase === "redeemable";
  const quoteReserve = curveComplete ? threshold : (opts.quoteReserve ?? 0n);
  const pool = {
    ...fresh.pool,
    config: a.config,
    creator,
    baseMint: a.baseMint,
    baseVault: a.dbcBaseVault,
    quoteVault: a.dbcQuoteVault,
    quoteReserve,
    sqrtPrice: curveComplete ? built.curve.migrationSqrtPrice : fresh.pool.sqrtPrice,
    isMigrated: migrated ? 1 : 0,
    migrationProgress: migrated ? 3 : curveComplete ? 2 : 0,
  };
  const baseSupply = built.curve.baseSupplyAtGraduationRaw;
  const vaultBalance = phase === "redeemable" ? built.curve.partnerMigrationFee : 0n;
  const dammConfig = DAMM_V2_MIGRATION_CONFIGS[fresh.config.migrationFeeOption]!;
  const state: LaunchState = {
    address: a.launch,
    launch: {
      version: 2,
      bump: 255,
      claimerBump: 255,
      vaultAuthorityBump: 255,
      exitFeeBps: built.exitFeeBps,
      migrationFeeHarvested: phase === "redeemable",
      surplusHarvested: phase === "redeemable",
      migrated,
      config: a.config,
      creator,
      pool: a.pool,
      poolRegistered: true,
      baseMint: a.baseMint,
      quoteMint: a.quoteMint,
      quoteTokenProgram: a.quoteTokenProgram,
      vault: a.vault,
      createdAt: opts.createdAt ?? NOW,
      totalHarvestedQuote: vaultBalance,
      totalBurnedBase: 0n,
      totalRedeemedBase: 0n,
      totalRedeemedQuote: 0n,
      totalExitFees: 0n,
    },
    keys: { config: a.config, pool: a.pool, baseMint: a.baseMint, quoteMint: a.quoteMint, quoteTokenProgram: a.quoteTokenProgram },
    claimer: a.claimer,
    vaultAuthority: a.vaultAuthority,
    vault: a.vault,
    claimerBaseAccount: claimerBaseAccount(a.config, a.baseMint),
    dbcConfig: fresh.config,
    dbcPool: pool,
    baseMint: mintInfo(baseSupply, 6),
    quoteMint: mintInfo(9_523_220_691_233n, 8, { paused: false }),
    vaultBalance,
    claimerBaseBalance: null,
    baseSupply,
    clock: { slot: 447_000_000n, unixTimestamp: NOW },
    dbcCurrentPoint: NOW,
    quoteMultiplier: SPYX_MULTIPLIER,
    curveComplete,
    migrated,
    phase,
    progress: { quoteReserve, threshold, fraction: threshold > 0n ? Number((quoteReserve * 1_000_000n) / threshold) / 1_000_000 : 0 },
    damm: { pool: dammV2PoolPda(dammConfig, a.baseMint, a.quoteMint), config: dammConfig, state: null },
    positions: [],
    partnerSurplus: 0n,
    floor: { vaultRaw: vaultBalance, supply: baseSupply, exitFeeBps: built.exitFeeBps, floorQ64: floorQ64(vaultBalance, baseSupply) },
    sqrtPriceX64: pool.sqrtPrice,
  };
  return { state, built, input, creator };
}

/**
 * A migrated launch with a full-range DAMM v2 pool (1% flat fee, quote-only fees) at the launch's
 * sqrt price holding about `quoteReserveRaw` of the quote asset, for exact market quotes.
 */
export function withDammPool(state: LaunchState, quoteReserveRaw: bigint): LaunchState {
  const sqrtPrice = state.sqrtPriceX64!;
  const sqrtMinPrice = dbcConstants.MIN_SQRT_PRICE;
  const feeData = new Uint8Array(32);
  new DataView(feeData.buffer).setBigUint64(0, 10_000_000n, true); // cliff fee numerator: 1% of 1e9
  const pool = {
    poolFees: { baseFee: { baseFeeInfo: { data: Array.from(feeData) } }, protocolFeePercent: 20, referralFeePercent: 20, compoundingFeeBps: 0, dynamicFee: { initialized: 0 }, initSqrtPrice: sqrtPrice },
    liquidity: (quoteReserveRaw << 128n) / (sqrtPrice - sqrtMinPrice),
    sqrtMinPrice,
    sqrtMaxPrice: dbcConstants.MAX_SQRT_PRICE,
    sqrtPrice,
    activationPoint: 0n,
    activationType: 1,
    poolStatus: 0,
    collectFeeMode: 1,
    feeVersion: 1,
  } as unknown as DammV2Pool;
  return { ...state, damm: { ...state.damm, state: pool } };
}

// ---------------------------------------------------------------- account encoders

function u64(view: DataView, offset: number, v: bigint) {
  view.setBigUint64(offset, v, true);
}

/** SPL / Token-2022 mint (82 bytes, or 166+ with a ScaledUiAmount extension). */
export function encodeMint(opts: { supply: bigint; decimals: number; multiplier?: { multiplier: number; newMultiplier: number; effectiveAt: bigint } }): Uint8Array {
  const size = opts.multiplier ? 166 + 4 + 56 : 82;
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  u64(view, 36, opts.supply);
  data[44] = opts.decimals;
  data[45] = 1;
  if (opts.multiplier) {
    data[165] = 1; // AccountType::Mint
    view.setUint16(166, 25, true); // ScaledUiAmountConfig
    view.setUint16(168, 56, true);
    view.setFloat64(170 + 32, opts.multiplier.multiplier, true);
    view.setBigInt64(170 + 40, opts.multiplier.effectiveAt, true);
    view.setFloat64(170 + 48, opts.multiplier.newMultiplier, true);
  }
  return data;
}

export function encodeTokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint): Uint8Array {
  const data = new Uint8Array(165);
  data.set(mint.toBytes(), 0);
  data.set(owner.toBytes(), 32);
  u64(new DataView(data.buffer), 64, amount);
  data[108] = 1;
  return data;
}

function borshString(s: string, padTo: number): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + padTo);
  new DataView(out.buffer).setUint32(0, padTo, true);
  out.set(bytes, 4);
  return out;
}

/** Metaplex MetadataV1 with Metaplex-style NUL padding (name 32, symbol 10, uri 200). */
export function encodeMetadata(mint: PublicKey, name: string, symbol: string, uri: string): Uint8Array {
  const parts = [Uint8Array.of(4), new Uint8Array(32), mint.toBytes(), borshString(name, 32), borshString(symbol, 10), borshString(uri, 200), new Uint8Array(40)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function encodeClock(slot: bigint, unixTimestamp: bigint): Uint8Array {
  const data = new Uint8Array(40);
  const view = new DataView(data.buffer);
  u64(view, 0, slot);
  view.setBigInt64(32, unixTimestamp, true);
  return data;
}

export function account(data: Uint8Array, owner: PublicKey, lamports = 1_000_000): AccountData {
  return { data, owner, lamports, executable: false };
}

// ---------------------------------------------------------------- fake reader

export class FakeReader implements ChainReader {
  readonly accounts = new Map<string, AccountData>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  programAccounts: (programId: PublicKey, filter?: ProgramAccountsFilter) => Promise<KeyedAccount[]> = async () => [];
  failWith: Error | null = null;

  set(key: PublicKey, acc: AccountData | null): this {
    if (acc) this.accounts.set(key.toBase58(), acc);
    else this.accounts.delete(key.toBase58());
    return this;
  }

  setTokenBalance(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey, ata: PublicKey, amount: bigint): this {
    return this.set(ata, account(encodeTokenAccount(mint, owner, amount), tokenProgram));
  }

  private check(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    if (this.failWith) throw this.failWith;
  }

  async getAccountInfo(pubkey: PublicKey) {
    this.check("getAccountInfo", [pubkey]);
    return this.accounts.get(pubkey.toBase58()) ?? null;
  }

  async getMultipleAccountsInfo(pubkeys: PublicKey[]) {
    this.check("getMultipleAccountsInfo", [pubkeys]);
    return pubkeys.map((k) => this.accounts.get(k.toBase58()) ?? null);
  }

  async getProgramAccounts(programId: PublicKey, filter?: ProgramAccountsFilter) {
    this.check("getProgramAccounts", [programId, filter]);
    return this.programAccounts(programId, filter);
  }

  async getTokenAccountsByOwner() {
    this.check("getTokenAccountsByOwner", []);
    return [];
  }

  async simulate(): Promise<SimulationResult> {
    this.check("simulate", []);
    return { ok: true, logs: [] };
  }
}

export { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };
