use anchor_lang::prelude::*;

use crate::constants::LAUNCH_SEED;
use crate::errors::StockfloorError;
use crate::events::MigrationLatched;
use crate::external::{is_migration_complete, load_dbc_pool};
use crate::state::Launch;

/// Permissionless: latch `Launch.migrated` once the registered DBC pool has fully migrated to
/// DAMM v2.
///
/// `harvest_migration_fee`, `harvest_surplus` and the first successful `redeem` latch the flag too,
/// but a crank that harvests both one-shot DBC amounts as soon as the curve completes (before
/// `migration_damm_v2`) records `migrated = false` and can never run them again. Without this
/// instruction the flag would then stay unset until the first redemption, and every redemption
/// until then would decode the upgradeable DBC `VirtualPool`. The crank sends this right after the
/// migration, so `redeem` stops depending on DBC state as early as possible.
///
/// Idempotent: once latched it succeeds without reading the pool (no event). Touches no token
/// account and signs nothing.
///
/// Account order:
/// 0. `launch`  writable
/// 1. `pool`    `launch.pool` (decoded only while `launch.migrated` is false)
#[derive(Accounts)]
pub struct SyncMigration<'info> {
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = launch.is_pool_registered() @ StockfloorError::PoolNotRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: address-checked; decoded in the handler (owner, discriminator, minimum size).
    #[account(address = launch.pool @ StockfloorError::InvalidDbcPool)]
    pub pool: UncheckedAccount<'info>,
}

pub fn handle_sync_migration(ctx: Context<SyncMigration>) -> Result<()> {
    if ctx.accounts.launch.migrated {
        return Ok(());
    }
    let pool = load_dbc_pool(&ctx.accounts.pool.to_account_info())?;
    require!(
        is_migration_complete(&pool),
        StockfloorError::MigrationNotComplete
    );
    let launch = &mut ctx.accounts.launch;
    launch.migrated = true;
    emit!(MigrationLatched {
        launch: launch.key(),
        pool: launch.pool,
    });
    Ok(())
}
