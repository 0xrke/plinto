# C1 evidence: the full StockFloor flow on a mainnet fork

Date: 2026-09-15. Result: **C1 passes.** The flow DBC config quoted in SPYx → pool → buys →
curve complete → migration → migration fee harvested into the vault PDA → redeem runs green on
a LiteSVM mainnet fork. It uses the **real `stockfloor` program**
(`target/deploy/stockfloor.so`, built by `bash scripts/build-programs.sh -p stockfloor`), not
the spike program.

The rest of BRIEF §8 (DAMM v2 trades, LP fee harvest, several redeemers, and invariants after
every step) is green too. **No step is skipped.** The C1 integration itself did not expose any bug
in `programs/stockfloor` or `packages/sdk`.

**Update after the M1 review (program commits `f8644bd` and `a54b37e`).** Two independent reviews found issues outside
the C1 happy path. Each was reproduced on the fork against the pre-fix binary first
(`tests/integration/review-regressions.test.ts`, see "M1 review regressions" below), then fixed in
the program:
- `create_launch` now rejects DBC configs that are not StockFloor-shaped: fixed token supply,
  creator trading share above 30%, a curve base fee above 20% or not a fee scheduler, the dynamic
  fee, migrated LP fees not in the quote token, mutable metadata, a non-zero pool creation fee.
  The real DBC accepts every one of these configs.
- `create_launch` commits the base mint, and `register_pool` is permissionless, so the creator
  can no longer withhold registration (and with it the migration fee and the floor).
- `Launch.migrated` latches migration completion; `redeem` stops decoding DBC state once it is set.
  The account decoders accept grown accounts.
- Harvests refuse a vault with a delegate, close authority, foreign owner, CPI Guard or required
  memos (`VaultEncumbered`), because the vault owner signs their CPIs into upgradeable programs.
- The `floor` view also returns the floor per token as Q64.64 (`floor_q64`).

None of this changes an amount in the C1 flow below: every token amount is identical before and
after the fixes. The `register_pool` rows, the floor view values and the test counts are updated.

**Update for M2 (program commits `9f761ad` and `ddf9fc6`).**
- **Vault-authority split.** The claimer PDA `["authority", config]` stays the DBC `fee_claimer` /
  `leftover_receiver` and the DAMM v2 position NFT owner and signs every CPI. The vault is now the
  SPYx ATA of a second PDA, `["vault_authority", config]`, which signs only the `redeem` payout. Every
  harvest pays quote straight into a vault its signer does not own, on the real DBC and DAMM v2
  binaries (the destination accounts carry no owner constraint in either program).
- **`burn_claimer_base` replaces `harvest_leftover`** (the DBC `withdraw_leftover` CPI was unreachable).
- **`Launch` layout v2** stores both bumps in the same 351 bytes.
- **New M2 fork tests:** the claimer never controls the vault, tiny redemptions at 200 bps, a
  fast-check property test on the fork, extra DAMM v2 positions, production compute-unit limits, and
  an instruction-validation file that replaces the monolithic smoke test (sections "M2 tests" and
  "Compute units" below).

Every C1 amount below is unchanged by M2 (re-checked from the lifecycle log after the split).

## Environment

| Item | Value |
|---|---|
| Fork | LiteSVM (node `litesvm` 1.4.1), harness in `tests/src/fork.ts` |
| Mainnet binaries | DBC `dbcij3…` (0.2.1 line), DAMM v2 `cpamdp…` (0.2.4), Token-2022, SPL Token, ATA, Token Metadata |
| Mainnet accounts | SPYx mint `XsoCS1…` (Token-2022, 8 decimals, Pausable, ScaledUiAmount, PermanentDelegate, TransferHook with null program); DBC token badge for SPYx `D2THzeQ…`; DBC pool authority `FhVo3…`; DAMM v2 pool authority; DAMM v2 Customizable config `A8gMrEP…` |
| Fixture dump | `tests/fixtures/manifest.json`, generated 2026-09-15T17:56:10.864Z from `https://api.mainnet-beta.solana.com`, **slots 447312190–447312193** |
| Fork clock | Starts at the dump time, so the SPYx `newMultiplier` 1.005714560286254 is in effect (effective since 2026-06-18) |
| Our program | `stockfloor` `98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA`; C1 first proven at commit `f2986c8`, re-run on the M1 review fixes (`a54b37e`) and on the M2 split (program source last changed at `ddf9fc6`, 450,560-byte binary, sha256 `580ecbee…`) |
| Launch parameters | SDK `buildDbcConfigParams`: SPYx quote at $757.02 (the Jupiter price observed 2026-09-15; a constant, not fetched live), threshold $1,000, `gentle` preset, 50% vault share, 2% exit fee, 1% curve fee, creator trading share 30%, 100% partner permanent-locked liquidity, DAMM v2 Customizable 1% with quote-only fees, dynamic supply |

No threshold scaling was needed. The default $1,000 threshold is 131,346,320 raw SPYx
(1.31346320 SPYx), which cheatcodes fund trivially.

**Determinism.** Wallet and config keys are random on each run, yet every token amount below
comes out the same on every run (checked by diffing two runs). Only compute units shift by a
few thousand, because PDA bump searches depend on the keys.

## Test files

| File | What it covers |
|---|---|
| `tests/integration/c1-lifecycle.test.ts` | The ordered BRIEF §8 flow (20 `it` blocks), with the stage-specific adversarial checks inline |
| `tests/integration/c1-adversarial.test.ts` | Adversarial scenarios that need their own setup (17 tests): harvest redirection (including the claimer and vault authority swapped), early fee harvest, second pool, surplus routing, the invariant checker's self-check, quote issuer controls on every quote-moving instruction, redemption edge cases |
| `tests/integration/review-regressions.test.ts` | One block per M1 review finding (11 tests); each block failed on the pre-fix binary |
| `tests/integration/sdk-presets-fork.test.ts` | SDK presets `gentle`/`flat` × vault shares 30/50/70% on the real DBC and stockfloor programs, plus 15 negative SDK validation codes compared with DBC's errors (7 tests) |
| `tests/integration/instruction-errors.test.ts` | M2: account and argument validation of `create_launch`, `register_pool`, `redeem` and `floor` (7 tests); replaces the M1 smoke test |
| `tests/integration/vault-authority.test.ts` | M2: the claimer never holds or controls the vault (2 tests) |
| `tests/integration/redeem-splits.test.ts` | M2: many tiny redemptions at 200 bps against the exact per-step and continuous bounds (3 tests) |
| `tests/integration/floor-property.test.ts` | M2: fast-check property test over random action sequences on the fork (1 test, 40 runs) |
| `tests/integration/lp-positions.test.ts` | M2: extra DAMM v2 positions held by the claimer (3 tests) |
| `tests/integration/compute-budget.test.ts` | M2: the lifecycle with production compute-unit limits (1 test) |
| `tests/src/stockfloor.ts` | Instruction builders for all 9 stockfloor instructions (from `target/idl/stockfloor.json`), the Launch reader and the `floor` return-data decoder (34 bytes) |
| `tests/src/floor-invariants.ts` | `FloorTracker`: checks the floor invariants around every step |
| `tests/src/stockfloor-scenario.ts` | Builds a launch through the SDK, with helpers to buy, complete and graduate |
| `tests/src/anchor.ts` | `parseCpiEvents`: decodes the `emit_cpi!` events that DBC and DAMM v2 put in inner instructions, only from inner instructions of the given program id (DBC and DAMM v2 both define `EvtSwap2`) |

