/**
 * Well-known accounts and PDAs of DBC 0.2.1, DAMM v2 0.2.4 and the token programs, plus the
 * StockFloor-derived accounts that are not in pda.ts. Everything is derived with TextEncoder and
 * `toBytes()` (browser-safe).
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { authorityPda, DAMM_V2_PROGRAM_ID, DBC_PROGRAM_ID, STOCKFLOOR_PROGRAM_ID } from "./pda";

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };

const enc = new TextEncoder();
const seed = (s: string) => enc.encode(s);

/** Metaplex Token Metadata program (DBC creates the base token metadata). */
export const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/** DBC `["pool_authority"]`: FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM. */
export const DBC_POOL_AUTHORITY = PublicKey.findProgramAddressSync([seed("pool_authority")], DBC_PROGRAM_ID)[0];
/** DBC `["__event_authority"]`: 8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF. */
export const DBC_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([seed("__event_authority")], DBC_PROGRAM_ID)[0];
/** DAMM v2 `["pool_authority"]`: HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC. */
export const DAMM_V2_POOL_AUTHORITY = PublicKey.findProgramAddressSync([seed("pool_authority")], DAMM_V2_PROGRAM_ID)[0];
/** DAMM v2 `["__event_authority"]`: 3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet. */
export const DAMM_V2_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([seed("__event_authority")], DAMM_V2_PROGRAM_ID)[0];

/** DAMM v2 config DBC uses for `MigrationFeeOption::Customizable` (6), the StockFloor default. */
export const DAMM_V2_CONFIG_CUSTOMIZABLE = new PublicKey("A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck");
/** DAMM v2 configs DBC 0.2.1 uses per `MigrationFeeOption` (index = option). */
export const DAMM_V2_MIGRATION_CONFIGS: Readonly<Record<number, PublicKey>> = {
  0: new PublicKey("7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd"),
  1: new PublicKey("2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k"),
  2: new PublicKey("Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp"),
  3: new PublicKey("2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq"),
  4: new PublicKey("AkmQWebAwFvWk55wBoCr5D62C6VVDTzi84NJuD9H7cFD"),
  5: new PublicKey("DbCRBj8McvPYHJG1ukj8RE15h2dCNUdTAESG49XpQ44u"),
  6: DAMM_V2_CONFIG_CUSTOMIZABLE,
};

/** Ordered pair (max, min) of two keys by byte order, as DBC and DAMM v2 seed their pools. */
function maxMin(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  const x = a.toBytes();
  const y = b.toBytes();
  for (let i = 0; i < 32; i++) {
    if (x[i]! !== y[i]!) return x[i]! > y[i]! ? [a, b] : [b, a];
  }
  return [a, b];
}

/** DBC virtual pool: `["pool", config, max(base, quote), min(base, quote)]`. */
export function dbcPoolPda(config: PublicKey, baseMint: PublicKey, quoteMint: PublicKey): PublicKey {
  const [max, min] = maxMin(baseMint, quoteMint);
  return PublicKey.findProgramAddressSync([seed("pool"), config.toBytes(), max.toBytes(), min.toBytes()], DBC_PROGRAM_ID)[0];
}

/** DBC pool token vault: `["token_vault", mint, pool]`. */
export function dbcTokenVaultPda(pool: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed("token_vault"), mint.toBytes(), pool.toBytes()], DBC_PROGRAM_ID)[0];
}

/** Deprecated DBC DAMM v2 migration metadata `["damm_v2", pool]` (still an account of migration_damm_v2). */
export function dbcDammV2MigrationMetadataPda(pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed("damm_v2"), pool.toBytes()], DBC_PROGRAM_ID)[0];
}

/** Metaplex metadata `["metadata", metadata program, mint]`. */
export function metaplexMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed("metadata"), METAPLEX_PROGRAM_ID.toBytes(), mint.toBytes()],
    METAPLEX_PROGRAM_ID,
  )[0];
}

/** DAMM v2 pool created by DBC migration: `["pool", damm config, max(a, b), min(a, b)]`. */
export function dammV2PoolPda(dammConfig: PublicKey, mintA: PublicKey, mintB: PublicKey): PublicKey {
  const [max, min] = maxMin(mintA, mintB);
  return PublicKey.findProgramAddressSync(
    [seed("pool"), dammConfig.toBytes(), max.toBytes(), min.toBytes()],
    DAMM_V2_PROGRAM_ID,
  )[0];
}

/** DAMM v2 pool token vault: `["token_vault", mint, pool]`. */
export function dammV2TokenVaultPda(pool: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed("token_vault"), mint.toBytes(), pool.toBytes()], DAMM_V2_PROGRAM_ID)[0];
}

/** DAMM v2 position: `["position", position nft mint]`. */
export function dammV2PositionPda(positionNftMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed("position"), positionNftMint.toBytes()], DAMM_V2_PROGRAM_ID)[0];
}

/** DAMM v2 position NFT token account: `["position_nft_account", position nft mint]`. */
export function dammV2PositionNftAccountPda(positionNftMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed("position_nft_account"), positionNftMint.toBytes()], DAMM_V2_PROGRAM_ID)[0];
}

/** Associated token account (off-curve owners such as PDAs allowed). */
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
}

/**
 * Platform treasury (the program's `PLATFORM_TREASURY` #[constant]): a plain key, only ever a
 * payment destination through its quote ATA. Presale fees, 5% of the raise at graduation and 20% of
 * the LP fees of launch v3 go there. Changing it needs a program upgrade.
 */
export const PLATFORM_TREASURY = new PublicKey("78tRFS255ADZT2oMSXi5xjHt7Y2SVDLdDEBz759eQsqJ");

/** Platform payee account: ATA(PLATFORM_TREASURY, quote mint, quote token program), shared by every launch. */
export function platformQuoteAccount(quoteMint: PublicKey, quoteTokenProgram: PublicKey): PublicKey {
  return associatedTokenAddress(PLATFORM_TREASURY, quoteMint, quoteTokenProgram);
}

/** Creator payee account: ATA(launch.creator, quote mint, quote token program). */
export function creatorQuoteAccount(creator: PublicKey, quoteMint: PublicKey, quoteTokenProgram: PublicKey): PublicKey {
  return associatedTokenAddress(creator, quoteMint, quoteTokenProgram);
}

/**
 * Transit account of the v3 fee split: ATA(claimer PDA, quote mint, quote token program). DBC and
 * DAMM v2 pay one lump into it; the same instruction pays the platform, the creator and the vault
 * out of it, so it is empty between instructions.
 */
export function claimerQuoteAccount(config: PublicKey, quoteMint: PublicKey, quoteTokenProgram: PublicKey): PublicKey {
  return associatedTokenAddress(authorityPda(config)[0], quoteMint, quoteTokenProgram);
}

/** Claimer base ATA: ATA(claimer PDA, base mint, SPL Token). Base fees and donations land here and are burned. */
export function claimerBaseAccount(config: PublicKey, baseMint: PublicKey): PublicKey {
  return associatedTokenAddress(authorityPda(config)[0], baseMint, TOKEN_PROGRAM_ID);
}

export { DAMM_V2_PROGRAM_ID, DBC_PROGRAM_ID, STOCKFLOOR_PROGRAM_ID };
