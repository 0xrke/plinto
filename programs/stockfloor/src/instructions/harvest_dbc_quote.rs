use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::external::{DBC_EVENT_AUTHORITY, DBC_POOL_AUTHORITY, DBC_PROGRAM_ID};
use crate::constants::{AUTHORITY_SEED, LAUNCH_SEED};
use crate::dynamic_bonding_curve;
use crate::errors::StockfloorError;
use crate::events::{MigrationFeeHarvested, SurplusHarvested};
use crate::external::{is_curve_complete, load_dbc_config, load_dbc_pool};
use crate::state::Launch;
use crate::token_utils::{assert_quote_mint_transferable, assert_vault_not_frozen};

/// Accounts shared by `harvest_migration_fee` and `harvest_surplus` (both move quote
/// from the DBC quote vault into the floor vault, signed by the Authority).
///
/// Account order:
///  0. `launch`               writable
///  1. `authority`            PDA `["authority", config]`
///  2. `config`               `launch.config`
///  3. `pool`                 writable, `launch.pool`
///  4. `vault`                writable, `launch.vault` (the only destination)
///  5. `dbc_quote_vault`      writable, DBC pool quote vault (validated by DBC)
///  6. `quote_mint`           `launch.quote_mint`
///  7. `quote_token_program`  `launch.quote_token_program`
///  8. `dbc_pool_authority`
///  9. `dbc_event_authority`
/// 10. `dbc_program`
#[derive(Accounts)]
pub struct HarvestQuoteFromDbc<'info> {
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = launch.is_pool_registered() @ StockfloorError::PoolNotRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: PDA signer.
    #[account(seeds = [AUTHORITY_SEED, launch.config.as_ref()], bump = launch.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: address-checked; decoded in the handler and validated again by DBC.
    #[account(address = launch.config @ StockfloorError::InvalidDbcConfig)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: address-checked; decoded in the handler and validated again by DBC.
    #[account(mut, address = launch.pool @ StockfloorError::InvalidDbcPool)]
    pub pool: UncheckedAccount<'info>,

    #[account(mut, address = launch.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by DBC against the pool.
    #[account(mut)]
    pub dbc_quote_vault: UncheckedAccount<'info>,

    #[account(address = launch.quote_mint @ StockfloorError::QuoteMintMismatch)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = launch.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,

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

impl<'info> HarvestQuoteFromDbc<'info> {
    fn preflight(&self) -> Result<()> {
        assert_quote_mint_transferable(&self.quote_mint.to_account_info())?;
        assert_vault_not_frozen(&self.vault.to_account_info())?;
        let config = load_dbc_config(&self.config.to_account_info())?;
        let pool = load_dbc_pool(&self.pool.to_account_info())?;
        require!(
            is_curve_complete(&pool, &config),
            StockfloorError::CurveNotComplete
        );
        Ok(())
    }

    fn vault_delta(&mut self, before: u64) -> Result<(u64, u64)> {
        self.vault.reload()?;
        let after = self.vault.amount;
        let delta = after
            .checked_sub(before)
            .ok_or(StockfloorError::VaultDecreased)?;
        Ok((delta, after))
    }
}

/// Permissionless: withdraw the partner migration fee (flag 0) into the vault.
/// Opens redemptions (together with a completed migration).
pub fn handle_harvest_migration_fee(ctx: Context<HarvestQuoteFromDbc>) -> Result<()> {
    require!(
        !ctx.accounts.launch.migration_fee_harvested,
        StockfloorError::MigrationFeeAlreadyHarvested
    );
    ctx.accounts.preflight()?;

    let accounts = &ctx.accounts;
    let config_key = accounts.launch.config;
    let bump = [accounts.launch.authority_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];
    let vault_before = accounts.vault.amount;

    dynamic_bonding_curve::cpi::withdraw_migration_fee(
        CpiContext::new_with_signer(
            DBC_PROGRAM_ID,
            dynamic_bonding_curve::cpi::accounts::WithdrawMigrationFee {
                pool_authority: accounts.dbc_pool_authority.to_account_info(),
                config: accounts.config.to_account_info(),
                virtual_pool: accounts.pool.to_account_info(),
                token_quote_account: accounts.vault.to_account_info(),
                quote_vault: accounts.dbc_quote_vault.to_account_info(),
                quote_mint: accounts.quote_mint.to_account_info(),
                sender: accounts.authority.to_account_info(),
                token_quote_program: accounts.quote_token_program.to_account_info(),
                event_authority: accounts.dbc_event_authority.to_account_info(),
                program: accounts.dbc_program.to_account_info(),
            },
            &[seeds],
        ),
        0, // partner
    )?;

    let accounts = ctx.accounts;
    let (quote_amount, vault_after) = accounts.vault_delta(vault_before)?;
    let launch = &mut accounts.launch;
    launch.migration_fee_harvested = true;
    launch.total_harvested_quote = launch.total_harvested_quote.saturating_add(quote_amount);

    emit!(MigrationFeeHarvested {
        launch: launch.key(),
        pool: launch.pool,
        quote_amount,
        vault_balance: vault_after,
    });
    Ok(())
}

/// Permissionless: withdraw the partner share of the curve surplus into the vault.
pub fn handle_harvest_surplus(ctx: Context<HarvestQuoteFromDbc>) -> Result<()> {
    require!(
        !ctx.accounts.launch.surplus_harvested,
        StockfloorError::SurplusAlreadyHarvested
    );
    ctx.accounts.preflight()?;

    let accounts = &ctx.accounts;
    let config_key = accounts.launch.config;
    let bump = [accounts.launch.authority_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];
    let vault_before = accounts.vault.amount;

    dynamic_bonding_curve::cpi::partner_withdraw_surplus(CpiContext::new_with_signer(
        DBC_PROGRAM_ID,
        dynamic_bonding_curve::cpi::accounts::PartnerWithdrawSurplus {
            pool_authority: accounts.dbc_pool_authority.to_account_info(),
            config: accounts.config.to_account_info(),
            virtual_pool: accounts.pool.to_account_info(),
            token_quote_account: accounts.vault.to_account_info(),
            quote_vault: accounts.dbc_quote_vault.to_account_info(),
            quote_mint: accounts.quote_mint.to_account_info(),
            fee_claimer: accounts.authority.to_account_info(),
            token_quote_program: accounts.quote_token_program.to_account_info(),
            event_authority: accounts.dbc_event_authority.to_account_info(),
            program: accounts.dbc_program.to_account_info(),
        },
        &[seeds],
    ))?;

    let accounts = ctx.accounts;
    let (quote_amount, vault_after) = accounts.vault_delta(vault_before)?;
    let launch = &mut accounts.launch;
    launch.surplus_harvested = true;
    launch.total_harvested_quote = launch.total_harvested_quote.saturating_add(quote_amount);

    emit!(SurplusHarvested {
        launch: launch.key(),
        pool: launch.pool,
        quote_amount,
        vault_balance: vault_after,
    });
    Ok(())
}
