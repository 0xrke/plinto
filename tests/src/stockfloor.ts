/**
 * StockFloor program helpers for the fork: PDAs, offline instruction builders (from
 * target/idl/stockfloor.json), Launch reader and the `floor` view return data decoder.
 *
 * Account lists follow programs/stockfloor/src/instructions/*.rs. Every builder accepts
 * `overrides` (camelCase account name -> pubkey) so adversarial tests can substitute accounts.
 *
 * The fee-split harvests (`harvest_migration_fee`, `harvest_lp_fees`) need the launch creator's
 * quote ATA. The builders take `creator` explicitly or fall back to the creator recorded by
 * `createLaunchIx` for that config in this process (every test file runs in its own fork).
 */
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { targetProgram } from "./anchor.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DAMM_V2_EVENT_AUTHORITY,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_PROGRAM_ID,
  DBC_EVENT_AUTHORITY,
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  PLATFORM_TREASURY,
  SPYX_MINT,
  STOCKFLOOR_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";
import { DbcPoolKeys } from "./dbc.js";
import { Fork, TxSuccess } from "./fork.js";
import { getAta, splAta } from "./token.js";

export type AccountOverrides = Partial<Record<string, PublicKey>>;

export const stockfloorProgram = (): Program => targetProgram("stockfloor");

export function deriveLaunch(config: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("launch"), config.toBuffer()], STOCKFLOOR_PROGRAM_ID)[0];
}

/**
 * Claimer PDA `["authority", config]`: DBC fee_claimer / leftover_receiver, DAMM v2 position NFT
 * owner, signer of the DBC / DAMM v2 CPIs. No authority over the vault.
 */
export function deriveClaimer(config: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("authority"), config.toBuffer()], STOCKFLOOR_PROGRAM_ID)[0];
}

/** Vault authority PDA `["vault_authority", config]`: owns the vault, signs only redeem payouts. */
export function deriveVaultAuthority(config: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), config.toBuffer()], STOCKFLOOR_PROGRAM_ID)[0];
}

/** Floor vault: ATA(vault authority, quote mint, quote token program). */
export function deriveVault(config: PublicKey, quoteMint = SPYX_MINT, quoteTokenProgram = TOKEN_2022_PROGRAM_ID): PublicKey {
  return getAta(deriveVaultAuthority(config), quoteMint, quoteTokenProgram);
}

/** Claimer base-token ATA (SPL Token): destination of base fees and donations, always burned. */
export function deriveClaimerBaseAccount(config: PublicKey, baseMint: PublicKey): PublicKey {
  return splAta(deriveClaimer(config), baseMint);
}

/** Platform treasury quote ATA: the platform's payee account (shared by every launch). */
export function derivePlatformQuote(quoteMint = SPYX_MINT, quoteTokenProgram = TOKEN_2022_PROGRAM_ID): PublicKey {
  return getAta(PLATFORM_TREASURY, quoteMint, quoteTokenProgram);
}

/** Launch creator quote ATA: the creator's payee account. */
export function deriveCreatorQuote(creator: PublicKey, quoteMint = SPYX_MINT, quoteTokenProgram = TOKEN_2022_PROGRAM_ID): PublicKey {
  return getAta(creator, quoteMint, quoteTokenProgram);
}

/** Claimer quote ATA: the transit account of the v3 fee split (always empty between instructions). */
export function deriveClaimerQuote(config: PublicKey, quoteMint = SPYX_MINT, quoteTokenProgram = TOKEN_2022_PROGRAM_ID): PublicKey {
  return getAta(deriveClaimer(config), quoteMint, quoteTokenProgram);
}

/** Launch creator per config, recorded by createLaunchIx (see the module comment). */
const launchCreators = new Map<string, PublicKey>();

export function recordLaunchCreator(config: PublicKey, creator: PublicKey): void {
  launchCreators.set(config.toBase58(), creator);
}

function creatorOf(config: PublicKey, creator?: PublicKey): PublicKey {
  const c = creator ?? launchCreators.get(config.toBase58());
  if (!c) throw new Error(`no launch creator known for config ${config.toBase58()}: pass \`creator\``);
  return c;
}

/** The three fee-split accounts of harvest_migration_fee / harvest_lp_fees. */
function feeSplitAccounts(k: DbcPoolKeys, creator?: PublicKey) {
  return {
    claimerQuoteAccount: deriveClaimerQuote(k.config, k.quoteMint, k.quoteTokenProgram),
    creatorQuoteAccount: deriveCreatorQuote(creatorOf(k.config, creator), k.quoteMint, k.quoteTokenProgram),
    platformQuoteAccount: derivePlatformQuote(k.quoteMint, k.quoteTokenProgram),
  };
}

const dbcCpiAccounts = {
  dbcPoolAuthority: DBC_POOL_AUTHORITY,
  dbcEventAuthority: DBC_EVENT_AUTHORITY,
  dbcProgram: DBC_PROGRAM_ID,
};

