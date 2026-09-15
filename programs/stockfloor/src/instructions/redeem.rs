use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{
    self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{AUTHORITY_SEED, LAUNCH_SEED};
use crate::errors::StockfloorError;
use crate::events::Redeemed;
use crate::external::{is_migration_complete, load_dbc_pool};
use crate::math::{compute_redeem, floor_not_decreased};
use crate::state::Launch;
use crate::token_utils::{assert_quote_mint_transferable, assert_vault_not_frozen};

/// Burn `amount` base tokens and receive `floor(vault * amount / supply)` minus the exit
/// fee in the quote asset. Only after the DBC pool migrated to DAMM v2 and the partner
/// migration fee is in the vault.
///
/// Account order:
///  0. `holder`                signer: owner of `holder_base_account`
///  1. `launch`                writable
///  2. `authority`             PDA `["authority", config]` (vault owner)
///  3. `pool`                  `launch.pool` (read to check migration status)
///  4. `base_mint`             writable, `launch.base_mint`
///  5. `holder_base_account`   writable, base token account owned by `holder`
///  6. `vault`                 writable, `launch.vault`
///  7. `holder_quote_account`  writable, any quote token account (receives the payout)
///  8. `quote_mint`            `launch.quote_mint`
///  9. `token_program`         SPL Token (base)
/// 10. `quote_token_program`   `launch.quote_token_program`
#[derive(Accounts)]
pub struct Redeem<'info> {
    pub holder: Signer<'info>,

    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = launch.is_pool_registered() @ StockfloorError::PoolNotRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: PDA signer (vault owner).
    #[account(seeds = [AUTHORITY_SEED, launch.config.as_ref()], bump = launch.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: address-checked; decoded in the handler.
    #[account(address = launch.pool @ StockfloorError::InvalidDbcPool)]
    pub pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = launch.base_mint @ StockfloorError::BaseMintMismatch,
        mint::token_program = token_program,
    )]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = base_mint,
        token::authority = holder,
        token::token_program = token_program,
    )]
    pub holder_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = launch.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::token_program = quote_token_program,
    )]
    pub holder_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = launch.quote_mint @ StockfloorError::QuoteMintMismatch)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token>,

    #[account(address = launch.quote_token_program)]
    pub quote_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_redeem(ctx: Context<Redeem>, amount: u64) -> Result<()> {
    require!(amount > 0, StockfloorError::ZeroAmount);
    require!(
        ctx.accounts.vault.key() != ctx.accounts.holder_quote_account.key(),
        StockfloorError::DestinationIsVault
    );

    {
        let pool = load_dbc_pool(&ctx.accounts.pool.to_account_info())?;
        require!(
            is_migration_complete(&pool),
            StockfloorError::MigrationNotComplete
        );
    }
    require!(
        ctx.accounts.launch.migration_fee_harvested,
        StockfloorError::MigrationFeeNotHarvested
    );
    require!(
        ctx.accounts.holder_base_account.amount >= amount,
        StockfloorError::InsufficientBaseBalance
    );
    assert_quote_mint_transferable(&ctx.accounts.quote_mint.to_account_info())?;
    assert_vault_not_frozen(&ctx.accounts.vault.to_account_info())?;

    let supply_before = ctx.accounts.base_mint.supply;
    let vault_before = ctx.accounts.vault.amount;
    let exit_fee_bps = ctx.accounts.launch.exit_fee_bps;
    let quote = compute_redeem(vault_before, supply_before, amount, exit_fee_bps)
        .map_err(StockfloorError::from)?;

    // 1. Burn the holder's tokens (holder signs).
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.base_mint.to_account_info(),
                from: ctx.accounts.holder_base_account.to_account_info(),
                authority: ctx.accounts.holder.to_account_info(),
            },
        ),
        amount,
    )?;

    // 2. Pay `net` from the vault (Authority signs). The fee stays in the vault.
    let config_key = ctx.accounts.launch.config;
    let bump = [ctx.accounts.launch.authority_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.quote_token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.holder_quote_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[seeds],
        ),
        quote.net,
        ctx.accounts.quote_mint.decimals,
    )?;

    // 3. Post-conditions on real balances (defence in depth).
    let accounts = ctx.accounts;
    accounts.vault.reload()?;
    accounts.base_mint.reload()?;
    let vault_after = accounts.vault.amount;
    let supply_after = accounts.base_mint.supply;
    require!(
        Some(vault_after) == vault_before.checked_sub(quote.net),
        StockfloorError::VaultBalanceMismatch
    );
    require!(
        Some(supply_after) == supply_before.checked_sub(amount),
        StockfloorError::SupplyMismatch
    );
    require!(
        floor_not_decreased(vault_before, supply_before, vault_after, supply_after),
        StockfloorError::FloorDecreased
    );

    let launch = &mut accounts.launch;
    launch.total_redeemed_base = launch.total_redeemed_base.saturating_add(amount);
    launch.total_redeemed_quote = launch.total_redeemed_quote.saturating_add(quote.net);
    launch.total_exit_fees = launch.total_exit_fees.saturating_add(quote.fee);

    emit!(Redeemed {
        launch: launch.key(),
        holder: accounts.holder.key(),
        base_amount: amount,
        gross: quote.gross,
        fee: quote.fee,
        net: quote.net,
        vault_before,
        supply_before,
        vault_after,
        supply_after,
    });
    Ok(())
}
