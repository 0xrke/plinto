# M1 fork spike: PDA `fee_claimer` on a SPYx-quoted DBC pool

Date: 2026-09-15. Status: **green**, 22/22 tests passing locally (`pnpm --filter @stockfloor/tests test`).

## Verdict

A PDA of our own program works as the Meteora DBC partner `fee_claimer` and `leftover_receiver`
for a **SPYx-quoted** pool, on the **real mainnet binaries** of DBC, DAMM v2 and Token-2022 with the
**real SPYx mint and DBC token badge**. The spike program signs with `invoke_signed` and:

- claims the partner trading fee (DBC `claim_trading_fee`),
- withdraws the partner migration fee (DBC `withdraw_migration_fee`, `flag = 0`): exactly
  `threshold - ceil(threshold * (100 - pct) / 100)` = **250,000,000 raw SPYx** for a 5 SPYx threshold at 50%,
- withdraws the partner surplus (DBC `partner_withdraw_surplus`),
- claims DAMM v2 LP fees for the permanently locked position whose NFT the PDA owns (`claim_position_fee`).

No fallback (BRIEF §9 "thin forwarder") is needed. LiteSVM ran the whole flow; Surfpool was not needed.

## How to run

```bash
bash scripts/build-programs.sh -p spike          # builds target/deploy/spike.so and target/idl/spike.json
pnpm --filter @stockfloor/tests test             # vitest: tests/spike/*.test.ts (offline, ~1 s)
pnpm --filter @stockfloor/tests run fixtures     # optional: re-dump mainnet fixtures (read-only RPC)
```

## What was proven (test names)

File `tests/spike/lifecycle.test.ts`, suite *"M1 spike: SPYx-quoted DBC lifecycle with a PDA fee_claimer (LiteSVM fork)"*.
All steps run on one fork, in order:

| # | Test | Key assertions |
|---|---|---|
| 1 | creates a SPYx-quoted config whose fee_claimer and leftover_receiver are the spike PDA | `create_config` with the DBC token badge as remaining account 0; config fields read back (fee_claimer, leftover_receiver = PDA, 50% / 0% migration fee, 30% creator trading fee, 100% partner permanent lock, quote_token_flag = 1, dynamic supply); pool created; base mint authority revoked |
| 2 | processes several buys by different wallets and a sell | 3 buyers (1, 1.5, 0.8 SPYx), 1 sell; exact SPYx debits; fee split protocol 20% / creator 30% / partner 70%; `partner_base_fee = 0` (quote collect mode) |
| 3 | claims the partner trading fee via spike CPI (PDA signer) into the PDA SPYx ATA | PDA ATA delta == `pool.partner_quote_fee` == quote-vault delta; pool counter reset to 0; spike event decoded; fee payer is a random wallet (permissionless) |
| 4 | rejects a random signer claiming the partner trading fee directly from DBC | `Unauthorized` |
| 5 | rejects an exact-in buy that crosses the migration price (DBC 0.2.1 behavior) | `InsufficientLiquidity` |
| 6 | completes the curve with a partial-fill buy | `swap2` mode 1; unfilled input stays with the buyer; `quote_reserve >= threshold`; `migration_progress = LockedVesting`; next buy fails `PoolIsCompleted` |
| 7 | migrates to DAMM v2 (permissionless migration_damm_v2, Customizable config) | `is_migrated = 1`, `migration_progress = CreatedPool`; DAMM pool token A = base, token B = SPYx, `collect_fee_mode = 1` (OnlyB); `token_b_amount = 250,000,000 - 0.2%` = 249,500,000 |
| 8 | withdraws the partner migration fee via spike CPI into the PDA SPYx ATA (exact amount) | PDA ATA delta = quote-vault delta = **250,000,000**; `migration_fee_withdraw_status & 0b100` set; event amount matches |
| 9 | harvests the partner trading fee accrued by the completing buy after migration | pending partner fee from the final buy is still claimable after migration |
| 10 | rejects a random signer calling DBC withdraw_migration_fee(flag=0) directly | `NotPermitToDoThisAction` |
| 11 | rejects a second partner migration fee withdrawal | `MigrationFeeHasBeenWithdraw` |
| 12 | rejects routing a spike harvest into a token account not owned by the PDA | `ConstraintTokenOwner` (spike account constraint) |
| 13 | withdraws the partner surplus via spike CPI (80% x (100 - 30)% of surplus; rounding-only here) | surplus = 1 raw, partner share 0; `is_partner_withdraw_surplus = 1` |
| 14 | records DAMM v2 position ownership and the post-migration base supply | first position NFT account owner == PDA; `permanent_locked_liquidity > 0`, unlocked = vested = 0; **no second position**; `buyers + DAMM vault + DBC vault == mint.supply`; supply dropped (unsold buffer burned) |
| 15 | stretch: claims DAMM v2 LP fees for the PDA-owned position via spike CPI | DAMM v2 swaps generate fees; attacker direct `claim_position_fee` fails (`InvalidAuthority`); spike CPI pays the PDA quote ATA, base delta 0 |

