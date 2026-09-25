use anchor_lang::prelude::*;

use crate::constants::{CLAIMER_SEED, VAULT_AUTHORITY_SEED};

/// Per-launch registry. PDA `["launch", config]`.
///
/// There is no admin field: nothing in this account can be changed by anyone
/// except through the permissionless instructions of this program.
///
/// Layout version 3 (`8 + 343` bytes, unchanged in size since version 1: the vault authority bump
/// took one reserved byte in version 2, the platform and creator counters 16 in version 3). The
/// version also selects the fee routing of the harvests: see `fee_split_enabled`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Launch {
    /// Account layout version.
    pub version: u8,
    /// PDA bump of this account.
    pub bump: u8,
    /// PDA bump of the claimer `["authority", config]` (DBC fee_claimer, LP NFT owner, CPI signer).
    pub claimer_bump: u8,
    /// PDA bump of the vault authority `["vault_authority", config]` (vault owner, signs only the
    /// `redeem` payout).
    pub vault_authority_bump: u8,
    /// Exit fee in basis points, immutable, <= 500.
    pub exit_fee_bps: u16,
    /// `true` once the partner migration fee has been moved into the vault. Redemptions
    /// require it.
    pub migration_fee_harvested: bool,
    /// `true` once the partner surplus has been moved into the vault.
    pub surplus_harvested: bool,
    /// Latched to `true` the first time this program sees the registered DBC pool fully
    /// migrated to DAMM v2 (`sync_migration`, `harvest_migration_fee`, `harvest_surplus` or the
    /// first `redeem`). Once set, `redeem` never decodes DBC state again, so a later DBC upgrade
    /// that changes the VirtualPool layout cannot lock redemptions.
    pub migrated: bool,
    /// DBC config (one config per launch).
    pub config: Pubkey,
    /// Launch creator (signed `create_launch`). Informational: registration is permissionless.
    pub creator: Pubkey,
    /// Canonical DBC virtual pool. `Pubkey::default()` until `register_pool`.
    pub pool: Pubkey,
    /// Base token mint (SPL Token), committed by `create_launch`. The DBC pool of
    /// `(config, base_mint)` is unique, so `register_pool` is permissionless.
    pub base_mint: Pubkey,
    /// Quote mint (from the DBC config).
    pub quote_mint: Pubkey,
    /// Token program owning the quote mint (Token-2022 for xStocks).
    pub quote_token_program: Pubkey,
    /// Floor vault: ATA(vault authority, quote_mint, quote_token_program).
    pub vault: Pubkey,
    /// Unix timestamp of `create_launch`.
    pub created_at: i64,
    /// Informational counters (saturating; never used for access control or math).
    pub total_harvested_quote: u64,
    pub total_burned_base: u64,
    pub total_redeemed_base: u64,
    pub total_redeemed_quote: u64,
    pub total_exit_fees: u64,
    /// Quote paid to the platform treasury by harvests (v3; informational, saturating).
    pub total_platform_quote: u64,
    /// Quote paid to the launch creator by harvests (v3; informational, saturating).
    pub total_creator_quote: u64,
    /// Reserved for future fields.
    pub reserved: [u8; 46],
}

impl Launch {
    pub fn is_pool_registered(&self) -> bool {
        self.pool != Pubkey::default()
    }

    /// `true` for launches created with the v3 fee model: curve fees go to the platform, the
    /// migration fee and LP fees are split between platform, creator and vault. Older launches
    /// (version 2, e.g. the live mainnet demo) keep paying 100% of every harvest into the vault.
    pub fn fee_split_enabled(&self) -> bool {
        self.version >= crate::constants::LAUNCH_VERSION_FEE_SPLIT
    }

