# `stockfloor` program design

Date: 2026-09-15. Program id `98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA`, Anchor 1.0.2.
Source: `programs/stockfloor/src/`. IDL: `target/idl/stockfloor.json` (after a build).

## 1. Status and evidence

| Check | Command | Result (2026-09-15) |
|---|---|---|
| Unit + property tests (math, config validation, account decoding, IDL layout cross-checks, Token-2022 checks) | `cargo test -p stockfloor` | 39 passed, 0 failed |
| SBF build + IDL | `bash scripts/build-programs.sh -p stockfloor` | `target/deploy/stockfloor.so` (≈460 KB), `target/idl/stockfloor.json`, no warnings |
| End-to-end smoke on the LiteSVM mainnet fork (real DBC 0.2.1, DAMM v2 0.2.4, Token-2022, SPYx + badge) | seed file `programs/stockfloor/fork-smoke/stockfloor-smoke.test.ts` (copy to `tests/integration/` and run `pnpm --filter @stockfloor/tests test`) | 43 checks passed: every instruction, every harvest, redeem math to the raw unit, events, return data, 23 rejection paths including paused SPYx |

Compute units measured on the fork: `create_launch` ≈ 41–64k, `harvest_curve_fees` ≈ 66–75k (includes creating the Authority base ATA), `harvest_migration_fee` ≈ 35k, `harvest_lp_fees` ≈ 51–54k, `redeem` ≈ 26k.

The instruction-level integration and adversarial suite on the fork harness is owned by a later agent; the seed above is a starting point.

## 2. Code layout

| File | Content |
|---|---|
| `lib.rs` | `declare_id!`, `declare_program!(dynamic_bonding_curve)`, `declare_program!(cp_amm)`, instruction dispatch |
| `constants.rs` | seeds, limits, external program ids and PDAs (unit-tested against `find_program_address`) |
| `state.rs` | `Launch` account, `FloorInfo` return type |
| `math.rs` | pure redemption math, unit and property tests |
| `external.rs` | read-only decoding of DBC `PoolConfig` / `VirtualPool` and DAMM v2 `Pool` / `Position`; `validate_launch_config` |
| `token_utils.rs` | Token-2022 quote-mint checks (paused, transfer hook), frozen-vault check, burn helper |
| `instructions/*.rs` | one file per instruction (`harvest_dbc_quote.rs` holds `harvest_migration_fee` and `harvest_surplus`) |
| `errors.rs`, `events.rs` | custom errors and events |

**External interfaces.** `declare_program!` compiles cleanly on Anchor 1.0.2 with `idls/dynamic_bonding_curve.json` and `idls/cp_amm.json`. It provides the CPI builders (`dynamic_bonding_curve::cpi::claim_trading_fee`, …) with the IDL discriminators and account order, and `bytemuck` layouts of the external accounts. Accounts are decoded by copying the body out with `bytemuck::try_pod_read_unaligned` after checking **owner program, exact length and discriminator** (so decoding never depends on the alignment of account data in the SBF input buffer). Tests assert that the generated sizes and field offsets match (a) values hand-computed from `vendor/dbc` / `vendor/damm-v2` and (b) offsets computed independently from the IDL JSON.

**Dependencies.** `anchor-lang = "=1.0.2"` (feature `init-if-needed`), `anchor-spl = "=1.0.2"` (`token`, `token_2022`, `associated_token`), `bytemuck` (`derive`, `min_const_generics`); dev: `proptest`, `serde_json`. The anchor sub-crates were pinned to 1.0.2 in the workspace `Cargo.lock` with `cargo update -p <crate> --precise 1.0.2` (a caret requirement otherwise resolves them to 1.2.0).

## 3. Accounts and seeds

