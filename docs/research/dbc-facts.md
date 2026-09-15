# DBC / DAMM v2 fact check (2026-09-15)

Sources: `vendor/dbc` (DBC 0.2.1, `f552f20`), `vendor/damm-v2` (0.2.4, `a85c926`), `vendor/dbc-sdk` (1.5.12), `idls/*.json`, and read-only mainnet RPC (public endpoint, slot ~447,309,000).

Path prefixes used below:
- `dbc:` = `vendor/dbc/programs/dynamic-bonding-curve/src/`
- `damm:` = `vendor/damm-v2/programs/cp-amm/src/`
- `sdk:` = `vendor/dbc-sdk/packages/dynamic-bonding-curve/src/`

**Deployed binaries match the sources.** The live program-data bytes (after the 45-byte header) equal `tests/fixtures/programs/*.so`:
- DBC sha256 `4c26a8a5…`, last deployed at slot 445,503,633. It contains the 0.2.1-only errors "Quote mint has a non zero transfer fee" and "Deprecated migration option".
- DAMM v2 sha256 `4d5b920b…`, last deployed at slot 445,230,614. It contains the 0.2.4-only error `InvalidConfigPermission`.
- **Both programs are still upgradeable** (upgrade authority is set).

---

## A. Verification of BRIEF §4 and §6

Status: ✅ confirmed · ⚠️ partially true (see note) · ❌ refuted · ❔ unverifiable

### §4 parameters

| Claim | Status | Evidence / correction |
|---|---|---|
| DBC revokes mint authority on standard configs; Immutable = 1 | ✅ | `dbc:instructions/initialize_pool/ix_initialize_virtual_pool_with_spl_token.rs:230-242` sets MintTokens to `None`. Options 3 and 4 (mint authority) are rejected for non-hook configs (`:186-191`, `process_create_config.rs:443-446`). The freeze authority is also `None`: mainnet mints `HE9Thc…` and `7n6WSv…` have mint = freeze = null. With Immutable, metadata `is_mutable=false` and the update authority is set to the system program (`process_create_token_metadata.rs:29,51-65`). |
| Fixed supply: `leftover_receiver` = PDA, leftovers burned | ⚠️ | At migration DBC burns `min(leftover, pre_supply − post_supply)` (`state/config.rs:931-945`, `migrate_damm_v2_initialize_pool.rs:736-765`). Only the rest goes to `leftover_receiver` through `withdraw_leftover`. See Q3. |
| Curve: only strictly increasing sqrt prices, liquidity > 0, ≤ 16 points | ⚠️ | There are more checks: start price in `[MIN_SQRT_PRICE, MAX_SQRT_PRICE)`, `curve[0].sqrt_price > start`, last point ≤ MAX, the threshold must be reachable on the curve (`NotEnoughLiquidity`), `migration_sqrt_price < MAX`, and swap/migration base amounts must be > 0 and fit in u64. Full list in Q9. |
| Keepers auto-migrate at ≥ $750 equivalent | ❔ | This is an off-chain policy with no source. `migration_damm_v2` is permissionless (`dbc:lib.rs:312`, no `access_control`). |
| Curve fee minimum 25 bps; exponential scheduler allowed | ✅ | `dbc:constants.rs:81-82` (min 2.5M / 1e9) and `:75-76` (max 99%). The minimum applies to the fee after the last period (`base_fee/fee_scheduler.rs:87-94,117-124`). If any of `number_of_period`, `period_frequency`, `reduction_factor` is set, all three must be non-zero (`:79-86`). |
| Collect fee mode QuoteToken (0): fees accrue in quote | ✅ | `dbc:state/fee.rs:129-137`: `fees_on_base_token` is false in both directions, so `partner_base_fee` stays 0. |
| Creator gets 30% of non-protocol fees; protocol takes 20% of total | ✅ | Protocol = `floor(fee×20/100)`, trading = fee − protocol (`state/config.rs:139-172`). Creator = `floor(trading×30/100)`, partner = the rest (`:1014-1033`, applied at `state/virtual_pool.rs:960-977`). A referral takes 20% of the **protocol** part only. The partner therefore gets 56% of the gross fee. |
| `migration_fee_percentage` max 99 | ✅ | `dbc:constants.rs:58`, enforced at `process_create_config.rs:80-98`. |
| DAMM v1 deprecated for new configs | ✅ | Rejected at `process_create_config.rs:418-421` and again at pool init (`ix_initialize_virtual_pool_with_spl_token.rs:164-170`). |
| Migrated pool fee 1% with Customizable (0.1–10%); quote-only fees possible | ✅ | `dbc:constants.rs:38-39`, `process_create_config.rs:146-151`. `migrated_collect_fee_mode` 0 maps to DAMM v2 `OnlyB` (1) (`migration_handler/mod.rs:37-48`), and B is the quote mint (`migrate_damm_v2_initialize_pool.rs:183-184`). **Alternative:** FixedBps100 (option 2) with DAMM config `Hv8Lmz…` is a static 1% config whose `collect_fee_mode` is 1 (OnlyB) on-chain. It also has **dynamic fee enabled**, so fees are 1% plus a volatility component. |
| 100% partner permanent lock; DBC requires ≥ 10% locked at day 1 | ✅ | `dbc:constants.rs:60`. Checked at create_config (`process_create_config.rs:707-711`) and again at pool init (`ix_initialize_virtual_pool_with_spl_token.rs:153-157`). |