export async function createLaunchIx(a: {
  payer: PublicKey;
  creator: PublicKey;
  config: PublicKey;
  /** Base mint of the launch's DBC pool (committed; the mint may not exist yet). */
  baseMint: PublicKey;
  exitFeeBps: number;
  quoteMint?: PublicKey;
  quoteTokenProgram?: PublicKey;
  overrides?: AccountOverrides;
}): Promise<TransactionInstruction> {
  const quoteMint = a.quoteMint ?? SPYX_MINT;
  const quoteTokenProgram = a.quoteTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  recordLaunchCreator(a.config, a.creator);
  return stockfloorProgram()
    .methods.createLaunch(a.exitFeeBps)
    .accountsStrict({
      payer: a.payer,
      creator: a.creator,
      config: a.config,
      claimer: deriveClaimer(a.config),
      vaultAuthority: deriveVaultAuthority(a.config),
      launch: deriveLaunch(a.config),
      quoteMint,
      baseMint: a.baseMint,
      vault: deriveVault(a.config, quoteMint, quoteTokenProgram),
      quoteTokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      creatorQuoteAccount: deriveCreatorQuote(a.creator, quoteMint, quoteTokenProgram),
      platformTreasury: PLATFORM_TREASURY,
      platformQuoteAccount: derivePlatformQuote(quoteMint, quoteTokenProgram),
      claimerQuoteAccount: deriveClaimerQuote(a.config, quoteMint, quoteTokenProgram),
      ...a.overrides,
    })
    .instruction();
}

/** Permissionless: any fee payer can send it. */
export async function registerPoolIx(a: {
  config: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  overrides?: AccountOverrides;
}): Promise<TransactionInstruction> {
  return stockfloorProgram()
    .methods.registerPool()
    .accountsStrict({
      launch: deriveLaunch(a.config),
      config: a.config,
      pool: a.pool,
      baseMint: a.baseMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      ...a.overrides,
    })
    .instruction();
}

