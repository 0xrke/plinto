//! StockFloor: token launches on Meteora DBC where the partner migration fee (a share
//! of the raise) becomes a redeemable floor vault in a tokenized stock.
//!
//! There is no admin, withdraw or sweep instruction. Quote leaves the vault only
//! through `redeem`. Every crank is permissionless.
//!
//! Two PDAs per launch keep signer privileges apart:
//! - the claimer `["authority", config]` is the DBC `fee_claimer` / `leftover_receiver` and
//!   the DAMM v2 position NFT owner; it signs the CPIs into DBC and DAMM v2 (whose destinations
//!   are constrained to the vault or its own base ATA) and burns its base tokens;
//! - the vault authority `["vault_authority", config]` owns the vault and signs only the
//!   payout transfer in `redeem`. It never signs into an external, upgradeable program.
//!
//! See `docs/research/program-design.md` for accounts, seeds, invariants and
//! limitations.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod external;
pub mod instructions;
pub mod math;
pub mod state;
pub mod token_utils;

pub use instructions::*;
pub use state::*;

declare_id!("98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA");

// CPI clients and account layouts generated from idls/dynamic_bonding_curve.json
// (DBC 0.2.1) and idls/cp_amm.json (DAMM v2 0.2.4).
declare_program!(dynamic_bonding_curve);
declare_program!(cp_amm);

#[program]
pub mod stockfloor {
    use super::*;

    /// Validate a DBC config and create the launch registry and floor vault.
    pub fn create_launch(ctx: Context<CreateLaunch>, exit_fee_bps: u16) -> Result<()> {
        instructions::create_launch::handle_create_launch(ctx, exit_fee_bps)
    }

    /// Permissionless: register the DBC pool of the committed base mint (once).
    pub fn register_pool(ctx: Context<RegisterPool>) -> Result<()> {
        instructions::register_pool::handle_register_pool(ctx)
    }

    /// Permissionless: partner trading fees from the DBC curve; v3: to the platform treasury,
    /// v2: into the vault.
    pub fn harvest_curve_fees(ctx: Context<HarvestCurveFees>) -> Result<()> {
        instructions::harvest_curve_fees::handle_harvest_curve_fees(ctx)
    }

    /// Permissionless: partner migration fee (once); v3: 5% of the threshold to the platform, 5%
    /// to the creator, the rest into the vault; v2: all into the vault.
    pub fn harvest_migration_fee(ctx: Context<HarvestMigrationFee>) -> Result<()> {
        instructions::harvest_dbc_quote::handle_harvest_migration_fee(ctx)
    }

    /// Permissionless: partner curve surplus into the vault (once).
    pub fn harvest_surplus(ctx: Context<HarvestQuoteFromDbc>) -> Result<()> {
        instructions::harvest_dbc_quote::handle_harvest_surplus(ctx)
    }

    /// Permissionless: latch `Launch.migrated` once the DBC pool migrated (idempotent).
    pub fn sync_migration(ctx: Context<SyncMigration>) -> Result<()> {
        instructions::sync_migration::handle_sync_migration(ctx)
    }

    /// Permissionless: burn base tokens held by the claimer PDA (donations).
    pub fn burn_claimer_base(ctx: Context<BurnClaimerBase>) -> Result<()> {
        instructions::burn_claimer_base::handle_burn_claimer_base(ctx)
    }

    /// Permissionless: DAMM v2 LP fees; base burned; quote v3: creator 50% / platform 20% / vault
    /// the rest, v2: all into the vault.
    pub fn harvest_lp_fees(ctx: Context<HarvestLpFees>) -> Result<()> {
        instructions::harvest_lp_fees::handle_harvest_lp_fees(ctx)
    }

    /// Burn base tokens for a pro-rata share of the vault minus the exit fee.
    pub fn redeem(ctx: Context<Redeem>, amount: u64) -> Result<()> {
        instructions::redeem::handle_redeem(ctx, amount)
    }

    /// View: vault balance, supply, exit fee and floor per token (return data + event).
    pub fn floor(ctx: Context<FloorView>) -> Result<FloorInfo> {
        instructions::floor::handle_floor(ctx)
    }
}
