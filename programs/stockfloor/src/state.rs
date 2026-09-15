use anchor_lang::prelude::*;

use crate::constants::{CLAIMER_SEED, VAULT_AUTHORITY_SEED};

/// Per-launch registry. PDA `["launch", config]`.
///
/// There is no admin field: nothing in this account can be changed by anyone
/// except through the permissionless instructions of this program.
///
/// Layout version 2 (`8 + 343` bytes, unchanged in size from version 1: the vault authority bump
/// took one reserved byte).
#[account]
#[derive(InitSpace, Debug)]
pub struct Launch {
    /// Account layout version.
    pub version: u8,
    /// PDA bump of this account.
    pub bump: u8,
    /// PDA bump of the claimer `["authority", config]` (DBC fee_claimer, LP NFT owner, CPI signer).
    pub claimer_bump: u8,
    /// PDA bump of the vault authority `["vault_authority", config]` (vault owner, signs only the
    /// `redeem` payout).
    pub vault_authority_bump: u8,
    /// Exit fee in basis points, immutable, <= 500.
    pub exit_fee_bps: u16,
    /// `true` once the partner migration fee has been moved into the vault. Redemptions
    /// require it.
    pub migration_fee_harvested: bool,
    /// `true` once the partner surplus has been moved into the vault.
    pub surplus_harvested: bool,
    /// Latched to `true` the first time this program sees the registered DBC pool fully
    /// migrated to DAMM v2 (`sync_migration`, `harvest_migration_fee`, `harvest_surplus` or the
    /// first `redeem`). Once set, `redeem` never decodes DBC state again, so a later DBC upgrade
    /// that changes the VirtualPool layout cannot lock redemptions.
    pub migrated: bool,
    /// DBC config (one config per launch).
    pub config: Pubkey,
    /// Launch creator (signed `create_launch`). Informational: registration is permissionless.
    pub creator: Pubkey,
    /// Canonical DBC virtual pool. `Pubkey::default()` until `register_pool`.
    pub pool: Pubkey,
    /// Base token mint (SPL Token), committed by `create_launch`. The DBC pool of
    /// `(config, base_mint)` is unique, so `register_pool` is permissionless.
    pub base_mint: Pubkey,
    /// Quote mint (from the DBC config).
    pub quote_mint: Pubkey,
    /// Token program owning the quote mint (Token-2022 for xStocks).
    pub quote_token_program: Pubkey,
    /// Floor vault: ATA(vault authority, quote_mint, quote_token_program).
    pub vault: Pubkey,
    /// Unix timestamp of `create_launch`.
    pub created_at: i64,
    /// Informational counters (saturating; never used for access control or math).
    pub total_harvested_quote: u64,
    pub total_burned_base: u64,
    pub total_redeemed_base: u64,
    pub total_redeemed_quote: u64,
    pub total_exit_fees: u64,
    /// Reserved for future fields.
    pub reserved: [u8; 62],
}

impl Launch {
    pub fn is_pool_registered(&self) -> bool {
        self.pool != Pubkey::default()
    }

    /// Address of the claimer PDA from the stored bump (`create_program_address`, no search).
    pub fn claimer_key(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[CLAIMER_SEED, self.config.as_ref(), &[self.claimer_bump]],
            &crate::ID,
        )
        .map_err(|_| ErrorCode::ConstraintSeeds.into())
    }

    /// Address of the vault authority PDA from the stored bump (`create_program_address`).
    pub fn vault_authority_key(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                VAULT_AUTHORITY_SEED,
                self.config.as_ref(),
                &[self.vault_authority_bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ErrorCode::ConstraintSeeds.into())
    }
}

/// Return value of the `floor` view.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct FloorInfo {
    /// Raw quote units in the vault.
    pub vault_raw: u64,
    /// Raw base mint supply (0 before `register_pool`).
    pub supply: u64,
    /// Exit fee in basis points.
    pub exit_fee_bps: u16,
    /// Floor per token as Q64.64 raw quote units per raw base unit:
    /// `(vault_raw << 64) / supply`, 0 when the supply is 0.
    pub floor_q64: u128,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::LAUNCH_SEED;

    #[test]
    fn launch_size_is_stable() {
        // 8 discriminator + 343 body, the same size as layout version 1.
        assert_eq!(Launch::INIT_SPACE, 343);
    }

    #[test]
    fn stored_bumps_derive_the_canonical_pdas() {
        for i in 0..32u8 {
            let config = Pubkey::new_from_array([i.wrapping_mul(7).wrapping_add(1); 32]);
            let (claimer, claimer_bump) =
                Pubkey::find_program_address(&[CLAIMER_SEED, config.as_ref()], &crate::ID);
            let (vault_authority, vault_authority_bump) =
                Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED, config.as_ref()], &crate::ID);
            let (_, bump) =
                Pubkey::find_program_address(&[LAUNCH_SEED, config.as_ref()], &crate::ID);
            let launch = Launch {
                version: crate::constants::LAUNCH_VERSION,
                bump,
                claimer_bump,
                vault_authority_bump,
                exit_fee_bps: 200,
                migration_fee_harvested: false,
                surplus_harvested: false,
                migrated: false,
                config,
                creator: Pubkey::default(),
                pool: Pubkey::default(),
                base_mint: Pubkey::default(),
                quote_mint: Pubkey::default(),
                quote_token_program: Pubkey::default(),
                vault: Pubkey::default(),
                created_at: 0,
                total_harvested_quote: 0,
                total_burned_base: 0,
                total_redeemed_base: 0,
                total_redeemed_quote: 0,
                total_exit_fees: 0,
                reserved: [0; 62],
            };
            assert_eq!(launch.claimer_key().unwrap(), claimer);
            assert_eq!(launch.vault_authority_key().unwrap(), vault_authority);
            assert_ne!(claimer, vault_authority);
        }
    }
}
