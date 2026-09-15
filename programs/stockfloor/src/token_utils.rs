//! Token helpers: quote-mint safety checks (Token-2022) and burning base tokens
//! held by the Authority.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{
        pausable::PausableConfig, transfer_hook::TransferHook, BaseStateWithExtensions,
        StateWithExtensions,
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
        .map_err(|_| StockfloorError::InvalidQuoteMintData)?;
    require!(
        state.base.state != AccountState::Frozen,
        StockfloorError::VaultFrozen
    );
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
        StateWithExtensions::<SplAccount>::unpack(&data)?.base.amount
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
    use anchor_spl::token_2022::spl_token_2022::{
        extension::{
            pausable::PausableConfig, transfer_hook::TransferHook, ExtensionType,
            StateWithExtensionsMut, BaseStateWithExtensionsMut,
        },
    };
    use anchor_lang::solana_program::program_pack::Pack;

    fn mint_with(extensions: &[ExtensionType], setup: impl FnOnce(&mut StateWithExtensionsMut<SplMint>)) -> Vec<u8> {
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
        let m = SplMint { decimals: 6, is_initialized: true, ..Default::default() };
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
        assert_eq!(check_token_2022_mint_data(&data), Err(StockfloorError::QuoteMintPaused));

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

    #[test]
    fn garbage_mint_data_is_rejected() {
        assert_eq!(
            check_token_2022_mint_data(&[1u8; 10]),
            Err(StockfloorError::InvalidQuoteMintData)
        );
    }
}
