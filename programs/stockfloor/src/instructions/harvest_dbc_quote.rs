use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::external::{DBC_EVENT_AUTHORITY, DBC_POOL_AUTHORITY, DBC_PROGRAM_ID};
use crate::constants::{CLAIMER_SEED, LAUNCH_SEED};
use crate::dynamic_bonding_curve;
use crate::errors::StockfloorError;
use crate::events::{
    FeesDistributed, MigrationFeeHarvested, SurplusHarvested, FEE_SOURCE_MIGRATION,
};
use crate::external::{is_curve_complete, is_migration_complete, load_dbc_config, load_dbc_pool};
use crate::instructions::fee_split::SplitAccounts;
use crate::math::graduation_split;
use crate::state::Launch;
use crate::token_utils::{
    assert_quote_mint_transferable, assert_vault_not_frozen, assert_vault_unencumbered,
};

/// Checks shared by both DBC quote harvests. Returns whether the DBC pool is fully migrated
/// (latched into `Launch.migrated`) and the config's `migration_quote_threshold`.
fn dbc_preflight(
    quote_mint: &AccountInfo,
    vault: &AccountInfo,
    config: &AccountInfo,
    pool: &AccountInfo,
) -> Result<(bool, u64)> {
    assert_quote_mint_transferable(quote_mint)?;
    assert_vault_not_frozen(vault)?;
    let config = load_dbc_config(config)?;
    let pool = load_dbc_pool(pool)?;
    require!(
        is_curve_complete(&pool, &config),
        StockfloorError::CurveNotComplete
    );
    Ok((
        is_migration_complete(&pool),
        config.migration_quote_threshold,
    ))
}

/// Accounts of `harvest_surplus` (moves quote from the DBC quote vault straight into the floor
/// vault; the claimer PDA, DBC `fee_claimer`, signs the CPI and has no authority over the vault).
///
/// Account order:
///  0. `launch`               writable
///  1. `claimer`              PDA `["authority", config]`
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

    /// CHECK: claimer PDA, signer of the DBC CPI.
    #[account(seeds = [CLAIMER_SEED, launch.config.as_ref()], bump = launch.claimer_bump)]
    pub claimer: UncheckedAccount<'info>,

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

/// Accounts of `harvest_migration_fee`: the 11 accounts of `HarvestQuoteFromDbc` (same order)
/// plus the three accounts of the fee split. The claimer PDA (DBC `fee_claimer`) signs the CPI and
/// the transit payouts; it has no authority over the vault.
///
/// Account order:
///  0-10. as `HarvestQuoteFromDbc` (`vault` is still the v2 destination and the v3 vault payee)
/// 11. `claimer_quote_account`   writable, ATA(claimer, quote_mint, quote_token_program): v3 transit
/// 12. `creator_quote_account`   writable, ATA(launch.creator, quote_mint, quote_token_program)
/// 13. `platform_quote_account`  writable, ATA(PLATFORM_TREASURY, quote_mint, quote_token_program)
///
/// Accounts 11-13 are address-checked for every launch version and only used by v3 launches.
#[derive(Accounts)]
pub struct HarvestMigrationFee<'info> {
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = launch.is_pool_registered() @ StockfloorError::PoolNotRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: claimer PDA, signer of the DBC CPI and of the transit payouts.
    #[account(seeds = [CLAIMER_SEED, launch.config.as_ref()], bump = launch.claimer_bump)]
    pub claimer: UncheckedAccount<'info>,

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

    /// CHECK: address-checked transit account (created by `create_launch` for v3 launches);
    /// checked for encumbrances after the CPI.
    #[account(
        mut,
        address = launch.quote_ata(&claimer.key()) @ StockfloorError::PayeeAccountMismatch,
    )]
    pub claimer_quote_account: UncheckedAccount<'info>,

    /// CHECK: address-checked (the launch creator's quote ATA); payability checked before paying.
    #[account(
        mut,
        address = launch.creator_quote_account() @ StockfloorError::PayeeAccountMismatch,
    )]
    pub creator_quote_account: UncheckedAccount<'info>,

    /// CHECK: address-checked (the platform treasury's quote ATA); payability checked before paying.
    #[account(
        mut,
        address = launch.platform_quote_account() @ StockfloorError::PayeeAccountMismatch,
    )]
    pub platform_quote_account: UncheckedAccount<'info>,
}

impl<'info> HarvestQuoteFromDbc<'info> {
    /// Returns whether the DBC pool is fully migrated (latched into `Launch.migrated`).
    fn preflight(&self) -> Result<bool> {
        dbc_preflight(
            &self.quote_mint.to_account_info(),
            &self.vault.to_account_info(),
            &self.config.to_account_info(),
            &self.pool.to_account_info(),
        )
        .map(|(migrated, _)| migrated)
    }

    /// After the claimer-signed CPI: the vault must still be owned by the vault authority,
    /// unencumbered, and must not have lost quote. Returns `(delta, balance_after)`.
    fn vault_delta(&mut self, before: u64) -> Result<(u64, u64)> {
        assert_vault_unencumbered(
            &self.vault.to_account_info(),
            &self.launch.vault_authority_key()?,
        )?;
        self.vault.reload()?;
        let after = self.vault.amount;
        let delta = after
            .checked_sub(before)
            .ok_or(StockfloorError::VaultDecreased)?;
        Ok((delta, after))
    }
}

