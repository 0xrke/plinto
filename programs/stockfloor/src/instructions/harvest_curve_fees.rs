use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::external::{DBC_EVENT_AUTHORITY, DBC_POOL_AUTHORITY, DBC_PROGRAM_ID};
use crate::constants::{CLAIMER_SEED, LAUNCH_SEED, PLATFORM_TREASURY};
use crate::dynamic_bonding_curve;
use crate::errors::StockfloorError;
use crate::events::{CurveFeesHarvested, FeesDistributed, FEE_SOURCE_CURVE};
use crate::state::Launch;
use crate::token_utils::{
    assert_quote_mint_transferable, assert_vault_not_frozen, assert_vault_unencumbered,
    burn_all_signed, is_payable_token_account, token_amount,
};

/// Permissionless: claim the partner share of DBC trading fees of the registered pool.
/// Any base goes to the claimer's base ATA and is burned. The claimer PDA (DBC `fee_claimer`)
/// signs the CPI; it does not own the vault.
///
/// Where the quote goes depends on the launch version:
/// - v3 (`fee_split_enabled`): straight into the platform treasury's quote ATA (the whole partner
///   share of presale fees is platform income). The vault is not passed to DBC and not touched.
///   If the platform account cannot receive (`is_payable_token_account`), the harvest fails with
///   `PlatformQuoteAccountUnavailable` and the fees stay claimable in DBC: they never fall back to
///   the vault. Allowed any time, before or after migration, on failed and successful presales.
/// - v2: straight into the vault (the original promise of those launches).
///
/// Account order:
///  0. `payer`                     signer, writable (rent for the claimer base ATA if missing)
///  1. `launch`                    writable
///  2. `claimer`                   PDA `["authority", config]`
///  3. `config`                    `launch.config`
///  4. `pool`                      writable, `launch.pool`
///  5. `vault`                     writable, `launch.vault` (quote destination)
///  6. `claimer_base_account`      writable, ATA(claimer, base_mint, SPL Token) (base destination)
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
/// 18. `platform_quote_account`    writable, ATA(PLATFORM_TREASURY, quote_mint, quote_token_program)
///     (v3 quote destination; must still be passed, unused, for v2)
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

    /// CHECK: claimer PDA, signer of the DBC CPI and of the base burn.
    #[account(seeds = [CLAIMER_SEED, launch.config.as_ref()], bump = launch.claimer_bump)]
    pub claimer: UncheckedAccount<'info>,

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
        associated_token::authority = claimer,
        associated_token::token_program = token_program,
    )]
    pub claimer_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

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

    /// CHECK: address-checked (the platform treasury's quote ATA); payability is checked in the
    /// handler for v3 launches.
    #[account(
        mut,
        address = launch.platform_quote_account() @ StockfloorError::PayeeAccountMismatch,
    )]
    pub platform_quote_account: UncheckedAccount<'info>,
}

impl<'info> HarvestCurveFees<'info> {
    /// DBC `claim_trading_fee` (partner share, everything claimable) with the quote going to
    /// `quote_destination`, then burn the claimer's base. Returns the base burned.
    fn claim_and_burn(&self, quote_destination: AccountInfo<'info>) -> Result<u64> {
        let config_key = self.launch.config;
        let bump = [self.launch.claimer_bump];
        let seeds: &[&[u8]] = &[CLAIMER_SEED, config_key.as_ref(), &bump];
        let signer = &[seeds];

        dynamic_bonding_curve::cpi::claim_trading_fee(
            CpiContext::new_with_signer(
                DBC_PROGRAM_ID,
                dynamic_bonding_curve::cpi::accounts::ClaimTradingFee {
                    pool_authority: self.dbc_pool_authority.to_account_info(),
                    config: self.config.to_account_info(),
                    pool: self.pool.to_account_info(),
                    token_a_account: self.claimer_base_account.to_account_info(),
                    token_b_account: quote_destination,
                    base_vault: self.dbc_base_vault.to_account_info(),
                    quote_vault: self.dbc_quote_vault.to_account_info(),
                    base_mint: self.base_mint.to_account_info(),
                    quote_mint: self.quote_mint.to_account_info(),
                    fee_claimer: self.claimer.to_account_info(),
                    token_base_program: self.token_program.to_account_info(),
                    token_quote_program: self.quote_token_program.to_account_info(),
                    event_authority: self.dbc_event_authority.to_account_info(),
                    program: self.dbc_program.to_account_info(),
                },
                signer,
            ),
            u64::MAX,
            u64::MAX,
        )?;

        burn_all_signed(
            &self.token_program.to_account_info(),
            &self.base_mint.to_account_info(),
            &self.claimer_base_account.to_account_info(),
            &self.claimer.to_account_info(),
            signer,
        )
    }
}

pub fn handle_harvest_curve_fees(ctx: Context<HarvestCurveFees>) -> Result<()> {
    if ctx.accounts.launch.fee_split_enabled() {
        harvest_to_platform(ctx)
    } else {
        harvest_to_vault(ctx)
    }
}

/// v3: the partner share of curve fees goes to the platform treasury; the vault is not touched.
fn harvest_to_platform(ctx: Context<HarvestCurveFees>) -> Result<()> {
    let accounts = &ctx.accounts;
    assert_quote_mint_transferable(&accounts.quote_mint.to_account_info())?;
    let platform = accounts.platform_quote_account.to_account_info();
    require!(
        is_payable_token_account(
            &platform,
            &PLATFORM_TREASURY,
            &accounts.launch.quote_mint,
            &accounts.launch.quote_token_program,
        ),
        StockfloorError::PlatformQuoteAccountUnavailable
    );
    let platform_before = token_amount(&platform)?;
    let base_burned = accounts.claim_and_burn(platform.clone())?;
    let received = token_amount(&platform)?
        .checked_sub(platform_before)
        .ok_or(StockfloorError::MathOverflow)?;
    let vault_balance = accounts.vault.amount;

    let launch = &mut ctx.accounts.launch;
    launch.total_platform_quote = launch.total_platform_quote.saturating_add(received);
    launch.total_burned_base = launch.total_burned_base.saturating_add(base_burned);

    emit!(CurveFeesHarvested {
        launch: launch.key(),
        pool: launch.pool,
        quote_amount: 0,
        base_burned,
        vault_balance,
    });
    emit!(FeesDistributed {
        launch: launch.key(),
        source: FEE_SOURCE_CURVE,
        received,
        platform_amount: received,
        creator_amount: 0,
        vault_amount: 0,
        platform_fallback: false,
        creator_fallback: false,
    });
    Ok(())
}

/// v2: the partner share of curve fees goes into the vault (unchanged behaviour).
fn harvest_to_vault(ctx: Context<HarvestCurveFees>) -> Result<()> {
    let accounts = &ctx.accounts;
    assert_quote_mint_transferable(&accounts.quote_mint.to_account_info())?;
    assert_vault_not_frozen(&accounts.vault.to_account_info())?;

    let vault_before = accounts.vault.amount;
    let base_burned = accounts.claim_and_burn(accounts.vault.to_account_info())?;

    // The vault was writable in a CPI into an upgradeable program: it must come back owned by the
    // vault authority and unencumbered.
    assert_vault_unencumbered(
        &accounts.vault.to_account_info(),
        &accounts.launch.vault_authority_key()?,
    )?;

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
