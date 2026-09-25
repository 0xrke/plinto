//! Seeds, limits and external program addresses.

use anchor_lang::prelude::*;

/// Seed of the per-launch registry PDA: `["launch", config]`.
pub const LAUNCH_SEED: &[u8] = b"launch";
/// Seed of the per-launch claimer PDA: `["authority", config]`.
///
/// It is the DBC `fee_claimer` and `leftover_receiver` and owns the DAMM v2 position NFTs and its
/// own base-token ATA (a transit account that is always burned empty). It signs the CPIs into DBC
/// and DAMM v2 and the burns of its base tokens. It has **no authority over the vault**: those
/// external programs are upgradeable, so the key they receive a signature from must never be able
/// to move, approve, close or re-own the floor backing.
pub const CLAIMER_SEED: &[u8] = b"authority";
/// Seed of the per-launch vault authority PDA: `["vault_authority", config]`.
///
/// It owns the vault (ATA of this PDA for the quote mint) and signs exactly one thing: the
/// `transfer_checked` of the net payout in `redeem`. It never signs a CPI into DBC or DAMM v2.
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";

/// Maximum exit fee accepted by `create_launch` (5%).
pub const MAX_EXIT_FEE_BPS: u16 = 500;

/// Allowed range for the DBC `migration_fee_percentage` (the share of the migration threshold
/// that becomes the partner migration fee). Of that fee, 5% of the threshold goes to the platform,
/// 5% to the creator and the rest to the vault (`math::graduation_split`), so the range [40, 70]
/// is a vault share of 30-60% of the raise and a DAMM v2 pool of 60-30% of it.
pub const MIN_MIGRATION_FEE_PERCENTAGE: u8 = 30;
pub const MAX_MIGRATION_FEE_PERCENTAGE: u8 = 99;

/// Maximum DBC `creator_trading_fee_percentage`: 0. The whole partner share of presale fees goes to
/// the platform treasury (v3 `harvest_curve_fees`); the creator is paid at graduation instead.
pub const MAX_CREATOR_TRADING_FEE_PERCENTAGE: u8 = 30;

/// Platform treasury (a plain key, not a PDA: a PDA would need an admin withdraw path). It is only
/// ever a payment destination, through its quote ATA `ATA(PLATFORM_TREASURY, quote_mint,
/// quote_token_program)`. Changing it needs a program upgrade.
#[constant]
pub const PLATFORM_TREASURY: Pubkey = pubkey!("78tRFS255ADZT2oMSXi5xjHt7Y2SVDLdDEBz759eQsqJ");
/// Platform share of the raise at graduation: 5% of `migration_quote_threshold`.
pub const PLATFORM_GRADUATION_FEE_BPS: u16 = 500;
/// Creator's one-off success bonus at graduation: 5% of `migration_quote_threshold`.
pub const CREATOR_GRADUATION_BONUS_BPS: u16 = 500;
/// Creator share of harvested DAMM v2 LP quote fees (v3).
pub const LP_FEE_CREATOR_BPS: u16 = 5_000;
/// Platform share of harvested DAMM v2 LP quote fees (v3). The vault gets the rest (>= 30%).
pub const LP_FEE_PLATFORM_BPS: u16 = 2_000;
/// Required DAMM v2 pool fee after migration: 1%.
pub const REQUIRED_MIGRATED_POOL_FEE_BPS: u16 = 100;
/// DBC `MigrationFeeOption::Customizable`: the migrated pool fee comes from the config itself
/// (the fixed tiers 0-5 inherit a static Meteora DAMM v2 config whose fees we cannot verify).
pub const DBC_MIGRATION_FEE_OPTION_CUSTOMIZABLE: u8 = 6;
/// First launch layout version whose harvests split fees between platform, creator and vault.
pub const LAUNCH_VERSION_FEE_SPLIT: u8 = 3;

/// DBC fee numerators are out of 1e9.
pub const DBC_FEE_DENOMINATOR: u64 = 1_000_000_000;
/// Maximum DBC curve base fee (`cliff_fee_numerator`, the highest fee of a fee scheduler):
/// 20%, the start of the brief's optional anti-snipe schedule (§4).
pub const MAX_CURVE_FEE_NUMERATOR: u64 = 200_000_000;

/// Launch account layout version. 2 = split claimer / vault authority bumps (M2); 3 = fee split
/// between platform, creator and vault, plus the platform and creator counters. Version 1 was never
/// deployed. Version 2 launches keep paying 100% of every harvest into the vault.
pub const LAUNCH_VERSION: u8 = 3;

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
    fn claimer_and_vault_authority_are_distinct_pdas() {
        for i in 0..64u8 {
            let config = Pubkey::new_from_array([i; 32]);
            let (claimer, _) =
                Pubkey::find_program_address(&[CLAIMER_SEED, config.as_ref()], &crate::ID);
            let (vault_authority, _) =
                Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED, config.as_ref()], &crate::ID);
            let (launch, _) =
                Pubkey::find_program_address(&[LAUNCH_SEED, config.as_ref()], &crate::ID);
            assert_ne!(claimer, vault_authority);
            assert_ne!(claimer, launch);
            assert_ne!(vault_authority, launch);
        }
        assert_eq!(CLAIMER_SEED, b"authority");
        assert_eq!(VAULT_AUTHORITY_SEED, b"vault_authority");
    }

    // Compile-time sanity checks of the limits.
    const _: () = assert!(MAX_EXIT_FEE_BPS as u64 <= crate::math::BPS_DENOMINATOR);
    const _: () = assert!(MIN_MIGRATION_FEE_PERCENTAGE <= MAX_MIGRATION_FEE_PERCENTAGE);
    const _: () = assert!(MAX_MIGRATION_FEE_PERCENTAGE < 100);
    const _: () = assert!(MAX_CREATOR_TRADING_FEE_PERCENTAGE <= 100);
    const _: () = assert!(MAX_CURVE_FEE_NUMERATOR < DBC_FEE_DENOMINATOR);
    // Graduation cuts leave the vault a share, and the LP split leaves the vault >= 30%.
    const _: () = assert!(
        (PLATFORM_GRADUATION_FEE_BPS as u64 + CREATOR_GRADUATION_BONUS_BPS as u64)
            < crate::math::BPS_DENOMINATOR
    );
    const _: () = assert!(
        LP_FEE_CREATOR_BPS as u64 + LP_FEE_PLATFORM_BPS as u64 + 3_000
            <= crate::math::BPS_DENOMINATOR
    );
    const _: () = assert!(LAUNCH_VERSION >= LAUNCH_VERSION_FEE_SPLIT);

    #[test]
    fn platform_treasury_is_the_agreed_key() {
        assert_eq!(
            PLATFORM_TREASURY.to_string(),
            "78tRFS255ADZT2oMSXi5xjHt7Y2SVDLdDEBz759eQsqJ"
        );
        assert_ne!(PLATFORM_TREASURY, Pubkey::default());
        assert!(PLATFORM_TREASURY.is_on_curve());
    }
}