File `tests/spike/edge-cases.test.ts`, suite *"M1 spike edge cases (LiteSVM fork)"*:

| Test | Result |
|---|---|
| partner migration fee can be withdrawn before migration; migration still succeeds with identical DAMM v2 reserves | fails `NotPermitToDoThisAction` before completion; after completion the PDA receives 250,000,000; migration afterwards deposits the same 249,500,000 quote |
| paused SPYx: curve trades and the PDA harvest fail atomically; after unpause the harvest succeeds | Token-2022 `MintPaused` (custom error 67 / 0x43, log "Transferring, minting, and burning is paused on this mint") bubbles up through DBC and the spike; withdraw status bits unchanged; migration also fails while paused; after unpause both succeed |
| ScaledUiAmount multiplier change mid-lifecycle leaves raw amounts unchanged | multiplier set to 2.5 and a scheduled change to 3.0; all raw balances and the 250,000,000 fee unchanged |
| anyone can create a second pool on the same DBC config (fee claimer PDA is shared) | a stranger creates a second pool on our config |
| withdraw_leftover is rejected for dynamic-supply configs | `NotPermitToDoThisAction`; nothing to harvest |

`tests/spike/smoke.test.ts` checks fixture loading and a SPYx ATA created through the real ATA program (extensions ImmutableOwner, PausableAccount, TransferHookAccount; 179 bytes).

### Numbers from the run

Config: threshold 5 SPYx (500,000,000 raw), base 6 decimals, gentle 2-segment curve (price ratio 1.2 per segment),
fee 1%, migration fee 50% (creator 0%), creator trading fee 30%, DAMM v2 Customizable 1% fee, quote-only LP fees.

| Item | Value (raw) |
|---|---|
| initial base supply minted by DBC (swap amount + 25% buffer + migration base) | 1,341,284,999,085,676 |
| `swap_base_amount` / `migration_base_threshold` | 785,655,948,971,039 / 359,215,062,871,878 |
| partner / creator / protocol trading fee before first claim | 2,151,526 / 922,082 / 768,402 |
| completing partial-fill buy: offered / spent | 249,775,987 / 229,798,969 |
| quote reserve at completion | 500,000,001 (surplus 1) |
| partner migration fee to PDA | **250,000,000** |
| DAMM v2 reserves after migration: base / quote | 358,496,632,746,134 / 249,500,000 |
| post-migration base supply | 1,144,871,011,842,915 = buyers 785,655,948,971,038 + DAMM 358,496,632,746,134 + DBC vault 718,430,125,743 |
| quote left in the DBC vault after all partner harvests | 3,201,600 = creator fees + protocol fees + 0.2% protocol migration quote fee |
| compute units: migration / withdraw fee / claim trading fee / claim LP fee | ~158k / ~31k / ~40k / ~43k |

## Fork approach

**LiteSVM** (node `litesvm` 1.4.1) loaded with mainnet ELFs and accounts dumped by `tests/fixtures/dump.ts`.
Every program ran unmodified (no syscall or feature incompatibilities). Why LiteSVM over Surfpool:
offline, deterministic, sub-second runs, trivial cheatcodes (`setAccount`), no network in CI.
Surfpool stays the tool for interactive app/script runs against a live mainnet fork; the dumped account
JSON files use the solana-test-validator format, so they can be passed to Surfpool / test-validator too.

