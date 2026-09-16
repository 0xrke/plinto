//! Read-only decoding of Meteora DBC and DAMM v2 accounts.
//!
//! The layouts come from `declare_program!` (generated from `idls/*.json`) and are
//! cross-checked in tests against the vendored DBC / DAMM v2 sources (sizes and
//! field offsets). Accounts are copied out with `bytemuck::pod_read_unaligned`, so
//! decoding never depends on the alignment of account data in memory.
//!
//! Every decoder checks the owner program, the Anchor discriminator and a minimum data
//! length before reading anything. The length is a lower bound, not an exact size: a
//! future DBC / DAMM v2 upgrade may grow an account (zero-copy layouts append fields),
//! and other account types with the same size (`ConfigWithTransferHook`,
//! `TransferHookPool`) are already rejected by their different discriminators.

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

use crate::constants::external::{DAMM_V2_PROGRAM_ID, DBC_PROGRAM_ID};
use crate::cp_amm::accounts::{Pool as DammPool, Position as DammPosition};
use crate::dynamic_bonding_curve::accounts::{PoolConfig, VirtualPool};
use crate::errors::StockfloorError;

/// DBC `CollectFeeMode::QuoteToken`.
pub const DBC_COLLECT_FEE_MODE_QUOTE_TOKEN: u8 = 0;
/// DBC `MigrationOption::DammV2`.
pub const DBC_MIGRATION_OPTION_DAMM_V2: u8 = 1;
/// DBC `TokenType::SplToken`.
pub const DBC_TOKEN_TYPE_SPL_TOKEN: u8 = 0;
/// DBC `PoolType::SplToken`.
pub const DBC_POOL_TYPE_SPL_TOKEN: u8 = 0;
/// DBC `MigrationProgress::CreatedPool`.
pub const DBC_MIGRATION_PROGRESS_CREATED_POOL: u8 = 3;
/// DBC partner migration fee bit in `migration_fee_withdraw_status`.
pub const DBC_PARTNER_MIGRATION_FEE_MASK: u8 = 0b100;
/// DBC `BaseFeeMode::FeeSchedulerExponential` (0 = linear, 1 = exponential, 2 = rate limiter).
/// For both scheduler modes the highest fee is `cliff_fee_numerator`.
pub const DBC_BASE_FEE_MODE_FEE_SCHEDULER_EXPONENTIAL: u8 = 1;
/// DBC `MigratedCollectFeeMode::QuoteToken` (DAMM v2 `OnlyB`).
pub const DBC_MIGRATED_COLLECT_FEE_MODE_QUOTE_TOKEN: u8 = 0;
/// DBC `TokenAuthorityOption::Immutable`.
pub const DBC_TOKEN_AUTHORITY_IMMUTABLE: u8 = 1;

/// Size of the zero-copy body (without the 8-byte discriminator), per vendored sources.
pub const DBC_POOL_CONFIG_SIZE: usize = 1040;
pub const DBC_VIRTUAL_POOL_SIZE: usize = 416;
pub const DAMM_POOL_SIZE: usize = 1104;
pub const DAMM_POSITION_SIZE: usize = 400;

const DISC_LEN: usize = 8;

fn decode<T: bytemuck::Pod>(
    info: &AccountInfo,
    owner: &Pubkey,
    discriminator: &[u8],
    size: usize,
    error: StockfloorError,
) -> Result<Box<T>> {
    debug_assert_eq!(core::mem::size_of::<T>(), size);
    if info.owner != owner {
        return Err(error.into());
    }
    let data = info.try_borrow_data()?;
    if data.len() < DISC_LEN + size || &data[..DISC_LEN] != discriminator {
        return Err(error.into());
    }
    let value: T =
        bytemuck::try_pod_read_unaligned(&data[DISC_LEN..DISC_LEN + size]).map_err(|_| error)?;
    Ok(Box::new(value))
}

/// Decode a DBC `PoolConfig` (rejects `ConfigWithTransferHook` and any other account).
#[inline(never)]
pub fn load_dbc_config(info: &AccountInfo) -> Result<Box<PoolConfig>> {
    decode(
        info,
        &DBC_PROGRAM_ID,
        PoolConfig::DISCRIMINATOR,
        DBC_POOL_CONFIG_SIZE,
        StockfloorError::InvalidDbcConfig,
    )
}

/// Decode a DBC `VirtualPool` (rejects `TransferHookPool` and any other account).
#[inline(never)]
pub fn load_dbc_pool(info: &AccountInfo) -> Result<Box<VirtualPool>> {
    decode(
        info,
        &DBC_PROGRAM_ID,
        VirtualPool::DISCRIMINATOR,
        DBC_VIRTUAL_POOL_SIZE,
        StockfloorError::InvalidDbcPool,
    )
}

/// Decode a DAMM v2 `Pool`.
#[inline(never)]
pub fn load_damm_pool(info: &AccountInfo) -> Result<Box<DammPool>> {
    decode(
        info,
        &DAMM_V2_PROGRAM_ID,
        DammPool::DISCRIMINATOR,
        DAMM_POOL_SIZE,
        StockfloorError::InvalidDammPool,
    )
}

/// Decode a DAMM v2 `Position`.
#[inline(never)]
pub fn load_damm_position(info: &AccountInfo) -> Result<Box<DammPosition>> {
    decode(
        info,
        &DAMM_V2_PROGRAM_ID,
        DammPosition::DISCRIMINATOR,
        DAMM_POSITION_SIZE,
        StockfloorError::InvalidDammPosition,
    )
}

