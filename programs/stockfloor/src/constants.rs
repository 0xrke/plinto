//! Seeds, limits and external program addresses.

use anchor_lang::prelude::*;

/// Seed of the per-launch registry PDA: `["launch", config]`.
pub const LAUNCH_SEED: &[u8] = b"launch";
/// Seed of the per-launch signer PDA: `["authority", config]`.
/// It is the DBC `fee_claimer` and `leftover_receiver`, owns the vault and the LP position NFTs.
pub const AUTHORITY_SEED: &[u8] = b"authority";

/// Maximum exit fee accepted by `create_launch` (5%).
pub const MAX_EXIT_FEE_BPS: u16 = 500;

/// Allowed range for the DBC `migration_fee_percentage` (the share of the migration
/// threshold that becomes the partner migration fee, i.e. the initial floor).
/// 99 is the maximum accepted by DBC itself (`MAX_MIGRATION_FEE_PERCENTAGE`).
pub const MIN_MIGRATION_FEE_PERCENTAGE: u8 = 30;
pub const MAX_MIGRATION_FEE_PERCENTAGE: u8 = 99;

/// Launch account layout version.
pub const LAUNCH_VERSION: u8 = 1;

/// External programs and their well-known PDAs.
pub mod external {
    use super::*;

    /// Meteora Dynamic Bonding Curve program.
    pub const DBC_PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
    /// DBC `["pool_authority"]` PDA (const in DBC `const_pda::pool_authority`).
    pub const DBC_POOL_AUTHORITY: Pubkey = pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
    /// DBC Anchor event authority `["__event_authority"]`.
    pub const DBC_EVENT_AUTHORITY: Pubkey = pubkey!("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");

    /// Meteora DAMM v2 (cp-amm) program.
    pub const DAMM_V2_PROGRAM_ID: Pubkey = pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
    /// DAMM v2 `["pool_authority"]` PDA.
    pub const DAMM_V2_POOL_AUTHORITY: Pubkey =
        pubkey!("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
    /// DAMM v2 Anchor event authority `["__event_authority"]`.
    pub const DAMM_V2_EVENT_AUTHORITY: Pubkey =
        pubkey!("3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet");
}

#[cfg(test)]
mod tests {
    use super::external::*;
    use super::*;

    #[test]
    fn external_ids_match_declared_programs() {
        assert_eq!(DBC_PROGRAM_ID, crate::dynamic_bonding_curve::ID);
        assert_eq!(DAMM_V2_PROGRAM_ID, crate::cp_amm::ID);
    }

    #[test]
    fn external_pdas_are_correct() {
        let (dbc_pool_authority, _) =
            Pubkey::find_program_address(&[b"pool_authority"], &DBC_PROGRAM_ID);
        assert_eq!(dbc_pool_authority, DBC_POOL_AUTHORITY);
        let (dbc_event_authority, _) =
            Pubkey::find_program_address(&[b"__event_authority"], &DBC_PROGRAM_ID);
        assert_eq!(dbc_event_authority, DBC_EVENT_AUTHORITY);
        let (damm_pool_authority, _) =
            Pubkey::find_program_address(&[b"pool_authority"], &DAMM_V2_PROGRAM_ID);
        assert_eq!(damm_pool_authority, DAMM_V2_POOL_AUTHORITY);
        let (damm_event_authority, _) =
            Pubkey::find_program_address(&[b"__event_authority"], &DAMM_V2_PROGRAM_ID);
        assert_eq!(damm_event_authority, DAMM_V2_EVENT_AUTHORITY);
    }

    #[test]
    fn limits_are_sane() {
        assert!(MAX_EXIT_FEE_BPS as u64 <= crate::math::BPS_DENOMINATOR);
        assert!(MIN_MIGRATION_FEE_PERCENTAGE <= MAX_MIGRATION_FEE_PERCENTAGE);
        assert!(MAX_MIGRATION_FEE_PERCENTAGE < 100);
    }
}