### §6 DBC behaviour

| Claim | Status | Evidence / correction |
|---|---|---|
| `MAX_MIGRATION_FEE_PERCENTAGE = 99`, checked at config creation | ✅ | `dbc:constants.rs:58`, `process_create_config.rs:82-85` |
| 636 configs at 99%, 1,193 at 50% | ⚠️ | Now **650** and **1,194**. Method: `getProgramAccounts`, dataSize 1048, `memcmp@247`. Total `PoolConfig` accounts: 503,159. |
| Fee from the threshold: `fee = thr − ceil(thr×(100−pct)/100)` | ✅ | `dbc:state/config.rs:846-858`. This equals `floor(thr×pct/100)`. |
| Creator = `floor(fee×creator_pct/100)`, partner gets the rest | ✅ | `dbc:state/config.rs:860-874` |
| `withdraw_migration_fee` account list | ✅ | `dbc:instructions/migration/ix_withdraw_migration_fee.rs:16-45`, plus `event_authority` and `program` (IDL). `token_quote_account` has no owner or mint constraint; the mint is enforced by `transfer_checked`. |
| flag 0 = partner, needs `sender == config.fee_claimer`; flag 1 = creator, needs `sender == pool.creator`; each only once | ✅ | `:99-128`. Bits: partner `0b100`, creator `0b010` (`state/virtual_pool.rs:206-207`). Eligible while `status & mask == 0`; the bit is set with XOR (`:1184-1189`). |
| Needs `quote_reserve ≥ threshold`, not a finished migration | ✅ | `:89-93` checks only `is_curve_complete` (`state/virtual_pool.rs:1122-1124`). Migration never lowers `quote_reserve`. |
| `claim_trading_fee` accounts; callable anytime; hook-base pools use `claim_trading_fee2` | ✅ | `dbc:instructions/partner/ix_claim_partner_trading_fee.rs:15-58`. No progress check. `claim_trading_fee` on a TransferHookPool fails with `PoolTypeMismatch` (`:76-79`). The signer rule is `lib.rs:104` → `access_control.rs:25-33`. |
| `partner_withdraw_surplus`: fee_claimer signs, once, after curve complete | ✅ | `dbc:instructions/partner/ix_withdraw_partner_surplus.rs:65-77` |
| Partner gets 80% of surplus × (1 − creator%) | ⚠️ | "creator%" is **`creator_trading_fee_percentage`**, not the migration creator share. Formula: `pc = floor(surplus×80/100)`, `partner = pc − floor(pc×creator_trading_pct/100)` (`state/virtual_pool.rs:1130-1151`). With 30%, the partner gets ≈ 56% of the surplus and the protocol gets 20%. |
| No `is_on_curve` anywhere; PDA signers work | ✅ | `grep is_on_curve` finds nothing in DBC or DAMM v2. Access control is `Signer` plus a key comparison. |
| Star `dbc_settlement` (`2BxLeMq…`) CPIs `CreatorWithdrawSurplus` | ⚠️ | The program exists and is executable. The CPI itself was not re-traced. |
| PDA as partner `fee_claimer` not yet seen on mainnet | ❌ | Tx `3cFBTt64L5YfnpRRs74huWd7bcBdkU9zDUqBoKTZ2WEeEjaoieaoirc17wLiSr7hB1V3GcuG2QDZoFU1xSG9QKZ`: DBC `claim_trading_fee`, CPI from program `BLANKpBQ5HG9UFjesxEgf4Yd2Tkj8K9e9tGZ5RYkYwGt`, signed by PDA fee_claimer `5xFNwPgbUmtn1JfCLvWBfntjSPHFApMKge6MAfH3S1gF` (not a top-level signer). Also, 175,528 of 503,159 configs use an off-curve `fee_claimer`. I found no `withdraw_migration_fee` by a PDA; it uses the same Signer-plus-key code path. |
| `withdraw_leftover`: permissionless, pays leftover_receiver's ATA, only after the DAMM pool exists; receiver ≠ default | ⚠️ | It also **requires `fixed_token_supply_flag == 1`** (`dbc:instructions/migration/withdraw_leftover.rs:82-85`) and `migration_progress == CreatedPool` (`:77-80`). The ATA must already exist; the constraint only compares the address (`:27-31`, anchor-syn 1.0.2 `constraints.rs:1254-1309`). The `receiver ≠ default` check only runs for fixed supply (`process_create_config.rs:645-648`). |
| `migration_damm_v2` has no access control (payer and NFT-mint signers only) | ✅ | `dbc:lib.rs:312`. Accounts at `migrate_damm_v2_initialize_pool.rs:33-130`. |
| Partner position NFT goes to `config.fee_claimer` | ⚠️ | The first position goes to whichever side has **strictly more** total liquidity. A tie goes to the creator (`:614-630`). With 100% partner the first position is ours. Verified on mainnet: SPYx pools `ZihoKj…` and `yPWhHz…` each have one fully permanent-locked position whose NFT account owner is the config's `fee_claimer`. |
| DAMM v2 `claim_position_fee` accepts signer == NFT account owner | ✅ | `damm:state/position.rs:566-576` |
| Keepers `Asi5DT…`, `DeQ8dP…`, $750 rule, migrator UI | ❔ | Off-chain. The migrator URL is in the SDK README. |