## Fixtures (`tests/fixtures/`, 6.6 MB, committed)

Dumped 2026-09-15T17:56Z, mainnet slots 447,312,190–447,312,193. Details and sha256 in `manifest.json`.

| File | Address | Purpose |
|---|---|---|
| `programs/dynamic_bonding_curve.so` | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | DBC (programdata minus 45-byte header) |
| `programs/cp_amm.so` | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | DAMM v2 |
| `programs/spl_token_2022.so` | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Token-2022 (Pausable, ScaledUiAmount) |
| `programs/spl_token.so` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | SPL Token (base token) |
| `programs/spl_associated_token_account.so` | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | ATA program |
| `programs/mpl_token_metadata.so` | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | Metaplex metadata (DBC SPL pool init CPI) |
| `accounts/spyx_mint.json` | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | SPYx mint |
| `accounts/dbc_token_badge_spyx.json` | `D2THzeQLHaDeKBzzmTNuWEWw23WPM8vVhLvUmSPEpNeL` | DBC token badge `["token_badge", SPYx]` |
| `accounts/damm_v2_token_badge_spyx.json` | `CzLLYiZcDXavJoS6wp9sgMU599qYWj2zPEh58fj9k1AK` | DAMM v2 token badge (not needed: migration configs skip mint validation) |
| `accounts/dbc_pool_authority.json` | `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM` | DBC pool authority, 58 SOL: **required** for migration flash rent |
| `accounts/damm_v2_pool_authority.json` | `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC` | DAMM v2 pool authority (fidelity) |
| `accounts/damm_v2_config_customizable.json` | `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` | DAMM v2 config for `MigrationFeeOption::Customizable` (6) |
| `accounts/damm_v2_config_fixed_bps100.json` | `Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp` | DAMM v2 config for `FixedBps100` (2) |

Not needed for this config: Locker program (only with locked vesting), DAMM v1 / dynamic vault (deprecated).

## Harness (`tests/src/`)

- `fork.ts`: `Fork.create({ spike?, stockfloor?, extraPrograms?, unixTimestamp? })` loads all fixtures plus
  `target/deploy/{spike,stockfloor}.so`. `send / sendTx / sendExpectFail(ixs, signers, { computeUnits })`
  (web3.js v1 legacy tx, 1.4M CU budget by default, blockhash expired after every tx, tx history off),
  `getAccount / setAccount / patchAccount`, `newWallet(sol)`, `airdrop`, `now / setUnixTimestamp / warp(seconds)`,
  `anchorErrorFromLogs(logs)`.
- `token.ts`: `createAta` (through the real ATA program), `tokenAmount`, `mintSupply`, `mintAuthority`,
  `tokenAccountOwner`, cheatcodes `setTokenAmount`, `setMintSupply`, `cheatMintTo`, `fundSpyx`,
  `setMintPaused / isMintPaused`, `setScaledUiMultiplier / getScaledUiAmount / effectiveMultiplier`, `findExtension`.
- `anchor.ts`: offline Anchor 0.31 `Program`s (`dbcProgram()`, `dammProgram()`, `targetProgram(name)`),
  `fetchAnchorAccount`, `parseEvents`.
- `dbc.ts`: PDAs, enums, curve math (`gentleCurve`, `deltaBase/Quote`, `migrationFeeSplit`),
  `stockfloorConfigParameters(opts)`, instruction builders (`createConfigIx`, `initializeVirtualPoolWithSplTokenIx`,
  `swap2Ix`, `claimTradingFeeIx`, `withdrawMigrationFeeIx`, `migrationDammV2Ix`, `withdrawLeftoverIx`),
  readers (`fetchPoolConfig`, `fetchVirtualPool`).
