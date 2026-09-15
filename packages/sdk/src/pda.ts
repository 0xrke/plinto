/**
 * Program ids and StockFloor PDAs (docs/BRIEF.md §5.2).
 *
 * Seeds are encoded with TextEncoder and `toBytes()` so the helpers also run in browsers
 * without a Buffer polyfill.
 */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const STOCKFLOOR_PROGRAM_ID = new PublicKey(
  "98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA",
);
export const DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
);
export const DAMM_V2_PROGRAM_ID = new PublicKey(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
);

export const LAUNCH_SEED = "launch";
/** Seed of the claimer PDA (kept as "authority" for the DBC config's fee_claimer). */
export const AUTHORITY_SEED = "authority";
/** Seed of the vault authority PDA (owner of the vault). */
export const VAULT_AUTHORITY_SEED = "vault_authority";

const encoder = new TextEncoder();

/** `Launch` registry PDA: seeds `["launch", config]` under the StockFloor program. */
export function launchPda(config: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [encoder.encode(LAUNCH_SEED), config.toBytes()],
    STOCKFLOOR_PROGRAM_ID,
  );
}

/**
 * Claimer PDA: seeds `["authority", config]` under the StockFloor program (the `claimer` account
 * in the program IDL). It is the DBC `fee_claimer` and `leftover_receiver` (pass it for both when
 * building the DBC config), owns the DAMM v2 position NFTs and signs the program's CPIs into DBC
 * and DAMM v2. It has no authority over the vault.
 */
export function authorityPda(config: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [encoder.encode(AUTHORITY_SEED), config.toBytes()],
    STOCKFLOOR_PROGRAM_ID,
  );
}

/**
 * Vault authority PDA: seeds `["vault_authority", config]` under the StockFloor program. It owns
 * the vault and signs only the payout transfer of `redeem`.
 */
export function vaultAuthorityPda(config: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [encoder.encode(VAULT_AUTHORITY_SEED), config.toBytes()],
    STOCKFLOOR_PROGRAM_ID,
  );
}

/**
 * Vault token account: the associated token account of the vault authority PDA for the quote
 * mint and its token program (Token-2022 for xStocks).
 */
export function vaultAddress(
  config: PublicKey,
  quoteMint: PublicKey,
  quoteTokenProgram: PublicKey,
): PublicKey {
  const [vaultAuthority] = vaultAuthorityPda(config);
  return getAssociatedTokenAddressSync(
    quoteMint,
    vaultAuthority,
    true,
    quoteTokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** DBC token badge PDA for a quote mint: seeds `["token_badge", mint]` under DBC. */
export function dbcTokenBadgePda(quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [encoder.encode("token_badge"), quoteMint.toBytes()],
    DBC_PROGRAM_ID,
  );
}