### §6 DBC config constraints

| Claim | Status | Evidence / correction |
|---|---|---|
| Decimals 6–9 | ✅ | `process_create_config.rs:449-452` |
| ≥ 10% locked at day 1 | ✅ | See above |
| Vesting ≤ 2 years | ⚠️ | The cap applies to **LP liquidity vesting** only (`constants.rs:64`, `process_create_config.rs:330-353`). Token `locked_vesting` has no duration cap; it only needs frequency ≠ 0 and total ≠ 0 (`:300-309`). |
| Fee 0.25% min, 99% cap; protocol 20%; protocol migration liquidity fee 0.2% | ✅ | `constants.rs:75-107`. The 0.2% is stored per pool at init (`ix_initialize_virtual_pool_with_spl_token.rs:270`) and applied to the migrated quote (`migration_handler/concentrated_liquidity.rs:36-61`). |
| Pool creation fee 0 or 0.001–100 SOL | ✅ | `constants.rs:102-104`, `process_create_config.rs:475-481` |
| Rate limiter and DAMM v1 rejected for new configs | ✅ | `params/fee_parameters.rs:31-34`, `process_create_config.rs:418-421` |
| Token-2022 quote with non-metadata extensions needs a DBC badge | ✅ | `dbc:utils/token.rs:216-258` (only MetadataPointer and TokenMetadata are free; Token-2022 native mint is rejected). |
| Badge PDA `["token_badge", mint]`, remaining account 0 on create_config and pool init | ✅ | `constants.rs:118`, `process_create_config.rs:378`, `ix_initialize_virtual_pool_with_spl_token.rs:149`. The address is **not** re-derived: DBC only checks owner, discriminator and `token_mint` (`utils/token.rs:260-267`). |
| Badge requires zero transfer fee | ⚠️ | A zero transfer fee is required **regardless** of the badge. It is checked first (`utils/token.rs:232-235`) and again on every quote transfer path (swap, claims, migration). |
| 737 xStocks have badges | ❔ | Not recounted. All 8 allowlist mints have **both** DBC and DAMM v2 badges on mainnet (checked). |

### §6 SPYx mint (mainnet)

| Item | Result |
|---|---|
| Program and decimals | ✅ Token-2022, 8 decimals |
| Freeze and pause authority | ✅ `JDq14…` |
| DefaultAccountState | ✅ initialized |
| Pausable | ✅ paused = false |
| PermanentDelegate | ✅ `5aMNN…` |
| TransferHook | ✅ program null, authority `5aMNN…` |
| ConfidentialTransferMint | ✅ auto-approve false |
| TransferFee | ✅ none |
| MetadataPointer / TokenMetadata | Present (update authority `5aMNN…`) |
| Mint authority | `7pt9tk…` (not mentioned in the brief) |
| ScaledUiAmount | ⚠️ The stored `multiplier` is **1.003909**. `newMultiplier` 1.005715 takes effect at ts 1781755200 (2026-06-18 04:00 UTC), which has passed. **UI code must use `newMultiplier` once now ≥ effective timestamp.** Authority `S7vYFF…`. |
| PDA-owned SPYx accounts | ⚠️ Now 98 owned by the DBC pool authority `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM` and 28 by the DAMM v2 pool authority `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC` (brief said 94 and 27). |

