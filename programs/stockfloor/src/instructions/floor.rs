use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::LAUNCH_SEED;
use crate::errors::StockfloorError;
use crate::events::FloorSnapshot;
use crate::state::{FloorInfo, Launch};

/// Read-only view (use with `simulateTransaction`): returns `FloorInfo` via return data
/// and emits `FloorSnapshot`.
///
/// Account order:
/// 0. `launch`
/// 1. `vault`      `launch.vault`
/// 2. `base_mint`  `launch.base_mint`; before `register_pool` pass any account
///    (e.g. the system program) and `supply` is reported as 0
#[derive(Accounts)]
pub struct FloorView<'info> {
    #[account(seeds = [LAUNCH_SEED, launch.config.as_ref()], bump = launch.bump)]
    pub launch: Box<Account<'info, Launch>>,

    #[account(address = launch.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: checked in the handler against `launch.base_mint` (unset before registration).
    pub base_mint: UncheckedAccount<'info>,
}

pub fn handle_floor(ctx: Context<FloorView>) -> Result<FloorInfo> {
    let launch = &ctx.accounts.launch;
    let supply = if launch.is_pool_registered() {
        let info = ctx.accounts.base_mint.to_account_info();
        require_keys_eq!(
            info.key(),
            launch.base_mint,
            StockfloorError::FloorAccountMismatch
        );
        require_keys_eq!(
            *info.owner,
            spl_token::ID,
            StockfloorError::FloorAccountMismatch
        );
        let data = info.try_borrow_data()?;
        let mint = anchor_spl::token::Mint::try_deserialize(&mut &data[..])?;
        mint.supply
    } else {
        0
    };

    let result = FloorInfo {
        vault_raw: ctx.accounts.vault.amount,
        supply,
        exit_fee_bps: launch.exit_fee_bps,
    };
    emit!(FloorSnapshot {
        launch: launch.key(),
        vault_raw: result.vault_raw,
        supply: result.supply,
        exit_fee_bps: result.exit_fee_bps,
    });
    Ok(result)
}
