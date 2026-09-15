use anchor_lang::prelude::*;

#[event]
pub struct LaunchCreated {
    pub launch: Pubkey,
    pub config: Pubkey,
    pub creator: Pubkey,
    pub authority: Pubkey,
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

#[event]
pub struct LeftoverHarvested {
    pub launch: Pubkey,
    pub pool: Pubkey,
    /// `true` when this call executed DBC `withdraw_leftover`.
    pub leftover_withdrawn: bool,
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