---

## B. Design questions

### Q1. Layouts (zero-copy, `bytemuck`, `repr(C)`)

Account basics (IDL `serialization: bytemuck`, `repr: c`):
- **`PoolConfig`**: discriminator `1a6c0e7b74e6812b`, data length **1048** (8 + 1040; `state/config.rs:498-588`).
- **`VirtualPool`**: discriminator `d5e005d16245775c`, data length **424** (8 + 416; `state/virtual_pool.rs:92-167`).
- Variants accepted by DBC's loaders:
  - `ConfigWithTransferHook`: discriminator `28dcc2fb29c77bfd`, length 1128.
  - `TransferHookPool`: discriminator `eddbb8172abda923`, length 424.
  - Loaders: `utils/config_account_loader.rs:16-48`, `pool_account_loader.rs:16-41`.
- **Our program should accept only `PoolConfig` / `VirtualPool` discriminators**, with owner = DBC and exact length.

How the offsets were checked:
- Computed from the IDL with `repr(C)` alignment.
- Cross-checked against 82 live SPYx configs and several pools: quote mint = SPYx, liquidity percentages sum to 100, supply 1e15.
- Config fields never change after creation: no DBC instruction loads a config mutably.

**PoolConfig** (absolute offsets, including the discriminator):

| off | field | off | field |
|---|---|---|---|
| 8 | quote_mint (Pubkey) | 239 | partner_permanent_locked_liquidity_percentage |
| 40 | fee_claimer | 240 | partner_liquidity_percentage |
| 72 | leftover_receiver | 241 | creator_permanent_locked_liquidity_percentage |
| 104 | pool_fees.base_fee.cliff_fee_numerator u64 | 242 | creator_liquidity_percentage |
| 112/120 | second_factor (period_frequency) / third_factor (reduction) u64 | 243 | migration_fee_option |
| 128 | first_factor (number_of_period) u16 | 244 | fixed_token_supply_flag (0 dyn, 1 fixed) |
| 130 | base_fee_mode u8 | 245 | creator_trading_fee_percentage |
| 136 | dynamic_fee.initialized u8 | 246 | token_update_authority |
| 184 | partner_liquidity_vesting_info.is_initialized | 247 | migration_fee_percentage |
| 185 | partner vesting_percentage | 248 | creator_migration_fee_percentage |
| 188/190/192/196 | partner bps_per_period u16 / number_of_periods u16 / frequency u32 / cliff u32 | 256 | swap_base_amount u64 |
| 200 | creator_liquidity_vesting_info.is_initialized | 264 | migration_quote_threshold u64 |
| 201 | creator vesting_percentage | 272 | migration_base_threshold u64 |
| 232 | collect_fee_mode | 280 | migration_sqrt_price u128 |
| 233 | migration_option (1 = DammV2) | 296..343 | locked_vesting_config: amount_per_period@296, cliff_duration@304, frequency@312, number_of_period@320, cliff_unlock_amount@328 |
| 234 | activation_type (0 slot, 1 ts) | 344 / 352 | pre_ / post_migration_token_supply u64 |
| 235 | token_decimal | 360 | migrated_collect_fee_mode |
| 236 | version | 361 | migrated_dynamic_fee |
| 237 | token_type (0 SPL, 1 T22) | 362 | migrated_pool_fee_bps u16 |
| 238 | quote_token_flag (0 SPL, 1 T22) | 364 / 365 | migrated_pool_base_fee_mode / enable_first_swap_with_min_fee |
| | | 366 | migrated_compounding_fee_bps u16 |
| | | 368 | pool_creation_fee u64 |
| | | 376 | migrated_pool_base_fee_bytes [16] |
| | | 392 | sqrt_start_price u128 |
| | | 408 | curve[20] × {sqrt_price u128, liquidity u128} |

**VirtualPool**:

| off | field | off | field |
|---|---|---|---|
| 8 | volatility_tracker (64) | 305 | is_migrated |
| 72 | config | 306 | is_partner_withdraw_surplus |
| 104 | creator | 307 | is_protocol_withdraw_surplus |
| 136 | base_mint | 308 | migration_progress (0 Pre, 1 PostBonding, 2 LockedVesting, 3 CreatedPool) |
| 168 | base_vault | 309 | is_withdraw_leftover |
| 200 | quote_vault | 310 | is_creator_withdraw_surplus |
| 232 / 240 | base_reserve / **quote_reserve** u64 | 311 | migration_fee_withdraw_status |
| 248 / 256 | protocol_base_fee / protocol_quote_fee | 312..343 | metrics |
| 264 / 272 | partner_base_fee / partner_quote_fee | 344 | finish_curve_timestamp |
| 280 | sqrt_price u128 | 352 / 360 | creator_base_fee / creator_quote_fee |
| 296 | activation_point | 370 | has_swap |
| 304 | pool_type | 376 | protocol_liquidity_migration_fee_bps u16 |
| | | 384 / 392 | protocol_migration_base_fee_amount / protocol_migration_quote_fee_amount |