- `damm.ts`: PDAs, `dammSwap2Ix`, `claimPositionFeeIx`, `fetchDammPool`, `fetchPosition`.
- `scenario.ts`: `createLaunch(fork, { feeClaimer, ... })`, `fundedWallet`, `buyOnCurve`, `sellOnCurve`,
  `completeCurve`, `migrateToDammV2` (returns position / NFT / vault keys and `dammKeys`).
- `spike.ts`: `deriveAuthority(config, programId)` and spike instruction builders.

For stockfloor: `createLaunch(fork, { feeClaimer: deriveAuthority(config, STOCKFLOOR_PROGRAM_ID), configKeypair })`.

## CPI account lists (as used by the spike)

PDA signer: `["authority", dbc_config]` under the calling program.

**DBC `withdraw_migration_fee(flag: u8 = 0)`** (discriminator `[237,142,45,23,129,6,222,162]`):
`pool_authority` (FhVo3…, ro), `config` (ro), `virtual_pool` (w), `token_quote_account` (w, any SPYx token account; we use the PDA ATA),
`quote_vault` (w), `quote_mint` (ro), `sender` (signer = PDA), `token_quote_program` (Token-2022), `event_authority` (DBC `__event_authority`), `program` (DBC).

**DBC `claim_trading_fee(max_amount_a: u64, max_amount_b: u64)`**: `pool_authority`, `config`, `pool` (w),
`token_a_account` (w, base token account; must be a valid token account even when base fees are 0),
`token_b_account` (w, quote), `base_vault` (w), `quote_vault` (w), `base_mint`, `quote_mint`, `fee_claimer` (signer = PDA),
`token_base_program` (SPL Token), `token_quote_program` (Token-2022), `event_authority`, `program`.

**DBC `partner_withdraw_surplus()`**: same as `withdraw_migration_fee` with `fee_claimer` in place of `sender`.

**DAMM v2 `claim_position_fee()`**: `pool_authority` (HLnpSz…), `pool`, `position` (w), `token_a_account` (w, base),
`token_b_account` (w, SPYx), `token_a_vault` (w), `token_b_vault` (w), `token_a_mint`, `token_b_mint`,
`position_nft_account` (PDA `["position_nft_account", nft_mint]`, owner = our PDA), `signer` (PDA),
`token_a_program`, `token_b_program`, `event_authority`, `program`.

**DBC `migration_damm_v2()`** (permissionless): `virtual_pool` (w), `migration_metadata` (deprecated, unused; PDA `["damm_v2", pool]`),
`config`, `pool_authority` (w), `pool` (DAMM PDA `["pool", damm_config, max(mintA,mintB), min(...)]`, w),
`first_position_nft_mint` (signer, w), `first_position_nft_account` (w), `first_position` (w),
`second_position_nft_mint` (signer, w), `second_position_nft_account` (w), `second_position` (w),
`damm_pool_authority`, `amm_program`, `base_mint` (w), `quote_mint` (w), `token_a_vault` (w), `token_b_vault` (w),
`base_vault` (w), `quote_vault` (w), `payer` (signer, w), `token_base_program`, `token_quote_program`, `token_2022_program`,
`damm_event_authority`, `system_program`; remaining account 0 = DAMM v2 config (`A8gMrE…` for Customizable). Fits a legacy tx with 3 signers.

## Gotchas

1. **DBC pool authority must hold lamports.** `migration_damm_v2` makes the DBC pool authority the DAMM payer inside
   `flash_rent`, and the `payer` reimburses it afterwards. On an empty fork the system program fails with
   "Transfer: insufficient lamports 0". The fixture now includes the mainnet account (58 SOL).
2. **Exact-in buys cannot cross the migration price** in DBC 0.2.1 (`calculate_quote_to_base_from_amount_in(..., migration_sqrt_price)`,
   then `InsufficientLiquidity`). The final buy must use `swap2` with `swap_mode = 1` (PartialFill), or be sized exactly.
   As a result, surplus is rounding dust (1 raw here) and the partner surplus rounds to 0.
3. **Partner trading fees keep accruing until the curve completes.** The completing buy adds fees after any earlier claim,
   so the crank must harvest trading fees again after completion (test 9).
