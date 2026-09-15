//! M1 fork spike.
//!
//! Proves that a PDA of our own program can be the Meteora DBC partner `fee_claimer`
//! (and `leftover_receiver`) and harvest, via `invoke_signed`:
//! - DBC `claim_trading_fee` (partner trading fees, pre-migration),
//! - DBC `withdraw_migration_fee(flag = 0)` (partner migration fee),
//! - DAMM v2 `claim_position_fee` for a position whose NFT the PDA owns (post-migration).
//!
//! The PDA is `["authority", dbc_config]`. Destination token accounts must be owned by the PDA.
//! Every instruction is permissionless: the caller only pays the transaction fee, funds can only
//! move into PDA-owned token accounts.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

declare_id!("JDizjXTevp3bsexc4cxHbNPjMgXPhMewwkY34JnZSQFh");

declare_program!(dynamic_bonding_curve);
declare_program!(cp_amm);

pub const AUTHORITY_SEED: &[u8] = b"authority";

/// DBC `withdraw_migration_fee` flag for the partner side.
pub const PARTNER_FLAG: u8 = 0;

#[program]
pub mod spike {
    use super::*;

    /// CPI DBC `claim_trading_fee` as the partner fee claimer (PDA signer).
    pub fn claim_partner_trading_fee(
        ctx: Context<ClaimPartnerTradingFee>,
        max_base_amount: u64,
        max_quote_amount: u64,
    ) -> Result<()> {
        let config_key = ctx.accounts.config.key();
        let bump = [ctx.bumps.authority];
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];

        let base_before = ctx.accounts.token_base_account.amount;
        let quote_before = ctx.accounts.token_quote_account.amount;

        let accounts = dynamic_bonding_curve::cpi::accounts::ClaimTradingFee {
            pool_authority: ctx.accounts.dbc_pool_authority.to_account_info(),
            config: ctx.accounts.config.to_account_info(),
            pool: ctx.accounts.virtual_pool.to_account_info(),
            token_a_account: ctx.accounts.token_base_account.to_account_info(),
            token_b_account: ctx.accounts.token_quote_account.to_account_info(),
            base_vault: ctx.accounts.base_vault.to_account_info(),
            quote_vault: ctx.accounts.quote_vault.to_account_info(),
            base_mint: ctx.accounts.base_mint.to_account_info(),
            quote_mint: ctx.accounts.quote_mint.to_account_info(),
            fee_claimer: ctx.accounts.authority.to_account_info(),
            token_base_program: ctx.accounts.token_base_program.to_account_info(),
            token_quote_program: ctx.accounts.token_quote_program.to_account_info(),
            event_authority: ctx.accounts.dbc_event_authority.to_account_info(),
            program: ctx.accounts.dbc_program.to_account_info(),
        };
        dynamic_bonding_curve::cpi::claim_trading_fee(
            CpiContext::new_with_signer(dynamic_bonding_curve::ID, accounts, &[seeds]),
            max_base_amount,
            max_quote_amount,
        )?;