PDAs under DBC:
- pool: `["pool", config, max(base,quote), min(base,quote)]`
- vaults: `["token_vault", mint, pool]`
- `ix_initialize_virtual_pool_with_spl_token.rs:78-121`

### Q2. Pool creation rights (register_pool)

- **The creator is a `Signer`** (`ix_initialize_virtual_pool_with_spl_token.rs:60`) and is stored as `pool.creator` (`:259-271`).
- **Anyone can create any number of pools on any config.** The config only needs `has_one = quote_mint` (`:51`); there is no partner approval. `base_mint` is `init, signer` (a fresh keypair each time, `:62-70`), so the pool PDA differs per base mint.
- The `token_type` must match: the SPL path requires `token_type == 0` (`:177-182`), and the Token-2022 path requires 1 (`process_initialize_virtual_pool_with_token2022.rs:58-63`).
- **`pool.creator` is mutable.** `transfer_pool_creator` works while `PreBondingCurve`, and after `CreatedPool` for DAMM v2 (`instructions/creator/ix_transfer_pool_creator.rs:40-92`). An attacker could create a pool and then hand `creator` to the victim's key. Requiring the launch creator's **signature** on `register_pool` still blocks hijacking.
- **Stronger and simpler alternative:** store the expected base mint (or the expected pool PDA) in `create_launch`. Only the holder of that base-mint keypair can create that pool, because `base_mint` must sign. `register_pool` then checks `pool.key == PDA(config, base, quote)`, `pool.config == config` and `pool.base_mint == launch.expected_base_mint`.

### Q3. Supply

**Minting:**
- The full initial supply is minted into `base_vault` **at pool init** (`ix_initialize_virtual_pool_with_spl_token.rs:217-228`).
- Mint authority is then revoked (`:230-242`); freeze authority was never set.
- Initial supply (`state/config.rs:876-929`):
  - fixed supply: `pre_migration_token_supply`
  - dynamic supply: `min(swap_base_amount×1.25, base on curve up to MAX_SQRT_PRICE) + migration_base_threshold + locked_vesting_total`

**At migration** (`migrate_damm_v2_initialize_pool.rs:736-765`), after LP deposits:
- `left = base_vault − (partner+creator+protocol base fees) − protocol_migration_base_fee`
- DBC **burns** `min(left, max_burnable)`.
  - dynamic: `max_burnable = u64::MAX`, so **everything left is burned**.
  - fixed: `max_burnable = pre − post`.
- **Dynamic:** nothing remains for `withdraw_leftover`, which rejects non-fixed configs anyway (`withdraw_leftover.rs:82-85`).
- **Fixed:** the remainder goes to `leftover_receiver` via `withdraw_leftover`.

**Final `mint.supply` with dynamic supply and quote collect mode:**
- tokens held by buyers
- \+ base deposited into DAMM v2 positions
- \+ `protocol_migration_base_fee_amount` (still in `base_vault`, claimable by the protocol)

A round "1B supply" is only possible with fixed supply (`pre` = 1e9 × 10^decimals). That requires `harvest_leftover` and a pre-created PDA base ATA.

### Q4. Formulas and rounding

- **Migration fee:** `quote_amount = ceil(thr×(100−pct)/100)`, `fee = thr − quote_amount` (`state/config.rs:846-858`).
  - `creator = floor(fee×creator_mig_pct/100)`, `partner = fee − creator` (`:860-874`).
  - Config rule: if pct = 0 then creator% must be 0 (`process_create_config.rs:86-96`).
- **Trading fee per swap:** `total = ceil(amount×fee_num/1e9)` (`state/config.rs:174-187`).
  - Fees are taken on quote input for buys and on quote output for sells (`state/fee.rs:129-137`).
  - `protocol = floor(total×20/100)`; `trading = total − protocol`; `referral = floor(protocol×20/100)` when a referral account is passed (`:139-172`).
  - `creator = floor(trading×creator_trading_pct/100)`, `partner = trading − creator` (`:1014-1033`).
  - The amounts accrue to `partner_quote_fee` / `creator_quote_fee` (`state/virtual_pool.rs:960-977`).
