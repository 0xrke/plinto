# C1 evidence: the full StockFloor flow on a mainnet fork

Date: 2026-09-15. Result: **C1 passes.** The flow DBC config quoted in SPYx → pool → buys →
curve complete → migration → migration fee harvested into the vault PDA → redeem runs green on
a LiteSVM mainnet fork. It uses the **real `stockfloor` program**
(`target/deploy/stockfloor.so`, built by `bash scripts/build-programs.sh -p stockfloor`), not
the spike program.

The rest of BRIEF §8 (DAMM v2 trades, LP fee harvest, several redeemers, and invariants after
every step) is green too. **No step is skipped.** The integration did not expose any bug in
`programs/stockfloor` or `packages/sdk`, so neither was changed.

## Environment

| Item | Value |
|---|---|
| Fork | LiteSVM (node `litesvm` 1.4.1), harness in `tests/src/fork.ts` |
| Mainnet binaries | DBC `dbcij3…` (0.2.1 line), DAMM v2 `cpamdp…` (0.2.4), Token-2022, SPL Token, ATA, Token Metadata |
| Mainnet accounts | SPYx mint `XsoCS1…` (Token-2022, 8 decimals, Pausable, ScaledUiAmount, PermanentDelegate, TransferHook with null program); DBC token badge for SPYx `D2THzeQ…`; DBC pool authority `FhVo3…`; DAMM v2 pool authority; DAMM v2 Customizable config `A8gMrEP…` |
| Fixture dump | `tests/fixtures/manifest.json`, generated 2026-09-15T17:56:10.864Z from `https://api.mainnet-beta.solana.com`, **slots 447312190–447312193** |
| Fork clock | Starts at the dump time, so the SPYx `newMultiplier` 1.005714560286254 is in effect (effective since 2026-06-18) |
| Our program | `stockfloor` `98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA` at commit `f2986c8` (no program changes in this work) |
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
| `tests/integration/c1-adversarial.test.ts` | Adversarial scenarios that need their own setup (11 tests), plus a self-check of the invariant checker |
| `tests/integration/stockfloor-smoke.test.ts` | The program author's 43-check smoke test, moved here from `programs/stockfloor/fork-smoke/`. It uses the harness config builder with a 5 SPYx threshold |
| `tests/src/stockfloor.ts` | Instruction builders for all 9 stockfloor instructions (from `target/idl/stockfloor.json`), the Launch reader and the `floor` return-data decoder |
| `tests/src/floor-invariants.ts` | `FloorTracker`: checks the floor invariants around every step |
| `tests/src/stockfloor-scenario.ts` | Builds a launch through the SDK, with helpers to buy, complete and graduate |
| `tests/src/anchor.ts` | `parseCpiEvents`: decodes the `emit_cpi!` events that DBC and DAMM v2 put in inner instructions |

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

- **Config built by the SDK.** `buildDbcConfigParams(input, authority, authority)` produces the
  config, and the real DBC `create_config` accepts it with the SPYx token badge as remaining
  account 0.
- **Keys and PDAs.** `fee_claimer == leftover_receiver ==` the Authority PDA
  `["authority", config]`. The SDK PDAs (`authorityPda`, `launchPda`, `vaultAddress`,
  `dbcTokenBadgePda`) equal the harness derivations.
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
  Token-2022, vault address, `pool = default` and `migration_fee_harvested = false`. The
  vault is the Authority's SPYx ATA with a balance of 0. The `LaunchCreated` event carries
  pct 50 and threshold 131,346,320.
- **Adversarial `register_pool` (3b):**

  | Attempt | Result |
  |---|---|
  | Non-creator signs | `PoolCreatorMismatch` |
  | Rogue creator registers the rogue pool | `PoolCreatorMismatch` |
  | Launch creator registers the rogue pool | `PoolCreatorMismatch` |
  | Canonical pool with the rogue base mint | `BaseMintMismatch` |
  | Second registration after success (3c) | `PoolAlreadyRegistered` |

- **After registration.** The `floor` view returns `{vault 0, supply 1,000,000,000,000,001, bps 200}`.

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
- **Position.** The NFT account holds 1 NFT and is owned by the **Authority PDA**.
  - `permanent_locked_liquidity` equals the pool liquidity, with 0 unlocked and 0 vested.
  - No second position exists.
- **Supply:**
  - It falls from 1,000,000,000,000,001 to **999,999,999,999,996** (5 raw burned by DBC).
  - The DBC base vault keeps **626,783,023,439** = `protocol_migration_base_fee_amount`.
  - The DAMM v2 base vault holds 312,765,492,216,322.
  - The supply equals the sum of all base accounts.
  - The SDK preview supply exceeds the actual supply by 4 raw (asserted to be between 0 and 1,000).
- **Vault** unchanged at 481,750. The floor rises because supply fell.

