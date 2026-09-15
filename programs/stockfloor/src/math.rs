//! Pure redemption math. No Solana types, no I/O: everything here is unit and
//! property tested on the host.
//!
//! Notation: `V` = vault balance (raw quote units), `S` = base mint supply (raw),
//! `A` = amount of base tokens burned, `f` = exit fee in basis points / 10_000.
//!
//! ```text
//! gross = floor(V * A / S)
//! fee   = ceil(gross * bps / 10_000)
//! net   = gross - fee
//! ```
//!
//! All intermediate products use u128 (`u64 * u64 < 2^128`), every operation is
//! checked, and every rounding step favours the vault (the remaining holders).

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Result of a redemption quote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RedeemQuote {
    /// `floor(V * A / S)`: exact pro-rata share rounded down.
    pub gross: u64,
    /// `ceil(gross * bps / 10_000)`: exit fee, stays in the vault.
    pub fee: u64,
    /// `gross - fee`: amount transferred to the redeemer.
    pub net: u64,
}

/// Math failures. Mapped to program errors in `errors.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// `amount == 0`.
    ZeroAmount,
    /// `supply == 0` (nothing can be redeemed against an empty supply).
    ZeroSupply,
    /// `amount > supply` (impossible on-chain, rejected defensively).
    AmountExceedsSupply,
    /// `bps > 10_000`.
    InvalidFeeBps,
    /// Checked arithmetic failed (unreachable for valid inputs, kept defensive).
    Overflow,
    /// `net == 0`: the redeemer would burn tokens and receive nothing.
    NothingToRedeem,
}

/// Quote a redemption of `amount` base tokens against `vault_raw` quote tokens
/// and `supply` base tokens with an exit fee of `exit_fee_bps`.
///
/// Returns `MathError::NothingToRedeem` when `net == 0`, so a caller can never
/// burn tokens for nothing.
pub fn compute_redeem(
    vault_raw: u64,
    supply: u64,
    amount: u64,
    exit_fee_bps: u16,
) -> Result<RedeemQuote, MathError> {
    if amount == 0 {
        return Err(MathError::ZeroAmount);
    }
    if supply == 0 {
        return Err(MathError::ZeroSupply);
    }
    if amount > supply {
        return Err(MathError::AmountExceedsSupply);
    }
    if u64::from(exit_fee_bps) > BPS_DENOMINATOR {
        return Err(MathError::InvalidFeeBps);
    }

    let gross = pro_rata_floor(vault_raw, amount, supply)?;
    let fee = fee_ceil(gross, exit_fee_bps)?;
    let net = gross.checked_sub(fee).ok_or(MathError::Overflow)?;
    if net == 0 {
        return Err(MathError::NothingToRedeem);
    }
    Ok(RedeemQuote { gross, fee, net })
}

/// `floor(value * numerator / denominator)` in u128. The result fits in u64
/// whenever `numerator <= denominator`.
pub fn pro_rata_floor(value: u64, numerator: u64, denominator: u64) -> Result<u64, MathError> {
    if denominator == 0 {
        return Err(MathError::ZeroSupply);
    }
    let product = (value as u128)
        .checked_mul(numerator as u128)
        .ok_or(MathError::Overflow)?;
    let quotient = product
        .checked_div(denominator as u128)
        .ok_or(MathError::Overflow)?;
    u64::try_from(quotient).map_err(|_| MathError::Overflow)
}