- **Surplus:** `total = quote_reserve − thr`; `pc = floor(total×80/100)`; `creator = floor(pc×creator_trading_pct/100)`; `partner = pc − creator`; `protocol = total − pc` (`state/virtual_pool.rs:1130-1166`).
- `withdraw_migration_fee` and the surplus withdrawals only need the curve to be complete. **Neither needs migration.** Our `redeem` gate must therefore check `migration_progress == 3` (or `is_migrated == 1`) in addition to our own `migration_fee_harvested` flag.
- Status bits: partner `0b100`, creator `0b010`; bit 0 is unused.

### Q5. DAMM v2 migration (DBC 0.2.1)

**Instruction sequence:**
- Swap until `quote_reserve ≥ threshold`. The completing swap sets `migration_progress` to `LockedVesting` (no token vesting) or `PostBondingCurve` (token vesting) (`process_swap.rs:343-363`).
- With token vesting, `create_locker` must run first. We have none.
- Then call **only `migration_damm_v2`**, which requires `LockedVesting` (`:534-537`).
- `migration_damm_v2_create_metadata` is deprecated. `migration_metadata` is an unused account; the SDK passes PDA `["damm_v2", pool]` (`sdk:services/migration.ts:623`).
- The SDK sets 600k CU (`:707-711`).

**Accounts** (`migrate_damm_v2_initialize_pool.rs:33-130`), in order:
1. `virtual_pool`
2. `migration_metadata`
3. `config`
4. `pool_authority` (mut)
5. `pool` (DAMM PDA `["pool", damm_config, max, min]`)
6. `first_position_nft_mint` (Signer)
7. `first_position_nft_account` (DAMM PDA `["position_nft_account", nft_mint]`)
8. `first_position` (`["position", nft_mint]`)
9. `second_*` (optional, the SDK always passes them)
10. `damm_pool_authority`
11. `amm_program`
12. `base_mint`
13. `quote_mint`
14. `token_a_vault`
15. `token_b_vault`
16. `base_vault`
17. `quote_vault`
18. `payer` (Signer)
19. `token_base_program`
20. `token_quote_program`
21. `token_2022_program`
22. `damm_event_authority`
23. `system_program`

Remaining account 0 is the **DAMM v2 config**. There is no locker or metadata account.

**DAMM v2 configs by migration fee option** (`sdk:constants.ts:108-116`, all verified on mainnet: `pool_creator_authority` = DBC pool authority, `permission` bit 0 `CreatePoolWithoutMintValidation` = 1):
- 0 `7F6dnU…` (25 bps)
- 1 `2nHK1k…` (30 bps)
- 2 `Hv8Lmz…` (100 bps)
- 3 `2c4cYd…` (200 bps)
- 4 `AkmQWe…` (400 bps)
- 5 `DbCRBj…` (600 bps)
  - Options 0–5 are static configs with `collect_fee_mode` 1 (OnlyB), dynamic fee on, protocol 20%.
- 6 **Customizable** `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck`: dynamic config type.
  - DBC checks only `pool_creator_authority` (`:418-496`).
  - Pool fees come from `PoolConfig.migrated_*` via `initialize_pool_with_dynamic_config` (`:151-199`).

**Mint validation:** DAMM v2 badges are bypassed through the config permission (`damm:instructions/initialize_pool/ix_initialize_pool_with_dynamic_config.rs:174-186`). DAMM v2 badges for SPYx exist anyway.

**Token order:** A = base, B = quote (`:183-184`, `:217-218`). Confirmed on mainnet pools `5gpGUa…` and `FAeEkc…`.

**Positions:**
- The first position holds the larger distribution plus dead liquidity (0 for concentrated pools) (`:614-644`). It is permanent-locked through `permanent_lock_position` for `permanent_locked_liquidity` (`:251-279`, `:646-654`).
- The first position's NFT account owner is then set to its owner through Token-2022 `SetAuthority(AccountOwner)` (`:326-346`, `:656-661`).
- **A second position is created only if leftover liquidity > 0** (`:678-732`). It goes to the other side, here `pool.creator`.
  - With creator shares all 0, `adjust_liquidity` makes it **fully unlocked** (`state/config.rs:1282-1291`).
  - In concentrated mode the leftover is bounded by rounding dust of the quote, so the position is negligible.
  - Mainnet partner-100% SPYx pools show a single position.
- **Our harvest must only touch positions whose NFT account owner == Authority PDA.**

**Collect fee modes (migrated pool):**
- DBC 0 = QuoteToken → DAMM `OnlyB`: **fees are quote-only, no base fees** (`damm:state/fee.rs:402-429`).
- DBC 1 = OutputToken → `BothToken`.
- DBC 2 = Compounding (needs `compounding_fee_bps > 0`; adds `100<<64` dead liquidity).
- Mainnet SPYx pools show `collect_fee_mode = 1`.

