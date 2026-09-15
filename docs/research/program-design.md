# `stockfloor` program design

Date: 2026-09-15 (M2), updated 2026-09-16 after the post-M5 review (`sync_migration`, §4.6a).
Program id `98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA`, Anchor 1.0.2.
Source: `programs/stockfloor/src/`. IDL: `target/idl/stockfloor.json` (after a build). `Launch`
layout version **2** (claimer / vault-authority split).

## 1. Status and evidence

| Check | Command | Result (2026-09-16, post-M5 review fixes) |
|---|---|---|
| Unit + property tests (math, config validation, account decoding, IDL layout cross-checks, Token-2022 checks, PDA and `Launch` layout) | `cargo test -p stockfloor` | 43 passed |
| SBF build + IDL | `bash scripts/build-programs.sh -p stockfloor` | `target/deploy/stockfloor.so` 458,160 bytes (sha256 `b1a1531c…`), `target/idl/stockfloor.json` |
| Fork tests (LiteSVM + mainnet DBC 0.2.1, DAMM v2 0.2.4, Token-2022, SPYx, badges) | `pnpm --filter @stockfloor/tests test` | 17 files, 112 tests (§1.1) |
| Everything | `pnpm test` | ALL STEPS PASSED |

### 1.1 Fork test files

| File | Tests | Covers |
|---|---|---|
| `tests/integration/c1-lifecycle.test.ts` | 20 | BRIEF §8 flow in order, exact amounts, FloorTracker after 26 steps |
| `tests/integration/c1-adversarial.test.ts` | 17 | account substitution on every harvest (incl. the claimer and vault authority swapped), second pool, issuer controls, redemption edge cases, tracker self-check |
| `tests/integration/review-regressions.test.ts` | 11 | M1 review findings (config shape, permissionless registration, migration latch, encumbered vault, floor view) |
| `tests/integration/sdk-presets-fork.test.ts` | 7 | SDK presets × vault shares on the real programs, SDK negative codes vs DBC |
| `tests/integration/instruction-errors.test.ts` | 7 | account and argument validation of `create_launch` (including an encumbered pre-created vault), `register_pool`, `redeem`, `floor` (replaces the M1 smoke test) |
| `tests/integration/vault-authority.test.ts` | 3 | the claimer never holds or controls the vault (harvest transactions, forged claimer signature, closing an empty vault) |
| `tests/integration/redeem-splits.test.ts` | 3 | 200 tiny, 100 dust and interleaved redemptions at 200 bps vs exact pro-rata and the continuous bound |
| `tests/integration/floor-property.test.ts` | 1 | fast-check, seed 20260915, 40 runs × 10–40 random actions, invariants after every action |
| `tests/integration/lp-positions.test.ts` | 4 | a second position transferred to the claimer, an empty position, a both-token DAMM v2 pool (base fee burn), SDK discovery and crank defaults |
| `tests/integration/compute-budget.test.ts` | 1 | the lifecycle with production CU limits (≤ 200,000 per transaction) |
| `tests/sdk/product-flow.test.ts` | 9 | the whole product flow through SDK APIs only |
| `tests/sdk/crank-races.test.ts` | 3 | crank races with another cranker and a keeper, a failure that stays due, `runCrankAll` |
| `tests/sdk/migration-latch.test.ts` | 3 | `sync_migration` after the SDK crank order; a re-typed DBC pool cannot block redeem; the pre-fix order as control; validation |
| `tests/sdk/launch-lookup.test.ts` | 2 | duplicate pool-less `Launch` accounts for a live base mint never win the base-mint lookup |
| `tests/spike/*.test.ts` | 21 | M1 spike program |

## 2. Code layout

| File | Content |
|---|---|
| `lib.rs` | `declare_id!`, `declare_program!(dynamic_bonding_curve)`, `declare_program!(cp_amm)`, instruction dispatch |
| `constants.rs` | seeds (`LAUNCH_SEED`, `CLAIMER_SEED = "authority"`, `VAULT_AUTHORITY_SEED`), limits, external program ids and PDAs (unit-tested) |
| `state.rs` | `Launch` (with `claimer_key()` / `vault_authority_key()` from the stored bumps), `FloorInfo` |
| `math.rs` | pure redemption math, unit and property tests |
| `external.rs` | read-only decoding of DBC `PoolConfig` / `VirtualPool` and DAMM v2 `Pool` / `Position`; `validate_launch_config` |
| `token_utils.rs` | Token-2022 quote-mint checks (paused, transfer hook), frozen-vault check, vault integrity check, burn helper |
| `instructions/*.rs` | one file per instruction (`harvest_dbc_quote.rs` holds `harvest_migration_fee` and `harvest_surplus`) |
| `errors.rs`, `events.rs` | custom errors and events |

**External interfaces.** `declare_program!` provides the CPI builders and `bytemuck` layouts from
`idls/dynamic_bonding_curve.json` and `idls/cp_amm.json`. Accounts are decoded by copying the body
out with `bytemuck::try_pod_read_unaligned` after checking the **owner program, a minimum length and
the discriminator** (grown accounts are accepted; `ConfigWithTransferHook` / `TransferHookPool` are
rejected by discriminator). Tests assert that generated sizes and field offsets match the vendored
sources and offsets computed independently from the IDL JSON.