/// `ceil(amount * bps / 10_000)`.
pub fn fee_ceil(amount: u64, bps: u16) -> Result<u64, MathError> {
    if u64::from(bps) > BPS_DENOMINATOR {
        return Err(MathError::InvalidFeeBps);
    }
    let product = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(MathError::Overflow)?;
    let fee = product
        .checked_add((BPS_DENOMINATOR - 1) as u128)
        .ok_or(MathError::Overflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(MathError::Overflow)?;
    u64::try_from(fee).map_err(|_| MathError::Overflow)
}

/// Vault and supply after a redemption: `(V - net, S - A)`.
pub fn apply_redeem(
    vault_raw: u64,
    supply: u64,
    amount: u64,
    exit_fee_bps: u16,
) -> Result<(u64, u64, RedeemQuote), MathError> {
    let quote = compute_redeem(vault_raw, supply, amount, exit_fee_bps)?;
    let new_vault = vault_raw
        .checked_sub(quote.net)
        .ok_or(MathError::Overflow)?;
    let new_supply = supply.checked_sub(amount).ok_or(MathError::Overflow)?;
    Ok((new_vault, new_supply, quote))
}

/// `true` when the floor `vault/supply` did not decrease from `(v0, s0)` to `(v1, s1)`.
///
/// Compares `v1 * s0 >= v0 * s1` by cross-multiplication in u128 (exact, no
/// division). An empty supply after the transition (`s1 == 0`) has no floor and
/// is treated as non-decreasing. An empty supply before (`s0 == 0`) is only
/// consistent if the supply stays empty.
pub fn floor_not_decreased(v0: u64, s0: u64, v1: u64, s1: u64) -> bool {
    if s1 == 0 {
        return true;
    }
    if s0 == 0 {
        return false;
    }
    (v1 as u128) * (s0 as u128) >= (v0 as u128) * (s1 as u128)
}

/// `true` when the floor strictly increased from `(v0, s0)` to `(v1, s1)`, both supplies non-zero.
pub fn floor_increased(v0: u64, s0: u64, v1: u64, s1: u64) -> bool {
    if s0 == 0 || s1 == 0 {
        return false;
    }
    (v1 as u128) * (s0 as u128) > (v0 as u128) * (s1 as u128)
}

/// Floor per base token as a Q64.64 fixed-point number of raw quote units per raw
/// base unit, or `None` when the supply is zero.
pub fn floor_q64(vault_raw: u64, supply: u64) -> Option<u128> {
    if supply == 0 {
        return None;
    }
    Some(((vault_raw as u128) << 64) / supply as u128)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ---------------------------------------------------------------------
    // Test helpers: 256-bit comparisons of products of u128 values.
    // ---------------------------------------------------------------------

    /// Full 256-bit product of two u128 values as (high, low).
    fn mul_wide(a: u128, b: u128) -> (u128, u128) {
        let mask = u64::MAX as u128;
        let (a_hi, a_lo) = (a >> 64, a & mask);
        let (b_hi, b_lo) = (b >> 64, b & mask);
        let lo_lo = a_lo * b_lo;
        let hi_lo = a_hi * b_lo;
        let lo_hi = a_lo * b_hi;
        let hi_hi = a_hi * b_hi;
        let cross = (lo_lo >> 64) + (hi_lo & mask) + (lo_hi & mask);
        let low = (cross << 64) | (lo_lo & mask);
        let high = hi_hi + (hi_lo >> 64) + (lo_hi >> 64) + (cross >> 64);
        (high, low)
    }

    /// `a * b <= c * d` exactly.
    fn prod_le(a: u128, b: u128, c: u128, d: u128) -> bool {
        mul_wide(a, b) <= mul_wide(c, d)
    }

    /// Exact rational bound for one step: `net * S * 10_000 <= V * A * (10_000 - bps)`.
    fn net_within_fee_adjusted_pro_rata(v: u64, s: u64, a: u64, bps: u16, net: u64) -> bool {
        let lhs_a = (net as u128) * (s as u128);
        let rhs_a = (v as u128) * (a as u128);
        prod_le(
            lhs_a,
            BPS_DENOMINATOR as u128,
            rhs_a,
            (BPS_DENOMINATOR - bps as u64) as u128,
        )
    }

    #[test]
    fn mul_wide_matches_small_products() {
        assert_eq!(mul_wide(3, 5), (0, 15));
        assert_eq!(mul_wide(u128::MAX, 1), (0, u128::MAX));
        assert_eq!(mul_wide(u128::MAX, 2), (1, u128::MAX - 1));
        assert_eq!(mul_wide(1u128 << 64, 1u128 << 64), (1, 0));
        assert_eq!(mul_wide(u128::MAX, u128::MAX), (u128::MAX - 1, 1));
    }

    // ---------------------------------------------------------------------
    // Exact formulas and rounding.
    // ---------------------------------------------------------------------

    #[test]
    fn exact_example_from_brief() {
        // 1_000 quote, 100 supply, redeem 10 at 2%: gross 100, fee 2, net 98.
        let q = compute_redeem(1_000, 100, 10, 200).unwrap();
        assert_eq!(
            q,
            RedeemQuote {
                gross: 100,
                fee: 2,
                net: 98
            }
        );
    }

    #[test]
    fn gross_rounds_down() {
        // 10 * 1 / 3 = 3.33 -> 3
        let q = compute_redeem(10, 3, 1, 0).unwrap();
        assert_eq!(q.gross, 3);
        assert_eq!(q.fee, 0);
        assert_eq!(q.net, 3);
        // 10 * 2 / 3 = 6.66 -> 6
        assert_eq!(compute_redeem(10, 3, 2, 0).unwrap().gross, 6);
    }

    #[test]
    fn fee_rounds_up() {
        // gross 99, 2% = 1.98 -> 2
        let q = compute_redeem(99, 1, 1, 200).unwrap();
        assert_eq!(
            q,
            RedeemQuote {
                gross: 99,
                fee: 2,
                net: 97
            }
        );
        // gross 1, any positive bps -> fee 1 -> net 0 -> rejected
        assert_eq!(compute_redeem(1, 1, 1, 1), Err(MathError::NothingToRedeem));
        // gross 50, 2% = exactly 1 -> 1 (no extra rounding when exact)
        assert_eq!(compute_redeem(50, 1, 1, 200).unwrap().fee, 1);
        // gross 51, 2% = 1.02 -> 2
        assert_eq!(compute_redeem(51, 1, 1, 200).unwrap().fee, 2);
    }

    #[test]
    fn fee_ceil_table() {
        assert_eq!(fee_ceil(0, 200), Ok(0));
        assert_eq!(fee_ceil(1, 0), Ok(0));
        assert_eq!(fee_ceil(1, 1), Ok(1));
        assert_eq!(fee_ceil(10_000, 1), Ok(1));
        assert_eq!(fee_ceil(10_001, 1), Ok(2));
        assert_eq!(fee_ceil(10_000, 200), Ok(200));
        assert_eq!(fee_ceil(10_000, 10_000), Ok(10_000));
        assert_eq!(fee_ceil(1, 10_001), Err(MathError::InvalidFeeBps));
        assert_eq!(fee_ceil(u64::MAX, 10_000), Ok(u64::MAX));
    }

    #[test]
    fn zero_net_is_rejected() {
        // gross 0 because vault is tiny relative to supply
        assert_eq!(
            compute_redeem(1, 1_000, 1, 0),
            Err(MathError::NothingToRedeem)
        );
        // empty vault
        assert_eq!(
            compute_redeem(0, 1_000, 1_000, 0),
            Err(MathError::NothingToRedeem)
        );
        // gross 1 eaten entirely by the ceil fee
        assert_eq!(
            compute_redeem(1_000, 1_000, 1, 200),
            Err(MathError::NothingToRedeem)
        );
    }

    #[test]
    fn input_validation() {
        assert_eq!(compute_redeem(100, 100, 0, 200), Err(MathError::ZeroAmount));
        assert_eq!(compute_redeem(100, 0, 1, 200), Err(MathError::ZeroSupply));
        assert_eq!(
            compute_redeem(100, 10, 11, 200),
            Err(MathError::AmountExceedsSupply)
        );
        assert_eq!(
            compute_redeem(100, 10, 1, 10_001),
            Err(MathError::InvalidFeeBps)
        );
        assert_eq!(pro_rata_floor(1, 1, 0), Err(MathError::ZeroSupply));
    }

    #[test]
    fn full_fee_bps_is_valid_but_pays_nothing() {
        assert_eq!(
            compute_redeem(1_000, 10, 10, 10_000),
            Err(MathError::NothingToRedeem)
        );
    }

    #[test]
    fn redeeming_entire_supply() {
        // No fee: the last holder takes the whole vault.
        let (v, s, q) = apply_redeem(123_456_789, 1_000_000, 1_000_000, 0).unwrap();
        assert_eq!(q.gross, 123_456_789);
        assert_eq!(q.net, 123_456_789);
        assert_eq!((v, s), (0, 0));

        // With a fee: the fee stays in the vault even though supply is now zero.
        let (v, s, q) = apply_redeem(1_000_000, 500, 500, 200).unwrap();
        assert_eq!(
            q,
            RedeemQuote {
                gross: 1_000_000,
                fee: 20_000,
                net: 980_000
            }
        );
        assert_eq!((v, s), (20_000, 0));
        assert!(floor_not_decreased(1_000_000, 500, v, s));
    }

    #[test]
    fn overflow_safety_at_u64_max() {
        let max = u64::MAX;
        let q = compute_redeem(max, max, max, 0).unwrap();
        assert_eq!(
            q,
            RedeemQuote {
                gross: max,
                fee: 0,
                net: max
            }
        );

        let q = compute_redeem(max, max, max, 500).unwrap();
        let expected_fee = (max as u128 * 500).div_ceil(10_000) as u64;
        assert_eq!(q.gross, max);
        assert_eq!(q.fee, expected_fee);
        assert_eq!(q.net, max - expected_fee);

        let q = compute_redeem(max, max, 1, 0).unwrap();
        assert_eq!(q.gross, 1);

        let q = compute_redeem(max, 1, 1, 10_000 - 1).unwrap();
        assert_eq!(q.gross, max);
        assert_eq!(q.fee, (max as u128 * 9_999).div_ceil(10_000) as u64);

        assert_eq!(
            compute_redeem(1, max, max - 1, 0),
            Err(MathError::NothingToRedeem)
        );
        let q = compute_redeem(max, max, max - 1, 0).unwrap();
        assert_eq!(q.gross, max - 1);

        assert!(floor_not_decreased(max, max, max, max));
        assert!(!floor_increased(max, max, max, max));
        assert_eq!(floor_q64(max, max), Some(1u128 << 64));
        assert_eq!(floor_q64(max, 1), Some((max as u128) << 64));
    }

    #[test]
    fn floor_helpers() {
        assert!(floor_not_decreased(100, 10, 91, 9));
        assert!(floor_increased(100, 10, 91, 9));
        assert!(floor_not_decreased(100, 10, 90, 9));
        assert!(!floor_increased(100, 10, 90, 9));
        assert!(!floor_not_decreased(100, 10, 89, 9));
        assert!(floor_not_decreased(100, 10, 0, 0));
        assert!(!floor_not_decreased(0, 0, 1, 1));
        assert!(floor_not_decreased(0, 0, 0, 0));
        assert_eq!(floor_q64(1, 0), None);
        assert_eq!(floor_q64(0, 5), Some(0));
        assert_eq!(floor_q64(3, 2), Some((3u128 << 64) / 2));
    }

    #[test]
    fn donation_only_raises_floor() {
        let (v0, s0) = (1_000u64, 100u64);
        let donated = v0 + 1;
        assert!(floor_increased(v0, s0, donated, s0));
        // and a redemption after the donation pays at least as much as before
        let before = compute_redeem(v0, s0, 10, 200).unwrap();
        let after = compute_redeem(donated, s0, 10, 200).unwrap();
        assert!(after.net >= before.net);
    }

    #[test]
    fn many_tiny_redemptions_zero_fee_never_beat_one_large() {
        let (v, s) = (1_000_003u64, 999_983u64);
        let total = 500_000u64;
        let single = compute_redeem(v, s, total, 0).unwrap().net;
        let mut vault = v;
        let mut supply = s;
        let mut received = 0u64;
        let mut remaining = total;
        while remaining > 0 {
            let step = remaining.min(7);
            remaining -= step;
            match apply_redeem(vault, supply, step, 0) {
                Ok((nv, ns, q)) => {
                    assert!(floor_not_decreased(vault, supply, nv, ns));
                    vault = nv;
                    supply = ns;
                    received += q.net;
                }
                // Zero-net steps are rejected: the holder keeps the tokens.
                Err(MathError::NothingToRedeem) => {}
                Err(e) => panic!("unexpected {e:?}"),
            }
        }
        assert!(received <= single, "received {received} > single {single}");
    }

    #[test]
    fn many_tiny_redemptions_with_fee_bounded_by_continuous_limit() {
        let (v, s) = (10_000_000_000u64, 1_000_000_000u64);
        let total = 900_000_000u64;
        let bps = 200u16;
        let single = compute_redeem(v, s, total, bps).unwrap().net;
        let mut vault = v;
        let mut supply = s;
        let mut received = 0u64;
        let mut remaining = total;
        let step = 1_000_000u64;
        while remaining > 0 {
            let a = remaining.min(step);
            remaining -= a;
            let (nv, ns, q) = apply_redeem(vault, supply, a, bps).unwrap();
            assert!(floor_increased(vault, supply, nv, ns));
            vault = nv;
            supply = ns;
            received += q.net;
        }
        // Fee redistribution: sequential redemptions receive more than one big one...
        assert!(received > single);
        // ...but never more than the continuous limit, nor the fee-free pro-rata amount.
        let bound = continuous_limit(v, s, total, bps);
        assert!(
            (received as f64) <= bound + 1.0,
            "received {received} bound {bound}"
        );
        assert!(received <= pro_rata_floor(v, total, s).unwrap());
    }

    /// `V * (1 - ((S - A) / S)^(1 - f))`: what an idealised holder could extract by
    /// redeeming `A` tokens in infinitesimally small steps with fee `f`.
    fn continuous_limit(v: u64, s: u64, a: u64, bps: u16) -> f64 {
        let f = bps as f64 / BPS_DENOMINATOR as f64;
        let remaining_ratio = (s - a) as f64 / s as f64;
        v as f64 * (1.0 - remaining_ratio.powf(1.0 - f))
    }

    // ---------------------------------------------------------------------
    // Property tests.
    // ---------------------------------------------------------------------

    fn bps_strategy() -> impl Strategy<Value = u16> {
        prop_oneof![
            Just(0u16),
            Just(200u16),
            Just(500u16),
            0u16..=500u16,
            0u16..=10_000u16
        ]
    }

    /// (vault, supply, amount) with amount in [1, supply], covering full u64 range and small values.
    fn state_strategy() -> impl Strategy<Value = (u64, u64, u64)> {
        let big = (any::<u64>(), 1u64..=u64::MAX).prop_flat_map(|(v, s)| (Just(v), Just(s), 1..=s));
        let small = (0u64..10_000, 1u64..10_000).prop_flat_map(|(v, s)| (Just(v), Just(s), 1..=s));
        let realistic = (
            0u64..=1_000_000_000_000_000u64,
            1u64..=1_000_000_000_000_000u64,
        )
            .prop_flat_map(|(v, s)| (Just(v), Just(s), 1..=s));
        prop_oneof![big, small, realistic]
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 4096, .. ProptestConfig::default() })]

        /// Formulas are exactly as specified, and the fee never exceeds gross.
        #[test]
        fn prop_formula_exact((v, s, a) in state_strategy(), bps in bps_strategy()) {
            let gross = ((v as u128) * (a as u128) / (s as u128)) as u64;
            let fee = ((gross as u128) * (bps as u128)).div_ceil(10_000) as u64;
            let net = gross - fee;
            match compute_redeem(v, s, a, bps) {
                Ok(q) => {
                    prop_assert_eq!(q, RedeemQuote { gross, fee, net });
                    prop_assert!(q.net > 0);
                    prop_assert!(q.fee <= q.gross);
                    prop_assert!(q.gross <= v);
                }
                Err(MathError::NothingToRedeem) => prop_assert_eq!(net, 0),
                Err(e) => prop_assert!(false, "unexpected error {:?}", e),
            }
        }

        /// Floor after redeem >= floor before; strictly greater when the fee is positive.
        #[test]
        fn prop_floor_monotonic((v, s, a) in state_strategy(), bps in bps_strategy()) {
            if let Ok((nv, ns, q)) = apply_redeem(v, s, a, bps) {
                prop_assert!(floor_not_decreased(v, s, nv, ns));
                if bps > 0 && q.fee > 0 && ns > 0 {
                    prop_assert!(floor_increased(v, s, nv, ns));
                }
            }
        }

        /// net <= exact rational pro-rata * (1 - bps/10_000), and gross <= exact pro-rata.
        #[test]
        fn prop_net_bounded_by_rational_pro_rata((v, s, a) in state_strategy(), bps in bps_strategy()) {
            if let Ok(q) = compute_redeem(v, s, a, bps) {
                prop_assert!(net_within_fee_adjusted_pro_rata(v, s, a, bps, q.net));
                // gross * S <= V * A
                prop_assert!((q.gross as u128) * (s as u128) <= (v as u128) * (a as u128));
            }
        }

        /// Rounding never favours the redeemer: a redemption of A+1 never pays less
        /// than one of A (monotonic in amount), and never more than V.
        #[test]
        fn prop_monotonic_in_amount((v, s, a) in state_strategy(), bps in bps_strategy()) {
            prop_assume!(a < s);
            let small = compute_redeem(v, s, a, bps).map(|q| q.net).unwrap_or(0);
            let large = compute_redeem(v, s, a + 1, bps).map(|q| q.net).unwrap_or(0);
            prop_assert!(small <= large);
            prop_assert!(large <= v);
        }

        /// Without an exit fee, no split of A into sequential redemptions receives more
        /// than a single redemption of A.
        #[test]
        fn prop_split_never_beats_single_without_fee(
            v in any::<u64>(),
            s in 1u64..=u64::MAX,
            parts in prop::collection::vec(1u64..=u64::MAX, 1..24),
        ) {
            let (received, total) = run_split(v, s, &parts, 0);
            prop_assume!(total > 0);
            let single = compute_redeem(v, s, total, 0).map(|q| q.net).unwrap_or(0);
            prop_assert!(received <= single, "received {} single {}", received, single);
        }

        /// Small-number variant of the split property (dense rounding edge cases).
        #[test]
        fn prop_split_never_beats_single_without_fee_small(
            v in 0u64..5_000,
            s in 1u64..5_000,
            parts in prop::collection::vec(1u64..50, 1..64),
        ) {
            let (received, total) = run_split(v, s, &parts, 0);
            prop_assume!(total > 0);
            let single = compute_redeem(v, s, total, 0).map(|q| q.net).unwrap_or(0);
            prop_assert!(received <= single, "received {} single {}", received, single);
        }

        /// With any fee: every step is bounded by the fee-adjusted rational pro-rata of the
        /// state at that step, the floor never decreases along the sequence, the total never
        /// exceeds the fee-free pro-rata amount floor(V*A/S), and the total is bounded by the
        /// continuous-limit amount V*(1-((S-A)/S)^(1-f)).
        #[test]
        fn prop_split_with_fee_bounded(
            v in 0u64..=(1u64 << 52),
            s in 1u64..=(1u64 << 52),
            parts in prop::collection::vec(1u64..=(1u64 << 52), 1..24),
            bps in bps_strategy(),
        ) {
            let mut vault = v;
            let mut supply = s;
            let mut received = 0u64;
            let mut total = 0u64;
            for &p in &parts {
                if supply == 0 { break; }
                let a = p.min(supply);
                match apply_redeem(vault, supply, a, bps) {
                    Ok((nv, ns, q)) => {
                        prop_assert!(net_within_fee_adjusted_pro_rata(vault, supply, a, bps, q.net));
                        prop_assert!(floor_not_decreased(vault, supply, nv, ns));
                        prop_assert!(floor_not_decreased(v, s, nv, ns));
                        vault = nv;
                        supply = ns;
                        received += q.net;
                        total += a;
                    }
                    Err(MathError::NothingToRedeem) => {}
                    Err(e) => prop_assert!(false, "unexpected error {:?}", e),
                }
            }
            prop_assume!(total > 0);
            prop_assert!(received <= pro_rata_floor(v, total, s).unwrap());
            let bound = continuous_limit(v, s, total, bps);
            // f64 is exact for integers below 2^53; allow a tiny relative tolerance for powf.
            let tolerance = 1.0 + bound.abs() * 1e-9;
            prop_assert!(
                (received as f64) <= bound + tolerance,
                "received {} bound {} (v {} s {} total {} bps {})", received, bound, v, s, total, bps
            );
        }

        /// Q64 floor is consistent with cross-multiplication comparisons.
        #[test]
        fn prop_floor_q64_consistent((v, s, a) in state_strategy(), bps in bps_strategy()) {
            if let Ok((nv, ns, _)) = apply_redeem(v, s, a, bps) {
                if ns > 0 {
                    let before = floor_q64(v, s).unwrap();
                    let after = floor_q64(nv, ns).unwrap();
                    prop_assert!(after >= before);
                }
            }
        }

        /// Donations (vault increases with constant supply) never lower any redemption.
        #[test]
        fn prop_donation_never_hurts((v, s, a) in state_strategy(), d in any::<u64>(), bps in bps_strategy()) {
            let donated = v.saturating_add(d);
            let before = compute_redeem(v, s, a, bps).map(|q| q.net).unwrap_or(0);
            let after = compute_redeem(donated, s, a, bps).map(|q| q.net).unwrap_or(0);
            prop_assert!(after >= before);
            prop_assert!(floor_not_decreased(v, s, donated, s));
        }
    }

    /// Redeem `parts` sequentially (each clamped to the remaining supply), skipping
    /// zero-net steps as the program would reject them. Returns (received, burned).
    fn run_split(v: u64, s: u64, parts: &[u64], bps: u16) -> (u64, u64) {
        let mut vault = v;
        let mut supply = s;
        let mut received = 0u64;
        let mut total = 0u64;
        for &p in parts {
            if supply == 0 {
                break;
            }
            let a = p.min(supply);
            match apply_redeem(vault, supply, a, bps) {
                Ok((nv, ns, q)) => {
                    assert!(floor_not_decreased(vault, supply, nv, ns));
                    vault = nv;
                    supply = ns;
                    received += q.net;
                    total += a;
                }
                Err(MathError::NothingToRedeem) => {}
                Err(e) => panic!("unexpected error {e:?}"),
            }
        }
        (received, total)
    }
}