**Source of expected amounts.** Each expected amount is computed without using the stockfloor
program, from one of these:
- DBC or DAMM v2 formulas from `vendor/` sources;
- DBC `EvtSwap2` event data;
- DAMM v2 account state;
- `@stockfloor/sdk` math.

The test then compares the program's token balance changes, events and `Launch` counters
against that value.

## C1 steps → proving tests and exact asserted amounts

Unless noted, amounts are raw units: SPYx has 8 decimals and the base token 6.

### 1. DBC config quoted in SPYx (`1. creates the SPYx-quoted DBC config…`)

- **Config built by the SDK.** `buildDbcConfigParams(input, claimer, claimer)` produces the
  config, and the real DBC `create_config` accepts it with the SPYx token badge as remaining
  account 0.
- **Keys and PDAs.** `fee_claimer == leftover_receiver ==` the claimer PDA
  `["authority", config]`. The vault is the SPYx ATA of the vault authority PDA
  `["vault_authority", config]`, not the claimer's. The SDK PDAs (`authorityPda`,
  `vaultAuthorityPda`, `launchPda`, `vaultAddress`, `dbcTokenBadgePda`) equal the harness derivations.
- **Stored config values:**
  - `migration_quote_threshold` = **131,346,320**
  - `migration_fee_percentage` = 50
  - `creator_migration_fee_percentage` = 0
  - `creator_trading_fee_percentage` = 30
  - partner permanent lock = 100, other liquidity buckets = 0
  - collect fee mode = QuoteToken, migration option = DAMM v2
  - SPL base token, Token-2022 quote, dynamic supply, 6 decimals
  - cliff fee numerator = 10,000,000 (1%)
- **SDK port matches the program exactly** (`validateDbcConfigParams` vs. what DBC stored):

  | Field | Value |
  |---|---|
  | `migration_sqrt_price` | 8,444,416,508,877,617 |
  | `swap_base_amount` | 686,607,724,760,238 |
  | `migration_base_threshold` | 313,392,275,239,762 |
  | `sqrt_start_price` | 7,708,662,344,802,159 |

### 2. Pool (`2. creates the DBC pool…`)

- **Base mint.** SPL Token, 6 decimals, mint authority revoked.
- **Initial supply** = **1,000,000,000,000,001**. This equals the SDK port's
  `initialBaseSupply`, and all of it sits in the DBC base vault.
- **Rogue pool.** An unrelated wallet creates a second pool on the same config, for the
  adversarial checks below.

### 3. `create_launch` + `register_pool` (`3a`, `3b`, `3c`)

- **`create_launch`, exit fee 200 bps.** The Launch has the expected config, creator, SPYx,
  Token-2022, vault address, `pool = default`, the **committed base mint** of the pool,
  `migrated = false` and `migration_fee_harvested = false`, `version = 2` and both bumps (the raw
  bytes are checked at the documented offsets). The vault is the vault authority's SPYx ATA with a
  balance of 0. The `LaunchCreated` event carries pct 50, threshold 131,346,320, the base mint, the
  claimer and the vault authority.
- **Adversarial `register_pool` (3b).** Registration is permissionless, so the question is only
  which pool can be registered:

  | Attempt | Result |
  |---|---|
  | Rogue pool with its own base mint (sent by the rogue creator) | `BaseMintMismatch` |
  | Rogue pool with the committed base mint account (sent by the launch creator) | `BaseMintMismatch` |
  | Canonical pool with the rogue base mint | `BaseMintMismatch` |
  | A non-pool account (the DBC config) | `InvalidDbcPool` |
  | Second registration after success (3c) | `PoolAlreadyRegistered` |

- **Registration (3c)** is sent by a fresh random key, not the creator, and succeeds.
- **After registration.** The `floor` view returns
  `{vault 0, supply 1,000,000,000,000,001, bps 200, floor_q64 0}`.

### 4. Buys and sells by several wallets (`4. several wallets buy and sell…`)

- **Trades.** alice buys 26,269,264 (20% of T). bob buys 19,701,948 (15%). carol buys
  13,134,632 (10%). alice sells ½ of her base. dave buys 6,567,316 (5%). bob sells ⅓.
- **Buy checks** (from `EvtSwap2`):
  - `total_fee = ceil(in × 10,000,000 / 1e9)` and `protocol = floor(total × 20%)`;
  - referral = 0;
  - the buyer's SPYx balance drops by exactly `in`;
  - the base received equals the event output.
- **Sell checks:**
  - `total_fee = ceil((out + total_fee) × 1%)`;
  - the SPYx received equals the event output.
- **Partner fee.** Accrued partner fee = Σ(trading − floor(trading × 30%)) = **481,750**, equal
  to `pool.partner_quote_fee`. The vault is still 0.

### 5. `harvest_curve_fees` (`5a` adversarial, `5b`)

- **5a rejections:**

  | Attempt | Result |
  |---|---|
  | `harvest_curve_fees` on the rogue pool | `InvalidDbcPool` |
  | Vault replaced by the cranker's SPYx ATA | `ConstraintAddress` |
  | `harvest_migration_fee` before completion | `CurveNotComplete` |
  | `redeem` before completion | `MigrationNotComplete` |

