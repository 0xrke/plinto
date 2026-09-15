use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{CLAIMER_SEED, LAUNCH_SEED};
use crate::errors::StockfloorError;
use crate::events::ClaimerBaseBurned;
use crate::state::Launch;
use crate::token_utils::burn_all_signed;

/// Permissionless: burn every base token held by the claimer PDA's base ATA.
///
/// The harvests that can receive base tokens (`harvest_curve_fees`, `harvest_lp_fees`) burn them
/// in the same instruction. This instruction covers base tokens that reach the claimer's base ATA
/// any other way (a plain transfer, i.e. a donation), so `mint.supply` stays the floor
/// denominator of circulating tokens. It needs no external program and no DBC state.
///
/// Replaces `harvest_leftover` (M1): DBC `withdraw_leftover` only applies to fixed-supply configs,
/// which `create_launch` rejects, so the CPI was unreachable.
///
/// Account order:
/// 0. `launch`                writable (counter)
/// 1. `claimer`               PDA `["authority", config]`, signer of the burn
/// 2. `claimer_base_account`  writable, ATA(claimer, base_mint, SPL Token); must exist
/// 3. `base_mint`             writable, `launch.base_mint`
/// 4. `token_program`         SPL Token
#[derive(Accounts)]
pub struct BurnClaimerBase<'info> {
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: claimer PDA, signer of the burn.
    #[account(seeds = [CLAIMER_SEED, launch.config.as_ref()], bump = launch.claimer_bump)]
    pub claimer: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = claimer,
        associated_token::token_program = token_program,
    )]
    pub claimer_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = launch.base_mint @ StockfloorError::BaseMintMismatch)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_burn_claimer_base(ctx: Context<BurnClaimerBase>) -> Result<()> {
    let accounts = &ctx.accounts;
    let config_key = accounts.launch.config;
    let bump = [accounts.launch.claimer_bump];
    let seeds: &[&[u8]] = &[CLAIMER_SEED, config_key.as_ref(), &bump];

    let base_burned = burn_all_signed(
        &accounts.token_program.to_account_info(),
        &accounts.base_mint.to_account_info(),
        &accounts.claimer_base_account.to_account_info(),
        &accounts.claimer.to_account_info(),
        &[seeds],
    )?;

    let launch = &mut ctx.accounts.launch;
    launch.total_burned_base = launch.total_burned_base.saturating_add(base_burned);

    emit!(ClaimerBaseBurned {
        launch: launch.key(),
        base_mint: launch.base_mint,
        base_burned,
    });
    Ok(())
}
