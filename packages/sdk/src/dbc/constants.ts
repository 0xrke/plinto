/**
 * Constants of the Meteora DBC program 0.2.1 (commit f552f20), ported as bigint.
 * Source: vendor/dbc/programs/dynamic-bonding-curve/src/constants.rs
 */

export const U8_MAX = 0xffn;
export const U16_MAX = 0xffffn;
export const U24_MAX = 0xffffffn;
export const U32_MAX = 0xffff_ffffn;
export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;

export const RESOLUTION = 64n;
export const ONE_Q64 = 1n << 64n;

export const MIN_SQRT_PRICE = 4295048016n;
export const MAX_SQRT_PRICE = 79226673521066979257578248091n;

export const BASIS_POINT_MAX = 10_000n;
export const MAX_CURVE_POINT = 16;

export const FEE_DENOMINATOR = 1_000_000_000n;
export const MAX_FEE_NUMERATOR = 990_000_000n; // 99%
export const MIN_FEE_NUMERATOR = 2_500_000n; // 0.25%

export const MAX_MIGRATION_FEE_PERCENTAGE = 99;
export const MIN_MIGRATED_POOL_FEE_BPS = 10; // 0.1%
export const MAX_MIGRATED_POOL_FEE_BPS = 1000; // 10%

export const MIN_POOL_CREATION_FEE = 1_000_000n; // 0.001 SOL
export const MAX_POOL_CREATION_FEE = 100_000_000_000n; // 100 SOL

export const MIN_LOCKED_LIQUIDITY_BPS = 1000; // 10%
export const SWAP_BUFFER_PERCENTAGE = 25n;
export const PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS = 20n; // 0.2%

// Dynamic fee constraints.
export const BIN_STEP_BPS_DEFAULT = 1;
export const BIN_STEP_BPS_U128_DEFAULT = 1844674407370955n;

// DAMM v2 constants used by the migration handlers.
export const DAMM_V2_MAX_BASIS_POINT = 10_000;
export const DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY = 100n << 64n;

/** DBC `BaseFeeMode`. */
export const BaseFeeMode = {
  FeeSchedulerLinear: 0,
  FeeSchedulerExponential: 1,
  /** Deprecated for new configs. */
  RateLimiter: 2,
} as const;

/** DBC `CollectFeeMode`. */
export const CollectFeeMode = { QuoteToken: 0, OutputToken: 1 } as const;

/** DBC `MigratedCollectFeeMode` (maps to DAMM v2 OnlyB / BothToken / Compounding). */
export const MigratedCollectFeeMode = {
  QuoteToken: 0,
  OutputToken: 1,
  Compounding: 2,
} as const;

/** DBC `MigrationOption`. */
export const MigrationOption = { MeteoraDamm: 0, DammV2: 1 } as const;

/** DBC `MigrationFeeOption`. */
export const MigrationFeeOption = {
  FixedBps25: 0,
  FixedBps30: 1,
  FixedBps100: 2,
  FixedBps200: 3,
  FixedBps400: 4,
  FixedBps600: 5,
  Customizable: 6,
} as const;

/** DBC `TokenType` of the base mint. */
export const TokenType = { SplToken: 0, Token2022: 1 } as const;

/** DBC `TokenAuthorityOption`. */
export const TokenAuthorityOption = {
  CreatorUpdateAuthority: 0,
  Immutable: 1,
  PartnerUpdateAuthority: 2,
  CreatorUpdateAndMintAuthority: 3,
  PartnerUpdateAndMintAuthority: 4,
} as const;

/** DBC `ActivationType`. */
export const ActivationType = { Slot: 0, Timestamp: 1 } as const;

/** DAMM v2 `BaseFeeMode` as used by DBC for the migrated pool. */
export const DammV2BaseFeeMode = {
  FeeTimeSchedulerLinear: 0,
  FeeTimeSchedulerExponential: 1,
  RateLimiter: 2,
  FeeMarketCapSchedulerLinear: 3,
  FeeMarketCapSchedulerExponential: 4,
} as const;