### 8. Harvest the migration fee, surplus and leftover (`8a`–`8f`)

**8a.** `redeem` after migration but before the fee harvest fails with `MigrationFeeNotHarvested`.

**8b. `harvest_migration_fee`, the key C1 step.**
- **Expected amount:** `T − ceil(T × (100 − 50) / 100)` = 131,346,320 − 65,673,160 = **65,673,160**.
  This equals SDK `getMigrationFeeDistribution(...).partnerMigrationFee` and
  `previewLaunch(...).vaultAtGraduationQuoteRaw`.
- **Balances.** The vault goes from 481,750 to **66,154,910** (+65,673,160 exactly). The DBC
  quote vault drops by 65,673,160.
- **Flags and event.** DBC `migration_fee_withdraw_status` has the partner bit `0b100` set.
  `Launch.migration_fee_harvested = true`. The event shows `quote_amount` 65,673,160 and
  `vault_balance` 66,154,910. The cranker receives nothing.

**8c.** A second `harvest_migration_fee` fails with `MigrationFeeAlreadyHarvested`; the vault is unchanged.

**8d.** `harvest_curve_fees` again collects exactly the completing buy's partner fee, **490,326**.
The vault reaches **66,645,236**.

**8e. `harvest_surplus`.**
- **Expected amount:** `pc − floor(pc × 30%)` with `pc = floor(surplus × 80%)`. For a surplus of
  1 that is **0**, and the vault moves by exactly 0.
- **Flags.** DBC `is_partner_withdraw_surplus = 1` and `Launch.surplus_harvested = true`.
- **Repeat.** A second call fails with `SurplusAlreadyHarvested`.
- **Non-trivial surplus.** Covered with cheatcode state in the adversarial file (below).

**8f. `harvest_leftover` (supply effects).**
- **Nothing to burn.** With dynamic supply, DBC `withdraw_leftover` does not apply.
  `leftover_withdrawn = false`, `base_burned = 0`, supply unchanged, DBC
  `is_withdraw_leftover = 0`.
- **Donation.** bob sends **7,074,133,429,318** base to the Authority's base ATA with a plain
  SPL transfer (step kind "donation").
- **Burn.** `harvest_leftover` burns exactly 7,074,133,429,318. Supply falls from
  999,999,999,999,996 to **992,925,866,570,678**, the Authority base ATA returns to 0, and
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

- **Rejection.** A position NFT account not owned by the Authority fails with `PositionNftNotOwnedByAuthority`.
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

- **Floor view** before redeeming: `{vault 67,326,696, supply 992,925,866,570,678, bps 200}`.
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
   exists: DBC base vault, DAMM v2 base vault, all holders, and the Authority base ATA.
4. **The Authority holds no base tokens** after any instruction. The one exception is the
   explicit donation transfer, which the next `harvest_leftover` burns.
5. **The vault stays the Authority's SPYx account** (owner and mint).

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
- base tokens parked at the Authority.

## Adversarial tests added for C1

These are in addition to the inline checks in the lifecycle file.

**`c1-adversarial.test.ts` › a random signer cannot redirect any harvest.** The setup is two
launches on one fork. Launch 1 is graduated with DAMM v2 trades; launch 2 is live.

- **`harvest_curve_fees` substitutions:**

  | Substitution | Result |
  |---|---|
  | Vault → attacker SPYx ATA | `ConstraintAddress` |
  | Vault → launch 2's vault | `ConstraintAddress` |
  | Vault → a non-ATA SPYx account the attacker created with owner = Authority | `ConstraintAddress` |
  | Authority base account → attacker ATA | `ConstraintTokenOwner` |
  | Authority base account → a non-ATA account owned by the Authority | `AccountNotAssociatedTokenAccount` |
  | Pool → launch 2 | `InvalidDbcPool` |
  | Config → launch 2 | `InvalidDbcConfig` |
  | Launch → launch 2 | `ConstraintSeeds` |
  | Authority → launch 2's Authority | Runtime `MissingAccount` (see note) |

  **Note on the last row.** Anchor runs the `init_if_needed` ATA check before the authority
  seeds check. The ATA-create CPI then references ATA(other authority, base mint), which is not
  in the transaction; the logs confirm it. The attempt is still rejected atomically, just with
  a less descriptive error.
- **`harvest_migration_fee` and `harvest_surplus`:** the same vault, pool, launch and authority
  substitutions are rejected (authority → `ConstraintSeeds`). A foreign DBC quote vault gets
  DBC's `ConstraintHasOne`.
- **`harvest_leftover`:** attacker base ATA → `ConstraintTokenOwner`; non-ATA account →
  `AccountNotAssociatedTokenAccount`; foreign pool → `InvalidDbcPool`.