/// DBC's partner migration fee for a StockFloor config, i.e. the quote amount
/// `harvest_migration_fee` will move into the vault and the whole initial floor.
///
/// Port of DBC `PoolConfig::get_migration_quote_amount` followed by
/// `get_migration_fee_distribution` with `creator_migration_fee_percentage == 0`
/// (which `validate_launch_config` enforces):
/// `quote_amount = ceil(T * (100 - pct) / 100)`, `fee = T - quote_amount`.
/// Saturating rather than checked: `pct > 100` is rejected by the caller and only makes the
/// result 0 here, which is itself a rejection.
pub fn partner_migration_fee(migration_quote_threshold: u64, migration_fee_percentage: u8) -> u64 {
    let t = migration_quote_threshold as u128;
    let rest = 100u128.saturating_sub(migration_fee_percentage as u128);
    let quote_amount = (t * rest).div_ceil(100).min(t);
    (t - quote_amount) as u64
}

/// Validation of a DBC config for a StockFloor launch (brief §4 and §5.3.1). Pure
/// function over the decoded config so it can be unit tested.
///
/// Besides the brief §5.3.1 list, it binds every config field that decides whether a
/// launch really is StockFloor-shaped, so the `Launch` PDA stays a trustworthy marker:
/// dynamic supply only, creator trading share <= 30%, a fee-scheduler base fee of at most
/// 20% with no dynamic fee, quote-only LP fees after migration, immutable metadata and no
/// pool creation fee, and a migration threshold large enough that the partner migration fee
/// (the initial floor) does not round to zero.
///
/// What it deliberately does not check: the quote mint allowlist, and how large the raise is
/// in fiat terms. The latter needs a price oracle, which this program does not have, so the
/// minimum raise ($1 by default) stays UI/SDK policy. See README "What the program guarantees".
pub fn validate_launch_config(
    config: &PoolConfig,
    claimer: &Pubkey,
    quote_mint: &Pubkey,
    exit_fee_bps: u16,
) -> std::result::Result<(), StockfloorError> {
    use crate::constants::*;

    if exit_fee_bps > MAX_EXIT_FEE_BPS {
        return Err(StockfloorError::ExitFeeTooHigh);
    }
    if config.quote_mint != *quote_mint {
        return Err(StockfloorError::QuoteMintMismatch);
    }
    if config.fee_claimer != *claimer {
        return Err(StockfloorError::FeeClaimerMismatch);
    }
    if config.leftover_receiver != *claimer {
        return Err(StockfloorError::LeftoverReceiverMismatch);
    }
    if config.creator_migration_fee_percentage != 0 {
        return Err(StockfloorError::CreatorMigrationFeeNotZero);
    }
    if !(MIN_MIGRATION_FEE_PERCENTAGE..=MAX_MIGRATION_FEE_PERCENTAGE)
        .contains(&config.migration_fee_percentage)
    {
        return Err(StockfloorError::MigrationFeePercentageOutOfRange);
    }
    // The partner migration fee is the whole initial floor (`creator_migration_fee_percentage`
    // is 0 above). DBC itself only requires `migration_quote_threshold > 0`, and its rounding
    // (`get_migration_quote_amount`: quote_amount = ceil(T * (100 - pct) / 100), fee = T -
    // quote_amount) makes the fee exactly 0 for a dust threshold — e.g. T <= 3 at pct = 30.
    // Such a launch would reach the redeemable phase with a provably empty vault while carrying
    // a `Launch` PDA, so reject it here.
    if partner_migration_fee(
        config.migration_quote_threshold,
        config.migration_fee_percentage,
    ) == 0
    {
        return Err(StockfloorError::MigrationQuoteThresholdTooSmall);
    }
    if config.partner_permanent_locked_liquidity_percentage != 100
        || config.partner_liquidity_percentage != 0
        || config.creator_permanent_locked_liquidity_percentage != 0
        || config.creator_liquidity_percentage != 0
    {
        return Err(StockfloorError::LiquidityNotFullyPartnerLocked);
    }
    let pv = &config.partner_liquidity_vesting_info;
    let cv = &config.creator_liquidity_vesting_info;
    if pv.is_initialized != 0
        || pv.vesting_percentage != 0
        || cv.is_initialized != 0
        || cv.vesting_percentage != 0
    {
        return Err(StockfloorError::LiquidityVestingNotAllowed);
    }
    let lv = &config.locked_vesting_config;
    if lv.amount_per_period != 0 || lv.cliff_unlock_amount != 0 || lv.number_of_period != 0 {
        return Err(StockfloorError::LockedVestingNotAllowed);
    }
    if config.collect_fee_mode != DBC_COLLECT_FEE_MODE_QUOTE_TOKEN {
        return Err(StockfloorError::CollectFeeModeNotQuote);
    }
    if config.migration_option != DBC_MIGRATION_OPTION_DAMM_V2 {
        return Err(StockfloorError::MigrationOptionNotDammV2);
    }
    if config.token_type != DBC_TOKEN_TYPE_SPL_TOKEN {
        return Err(StockfloorError::BaseTokenTypeNotSplToken);
    }
    // Fixed supply leaves DBC leftover base in `mint.supply` after migration until
    // `withdraw_leftover` + burn, which would underpay early redeemers.
    if config.fixed_token_supply_flag != 0 {
        return Err(StockfloorError::FixedTokenSupplyNotAllowed);
    }
    if config.creator_trading_fee_percentage > MAX_CREATOR_TRADING_FEE_PERCENTAGE {
        return Err(StockfloorError::CreatorTradingFeeTooHigh);
    }
    let base_fee = &config.pool_fees.base_fee;
    if base_fee.base_fee_mode > DBC_BASE_FEE_MODE_FEE_SCHEDULER_EXPONENTIAL
        || base_fee.cliff_fee_numerator > MAX_CURVE_FEE_NUMERATOR
    {
        return Err(StockfloorError::CurveFeeTooHigh);
    }
    if config.pool_fees.dynamic_fee.initialized != 0 {
        return Err(StockfloorError::DynamicFeeNotAllowed);
    }
    if config.migrated_collect_fee_mode != DBC_MIGRATED_COLLECT_FEE_MODE_QUOTE_TOKEN {
        return Err(StockfloorError::MigratedCollectFeeModeNotQuote);
    }
    if config.token_update_authority != DBC_TOKEN_AUTHORITY_IMMUTABLE {
        return Err(StockfloorError::TokenUpdateAuthorityNotImmutable);
    }
    if config.pool_creation_fee != 0 {
        return Err(StockfloorError::PoolCreationFeeNotZero);
    }
    Ok(())
}