/// Permissionless: withdraw the partner migration fee (flag 0). Opens redemptions (together with a
/// completed migration).
///
/// - v3: into the transit, then split by `math::graduation_split` with `T` =
///   `migration_quote_threshold`: 5% of T to the platform, 5% of T to the creator (each capped by
///   what was received), the rest to the vault. An unpayable payee's share goes to the vault.
/// - v2: straight into the vault (unchanged).
pub fn handle_harvest_migration_fee(ctx: Context<HarvestMigrationFee>) -> Result<()> {
    require!(
        !ctx.accounts.launch.migration_fee_harvested,
        StockfloorError::MigrationFeeAlreadyHarvested
    );
    let accounts = &ctx.accounts;
    let (migrated, threshold) = dbc_preflight(
        &accounts.quote_mint.to_account_info(),
        &accounts.vault.to_account_info(),
        &accounts.config.to_account_info(),
        &accounts.pool.to_account_info(),
    )?;
    let fee_split = accounts.launch.fee_split_enabled();

    let config_key = accounts.launch.config;
    let bump = [accounts.launch.claimer_bump];
    let seeds: &[&[u8]] = &[CLAIMER_SEED, config_key.as_ref(), &bump];
    let signer = &[seeds];

    let claimer_info = accounts.claimer.to_account_info();
    let transit_info = accounts.claimer_quote_account.to_account_info();
    let platform_info = accounts.platform_quote_account.to_account_info();
    let creator_info = accounts.creator_quote_account.to_account_info();
    let vault_info = accounts.vault.to_account_info();
    let quote_mint_info = accounts.quote_mint.to_account_info();
    let quote_program_info = accounts.quote_token_program.to_account_info();
    let split_accounts = SplitAccounts {
        claimer: &claimer_info,
        transit: &transit_info,
        platform: &platform_info,
        creator: &creator_info,
        vault: &vault_info,
        quote_mint: &quote_mint_info,
        quote_token_program: &quote_program_info,
    };
    let baseline = if fee_split {
        Some(split_accounts.baseline()?)
    } else {
        None
    };
    let vault_before = accounts.vault.amount;

    dynamic_bonding_curve::cpi::withdraw_migration_fee(
        CpiContext::new_with_signer(
            DBC_PROGRAM_ID,
            dynamic_bonding_curve::cpi::accounts::WithdrawMigrationFee {
                pool_authority: accounts.dbc_pool_authority.to_account_info(),
                config: accounts.config.to_account_info(),
                virtual_pool: accounts.pool.to_account_info(),
                token_quote_account: if fee_split {
                    transit_info.clone()
                } else {
                    vault_info.clone()
                },
                quote_vault: accounts.dbc_quote_vault.to_account_info(),
                quote_mint: quote_mint_info.clone(),
                sender: claimer_info.clone(),
                token_quote_program: quote_program_info.clone(),
                event_authority: accounts.dbc_event_authority.to_account_info(),
                program: accounts.dbc_program.to_account_info(),
            },
            signer,
        ),
        0, // partner
    )?;

    let (vault_part, vault_after, distribution) = match baseline {
        Some(baseline) => {
            let received = split_accounts.received(&accounts.launch, &baseline)?;
            let split = graduation_split(threshold, received).map_err(StockfloorError::from)?;
            let d = split_accounts.distribute(
                &accounts.launch,
                &baseline,
                received,
                split,
                accounts.quote_mint.decimals,
                signer,
            )?;
            (d.vault, d.vault_balance, Some(d))
        }
        None => {
            // v2: the vault was writable in a CPI into an upgradeable program.
            assert_vault_unencumbered(&vault_info, &accounts.launch.vault_authority_key()?)?;
            let after = crate::token_utils::token_amount(&vault_info)?;
            let delta = after
                .checked_sub(vault_before)
                .ok_or(StockfloorError::VaultDecreased)?;
            (delta, after, None)
        }
    };

    let launch = &mut ctx.accounts.launch;
    launch.migration_fee_harvested = true;
    launch.migrated |= migrated;
    launch.total_harvested_quote = launch.total_harvested_quote.saturating_add(vault_part);
    if let Some(d) = distribution {
        launch.total_platform_quote = launch.total_platform_quote.saturating_add(d.platform);
        launch.total_creator_quote = launch.total_creator_quote.saturating_add(d.creator);
    }

    emit!(MigrationFeeHarvested {
        launch: launch.key(),
        pool: launch.pool,
        quote_amount: vault_part,
        vault_balance: vault_after,
    });
    if let Some(d) = distribution {
        emit!(FeesDistributed {
            launch: launch.key(),
            source: FEE_SOURCE_MIGRATION,
            received: d.received,
            platform_amount: d.platform,
            creator_amount: d.creator,
            vault_amount: d.vault,
            platform_fallback: d.platform_fallback,
            creator_fallback: d.creator_fallback,
        });
    }
    Ok(())
}

/// Permissionless: withdraw the partner share of the curve surplus into the vault.
pub fn handle_harvest_surplus(ctx: Context<HarvestQuoteFromDbc>) -> Result<()> {
    require!(
        !ctx.accounts.launch.surplus_harvested,
        StockfloorError::SurplusAlreadyHarvested
    );
    let migrated = ctx.accounts.preflight()?;

    let accounts = &ctx.accounts;
    let config_key = accounts.launch.config;
    let bump = [accounts.launch.claimer_bump];
    let seeds: &[&[u8]] = &[CLAIMER_SEED, config_key.as_ref(), &bump];
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
            fee_claimer: accounts.claimer.to_account_info(),
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
    launch.migrated |= migrated;
    launch.total_harvested_quote = launch.total_harvested_quote.saturating_add(quote_amount);

    emit!(SurplusHarvested {
        launch: launch.key(),
        pool: launch.pool,
        quote_amount,
        vault_balance: vault_after,
    });
    Ok(())
}