- **`harvest_lp_fees`:** vault substitutions and base-account substitutions are rejected, and
  an NFT account not owned by the Authority → `PositionNftNotOwnedByAuthority`.
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
  - leftover burn 0;
  - LP fees **331,403** (from the DAMM v2 state formula).

  The vault ends at exactly the sum. The attacker's SPYx and base balances are unchanged, and
  launch 2's vault stays 0.

**› harvest_migration_fee before migration does not open redemptions.**
- After completion, `harvest_migration_fee` puts exactly 65,673,160 into the vault, sets
  `migration_fee_harvested = true`, and DBC `is_migrated` is still 0.
- `redeem` fails with `MigrationNotComplete`.
- Migration still succeeds, with DAMM v2 token B = 65,541,814 (the same as the normal order).
  After it, `redeem` pays the exact net.

**› a second pool on the same config never feeds or drains the vault.** The rogue pool is
traded, completed and migrated; its DAMM v2 position NFT also belongs to the same Authority PDA.
- **Harvests on the rogue pool:** curve fees, migration fee, surplus and leftover all fail with
  `InvalidDbcPool`.
- **`harvest_lp_fees` on the rogue DAMM v2 pool:** `DammPoolMintMismatch` with the launch base
  mint, and `BaseMintMismatch` with the rogue base mint.
- **Redeeming rogue base tokens:** `InvalidDbcPool` when passing the rogue pool, and
  `BaseMintMismatch` when passing the launch pool.
- **End state.** The vault stays 0, `Launch.pool` stays canonical and `total_harvested_quote` = 0.

**› C1 edge: `harvest_surplus` with a non-trivial surplus (cheatcode).**
- **Setup.** After migration, DBC `quote_reserve` (VirtualPool offset 240) and the DBC quote
  vault are both raised by 12,345,678. This emulates an overshooting buy, which DBC 0.2.1
  swaps cannot produce.
- **Expected amount.** For a surplus of 12,345,678: `pc = floor(12,345,678 × 80%)` = 9,876,542,
  so the partner share = 9,876,542 − floor(9,876,542 × 30%) = **6,913,580**.
- **Result.** The vault receives exactly 6,913,580, and the DBC quote vault drops by the same amount.

## Skipped or partial steps

- **Skipped:** none. Every step of BRIEF §8 in this file is green.
- **Surplus in the real flow is rounding-only** (1 raw, partner share 0), because DBC 0.2.1
  never lets a swap overshoot the migration price. Non-zero exactness is proven with cheatcode
  state only.
- **DBC `withdraw_leftover` is never called.** StockFloor configs use dynamic supply, where DBC
  rejects `withdraw_leftover` (spike edge-case test) and burns the unsold base at migration.
  `harvest_leftover` is covered by its burn of the Authority base balance (0, then a donation).
  The fixed-supply branch is untested.
- **DAMM v2 per-swap fees** are not re-derived from the fee formula. The LP claim is asserted
  exactly from DAMM v2 state and bounded by the swap events.
- **Out of scope here:** the remaining BRIEF §8 adversarial items. Paused SPYx is covered by the
  smoke test and the spike edge cases, and the multiplier change by the spike edge cases.
  Repeated tiny redemptions, donation to the vault, redeeming the entire supply, and the
  property test over random redeem sequences are not written yet.

## How to run

```
pnpm test                                    # scripts/test-all.sh: everything, with a summary
pnpm --filter @stockfloor/tests test         # fork tests only (needs target/deploy/*.so + target/idl/*.json)
cd tests && npx vitest run integration/c1-lifecycle.test.ts   # the C1 flow alone
```

`scripts/test-all.sh` runs these steps in order:
1. build `stockfloor` and `spike`;
2. `cargo test -p stockfloor`;
3. the SDK, fork and app test suites.

It skips a package only if it has no test files, and it never runs the fork tests after a failed
build. It prints a summary and exits non-zero on any failure; this was checked by replacing one
step with `false`, which gave exit 1.

`pnpm test` output on 2026-09-15, after forcing a rebuild of both programs:

```
==> cargo test -p stockfloor
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.37s
==> @stockfloor/sdk tests
 Test Files  5 passed (5)
      Tests  93 passed (93)
==> @stockfloor/tests tests
 Test Files  6 passed (6)
      Tests  54 passed (54)
==> @stockfloor/app tests
 Test Files  8 passed (8)
      Tests  58 passed (58)

================================ test summary ================================
build program stockfloor         PASS     (7s)
build program spike              PASS     (6s)
cargo test -p stockfloor         PASS     (3s)
@stockfloor/sdk tests            PASS     (1s)
@stockfloor/tests tests          PASS     (1s)
@stockfloor/app tests            PASS     (2s)
------------------------------------------------------------------------------
ALL STEPS PASSED (20s)
==============================================================================
```

The 54 fork tests break down as follows:
- 20 in the C1 lifecycle;
- 11 in the C1 adversarial suite;
- 1 smoke test (43 checks);
- 22 spike tests (3 files).
