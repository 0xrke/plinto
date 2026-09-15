//! Token helpers: quote-mint safety checks (Token-2022) and burning base tokens
//! held by the Authority.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{
        cpi_guard::CpiGuard, memo_transfer::MemoTransfer, pausable::PausableConfig,
        transfer_hook::TransferHook, BaseStateWithExtensions, StateWithExtensions,
    },
    state::{Account as SplAccount, AccountState, Mint as SplMint},
};
use anchor_spl::token_interface::{self, Burn};

use crate::errors::StockfloorError;

/// Fail early, with a clear error, when quote tokens cannot move:
/// - Token-2022 `Pausable` extension with `paused == true`;
/// - Token-2022 `TransferHook` extension with a non-null hook program (this program
///   does not forward extra hook accounts, so the transfer would fail anyway).
///
/// Legacy SPL Token mints have no extensions and always pass.
pub fn assert_quote_mint_transferable(mint: &AccountInfo) -> Result<()> {
    if *mint.owner != spl_token_2022::ID {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    check_token_2022_mint_data(&data).map_err(Into::into)
}

/// Pure check over raw Token-2022 mint data (unit tested).
pub fn check_token_2022_mint_data(data: &[u8]) -> std::result::Result<(), StockfloorError> {
    let state = StateWithExtensions::<SplMint>::unpack(data)
        .map_err(|_| StockfloorError::InvalidQuoteMintData)?;
    if let Ok(pausable) = state.get_extension::<PausableConfig>() {
        if bool::from(pausable.paused) {
            return Err(StockfloorError::QuoteMintPaused);
        }
    }
    if let Ok(hook) = state.get_extension::<TransferHook>() {
        if Option::<Pubkey>::from(hook.program_id).is_some() {
            return Err(StockfloorError::QuoteMintTransferHookUnsupported);
        }
    }
    Ok(())
}

/// Fail with a clear error when the vault token account is frozen by the issuer.
pub fn assert_vault_not_frozen(vault: &AccountInfo) -> Result<()> {
    let data = vault.try_borrow_data()?;
    let state = StateWithExtensions::<SplAccount>::unpack(&data)
        .map_err(|_| StockfloorError::InvalidTokenAccountData)?;
    require!(
        state.base.state != AccountState::Frozen,
        StockfloorError::VaultFrozen
    );
    Ok(())
}

/// Defence in depth after every CPI into DBC / DAMM v2 that the Authority signs while the
/// vault is writable. The Authority owns the vault, and its signer privilege carries into
/// those (upgradeable) programs, which could otherwise leave the vault encumbered without
/// changing its balance: an approved delegate, a close authority, a new owner (legacy SPL
/// accounts have no ImmutableOwner), CPI Guard (would block every PDA-signed `redeem`
/// transfer) or required incoming memos (would block harvests). Any of these makes the
/// harvest fail, so it rolls back atomically. Only `redeem` moves quote out of the vault,
/// and nothing in this program ever sets these fields, so an honest vault always passes.
pub fn assert_vault_unencumbered(vault: &AccountInfo, authority: &Pubkey) -> Result<()> {
    let data = vault.try_borrow_data()?;
    check_vault_account_data(&data, authority).map_err(Into::into)
}

/// Pure check over raw vault token account data (legacy SPL Token or Token-2022; unit tested).
pub fn check_vault_account_data(
    data: &[u8],
    authority: &Pubkey,
) -> std::result::Result<(), StockfloorError> {
    let state = StateWithExtensions::<SplAccount>::unpack(data)
        .map_err(|_| StockfloorError::InvalidTokenAccountData)?;
    let base = &state.base;
    if base.owner != *authority || base.delegate.is_some() || base.close_authority.is_some() {
        return Err(StockfloorError::VaultEncumbered);
    }
    if let Ok(guard) = state.get_extension::<CpiGuard>() {
        if bool::from(guard.lock_cpi) {
            return Err(StockfloorError::VaultEncumbered);
        }
    }
    if let Ok(memo) = state.get_extension::<MemoTransfer>() {
        if bool::from(memo.require_incoming_transfer_memos) {
            return Err(StockfloorError::VaultEncumbered);
        }
    }
    Ok(())
}

/// Burn the entire balance of `from` (a base-token account owned by the Authority),
/// signed by the Authority. Returns the amount burned.
pub fn burn_all_signed<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<u64> {
    let amount = {
        let data = from.try_borrow_data()?;
        StateWithExtensions::<SplAccount>::unpack(&data)
            .map_err(|_| StockfloorError::InvalidTokenAccountData)?
            .base
            .amount
    };
    if amount > 0 {
        token_interface::burn(
            CpiContext::new_with_signer(
                token_program.key(),
                Burn {
                    mint: mint.clone(),
                    from: from.clone(),
                    authority: authority.clone(),
                },
                signer_seeds,
            ),
            amount,
        )?;
    }
    Ok(amount)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::program_pack::Pack;
    use anchor_spl::token_2022::spl_token_2022::extension::{
        immutable_owner::ImmutableOwner,
        pausable::{PausableAccount, PausableConfig},
        transfer_hook::{TransferHook, TransferHookAccount},
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    };

    fn mint_with(
        extensions: &[ExtensionType],
        setup: impl FnOnce(&mut StateWithExtensionsMut<SplMint>),
    ) -> Vec<u8> {
        let len = ExtensionType::try_calculate_account_len::<SplMint>(extensions).unwrap();
        let mut data = vec![0u8; len];
        let mut state = StateWithExtensionsMut::<SplMint>::unpack_uninitialized(&mut data).unwrap();
        state.base.decimals = 8;
        state.base.is_initialized = true;
        state.base.supply = 1_000;
        state.pack_base();
        state.init_account_type().unwrap();
        setup(&mut state);
        data
    }

    #[test]
    fn plain_token_2022_mint_passes() {
        let data = mint_with(&[], |_| {});
        assert_eq!(check_token_2022_mint_data(&data), Ok(()));
        // A legacy-sized mint (82 bytes) also unpacks.
        let mut legacy = vec![0u8; SplMint::LEN];
        let m = SplMint {
            decimals: 6,
            is_initialized: true,
            ..Default::default()
        };
        SplMint::pack(m, &mut legacy).unwrap();
        assert_eq!(check_token_2022_mint_data(&legacy), Ok(()));
    }

    #[test]
    fn paused_mint_is_rejected() {
        let data = mint_with(&[ExtensionType::Pausable], |s| {
            let ext = s.init_extension::<PausableConfig>(true).unwrap();
            ext.authority = Some(Pubkey::new_unique()).try_into().unwrap();
            ext.paused = true.into();
        });
        assert_eq!(
            check_token_2022_mint_data(&data),
            Err(StockfloorError::QuoteMintPaused)
        );

        let data = mint_with(&[ExtensionType::Pausable], |s| {
            let ext = s.init_extension::<PausableConfig>(true).unwrap();
            ext.paused = false.into();
        });
        assert_eq!(check_token_2022_mint_data(&data), Ok(()));
    }

    #[test]
    fn active_transfer_hook_is_rejected_null_hook_passes() {
        // SPYx today: TransferHook extension with a null program id.
        let data = mint_with(&[ExtensionType::TransferHook], |s| {
            let ext = s.init_extension::<TransferHook>(true).unwrap();
            ext.authority = Some(Pubkey::new_unique()).try_into().unwrap();
            ext.program_id = Option::<Pubkey>::None.try_into().unwrap();
        });
        assert_eq!(check_token_2022_mint_data(&data), Ok(()));

        let data = mint_with(&[ExtensionType::TransferHook], |s| {
            let ext = s.init_extension::<TransferHook>(true).unwrap();
            ext.program_id = Some(Pubkey::new_unique()).try_into().unwrap();
        });
        assert_eq!(
            check_token_2022_mint_data(&data),
            Err(StockfloorError::QuoteMintTransferHookUnsupported)
        );
    }

    fn vault_with(
        authority: Pubkey,
        extensions: &[ExtensionType],
        setup: impl FnOnce(&mut StateWithExtensionsMut<SplAccount>),
    ) -> Vec<u8> {
        let len = ExtensionType::try_calculate_account_len::<SplAccount>(extensions).unwrap();
        let mut data = vec![0u8; len];
        let mut state =
            StateWithExtensionsMut::<SplAccount>::unpack_uninitialized(&mut data).unwrap();
        state.base.mint = Pubkey::new_unique();
        state.base.owner = authority;
        state.base.amount = 66_154_910;
        state.base.state = AccountState::Initialized;
        state.pack_base();
        state.init_account_type().unwrap();
        setup(&mut state);
        data
    }

    #[test]
    fn clean_vault_passes() {
        let authority = Pubkey::new_unique();
        // SPYx-like ATA: ImmutableOwner + TransferHookAccount + PausableAccount.
        let data = vault_with(
            authority,
            &[
                ExtensionType::ImmutableOwner,
                ExtensionType::TransferHookAccount,
                ExtensionType::PausableAccount,
            ],
            |s| {
                s.init_extension::<ImmutableOwner>(true).unwrap();
                s.init_extension::<TransferHookAccount>(true).unwrap();
                s.init_extension::<PausableAccount>(true).unwrap();
            },
        );
        assert_eq!(check_vault_account_data(&data, &authority), Ok(()));
        // Legacy SPL Token account (165 bytes, no extensions).
        let mut legacy = vec![0u8; SplAccount::LEN];
        let acc = SplAccount {
            mint: Pubkey::new_unique(),
            owner: authority,
            amount: 5,
            state: AccountState::Initialized,
            ..Default::default()
        };
        SplAccount::pack(acc, &mut legacy).unwrap();
        assert_eq!(check_vault_account_data(&legacy, &authority), Ok(()));
        // Disabled CPI guard / memo requirement pass.
        let data = vault_with(
            authority,
            &[ExtensionType::CpiGuard, ExtensionType::MemoTransfer],
            |s| {
                s.init_extension::<CpiGuard>(true).unwrap().lock_cpi = false.into();
                s.init_extension::<MemoTransfer>(true)
                    .unwrap()
                    .require_incoming_transfer_memos = false.into();
            },
        );
        assert_eq!(check_vault_account_data(&data, &authority), Ok(()));
    }

    #[test]
    fn encumbered_vault_is_rejected() {
        let authority = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let enc = Err(StockfloorError::VaultEncumbered);

        let data = vault_with(authority, &[], |s| {
            s.base.delegate = Some(other).into();
            s.base.delegated_amount = 1;
            s.pack_base();
        });
        assert_eq!(check_vault_account_data(&data, &authority), enc);

        let data = vault_with(authority, &[], |s| {
            s.base.close_authority = Some(other).into();
            s.pack_base();
        });
        assert_eq!(check_vault_account_data(&data, &authority), enc);

        let data = vault_with(authority, &[], |_| {});
        assert_eq!(check_vault_account_data(&data, &other), enc);

        let data = vault_with(authority, &[ExtensionType::CpiGuard], |s| {
            s.init_extension::<CpiGuard>(true).unwrap().lock_cpi = true.into();
        });
        assert_eq!(check_vault_account_data(&data, &authority), enc);

        let data = vault_with(authority, &[ExtensionType::MemoTransfer], |s| {
            s.init_extension::<MemoTransfer>(true)
                .unwrap()
                .require_incoming_transfer_memos = true.into();
        });
        assert_eq!(check_vault_account_data(&data, &authority), enc);

        assert_eq!(
            check_vault_account_data(&[0u8; 10], &authority),
            Err(StockfloorError::InvalidTokenAccountData)
        );
    }

    #[test]
    fn garbage_mint_data_is_rejected() {
        assert_eq!(
            check_token_2022_mint_data(&[1u8; 10]),
            Err(StockfloorError::InvalidQuoteMintData)
        );
    }
}