**Rent:** DBC uses its pool authority as the DAMM payer inside `flash_rent`, and the `payer` reimburses it (`instructions/migration/flash_rent.rs:6-25`). On mainnet `FhVo3…` holds 58 SOL. **On LiteSVM the pool authority account must be funded**; the current fixtures do not include it.

### Q6. DAMM v2 `claim_position_fee`

**Accounts** (`damm:instructions/ix_claim_position_fee.rs:13-70`, IDL):
- `pool_authority` (`HLnpSz…`)
- `pool` (has_one mints and vaults)
- `position` (mut, has_one pool)
- `token_a_account`, `token_b_account` (mut, no owner constraint)
- `token_a_vault`, `token_b_vault`
- `token_a_mint`, `token_b_mint`
- `position_nft_account` (mint == `position.nft_mint`, amount == 1)
- `signer`
- `token_a_program`, `token_b_program`
- `event_authority`, `program`

**Signer rule:** OK if `position_nft_account.owner == signer`; a delegate path also exists (`state/position.rs:566-595`).

**Locked liquidity:** fees accrue on **total** liquidity including permanent-locked (`:159-164`, `:247-272`). Permanent-locked liquidity can never be removed; `remove_liquidity` uses unlocked liquidity only (`ix_remove_liquidity.rs:122-124`).

**Token-2022:** transfers are plain `transfer_checked` through `token_b_program` **without transfer-hook extra accounts** (`damm:utils/token.rs:190-221`). This works while the SPYx hook program is null.

**LP fee share:** the LP gets 80% of DAMM trading fees; the protocol takes 20% (`damm:constants.rs:146`, `params/fee_parameters.rs:86-113`).

**Position discovery:** position NFT mints are random keypairs chosen by whoever migrates. `harvest_lp_fees` must verify:
- `position.pool` == the DAMM pool PDA, derived from the DAMM config picked by `migration_fee_option`
- `position_nft_account` == PDA `["position_nft_account", nft_mint]`
- `position_nft_account.owner == Authority`

### Q7. Token badges and SPYx extensions

**DBC:**
- A quote mint with any extension other than MetadataPointer/TokenMetadata needs a badge (`utils/token.rs:216-258`). SPYx qualifies because of TransferHook, Pausable, PermanentDelegate, ScaledUiAmount, ConfidentialTransferMint and DefaultAccountState.
- Other extensions are not inspected. A zero transfer fee is always required.

**DAMM v2:**
- A badge is needed only at pool init for non-permissionless mints. `TransferHook` is allowed only if both program **and authority** are null (`damm:utils/token.rs:223-262`); SPYx's authority is set, so SPYx needs a badge.
- DBC migration bypasses this through the config permission. Swaps and claims never check badges.

**Mainnet badges (both exist):**
- DBC `D2THzeQLHaDeKBzzmTNuWEWw23WPM8vVhLvUmSPEpNeL` (owner DBC, 168 bytes, `token_mint` = SPYx)
- DAMM v2 `CzLLYiZcDXavJoS6wp9sgMU599qYWj2zPEh58fj9k1AK`
- QQQx, NVDAx, TSLAx, AAPLx, MSFTx, GOOGLx and GLDx also have badges on both programs.

**Hook risk:** DBC passes `None` hook accounts for every quote transfer (`process_swap.rs:283-336`, all claim and withdraw handlers). `transfer_token_from_pool_authority` fails with `MissingRemainingAccountForTransferHook` once a hook program is set (`utils/token.rs:144-165`). DAMM v2 never adds hook accounts either.

**If the issuer ever sets a hook program on SPYx, all DBC swaps, claims and migrations and all DAMM v2 transfers for SPYx pools fail** until the hook is removed. **Pausable** has the same effect while paused.

### Q8. Off-curve (PDA) `fee_claimer` / `leftover_receiver`

- **DBC:**
  - `create_config` takes both as `UncheckedAccount` with no signature (`ix_create_config.rs:21-24`).
  - Claims compare keys with a `Signer` (`access_control.rs:25-33`, `ix_withdraw_migration_fee.rs:101-104`).
  - `withdraw_leftover` uses an address-only ATA constraint.
