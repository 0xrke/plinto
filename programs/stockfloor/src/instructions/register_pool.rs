use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::constants::external::MPL_TOKEN_METADATA_ID;
use crate::constants::LAUNCH_SEED;
use crate::errors::StockfloorError;
use crate::events::PoolRegistered;
use crate::external::{load_dbc_config, load_dbc_pool, DBC_POOL_TYPE_SPL_TOKEN};
use crate::reserved_names::{is_reserved_token_name, metadata_name_and_symbol};
use crate::state::Launch;

/// Permissionless: record the canonical DBC virtual pool of a launch (once).
///
/// `create_launch` committed the base mint, and DBC derives the pool address from
/// `(config, base_mint, quote_mint)`, so exactly one pool can match: the one created with
/// the base mint keypair (which only the launch creator's client holds). Anyone can
/// therefore register it, and the creator cannot hold the migration fee hostage, neither
/// by never registering nor by creating the pool under another creator key (`pool.creator`
/// is deliberately not compared: it only decides who receives the creator's own DBC fee
/// share). Other pools on the same config use other base mints and are ignored forever.
///
/// Reserved names: the base mint's Metaplex metadata (created by DBC in the same instruction as the
/// pool, immutable) must not imitate the platform brand (`reserved_names`). A pool whose name or
/// symbol is reserved can never be registered, so it never earns or pays out anything through this
/// program. The check runs last, after every pool and mint check.
///
/// Account order:
/// 0. `launch`     writable: PDA `["launch", config]`
/// 1. `config`     `launch.config`
/// 2. `pool`       DBC VirtualPool on `config` for `launch.base_mint`
/// 3. `base_mint`  `launch.base_mint`, SPL Token mint without mint/freeze authority
/// 4. `token_program`
/// 5. `base_mint_metadata` Metaplex metadata of `base_mint` (the PDA `["metadata", metadata program,
///    base_mint]`; checked by owner, key byte and stored mint)
///    (appended last, so clients built before it fail with `AccountNotEnoughKeys`)
#[derive(Accounts)]
pub struct RegisterPool<'info> {
    #[account(
        mut,
        seeds = [LAUNCH_SEED, launch.config.as_ref()],
        bump = launch.bump,
        constraint = !launch.is_pool_registered() @ StockfloorError::PoolAlreadyRegistered,
    )]
    pub launch: Box<Account<'info, Launch>>,

    /// CHECK: address-checked against the launch; decoded in the handler.
    #[account(address = launch.config @ StockfloorError::InvalidDbcConfig)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: DBC VirtualPool; owner, discriminator, size and fields validated in the handler.
    pub pool: UncheckedAccount<'info>,

    #[account(
        address = launch.base_mint @ StockfloorError::BaseMintMismatch,
        mint::token_program = token_program,
    )]
    pub base_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,

    /// CHECK: Metaplex metadata of the base mint; owner, key byte, mint and field lengths validated
    /// in the handler.
    pub base_mint_metadata: UncheckedAccount<'info>,
}

pub fn handle_register_pool(ctx: Context<RegisterPool>) -> Result<()> {
    let config = load_dbc_config(&ctx.accounts.config.to_account_info())?;
    let pool = load_dbc_pool(&ctx.accounts.pool.to_account_info())?;
    let launch = &mut ctx.accounts.launch;
    let base_mint = &ctx.accounts.base_mint;

    require_keys_eq!(
        pool.pool_state.config,
        launch.config,
        StockfloorError::PoolConfigMismatch
    );
    // The committed base mint identifies the one DBC pool of this launch.
    require_keys_eq!(
        pool.pool_state.base_mint,
        base_mint.key(),
        StockfloorError::BaseMintMismatch
    );
    require!(
        pool.pool_state.pool_type == DBC_POOL_TYPE_SPL_TOKEN,
        StockfloorError::PoolTypeNotSplToken
    );
    require!(
        base_mint.decimals == config.token_decimal,
        StockfloorError::BaseMintDecimalsMismatch
    );
    // DBC revokes the mint authority in `initialize_virtual_pool_with_spl_token`; a live
    // mint authority could mint tokens and drain the vault through `redeem`.
    require!(
        base_mint.mint_authority.is_none(),
        StockfloorError::BaseMintAuthorityNotRevoked
    );
    require!(
        base_mint.freeze_authority.is_none(),
        StockfloorError::BaseMintHasFreezeAuthority
    );

    check_token_name(&ctx.accounts.base_mint_metadata, &base_mint.key())?;

    launch.pool = ctx.accounts.pool.key();

    emit!(PoolRegistered {
        launch: launch.key(),
        pool: launch.pool,
        base_mint: launch.base_mint,
        creator: launch.creator,
    });
    Ok(())
}

/// Reject a base mint whose Metaplex name or symbol is reserved. Fails closed: anything other than
/// a `MetadataV1` account of the base mint owned by the metadata program is `InvalidTokenMetadata`.
///
/// The PDA address is deliberately not re-derived: Token Metadata creates `MetadataV1` accounts only
/// at `["metadata", program, mint]` (it asserts the derivation on create), so owner + key byte +
/// stored mint already pin the canonical account, and `find_program_address` would cost ~1.5k CU
/// per failed bump with an unbounded tail for an unlucky base mint.
#[inline(never)]
fn check_token_name(metadata: &AccountInfo, base_mint: &Pubkey) -> Result<()> {
    require_keys_eq!(
        *metadata.owner,
        MPL_TOKEN_METADATA_ID,
        StockfloorError::InvalidTokenMetadata
    );
    let data = metadata.try_borrow_data()?;
    let (name, symbol) =
        metadata_name_and_symbol(&data, base_mint).ok_or(StockfloorError::InvalidTokenMetadata)?;
    require!(
        !is_reserved_token_name(name, symbol),
        StockfloorError::ReservedTokenName
    );
    Ok(())
}