- **5b, fresh random key as cranker.** The vault goes from 0 to **481,750** (+481,750 exactly),
  and the DBC quote vault drops by 481,750. `partner_quote_fee` becomes 0. The event shows
  `quote_amount` 481,750 and `base_burned` 0, and `Launch.total_harvested_quote` = 481,750.
  The cranker has no token accounts at all.
- **Rogue pool.** Its partner fees stay in DBC.

### 6. Complete the curve, including surplus (`6. a PartialFill buy completes the curve…`)

- **Completing buy.** erin offers 96,350,690 in PartialFill mode and spends exactly
  **87,558,028** (the event's included-fee input), receiving 438,884,732,864,215 base.
- **Pool after completion:**
  - `quote_reserve` = reserve_before + excluded-fee input = **131,346,321** (T + 1);
  - `sqrt_price` = `migration_sqrt_price`;
  - `migration_progress` = LockedVesting;
  - completing-buy partner fee = **490,326**.
- **Surplus.** `quote_reserve − T` = **1**. DBC 0.2.1 caps swaps at the migration price, so a
  real surplus is only rounding dust.
- **Rejections.** A late buy gets `PoolIsCompleted`. `redeem` gets `MigrationNotComplete`.

### 7. Migrate to DAMM v2 (`7. permissionless migration to DAMM v2…`)

- **Migration.** A random payer calls `migration_damm_v2` with the Customizable config.
  - The DBC pool has `is_migrated = 1` and `migration_progress = CreatedPool`.
  - The DAMM v2 pool PDA is as derived, with token A = base, token B = SPYx and
    `collect_fee_mode = 1` (OnlyB).
- **DAMM v2 token B amount** = `ceil(T × 50%) − floor(q × 20 / 10,000)` = 65,673,160 − 131,346 =
  **65,541,814**. Vault balances equal the pool's recorded amounts.
- **Position.** The NFT account holds 1 NFT and is owned by the **claimer PDA**.
  - `permanent_locked_liquidity` equals the pool liquidity, with 0 unlocked and 0 vested.
  - No second position exists.
- **Supply:**
  - It falls from 1,000,000,000,000,001 to **999,999,999,999,996** (5 raw burned by DBC).
  - The DBC base vault keeps **626,783,023,439** = `protocol_migration_base_fee_amount`.
  - The DAMM v2 base vault holds 312,765,492,216,322.
  - The supply equals the sum of all base accounts.
  - The SDK preview supply exceeds the actual supply by 4 raw (asserted to be between 0 and 1,000).
- **Vault** unchanged at 481,750. The floor rises because supply fell.

### 8. Harvest the migration fee and surplus; burn base held by the claimer (`8a`–`8f`)

**8a.** `redeem` after migration but before the fee harvest fails with `MigrationFeeNotHarvested`.

**8b. `harvest_migration_fee`, the key C1 step.**
- **Expected amount:** `T − ceil(T × (100 − 50) / 100)` = 131,346,320 − 65,673,160 = **65,673,160**.
  This equals SDK `getMigrationFeeDistribution(...).partnerMigrationFee` and
  `previewLaunch(...).vaultAtGraduationQuoteRaw`.
- **Balances.** The vault goes from 481,750 to **66,154,910** (+65,673,160 exactly). The DBC
  quote vault drops by 65,673,160.
- **Flags and event.** DBC `migration_fee_withdraw_status` has the partner bit `0b100` set.
  `Launch.migration_fee_harvested = true`, and `Launch.migrated = true` (latched, because the pool
  was already migrated). The event shows `quote_amount` 65,673,160 and `vault_balance` 66,154,910.
  The cranker receives nothing.

**8c.** A second `harvest_migration_fee` fails with `MigrationFeeAlreadyHarvested`; the vault is unchanged.

**8d.** `harvest_curve_fees` again collects exactly the completing buy's partner fee, **490,326**.
The vault reaches **66,645,236**.

**8e. `harvest_surplus`.**
- **Expected amount:** `pc − floor(pc × 30%)` with `pc = floor(surplus × 80%)`. For a surplus of
  1 that is **0**, and the vault moves by exactly 0.
- **Tied to DBC's own number.** The transaction carries exactly one DBC `EvtPartnerWithdrawSurplus`
  (decoded from DBC inner instructions only) for this pool, and its `surplus_amount` equals the
  vault delta (0).
- **Flags.** DBC `is_partner_withdraw_surplus = 1` and `Launch.surplus_harvested = true`.
- **Repeat.** A second call fails with `SurplusAlreadyHarvested`.
- **Non-trivial surplus.** Covered with cheatcode state in the adversarial file (below).

**8f. `burn_claimer_base` (supply effects).**
- **Nothing to burn.** With dynamic supply, DBC `withdraw_leftover` never applies (DBC
  `is_withdraw_leftover = 0`). `burn_claimer_base` emits `base_burned = 0`; supply unchanged.
- **Donation.** bob sends **7,074,133,429,318** base to the claimer's base ATA with a plain
  SPL transfer (step kind "donation").
- **Burn.** `burn_claimer_base` burns exactly 7,074,133,429,318. Supply falls from
  999,999,999,999,996 to **992,925,866,570,678**, the claimer base ATA returns to 0, and
  `Launch.total_burned_base` = 7,074,133,429,318.

### 9. DAMM v2 trades (`9. several wallets trade on the migrated DAMM v2 pool`)

- **Setup.** The clock is warped 60 s.
- **Four `swap2` trades:**
  - frank buys with 39,403,896 SPYx;
  - grace buys with 13,134,632;
  - frank sells ½ of his base;
  - dave (a curve buyer) sells ¼ of his base.
- **Checks.** Balance changes equal the event outputs, and `compounding_fee` = 0.
- **LP fees.** Σ `claiming_fee` (the LP share) = **681,461**. The vault is unchanged by trading.

### 10. `harvest_lp_fees` (`10. harvest_lp_fees moves exactly…`)

- **Rejection.** A position NFT account not owned by the claimer fails with `PositionNftNotOwnedByClaimer`.
- **Expected claim** from DAMM v2 state (`position.update_fee`): `fee_b_pending +
  liquidity × (pool.fee_b_per_liquidity − position.fee_b_per_token_checkpoint) >> 128`
  = **681,460**.
  - That is Σ claiming fees minus 1 raw of per-swap rounding. The test asserts it lies within
    [Σ − swaps, Σ].
  - The expected token A (base) claim is 0.
- **Balances.** The vault goes from 66,645,236 to **67,326,696** (+681,460 exactly). The DAMM v2
  token B vault drops by 681,460. The token A vault and the supply are unchanged.
- **Event and position.** The event shows `quote_amount` 681,460 and `base_burned` 0. The
  position's `fee_b_pending` is 0 afterwards.

### 11. Redeem by several holders (`11. several holders redeem…`)

- **Floor view** before redeeming: `{vault 67,326,696, supply 992,925,866,570,678, bps 200,
  floor_q64 1,250,806,703,958}`, where `floor_q64 = (vault << 64) / supply` is restated
  independently in the test.
  The vault equals Σ harvested = 481,750 + 65,673,160 + 490,326 + 0 + 681,460.
- **Rejections.** A 1-raw redemption fails with `NothingToRedeem`. Balance + 1 fails with
  `InsufficientBaseBalance`.
- **Formula.** Each redemption uses `redeemQuote(V, S, amount, 200)` from the SDK, restated
  independently as `gross = floor(V·a/S)` and `fee = ceil(gross·200/1e4)`.
- **Assertions per redemption:**
  - the holder's SPYx increases by `net`;
  - the holder's base and the supply both drop by `amount`;
  - the vault drops by `net`;
  - the event shows gross, fee, net, vault_before and supply_before;
  - the floor strictly increases.

| Holder | Amount (base raw) | Gross | Fee (stays in vault) | Net paid |
|---|---|---|---|---|
| carol (entire balance) | 69,138,391,982,799 | 4,688,023 | 93,761 | 4,594,262 |
| alice (½) | 36,540,436,829,274 | 2,481,383 | 49,628 | 2,431,755 |
| erin (¼) | 109,721,183,216,053 | 7,457,068 | 149,142 | 7,307,926 |
| frank (DAMM buyer, entire balance) | 58,348,819,865,491 | 3,976,799 | 79,536 | 3,897,263 |

### 12. Floor invariants throughout (`FloorTracker`, and `12. floor invariants held…`)

**Checks after each tracked step.** There are 26 tracked states: launch created →
register_pool → 6 curve trades → harvest → completing buy → migration → 5 harvests/donation
steps → 4 DAMM v2 swaps → LP harvest → 4 redeems. After each one the tracker checks:

1. **Floor never decreases.** `vault_raw / supply` is checked as the cross product
   `vault_after·supply_before ≥ vault_before·supply_after`. It must rise strictly on a redeem
   that keeps a fee.
2. **Only redeem takes quote out.** For every other step the vault does not decrease. For a
   redeem, the vault drops by exactly the net paid.
3. **`mint.supply` is the truth.** The supply equals the sum of every base token account that
   exists: DBC base vault, DAMM v2 base vault, all holders, and the claimer base ATA.
4. **The claimer holds no base tokens** after any instruction. The one exception is the
   explicit donation transfer, which the next `burn_claimer_base` burns.
5. **The claimer never holds or controls the vault.** The vault stays the vault authority's SPYx
   account (owner and mint), with no delegate and no close authority.

**Final reconciliation (test 12):**
- `Launch.total_harvested_quote` = 67,326,696
- `total_redeemed_quote` = 18,231,206
- `total_exit_fees` = 372,067
- `total_redeemed_base` = 273,748,831,893,617
- `total_burned_base` = 7,074,133,429,318
- final vault = 67,326,696 − 18,231,206 = **49,095,490**
- final supply = **719,177,034,677,061**

**Floor in USD.** Per token, it rises from about $5.04e-7 right after the migration fee harvest
to about $5.20e-7 at the end, using $757.02 × 1.0057146. The SDK preview's floor at graduation
was about $5.0e-7.

**The checker is not vacuous.** `c1-adversarial.test.ts › FloorTracker self-check` builds
violating states with cheatcodes and misdeclared steps, and the tracker rejects each one:
- quote leaving the vault outside redeem;
- a wrong declared net amount;
- a redeem declared as no-outflow;
- a floor decrease (supply minted from nothing);
- a supply that does not reconcile;
- base tokens parked at the claimer;
- (M2) a vault re-owned by the claimer, a vault delegate and a vault close authority.

## Adversarial tests added for C1

These are in addition to the inline checks in the lifecycle file.

**`c1-adversarial.test.ts` › a random signer cannot redirect any harvest.** The setup is two
launches on one fork. Launch 1 is graduated with DAMM v2 trades; launch 2 is live.

- **`harvest_curve_fees` substitutions:**

  | Substitution | Result |
  |---|---|
  | Vault → attacker SPYx ATA | `ConstraintAddress` |
  | Vault → launch 2's vault | `ConstraintAddress` |
  | Vault → the claimer's SPYx ATA (the pre-split vault address, created by the attacker) | `ConstraintAddress` |
  | Vault → a non-ATA SPYx account the attacker created with owner = vault authority | `ConstraintAddress` |
  | Claimer base account → attacker ATA | `ConstraintTokenOwner` |
  | Claimer base account → a non-ATA account owned by the claimer | `AccountNotAssociatedTokenAccount` |
  | Pool → launch 2 | `InvalidDbcPool` |
  | Config → launch 2 | `InvalidDbcConfig` |
  | Launch → launch 2 | `ConstraintSeeds` |
  | Claimer → launch 2's claimer | Runtime `MissingAccount` (see note) |
  | Claimer → launch 2's claimer, with ATA(launch 2 claimer, base mint) included | `ConstraintSeeds` |
  | Claimer → this launch's vault authority, with its base ATA included | `ConstraintSeeds` |

  **Note on the `MissingAccount` row.** Anchor runs the `init_if_needed` ATA check before the claimer
  seeds check. Without the foreign ATA in the transaction, the ATA-create CPI references an
  account that is missing, and the runtime rejects it (`MissingAccount`; the logs confirm it).
  With that ATA included, it is created and the program's seeds check rejects the substitution;
  the whole transaction rolls back. The same variant is covered for `harvest_lp_fees`.
- **`harvest_migration_fee` and `harvest_surplus`:** the same vault (including the claimer's SPYx
  ATA), pool, launch and claimer substitutions are rejected (claimer → another launch's claimer or
  this launch's vault authority → `ConstraintSeeds`). A foreign DBC quote vault gets DBC's
  `ConstraintHasOne`.
- **`burn_claimer_base`:** a missing claimer base ATA → `AccountNotInitialized`; attacker base ATA →
  `ConstraintTokenOwner`; non-ATA account owned by the claimer → `ConstraintAssociated`; another
  launch → `ConstraintSeeds`; the vault authority as claimer → `ConstraintSeeds`; another launch's
  base mint → `BaseMintMismatch`.
- **`harvest_lp_fees`:** vault substitutions and base-account substitutions are rejected, and
  an NFT account not owned by the claimer → `PositionNftNotOwnedByClaimer`.
- **Direct protocol calls signed by the attacker:**

  | Call | Result |
  |---|---|
  | DBC `claim_trading_fee` | `Unauthorized` |
  | DBC `withdraw_migration_fee(0)` | `NotPermitToDoThisAction` |
  | DBC `partner_withdraw_surplus` | `Unauthorized` |
  | DAMM v2 `claim_position_fee` | `InvalidAuthority` |

- **The attacker cranking honestly** (as fee payer):
  - curve fees **742,973** (= `partner_quote_fee`);
  - migration fee **65,673,160**;
  - surplus **0**;
  - claimer base burn 0;
  - LP fees **331,403** (from the DAMM v2 state formula; the M2 re-run printed the same amounts).

  The vault ends at exactly the sum. The attacker's SPYx and base balances are unchanged, and
  launch 2's vault stays 0.

**› harvest_migration_fee before migration does not open redemptions.**
- After completion, `harvest_migration_fee` puts exactly 65,673,160 into the vault, sets
  `migration_fee_harvested = true`, and DBC `is_migrated` is still 0.
- `redeem` fails with `MigrationNotComplete`.
- Migration still succeeds, with DAMM v2 token B = 65,541,814 (the same as the normal order).
  After it, `redeem` pays the exact net.

**› a second pool on the same config never feeds or drains the vault.** The rogue pool is
traded, completed and migrated; its DAMM v2 position NFT also belongs to the same claimer PDA.
- **Harvests on the rogue pool:** curve fees, migration fee and surplus fail with `InvalidDbcPool`;
  `burn_claimer_base` with the rogue base mint fails with `BaseMintMismatch`.
- **`harvest_lp_fees` on the rogue DAMM v2 pool:** `DammPoolMintMismatch` with the launch base
  mint, and `BaseMintMismatch` with the rogue base mint.
- **Redeeming rogue base tokens:** `InvalidDbcPool` when passing the rogue pool, and
  `BaseMintMismatch` when passing the launch pool.
- **End state.** The vault stays 0, `Launch.pool` stays canonical and `total_harvested_quote` = 0.

**› Quote issuer controls on every quote-moving instruction.**
- **Controls.** SPYx paused, the vault frozen, or a transfer hook program set, each by cheatcode.
- **Harvests.** `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus` and
  `harvest_lp_fees` fail with `QuoteMintPaused`, `VaultFrozen` or
  `QuoteMintTransferHookUnsupported`.
- **Redeem.** It fails with the same errors. The vault, supply, DBC and DAMM v2 vaults, Launch
  flags, counters and the holder's balances stay unchanged.
- **After restoring.** Everything succeeds.
- **Multiplier change.** Setting the ScaledUiAmount multiplier to 1.5 before the harvests, then to
  1.5 and 0.8 before redemptions, leaves every raw amount exact.

**› Redemption edge cases.**
- **Donation.** SPYx transferred straight into the vault raises the floor. The next redeem pays
  `floor((V + donation)·a/S)` minus the fee.
- **Exit fee 0.** net = gross, ten split redemptions pay at most `floor(V0·total/S0)`, and a dust
  amount fails with `NothingToRedeem`.
- **Exit fee 500 bps.** fee = `ceil(gross × 5%)`.
- **Entire supply** (cheatcode: one holder owns all base). gross = vault, the vault keeps exactly
  the fee, and the supply becomes 0.

**› C1 edge: `harvest_surplus` routing with a non-trivial surplus (cheatcode state).** This is a
routing check: the CPI into the real DBC binary and the destination are real, but the state is
patched and no DBC 0.2.1 swap can reach it.
- **Setup.** After migration, DBC `quote_reserve` (VirtualPool offset 240) and the DBC quote
  vault are both raised by 12,345,678. This emulates an overshooting buy, which DBC 0.2.1
  swaps cannot produce.
- **Expected amount.** For a surplus of 12,345,678: `pc = floor(12,345,678 × 80%)` = 9,876,542,
  so the partner share = 9,876,542 − floor(9,876,542 × 30%) = **6,913,580**.
- **Result.** The vault receives exactly 6,913,580, and the DBC quote vault drops by the same amount.

## M1 review regressions

`tests/integration/review-regressions.test.ts`. Every block below first ran against the pre-fix
binary and failed there (for example: all out-of-shape configs `ACCEPTED`, `PoolCreatorMismatch`
for a non-creator registration, `InvalidDbcPool` for redeem on a grown pool, a harvest succeeding
with a delegate on the vault, an 18-byte floor view).

1. **`create_launch` binds the StockFloor shape of the DBC config.** The real DBC accepts each
   config below; `create_launch` rejects it, and neither the Launch nor the vault is created.

   | Config (built by the SDK, then mutated) | Result |
   |---|---|
   | Fixed token supply (pre = post = 2e15 raw) | `FixedTokenSupplyNotAllowed` |
   | Creator trading fee share 31% / 100% | `CreatorTradingFeeTooHigh` |
   | Flat 50% curve fee / 20% + 1 numerator | `CurveFeeTooHigh` |
   | Dynamic (volatility) fee enabled | `DynamicFeeNotAllowed` |
   | Migrated LP fees in both tokens / compounding | `MigratedCollectFeeModeNotQuote` |
   | Creator or partner update authority | `TokenUpdateAuthorityNotImmutable` |
   | Pool creation fee 0.01 SOL | `PoolCreationFeeNotZero` |
   | Creator migration fee share 10% | `CreatorMigrationFeeNotZero` |
   | 90% permanent + 10% unlocked partner liquidity | `LiquidityNotFullyPartnerLocked` |
   | Curve fees in both tokens | `CollectFeeModeNotQuote` |
   | Committed base mint = default pubkey or SPYx | `InvalidBaseMint` |

   - **Why fixed supply is rejected.** On a fixed-supply config (not a launch), after migration
     the DBC base vault still holds leftover base larger than a third of `mint.supply`. That base
     never circulates but would count in the floor denominator until `withdraw_leftover` + burn.
   - **The bound is inclusive.** The brief's anti-snipe schedule (exponential, cliff 20%, 10
     periods of 180 s, reduction 2,589 bps, creator share 30%) passes `create_launch` and
     `register_pool`.
2. **The creator cannot withhold the floor.** The creator never calls `register_pool`.
   - **Before registration.** `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus`
     and `redeem` fail with `PoolNotRegistered`.
   - **A second pool.** The creator's second pool on the same config (another mint) cannot be
     registered: `BaseMintMismatch` with either base mint account.
   - **A random wallet registers the committed pool.** After graduation it harvests exactly
     `T − ceil(T × 50%)`, and a holder redeems the exact net.
   - **Sock-puppet creator key.** The creator creates the committed pool under a second wallet as
     DBC `creator`. A random wallet still registers it. This path was found while fixing the
     finding: the first fix still compared `pool.creator` and failed with `PoolCreatorMismatch`.
     The check is gone, because the committed mint already identifies the one pool.
   - **Commit before the pool exists.** `create_launch` can commit the base mint before the pool
     exists. Registration fails before DBC creates the pool (`AccountNotInitialized`, the mint
     does not exist yet) and succeeds right after.
3. **`redeem` does not depend on DBC state once the migration is latched.**
   - **Latch.** `harvest_migration_fee` after migration sets `Launch.migrated`.
   - **Grown pool.** The DBC VirtualPool is grown by 64 bytes (cheatcode), emulating a realloc;
     a redeem pays the exact net.
   - **Re-typed pool.** The pool's discriminator and migration state are then overwritten.
     `harvest_surplus`, which decodes the pool before its CPI, now fails with `InvalidDbcPool`, but
     two more redemptions still pay exactly. (M1 used `harvest_leftover` here; its replacement `burn_claimer_base` reads no DBC state.)
   - **Fee harvested before migration.** The latch stays false: `redeem` fails with
     `MigrationNotComplete` until migration. The pool is grown by 64 bytes, and the first successful
     redeem decodes it (minimum-size decoder) and latches; after the pool is re-typed, the next
     redeem is still exact.
4. **Harvests refuse an encumbered vault.** A delegate, a close authority, or an owner other than
   the vault authority is set on the vault by cheatcode. `harvest_curve_fees`, `harvest_migration_fee`,
   `harvest_surplus` and `harvest_lp_fees` each fail with `VaultEncumbered`; the vault balance
   and the Launch flags are unchanged. With a clean vault all four succeed. With a delegate set
   afterwards, a holder still redeems exactly.
   - **Why a proxy.** The M1 threat was a malicious DBC or DAMM v2 upgrade setting these fields
     inside the CPI. Since M2 the vault owner never signs those CPIs, so the upgrade cannot set them
     (`vault-authority.test.ts`); the check stays as defence in depth. It runs on the post-CPI state,
     so pre-set fields exercise the same code path.
   - **Unit tests.** CPI Guard and required incoming memos are covered by Rust unit tests
     (`token_utils::tests`).
5. **Floor per token.** Before registration the view returns
   `{vault 0, supply 0, bps 200, floor_q64 0}`. After graduation and the harvest, `floor_q64`
   equals `(vault << 64) / supply`.

`tests/integration/sdk-presets-fork.test.ts` covers every product preset, not only gentle / 50%.
- **Presets × shares.** For `gentle` and `flat` × 30/50/70%, DBC `create_config` stores exactly
  what the SDK port predicts: migration sqrt price, swap base amount, migration base threshold,
  start price, threshold and initial supply.
- **Our program.** `create_launch` and `register_pool` accept each config.
- **At graduation.** The vault holds exactly `previewLaunch().vaultAtGraduationQuoteRaw`, DAMM v2
  holds the predicted quote, and the supply is at most 1,000 raw below the preview.
- **Negative codes.** 15 mutated configs fail in `validateDbcConfigParams` and in the real DBC
  `create_config` with the same `PoolError` name: `TypeCastFailed`, `ExceedMaxFeeBps`,
  `InvalidCreatorTradingFeePercentage`, `InvalidMigratorFeePercentage`,
  `InvalidCollectFeeMode`, `DeprecatedMigrationOption`, `InvalidTokenAuthorityOption`,
  `InvalidTokenDecimals`, `InvalidFeePercentage`, `InvalidMigrationLockedLiquidity`,
  `InvalidQuoteThreshold`, `InvalidPoolCreationFee`, `InvalidCurve`, `InvalidTokenSupply`,
  `InvalidMigratedPoolFee`.

## M2 tests

All on the same LiteSVM mainnet fork, with the real stockfloor binary after the vault-authority
split. Amounts are deterministic (the same on every run); only compute units vary with the keys.

### The claimer never holds or controls the vault (`vault-authority.test.ts`)

- **Harvests pay a vault the signer does not own.** On a graduated launch with DAMM v2 trades,
  `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus` and `harvest_lp_fees` each move
  exactly the independently computed amount (partner quote fee from DBC state,
  `T − ceil(T × 50%)`, the DBC surplus formula, the DAMM v2 position formula) into the vault. For each
  transaction: the claimer is an account (it signs the CPI), the vault authority is **not** an
  account of the transaction, the vault owner is still the vault authority, and ATA(claimer, SPYx)
  does not exist. `burn_claimer_base` involves only the claimer; `redeem` involves only the vault
  authority (exact net).
- **A forged claimer signature cannot touch the vault.** LiteSVM signature verification is switched
  off for single transactions that mark the claimer PDA as a signer, which is the privilege an
  upgraded DBC or DAMM v2 would receive through the CPI. Token-2022 rejects each attempt and nothing
  changes (balance, owner, delegate, close authority):

  | Attempt signed by the claimer | Token-2022 error |
  |---|---|
  | `transfer_checked` of the whole vault to the attacker | `OwnerMismatch` (4) |
  | `burn_checked` of the whole vault | `OwnerMismatch` (4) |
  | `approve_checked` the attacker as delegate | `OwnerMismatch` (4) |
  | set the close authority to the attacker | `OwnerMismatch` (4) |
  | set the owner to the attacker | `OwnerMismatch` (4) |
  | close the vault | `NonNativeHasBalance` (11) |

- **Positive controls.** The same forged claimer signature moves 1,000 raw base out of the claimer's
  own base ATA (the key is effective where it has authority). A forged **vault authority** signature
  moves 1 raw out of the vault (why that key signs nothing but the redeem payout), and even it cannot
  re-own the vault (`ImmutableOwner`, 34). With verification back on, an unsigned PDA signer is
  rejected again.

### Account and argument validation (`instruction-errors.test.ts`)

Replaces the M1 monolithic `stockfloor-smoke.test.ts` (43 checks in one `it`).
- **Moved here with exact error names** (unique to the smoke test): exit fee 501 / 10,000 / 65,535 bps
  → `ExitFeeTooHigh` and 500 accepted; second `create_launch` → "already in use"; missing config
  signature → `AccountNotSigner`; foreign `fee_claimer` → `FeeClaimerMismatch`; redeem with amount 0 →
  `ZeroAmount`, the vault as payout → `ConstraintDuplicateMutableAccount`, a wrong vault →
  `ConstraintAddress`, SPYx as base mint → `BaseMintMismatch`, the DAMM v2 pool as DBC pool →
  `InvalidDbcPool`.
- **Deleted as covered elsewhere with exact amounts:** launch fields and `LaunchCreated` (lifecycle 3a),
  rogue-pool registration and double registration (3b, 3c), curve fee harvest amount and event (5b),
  harvests and redeem before completion or migration (5a, 6, 8a), the migration fee amount, flag and
  double harvest (8b, 8c), surplus flag and double harvest (8e), base donation burn and event (8f),
  LP fees (10, exact instead of "> 0"), floor view return data (3c, 11), redeem too large / dust /
  exact payout / event / floor increase (11), NFT account not owned (10), paused SPYx
  (issuer-controls test).
- **New in M2:**
  - `create_launch`: `fee_claimer` or `leftover_receiver` = the vault authority PDA or a wallet →
    `FeeClaimerMismatch` / `LeftoverReceiverMismatch`; claimer and vault authority swapped or taken
    from another config → `ConstraintSeeds` (or `MissingAccount` when the substituted vault ATA is not
    in the transaction); the vault at ATA(claimer, SPYx) → `MissingAccount`, or
    `ConstraintTokenOwner` once a third party created that ATA; an SPL mint that is not the config's
    quote mint → `QuoteMintMismatch`; a vault pre-created by a third party does not block the launch.
  - `register_pool` with cheatcode state DBC never produces: a live mint authority, a freeze
    authority, wrong decimals, a foreign `pool.config`, a Token-2022 pool type → the five specific
    errors, then registration succeeds.
  - `redeem`: 14 substitutions (vault, vault authority = claimer or another launch's, launch, base mint,
    pool, quote mint, quote token program, holder accounts) each fail with its exact error and
    nothing moves; then an exact redeem. `floor`: a foreign vault → `ConstraintAddress`, a wrong base
    mint → `FloorAccountMismatch`.

### Many tiny redemptions at 200 bps (`redeem-splits.test.ts`)

Every step asserts `gross = floor(V·a/S)`, `fee = ceil(gross·2%)`, `net = gross − fee` from the balances
and the event, the exact rational bound `net·S·10,000 ≤ V·a·9,800`, and a strictly rising floor
(FloorTracker). `V0 = 65,673,160`, `S0 = 999,999,999,999,997`.

| Scenario | Base burned | Paid (net) | Bounds |
|---|---|---|---|
| 200 equal redemptions of 454,647,307,743 raw by one holder | 90,929,461,548,600 | **5,857,466** (fees kept 119,647) | fee-free pro-rata 5,971,625; continuous `V0·(1 − ((S0−A)/S0)^0.98)` = 5,857,686.45 |
| One redemption of the same total on a replayed fork | 90,929,461,548,600 | 5,852,192 (fee 119,433) | the split receives 5,274 raw more: fee redistribution, below the continuous bound |
| 100 dust redemptions of the smallest amount with net ≥ 1 | 3,045,381,896 | 100 (gross 2, fee 1 each) | fee-free pro-rata 199; one raw base less → `NothingToRedeem`, nothing burned |
| 3 holders interleaved, 40 rounds each | 228,869,241,586,680 | 14,766,177 | joint fee-free pro-rata and continuous bound |

The replayed fork starts from identical `V0`, `S0` and holder balance (asserted).

### Property test on the fork (`floor-property.test.ts`)

fast-check 3.23, seed **20260915**, **40 runs**, 10–40 actions per run, **959 actions** in total. Each
run: a fresh fork, a graduated launch at 200 bps with the migration fee harvested, five holders (two
curve buyers, the completing buyer, two DAMM v2 traders who start with base). After every action the
FloorTracker checks floor monotonicity (cross-multiplication), vault outflow only through a redeem
with the exact net, `supply ==` the sum of all base accounts, an empty claimer base ATA and the vault
owner / delegate / close authority; an independent model of vault and supply must equal the chain,
and at the end `Launch.total_redeemed_quote` equals the model's sum of payouts.

| Action | Accepted | Rejected (reason, must change nothing) |
|---|---|---|
| redeem a fraction of a balance | 230 | 1 (`NothingToRedeem`) |
| redeem a raw amount (1–1e8) | 61 | 19 (`NothingToRedeem`) |
| SPYx donation to the vault | 70 | 0 |
| base donation to the claimer + `burn_claimer_base` in one transaction | 82 | 0 |
| `harvest_curve_fees` | 66 | 0 |
| `harvest_lp_fees` | 64 | 0 |
| `harvest_surplus` | 24 | 16 (`SurplusAlreadyHarvested`) |
| DAMM v2 buy | 143 | 0 |
| DAMM v2 sell | 103 | 2 (DAMM v2 `AmountIsZero`) |
| clock warp | 37 | 0 |
| ScaledUiAmount multiplier change (0.5–2) | 41 | 0 |

Redemptions paid 943,589,234 raw SPYx in total over the 40 runs.

### Extra DAMM v2 positions held by the claimer (`lp-positions.test.ts`)

- **A position transferred to the claimer.** A third party buys base, `create_position`s on the migrated
  pool, adds 10% of the pool's liquidity (264,112,208,587,901,912,672,710,665,860) and transfers the
  position NFT to ATA(claimer, NFT mint, Token-2022). After two trades, `harvest_lp_fees` pays exactly
  the DAMM v2 state formula for each position: **1,795,855** (migrated position) and **74,508**
  (transferred position), base 0. Mismatched NFT accounts → `PositionNftNotOwnedByClaimer`; the donor's
  own claim fails in DAMM v2 (`ConstraintRaw`, NFT amount 0); the donated liquidity stays in the pool.
- **An empty position** created directly with `owner = claimer` harvests exactly 0.
- **A second DAMM v2 pool with both-token fees** (`initialize_customizable_pool`, same mints, 1% fee,
  `collect_fee_mode = BothToken`, SPYx DAMM v2 token badge from the fixtures, first position NFT to the
  claimer). After a buy and a sell, one `harvest_lp_fees` moves **65,719** raw SPYx into the vault and
  burns **10,972,998,765** raw base in the same instruction: the supply and the pool's base vault drop by
  exactly that amount, the claimer base ATA ends at 0, and the floor strictly rises. This is the burn
  path of `harvest_lp_fees`, which the quote-only migrated pool never takes.

## Compute units

`compute-budget.test.ts` runs the lifecycle with an explicit `SetComputeUnitLimit` on every
transaction. For each one it measures the units by simulation, requires them to fit the limit, sends
the transaction with (measured − 1) and requires a compute-budget failure with no state change, then
sends it with the limit and requires the same units. Measured over six runs with random keys (bump
searches cause the spread):

| Transaction | Measured CU | Limit used |
|---|---|---|
| DBC `create_config` (SPYx + badge) | 31,482 | 50,000 |
| DBC `initialize_virtual_pool_with_spl_token` | 111,229–117,238 | 150,000 |
| stockfloor `create_launch` | 46,276–71,776 | 120,000 |
| stockfloor `register_pool` | 7,282 | 20,000 |
| DBC `swap2` curve buy | 35,468–35,485 | 60,000 |
| DBC `swap2` curve sell | 33,626 | 60,000 |
| stockfloor `harvest_curve_fees` (creates the claimer base ATA) | 68,203–72,703 | 100,000 |
| DBC `swap2` PartialFill completion | 38,317 | 60,000 |
| stockfloor `harvest_curve_fees` | 51,107–52,607 | 80,000 |
| DBC `migration_damm_v2` | 151,921–160,921 | 200,000 |
| stockfloor `harvest_migration_fee` | 37,384 | 60,000 |
| stockfloor `harvest_surplus` | 37,390 | 60,000 |
| stockfloor `burn_claimer_base` (empty) | 11,791–13,291 | 25,000 |
| SPL transfer + stockfloor `burn_claimer_base` | 13,733–15,233 | 30,000 |
| DAMM v2 `swap2` | 17,796–18,364 | 40,000 |
| stockfloor `harvest_lp_fees` | 53,356–54,856 | 100,000 |
| stockfloor `floor` (view) | 5,385 | 15,000 |
| stockfloor `redeem` | 25,977–25,978 | 40,000 |

Every transaction of the lifecycle fits 200,000 CU. `docs/research/surfpool.md` shows that LiteSVM and
a Surfpool surfnet with the mainnet token programs report identical units.

## Skipped or partial steps

- **Skipped:** none. Every step of BRIEF §8 in this file is green.
- **Surplus in the real flow is rounding-only** (1 raw, partner share 0), because DBC 0.2.1
  never lets a swap overshoot the migration price. The amount is tied to DBC's own surplus event;
  non-zero exactness is proven with cheatcode state only (a routing check).
- **DBC `withdraw_leftover` is never called.** `create_launch` rejects fixed-supply configs, and
  with dynamic supply DBC rejects `withdraw_leftover` (spike edge-case test) and burns the unsold
  base at migration. M2 removed the unreachable CPI; `burn_claimer_base` is covered by its burn of
  0, of a donation, and in the property test.
- **DAMM v2 per-swap fees** are not re-derived from the fee formula. LP claims are asserted exactly
  from DAMM v2 state and bounded by the swap events.
- **The fork is LiteSVM**, loaded with mainnet binaries and accounts, not a validator. Compute limits
  are now exercised (above); feature gates and live account drift are not. Surfpool results are in
  `docs/research/surfpool.md`.
- **A forged signature is not a malicious program.** The vault-authority test emulates the signer
  privilege an upgraded DBC or DAMM v2 would receive; it does not run a substitute program binary.
- **Not covered:** migration through a FixedBps DAMM v2 config (the keeper path).

## How to run

```
pnpm test                                    # scripts/test-all.sh: everything, with a summary
pnpm --filter @stockfloor/tests test         # fork tests only (needs target/deploy/*.so + target/idl/*.json)
cd tests && npx vitest run integration/c1-lifecycle.test.ts   # the C1 flow alone
```

`scripts/test-all.sh` runs these steps in order:
1. build `stockfloor` and `spike`;
2. `cargo test -p stockfloor`;
3. `tsc --noEmit` for the SDK and the fork tests package;
4. the SDK, fork and app test suites.

The SDK, fork and app packages are required: a missing package, test script or test files counts
as a failure unless `ALLOW_SKIP=1`. The script never runs the fork tests after a failed build. It
prints a summary and exits non-zero on any failure or skip.

`pnpm test` output on 2026-09-15 after M2:

```
==> cargo test -p stockfloor
test result: ok. 43 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.35s
==> @stockfloor/sdk tests
 Test Files  5 passed (5)
      Tests  93 passed (93)
==> @stockfloor/tests tests
 Test Files  13 passed (13)
      Tests  93 passed (93)
==> @stockfloor/app tests
 Test Files  8 passed (8)
      Tests  58 passed (58)

================================ test summary ================================
build program stockfloor         PASS     (1s)
build program spike              PASS     (0s)
cargo test -p stockfloor         PASS     (1s)
typecheck @stockfloor/sdk        PASS     (1s)
typecheck @stockfloor/tests      PASS     (1s)
@stockfloor/sdk tests            PASS     (1s)
@stockfloor/tests tests          PASS     (7s)
@stockfloor/app tests            PASS     (1s)
------------------------------------------------------------------------------
ALL STEPS PASSED (13s)
==============================================================================
```

The 93 fork tests break down as follows:
- 20 in the C1 lifecycle;
- 17 in the C1 adversarial suite;
- 11 M1 review regressions;
- 7 SDK preset and negative-code checks on the fork;
- 7 instruction-validation tests;
- 2 vault-authority tests;
- 3 split-redemption tests;
- 1 property test (40 runs);
- 3 LP-position tests;
- 1 compute-budget test;
- 21 spike tests in 3 files (15 lifecycle, 5 edge cases, 1 smoke).
