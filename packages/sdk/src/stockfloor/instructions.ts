/**
 * StockFloor instruction builders. Account metas follow target/idl/stockfloor.json in program
 * order (test/stockfloor-instructions.test.ts compares every builder with the IDL: names, order,
 * signer and writable flags, fixed addresses and PDA seeds). Instruction data is the IDL
 * discriminator plus Borsh arguments.
 */
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DAMM_V2_EVENT_AUTHORITY,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_PROGRAM_ID,
  DBC_EVENT_AUTHORITY,
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  PLATFORM_TREASURY,
  associatedTokenAddress,
  claimerBaseAccount,
  claimerQuoteAccount,
  creatorQuoteAccount,
  platformQuoteAccount,
  dammV2TokenVaultPda,
  dbcTokenVaultPda,
} from "../addresses";
import { writeU64 } from "../bytes";
import { idlInstruction, STOCKFLOOR_IDL } from "../idl";
import { authorityPda, launchPda, STOCKFLOOR_PROGRAM_ID, vaultAddress, vaultAuthorityPda } from "../pda";
import type { LaunchAccount } from "./accounts";

const U64_MAX = (1n << 64n) - 1n;

/** The keys every launch-bound instruction derives its accounts from. */
export interface LaunchKeys {
  config: PublicKey;
  /** Canonical DBC pool (`dbcPoolPda(config, baseMint, quoteMint)`). */
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  /** Token program of the quote mint (Token-2022 for xStocks). */
  quoteTokenProgram: PublicKey;
  /**
   * The launch creator (`launch.creator`), whose quote ATA is the creator payee of
   * harvest_migration_fee and harvest_lp_fees. Filled by `launchKeysFromAccount`.
   */
  creator?: PublicKey;
}

export function launchKeysFromAccount(launch: LaunchAccount, pool?: PublicKey): LaunchKeys {
  const p = pool ?? (launch.poolRegistered ? launch.pool : null);
  if (!p) throw new Error("launch has no registered pool; pass the DBC pool explicitly");
  return {
    config: launch.config,
    pool: p,
    baseMint: launch.baseMint,
    quoteMint: launch.quoteMint,
    quoteTokenProgram: launch.quoteTokenProgram,
    creator: launch.creator,
  };
}

/** The launch creator for the fee-split harvests: the explicit argument, else `keys.creator`. */
function launchCreator(k: LaunchKeys, creator: PublicKey | undefined, name: string): PublicKey {
  const c = creator ?? k.creator;
  if (!c) throw new Error(`${name}: pass the launch creator (launch.creator) as \`creator\` or in \`keys.creator\``);
  return c;
}

/**
 * The three fee-split accounts appended to harvest_migration_fee and harvest_lp_fees, in program
 * order: the transit (claimer quote ATA), the creator's quote ATA and the platform's quote ATA.
 * The program checks each address, so the creator must be `launch.creator` (not `pool.creator`).
 */
function feeSplitAccounts(k: LaunchKeys, creator: PublicKey): AccountMeta[] {
  return [
    w(claimerQuoteAccount(k.config, k.quoteMint, k.quoteTokenProgram)),
    w(creatorQuoteAccount(creator, k.quoteMint, k.quoteTokenProgram)),
    w(platformQuoteAccount(k.quoteMint, k.quoteTokenProgram)),
  ];
}

function discriminator(name: string): Uint8Array {
  return Uint8Array.from(idlInstruction(STOCKFLOOR_IDL, name).discriminator);
}