        ctx.accounts.token_base_account.reload()?;
        ctx.accounts.token_quote_account.reload()?;
        let base_claimed = ctx.accounts.token_base_account.amount - base_before;
        let quote_claimed = ctx.accounts.token_quote_account.amount - quote_before;
        emit!(PartnerTradingFeeClaimed {
            config: config_key,
            virtual_pool: ctx.accounts.virtual_pool.key(),
            base_claimed,
            quote_claimed,
        });
        Ok(())
    }

    /// CPI DBC `withdraw_migration_fee(flag = 0)` as the partner fee claimer (PDA signer).
    pub fn withdraw_partner_migration_fee(ctx: Context<WithdrawPartnerMigrationFee>) -> Result<()> {
        let config_key = ctx.accounts.config.key();
        let bump = [ctx.bumps.authority];
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];

        let quote_before = ctx.accounts.token_quote_account.amount;

        let accounts = dynamic_bonding_curve::cpi::accounts::WithdrawMigrationFee {
            pool_authority: ctx.accounts.dbc_pool_authority.to_account_info(),
            config: ctx.accounts.config.to_account_info(),
            virtual_pool: ctx.accounts.virtual_pool.to_account_info(),
            token_quote_account: ctx.accounts.token_quote_account.to_account_info(),
            quote_vault: ctx.accounts.quote_vault.to_account_info(),
            quote_mint: ctx.accounts.quote_mint.to_account_info(),
            sender: ctx.accounts.authority.to_account_info(),
            token_quote_program: ctx.accounts.token_quote_program.to_account_info(),
            event_authority: ctx.accounts.dbc_event_authority.to_account_info(),
            program: ctx.accounts.dbc_program.to_account_info(),
        };
        dynamic_bonding_curve::cpi::withdraw_migration_fee(
            CpiContext::new_with_signer(dynamic_bonding_curve::ID, accounts, &[seeds]),
            PARTNER_FLAG,
        )?;

        ctx.accounts.token_quote_account.reload()?;
        let quote_received = ctx.accounts.token_quote_account.amount - quote_before;
        emit!(PartnerMigrationFeeWithdrawn {
            config: config_key,
            virtual_pool: ctx.accounts.virtual_pool.key(),
            quote_received,
        });
        Ok(())
    }

    /// CPI DAMM v2 `claim_position_fee` for a position whose NFT account is owned by the PDA.
    pub fn claim_damm_position_fee(ctx: Context<ClaimDammPositionFee>) -> Result<()> {
        let config_key = ctx.accounts.config.key();
        let bump = [ctx.bumps.authority];
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, config_key.as_ref(), &bump];

        let a_before = ctx.accounts.token_a_account.amount;
        let b_before = ctx.accounts.token_b_account.amount;

        let accounts = cp_amm::cpi::accounts::ClaimPositionFee {
            pool_authority: ctx.accounts.damm_pool_authority.to_account_info(),
            pool: ctx.accounts.pool.to_account_info(),
            position: ctx.accounts.position.to_account_info(),
            token_a_account: ctx.accounts.token_a_account.to_account_info(),
            token_b_account: ctx.accounts.token_b_account.to_account_info(),
            token_a_vault: ctx.accounts.token_a_vault.to_account_info(),
            token_b_vault: ctx.accounts.token_b_vault.to_account_info(),
            token_a_mint: ctx.accounts.token_a_mint.to_account_info(),
            token_b_mint: ctx.accounts.token_b_mint.to_account_info(),
            position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
            signer: ctx.accounts.authority.to_account_info(),
            token_a_program: ctx.accounts.token_a_program.to_account_info(),
            token_b_program: ctx.accounts.token_b_program.to_account_info(),
            event_authority: ctx.accounts.damm_event_authority.to_account_info(),
            program: ctx.accounts.damm_program.to_account_info(),
        };
        cp_amm::cpi::claim_position_fee(CpiContext::new_with_signer(
            cp_amm::ID,
            accounts,
            &[seeds],
        ))?;

        ctx.accounts.token_a_account.reload()?;
        ctx.accounts.token_b_account.reload()?;
        emit!(DammPositionFeeClaimed {
            config: config_key,
            position: ctx.accounts.position.key(),
            token_a_claimed: ctx.accounts.token_a_account.amount - a_before,
            token_b_claimed: ctx.accounts.token_b_account.amount - b_before,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ClaimPartnerTradingFee<'info> {
    /// CHECK: DBC config; DBC itself validates it against the pool.
    #[account(owner = dynamic_bonding_curve::ID)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: PDA signer, set as DBC `fee_claimer`.
    #[account(seeds = [AUTHORITY_SEED, config.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: DBC pool authority, validated by DBC.
    pub dbc_pool_authority: UncheckedAccount<'info>,

    /// CHECK: DBC virtual pool, validated by DBC.
    #[account(mut)]
    pub virtual_pool: UncheckedAccount<'info>,

    #[account(mut, token::authority = authority, token::mint = base_mint, token::token_program = token_base_program)]
    pub token_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::authority = authority, token::mint = quote_mint, token::token_program = token_quote_program)]
    pub token_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by DBC.
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,

    /// CHECK: validated by DBC.
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_base_program: Interface<'info, TokenInterface>,
    pub token_quote_program: Interface<'info, TokenInterface>,

    /// CHECK: DBC event authority, validated by DBC.
    pub dbc_event_authority: UncheckedAccount<'info>,

    /// CHECK: DBC program.
    #[account(address = dynamic_bonding_curve::ID)]
    pub dbc_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WithdrawPartnerMigrationFee<'info> {
    /// CHECK: DBC config; DBC validates it against the pool.
    #[account(owner = dynamic_bonding_curve::ID)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: PDA signer, set as DBC `fee_claimer`.
    #[account(seeds = [AUTHORITY_SEED, config.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: DBC pool authority, validated by DBC.
    pub dbc_pool_authority: UncheckedAccount<'info>,

    /// CHECK: DBC virtual pool, validated by DBC.
    #[account(mut)]
    pub virtual_pool: UncheckedAccount<'info>,

    #[account(mut, token::authority = authority, token::mint = quote_mint, token::token_program = token_quote_program)]
    pub token_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by DBC.
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_quote_program: Interface<'info, TokenInterface>,

    /// CHECK: DBC event authority, validated by DBC.
    pub dbc_event_authority: UncheckedAccount<'info>,

    /// CHECK: DBC program.
    #[account(address = dynamic_bonding_curve::ID)]
    pub dbc_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimDammPositionFee<'info> {
    /// CHECK: DBC config used only to derive the PDA signer.
    #[account(owner = dynamic_bonding_curve::ID)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: PDA signer, owner of the position NFT account.
    #[account(seeds = [AUTHORITY_SEED, config.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: DAMM v2 pool authority, validated by DAMM v2.
    pub damm_pool_authority: UncheckedAccount<'info>,

    /// CHECK: DAMM v2 pool, validated by DAMM v2.
    pub pool: UncheckedAccount<'info>,

    /// CHECK: DAMM v2 position, validated by DAMM v2.
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    #[account(mut, token::authority = authority, token::mint = token_a_mint, token::token_program = token_a_program)]
    pub token_a_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::authority = authority, token::mint = token_b_mint, token::token_program = token_b_program)]
    pub token_b_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated by DAMM v2.
    #[account(mut)]
    pub token_a_vault: UncheckedAccount<'info>,

    /// CHECK: validated by DAMM v2.
    #[account(mut)]
    pub token_b_vault: UncheckedAccount<'info>,

    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: position NFT token account; DAMM v2 checks it holds the position NFT and is owned by the signer.
    pub position_nft_account: UncheckedAccount<'info>,

    pub token_a_program: Interface<'info, TokenInterface>,
    pub token_b_program: Interface<'info, TokenInterface>,

    /// CHECK: DAMM v2 event authority, validated by DAMM v2.
    pub damm_event_authority: UncheckedAccount<'info>,

    /// CHECK: DAMM v2 program.
    #[account(address = cp_amm::ID)]
    pub damm_program: UncheckedAccount<'info>,
}

#[event]
pub struct PartnerTradingFeeClaimed {
    pub config: Pubkey,
    pub virtual_pool: Pubkey,
    pub base_claimed: u64,
    pub quote_claimed: u64,
}

#[event]
pub struct PartnerMigrationFeeWithdrawn {
    pub config: Pubkey,
    pub virtual_pool: Pubkey,
    pub quote_received: u64,
}

#[event]
pub struct DammPositionFeeClaimed {
    pub config: Pubkey,
    pub position: Pubkey,
    pub token_a_claimed: u64,
    pub token_b_claimed: u64,
}
