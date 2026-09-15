use anchor_lang::prelude::*;

/// Per-launch registry. PDA `["launch", config]`.
///
/// There is no admin field: nothing in this account can be changed by anyone
/// except through the permissionless instructions of this program.
#[account]
#[derive(InitSpace, Debug)]
pub struct Launch {
    /// Account layout version.
    pub version: u8,
    /// PDA bump of this account.
    pub bump: u8,
    /// PDA bump of the Authority `["authority", config]`.
    pub authority_bump: u8,
    /// Exit fee in basis points, immutable, <= 500.
    pub exit_fee_bps: u16,
    /// `true` once the partner migration fee has been moved into the vault. Redemptions
    /// require it.
    pub migration_fee_harvested: bool,
    /// `true` once the partner surplus has been moved into the vault.
    pub surplus_harvested: bool,
    /// DBC config (one config per launch).
    pub config: Pubkey,
    /// Launch creator. Must sign `register_pool` and must be the DBC pool creator.
    pub creator: Pubkey,
    /// Canonical DBC virtual pool. `Pubkey::default()` until `register_pool`.
    pub pool: Pubkey,
    /// Base token mint (SPL Token). `Pubkey::default()` until `register_pool`.
    pub base_mint: Pubkey,
    /// Quote mint (from the DBC config).
    pub quote_mint: Pubkey,
    /// Token program owning the quote mint (Token-2022 for xStocks).
    pub quote_token_program: Pubkey,
    /// Floor vault: ATA(Authority, quote_mint, quote_token_program).
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
    pub reserved: [u8; 64],
}

impl Launch {
    pub fn is_pool_registered(&self) -> bool {
        self.pool != Pubkey::default()
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
}
