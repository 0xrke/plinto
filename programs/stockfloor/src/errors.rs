use anchor_lang::prelude::*;

use crate::math::MathError;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum StockfloorError {
    // ----- create_launch: DBC config validation -----
    #[msg("Config account is not a DBC PoolConfig (wrong owner, discriminator or size)")]
    InvalidDbcConfig,
    #[msg("DBC config fee_claimer must be the launch claimer PDA (seeds: authority, config)")]
    FeeClaimerMismatch,
    #[msg(
        "DBC config leftover_receiver must be the launch claimer PDA (seeds: authority, config)"
    )]
    LeftoverReceiverMismatch,
    #[msg("DBC config creator_migration_fee_percentage must be 0")]
    CreatorMigrationFeeNotZero,
    #[msg("DBC config migration_fee_percentage must be within [30, 99]")]
    MigrationFeePercentageOutOfRange,
    #[msg("DBC config must lock 100% of migrated liquidity permanently for the partner")]
    LiquidityNotFullyPartnerLocked,
    #[msg("DBC config must not use liquidity vesting")]
    LiquidityVestingNotAllowed,
    #[msg("DBC config must not have a locked vesting token allocation")]
    LockedVestingNotAllowed,
    #[msg("DBC config collect_fee_mode must be QuoteToken")]
    CollectFeeModeNotQuote,
    #[msg("DBC config migration_option must be DAMM v2")]
    MigrationOptionNotDammV2,
    #[msg("DBC config base token type must be SPL Token")]
    BaseTokenTypeNotSplToken,
    #[msg("Exit fee exceeds the 500 bps cap")]
    ExitFeeTooHigh,
    #[msg("Quote mint does not match the DBC config quote mint")]
    QuoteMintMismatch,
    #[msg("DBC config must use dynamic token supply (fixed supply is not supported)")]
    FixedTokenSupplyNotAllowed,
    #[msg("DBC config creator_trading_fee_percentage exceeds 30")]
    CreatorTradingFeeTooHigh,
    #[msg("DBC config base fee must be a fee scheduler with a cliff fee of at most 20%")]
    CurveFeeTooHigh,
    #[msg("DBC config must not enable the dynamic (volatility) fee")]
    DynamicFeeNotAllowed,
    #[msg("DBC config migrated_collect_fee_mode must be QuoteToken")]
    MigratedCollectFeeModeNotQuote,
    #[msg("DBC config token_update_authority must be Immutable")]
    TokenUpdateAuthorityNotImmutable,
    #[msg("DBC config pool_creation_fee must be 0")]
    PoolCreationFeeNotZero,
    #[msg("Base mint must not be the default pubkey or the quote mint")]
    InvalidBaseMint,

    // ----- register_pool -----
    #[msg("Pool account is not a DBC VirtualPool (wrong owner, discriminator or size)")]
    InvalidDbcPool,
    #[msg("A pool is already registered for this launch")]
    PoolAlreadyRegistered,
    #[msg("No pool is registered for this launch yet")]
    PoolNotRegistered,
    #[msg("DBC pool belongs to a different config")]
    PoolConfigMismatch,
    #[msg("Base mint does not match the DBC pool base mint")]
    BaseMintMismatch,
    #[msg("DBC pool base token must be SPL Token")]
    PoolTypeNotSplToken,
    #[msg("Base mint decimals do not match the DBC config")]
    BaseMintDecimalsMismatch,
    #[msg("Base mint still has a mint authority")]
    BaseMintAuthorityNotRevoked,
    #[msg("Base mint has a freeze authority")]
    BaseMintHasFreezeAuthority,

    // ----- harvests -----
    #[msg("DBC curve is not complete yet")]
    CurveNotComplete,
    #[msg("Migration fee was already harvested")]
    MigrationFeeAlreadyHarvested,
    #[msg("Surplus was already harvested")]
    SurplusAlreadyHarvested,
    #[msg("Account is not a DAMM v2 Pool")]
    InvalidDammPool,
    #[msg("Account is not a DAMM v2 Position")]
    InvalidDammPosition,
    #[msg("Position belongs to a different DAMM v2 pool")]
    PositionPoolMismatch,
    #[msg("DAMM v2 pool mints must be (launch base mint, launch quote mint)")]
    DammPoolMintMismatch,
    #[msg("Position NFT account is not owned by the launch claimer PDA or does not hold the position NFT")]
    PositionNftNotOwnedByClaimer,
    #[msg("Vault balance decreased during a harvest")]
    VaultDecreased,
    #[msg("Vault token account has a delegate, close authority, an owner other than the vault authority, CPI guard or required memo")]
    VaultEncumbered,

    // ----- redeem -----
    #[msg("DBC pool migration to DAMM v2 is not complete")]
    MigrationNotComplete,
    #[msg("Migration fee must be harvested before redemptions open")]
    MigrationFeeNotHarvested,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient base token balance")]
    InsufficientBaseBalance,
    #[msg("Base mint supply is zero")]
    ZeroSupply,
    #[msg("Redemption would pay nothing (net amount is zero)")]
    NothingToRedeem,
    #[msg("Invalid exit fee basis points")]
    InvalidFeeBps,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Vault balance after redemption does not match the expected amount")]
    VaultBalanceMismatch,
    #[msg("Base mint supply after burn does not match the expected amount")]
    SupplyMismatch,
    #[msg("Floor per token would decrease")]
    FloorDecreased,
    #[msg("The payout destination cannot be the vault")]
    DestinationIsVault,

    // ----- quote asset (Token-2022) -----
    #[msg("Quote mint is paused by its issuer")]
    QuoteMintPaused,
    #[msg("Quote mint has an active transfer hook, which is not supported")]
    QuoteMintTransferHookUnsupported,
    #[msg("Vault token account is frozen")]
    VaultFrozen,
    #[msg("Invalid Token-2022 mint data")]
    InvalidQuoteMintData,
    #[msg("Invalid token account data")]
    InvalidTokenAccountData,

    // ----- views -----
    #[msg("Base mint account does not match the launch")]
    FloorAccountMismatch,

    // Appended after `FloorAccountMismatch` on purpose: Anchor numbers these sequentially from
    // 6000, so a new variant goes at the end and never renumbers an existing error.
    #[msg(
        "DBC config migration_quote_threshold is too small: the partner migration fee (the whole initial floor) would round to zero"
    )]
    MigrationQuoteThresholdTooSmall,
}

impl From<MathError> for StockfloorError {
    fn from(e: MathError) -> Self {
        match e {
            MathError::ZeroAmount => StockfloorError::ZeroAmount,
            MathError::ZeroSupply => StockfloorError::ZeroSupply,
            MathError::AmountExceedsSupply => StockfloorError::InsufficientBaseBalance,
            MathError::InvalidFeeBps => StockfloorError::InvalidFeeBps,
            MathError::Overflow => StockfloorError::MathOverflow,
            MathError::NothingToRedeem => StockfloorError::NothingToRedeem,
        }
    }
}
