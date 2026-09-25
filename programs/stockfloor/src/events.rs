use anchor_lang::prelude::*;

#[event]
pub struct LaunchCreated {
    pub launch: Pubkey,
    pub config: Pubkey,
    pub creator: Pubkey,
    /// Claimer PDA `["authority", config]`: DBC fee_claimer / leftover_receiver, LP NFT owner.
    pub claimer: Pubkey,
    /// Vault authority PDA `["vault_authority", config]`: owner of the vault.
    pub vault_authority: Pubkey,
    pub quote_mint: Pubkey,
    /// Base mint committed for the launch's DBC pool.
    pub base_mint: Pubkey,
    pub quote_token_program: Pubkey,
    pub vault: Pubkey,
    pub exit_fee_bps: u16,
    pub migration_fee_percentage: u8,
    pub migration_quote_threshold: u64,
    pub created_at: i64,
}

#[event]
pub struct PoolRegistered {
    pub launch: Pubkey,
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub creator: Pubkey,
}

#[event]
pub struct CurveFeesHarvested {
    pub launch: Pubkey,
    pub pool: Pubkey,
    pub quote_amount: u64,
    pub base_burned: u64,
    pub vault_balance: u64,
}

#[event]
pub struct MigrationFeeHarvested {
    pub launch: Pubkey,
    pub pool: Pubkey,
    pub quote_amount: u64,
    pub vault_balance: u64,
}

#[event]
pub struct SurplusHarvested {
    pub launch: Pubkey,
    pub pool: Pubkey,
    pub quote_amount: u64,
    pub vault_balance: u64,
}

/// `Launch.migrated` latched by `sync_migration` (the harvests and `redeem` latch without an event).
#[event]
pub struct MigrationLatched {
    pub launch: Pubkey,
    pub pool: Pubkey,
}

#[event]
pub struct ClaimerBaseBurned {
    pub launch: Pubkey,
    pub base_mint: Pubkey,
    /// Base tokens burned from the claimer's base ATA (0 when it was empty).
    pub base_burned: u64,
}

#[event]
pub struct LpFeesHarvested {
    pub launch: Pubkey,
    pub damm_pool: Pubkey,
    pub position: Pubkey,
    pub quote_amount: u64,
    pub base_burned: u64,
    pub vault_balance: u64,
}

#[event]
pub struct Redeemed {
    pub launch: Pubkey,
    pub holder: Pubkey,
    pub base_amount: u64,
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
    pub vault_before: u64,
    pub supply_before: u64,
    pub vault_after: u64,
    pub supply_after: u64,
}

#[event]
pub struct FloorSnapshot {
    pub launch: Pubkey,
    pub vault_raw: u64,
    pub supply: u64,
    pub exit_fee_bps: u16,
    /// `(vault_raw << 64) / supply`, 0 when the supply is 0.
    pub floor_q64: u128,
}

/// Where a harvest's quote went (launch v3). Emitted next to the source-specific event.
///
/// `source`: 0 = curve (presale) fees, 1 = partner migration fee, 2 = DAMM v2 LP fees.
/// `received` is what the harvest collected; `platform_amount + creator_amount + vault_amount`
/// equals `received` plus any pre-existing transit balance swept into the vault. A `*_fallback`
/// flag means that payee's account could not receive and its share went to the vault.
#[event]
pub struct FeesDistributed {
    pub launch: Pubkey,
    pub source: u8,
    pub received: u64,
    pub platform_amount: u64,
    pub creator_amount: u64,
    pub vault_amount: u64,
    pub platform_fallback: bool,
    pub creator_fallback: bool,
}

/// `FeesDistributed.source` values.
pub const FEE_SOURCE_CURVE: u8 = 0;
pub const FEE_SOURCE_MIGRATION: u8 = 1;
pub const FEE_SOURCE_LP: u8 = 2;
