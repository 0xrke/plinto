use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::external::{DBC_EVENT_AUTHORITY, DBC_POOL_AUTHORITY, DBC_PROGRAM_ID};
use crate::constants::{AUTHORITY_SEED, LAUNCH_SEED};
use crate::dynamic_bonding_curve;
use crate::errors::StockfloorError;
use crate::events::LeftoverHarvested;
use crate::external::{
    is_migration_complete, load_dbc_config, load_dbc_pool, DBC_MIGRATION_PROGRESS_CREATED_POOL,
};
use crate::state::Launch;
use crate::token_utils::burn_all_signed;

/// Permissionless: burn everything the Authority base ATA holds (donations, dust).
///
/// `create_launch` rejects fixed-supply configs, so DBC `withdraw_leftover` never applies
/// to a StockFloor launch; the fixed-supply branch below is defensive only. If it ever
/// ran, the DAMM v2 pool exists and the leftover was not withdrawn yet, it would CPI DBC
/// `withdraw_leftover` into the Authority base ATA and burn it in the same instruction.
///
/// Account order:
///  0. `payer`                     signer, writable (rent for the Authority base ATA if missing)
///  1. `launch`                    writable
///  2. `authority`                 PDA `["authority", config]`
///  3. `config`                    `launch.config`
///  4. `pool`                      writable, `launch.pool`
///  5. `authority_base_account`    writable, ATA(authority, base_mint, SPL Token)
///  6. `dbc_base_vault`            writable, DBC pool base vault (validated by DBC)
///  7. `base_mint`                 writable, `launch.base_mint`
///  8. `token_program`             SPL Token
///  9. `associated_token_program`
/// 10. `system_program`
/// 11. `dbc_pool_authority`
/// 12. `dbc_event_authority`
/// 13. `dbc_program`
#[derive(Accounts)]
pub struct HarvestLeftover<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = launch.is_pool_registered() @ StockfloorError::PoolNotRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: PDA signer (DBC `leftover_receiver`).
    #[account(seeds = [AUTHORITY_SEED, launch.config.as_ref()], bump = launch.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: address-checked; decoded in the handler.
    #[account(address = launch.config @ StockfloorError::InvalidDbcConfig)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: address-checked; decoded in the handler.
    #[account(mut, address = launch.pool @ StockfloorError::InvalidDbcPool)]
    pub pool: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by DBC against the pool.
    #[account(mut)]
    pub dbc_base_vault: UncheckedAccount<'info>,

    #[account(mut, address = launch.base_mint @ StockfloorError::BaseMintMismatch)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// CHECK: constant address.
    #[account(address = DBC_POOL_AUTHORITY)]
    pub dbc_pool_authority: UncheckedAccount<'info>,

    /// CHECK: constant address.
    #[account(address = DBC_EVENT_AUTHORITY)]
    pub dbc_event_authority: UncheckedAccount<'info>,

    /// CHECK: constant address.
    #[account(address = DBC_PROGRAM_ID)]
    pub dbc_program: UncheckedAccount<'info>,
}

pub fn handle_harvest_leftover(ctx: Context<HarvestLeftover>) -> Result<()> {
    let accounts = &ctx.accounts;
    let (leftover_applicable, migrated) = {
        let config = load_dbc_config(&accounts.config.to_account_info())?;
        let pool = load_dbc_pool(&accounts.pool.to_account_info())?;
        (
            config.fixed_token_supply_flag == 1
                && pool.pool_state.migration_progress == DBC_MIGRATION_PROGRESS_CREATED_POOL
                && pool.pool_state.is_withdraw_leftover == 0,
            is_migration_complete(&pool),
        )
    };

    let config_key = accounts.launch.config;
    let bump = [accounts.launch.authority_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];
    let signer = &[seeds];

    if leftover_applicable {
        // `withdraw_leftover` needs no signature: the Authority is passed as a plain
        // account and DBC pays its ATA. No signer seeds are attached.
        dynamic_bonding_curve::cpi::withdraw_leftover(CpiContext::new(
            DBC_PROGRAM_ID,
            dynamic_bonding_curve::cpi::accounts::WithdrawLeftover {
                pool_authority: accounts.dbc_pool_authority.to_account_info(),
                config: accounts.config.to_account_info(),
                virtual_pool: accounts.pool.to_account_info(),
                token_base_account: accounts.authority_base_account.to_account_info(),
                base_vault: accounts.dbc_base_vault.to_account_info(),
                base_mint: accounts.base_mint.to_account_info(),
                leftover_receiver: accounts.authority.to_account_info(),
                token_base_program: accounts.token_program.to_account_info(),
                event_authority: accounts.dbc_event_authority.to_account_info(),
                program: accounts.dbc_program.to_account_info(),
            },
        ))?;
    }

    let base_burned = burn_all_signed(
        &accounts.token_program.to_account_info(),
        &accounts.base_mint.to_account_info(),
        &accounts.authority_base_account.to_account_info(),
        &accounts.authority.to_account_info(),
        signer,
    )?;

    let launch = &mut ctx.accounts.launch;
    launch.migrated |= migrated;
    launch.total_burned_base = launch.total_burned_base.saturating_add(base_burned);

    emit!(LeftoverHarvested {
        launch: launch.key(),
        pool: launch.pool,
        leftover_withdrawn: leftover_applicable,
        base_burned,
    });
    Ok(())
}