function data(name: string, ...args: Uint8Array[]): Uint8Array {
  const parts = [discriminator(name), ...args];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const u16 = (v: number) => {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new RangeError(`u16 out of range: ${v}`);
  return Uint8Array.from([v & 0xff, (v >> 8) & 0xff]);
};
const u64 = (v: bigint) => {
  if (v < 0n || v > U64_MAX) throw new RangeError(`u64 out of range: ${v}`);
  return writeU64(v);
};

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

function ix(keys: AccountMeta[], bytes: Uint8Array): TransactionInstruction {
  return new TransactionInstruction({ programId: STOCKFLOOR_PROGRAM_ID, keys, data: bytes as never });
}

// ------------------------------------------------------------------ create_launch

/**
 * create_launch also creates (init_if_needed, paid by `payer`) the creator's quote ATA, the
 * platform treasury's quote ATA and the claimer's quote ATA (the fee-split transit), so no harvest
 * ever needs a payer for them.
 */
export interface CreateLaunchIxArgs {
  payer: PublicKey;
  creator: PublicKey;
  /** The DBC config keypair's public key (it must sign). */
  config: PublicKey;
  /** Base mint keypair public key committed for the launch's DBC pool. */
  baseMint: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram?: PublicKey;
  exitFeeBps: number;
}

export function createLaunchIx(a: CreateLaunchIxArgs): TransactionInstruction {
  const quoteTokenProgram = a.quoteTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  return ix(
    [
      w(a.payer, true),
      r(a.creator, true),
      r(a.config, true),
      r(authorityPda(a.config)[0]),
      r(vaultAuthorityPda(a.config)[0]),
      w(launchPda(a.config)[0]),
      r(a.quoteMint),
      r(a.baseMint),
      w(vaultAddress(a.config, a.quoteMint, quoteTokenProgram)),
      r(quoteTokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      w(creatorQuoteAccount(a.creator, a.quoteMint, quoteTokenProgram)),
      r(PLATFORM_TREASURY),
      w(platformQuoteAccount(a.quoteMint, quoteTokenProgram)),
      w(claimerQuoteAccount(a.config, a.quoteMint, quoteTokenProgram)),
    ],
    data("create_launch", u16(a.exitFeeBps)),
  );
}

// ------------------------------------------------------------------ register_pool (permissionless)

export function registerPoolIx(a: { config: PublicKey; pool: PublicKey; baseMint: PublicKey }): TransactionInstruction {
  return ix(
    [w(launchPda(a.config)[0]), r(a.config), r(a.pool), r(a.baseMint), r(TOKEN_PROGRAM_ID)],
    data("register_pool"),
  );
}

// ------------------------------------------------------------------ harvests (permissionless)

/**
 * v3: the partner curve fees go straight from DBC to the platform treasury's quote ATA (the vault
 * is not touched); v2: into the vault. Base fees are burned either way.
 */
export function harvestCurveFeesIx(a: { payer: PublicKey; keys: LaunchKeys }): TransactionInstruction {
  const k = a.keys;
  return ix(
    [
      w(a.payer, true),
      w(launchPda(k.config)[0]),
      r(authorityPda(k.config)[0]),
      r(k.config),
      w(k.pool),
      w(vaultAddress(k.config, k.quoteMint, k.quoteTokenProgram)),
      w(claimerBaseAccount(k.config, k.baseMint)),
      w(dbcTokenVaultPda(k.pool, k.baseMint)),
      w(dbcTokenVaultPda(k.pool, k.quoteMint)),
      w(k.baseMint),
      r(k.quoteMint),
      r(TOKEN_PROGRAM_ID),
      r(k.quoteTokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      r(DBC_POOL_AUTHORITY),
      r(DBC_EVENT_AUTHORITY),
      r(DBC_PROGRAM_ID),
      w(platformQuoteAccount(k.quoteMint, k.quoteTokenProgram)),
    ],
    data("harvest_curve_fees"),
  );
}

function harvestDbcQuoteKeys(k: LaunchKeys): AccountMeta[] {
  return [
    w(launchPda(k.config)[0]),
    r(authorityPda(k.config)[0]),
    r(k.config),
    w(k.pool),
    w(vaultAddress(k.config, k.quoteMint, k.quoteTokenProgram)),
    w(dbcTokenVaultPda(k.pool, k.quoteMint)),
    r(k.quoteMint),
    r(k.quoteTokenProgram),
    r(DBC_POOL_AUTHORITY),
    r(DBC_EVENT_AUTHORITY),
    r(DBC_PROGRAM_ID),
  ];
}

/**
 * No payer account: any fee payer can send it. v3 splits the partner migration fee through the
 * transit: platform 5% of the threshold, creator 5% of the threshold, the rest to the vault
 * (`graduationSplit`); v2 pays it all into the vault. `creator` defaults to `keys.creator`.
 */
export function harvestMigrationFeeIx(a: { keys: LaunchKeys; creator?: PublicKey }): TransactionInstruction {
  const creator = launchCreator(a.keys, a.creator, "harvestMigrationFeeIx");
  return ix([...harvestDbcQuoteKeys(a.keys), ...feeSplitAccounts(a.keys, creator)], data("harvest_migration_fee"));
}

/** No payer account. The partner surplus goes 100% to the vault (every launch version). */
export function harvestSurplusIx(a: { keys: LaunchKeys }): TransactionInstruction {
  return ix(harvestDbcQuoteKeys(a.keys), data("harvest_surplus"));
}

/**
 * Latches `Launch.migrated` once the registered DBC pool migrated to DAMM v2 (idempotent, no payer
 * account). After it, `redeem` never decodes the upgradeable DBC pool again.
 */
export function syncMigrationIx(a: { config: PublicKey; pool: PublicKey }): TransactionInstruction {
  return ix([w(launchPda(a.config)[0]), r(a.pool)], data("sync_migration"));
}

/** Burns the claimer base ATA balance; the ATA must exist. */
export function burnClaimerBaseIx(a: { config: PublicKey; baseMint: PublicKey }): TransactionInstruction {
  return ix(
    [
      w(launchPda(a.config)[0]),
      r(authorityPda(a.config)[0]),
      w(claimerBaseAccount(a.config, a.baseMint)),
      w(a.baseMint),
      r(TOKEN_PROGRAM_ID),
    ],
    data("burn_claimer_base"),
  );
}

export interface HarvestLpFeesIxArgs {
  payer: PublicKey;
  keys: LaunchKeys;
  dammPool: PublicKey;
  position: PublicKey;
  /** Token account holding the position NFT; its owner must be the claimer. */
  positionNftAccount: PublicKey;
  /** The launch creator (`launch.creator`); defaults to `keys.creator`. */
  creator?: PublicKey;
}

/**
 * v3 splits the harvested quote fees through the transit: creator 50%, platform 20%, vault the
 * rest (`lpFeeSplit`); v2 pays them all into the vault. Base fees are burned either way.
 */
export function harvestLpFeesIx(a: HarvestLpFeesIxArgs): TransactionInstruction {
  const k = a.keys;
  const creator = launchCreator(k, a.creator, "harvestLpFeesIx");
  return ix(
    [
      w(a.payer, true),
      w(launchPda(k.config)[0]),
      r(authorityPda(k.config)[0]),
      r(a.dammPool),
      w(a.position),
      r(a.positionNftAccount),
      w(claimerBaseAccount(k.config, k.baseMint)),
      w(vaultAddress(k.config, k.quoteMint, k.quoteTokenProgram)),
      w(dammV2TokenVaultPda(a.dammPool, k.baseMint)),
      w(dammV2TokenVaultPda(a.dammPool, k.quoteMint)),
      w(k.baseMint),
      r(k.quoteMint),
      r(TOKEN_PROGRAM_ID),
      r(k.quoteTokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      r(DAMM_V2_POOL_AUTHORITY),
      r(DAMM_V2_EVENT_AUTHORITY),
      r(DAMM_V2_PROGRAM_ID),
      ...feeSplitAccounts(k, creator),
    ],
    data("harvest_lp_fees"),
  );
}

// ------------------------------------------------------------------ redeem

export interface RedeemIxArgs {
  holder: PublicKey;
  keys: LaunchKeys;
  /** Raw base amount to burn. */
  amount: bigint;
  /** Default: the holder's base ATA (SPL Token). */
  holderBaseAccount?: PublicKey;
  /** Default: the holder's quote ATA (must exist; create it idempotently before). */
  holderQuoteAccount?: PublicKey;
}

export function redeemIx(a: RedeemIxArgs): TransactionInstruction {
  const k = a.keys;
  if (a.amount <= 0n) throw new RangeError("redeem amount must be positive");
  return ix(
    [
      r(a.holder, true),
      w(launchPda(k.config)[0]),
      r(vaultAuthorityPda(k.config)[0]),
      r(k.pool),
      w(k.baseMint),
      w(a.holderBaseAccount ?? associatedTokenAddress(a.holder, k.baseMint, TOKEN_PROGRAM_ID)),
      w(vaultAddress(k.config, k.quoteMint, k.quoteTokenProgram)),
      w(a.holderQuoteAccount ?? associatedTokenAddress(a.holder, k.quoteMint, k.quoteTokenProgram)),
      r(k.quoteMint),
      r(TOKEN_PROGRAM_ID),
      r(k.quoteTokenProgram),
    ],
    data("redeem", u64(a.amount)),
  );
}

// ------------------------------------------------------------------ floor (view)

/**
 * `floor` view. Before register_pool the base mint is not checked (pass any account, e.g. the
 * system program); after it, pass the launch base mint.
 */
export function floorIx(a: {
  config: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
  baseMint: PublicKey | null;
}): TransactionInstruction {
  return ix(
    [
      r(launchPda(a.config)[0]),
      r(vaultAddress(a.config, a.quoteMint, a.quoteTokenProgram)),
      r(a.baseMint ?? SystemProgram.programId),
    ],
    data("floor"),
  );
}

export { U64_MAX };