export async function harvestCurveFeesIx(a: {
  payer: PublicKey;
  keys: DbcPoolKeys;
  overrides?: AccountOverrides;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return stockfloorProgram()
    .methods.harvestCurveFees()
    .accountsStrict({
      payer: a.payer,
      launch: deriveLaunch(k.config),
      claimer: deriveClaimer(k.config),
      config: k.config,
      pool: k.pool,
      vault: deriveVault(k.config, k.quoteMint, k.quoteTokenProgram),
      claimerBaseAccount: deriveClaimerBaseAccount(k.config, k.baseMint),
      dbcBaseVault: k.baseVault,
      dbcQuoteVault: k.quoteVault,
      baseMint: k.baseMint,
      quoteMint: k.quoteMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: k.quoteTokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ...dbcCpiAccounts,
      platformQuoteAccount: derivePlatformQuote(k.quoteMint, k.quoteTokenProgram),
      ...a.overrides,
    })
    .instruction();
}

async function harvestQuoteFromDbcIx(
  method: "harvestMigrationFee" | "harvestSurplus",
  a: { keys: DbcPoolKeys; creator?: PublicKey; overrides?: AccountOverrides },
): Promise<TransactionInstruction> {
  const k = a.keys;
  const extra = method === "harvestMigrationFee" ? feeSplitAccounts(k, a.creator) : {};
  return (stockfloorProgram().methods as any)
    [method]()
    .accountsStrict({
      launch: deriveLaunch(k.config),
      claimer: deriveClaimer(k.config),
      config: k.config,
      pool: k.pool,
      vault: deriveVault(k.config, k.quoteMint, k.quoteTokenProgram),
      dbcQuoteVault: k.quoteVault,
      quoteMint: k.quoteMint,
      quoteTokenProgram: k.quoteTokenProgram,
      ...dbcCpiAccounts,
      ...extra,
      ...a.overrides,
    })
    .instruction();
}

/**
 * harvest_migration_fee has no payer: any fee payer can send it (permissionless). `creator` is the
 * launch creator (`launch.creator`); defaults to the one recorded by createLaunchIx.
 */
export const harvestMigrationFeeIx = (a: { keys: DbcPoolKeys; creator?: PublicKey; overrides?: AccountOverrides }) =>
  harvestQuoteFromDbcIx("harvestMigrationFee", a);

export const harvestSurplusIx = (a: { keys: DbcPoolKeys; overrides?: AccountOverrides }) =>
  harvestQuoteFromDbcIx("harvestSurplus", a);

/** Permissionless: latches Launch.migrated once the registered DBC pool migrated (idempotent). No payer account. */
export async function syncMigrationIx(a: { config: PublicKey; pool: PublicKey; overrides?: AccountOverrides }): Promise<TransactionInstruction> {
  return stockfloorProgram()
    .methods.syncMigration()
    .accountsStrict({
      launch: deriveLaunch(a.config),
      pool: a.pool,
      ...a.overrides,
    })
    .instruction();
}

/** Permissionless: burns the claimer's base ATA balance (the ATA must exist). No payer account. */
export async function burnClaimerBaseIx(a: { config: PublicKey; baseMint: PublicKey; overrides?: AccountOverrides }): Promise<TransactionInstruction> {
  return stockfloorProgram()
    .methods.burnClaimerBase()
    .accountsStrict({
      launch: deriveLaunch(a.config),
      claimer: deriveClaimer(a.config),
      claimerBaseAccount: deriveClaimerBaseAccount(a.config, a.baseMint),
      baseMint: a.baseMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      ...a.overrides,
    })
    .instruction();
}

export async function harvestLpFeesIx(a: {
  payer: PublicKey;
  keys: DbcPoolKeys;
  dammPool: PublicKey;
  position: PublicKey;
  positionNftAccount: PublicKey;
  dammTokenAVault: PublicKey;
  dammTokenBVault: PublicKey;
  /** Launch creator (`launch.creator`); defaults to the one recorded by createLaunchIx. */
  creator?: PublicKey;
  overrides?: AccountOverrides;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return stockfloorProgram()
    .methods.harvestLpFees()
    .accountsStrict({
      payer: a.payer,
      launch: deriveLaunch(k.config),
      claimer: deriveClaimer(k.config),
      dammPool: a.dammPool,
      position: a.position,
      positionNftAccount: a.positionNftAccount,
      claimerBaseAccount: deriveClaimerBaseAccount(k.config, k.baseMint),
      vault: deriveVault(k.config, k.quoteMint, k.quoteTokenProgram),
      dammTokenAVault: a.dammTokenAVault,
      dammTokenBVault: a.dammTokenBVault,
      baseMint: k.baseMint,
      quoteMint: k.quoteMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: k.quoteTokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      dammPoolAuthority: DAMM_V2_POOL_AUTHORITY,
      dammEventAuthority: DAMM_V2_EVENT_AUTHORITY,
      dammProgram: DAMM_V2_PROGRAM_ID,
      ...feeSplitAccounts(k, a.creator),
      ...a.overrides,
    })
    .instruction();
}

export async function redeemIx(a: {
  holder: PublicKey;
  keys: DbcPoolKeys;
  amount: bigint;
  overrides?: AccountOverrides;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return stockfloorProgram()
    .methods.redeem(new BN(a.amount.toString()))
    .accountsStrict({
      holder: a.holder,
      launch: deriveLaunch(k.config),
      vaultAuthority: deriveVaultAuthority(k.config),
      pool: k.pool,
      baseMint: k.baseMint,
      holderBaseAccount: getAta(a.holder, k.baseMint, k.baseTokenProgram),
      vault: deriveVault(k.config, k.quoteMint, k.quoteTokenProgram),
      holderQuoteAccount: getAta(a.holder, k.quoteMint, k.quoteTokenProgram),
      quoteMint: k.quoteMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: k.quoteTokenProgram,
      ...a.overrides,
    })
    .instruction();
}

/** View: before register_pool pass any account (e.g. the system program) as `baseMint`. */
export async function floorIx(a: {
  config: PublicKey;
  baseMint: PublicKey;
  overrides?: AccountOverrides;
}): Promise<TransactionInstruction> {
  return stockfloorProgram()
    .methods.floor()
    .accountsStrict({
      launch: deriveLaunch(a.config),
      vault: deriveVault(a.config),
      baseMint: a.baseMint,
      ...a.overrides,
    })
    .instruction();
}

/** Decoded `Launch` account (camelCase fields, BN numbers). */
export function fetchLaunch(fork: Fork, config: PublicKey): any {
  const acc = fork.mustGetAccount(deriveLaunch(config));
  return stockfloorProgram().coder.accounts.decode("launch", acc.data);
}

export interface FloorView {
  vaultRaw: bigint;
  supply: bigint;
  exitFeeBps: number;
  /** Floor per token, Q64.64 raw quote per raw base: `(vault << 64) / supply`, 0 when supply is 0. */
  floorQ64: bigint;
}

/** `FloorInfo { vault_raw: u64, supply: u64, exit_fee_bps: u16, floor_q64: u128 }` from the `floor` return data. */
export function decodeFloorReturn(res: TxSuccess): FloorView {
  const rd = res.meta.returnData();
  const programId = new PublicKey(rd.programId());
  if (!programId.equals(STOCKFLOOR_PROGRAM_ID)) throw new Error(`unexpected return data program ${programId.toBase58()}`);
  const b = Buffer.from(rd.data());
  if (b.length !== 34) throw new Error(`unexpected FloorInfo length ${b.length}`);
  return {
    vaultRaw: b.readBigUInt64LE(0),
    supply: b.readBigUInt64LE(8),
    exitFeeBps: b.readUInt16LE(16),
    floorQ64: b.readBigUInt64LE(18) | (b.readBigUInt64LE(26) << 64n),
  };
}

/** Independent restatement of the on-chain floor per token (Q64.64). */
export const expectedFloorQ64 = (vaultRaw: bigint, supply: bigint): bigint => (supply === 0n ? 0n : (vaultRaw << 64n) / supply);
