use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::external::{DBC_EVENT_AUTHORITY, DBC_POOL_AUTHORITY, DBC_PROGRAM_ID};
use crate::constants::{AUTHORITY_SEED, LAUNCH_SEED};
use crate::dynamic_bonding_curve;
use crate::errors::StockfloorError;
use crate::events::CurveFeesHarvested;
use crate::state::Launch;
use crate::token_utils::{
    assert_quote_mint_transferable, assert_vault_not_frozen, assert_vault_unencumbered,
    burn_all_signed,
};

/// Permissionless: claim the partner share of DBC trading fees of the registered pool.
/// Quote goes to the vault; any base goes to the Authority base ATA and is burned.
///
/// Account order:
///  0. `payer`                     signer, writable (rent for the Authority base ATA if missing)
///  1. `launch`                    writable
///  2. `authority`                 PDA `["authority", config]`
///  3. `config`                    `launch.config`
///  4. `pool`                      writable, `launch.pool`
///  5. `vault`                     writable, `launch.vault` (quote destination)
///  6. `authority_base_account`    writable, ATA(authority, base_mint, SPL Token) (base destination)
///  7. `dbc_base_vault`            writable, DBC pool base vault (validated by DBC)
///  8. `dbc_quote_vault`           writable, DBC pool quote vault (validated by DBC)
///  9. `base_mint`                 writable, `launch.base_mint`
/// 10. `quote_mint`                `launch.quote_mint`
/// 11. `token_program`             SPL Token (base)
/// 12. `quote_token_program`       `launch.quote_token_program`
/// 13. `associated_token_program`
/// 14. `system_program`
/// 15. `dbc_pool_authority`
/// 16. `dbc_event_authority`
/// 17. `dbc_program`
#[derive(Accounts)]
pub struct HarvestCurveFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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

    /// CHECK: address-checked; DBC validates the rest.
    #[account(address = launch.config @ StockfloorError::InvalidDbcConfig)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: address-checked; DBC validates the rest.
    #[account(mut, address = launch.pool @ StockfloorError::InvalidDbcPool)]
    pub pool: UncheckedAccount<'info>,

    #[account(mut, address = launch.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

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

    /// CHECK: validated by DBC against the pool.
    #[account(mut)]
    pub dbc_quote_vault: UncheckedAccount<'info>,

    #[account(mut, address = launch.base_mint @ StockfloorError::BaseMintMismatch)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = launch.quote_mint @ StockfloorError::QuoteMintMismatch)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token>,

    #[account(address = launch.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,

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

pub fn handle_harvest_curve_fees(ctx: Context<HarvestCurveFees>) -> Result<()> {
    let accounts = &ctx.accounts;
    assert_quote_mint_transferable(&accounts.quote_mint.to_account_info())?;
    assert_vault_not_frozen(&accounts.vault.to_account_info())?;

    let config_key = accounts.launch.config;
    let bump = [accounts.launch.authority_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];
    let signer = &[seeds];

    let vault_before = accounts.vault.amount;

    dynamic_bonding_curve::cpi::claim_trading_fee(
        CpiContext::new_with_signer(
            DBC_PROGRAM_ID,
            dynamic_bonding_curve::cpi::accounts::ClaimTradingFee {
                pool_authority: accounts.dbc_pool_authority.to_account_info(),
                config: accounts.config.to_account_info(),
                pool: accounts.pool.to_account_info(),
                token_a_account: accounts.authority_base_account.to_account_info(),
                token_b_account: accounts.vault.to_account_info(),
                base_vault: accounts.dbc_base_vault.to_account_info(),
                quote_vault: accounts.dbc_quote_vault.to_account_info(),
                base_mint: accounts.base_mint.to_account_info(),
                quote_mint: accounts.quote_mint.to_account_info(),
                fee_claimer: accounts.authority.to_account_info(),
                token_base_program: accounts.token_program.to_account_info(),
                token_quote_program: accounts.quote_token_program.to_account_info(),
                event_authority: accounts.dbc_event_authority.to_account_info(),
                program: accounts.dbc_program.to_account_info(),
            },
            signer,
        ),
        u64::MAX,
        u64::MAX,
    )?;

    let base_burned = burn_all_signed(
        &accounts.token_program.to_account_info(),
        &accounts.base_mint.to_account_info(),
        &accounts.authority_base_account.to_account_info(),
        &accounts.authority.to_account_info(),
        signer,
    )?;

    // The Authority (vault owner) signed a CPI into an upgradeable program with the vault
    // writable: the vault must come back unencumbered.
    assert_vault_unencumbered(&accounts.vault.to_account_info(), &accounts.authority.key())?;

    let accounts = ctx.accounts;
    accounts.vault.reload()?;
    let vault_after = accounts.vault.amount;
    let quote_amount = vault_after
        .checked_sub(vault_before)
        .ok_or(StockfloorError::VaultDecreased)?;

    let launch = &mut accounts.launch;
    launch.total_harvested_quote = launch.total_harvested_quote.saturating_add(quote_amount);
    launch.total_burned_base = launch.total_burned_base.saturating_add(base_burned);

    emit!(CurveFeesHarvested {
        launch: launch.key(),
        pool: launch.pool,
        quote_amount,
        base_burned,
        vault_balance: vault_after,
    });
    Ok(())
}