4. `migration_fee_withdraw_status` masks: partner = `0b100`, creator = `0b010` (not bit 0).
5. `withdraw_migration_fee` and `partner_withdraw_surplus` need only a **complete curve**, not a migrated pool.
6. **Anchor build quirk:** `anchor build -p spike` generated a random `programs/spike/target/deploy/spike-keypair.json`
   and then failed with "Program ID mismatch". Copying `keys/spike-program.json` to that path fixed it
   (`programs/stockfloor/target/deploy/` exists as well). Suggested change (not made; `scripts/` is not owned by this agent):
   `scripts/build-programs.sh` should also copy each keypair into `programs/<p>/target/deploy/<p>-keypair.json`.
7. **`declare_program!` with the DBC and DAMM v2 IDLs compiles on Anchor 1.0.2** but needs
   `bytemuck = { version = "1.21", features = ["derive", "min_const_generics"] }` in the program's Cargo.toml.
8. **LiteSVM node 1.x uses `@solana/kit` types.** The harness sends web3.js v1 bytes through the private
   `svm.inner.sendLegacyTransaction`; kit `Address` values are plain base58 strings. This depends on litesvm 1.4.1 internals.
   Transaction history is disabled so identical transactions do not collide, and the blockhash is expired after every send.
9. **Anchor 0.31 coder**: `coder.accounts.decode` needs camelCase account names (`virtualPool`, `poolConfig`);
   the DBC `VirtualPool` account wraps a single `pool_state` field. Optional accounts are passed as `null`.
10. SPYx token accounts created by the ATA program are 179 bytes (ImmutableOwner, PausableAccount, TransferHookAccount).
    Balance cheatcodes only patch bytes 64..72; `cheatMintTo` also bumps mint supply to keep totals consistent.
11. The fork clock starts at the fixture dump time (`manifest.generatedAt`), not 0, so DBC timestamp activation
    and vesting validation behave as on mainnet.
12. DBC `claim_trading_fee` does not constrain `token_a_account`'s mint or owner; with quote-only fees any valid token account works,
    but the spike (and stockfloor) should require PDA-owned accounts.

## Impact on the stockfloor design

- **Confirmed:** `Authority = ["authority", config]` as DBC `fee_claimer` / `leftover_receiver` and as owner of the DAMM v2
  position NFT; vault = the PDA's SPYx ATA (created permissionlessly via the ATA program before the first harvest).
- **Harvest accounting:** measure `vault.amount` before and after each CPI (the spike does this); DBC's return value is not exposed.
- **`redeem` gate:** `harvest_migration_fee` can succeed before migration, so gate `redeem` on
  `virtual_pool.migration_progress == 3` (or `is_migrated == 1`) **and** the program's own `migration_fee_harvested` flag.
- **`harvest_curve_fees` must also run after completion/migration** to sweep fees from the completing buy.
- **`harvest_surplus` yields ~0** in DBC 0.2.1 (buys stop at the migration price). Keep it for completeness, but it is not a floor source.
- **`harvest_leftover` is unnecessary for dynamic supply:** DBC burns the unsold buffer at migration, and `withdraw_leftover` rejects
  non-fixed configs.
- **LP fees are quote-only** with migrated `collect_fee_mode = 0` (DAMM v2 OnlyB); `harvest_lp_fees` gets base = 0 and needs no burn path
  for this config. Only one position exists (partner, 100% permanently locked, owned by the PDA); no creator position was created.
- **`mint.supply` after migration includes** base tokens held in the DAMM v2 pool and the 0.2% protocol migration base fee left in the
  DBC base vault. The floor `vault / supply` is therefore conservative (lower than vault / circulating).
- **Paused quote mint:** every harvest and migration fails atomically with Token-2022 error 67 (`MintPaused`); no state changes,
  and retries succeed after unpause. Surface a clear "quote asset paused" error in the crank/UI.
- **Second pool on our config:** anyone can create one. `register_pool` must pin the canonical pool, and every harvest CPI must be
  restricted to it. Only our program can move a second pool's partner fees, because DBC requires the PDA signature.
- **Migration UX:** the last buyer needs PartialFill (or an exact-size buy); the crank/UI should switch to mode 1 near the threshold.
