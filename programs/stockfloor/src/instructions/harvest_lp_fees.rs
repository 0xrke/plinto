use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::external::{
    DAMM_V2_EVENT_AUTHORITY, DAMM_V2_POOL_AUTHORITY, DAMM_V2_PROGRAM_ID,
};
use crate::constants::{AUTHORITY_SEED, LAUNCH_SEED};
use crate::cp_amm;
use crate::errors::StockfloorError;
use crate::events::LpFeesHarvested;
use crate::external::{load_damm_pool, load_damm_position};
use crate::state::Launch;
use crate::token_utils::{
    assert_quote_mint_transferable, assert_vault_not_frozen, assert_vault_unencumbered,
    burn_all_signed,
};

/// Permissionless: claim DAMM v2 position fees for a position whose NFT is held by the
/// Authority, on a pool with mints (base_mint, quote_mint). Quote goes to the vault,
/// base is burned. Any such position qualifies (the migrated partner position, or a
/// position someone donated to the Authority): the proceeds can only raise the floor.
///
/// Account order:
///  0. `payer`                     signer, writable (rent for the Authority base ATA if missing)
///  1. `launch`                    writable
///  2. `authority`                 PDA `["authority", config]`
///  3. `damm_pool`                 DAMM v2 pool, token_a = base_mint, token_b = quote_mint
///  4. `position`                  writable, DAMM v2 position on `damm_pool`
///  5. `position_nft_account`      token account holding the position NFT, owner = authority
///  6. `authority_base_account`    writable, ATA(authority, base_mint, SPL Token) (token A destination)
///  7. `vault`                     writable, `launch.vault` (token B destination)
///  8. `damm_token_a_vault`        writable (validated by DAMM v2 against the pool)
///  9. `damm_token_b_vault`        writable (validated by DAMM v2 against the pool)
/// 10. `base_mint`                 writable, `launch.base_mint`
/// 11. `quote_mint`                `launch.quote_mint`
/// 12. `token_program`             SPL Token (base)
/// 13. `quote_token_program`       `launch.quote_token_program`
/// 14. `associated_token_program`
/// 15. `system_program`
/// 16. `damm_pool_authority`
/// 17. `damm_event_authority`
/// 18. `damm_program`
#[derive(Accounts)]
pub struct HarvestLpFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = launch.is_pool_registered() @ StockfloorError::PoolNotRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: PDA signer (owner of the position NFT account).
    #[account(seeds = [AUTHORITY_SEED, launch.config.as_ref()], bump = launch.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: decoded in the handler (owner, discriminator, mints).
    pub damm_pool: UncheckedAccount<'info>,

    /// CHECK: decoded in the handler (owner, discriminator, pool).
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    #[account(
        constraint = position_nft_account.owner == authority.key()
            @ StockfloorError::PositionNftNotOwnedByAuthority,
        constraint = position_nft_account.amount == 1
            @ StockfloorError::PositionNftNotOwnedByAuthority,
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = base_mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = launch.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by DAMM v2 (`has_one = token_a_vault`).
    #[account(mut)]
    pub damm_token_a_vault: UncheckedAccount<'info>,

    /// CHECK: validated by DAMM v2 (`has_one = token_b_vault`).
    #[account(mut)]
    pub damm_token_b_vault: UncheckedAccount<'info>,

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
    #[account(address = DAMM_V2_POOL_AUTHORITY)]
    pub damm_pool_authority: UncheckedAccount<'info>,

    /// CHECK: constant address.
    #[account(address = DAMM_V2_EVENT_AUTHORITY)]
    pub damm_event_authority: UncheckedAccount<'info>,

    /// CHECK: constant address.
    #[account(address = DAMM_V2_PROGRAM_ID)]
    pub damm_program: UncheckedAccount<'info>,
}

pub fn handle_harvest_lp_fees(ctx: Context<HarvestLpFees>) -> Result<()> {
    let accounts = &ctx.accounts;
    {
        let pool = load_damm_pool(&accounts.damm_pool.to_account_info())?;
        require_keys_eq!(
            pool.token_a_mint,
            accounts.launch.base_mint,
            StockfloorError::DammPoolMintMismatch
        );
        require_keys_eq!(
            pool.token_b_mint,
            accounts.launch.quote_mint,
            StockfloorError::DammPoolMintMismatch
        );
        let position = load_damm_position(&accounts.position.to_account_info())?;
        require_keys_eq!(
            position.pool,
            accounts.damm_pool.key(),
            StockfloorError::PositionPoolMismatch
        );
        require_keys_eq!(
            accounts.position_nft_account.mint,
            position.nft_mint,
            StockfloorError::PositionNftNotOwnedByAuthority
        );
    }
    assert_quote_mint_transferable(&accounts.quote_mint.to_account_info())?;
    assert_vault_not_frozen(&accounts.vault.to_account_info())?;

    let config_key = accounts.launch.config;
    let bump = [accounts.launch.authority_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];
    let signer = &[seeds];
    let vault_before = accounts.vault.amount;

    cp_amm::cpi::claim_position_fee(CpiContext::new_with_signer(
        DAMM_V2_PROGRAM_ID,
        cp_amm::cpi::accounts::ClaimPositionFee {
            pool_authority: accounts.damm_pool_authority.to_account_info(),
            pool: accounts.damm_pool.to_account_info(),
            position: accounts.position.to_account_info(),
            token_a_account: accounts.authority_base_account.to_account_info(),
            token_b_account: accounts.vault.to_account_info(),
            token_a_vault: accounts.damm_token_a_vault.to_account_info(),
            token_b_vault: accounts.damm_token_b_vault.to_account_info(),
            token_a_mint: accounts.base_mint.to_account_info(),
            token_b_mint: accounts.quote_mint.to_account_info(),
            position_nft_account: accounts.position_nft_account.to_account_info(),
            signer: accounts.authority.to_account_info(),
            token_a_program: accounts.token_program.to_account_info(),
            token_b_program: accounts.quote_token_program.to_account_info(),
            event_authority: accounts.damm_event_authority.to_account_info(),
            program: accounts.damm_program.to_account_info(),
        },
        signer,
    ))?;

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

    emit!(LpFeesHarvested {
        launch: launch.key(),
        damm_pool: accounts.damm_pool.key(),
        position: accounts.position.key(),
        quote_amount,
        base_burned,
        vault_balance: vault_after,
    });
    Ok(())
}
