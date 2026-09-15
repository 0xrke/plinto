use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::constants::LAUNCH_SEED;
use crate::errors::StockfloorError;
use crate::events::PoolRegistered;
use crate::external::{load_dbc_config, load_dbc_pool, DBC_POOL_TYPE_SPL_TOKEN};
use crate::state::Launch;

/// Permissionless: record the canonical DBC virtual pool of a launch (once).
///
/// `create_launch` committed the base mint, and DBC derives the pool address from
/// `(config, base_mint, quote_mint)`, so exactly one pool can match: the one created with
/// the base mint keypair (which only the launch creator's client holds). Anyone can
/// therefore register it, and the creator cannot hold the migration fee hostage, neither
/// by never registering nor by creating the pool under another creator key (`pool.creator`
/// is deliberately not compared: it only decides who receives the creator's own DBC fee
/// share). Other pools on the same config use other base mints and are ignored forever.
///
/// Account order:
/// 0. `launch`     writable: PDA `["launch", config]`
/// 1. `config`     `launch.config`
/// 2. `pool`       DBC VirtualPool on `config` for `launch.base_mint`
/// 3. `base_mint`  `launch.base_mint`, SPL Token mint without mint/freeze authority
/// 4. `token_program`
#[derive(Accounts)]
pub struct RegisterPool<'info> {
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = !launch.is_pool_registered() @ StockfloorError::PoolAlreadyRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: address-checked against the launch; decoded in the handler.
    #[account(address = launch.config @ StockfloorError::InvalidDbcConfig)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: DBC VirtualPool; owner, discriminator, size and fields validated in the handler.
    pub pool: UncheckedAccount<'info>,

    #[account(
        address = launch.base_mint @ StockfloorError::BaseMintMismatch,
        mint::token_program = token_program,
    )]
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
    // The committed base mint identifies the one DBC pool of this launch.
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

    emit!(PoolRegistered {
        launch: launch.key(),
        pool: launch.pool,
        base_mint: launch.base_mint,
        creator: launch.creator,
    });
    Ok(())
}