    /// Address of the claimer PDA from the stored bump (`create_program_address`, no search).
    pub fn claimer_key(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[CLAIMER_SEED, self.config.as_ref(), &[self.claimer_bump]],
            &crate::ID,
        )
        .map_err(|_| ErrorCode::ConstraintSeeds.into())
    }

    /// Address of the vault authority PDA from the stored bump (`create_program_address`).
    pub fn vault_authority_key(&self) -> Result<Pubkey> {
        Pubkey::create_program_address(
            &[
                VAULT_AUTHORITY_SEED,
                self.config.as_ref(),
                &[self.vault_authority_bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ErrorCode::ConstraintSeeds.into())
    }
}

/// Return value of the `floor` view.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct FloorInfo {
    /// Raw quote units in the vault.
    pub vault_raw: u64,
    /// Raw base mint supply (0 before `register_pool`).
    pub supply: u64,
    /// Exit fee in basis points.
    pub exit_fee_bps: u16,
    /// Floor per token as Q64.64 raw quote units per raw base unit:
    /// `(vault_raw << 64) / supply`, 0 when the supply is 0.
    pub floor_q64: u128,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::LAUNCH_SEED;

    #[test]
    fn launch_size_is_stable() {
        // 8 discriminator + 343 body, the same size as layout version 1.
        assert_eq!(Launch::INIT_SPACE, 343);
    }

    fn sample_launch(version: u8) -> Launch {
        Launch {
            version,
            bump: 1,
            claimer_bump: 2,
            vault_authority_bump: 3,
            exit_fee_bps: 0x0405,
            migration_fee_harvested: true,
            surplus_harvested: false,
            migrated: true,
            config: Pubkey::new_from_array([10; 32]),
            creator: Pubkey::new_from_array([11; 32]),
            pool: Pubkey::new_from_array([12; 32]),
            base_mint: Pubkey::new_from_array([13; 32]),
            quote_mint: Pubkey::new_from_array([14; 32]),
            quote_token_program: Pubkey::new_from_array([15; 32]),
            vault: Pubkey::new_from_array([16; 32]),
            created_at: 0x1718_1920_2122_2324,
            total_harvested_quote: 101,
            total_burned_base: 102,
            total_redeemed_base: 103,
            total_redeemed_quote: 104,
            total_exit_fees: 105,
            total_platform_quote: 0x0102_0304_0506_0708,
            total_creator_quote: 0x1112_1314_1516_1718,
            reserved: [0xEE; 46],
        }
    }

    /// Byte offsets inside the account data (with the 8-byte discriminator), as the SDK decodes
    /// them: `total_platform_quote` at 289, `total_creator_quote` at 297, `reserved` at 305.
    #[test]
    fn v3_layout_offsets() {
        use anchor_lang::{AccountSerialize, Discriminator};
        let launch = sample_launch(3);
        let mut data = Vec::new();
        launch.try_serialize(&mut data).unwrap();
        assert_eq!(data.len(), 8 + Launch::INIT_SPACE);
        assert_eq!(&data[..8], Launch::DISCRIMINATOR);
        assert_eq!(data[8], 3);
        assert_eq!(&data[12..14], &0x0405u16.to_le_bytes());
        assert_eq!(&data[17..49], &[10u8; 32]); // config
        assert_eq!(&data[49..81], &[11u8; 32]); // creator
        assert_eq!(&data[209..241], &[16u8; 32]); // vault
        assert_eq!(&data[241..249], &0x1718_1920_2122_2324i64.to_le_bytes());
        assert_eq!(&data[249..257], &101u64.to_le_bytes()); // total_harvested_quote
        assert_eq!(&data[281..289], &105u64.to_le_bytes()); // total_exit_fees
        assert_eq!(&data[289..297], &0x0102_0304_0506_0708u64.to_le_bytes());
        assert_eq!(&data[297..305], &0x1112_1314_1516_1718u64.to_le_bytes());
        assert_eq!(&data[305..351], &[0xEEu8; 46]);
    }

    /// A version 2 account (zeroed reserved bytes) decodes with zero counters.
    #[test]
    fn v2_account_decodes_with_zero_counters() {
        use anchor_lang::{AccountDeserialize, AccountSerialize};
        let mut v2 = sample_launch(2);
        v2.total_platform_quote = 0;
        v2.total_creator_quote = 0;
        v2.reserved = [0; 46];
        let mut data = Vec::new();
        v2.try_serialize(&mut data).unwrap();
        let decoded = Launch::try_deserialize(&mut data.as_slice()).unwrap();
        assert_eq!(decoded.version, 2);
        assert_eq!(decoded.total_platform_quote, 0);
        assert_eq!(decoded.total_creator_quote, 0);
        assert!(!decoded.fee_split_enabled());
    }

    #[test]
    fn fee_split_is_enabled_from_version_3() {
        assert!(!sample_launch(1).fee_split_enabled());
        assert!(!sample_launch(2).fee_split_enabled());
        assert!(sample_launch(3).fee_split_enabled());
        assert!(sample_launch(crate::constants::LAUNCH_VERSION).fee_split_enabled());
    }

    #[test]
    fn stored_bumps_derive_the_canonical_pdas() {
        for i in 0..32u8 {
            let config = Pubkey::new_from_array([i.wrapping_mul(7).wrapping_add(1); 32]);
            let (claimer, claimer_bump) =
                Pubkey::find_program_address(&[CLAIMER_SEED, config.as_ref()], &crate::ID);
            let (vault_authority, vault_authority_bump) =
                Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED, config.as_ref()], &crate::ID);
            let (_, bump) =
                Pubkey::find_program_address(&[LAUNCH_SEED, config.as_ref()], &crate::ID);
            let launch = Launch {
                version: crate::constants::LAUNCH_VERSION,
                bump,
                claimer_bump,
                vault_authority_bump,
                exit_fee_bps: 200,
                migration_fee_harvested: false,
                surplus_harvested: false,
                migrated: false,
                config,
                creator: Pubkey::default(),
                pool: Pubkey::default(),
                base_mint: Pubkey::default(),
                quote_mint: Pubkey::default(),
                quote_token_program: Pubkey::default(),
                vault: Pubkey::default(),
                created_at: 0,
                total_harvested_quote: 0,
                total_burned_base: 0,
                total_redeemed_base: 0,
                total_redeemed_quote: 0,
                total_exit_fees: 0,
                total_platform_quote: 0,
                total_creator_quote: 0,
                reserved: [0; 46],
            };
            assert_eq!(launch.claimer_key().unwrap(), claimer);
            assert_eq!(launch.vault_authority_key().unwrap(), vault_authority);
            assert_ne!(claimer, vault_authority);
        }
    }
}