| Account | Seeds / derivation | Owner | Notes |
|---|---|---|---|
| `Launch` | `["launch", config]` | stockfloor | registry, created by `create_launch` |
| `Authority` | `["authority", config]` | none (never created) | DBC `fee_claimer` and `leftover_receiver`; owns the vault, the Authority base ATA and the DAMM v2 position NFT; signs CPIs |
| Vault | ATA(Authority, quote_mint, quote token program) | Token-2022 (SPYx) | floor backing; created (`init_if_needed`) by `create_launch` |
| Authority base ATA | ATA(Authority, base_mint, SPL Token) | SPL Token | transit account for base tokens, always emptied (burned) in the same instruction; created `init_if_needed` by the base-receiving cranks |

`Launch` fields (Borsh, `8 + INIT_SPACE`): `version: u8`, `bump: u8`, `authority_bump: u8`, `exit_fee_bps: u16`, `migration_fee_harvested: bool`, `surplus_harvested: bool`, `config`, `creator`, `pool` (default until registered), `base_mint` (default until registered), `quote_mint`, `quote_token_program`, `vault`, `created_at: i64`, informational saturating counters `total_harvested_quote`, `total_burned_base`, `total_redeemed_base`, `total_redeemed_quote`, `total_exit_fees` (u64), `reserved: [u8; 64]`. No admin field exists.

## 4. Instructions

All accounts are listed in IDL order. `w` = writable, `s` = signer. Constant addresses: DBC pool authority `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM`, DBC event authority `8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF`, DAMM v2 pool authority `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC`, DAMM v2 event authority `3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet`.

Every account that names a launch is checked with `seeds = ["launch", launch.config], bump = launch.bump`, and every Authority with `seeds = ["authority", launch.config], bump = launch.authority_bump`.

### 4.1 `create_launch(exit_fee_bps: u16)`

Accounts: `payer` (w, s), `creator` (s), `config` (**s**, the DBC config keypair), `authority`, `launch` (w, init), `quote_mint`, `vault` (w, init_if_needed ATA), `quote_token_program`, `associated_token_program`, `system_program`.

Checks (each has its own error, see §8): `config` owned by DBC, length `8 + 1040`, `PoolConfig` discriminator (rejects `ConfigWithTransferHook`); `exit_fee_bps <= 500`; `config.quote_mint == quote_mint`; `fee_claimer == Authority`; `leftover_receiver == Authority`; `creator_migration_fee_percentage == 0`; `migration_fee_percentage ∈ [30, 99]`; `partner_permanent_locked_liquidity_percentage == 100` and partner unlocked, creator unlocked and creator permanent-locked percentages `== 0`; partner and creator liquidity vesting `is_initialized == 0` and `vesting_percentage == 0`; locked vesting `amount_per_period == cliff_unlock_amount == number_of_period == 0`; `collect_fee_mode == QuoteToken (0)`; `migration_option == DammV2 (1)`; `token_type == SplToken (0)`. The quote token program is recorded from the quote mint's owner.

Why the config must sign: nothing in a DBC config identifies its creator, so without the signature anyone could front-run `create_launch` for a freshly created config and become `launch.creator`. The config keypair already signs `create_config`, so clients have it.

Event: `LaunchCreated`.

### 4.2 `register_pool()`

Accounts: `creator` (s, `== launch.creator`), `launch` (w), `config` (`== launch.config`), `pool`, `base_mint` (SPL Token mint), `token_program`.

Checks: launch has no pool yet; `pool` owned by DBC, length `8 + 416`, `VirtualPool` discriminator (rejects `TransferHookPool`); `pool.config == launch.config`; `pool.creator == launch.creator`; `pool.base_mint == base_mint`; `pool.pool_type == SplToken`; `base_mint.decimals == config.token_decimal`; `mint_authority == None` (DBC revokes it at pool creation; a live mint authority could mint and drain the vault); `freeze_authority == None`.

Anyone can create pools on any DBC config (the fork confirms a stranger can create a second pool on ours). Requiring the launch creator's signature and `pool.creator == launch.creator` means only the creator chooses the canonical pool, once. Fees of other pools on the same config are never harvested: every crank pins `pool == launch.pool`.