**Dependencies.** `anchor-lang = "=1.0.2"` (`init-if-needed`), `anchor-spl = "=1.0.2"` (`token`,
`token_2022`, `associated_token`), `bytemuck`; dev: `proptest`, `serde_json`.

## 3. Accounts, seeds and the two PDAs

| Account | Seeds / derivation | Owner | Role |
|---|---|---|---|
| `Launch` | `["launch", config]` | stockfloor | registry, created by `create_launch` |
| **claimer** | `["authority", config]` | none (never created) | DBC `fee_claimer` and `leftover_receiver`; owner of the DAMM v2 position NFTs and of the claimer base ATA; signs the CPIs into DBC and DAMM v2 and the burns of its base tokens. **No authority over the vault.** |
| **vault authority** | `["vault_authority", config]` | none (never created) | owner of the vault; signs exactly one thing: the payout `transfer_checked` in `redeem` |
| vault | ATA(vault authority, quote mint, quote token program) | Token-2022 (SPYx) | floor backing; created `init_if_needed` by `create_launch`; Token-2022 ATAs carry `ImmutableOwner` |
| claimer base ATA | ATA(claimer, base mint, SPL Token) | SPL Token | transit account for base tokens; always burned empty in the same instruction |

The seed of the claimer stays `"authority"` (it is what DBC configs name as `fee_claimer`); the SDK
function is `authorityPda(config)`, and the IDL account is `claimer`. The SDK derives the vault
authority with `vaultAuthorityPda(config)` and the vault with `vaultAddress(config, quoteMint,
quoteTokenProgram)`.

**Signer map.**

| Signer | Signs | Never signs |
|---|---|---|
| claimer | DBC `claim_trading_fee`, `withdraw_migration_fee(0)`, `partner_withdraw_surplus`; DAMM v2 `claim_position_fee`; SPL `burn` from the claimer base ATA | anything touching the vault as authority (it is not the vault owner) |
| vault authority | Token-2022 `transfer_checked` vault → holder in `redeem` | any CPI into DBC or DAMM v2 (it is not even an account of those transactions) |

**`Launch` layout (version 2, `8 + 343` = 351 bytes, same size as version 1).** Borsh, offsets from
the start of the account (useful for `getProgramAccounts` `memcmp` filters):

| Offset | Field | Type | Notes |
|---|---|---|---|
| 0 | discriminator | `[u8; 8]` | `[144, 51, 51, 163, 206, 85, 213, 38]` |
| 8 | `version` | u8 | 2 |
| 9 | `bump` | u8 | Launch PDA bump |
| 10 | `claimer_bump` | u8 | `["authority", config]` |
| 11 | `vault_authority_bump` | u8 | `["vault_authority", config]` |
| 12 | `exit_fee_bps` | u16 | ≤ 500, immutable |
| 14 | `migration_fee_harvested` | bool | redemptions require it |
| 15 | `surplus_harvested` | bool | |
| 16 | `migrated` | bool | latched once DBC migration is observed |
| 17 | `config` | Pubkey | DBC config |
| 49 | `creator` | Pubkey | informational |
| 81 | `pool` | Pubkey | default until `register_pool` |
| 113 | `base_mint` | Pubkey | committed by `create_launch` |
| 145 | `quote_mint` | Pubkey | |
| 177 | `quote_token_program` | Pubkey | |
| 209 | `vault` | Pubkey | |
| 241 | `created_at` | i64 | |
| 249 | `total_harvested_quote` | u64 | informational, saturating |
| 257 | `total_burned_base` | u64 | |
| 265 | `total_redeemed_base` | u64 | |
| 273 | `total_redeemed_quote` | u64 | |
| 281 | `total_exit_fees` | u64 | |
| 289 | `reserved` | `[u8; 62]` | zero |

No admin field exists.

## 4. Instructions

Account lists are in IDL order (`target/idl/stockfloor.json`). `w` = writable, `s` = signer. Every
`launch` account is checked with `seeds = ["launch", launch.config], bump = launch.bump`; every
`claimer` with `seeds = ["authority", launch.config], bump = launch.claimer_bump`; every
`vault_authority` with `seeds = ["vault_authority", launch.config], bump = launch.vault_authority_bump`.

