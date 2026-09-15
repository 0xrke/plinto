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
export const AUTHORITY_SEED = "authority";

const encoder = new TextEncoder();

/** `Launch` registry PDA: seeds `["launch", config]` under the StockFloor program. */
export function launchPda(config: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [encoder.encode(LAUNCH_SEED), config.toBytes()],
    STOCKFLOOR_PROGRAM_ID,
  );
}

/**
 * `Authority` PDA: seeds `["authority", config]` under the StockFloor program. It is the DBC
 * `fee_claimer` and `leftover_receiver`, owns the vault and the DAMM v2 position NFTs.
 */
export function authorityPda(config: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [encoder.encode(AUTHORITY_SEED), config.toBytes()],
    STOCKFLOOR_PROGRAM_ID,
  );
}

/** Vault token account: the associated token account of the `Authority` PDA for the quote mint. */
export function vaultAddress(
  config: PublicKey,
  quoteMint: PublicKey,
  quoteTokenProgram: PublicKey,
): PublicKey {
  const [authority] = authorityPda(config);
  return getAssociatedTokenAddressSync(
    quoteMint,
    authority,
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
