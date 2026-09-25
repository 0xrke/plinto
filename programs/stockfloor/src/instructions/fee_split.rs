//! Fee split out of the claimer's transit account (launch v3).
//!
//! DBC and DAMM v2 pay a harvest as one lump into one account, so v3 harvests that split
//! (`harvest_migration_fee`, `harvest_lp_fees`) CPI into the transit account
//! `ATA(claimer, quote_mint, quote_token_program)` and then the claimer pays, in this order:
//! the platform, the creator, and the vault, which receives everything left in the transit
//! (its share, every rounding unit, any payee fallback and any balance the transit already held).
//! The transit ends at 0 and the vault grows by exactly its part, or the instruction fails.
//!
//! A payee whose account cannot receive (`is_payable_token_account`: closed, frozen, wrong owner
//! or mint, required memo, confidential-only credits) is skipped and its share goes to the vault,
//! so neither the platform nor the creator can block a harvest (and with it `redeem`).
//!
//! Quote only ever leaves the transit here, and only to the three address-checked payees. The vault
//! is only ever a destination.

use anchor_lang::prelude::*;

use crate::constants::PLATFORM_TREASURY;
use crate::errors::StockfloorError;
use crate::math::FeeSplit;
use crate::state::Launch;
use crate::token_utils::{
    assert_transit_unencumbered, assert_vault_unencumbered, is_payable_token_account,
    pay_from_claimer, token_amount,
};

/// The accounts a split pays through. Every key is address-checked by the instruction's accounts
/// struct before this runs.
pub struct SplitAccounts<'a, 'info> {
    pub claimer: &'a AccountInfo<'info>,
    pub transit: &'a AccountInfo<'info>,
    pub platform: &'a AccountInfo<'info>,
    pub creator: &'a AccountInfo<'info>,
    pub vault: &'a AccountInfo<'info>,
    pub quote_mint: &'a AccountInfo<'info>,
    pub quote_token_program: &'a AccountInfo<'info>,
}

/// What a split actually paid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Distribution {
    /// Quote the harvest CPI put into the transit.
    pub received: u64,
    pub platform: u64,
    pub creator: u64,
    /// Vault part: its share, any fallback and the swept pre-existing transit balance.
    pub vault: u64,
    pub platform_fallback: bool,
    pub creator_fallback: bool,
    /// Vault balance after the split.
    pub vault_balance: u64,
}

/// Balances taken before the harvest CPI.
#[derive(Debug, Clone, Copy)]
pub struct SplitBaseline {
    pub transit: u64,
    pub vault: u64,
}

impl<'a, 'info> SplitAccounts<'a, 'info> {
    /// Balances before the CPI into the transit.
    pub fn baseline(&self) -> Result<SplitBaseline> {
        Ok(SplitBaseline {
            transit: token_amount(self.transit)?,
            vault: token_amount(self.vault)?,
        })
    }

    /// Quote the CPI put into the transit. Checks the transit came back unencumbered first.
    pub fn received(&self, launch: &Launch, baseline: &SplitBaseline) -> Result<u64> {
        assert_transit_unencumbered(self.transit, &launch.claimer_key()?)?;
        token_amount(self.transit)?
            .checked_sub(baseline.transit)
            .ok_or_else(|| StockfloorError::MathOverflow.into())
    }

    /// Pay `split` (which must sum to `received`) out of the transit: platform, then creator, then
    /// the vault takes everything left. Unpayable payees fall back to the vault. Checks the transit
    /// ends empty and the vault grew by exactly its part.
    pub fn distribute(
        &self,
        launch: &Launch,
        baseline: &SplitBaseline,
        received: u64,
        split: FeeSplit,
        decimals: u8,
        claimer_signer: &[&[&[u8]]],
    ) -> Result<Distribution> {
        require!(
            split.total().map_err(StockfloorError::from)? == received,
            StockfloorError::MathOverflow
        );
        let quote_mint = &launch.quote_mint;
        let quote_program = &launch.quote_token_program;

        let platform_ok = split.platform == 0
            || is_payable_token_account(
                self.platform,
                &PLATFORM_TREASURY,
                quote_mint,
                quote_program,
            );
        let creator_ok = split.creator == 0
            || is_payable_token_account(self.creator, &launch.creator, quote_mint, quote_program);
        let platform = if platform_ok { split.platform } else { 0 };
        let creator = if creator_ok { split.creator } else { 0 };

        self.pay(self.platform, platform, decimals, claimer_signer)?;
        self.pay(self.creator, creator, decimals, claimer_signer)?;
        // The vault takes everything left: its share, the fallbacks and any swept balance.
        let vault = token_amount(self.transit)?;
        self.pay(self.vault, vault, decimals, claimer_signer)?;

        require!(
            token_amount(self.transit)? == 0,
            StockfloorError::TransitNotEmptied
        );
        let expected_vault = received
            .checked_add(baseline.transit)
            .and_then(|x| x.checked_sub(platform))
            .and_then(|x| x.checked_sub(creator))
            .ok_or(StockfloorError::MathOverflow)?;
        require!(
            vault == expected_vault,
            StockfloorError::VaultBalanceMismatch
        );
        assert_vault_unencumbered(self.vault, &launch.vault_authority_key()?)?;
        let vault_balance = token_amount(self.vault)?;
        require!(
            vault_balance.checked_sub(baseline.vault) == Some(vault),
            StockfloorError::VaultBalanceMismatch
        );

        Ok(Distribution {
            received,
            platform,
            creator,
            vault,
            platform_fallback: !platform_ok,
            creator_fallback: !creator_ok,
            vault_balance,
        })
    }

    fn pay(
        &self,
        to: &AccountInfo<'info>,
        amount: u64,
        decimals: u8,
        claimer_signer: &[&[&[u8]]],
    ) -> Result<()> {
        pay_from_claimer(
            self.quote_token_program,
            self.transit,
            self.quote_mint,
            to,
            self.claimer,
            claimer_signer,
            amount,
            decimals,
        )
    }
}