Constant addresses: DBC pool authority `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM`, DBC event
authority `8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF`, DAMM v2 pool authority
`HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC`, DAMM v2 event authority
`3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet`, SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`,
ATA program `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`, system program `11111111111111111111111111111111`.

### 4.1 `create_launch(exit_fee_bps: u16)`

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `payer` | w, s | rent for `launch` and `vault` |
| 1 | `creator` | s | recorded (informational) |
| 2 | `config` | **s** | the DBC config keypair |
| 3 | `claimer` | | PDA `["authority", config]` |
| 4 | `vault_authority` | | PDA `["vault_authority", config]` |
| 5 | `launch` | w | init, PDA `["launch", config]` |
| 6 | `quote_mint` | | mint of `quote_token_program` |
| 7 | `base_mint` | | committed base mint (may not exist yet) |
| 8 | `vault` | w | `init_if_needed` ATA(vault_authority, quote_mint, quote_token_program) |
| 9 | `quote_token_program` | | Token or Token-2022 |
| 10 | `associated_token_program` | | address |
| 11 | `system_program` | | address |

Checks: `base_mint` not default and not the quote mint (`InvalidBaseMint`); config owned by DBC,
`PoolConfig` discriminator (`InvalidDbcConfig`); `exit_fee_bps ≤ 500`; `config.quote_mint ==
quote_mint`; `fee_claimer == claimer` (`FeeClaimerMismatch`); `leftover_receiver == claimer`
(`LeftoverReceiverMismatch`); `creator_migration_fee_percentage == 0`; `migration_fee_percentage ∈
[30, 99]`; partner permanent lock 100 and every other liquidity bucket 0; no liquidity vesting; no
locked vesting; `collect_fee_mode == QuoteToken`; `migration_option == DammV2`; `token_type ==
SplToken`; dynamic supply (`FixedTokenSupplyNotAllowed`); `creator_trading_fee_percentage ≤ 30`;
base fee is a fee scheduler with cliff ≤ 20%; no dynamic fee; `migrated_collect_fee_mode ==
QuoteToken`; `token_update_authority == Immutable`; `pool_creation_fee == 0`. After the vault init,
the vault must be unencumbered with the vault authority as owner (a third party can pre-create the
canonical ATA, never encumber it). Stores both bumps, `version = 2`.

Why the config must sign: nothing in a DBC config identifies its creator, so without the signature
anyone could front-run `create_launch` for a fresh config.

Event: `LaunchCreated { launch, config, creator, claimer, vault_authority, quote_mint, base_mint,
quote_token_program, vault, exit_fee_bps, migration_fee_percentage, migration_quote_threshold, created_at }`.

### 4.2 `register_pool()` — permissionless

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `launch` | w | no pool yet (`PoolAlreadyRegistered`) |
| 1 | `config` | | `== launch.config` |
| 2 | `pool` | | DBC `VirtualPool` |
| 3 | `base_mint` | | `== launch.base_mint` (`BaseMintMismatch`), SPL Token mint |
| 4 | `token_program` | | SPL Token |

Checks: `pool.config == launch.config` (`PoolConfigMismatch`); `pool.base_mint == base_mint`;
`pool.pool_type == SplToken`; `base_mint.decimals == config.token_decimal`; no mint authority; no
freeze authority. The committed base mint identifies the one DBC pool of the launch, so anyone can
register it and the creator cannot withhold it. Event: `PoolRegistered`.

**Duplicate `Launch` accounts for one base mint.** `create_launch` does not require the base mint to be
unused: anyone can create a pool-less `Launch` with their own DBC config that commits the base mint of a
live launch (it can never get a pool, because the mint's only DBC pool belongs to the live launch's
config). Such an account holds no funds and cannot affect the live launch, but it matches a
`getProgramAccounts` lookup by base mint. Clients must pick the launch that owns the mint's DBC pool; the
SDK's `resolveLaunchByBaseMint` does (`tests/sdk/launch-lookup.test.ts`).

### 4.3 `harvest_curve_fees()` — permissionless

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `payer` | w, s | rent for the claimer base ATA if missing |
| 1 | `launch` | w | pool registered |
| 2 | `claimer` | | PDA |
| 3 | `config` | | `== launch.config` |
| 4 | `pool` | w | `== launch.pool` (`InvalidDbcPool`) |
| 5 | `vault` | w | `== launch.vault` |
| 6 | `claimer_base_account` | w | `init_if_needed` ATA(claimer, base_mint, SPL Token) |
| 7 | `dbc_base_vault` | w | validated by DBC |
| 8 | `dbc_quote_vault` | w | validated by DBC |
| 9 | `base_mint` | w | `== launch.base_mint` |
| 10 | `quote_mint` | | `== launch.quote_mint` |
| 11 | `token_program` | | SPL Token |
| 12 | `quote_token_program` | | `== launch.quote_token_program` |
| 13 | `associated_token_program` | | |
| 14 | `system_program` | | |
| 15 | `dbc_pool_authority` | | constant |
| 16 | `dbc_event_authority` | | constant |
| 17 | `dbc_program` | | constant |

Flow: quote mint not paused, no active hook; vault not frozen; CPI DBC `claim_trading_fee(u64::MAX,
u64::MAX)` signed by the claimer with `token_a_account = claimer_base_account`, `token_b_account =
vault`; burn the claimer base ATA; the vault must be owned by the vault authority and unencumbered
(`VaultEncumbered`) and must not have decreased (`VaultDecreased`). Event: `CurveFeesHarvested`.

### 4.4 `harvest_migration_fee()` and 4.5 `harvest_surplus()` — permissionless

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `launch` | w | pool registered |
| 1 | `claimer` | | PDA |
| 2 | `config` | | `== launch.config` |
| 3 | `pool` | w | `== launch.pool` |
| 4 | `vault` | w | `== launch.vault` |
| 5 | `dbc_quote_vault` | w | validated by DBC |
| 6 | `quote_mint` | | `== launch.quote_mint` |
| 7 | `quote_token_program` | | `== launch.quote_token_program` |
| 8 | `dbc_pool_authority` | | constant |
| 9 | `dbc_event_authority` | | constant |
| 10 | `dbc_program` | | constant |

Flow: flag not set (`MigrationFeeAlreadyHarvested` / `SurplusAlreadyHarvested`); quote mint and vault
checks; `quote_reserve ≥ migration_quote_threshold` (`CurveNotComplete`); CPI DBC
`withdraw_migration_fee(0)` / `partner_withdraw_surplus` into the vault, signed by the claimer; vault
integrity and non-decrease; set the flag; latch `migrated` if the DBC pool is migrated. Events:
`MigrationFeeHarvested`, `SurplusHarvested`.

### 4.6a `sync_migration()` — permissionless (post-M5 review)

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `launch` | w | pool registered (`PoolNotRegistered`) |
| 1 | `pool` | | `== launch.pool` (`InvalidDbcPool`) |

Flow: if `launch.migrated` is already set, return without reading anything (idempotent); otherwise decode
the DBC pool (owner, discriminator, minimum size), require `is_migrated == 1` and `migration_progress ==
CreatedPool` (`MigrationNotComplete`), set `migrated`. Event: `MigrationLatched { launch, pool }` (only when
the flag flips). No token account, no signer, 5,684 CU.

Why it exists: `harvest_migration_fee` and `harvest_surplus` latch `migrated` only when they run after the
migration, and each runs once. The SDK crank (and the C2 plan) harvests both as soon as the curve
completes, before `migration_damm_v2`, so neither latched, and nothing else did until the first successful
redemption. Until then every `redeem` decoded the upgradeable DBC `VirtualPool`: a DBC upgrade in that
window that re-types the pool or changes the migration encoding would block all redemptions (permanently
once our upgrade authority is revoked). The crank now sends `sync_migration` right after the migration
(`tests/sdk/migration-latch.test.ts` reproduces the gap with the pre-fix order and proves the fix).

### 4.6 `burn_claimer_base()` — permissionless (replaces `harvest_leftover`)

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `launch` | w | PDA |
| 1 | `claimer` | | PDA |
| 2 | `claimer_base_account` | w | ATA(claimer, base_mint, SPL Token), must exist |
| 3 | `base_mint` | w | `== launch.base_mint` |
| 4 | `token_program` | | SPL Token |

Burns the whole claimer base ATA balance (0 is a no-op) and adds it to `total_burned_base`. No
external program, no DBC state, no pool registration needed. DBC `withdraw_leftover` only applies to
fixed-supply configs, which `create_launch` rejects, so the M1 CPI branch was unreachable and is gone.
Event: `ClaimerBaseBurned { launch, base_mint, base_burned }`.

### 4.7 `harvest_lp_fees()` — permissionless

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `payer` | w, s | rent for the claimer base ATA if missing |
| 1 | `launch` | w | pool registered |
| 2 | `claimer` | | PDA |
| 3 | `damm_pool` | | DAMM v2 `Pool`, `token_a_mint == launch.base_mint`, `token_b_mint == launch.quote_mint` |
| 4 | `position` | w | DAMM v2 `Position`, `position.pool == damm_pool` |
| 5 | `position_nft_account` | | owner == claimer, amount == 1, mint == `position.nft_mint` (`PositionNftNotOwnedByClaimer`) |
| 6 | `claimer_base_account` | w | `init_if_needed` ATA(claimer, base_mint, SPL Token) |
| 7 | `vault` | w | `== launch.vault` |
| 8 | `damm_token_a_vault` | w | validated by DAMM v2 |
| 9 | `damm_token_b_vault` | w | validated by DAMM v2 |
| 10 | `base_mint` | w | `== launch.base_mint` |
| 11 | `quote_mint` | | `== launch.quote_mint` |
| 12 | `token_program` | | SPL Token |
| 13 | `quote_token_program` | | `== launch.quote_token_program` |
| 14 | `associated_token_program` | | |
| 15 | `system_program` | | |
| 16 | `damm_pool_authority` | | constant |
| 17 | `damm_event_authority` | | constant |
| 18 | `damm_program` | | constant |

Flow: CPI DAMM v2 `claim_position_fee` signed by the claimer (NFT owner path), quote → vault, base →
claimer base ATA; burn it; vault integrity and non-decrease. Any claimer-held position on a pool with
these mints qualifies (the migrated position, a position transferred to the claimer, a position on a
second pool with the same mints); the proceeds can only raise the floor. Event: `LpFeesHarvested`.

### 4.8 `redeem(amount: u64)`

| # | Account | Flags | Constraint |
|---|---|---|---|
| 0 | `holder` | s | |
| 1 | `launch` | w | pool registered |
| 2 | `vault_authority` | | PDA, signs the payout |
| 3 | `pool` | | `== launch.pool` (decoded only while `migrated` is false) |
| 4 | `base_mint` | w | `== launch.base_mint`, SPL Token mint |
| 5 | `holder_base_account` | w | mint = base, owner = holder, SPL Token |
| 6 | `vault` | w | `== launch.vault` |
| 7 | `holder_quote_account` | w | mint = quote, quote token program (any owner) |
| 8 | `quote_mint` | | `== launch.quote_mint` |
| 9 | `token_program` | | SPL Token |
| 10 | `quote_token_program` | | `== launch.quote_token_program` |

Flow:
1. `amount > 0` (`ZeroAmount`); the payout account is not the vault (Anchor's duplicate-mutable check
   fires first).
2. Unless latched: the DBC pool is migrated (`MigrationNotComplete`), then latch `migrated`.
   `migration_fee_harvested` (`MigrationFeeNotHarvested`).
3. Holder balance ≥ amount; quote mint not paused, no active hook; vault not frozen.
4. `compute_redeem(vault, supply, amount, bps)` (§5); `NothingToRedeem` when `net == 0`.
5. Burn `amount` from the holder (holder signs); `transfer_checked(net)` vault → holder signed by the
   vault authority.
6. Post-conditions on reloaded balances: `vault_after == vault − net`, `supply_after == supply −
   amount`, floor not decreased.

Event: `Redeemed { launch, holder, base_amount, gross, fee, net, vault_before, supply_before, vault_after, supply_after }`.

### 4.9 `floor()` — view

| # | Account | Constraint |
|---|---|---|
| 0 | `launch` | PDA |
| 1 | `vault` | `== launch.vault` |
| 2 | `base_mint` | `== launch.base_mint` once registered (`FloorAccountMismatch`); before registration any account |

Returns `FloorInfo { vault_raw: u64, supply: u64, exit_fee_bps: u16, floor_q64: u128 }` as return
data (34 bytes, little endian) and emits `FloorSnapshot`. `supply` is 0 before registration;
`floor_q64 = (vault_raw << 64) / supply`, 0 when the supply is 0. Use `simulateTransaction`.

### 4.10 Compute units

Measured on the fork with explicit limits (`compute-budget.test.ts`, six runs with random keys; the
spread comes from PDA / ATA bump searches). Recommended limits are what the test enforces.

| Transaction | Measured CU | Limit |
|---|---|---|
| `create_launch` | 46,276–71,776 | 120,000 |
| `register_pool` | 7,282 | 20,000 |
| `harvest_curve_fees` (creates the claimer base ATA) | 68,203–72,703 | 100,000 |
| `harvest_curve_fees` | 51,107–52,607 | 80,000 |
| `harvest_migration_fee` | 37,384 | 60,000 |
| `harvest_surplus` | 37,390 | 60,000 |
| `sync_migration` | 5,684 | 20,000 |
| `burn_claimer_base` (empty) | 11,791–13,291 | 40,000 |
| SPL transfer + `burn_claimer_base` | 13,733–15,233 | 45,000 |
| `harvest_lp_fees` | 53,356–54,856 | 100,000 |
| `floor` | 5,385 | 15,000 |
| `redeem` | 25,977–25,978 | 40,000 |

DBC and DAMM v2 transactions of the same lifecycle are in `docs/research/c1-evidence.md`
(`migration_damm_v2` 151,921–160,921 CU, limit 200,000).

## 5. Math (`math.rs`)

```
gross = floor(V * A / S)            u128 product, result <= V because A <= S
fee   = ceil(gross * bps / 10_000)
net   = gross - fee                 error if net == 0
```

`V` vault raw, `S` supply raw, `A` amount burned, `f = bps / 10_000`. Every operation is checked;
`gross` rounds down and `fee` rounds up, both in the vault's favour. Inputs are validated (`A > 0`,
`S > 0`, `A ≤ S`, `bps ≤ 10_000`); the program caps `bps` at 500.

**Floor monotonicity.** `(V − net)·S − V·(S − A) = V·A − net·S ≥ V·A − gross·S ≥ 0`, strictly
positive when `fee > 0`. So `V/S` never decreases, and strictly increases when a fee is charged.

**Splitting a redemption.** With `bps = 0`, any split of `A` receives at most the single redemption
of `A` (`T ≤ floor(V·A/S)` from monotonicity). With `bps > 0`, sequential small redemptions
legitimately receive slightly more than one large redemption: each retained fee raises the floor for
the remaining tokens, including the redeemer's. The bounds that hold:
- each step: `net·S_k·10_000 ≤ V_k·a_k·(10_000 − bps)`;
- total: `T ≤ floor(V·A/S)`;
- total: `T ≤ V·(1 − ((S − A)/S)^(1 − f))` (continuous limit; Bernoulli's inequality per step).

Rust property tests (4,096 cases each) cover the formula, monotonicity, per-step bound, split bounds,
Q64 floor and donations. On the fork (`redeem-splits.test.ts`), 200 tiny redemptions of 454,647,307,743
raw base each paid 5,857,466 raw in total: below the continuous bound 5,857,686.45 and the fee-free
pro-rata 5,971,625, and 5,274 raw more than one redemption of the same total on a replayed fork.

## 6. Invariants and enforcement

| Invariant (BRIEF §5.4) | Enforcement | Fork evidence |
|---|---|---|
| Quote leaves the vault only through `redeem`; no admin, withdraw or sweep | The only transfer out of the vault is `redeem`'s, signed by the vault authority; no other instruction includes the vault authority; harvests fail with `VaultDecreased` if the vault shrank | FloorTracker in every suite; `vault-authority.test.ts`; `floor-property.test.ts` |
| The claimer never holds or controls the vault | Separate PDA owns the vault; post-CPI `VaultEncumbered` check (owner, delegate, close authority, CPI Guard, memo) | `vault-authority.test.ts` (forged claimer signature rejected by Token-2022), tracker checks owner / delegate / close authority after every step |
| Floor after `redeem` ≥ before (strict with fee) | Math proof, property tests, runtime post-condition | all suites; property test |
| Rounding never favours the redeemer | floor/ceil; per-step rational bound | `redeem-splits.test.ts` (tiny, dust, interleaved) |
| `redeem` accepts only the registered base mint and pays only from that launch's vault | `address` constraints, PDA seeds | `instruction-errors.test.ts`, `c1-adversarial.test.ts` |
| Vault quote mint == config quote mint | `create_launch` checks, vault derived for that mint | `instruction-errors.test.ts` (`QuoteMintMismatch`) |
| Base tokens the program holds are burned in the same instruction | `burn_all_signed` in `harvest_curve_fees`, `harvest_lp_fees`, `burn_claimer_base` | lifecycle 8f, `lp-positions.test.ts` (both-token pool: base fee burned exactly) |
| Donations only raise the floor | math; SPYx donations and base donations + burn | edge cases, property test |
| No price oracle | only `vault.amount` and `mint.supply` | |
| Paused quote mint: clean failure | `QuoteMintPaused` pre-check, atomic transactions | issuer-controls test |
| Future transfer hook fails cleanly | `QuoteMintTransferHookUnsupported` pre-check | issuer-controls test |
| Migration fee harvested once | program flag + DBC status bit | lifecycle 8c |
| `redeem` stops depending on DBC state right after the migration | `Launch.migrated` latch: `sync_migration` (crank), harvests after migration, first `redeem` | `migration-latch.test.ts`, review-regressions §3 |

## 7. Security model

- **Two PDAs, least privilege.** DBC and DAMM v2 are upgradeable by Meteora. Whatever they receive
  through a CPI (the claimer's signer privilege and the writable vault as a destination) cannot move
  the floor backing: the vault's owner is the vault authority, which never appears in those
  transactions. Token-2022 rejects a transfer, burn, approve or set-authority on the vault signed by
  the claimer with `OwnerMismatch`, and the vault ATA is `ImmutableOwner` (proven on the fork with a
  forged claimer signature). A compromised external program could still fail harvests or keep its
  own funds (fees, migration fee) away from the vault; it cannot drain what is already there.
- **Defence in depth.** After every CPI with the vault writable, the vault must still be owned by the
  vault authority, with no delegate, no close authority, no CPI Guard and no required memos, and its
  balance must not have decreased.
- **Account substitution.** External accounts are decoded after owner, length and discriminator
  checks; launch-bound accounts use `address =` constraints; both PDAs use stored bumps. Swapping the
  claimer and the vault authority, or using another launch's PDAs, fails with `ConstraintSeeds`
  (or an earlier Anchor/runtime error) on every instruction that takes them (fork tests).
- **Destinations.** DBC `claim_trading_fee`, `withdraw_migration_fee`, `partner_withdraw_surplus` and
  DAMM v2 `claim_position_fee` (owner path) do not constrain the destination owner, so the program
  constrains them: quote → `launch.vault`, base → the claimer's canonical base ATA.
- **Rogue pools / front-running.** `create_launch` requires the config signature and commits the base
  mint; `register_pool` accepts only that mint's pool; every crank pins `launch.pool`.
- **Double harvest.** Program flags plus DBC's one-time bits.
- **Reentrancy.** Solana forbids A → B → A. Accounts read after CPIs are reloaded; DBC/DAMM state is
  decoded into owned copies before CPIs.
- **ATA spoofing.** The vault and the claimer base ATA are canonical ATAs (`init_if_needed` or an
  address constraint); a pre-created ATA cannot be substituted or encumbered.
- **Mint authority.** `register_pool` requires the base mint to have no mint and no freeze authority.
- **Token-2022 quote.** Raw amounts only (ScaledUiAmount changes never affect the math);
  `transfer_checked`; paused mint, active hook and frozen vault pre-checked.
- **DBC upgrades after migration.** `Launch.migrated` latches (the crank sends `sync_migration` right after
  the migration); `redeem` then never decodes DBC state.
- **Issuer powers (not preventable).** SPYx's permanent delegate can move vault tokens, the issuer can
  pause or freeze. Disclose.
- **Our upgrade authority** must be revoked before production (user decision, hard stop).

## 8. Errors

| Code | Name | Message |
|---|---|---|
| 6000 | `InvalidDbcConfig` | Config account is not a DBC PoolConfig (wrong owner, discriminator or size) |
| 6001 | `FeeClaimerMismatch` | DBC config fee_claimer must be the launch claimer PDA (seeds: authority, config) |
| 6002 | `LeftoverReceiverMismatch` | DBC config leftover_receiver must be the launch claimer PDA (seeds: authority, config) |
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
| 6013 | `FixedTokenSupplyNotAllowed` | DBC config must use dynamic token supply (fixed supply is not supported) |
| 6014 | `CreatorTradingFeeTooHigh` | DBC config creator_trading_fee_percentage exceeds 30 |
| 6015 | `CurveFeeTooHigh` | DBC config base fee must be a fee scheduler with a cliff fee of at most 20% |
| 6016 | `DynamicFeeNotAllowed` | DBC config must not enable the dynamic (volatility) fee |
| 6017 | `MigratedCollectFeeModeNotQuote` | DBC config migrated_collect_fee_mode must be QuoteToken |
| 6018 | `TokenUpdateAuthorityNotImmutable` | DBC config token_update_authority must be Immutable |
| 6019 | `PoolCreationFeeNotZero` | DBC config pool_creation_fee must be 0 |
| 6020 | `InvalidBaseMint` | Base mint must not be the default pubkey or the quote mint |
| 6021 | `InvalidDbcPool` | Pool account is not a DBC VirtualPool (wrong owner, discriminator or size) |
| 6022 | `PoolAlreadyRegistered` | A pool is already registered for this launch |
| 6023 | `PoolNotRegistered` | No pool is registered for this launch yet |
| 6024 | `PoolConfigMismatch` | DBC pool belongs to a different config |
| 6025 | `BaseMintMismatch` | Base mint does not match the DBC pool base mint |
| 6026 | `PoolTypeNotSplToken` | DBC pool base token must be SPL Token |
| 6027 | `BaseMintDecimalsMismatch` | Base mint decimals do not match the DBC config |
| 6028 | `BaseMintAuthorityNotRevoked` | Base mint still has a mint authority |
| 6029 | `BaseMintHasFreezeAuthority` | Base mint has a freeze authority |
| 6030 | `CurveNotComplete` | DBC curve is not complete yet |
| 6031 | `MigrationFeeAlreadyHarvested` | Migration fee was already harvested |
| 6032 | `SurplusAlreadyHarvested` | Surplus was already harvested |
| 6033 | `InvalidDammPool` | Account is not a DAMM v2 Pool |
| 6034 | `InvalidDammPosition` | Account is not a DAMM v2 Position |
| 6035 | `PositionPoolMismatch` | Position belongs to a different DAMM v2 pool |
| 6036 | `DammPoolMintMismatch` | DAMM v2 pool mints must be (launch base mint, launch quote mint) |
| 6037 | `PositionNftNotOwnedByClaimer` | Position NFT account is not owned by the launch claimer PDA or does not hold the position NFT |
| 6038 | `VaultDecreased` | Vault balance decreased during a harvest |
| 6039 | `VaultEncumbered` | Vault token account has a delegate, close authority, an owner other than the vault authority, CPI guard or required memo |
| 6040 | `MigrationNotComplete` | DBC pool migration to DAMM v2 is not complete |
| 6041 | `MigrationFeeNotHarvested` | Migration fee must be harvested before redemptions open |
| 6042 | `ZeroAmount` | Amount must be greater than zero |
| 6043 | `InsufficientBaseBalance` | Insufficient base token balance |
| 6044 | `ZeroSupply` | Base mint supply is zero |
| 6045 | `NothingToRedeem` | Redemption would pay nothing (net amount is zero) |
| 6046 | `InvalidFeeBps` | Invalid exit fee basis points |
| 6047 | `MathOverflow` | Arithmetic overflow |
| 6048 | `VaultBalanceMismatch` | Vault balance after redemption does not match the expected amount |
| 6049 | `SupplyMismatch` | Base mint supply after burn does not match the expected amount |
| 6050 | `FloorDecreased` | Floor per token would decrease |
| 6051 | `DestinationIsVault` | The payout destination cannot be the vault |
| 6052 | `QuoteMintPaused` | Quote mint is paused by its issuer |
| 6053 | `QuoteMintTransferHookUnsupported` | Quote mint has an active transfer hook, which is not supported |
| 6054 | `VaultFrozen` | Vault token account is frozen |
| 6055 | `InvalidQuoteMintData` | Invalid Token-2022 mint data |
| 6056 | `InvalidTokenAccountData` | Invalid token account data |
| 6057 | `FloorAccountMismatch` | Base mint account does not match the launch |

M2 renamed 6001, 6002 and 6037 (codes unchanged). Anchor built-in errors also appear for constraint
failures, for example `ConstraintSeeds` (a substituted PDA), `ConstraintAddress` (a wrong vault),
`AccountNotSigner` (no config signature), `ConstraintDuplicateMutableAccount` (payout into the vault),
`ConstraintTokenOwner` / `ConstraintAssociated` (a wrong claimer base account), and the runtime
`MissingAccount` when an `init_if_needed` ATA for a substituted owner is not in the transaction.

## 9. Findings from the DBC / DAMM v2 sources

1. **Transfer-hook variants.** `ConfigWithTransferHook` and `TransferHookPool` share layouts with
   `PoolConfig` / `VirtualPool` but have other discriminators; only the SPL variants are accepted.
2. **`withdraw_leftover` requires a fixed-supply config**; with dynamic supply DBC burns the unsold
   buffer at migration. Hence no leftover CPI (`burn_claimer_base`).
3. **Partner surplus share** is `80% × surplus × (100 − creator_trading_fee_percentage)%`. With
   DBC 0.2.1 buys stopping at the migration price, the surplus is rounding dust.
4. **"100% partner permanent lock" can still create a small creator position** from rounding in
   `migration_damm_v2`; not observed on the fork.
5. **Destination accounts are unconstrained** in DBC `claim_trading_fee`, `withdraw_migration_fee`,
   `partner_withdraw_surplus` (plain `InterfaceAccount<TokenAccount>`, no owner or mint constraint)
   and in DAMM v2 `claim_position_fee` on the NFT-owner path (`assert_authority_with_owner_destinations`
   returns before checking destinations when the signer owns the NFT account). This is what lets the
   claimer sign while the vault authority owns the destination; the fork confirms it on the deployed
   binaries.
6. **DAMM v2 0.2.4 has position delegates** (`PositionDelegatePermission`); the claimer is the NFT owner,
   so the owner path applies; the program never sets delegates.
7. **The migration fee is based on the threshold** and is claimable once the curve is complete, before
   migration; `redeem` is gated on both the DBC migration status (latched) and the program flag.
8. **Mint and freeze authority** are revoked / absent after DBC pool creation; `register_pool` checks.
9. **DAMM v2 position NFTs are transferable** Token-2022 NFTs (metadata pointer and close authority
   extensions, no non-transferable extension); `create_position` accepts any `owner`, so anyone can
   give the claimer a position.

## 10. Known limitations

- **Quote-mint transfer hooks are not supported.** If the issuer activates one, redemptions and
  harvests fail with `QuoteMintTransferHookUnsupported`. `redeem` forwards no extra accounts to
  `transfer_checked`, so no transaction shape can succeed; only a program upgrade that resolves the hook's
  extra account metas can reopen redemptions. **Once the upgrade authority is revoked, an issuer-enabled
  hook locks every vault permanently** (the SPYx TransferHook authority `5aMNNL…` can set a hook program at
  any time). Options before revocation: (a) hook support in `redeem` (extra account metas from remaining
  accounts, `invoke_transfer_checked`; first verify whether Token-2022 passes the vault authority's signer
  privilege on to extra metas marked as signers, and reject such metas if it does), or (b) keep the upgrade
  authority behind a multisig or timelock. The choice is part of the user's revocation decision.
- **Issuer controls.** Pause, freeze of the vault, permanent-delegate transfers out of the vault (the
  floor drops), default-frozen accounts. Disclose.
- **Stuck assets outside the vault.** Quote tokens sent to any account other than the vault (for
  example ATA(claimer, SPYx)), base tokens in non-ATA accounts owned by the claimer, lamports sent to
  either PDA, and liquidity in positions given to the claimer cannot be moved by anyone. Liquidity
  stays in DAMM v2 (it deepens the market), its fees are harvestable.
- **`burn_claimer_base` needs the claimer base ATA to exist** (it does after the first
  `harvest_curve_fees`; a donor creates it when transferring).
- **`mint.supply` includes non-redeemable tokens** (base in DAMM v2 pools, the protocol migration base
  fee in the DBC vault), so `vault / supply` is conservative.
- **The canonical DAMM v2 pool is not recorded.** `harvest_lp_fees` accepts any DAMM v2 pool with mints
  (base, quote) and a claimer-held position; extra proceeds only raise the floor.
- **Fees of other DBC pools on the same config** are never harvested (by design).
- **Counters in `Launch` are informational** (saturating, not updated by donations).
- **Upgrade authority** must be revoked before production (user decision). Revocation also turns two
  temporary failures into permanent ones: an issuer-enabled transfer hook (above) and any future DBC or
  DAMM v2 change that breaks a harvest CPI (unharvested fees stay in DBC / DAMM v2).

## 11. Notes for other agents

- **Build.** `bash scripts/build-programs.sh -p stockfloor`; the IDL is `target/idl/stockfloor.json`
  (Anchor 1.0 format with PDA seeds for `launch`, `claimer`, `vault_authority`, the vault and the
  claimer base ATA).
- **SDK.** `authorityPda(config)` is the claimer (pass it as `feeClaimer` and `leftoverReceiver` of the
  DBC config); `vaultAuthorityPda(config)`; `vaultAddress(config, quoteMint, quoteTokenProgram)` is the
  vault authority's ATA. `create_launch` needs the config keypair as a signer.
- **`floor`** returns 34 bytes: `u64 vault_raw, u64 supply, u16 exit_fee_bps, u128 floor_q64` (LE).
- **Crank order after completion:** `harvest_curve_fees` (again), `harvest_migration_fee`,
  `harvest_surplus`, DBC `migration_damm_v2` (permissionless), `sync_migration` (unless a harvest after the
  migration already latched it), then `harvest_lp_fees` periodically and `burn_claimer_base` whenever the
  claimer base ATA balance is non-zero.
- **Compute unit limits:** see §4.10; simulate first when possible.
