use anchor_lang::prelude::*;

use crate::math::MathError;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum StockfloorError {
    // ----- create_launch: DBC config validation -----
    #[msg("Config account is not a DBC PoolConfig (wrong owner, discriminator or size)")]
    InvalidDbcConfig,
    #[msg("DBC config fee_claimer must be the launch Authority PDA")]
    FeeClaimerNotAuthority,
    #[msg("DBC config leftover_receiver must be the launch Authority PDA")]
    LeftoverReceiverNotAuthority,
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

    // ----- register_pool -----
    #[msg("Pool account is not a DBC VirtualPool (wrong owner, discriminator or size)")]
    InvalidDbcPool,
    #[msg("A pool is already registered for this launch")]
    PoolAlreadyRegistered,
    #[msg("No pool is registered for this launch yet")]
    PoolNotRegistered,
    #[msg("DBC pool belongs to a different config")]
    PoolConfigMismatch,
    #[msg("DBC pool creator is not the launch creator")]
    PoolCreatorMismatch,
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
    #[msg("Position NFT account is not owned by the launch Authority or does not hold the position NFT")]
    PositionNftNotOwnedByAuthority,
    #[msg("Vault balance decreased during a harvest")]
    VaultDecreased,

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
