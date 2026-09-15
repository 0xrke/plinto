use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::constants::LAUNCH_SEED;
use crate::errors::StockfloorError;
use crate::events::PoolRegistered;
use crate::external::{load_dbc_config, load_dbc_pool, DBC_POOL_TYPE_SPL_TOKEN};
use crate::state::Launch;

/// Record the canonical DBC virtual pool of a launch (once).
///
/// Anyone can create DBC pools on any config, so the launch creator must sign and must
/// be the pool creator. Pools other than the registered one are ignored forever.
///
/// Account order:
/// 0. `creator`    signer: must equal `launch.creator` and `pool.creator`
/// 1. `launch`     writable: PDA `["launch", config]`
/// 2. `config`     `launch.config`
/// 3. `pool`       DBC VirtualPool on `config`
/// 4. `base_mint`  `pool.base_mint`, SPL Token mint without mint/freeze authority
#[derive(Accounts)]
pub struct RegisterPool<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        has_one = creator @ StockfloorError::PoolCreatorMismatch,
        constraint = !launch.is_pool_registered() @ StockfloorError::PoolAlreadyRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: address-checked against the launch; decoded in the handler.
    #[account(address = launch.config @ StockfloorError::InvalidDbcConfig)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: DBC VirtualPool; owner, discriminator, size and fields validated in the handler.
    pub pool: UncheckedAccount<'info>,

    #[account(mint::token_program = token_program)]
    pub base_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_register_pool(ctx: Context<RegisterPool>) -> Result<()> {
    let config = load_dbc_config(&ctx.accounts.config.to_account_info())?;
    let pool = load_dbc_pool(&ctx.accounts.pool.to_account_info())?;
    let launch = &mut ctx.accounts.launch;
    let base_mint = &ctx.accounts.base_mint;

    require_keys_eq!(
        pool.pool_state.config,
        launch.config,
        StockfloorError::PoolConfigMismatch
    );
    require_keys_eq!(
        pool.pool_state.creator,
        launch.creator,
        StockfloorError::PoolCreatorMismatch
    );
    require_keys_eq!(
        pool.pool_state.base_mint,
        base_mint.key(),
        StockfloorError::BaseMintMismatch
    );
    require!(
        pool.pool_state.pool_type == DBC_POOL_TYPE_SPL_TOKEN,
        StockfloorError::PoolTypeNotSplToken
    );
    require!(
        base_mint.decimals == config.token_decimal,
        StockfloorError::BaseMintDecimalsMismatch
    );
    // DBC revokes the mint authority in `initialize_virtual_pool_with_spl_token`; a live
    // mint authority could mint tokens and drain the vault through `redeem`.
    require!(
        base_mint.mint_authority.is_none(),
        StockfloorError::BaseMintAuthorityNotRevoked
    );
    require!(
        base_mint.freeze_authority.is_none(),
        StockfloorError::BaseMintHasFreezeAuthority
    );

    launch.pool = ctx.accounts.pool.key();
    launch.base_mint = base_mint.key();

    emit!(PoolRegistered {
        launch: launch.key(),
        pool: launch.pool,
        base_mint: launch.base_mint,
        creator: launch.creator,
    });
    Ok(())
}