/// DBC `is_curve_complete`: `quote_reserve >= migration_quote_threshold`.
pub fn is_curve_complete(pool: &VirtualPool, config: &PoolConfig) -> bool {
    pool.pool_state.quote_reserve >= config.migration_quote_threshold
}

/// Migration to DAMM v2 finished: DBC sets `is_migrated = 1` and
/// `migration_progress = CreatedPool` in `migration_damm_v2`.
pub fn is_migration_complete(pool: &VirtualPool) -> bool {
    pool.pool_state.is_migrated == 1
        && pool.pool_state.migration_progress == DBC_MIGRATION_PROGRESS_CREATED_POOL
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::cp_amm::types as damm_types;
    use crate::dynamic_bonding_curve::types as dbc_types;
    use core::mem::{offset_of, size_of};
    use std::collections::HashMap;

    #[test]
    fn generated_sizes_match_vendored_sources() {
        assert_eq!(size_of::<PoolConfig>(), DBC_POOL_CONFIG_SIZE);
        assert_eq!(size_of::<VirtualPool>(), DBC_VIRTUAL_POOL_SIZE);
        assert_eq!(size_of::<DammPool>(), DAMM_POOL_SIZE);
        assert_eq!(size_of::<DammPosition>(), DAMM_POSITION_SIZE);
        assert_eq!(size_of::<dbc_types::PoolState>(), 416);
        assert_eq!(size_of::<dbc_types::LiquidityVestingInfo>(), 16);
        assert_eq!(size_of::<dbc_types::LockedVestingConfig>(), 48);
        assert_eq!(size_of::<dbc_types::PoolFeesConfig>(), 80);
        assert_eq!(size_of::<dbc_types::VolatilityTracker>(), 64);
        assert_eq!(size_of::<dbc_types::PoolMetrics>(), 32);
        assert_eq!(size_of::<damm_types::PoolFeesStruct>(), 160);
    }

    /// Offsets hand-computed from vendor/dbc/programs/dynamic-bonding-curve/src/state/*.rs
    /// (all structs are explicitly padded, so offsets are cumulative field sizes).
    #[test]
    fn dbc_offsets_match_vendored_layout() {
        assert_eq!(offset_of!(PoolConfig, quote_mint), 0);
        assert_eq!(offset_of!(PoolConfig, fee_claimer), 32);
        assert_eq!(offset_of!(PoolConfig, leftover_receiver), 64);
        assert_eq!(offset_of!(PoolConfig, pool_fees), 96);
        assert_eq!(offset_of!(PoolConfig, partner_liquidity_vesting_info), 176);
        assert_eq!(offset_of!(PoolConfig, creator_liquidity_vesting_info), 192);
        assert_eq!(offset_of!(PoolConfig, padding_0), 208);
        assert_eq!(offset_of!(PoolConfig, padding_1), 222);
        assert_eq!(offset_of!(PoolConfig, collect_fee_mode), 224);
        assert_eq!(offset_of!(PoolConfig, migration_option), 225);
        assert_eq!(offset_of!(PoolConfig, token_decimal), 227);
        assert_eq!(offset_of!(PoolConfig, token_type), 229);
        assert_eq!(
            offset_of!(PoolConfig, partner_permanent_locked_liquidity_percentage),
            231
        );
        assert_eq!(offset_of!(PoolConfig, partner_liquidity_percentage), 232);
        assert_eq!(
            offset_of!(PoolConfig, creator_permanent_locked_liquidity_percentage),
            233
        );
        assert_eq!(offset_of!(PoolConfig, creator_liquidity_percentage), 234);
        assert_eq!(offset_of!(PoolConfig, fixed_token_supply_flag), 236);
        assert_eq!(offset_of!(PoolConfig, migration_fee_percentage), 239);
        assert_eq!(
            offset_of!(PoolConfig, creator_migration_fee_percentage),
            240
        );
        assert_eq!(offset_of!(PoolConfig, swap_base_amount), 248);
        assert_eq!(offset_of!(PoolConfig, migration_quote_threshold), 256);
        assert_eq!(offset_of!(PoolConfig, migration_sqrt_price), 272);
        assert_eq!(offset_of!(PoolConfig, locked_vesting_config), 288);
        assert_eq!(offset_of!(PoolConfig, pool_creation_fee), 360);
        assert_eq!(
            offset_of!(PoolConfig, pool_fees)
                + offset_of!(dbc_types::PoolFeesConfig, base_fee)
                + offset_of!(dbc_types::BaseFeeConfig, cliff_fee_numerator),
            96
        );
        assert_eq!(
            offset_of!(PoolConfig, pool_fees)
                + offset_of!(dbc_types::PoolFeesConfig, base_fee)
                + offset_of!(dbc_types::BaseFeeConfig, base_fee_mode),
            122
        );
        assert_eq!(
            offset_of!(PoolConfig, pool_fees)
                + offset_of!(dbc_types::PoolFeesConfig, dynamic_fee)
                + offset_of!(dbc_types::DynamicFeeConfig, initialized),
            128
        );
        assert_eq!(offset_of!(PoolConfig, creator_trading_fee_percentage), 237);
        assert_eq!(offset_of!(PoolConfig, token_update_authority), 238);
        assert_eq!(offset_of!(PoolConfig, migrated_collect_fee_mode), 352);
        assert_eq!(offset_of!(PoolConfig, sqrt_start_price), 384);
        assert_eq!(offset_of!(PoolConfig, curve), 400);

        let ps = offset_of!(VirtualPool, pool_state);
        assert_eq!(ps, 0);
        assert_eq!(offset_of!(dbc_types::PoolState, config), 64);
        assert_eq!(offset_of!(dbc_types::PoolState, creator), 96);
        assert_eq!(offset_of!(dbc_types::PoolState, base_mint), 128);
        assert_eq!(offset_of!(dbc_types::PoolState, base_vault), 160);
        assert_eq!(offset_of!(dbc_types::PoolState, quote_vault), 192);
        assert_eq!(offset_of!(dbc_types::PoolState, quote_reserve), 232);
        assert_eq!(offset_of!(dbc_types::PoolState, pool_type), 296);
        assert_eq!(offset_of!(dbc_types::PoolState, is_migrated), 297);
        assert_eq!(
            offset_of!(dbc_types::PoolState, is_partner_withdraw_surplus),
            298
        );
        assert_eq!(offset_of!(dbc_types::PoolState, migration_progress), 300);
        assert_eq!(offset_of!(dbc_types::PoolState, is_withdraw_leftover), 301);
        assert_eq!(
            offset_of!(dbc_types::PoolState, migration_fee_withdraw_status),
            303
        );

        assert_eq!(offset_of!(DammPool, token_a_mint), 160);
        assert_eq!(offset_of!(DammPool, token_b_mint), 192);
        assert_eq!(offset_of!(DammPosition, pool), 0);
        assert_eq!(offset_of!(DammPosition, nft_mint), 32);
    }

    // ------------------------------------------------------------------
    // Independent cross-check against the IDL JSON: compute each struct's
    // field offsets from the IDL type list and compare with offset_of!.
    // ------------------------------------------------------------------

    fn idl(name: &str) -> serde_json::Value {
        let path = format!("{}/../../idls/{}.json", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn type_size(ty: &serde_json::Value, types: &HashMap<String, serde_json::Value>) -> usize {
        if let Some(s) = ty.as_str() {
            return match s {
                "u8" | "i8" | "bool" => 1,
                "u16" | "i16" => 2,
                "u32" | "i32" => 4,
                "u64" | "i64" => 8,
                "u128" | "i128" => 16,
                "pubkey" => 32,
                other => panic!("unsupported primitive {other}"),
            };
        }
        if let Some(arr) = ty.get("array") {
            let n = arr[1].as_u64().unwrap() as usize;
            return type_size(&arr[0], types) * n;
        }
        if let Some(def) = ty.get("defined") {
            let name = def["name"].as_str().unwrap();
            return struct_offsets(name, types).1;
        }
        panic!("unsupported type {ty}");
    }

    /// Returns (field offsets, total size) assuming no implicit padding.
    fn struct_offsets(
        name: &str,
        types: &HashMap<String, serde_json::Value>,
    ) -> (HashMap<String, usize>, usize) {
        let t = types
            .get(name)
            .unwrap_or_else(|| panic!("type {name} not in IDL"));
        let mut offsets = HashMap::new();
        let mut cursor = 0usize;
        for f in t["type"]["fields"].as_array().unwrap() {
            offsets.insert(f["name"].as_str().unwrap().to_string(), cursor);
            cursor += type_size(&f["type"], types);
        }
        (offsets, cursor)
    }

    fn types_of(v: &serde_json::Value) -> HashMap<String, serde_json::Value> {
        v["types"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| (t["name"].as_str().unwrap().to_string(), t.clone()))
            .collect()
    }

    fn account_disc(v: &serde_json::Value, name: &str) -> Vec<u8> {
        v["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["name"] == name)
            .unwrap()["discriminator"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_u64().unwrap() as u8)
            .collect()
    }

    #[test]
    fn dbc_layout_matches_idl() {
        let v = idl("dynamic_bonding_curve");
        let types = types_of(&v);
        let (cfg, cfg_size) = struct_offsets("PoolConfig", &types);
        assert_eq!(cfg_size, DBC_POOL_CONFIG_SIZE);
        for (field, off) in [
            ("quote_mint", offset_of!(PoolConfig, quote_mint)),
            ("fee_claimer", offset_of!(PoolConfig, fee_claimer)),
            (
                "leftover_receiver",
                offset_of!(PoolConfig, leftover_receiver),
            ),
            (
                "partner_liquidity_vesting_info",
                offset_of!(PoolConfig, partner_liquidity_vesting_info),
            ),
            (
                "creator_liquidity_vesting_info",
                offset_of!(PoolConfig, creator_liquidity_vesting_info),
            ),
            ("collect_fee_mode", offset_of!(PoolConfig, collect_fee_mode)),
            ("migration_option", offset_of!(PoolConfig, migration_option)),
            ("token_decimal", offset_of!(PoolConfig, token_decimal)),
            ("token_type", offset_of!(PoolConfig, token_type)),
            (
                "partner_permanent_locked_liquidity_percentage",
                offset_of!(PoolConfig, partner_permanent_locked_liquidity_percentage),
            ),
            (
                "partner_liquidity_percentage",
                offset_of!(PoolConfig, partner_liquidity_percentage),
            ),
            (
                "creator_permanent_locked_liquidity_percentage",
                offset_of!(PoolConfig, creator_permanent_locked_liquidity_percentage),
            ),
            (
                "creator_liquidity_percentage",
                offset_of!(PoolConfig, creator_liquidity_percentage),
            ),
            (
                "fixed_token_supply_flag",
                offset_of!(PoolConfig, fixed_token_supply_flag),
            ),
            (
                "migration_fee_percentage",
                offset_of!(PoolConfig, migration_fee_percentage),
            ),
            (
                "creator_migration_fee_percentage",
                offset_of!(PoolConfig, creator_migration_fee_percentage),
            ),
            (
                "migration_quote_threshold",
                offset_of!(PoolConfig, migration_quote_threshold),
            ),
            (
                "locked_vesting_config",
                offset_of!(PoolConfig, locked_vesting_config),
            ),
            ("pool_fees", offset_of!(PoolConfig, pool_fees)),
            (
                "creator_trading_fee_percentage",
                offset_of!(PoolConfig, creator_trading_fee_percentage),
            ),
            (
                "token_update_authority",
                offset_of!(PoolConfig, token_update_authority),
            ),
            (
                "migrated_collect_fee_mode",
                offset_of!(PoolConfig, migrated_collect_fee_mode),
            ),
            (
                "pool_creation_fee",
                offset_of!(PoolConfig, pool_creation_fee),
            ),
        ] {
            assert_eq!(cfg[field], off, "PoolConfig.{field}");
        }
        let (pf, _) = struct_offsets("PoolFeesConfig", &types);
        assert_eq!(
            pf["base_fee"],
            offset_of!(dbc_types::PoolFeesConfig, base_fee)
        );
        assert_eq!(
            pf["dynamic_fee"],
            offset_of!(dbc_types::PoolFeesConfig, dynamic_fee)
        );
        let (bf, _) = struct_offsets("BaseFeeConfig", &types);
        assert_eq!(
            bf["cliff_fee_numerator"],
            offset_of!(dbc_types::BaseFeeConfig, cliff_fee_numerator)
        );
        assert_eq!(
            bf["base_fee_mode"],
            offset_of!(dbc_types::BaseFeeConfig, base_fee_mode)
        );
        let (df, _) = struct_offsets("DynamicFeeConfig", &types);
        assert_eq!(
            df["initialized"],
            offset_of!(dbc_types::DynamicFeeConfig, initialized)
        );

        let (vp, vp_size) = struct_offsets("VirtualPool", &types);
        assert_eq!(vp_size, DBC_VIRTUAL_POOL_SIZE);
        assert_eq!(vp["pool_state"], 0);
        let (st, _) = struct_offsets("PoolState", &types);
        for (field, off) in [
            ("config", offset_of!(dbc_types::PoolState, config)),
            ("creator", offset_of!(dbc_types::PoolState, creator)),
            ("base_mint", offset_of!(dbc_types::PoolState, base_mint)),
            (
                "quote_reserve",
                offset_of!(dbc_types::PoolState, quote_reserve),
            ),
            ("pool_type", offset_of!(dbc_types::PoolState, pool_type)),
            ("is_migrated", offset_of!(dbc_types::PoolState, is_migrated)),
            (
                "is_partner_withdraw_surplus",
                offset_of!(dbc_types::PoolState, is_partner_withdraw_surplus),
            ),
            (
                "migration_progress",
                offset_of!(dbc_types::PoolState, migration_progress),
            ),
            (
                "is_withdraw_leftover",
                offset_of!(dbc_types::PoolState, is_withdraw_leftover),
            ),
            (
                "migration_fee_withdraw_status",
                offset_of!(dbc_types::PoolState, migration_fee_withdraw_status),
            ),
        ] {
            assert_eq!(st[field], off, "PoolState.{field}");
        }

        let (lvi, _) = struct_offsets("LiquidityVestingInfo", &types);
        assert_eq!(
            lvi["is_initialized"],
            offset_of!(dbc_types::LiquidityVestingInfo, is_initialized)
        );
        assert_eq!(
            lvi["vesting_percentage"],
            offset_of!(dbc_types::LiquidityVestingInfo, vesting_percentage)
        );

        assert_eq!(account_disc(&v, "PoolConfig"), PoolConfig::DISCRIMINATOR);
        assert_eq!(account_disc(&v, "VirtualPool"), VirtualPool::DISCRIMINATOR);
        assert_ne!(
            account_disc(&v, "TransferHookPool"),
            VirtualPool::DISCRIMINATOR
        );
        assert_ne!(
            account_disc(&v, "ConfigWithTransferHook"),
            PoolConfig::DISCRIMINATOR
        );
    }

    #[test]
    fn damm_layout_matches_idl() {
        let v = idl("cp_amm");
        let types = types_of(&v);
        let (pool, pool_size) = struct_offsets("Pool", &types);
        assert_eq!(pool_size, DAMM_POOL_SIZE);
        assert_eq!(pool["token_a_mint"], offset_of!(DammPool, token_a_mint));
        assert_eq!(pool["token_b_mint"], offset_of!(DammPool, token_b_mint));
        let (pos, pos_size) = struct_offsets("Position", &types);
        assert_eq!(pos_size, DAMM_POSITION_SIZE);
        assert_eq!(pos["pool"], offset_of!(DammPosition, pool));
        assert_eq!(pos["nft_mint"], offset_of!(DammPosition, nft_mint));
        assert_eq!(account_disc(&v, "Pool"), DammPool::DISCRIMINATOR);
        assert_eq!(account_disc(&v, "Position"), DammPosition::DISCRIMINATOR);
    }

    // ------------------------------------------------------------------
    // Config validation and decoding.
    // ------------------------------------------------------------------

    pub(crate) fn valid_config(claimer: Pubkey, quote_mint: Pubkey) -> PoolConfig {
        let mut c: PoolConfig = bytemuck::Zeroable::zeroed();
        c.quote_mint = quote_mint;
        c.fee_claimer = claimer;
        c.leftover_receiver = claimer;
        c.migration_fee_percentage = 50;
        c.creator_migration_fee_percentage = 0;
        c.partner_permanent_locked_liquidity_percentage = 100;
        c.collect_fee_mode = DBC_COLLECT_FEE_MODE_QUOTE_TOKEN;
        c.migration_option = DBC_MIGRATION_OPTION_DAMM_V2;
        c.token_type = DBC_TOKEN_TYPE_SPL_TOKEN;
        c.token_decimal = 6;
        c.creator_trading_fee_percentage = 30;
        c.migration_quote_threshold = 1_000_000_000;
        c.pool_fees.base_fee.cliff_fee_numerator = 10_000_000; // 1%
        c.token_update_authority = DBC_TOKEN_AUTHORITY_IMMUTABLE;
        c
    }

    /// `partner_migration_fee` is the port of DBC's two-step computation; recompute it here the
    /// long way (u128, explicit ceil) over the whole accepted percentage range.
    #[test]
    fn partner_migration_fee_matches_dbc_rounding() {
        for pct in crate::constants::MIN_MIGRATION_FEE_PERCENTAGE
            ..=crate::constants::MAX_MIGRATION_FEE_PERCENTAGE
        {
            for t in [
                0u64,
                1,
                3,
                4,
                99,
                100,
                101,
                131_346_320,
                6_586_828,
                u64::MAX / 2,
                u64::MAX,
            ] {
                let num = t as u128 * (100 - pct as u128);
                let quote_amount = num / 100 + u128::from(num % 100 != 0);
                let expected = (t as u128 - quote_amount) as u64;
                assert_eq!(partner_migration_fee(t, pct), expected, "pct {pct}, T {t}");
            }
        }
        // The documented degenerate cases: DBC accepts these thresholds, StockFloor does not.
        assert_eq!(partner_migration_fee(3, 30), 0);
        assert_eq!(partner_migration_fee(4, 30), 1);
        assert_eq!(partner_migration_fee(1, 99), 0);
        assert_eq!(partner_migration_fee(2, 99), 1);
        // The C2 demo threshold ($50 in SPYx) and the C1 threshold ($1,000).
        assert_eq!(partner_migration_fee(6_586_828, 50), 3_293_414);
        assert_eq!(partner_migration_fee(131_346_320, 50), 65_673_160);
    }

    #[test]
    fn valid_config_passes() {
        let a = Pubkey::new_unique();
        let q = Pubkey::new_unique();
        let c = valid_config(a, q);
        assert_eq!(validate_launch_config(&c, &a, &q, 200), Ok(()));
        assert_eq!(validate_launch_config(&c, &a, &q, 0), Ok(()));
        assert_eq!(validate_launch_config(&c, &a, &q, 500), Ok(()));
        for pct in [30u8, 70, 99] {
            let mut c2 = valid_config(a, q);
            c2.migration_fee_percentage = pct;
            assert_eq!(validate_launch_config(&c2, &a, &q, 200), Ok(()));
        }
        // Boundaries of the StockFloor-shape bounds are inclusive.
        let mut c3 = valid_config(a, q);
        c3.creator_trading_fee_percentage = 0;
        c3.pool_fees.base_fee.cliff_fee_numerator = crate::constants::MAX_CURVE_FEE_NUMERATOR;
        c3.pool_fees.base_fee.base_fee_mode = DBC_BASE_FEE_MODE_FEE_SCHEDULER_EXPONENTIAL;
        assert_eq!(validate_launch_config(&c3, &a, &q, 200), Ok(()));
        c3.creator_trading_fee_percentage = crate::constants::MAX_CREATOR_TRADING_FEE_PERCENTAGE;
        assert_eq!(validate_launch_config(&c3, &a, &q, 200), Ok(()));
    }

    #[test]
    fn every_config_check_has_its_error() {
        let a = Pubkey::new_unique();
        let q = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        type Mutator = fn(&mut PoolConfig, Pubkey);
        let cases: Vec<(Mutator, StockfloorError)> = vec![
            (
                |c, o| c.fee_claimer = o,
                StockfloorError::FeeClaimerMismatch,
            ),
            (
                |c, o| c.leftover_receiver = o,
                StockfloorError::LeftoverReceiverMismatch,
            ),
            (
                |c, _| c.creator_migration_fee_percentage = 1,
                StockfloorError::CreatorMigrationFeeNotZero,
            ),
            (
                |c, _| c.migration_fee_percentage = 29,
                StockfloorError::MigrationFeePercentageOutOfRange,
            ),
            (
                |c, _| c.migration_fee_percentage = 0,
                StockfloorError::MigrationFeePercentageOutOfRange,
            ),
            (
                |c, _| c.migration_fee_percentage = 100,
                StockfloorError::MigrationFeePercentageOutOfRange,
            ),
            (
                |c, _| c.partner_permanent_locked_liquidity_percentage = 99,
                StockfloorError::LiquidityNotFullyPartnerLocked,
            ),
            (
                |c, _| c.partner_liquidity_percentage = 1,
                StockfloorError::LiquidityNotFullyPartnerLocked,
            ),
            (
                |c, _| c.creator_permanent_locked_liquidity_percentage = 1,
                StockfloorError::LiquidityNotFullyPartnerLocked,
            ),
            (
                |c, _| c.creator_liquidity_percentage = 1,
                StockfloorError::LiquidityNotFullyPartnerLocked,
            ),
            (
                |c, _| c.partner_liquidity_vesting_info.vesting_percentage = 10,
                StockfloorError::LiquidityVestingNotAllowed,
            ),
            (
                |c, _| c.partner_liquidity_vesting_info.is_initialized = 1,
                StockfloorError::LiquidityVestingNotAllowed,
            ),
            (
                |c, _| c.creator_liquidity_vesting_info.vesting_percentage = 10,
                StockfloorError::LiquidityVestingNotAllowed,
            ),
            (
                |c, _| c.creator_liquidity_vesting_info.is_initialized = 1,
                StockfloorError::LiquidityVestingNotAllowed,
            ),
            (
                |c, _| c.locked_vesting_config.amount_per_period = 1,
                StockfloorError::LockedVestingNotAllowed,
            ),
            (
                |c, _| c.locked_vesting_config.cliff_unlock_amount = 1,
                StockfloorError::LockedVestingNotAllowed,
            ),
            (
                |c, _| c.locked_vesting_config.number_of_period = 1,
                StockfloorError::LockedVestingNotAllowed,
            ),
            (
                |c, _| c.collect_fee_mode = 1,
                StockfloorError::CollectFeeModeNotQuote,
            ),
            (
                |c, _| c.migration_option = 0,
                StockfloorError::MigrationOptionNotDammV2,
            ),
            (
                |c, _| c.token_type = 1,
                StockfloorError::BaseTokenTypeNotSplToken,
            ),
            (|c, o| c.quote_mint = o, StockfloorError::QuoteMintMismatch),
            (
                |c, _| c.fixed_token_supply_flag = 1,
                StockfloorError::FixedTokenSupplyNotAllowed,
            ),
            (
                |c, _| c.creator_trading_fee_percentage = 31,
                StockfloorError::CreatorTradingFeeTooHigh,
            ),
            (
                |c, _| c.creator_trading_fee_percentage = 100,
                StockfloorError::CreatorTradingFeeTooHigh,
            ),
            (
                |c, _| c.pool_fees.base_fee.cliff_fee_numerator = 200_000_001,
                StockfloorError::CurveFeeTooHigh,
            ),
            (
                |c, _| c.pool_fees.base_fee.base_fee_mode = 2, // rate limiter
                StockfloorError::CurveFeeTooHigh,
            ),
            (
                |c, _| c.pool_fees.dynamic_fee.initialized = 1,
                StockfloorError::DynamicFeeNotAllowed,
            ),
            (
                |c, _| c.migrated_collect_fee_mode = 1,
                StockfloorError::MigratedCollectFeeModeNotQuote,
            ),
            (
                |c, _| c.migrated_collect_fee_mode = 2, // compounding
                StockfloorError::MigratedCollectFeeModeNotQuote,
            ),
            (
                |c, _| c.token_update_authority = 0, // creator can update metadata
                StockfloorError::TokenUpdateAuthorityNotImmutable,
            ),
            (
                |c, _| c.token_update_authority = 2,
                StockfloorError::TokenUpdateAuthorityNotImmutable,
            ),
            (
                |c, _| c.pool_creation_fee = 1_000_000,
                StockfloorError::PoolCreationFeeNotZero,
            ),
        ];
        for (i, (mutate, expected)) in cases.into_iter().enumerate() {
            let mut c = valid_config(a, q);
            mutate(&mut c, other);
            assert_eq!(
                validate_launch_config(&c, &a, &q, 200),
                Err(expected),
                "case {i}"
            );
        }
        let c = valid_config(a, q);
        assert_eq!(
            validate_launch_config(&c, &a, &q, 501),
            Err(StockfloorError::ExitFeeTooHigh)
        );
        // A threshold whose partner migration fee rounds to zero (the initial floor would be
        // empty) is rejected; the smallest threshold above it is accepted.
        for pct in [
            crate::constants::MIN_MIGRATION_FEE_PERCENTAGE,
            50,
            crate::constants::MAX_MIGRATION_FEE_PERCENTAGE,
        ] {
            let mut c = valid_config(a, q);
            c.migration_fee_percentage = pct;
            let smallest_ok = (1..=200u64)
                .find(|t| partner_migration_fee(*t, pct) > 0)
                .expect("some threshold pays a non-zero migration fee");
            for t in [0u64, smallest_ok - 1] {
                c.migration_quote_threshold = t;
                assert_eq!(
                    validate_launch_config(&c, &a, &q, 200),
                    Err(StockfloorError::MigrationQuoteThresholdTooSmall),
                    "pct {pct}, threshold {t}"
                );
            }
            c.migration_quote_threshold = smallest_ok;
            assert_eq!(
                validate_launch_config(&c, &a, &q, 200),
                Ok(()),
                "pct {pct}, threshold {smallest_ok}"
            );
        }
        // The claimer of a different config is rejected.
        assert_eq!(
            validate_launch_config(&c, &other, &q, 200),
            Err(StockfloorError::FeeClaimerMismatch)
        );
    }

    fn account_bytes<T: bytemuck::Pod>(disc: &[u8], body: &T) -> Vec<u8> {
        let mut data = disc.to_vec();
        data.extend_from_slice(bytemuck::bytes_of(body));
        data
    }

    fn with_info<R>(
        key: Pubkey,
        owner: Pubkey,
        data: &mut [u8],
        f: impl FnOnce(&AccountInfo) -> R,
    ) -> R {
        let mut lamports = 1_000_000u64;
        let info = AccountInfo::new(&key, false, false, &mut lamports, data, &owner, false);
        f(&info)
    }

    #[test]
    fn decoders_check_owner_discriminator_and_size() {
        let a = Pubkey::new_unique();
        let q = Pubkey::new_unique();
        let cfg = valid_config(a, q);
        let key = Pubkey::new_unique();

        let mut data = account_bytes(PoolConfig::DISCRIMINATOR, &cfg);
        let decoded = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_config(i).unwrap()
        });
        assert_eq!(decoded.fee_claimer, a);
        assert_eq!(decoded.migration_fee_percentage, 50);

        // Wrong owner.
        let mut data = account_bytes(PoolConfig::DISCRIMINATOR, &cfg);
        let err = with_info(key, Pubkey::new_unique(), &mut data, |i| {
            load_dbc_config(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcConfig.into());

        // Wrong discriminator (a VirtualPool-discriminated account of config size).
        let mut data = account_bytes(VirtualPool::DISCRIMINATOR, &cfg);
        let err = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_config(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcConfig.into());

        // Too short (truncated account).
        let mut data = account_bytes(PoolConfig::DISCRIMINATOR, &cfg);
        data.truncate(data.len() - 1);
        let err = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_config(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcConfig.into());

        // Longer than today's layout with the right discriminator (a future DBC upgrade
        // appending fields) still decodes the known prefix.
        let mut data = account_bytes(PoolConfig::DISCRIMINATOR, &cfg);
        data.extend_from_slice(&[0xAAu8; 80]);
        let decoded = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_config(i).unwrap()
        });
        assert_eq!(decoded.fee_claimer, a);

        // ConfigWithTransferHook (1120 bytes) has its own discriminator and is rejected.
        let th_cfg_disc = [40u8, 220, 194, 251, 41, 199, 123, 253]; // ConfigWithTransferHook (IDL)
        let mut data = account_bytes(&th_cfg_disc, &cfg);
        data.extend_from_slice(&[0u8; 80]);
        let err = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_config(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcConfig.into());

        // Empty account.
        let mut data = vec![];
        let err = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_config(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcConfig.into());

        // Pools.
        let mut pool: VirtualPool = bytemuck::Zeroable::zeroed();
        pool.pool_state.config = key;
        pool.pool_state.is_migrated = 1;
        pool.pool_state.migration_progress = DBC_MIGRATION_PROGRESS_CREATED_POOL;
        let mut data = account_bytes(VirtualPool::DISCRIMINATOR, &pool);
        let decoded = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_pool(i).unwrap()
        });
        assert_eq!(decoded.pool_state.config, key);
        assert!(is_migration_complete(&decoded));

        let th_disc = [237u8, 219, 184, 23, 42, 189, 169, 35]; // TransferHookPool
        let mut data = account_bytes(&th_disc, &pool);
        let err = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_pool(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcPool.into());

        // A grown VirtualPool (future layout) decodes; a truncated one does not.
        let mut data = account_bytes(VirtualPool::DISCRIMINATOR, &pool);
        data.extend_from_slice(&[0u8; 64]);
        let decoded = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_pool(i).unwrap()
        });
        assert!(is_migration_complete(&decoded));
        let mut data = account_bytes(VirtualPool::DISCRIMINATOR, &pool);
        data.truncate(8 + 300);
        let err = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_dbc_pool(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcPool.into());

        let mut data = account_bytes(VirtualPool::DISCRIMINATOR, &pool);
        let err = with_info(key, DAMM_V2_PROGRAM_ID, &mut data, |i| {
            load_dbc_pool(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDbcPool.into());

        // DAMM accounts.
        let mut dp: DammPool = bytemuck::Zeroable::zeroed();
        dp.token_a_mint = a;
        dp.token_b_mint = q;
        let mut data = account_bytes(DammPool::DISCRIMINATOR, &dp);
        let decoded = with_info(key, DAMM_V2_PROGRAM_ID, &mut data, |i| {
            load_damm_pool(i).unwrap()
        });
        assert_eq!((decoded.token_a_mint, decoded.token_b_mint), (a, q));
        let mut data = account_bytes(DammPool::DISCRIMINATOR, &dp);
        let err = with_info(key, DBC_PROGRAM_ID, &mut data, |i| {
            load_damm_pool(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDammPool.into());

        let mut pos: DammPosition = bytemuck::Zeroable::zeroed();
        pos.pool = key;
        let mut data = account_bytes(DammPosition::DISCRIMINATOR, &pos);
        let decoded = with_info(key, DAMM_V2_PROGRAM_ID, &mut data, |i| {
            load_damm_position(i).unwrap()
        });
        assert_eq!(decoded.pool, key);
        let mut data = account_bytes(DammPool::DISCRIMINATOR, &dp);
        let err = with_info(key, DAMM_V2_PROGRAM_ID, &mut data, |i| {
            load_damm_position(i).unwrap_err()
        });
        assert_eq!(err, StockfloorError::InvalidDammPosition.into());
    }

    #[test]
    fn migration_and_curve_predicates() {
        let mut pool: VirtualPool = bytemuck::Zeroable::zeroed();
        let mut cfg: PoolConfig = bytemuck::Zeroable::zeroed();
        cfg.migration_quote_threshold = 100;
        pool.pool_state.quote_reserve = 99;
        assert!(!is_curve_complete(&pool, &cfg));
        pool.pool_state.quote_reserve = 100;
        assert!(is_curve_complete(&pool, &cfg));

        assert!(!is_migration_complete(&pool));
        pool.pool_state.migration_progress = 2; // LockedVesting
        assert!(!is_migration_complete(&pool));
        pool.pool_state.migration_progress = DBC_MIGRATION_PROGRESS_CREATED_POOL;
        assert!(!is_migration_complete(&pool));
        pool.pool_state.is_migrated = 1;
        assert!(is_migration_complete(&pool));
    }
}
