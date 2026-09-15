use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{CLAIMER_SEED, LAUNCH_SEED, LAUNCH_VERSION, VAULT_AUTHORITY_SEED};
use crate::errors::StockfloorError;
use crate::events::LaunchCreated;
use crate::external::{load_dbc_config, validate_launch_config};
use crate::state::Launch;
use crate::token_utils::assert_vault_unencumbered;

/// Create the launch registry and the floor vault for a freshly created DBC config.
///
/// The creator commits to the base mint of the launch's DBC pool here. DBC derives the
/// pool from `(config, base_mint, quote_mint)` and pool creation needs the base mint
/// keypair and the creator's signature, so exactly one pool can ever match, and
/// `register_pool` can be permissionless: the creator cannot withhold registration.
///
/// Account order (clients must follow it):
///  0. `payer`                    signer, writable: pays rent for `launch` and `vault`
///  1. `creator`                  signer: recorded as the launch creator
///  2. `config`                   signer: the DBC config keypair (proves the caller created it)
///  3. `claimer`                  PDA `["authority", config]`: the config's fee_claimer and
///     leftover_receiver
///  4. `vault_authority`          PDA `["vault_authority", config]` (owner of the vault)
///  5. `launch`                   writable: PDA `["launch", config]`, created here
///  6. `quote_mint`               must equal `config.quote_mint`
///  7. `base_mint`                the base mint of the launch's DBC pool (may not exist yet)
///  8. `vault`                    writable: ATA(vault_authority, quote_mint, quote_token_program)
///  9. `quote_token_program`      owner of `quote_mint` (Token or Token-2022)
/// 10. `associated_token_program`
/// 11. `system_program`
#[derive(Accounts)]
pub struct CreateLaunch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub creator: Signer<'info>,

    /// DBC PoolConfig; owner, discriminator, size and fields are validated in the handler.
    /// The config keypair must sign so that nobody can front-run `create_launch` for a
    /// config they did not create.
    pub config: Signer<'info>,

    /// CHECK: claimer PDA (DBC fee_claimer / leftover_receiver, CPI signer); holds no data.
    #[account(seeds = [CLAIMER_SEED, config.key().as_ref()], bump)]
    pub claimer: UncheckedAccount<'info>,

    /// CHECK: vault authority PDA (owner of the vault, signs only `redeem` payouts); holds no data.
    #[account(seeds = [VAULT_AUTHORITY_SEED, config.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Launch::INIT_SPACE,
        seeds = [LAUNCH_SEED, config.key().as_ref()],
        bump,
    )]
    pub launch: Box<Account<'info, Launch>>,

    #[account(mint::token_program = quote_token_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: only its address is committed; `register_pool` validates the mint and its pool.
    pub base_mint: UncheckedAccount<'info>,

    /// `init_if_needed` so that a third party pre-creating the ATA cannot block the launch.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = quote_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_launch(ctx: Context<CreateLaunch>, exit_fee_bps: u16) -> Result<()> {
    let base_mint = ctx.accounts.base_mint.key();
    require!(
        base_mint != Pubkey::default() && base_mint != ctx.accounts.quote_mint.key(),
        StockfloorError::InvalidBaseMint
    );
    let (migration_fee_percentage, migration_quote_threshold) = {
        let config = load_dbc_config(&ctx.accounts.config.to_account_info())?;
        validate_launch_config(
            &config,
            &ctx.accounts.claimer.key(),
            &ctx.accounts.quote_mint.key(),
            exit_fee_bps,
        )?;
        (
            config.migration_fee_percentage,
            config.migration_quote_threshold,
        )
    };

    // A vault pre-created by a third party (canonical ATA) must not come with a delegate, close
    // authority, CPI Guard or required memos (only its owner could have set them, but check).
    assert_vault_unencumbered(
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.vault_authority.key(),
    )?;

    let now = Clock::get()?.unix_timestamp;
    let quote_token_program = *ctx.accounts.quote_mint.to_account_info().owner;

    let launch = &mut ctx.accounts.launch;
    launch.version = LAUNCH_VERSION;
    launch.bump = ctx.bumps.launch;
    launch.claimer_bump = ctx.bumps.claimer;
    launch.vault_authority_bump = ctx.bumps.vault_authority;
    launch.exit_fee_bps = exit_fee_bps;
    launch.migration_fee_harvested = false;
    launch.surplus_harvested = false;
    launch.migrated = false;
    launch.config = ctx.accounts.config.key();
    launch.creator = ctx.accounts.creator.key();
    launch.pool = Pubkey::default();
    launch.base_mint = base_mint;
    launch.quote_mint = ctx.accounts.quote_mint.key();
    launch.quote_token_program = quote_token_program;
    launch.vault = ctx.accounts.vault.key();
    launch.created_at = now;
    launch.total_harvested_quote = 0;
    launch.total_burned_base = 0;
    launch.total_redeemed_base = 0;
    launch.total_redeemed_quote = 0;
    launch.total_exit_fees = 0;
    launch.reserved = [0u8; 62];

    emit!(LaunchCreated {
        launch: launch.key(),
        config: launch.config,
        creator: launch.creator,
        claimer: ctx.accounts.claimer.key(),
        vault_authority: ctx.accounts.vault_authority.key(),
        quote_mint: launch.quote_mint,
        base_mint,
        quote_token_program,
        vault: launch.vault,
        exit_fee_bps,
        migration_fee_percentage,
        migration_quote_threshold,
        created_at: now,
    });
    Ok(())
}