Event: `PoolRegistered`.

### 4.3 `harvest_curve_fees()` — permissionless

Accounts: `payer` (w, s), `launch` (w), `authority`, `config`, `pool` (w, `== launch.pool`), `vault` (w, `== launch.vault`), `authority_base_account` (w, init_if_needed ATA), `dbc_base_vault` (w), `dbc_quote_vault` (w), `base_mint` (w, `== launch.base_mint`), `quote_mint` (`== launch.quote_mint`), `token_program` (SPL Token), `quote_token_program` (`== launch.quote_token_program`), `associated_token_program`, `system_program`, `dbc_pool_authority`, `dbc_event_authority`, `dbc_program`.

Flow: quote mint not paused and no active hook; vault not frozen; CPI DBC `claim_trading_fee(u64::MAX, u64::MAX)` with `token_a_account = authority_base_account`, `token_b_account = vault`, `fee_claimer = Authority`; burn the whole Authority base ATA balance; reload the vault and require it did not decrease. DBC validates the DBC vaults, mints and `pool.config` itself. With `collect_fee_mode = QuoteToken` the base part is always 0; the burn path is defensive. Callable at any time (fees from the completing buy accrue after earlier claims, so the crank should call it again after completion).

Event: `CurveFeesHarvested { quote_amount, base_burned, vault_balance }` (amounts measured from balances).

### 4.4 `harvest_migration_fee()` and 4.5 `harvest_surplus()` — permissionless

Shared accounts (`HarvestQuoteFromDbc`): `launch` (w), `authority`, `config`, `pool` (w, `== launch.pool`), `vault` (w, `== launch.vault`), `dbc_quote_vault` (w), `quote_mint`, `quote_token_program`, `dbc_pool_authority`, `dbc_event_authority`, `dbc_program`.

Flow: flag not set yet (`MigrationFeeAlreadyHarvested` / `SurplusAlreadyHarvested`); quote mint and vault checks; decode config and pool and require `quote_reserve >= migration_quote_threshold` (`CurveNotComplete`); CPI DBC `withdraw_migration_fee(flag = 0)` or `partner_withdraw_surplus` into the vault, signed by the Authority; reload vault; set the flag. DBC enforces the one-time bit as well (`migration_fee_withdraw_status & 0b100`, `is_partner_withdraw_surplus`). Neither requires a finished migration.

Events: `MigrationFeeHarvested`, `SurplusHarvested`.

### 4.6 `harvest_leftover()` — permissionless

Accounts: `payer` (w, s), `launch` (w), `authority`, `config`, `pool` (w), `authority_base_account` (w, init_if_needed ATA), `dbc_base_vault` (w), `base_mint` (w), `token_program`, `associated_token_program`, `system_program`, `dbc_pool_authority`, `dbc_event_authority`, `dbc_program`.

Flow: if `config.fixed_token_supply_flag == 1 && pool.migration_progress == CreatedPool && pool.is_withdraw_leftover == 0`, CPI DBC `withdraw_leftover` **without signer seeds** (DBC needs no signature; it pays the `leftover_receiver` ATA). Then burn everything the Authority base ATA holds (leftover, donations, dust). For the default dynamic-supply configs DBC rejects `withdraw_leftover`, so the instruction only burns what the ATA holds.

Event: `LeftoverHarvested { leftover_withdrawn, base_burned }`.

### 4.7 `harvest_lp_fees()` — permissionless

Accounts: `payer` (w, s), `launch` (w), `authority`, `damm_pool`, `position` (w), `position_nft_account` (`owner == Authority`, `amount == 1`), `authority_base_account` (w, init_if_needed ATA), `vault` (w), `damm_token_a_vault` (w), `damm_token_b_vault` (w), `base_mint` (w), `quote_mint`, `token_program`, `quote_token_program`, `associated_token_program`, `system_program`, `damm_pool_authority`, `damm_event_authority`, `damm_program`.