- **DAMM v2:** `SetAuthority` to a PDA is fine. The ATA ownership check (`validate_ata_token`) only runs on the delegate path.
- **No `is_on_curve` checks** in DBC or DAMM v2.
- **SDK:** `getOrCreateATAInstruction` defaults `allowOwnerOffCurve = true` (`sdk:helpers/token.ts:28-42`).
- **Our TS code** must pass `allowOwnerOffCurve = true` to `getAssociatedTokenAddressSync` for Authority ATAs.
- **Mainnet precedent:** see §A (PDA partner fee_claimer claiming via CPI).
- **CPI depth:** our program → DBC → Token-2022 plus the DBC event self-CPI is depth 3. That is fine as a top-level instruction, but our program cannot itself be invoked from yet another CPI layer (for example a multisig) without running close to the depth limit of 4.

### Q9. Validations DBC already performs

**At `create_config`** (`process_create_config.rs`):
- quote mint badge or zero transfer fee (`:378`)
- fees (below)
- `creator_trading_fee_percentage ≤ 100` (`:388-391`)
- migration fee ≤ 99; creator ≤ 100; if pct = 0 then creator = 0 (`:80-98`)
- `collect_fee_mode ∈ {0,1}` (`:396-399`)
- `migration_option` valid and ≠ DAMM v1 (`:401-421`)
- `migration_fee_option ∈ 0..6` (`:405-406`)
- `token_type ∈ {0,1}` (`:409`)
- Customizable: migrated fee 10–1000 bps, collect mode 0/1/2 with the compounding rule, dynamic fee 0/1, base fee mode time-scheduler (all scheduler params 0) or market-cap scheduler (validated) (`:146-219`, `:423-424`)
- non-Customizable: every `migrated_*` field must be 0 (`:425-429`)
- LP vesting parameters valid with duration ≤ 2 years (`:330-353`)
- token authority option valid; 3/4 only for hook configs (`:440-446`)
- decimals 6–9 (`:449-452`)
- the 6 liquidity percentages sum to exactly 100 (`:454-464`)
- `migration_quote_threshold > 0` (`:466-469`)
- token vesting: all zero, or frequency ≠ 0 and total ≠ 0 (`:300-309`)
- pool creation fee 0 or 1e6–1e11 lamports (`:475-481`)
- `MIN_SQRT_PRICE ≤ start < MAX` (`:484-487`)
- 1 ≤ curve length ≤ 16 (`:488-492`)
- `curve[0].sqrt > start`, liquidity > 0, ≤ MAX (`:493-498`)
- strictly increasing with liquidity > 0 (`:500-506`)
- last point ≤ MAX (`:509-512`)
- threshold reachable on the curve (`params/liquidity_distribution.rs:117`)
- `migration_sqrt_price < MAX` (`:567-570`)
- `swap_base_amount` fits u64 and > 0; migration base amount > 0 and ≤ u64 (`:572-596`, `concentrated_liquidity.rs:102`)
- compounding: price within 1% and liquidity > dead liquidity (`:598-619`)
- fixed supply: `leftover_receiver ≠ default` and `min_without_buffer ≤ post ≤ pre` and `min_with_buffer ≤ pre` (`:621-658`)
- locked liquidity at 1 day ≥ 10% (`:707-711`)

**Fee rules:**
- rate limiter rejected (`params/fee_parameters.rs:31-34`)
- scheduler params all zero or all non-zero; min fee ≥ 0.25%; cliff ≤ 99%; numerators < 1e9 (`base_fee/fee_scheduler.rs:78-96`)
- dynamic fee: `bin_step == 1`, `bin_step_u128 == 1844674407370955`, `filter < decay`, `reduction ≤ 10000`, `vfc` and max accumulator ≤ U24_MAX (`params/fee_parameters.rs:116-150`)

**Re-checked at pool init** (`ix_initialize_virtual_pool_with_spl_token.rs:149-191`):
- badge
- ≥ 10% locked
- not rate limiter
- not DAMM v1
- min base fee ≥ 0.25%
- `token_type` match
- no mint-authority option

**Not checked by DBC:**
- who `fee_claimer` or `leftover_receiver` is (except non-default for fixed supply)
- any minimum migration fee or USD threshold
- `activation_type` semantics
- `enable_first_swap_with_min_fee`, which lets a bundled first swap pay the minimum fee

**What `create_launch` should check** (nothing here contradicts DBC):
- owner = DBC, discriminator, length 1048
- `fee_claimer == leftover_receiver == Authority`
- `creator_migration_fee_percentage == 0`, `migration_fee_percentage ∈ [30,99]`
- `partner_permanent_locked == 100`, other buckets 0, vesting percentages 0, `locked_vesting` all 0
- `collect_fee_mode == 0`, `migration_option == 1`
- `migrated_collect_fee_mode == 0` for Customizable (option 2 is quote-only by config)
- `token_type == 0`, `quote_mint` in the allowlist
- `pool_creation_fee == 0`
- optionally `token_update_authority == 1`
