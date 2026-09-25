import { PublicKey } from "@solana/web3.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES_DIR = join(REPO_ROOT, "tests", "fixtures");
export const IDLS_DIR = join(REPO_ROOT, "idls");
export const TARGET_DEPLOY_DIR = join(REPO_ROOT, "target", "deploy");
export const TARGET_IDL_DIR = join(REPO_ROOT, "target", "idl");

// Programs
export const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
export const DAMM_V2_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const STOCKFLOOR_PROGRAM_ID = new PublicKey("98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA");
export const SPIKE_PROGRAM_ID = new PublicKey("JDizjXTevp3bsexc4cxHbNPjMgXPhMewwkY34JnZSQFh");
/** StockFloor platform treasury (programs/stockfloor/src/constants.rs PLATFORM_TREASURY). */
export const PLATFORM_TREASURY = new PublicKey("78tRFS255ADZT2oMSXi5xjHt7Y2SVDLdDEBz759eQsqJ");

// SPYx (Token-2022, 8 decimals)
export const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
export const SPYX_DECIMALS = 8;
/** 1 SPYx in raw units. */
export const SPYX_ONE = 10n ** BigInt(SPYX_DECIMALS);

// DBC PDAs / accounts
export const DBC_POOL_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("pool_authority")],
  DBC_PROGRAM_ID,
)[0];
export const DBC_EVENT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  DBC_PROGRAM_ID,
)[0];
/** DBC token badge for SPYx: ["token_badge", SPYx] under DBC. Remaining account 0 for create_config and pool init. */
export const DBC_TOKEN_BADGE_SPYX = PublicKey.findProgramAddressSync(
  [Buffer.from("token_badge"), SPYX_MINT.toBuffer()],
  DBC_PROGRAM_ID,
)[0];

// DAMM v2 PDAs / accounts
export const DAMM_V2_POOL_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("pool_authority")],
  DAMM_V2_PROGRAM_ID,
)[0];
export const DAMM_V2_EVENT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  DAMM_V2_PROGRAM_ID,
)[0];
/** DAMM v2 config used by DBC for MigrationFeeOption::Customizable (6). */
export const DAMM_V2_CONFIG_CUSTOMIZABLE = new PublicKey("A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck");
/** DAMM v2 config used by DBC for MigrationFeeOption::FixedBps100 (2). */
export const DAMM_V2_CONFIG_FIXED_BPS100 = new PublicKey("Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp");

/** Q64 fixed-point one. */
export const Q64 = 1n << 64n;
export const DBC_MIN_SQRT_PRICE = 4295048016n;
export const DBC_MAX_SQRT_PRICE = 79226673521066979257578248091n;
/** DBC fee numerator denominator (1e9 = 100%). */
export const FEE_DENOMINATOR = 1_000_000_000n;