Checks: `damm_pool` is a DAMM v2 `Pool` (owner, length `8 + 1104`, discriminator) with `token_a_mint == launch.base_mint` and `token_b_mint == launch.quote_mint`; `position` is a DAMM v2 `Position` (owner, `8 + 400`, discriminator) with `position.pool == damm_pool`; `position_nft_account.mint == position.nft_mint`. CPI DAMM v2 `claim_position_fee` with `token_a_account = authority_base_account`, `token_b_account = vault`, `signer = Authority`; burn base; reload vault.

Any position held by the Authority on a pool with these mints qualifies (the migrated partner position, or a position someone gives to the Authority). The canonical DAMM v2 pool address is not recorded because DBC does not store it; harvesting another pool with the same mints can only add to the vault.

Event: `LpFeesHarvested`.

### 4.8 `redeem(amount: u64)`

Accounts: `holder` (s), `launch` (w), `authority`, `pool` (`== launch.pool`), `base_mint` (w, `== launch.base_mint`, SPL Token), `holder_base_account` (w, mint = base, owner = holder), `vault` (w, `== launch.vault`), `holder_quote_account` (w, mint = quote, quote token program; any owner), `quote_mint` (`== launch.quote_mint`), `token_program`, `quote_token_program`.

Flow:
1. `amount > 0`; payout account is not the vault (Anchor's duplicate-mutable-account check fires first).
2. DBC pool: `is_migrated == 1 && migration_progress == CreatedPool` (`MigrationNotComplete`); `launch.migration_fee_harvested` (`MigrationFeeNotHarvested`).
3. Holder balance `>= amount`; quote mint not paused, no active hook; vault not frozen.
4. `supply_before = base_mint.supply`, `vault_raw = vault.amount`; `compute_redeem` (§5), error `NothingToRedeem` when `net == 0`.
5. Burn `amount` from the holder (holder signs), then `transfer_checked(net)` from the vault (Authority signs, quote decimals).
6. Post-conditions on reloaded balances: `vault_after == vault_raw - net`, `supply_after == supply_before - amount`, floor non-decreasing (`vault_after * supply_before >= vault_raw * supply_after`).

Event: `Redeemed { base_amount, gross, fee, net, vault_before, supply_before, vault_after, supply_after }`.

### 4.9 `floor()` — view

Accounts: `launch`, `vault` (`== launch.vault`), `base_mint` (`== launch.base_mint`; before `register_pool` pass any account, e.g. the system program). Returns `FloorInfo { vault_raw: u64, supply: u64, exit_fee_bps: u16 }` as Anchor return data (Borsh, 18 bytes) and emits `FloorSnapshot`. `supply` is 0 before registration or after the whole supply was redeemed; the client computes the floor as `vault_raw / supply` only when `supply > 0`. Use `simulateTransaction`.

## 5. Math (`math.rs`)

```
gross = floor(V * A / S)            u128 product, result <= V because A <= S
fee   = ceil(gross * bps / 10_000)
net   = gross - fee                 error if net == 0
```

`V` vault raw, `S` supply raw, `A` amount burned, `f = bps / 10_000`. Every operation is checked; `gross` rounds down and `fee` rounds up, both in the vault's favour. Inputs are validated (`A > 0`, `S > 0`, `A <= S`, `bps <= 10_000`); the program caps `bps` at 500.

**Floor monotonicity.** `(V − net)·S − V·(S − A) = V·A − net·S ≥ V·A − gross·S ≥ 0`, strictly positive when `fee > 0`. So `V/S` never decreases, and strictly increases when a fee is charged (and supply remains).

**Splitting a redemption.** With `bps = 0`, any split of `A` into sequential redemptions receives at most the single redemption of `A`: after the steps `V_k/S_k ≥ V/S`, hence `T = V − V_k ≤ V·(S − S_k)/S = V·A/S`, and `T` is an integer so `T ≤ floor(V·A/S)`.

With `bps > 0`, sequential small redemptions **legitimately receive slightly more in total than one large redemption**: the fee retained at each step raises the floor for the remaining tokens, including the redeemer's own. This is fee redistribution, not a rounding leak. The bounds that do hold (and are property tested):
- each step: `net·S_k·10_000 ≤ V_k·a_k·(10_000 − bps)` (exact 256-bit comparison in the tests);
- total: `T ≤ floor(V·A/S)` (fee-free pro-rata; follows from monotonicity as above);
- total: `T ≤ V·(1 − ((S − A)/S)^(1 − f))`, the continuous limit of infinitely many infinitesimal redemptions. Discrete steps leave `V_{k+1} ≥ V_k·(1 − (1 − f)·a_k/S_k) ≥ V_k·((S_k − a_k)/S_k)^(1 − f)` by Bernoulli's inequality (`(1 − x)^r ≤ 1 − r·x` for `r ∈ [0, 1]`), so the vault after any split is at least the continuous-limit vault. The test uses `f64` with values below 2^53 and a relative tolerance of 1e-9.

Tests (`cargo test -p stockfloor math`): exact formula table, rounding edge cases, zero-net rejection, entire-supply redemption (with and without fee), `u64::MAX` overflow cases, donation monotonicity, deterministic split scenarios, and proptest properties (4096 cases each): exact formula, floor monotonic (strict with fee), per-step rational bound, monotonic in amount, split-never-beats-single at 0 fee (full u64 and dense small ranges), split-with-fee bounded by fee-free pro-rata and the continuous limit, Q64 floor consistency, donations never hurt.

## 6. Invariants and enforcement

| Invariant (BRIEF §5.4) | Enforcement |
|---|---|
| Quote leaves the vault only through `redeem`; no admin, withdraw or sweep | The only Authority-signed transfer out of the vault is in `redeem`; no other instruction takes the vault as a source. Harvests reload the vault and fail with `VaultDecreased` if it shrank. |
| Floor after `redeem` ≥ before (strict with fee) | Math proof + property tests; runtime post-condition on reloaded balances (`FloorDecreased`, `VaultBalanceMismatch`, `SupplyMismatch`). |
| Rounding never favours the redeemer | floor/ceil choices; property tests (§5). |
| `redeem` accepts only the registered base mint and pays only from that launch's vault | `address = launch.base_mint`, `address = launch.vault`, `address = launch.quote_mint`, launch PDA seeds; fork smoke rejects wrong mint, vault and pool. |
| Vault quote mint == config quote mint | `create_launch` checks `config.quote_mint == quote_mint` and derives the vault as the ATA for that mint; later instructions pin `launch.vault` / `launch.quote_mint`. |
| Base tokens the program holds are burned in the same instruction | `burn_all_signed` empties the Authority base ATA in every base-receiving crank. |
| Donations only raise the floor | Math (property `donation_never_hurts`); donated base tokens sent to the Authority base ATA are burned by the next crank (fork smoke). |
| No price oracle | The math uses only `vault.amount` and `mint.supply`. |
| Paused quote mint: clean failure, no corruption | `QuoteMintPaused` pre-check in redeem and every quote-moving harvest; atomic transactions (fork smoke: balances unchanged). |
| Future transfer hook fails cleanly | `QuoteMintTransferHookUnsupported` pre-check when the hook program id is non-null (SPYx today: extension present, program id null → allowed). |
| Migration fee harvested once | Program flag + DBC status bit (fork smoke: `MigrationFeeAlreadyHarvested`). |

## 7. Security analysis

- **Account substitution.** External accounts are decoded only after owner, exact size and discriminator checks. Launch-bound accounts use `address =` constraints against `Launch` fields; `Launch` itself is bound by PDA seeds. Fake configs (wrong owner or type), `TransferHookPool`/`ConfigWithTransferHook`, fake DAMM pools and positions are rejected with specific errors. DBC and DAMM v2 additionally validate their own vaults, mints and pool relationships (`has_one`).
- **PDA signer scope.** The Authority signs exactly four external instructions, and in each the destination accounts are constrained by this program: DBC `claim_trading_fee` (quote → `launch.vault`, base → Authority base ATA), `withdraw_migration_fee` and `partner_withdraw_surplus` (→ `launch.vault`), DAMM v2 `claim_position_fee` (quote → `launch.vault`, base → Authority base ATA); plus SPL `burn` from its own base ATA and Token-2022 `transfer_checked` from the vault in `redeem`. DBC `withdraw_leftover` is invoked without signer seeds. DBC `claim_trading_fee` does not constrain destination owners itself, so these constraints are load-bearing. The CPI program ids are constants.
- **Rogue pools / front-running.** `create_launch` requires the config keypair's signature; `register_pool` requires the launch creator's signature and `pool.creator == launch.creator`; all cranks pin `launch.pool`.
- **Double harvest.** Program flags plus DBC's one-time bits.
- **Reentrancy.** Solana forbids indirect reentrancy (A → B → A). Accounts read after CPIs are reloaded (`vault.reload()`, `base_mint.reload()`); DBC/DAMM accounts are decoded into owned copies before CPIs, so no `RefCell` borrow is held across a CPI.
- **Rent / ATA spoofing.** The vault and the Authority base ATA are canonical ATAs (address derived from owner, mint, token program) and are created with `init_if_needed`, so a third party pre-creating them cannot block anything and cannot substitute a different account. Token-2022 ATAs carry `ImmutableOwner`.
- **Mint authority.** `register_pool` requires the base mint to have no mint and no freeze authority.
- **Token-2022 quote specifics.** Raw amounts only (ScaledUiAmount multiplier changes never affect the math); `transfer_checked` with the mint's decimals; paused mint and active hook pre-checked; frozen vault pre-checked (`VaultFrozen`). The issuer's PermanentDelegate can move tokens out of the vault; `redeem` always uses the live vault balance, so it stays pro-rata, but the floor would drop. This is an issuer risk to disclose, not something the program can prevent.

## 8. Errors

| Code | Name | Message |
|---|---|---|
| 6000 | `InvalidDbcConfig` | Config account is not a DBC PoolConfig (wrong owner, discriminator or size) |
| 6001 | `FeeClaimerNotAuthority` | DBC config fee_claimer must be the launch Authority PDA |
| 6002 | `LeftoverReceiverNotAuthority` | DBC config leftover_receiver must be the launch Authority PDA |
| 6003 | `CreatorMigrationFeeNotZero` | DBC config creator_migration_fee_percentage must be 0 |
| 6004 | `MigrationFeePercentageOutOfRange` | DBC config migration_fee_percentage must be within [30, 99] |
| 6005 | `LiquidityNotFullyPartnerLocked` | DBC config must lock 100% of migrated liquidity permanently for the partner |
| 6006 | `LiquidityVestingNotAllowed` | DBC config must not use liquidity vesting |
| 6007 | `LockedVestingNotAllowed` | DBC config must not have a locked vesting token allocation |
| 6008 | `CollectFeeModeNotQuote` | DBC config collect_fee_mode must be QuoteToken |
| 6009 | `MigrationOptionNotDammV2` | DBC config migration_option must be DAMM v2 |
| 6010 | `BaseTokenTypeNotSplToken` | DBC config base token type must be SPL Token |
| 6011 | `ExitFeeTooHigh` | Exit fee exceeds the 500 bps cap |
| 6012 | `QuoteMintMismatch` | Quote mint does not match the DBC config quote mint |
| 6013 | `InvalidDbcPool` | Pool account is not a DBC VirtualPool (wrong owner, discriminator or size) |
| 6014 | `PoolAlreadyRegistered` | A pool is already registered for this launch |
| 6015 | `PoolNotRegistered` | No pool is registered for this launch yet |
| 6016 | `PoolConfigMismatch` | DBC pool belongs to a different config |
| 6017 | `PoolCreatorMismatch` | DBC pool creator is not the launch creator |
| 6018 | `BaseMintMismatch` | Base mint does not match the DBC pool base mint |
| 6019 | `PoolTypeNotSplToken` | DBC pool base token must be SPL Token |
| 6020 | `BaseMintDecimalsMismatch` | Base mint decimals do not match the DBC config |
| 6021 | `BaseMintAuthorityNotRevoked` | Base mint still has a mint authority |
| 6022 | `BaseMintHasFreezeAuthority` | Base mint has a freeze authority |
| 6023 | `CurveNotComplete` | DBC curve is not complete yet |
| 6024 | `MigrationFeeAlreadyHarvested` | Migration fee was already harvested |
| 6025 | `SurplusAlreadyHarvested` | Surplus was already harvested |
| 6026 | `InvalidDammPool` | Account is not a DAMM v2 Pool |
| 6027 | `InvalidDammPosition` | Account is not a DAMM v2 Position |
| 6028 | `PositionPoolMismatch` | Position belongs to a different DAMM v2 pool |
| 6029 | `DammPoolMintMismatch` | DAMM v2 pool mints must be (launch base mint, launch quote mint) |
| 6030 | `PositionNftNotOwnedByAuthority` | Position NFT account is not owned by the launch Authority or does not hold the position NFT |
| 6031 | `VaultDecreased` | Vault balance decreased during a harvest |
| 6032 | `MigrationNotComplete` | DBC pool migration to DAMM v2 is not complete |
| 6033 | `MigrationFeeNotHarvested` | Migration fee must be harvested before redemptions open |
| 6034 | `ZeroAmount` | Amount must be greater than zero |
| 6035 | `InsufficientBaseBalance` | Insufficient base token balance |
| 6036 | `ZeroSupply` | Base mint supply is zero |
| 6037 | `NothingToRedeem` | Redemption would pay nothing (net amount is zero) |
| 6038 | `InvalidFeeBps` | Invalid exit fee basis points |
| 6039 | `MathOverflow` | Arithmetic overflow |
| 6040 | `VaultBalanceMismatch` | Vault balance after redemption does not match the expected amount |
| 6041 | `SupplyMismatch` | Base mint supply after burn does not match the expected amount |
| 6042 | `FloorDecreased` | Floor per token would decrease |
| 6043 | `DestinationIsVault` | The payout destination cannot be the vault |
| 6044 | `QuoteMintPaused` | Quote mint is paused by its issuer |
| 6045 | `QuoteMintTransferHookUnsupported` | Quote mint has an active transfer hook, which is not supported |
| 6046 | `VaultFrozen` | Vault token account is frozen |
| 6047 | `InvalidQuoteMintData` | Invalid Token-2022 mint data |
| 6048 | `InvalidTokenAccountData` | Invalid token account data |
| 6049 | `FloorAccountMismatch` | Base mint account does not match the launch |

Anchor built-in errors also appear for account-constraint failures (for example `ConstraintAddress` for a wrong vault, `AccountNotSigner` for a missing config signature, `ConstraintDuplicateMutableAccount` when the payout account is the vault).

## 9. Findings from the DBC / DAMM v2 sources vs the brief

1. **DBC 0.2.1 has transfer-hook variants.** `ConfigWithTransferHook` (1120 bytes) and `TransferHookPool` share layouts with `PoolConfig` / `VirtualPool` but have different discriminators. The program accepts only `PoolConfig` and `VirtualPool` (SPL base token).
2. **`withdraw_leftover` also requires a fixed-supply config** (`config.is_fixed_token_supply()`), in addition to `migration_progress == CreatedPool`. With the default dynamic supply it always fails, which is why `harvest_leftover` skips the CPI in that case (and DBC burns the unsold buffer at migration).
3. **Partner surplus share** is `80% × surplus × (100 − creator_trading_fee_percentage)%`: the creator percentage is the *trading* fee percentage (30 by default), not the migration fee percentage. With DBC 0.2.1 buys stopping at the migration price, the surplus is rounding dust.
4. **"100% partner permanent lock" can still create a small creator position.** In `migration_damm_v2`, leftover migration liquidity (rounding) goes to a second position owned by the pool creator, unlocked because the creator's locked percentage is 0. It is dust-level and did not occur on the fork run.
5. **`claim_trading_fee` does not constrain `token_a_account` / `token_b_account` owner or mint.** Destinations must be constrained by the caller (done).
6. **DAMM v2 0.2.4 `claim_position_fee` has delegate paths** (`PositionDelegatePermission`). The Authority is the NFT owner, so the owner path applies; the program never sets delegates.
7. **The migration fee is based on the threshold, not the reserve,** and is claimable once the curve is complete, before migration. `redeem` is therefore gated on both the DBC migration status and the program flag.
8. **Mint and freeze authority.** `initialize_virtual_pool_with_spl_token` creates the mint with no freeze authority and revokes the mint authority in the same instruction; `register_pool` verifies both.
9. Not enforced by the program (config-builder responsibility, harmless to the floor): `token_update_authority` (Immutable in the SDK), `pool_creation_fee` (a non-zero fee would pay SOL to the Authority PDA with no way to move it), `migrated_collect_fee_mode` (OnlyB recommended; with BothToken the base side is burned; Compounding would leave no claimable LP fees), trading fee schedule, activation type.

## 10. Known limitations

- **Quote-mint transfer hooks are not supported.** If the issuer activates a hook, redemptions and harvests fail with `QuoteMintTransferHookUnsupported` until a program upgrade adds hook account forwarding. Nothing is lost; the vault stays intact.
- **Issuer controls.** Pause (clean failure, retry after unpause), freeze of the vault (`VaultFrozen`), permanent delegate transfers out of the vault (floor drops), default-frozen accounts (would freeze a new vault). Disclose.
- **Base tokens in non-ATA accounts owned by the Authority** cannot be burned by the cranks (only the canonical Authority base ATA is emptied). Such tokens stay in the supply, which lowers the floor slightly; nobody can move them.
- **`mint.supply` includes non-redeemable tokens** (base in the DAMM v2 pool, the 0.2% protocol migration base fee in the DBC vault). The floor `vault / supply` is conservative.
- **The canonical DAMM v2 pool is not recorded.** `harvest_lp_fees` accepts any DAMM v2 pool with mints (base, quote) and an Authority-owned position; extra proceeds only raise the floor.
- **Harvesting fees of other pools on the same config is not possible** by design; their partner fees stay in DBC forever.
- **Lamports sent to the Authority** (for example a non-zero DBC pool creation fee claimed by the partner) cannot be moved.
- **Counters in `Launch` are informational** (saturating) and may lag if tokens reach the vault by donation.
- **Upgrade authority** must be revoked before production (user decision, hard stop).

## 11. Notes for other agents

- **Build quirk.** `anchor build -p stockfloor` (Anchor CLI 1.0.2) checks `programs/stockfloor/target/deploy/stockfloor-keypair.json`, not only `target/deploy/`. On first run it generated a random keypair there and failed with "Program ID mismatch". The copy of `keys/stockfloor-program.json` placed at that path (gitignored) fixes it. Suggested fix in `scripts/build-programs.sh`: also copy each keypair to `programs/<p>/target/deploy/<p>-keypair.json`.
- **`Cargo.lock`** at the repository root is untracked; it pins the anchor sub-crates to 1.0.2 and should be committed by its owner.
- **SDK.** Build instructions from `target/idl/stockfloor.json`. `create_launch` needs the config keypair as a signer. `floor` returns 18 bytes of return data: `u64 vault_raw, u64 supply, u16 exit_fee_bps` (little endian).
- **Crank order after completion:** `harvest_curve_fees` (again), `harvest_migration_fee`, `harvest_surplus`, `migration_damm_v2` (DBC, permissionless), `harvest_leftover` (only burns for dynamic supply), `harvest_lp_fees` periodically.
