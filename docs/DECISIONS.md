# Decisions

Format: date — decision · alternatives · reason.

## 2026-09-15 — M0

- **Repo layout.** Anchor workspace at the root (`programs/*`), pnpm workspace with `packages/sdk` (TS SDK + scripts), `tests` (integration tests), `app` (Next.js). · Separate repos · One command builds and tests everything.
- **Keypairs.** All keypairs live in `keys/` (gitignored): `stockfloor-program.json`, `spike-program.json`, `deployer.json`. `scripts/build-programs.sh` copies program keypairs into `target/deploy/` before `anchor build`. `Anchor.toml` wallet = `keys/deployer.json`. · Anchor default `~/.config/solana/id.json` · Hard rule: never use user wallets.
- **Program IDs.** stockfloor = `98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA`, spike = `JDizjXTevp3bsexc4cxHbNPjMgXPhMewwkY34JnZSQFh`. Deployer (mainnet, unfunded) = `BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV`.
- **Toolchain.** Anchor 1.0.2 (Rust 1.89.0 pinned by its template, platform-tools v1.54), Surfpool 1.5.0 installed to `~/.local/bin` from the GitHub release tarball (no sudo).
- **DAMM v2 program id verified:** `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (cp-amm-sdk 1.4.8 constant and IDL `address`).
- **IDLs.** `idls/dynamic_bonding_curve.json` (DBC 0.2.1, from dynamic-bonding-curve-sdk repo, synced with release 0.2.1) and `idls/cp_amm.json` (DAMM v2 0.2.4, identical instruction set to the DBC repo's `idls/damm_v2.json`).
- **Reference sources** are cloned (gitignored) into `vendor/`: `dbc` at 0.2.1 commit `f552f20`, `damm-v2` (HEAD, release 0.2.4), `dbc-sdk` (HEAD, synced with 0.2.1).
- **TS stack.** `@solana/web3.js` v1 + `@coral-xyz/anchor` 0.31.1 everywhere, matching the Meteora SDKs (`@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12, `@meteora-ag/cp-amm-sdk` 1.4.8). · `@solana/kit` / `@anchor-lang/core` 1.x · Avoid two web3 stacks and adapter code; the Meteora SDKs are web3.js v1.
- **Test harness (tentative, validated by M1).** Integration tests run on **LiteSVM** (node `litesvm` 1.4.1) loaded with mainnet programs and accounts dumped into `tests/fixtures/` by a script: deterministic, offline, fast, trivial cheatcodes (`setAccount` for paused / multiplier flips, clock warp). **Surfpool** is used for interactive local runs of the web app and scripts against a live mainnet fork. · Surfpool-only tests · Network-dependent tests are slow and flaky; a one-command offline test suite is a hard requirement.
- **Web app stack.** Next.js 16 + React 19 + Tailwind 4 + `@solana/wallet-adapter-react` with wallet-standard auto-detection (Phantom), no `wallet-adapter-wallets` bundle. · framework-kit (`@solana/react-hooks`) · Brief asks for wallet adapter; Meteora SDKs are web3.js v1.

## 2026-09-15 — Design notes before M1/M2

- **`register_pool` requires the launch creator's signature** and checks `pool.creator == launch.creator` and `pool.config == config`. · Permissionless first-pool-wins · DBC 0.2.1 has no pool-creator restriction on configs (`initialize_virtual_pool_with_spl_token` accepts any config), so a third party could front-run pool creation between the config transaction and the pool transaction and get their pool registered.
- **Supply model.** Keep DBC dynamic supply: DBC mints the initial base supply (swap amount with buffer + migration base amount) into the base vault at pool creation, and burns the leftover at migration (`get_burnable_amount_post_migration` is unbounded when supply is not fixed). After migration `mint.supply` = tokens sold on the curve + tokens migrated into DAMM v2, which is the denominator of the floor. · Fixed supply with `leftover_receiver` burn · Fewer moving parts; to be confirmed by the fact verifier and the spike.
- **"Many tiny redemptions" invariant, restated.** With `exit_fee_bps > 0`, splitting a redemption into many small ones legitimately yields slightly more in total than one large redemption, because each retained fee raises the floor for the remaining tokens, including the redeemer's. This is fee redistribution, not a rounding leak. Tested properties: (a) with a 0 fee, no split beats a single redemption; (b) every step pays at most the exact pro-rata amount minus the fee; (c) any split is bounded by the continuous limit `V·(1 − ((S−A)/S)^(1−f))`; (d) the floor never decreases. · Literal "tiny ≤ one large" for all fees · The literal version is false for any non-zero exit fee.
- **`redeem` rejects `net == 0`,** so users never burn tokens for nothing. · Allow zero-payout burns · A zero-payout burn is always a user mistake.

## 2026-09-15 — M1 results and C1 review fixes

- **Fork harness confirmed: LiteSVM + mainnet fixtures** (`tests/fixtures`, 6.6 MB, dumped at slots 447312190–447312193 by `tests/fixtures/dump.ts`). DBC, DAMM v2, Token-2022, SPL Token, ATA and Token Metadata ELFs are byte-identical to mainnet (sha256 re-checked by the evidence reviewer). The DBC pool authority account (58 SOL) is a fixture because `migration_damm_v2` pays DAMM rent from it inside `flash_rent`. · Surfpool · Everything ran unmodified on LiteSVM; the suite runs offline in seconds. A Surfpool run against live state with realistic CU limits is still planned before C2.
- **A PDA partner `fee_claimer` works** for `withdraw_migration_fee(flag=0)`, `claim_trading_fee`, `partner_withdraw_surplus` and DAMM v2 `claim_position_fee` via `invoke_signed` (spike + stockfloor fork tests). The fact check also found a mainnet precedent for a PDA partner fee claimer: program `BLANKpBQ5HG9UFjesxEgf4Yd2Tkj8K9e9tGZ5RYkYwGt` CPIs DBC `claim_trading_fee` (tx `3cFBTt64…xSG9QKZ`).
- **Dynamic supply only; fixed supply is rejected on-chain** (`FixedTokenSupplyNotAllowed`). DBC's `withdraw_leftover` rejects dynamic-supply configs and burns the unsold buffer at migration. With fixed supply the leftover would stay inside `mint.supply` after redeem opens. · Support fixed supply with a leftover gate · No product need; simpler.
- **Migrated DAMM v2 pool: Customizable option (6), flat 1% fee, quote-only fee collection (OnlyB)**, so LP fees never produce base tokens. · Static FixedBps100 config · That config has the dynamic fee on.
- **The final curve buy uses `swap2` with PartialFill.** DBC 0.2.1 rejects an exact-in buy that crosses the migration price. As a result the surplus is only rounding dust in practice.
- **Supersedes the M1-morning `register_pool` decision:** `create_launch` commits the base mint (a client-generated keypair that only its holder can use to create the DBC pool) and requires the DBC config keypair as a signer. `register_pool` is permissionless and requires `pool.config == config` and `pool.base_mint == launch.base_mint`. · Creator must sign `register_pool` · With the creator signature, a creator could withhold registration and strand the migration fee in DBC. The committed mint prevents both the rogue first pool and the withholding.
- **`create_launch` enforces the StockFloor shape on-chain,** not only in the UI: creator trading share ≤ 30%, fee scheduler base fee with cliff ≤ 20%, no dynamic fee, migrated collect-fee mode = quote, token update authority Immutable, pool creation fee 0, dynamic supply, 100% partner permanent-locked liquidity, no vesting, migration fee 30–99%, creator migration fee 0, exit fee ≤ 500 bps. · UI-only validation · A Launch PDA marks a StockFloor launch, so it must mean something. The quote allowlist stays UI-level (per the brief).
- **`Launch.migrated` latch.** It is set once DBC migration is observed (by a harvest or the first redeem). Afterwards `redeem` never decodes DBC state, so a future DBC account-layout upgrade cannot brick redemptions once our upgrade authority is revoked. DBC/DAMM decoders check the owner, the discriminator and a minimum length. · Decode the DBC pool on every redeem · Liveness of redeem must not depend on an upgradeable external program.
- **Post-CPI vault integrity check (`VaultEncumbered`).** Every harvest that runs a CPI while the vault is writable fails if the vault afterwards has a delegate, a close authority, a foreign owner, CPI Guard or required memo. · Trust DBC/DAMM · Defense in depth against a compromised upgrade of an external program.
- **Pre-transfer checks for the quote mint:** a paused mint, an active transfer hook or a frozen vault gives a clear error (`QuoteMintPaused`, `QuoteMintTransferHookUnsupported`, …) and changes no state. Transfer hooks are unsupported in the MVP (fail cleanly, documented).
- **`floor` view returns `{vault_raw, supply, exit_fee_bps, floor_q64}`** as return data (34 bytes) and emits `FloorSnapshot`.
- **SDK curve presets:** one constant-liquidity segment from start price to `ratio ×` start (gentle 6/5, flat 101/100), liquidity `ceil((T<<128)/(s1−s0))`. The start price is solved so the supply at graduation is ≈1B tokens. Threshold raw = `ceil(usd × 10^dec / (usdPrice × multiplier))`, where Jupiter `usdPrice` is per UI token (verified live). A stale Jupiter multiplier is handled via `newMultiplier` + effective timestamp. `MIN_THRESHOLD_USD = 1`. · DBC SDK `buildCurve*` helpers · They assume fixed supply and add a segment up to max price.
- **Web app:** three-phase UI model (presale / graduating / graduated); Redeem opens only when graduated **and** the migration fee is harvested. Non-US self-attestation checkbox gates trade buttons. System font stack (offline builds).
- **Planned for M2: split the Authority into two PDAs.** A claimer PDA (`["authority", config]`, the DBC fee_claimer and LP NFT owner) signs external CPIs. A separate vault-authority PDA owns the vault and signs only `redeem` transfers. · Keep one PDA plus the post-CPI check · The vault owner should never sign into upgradeable third-party programs; cheapest to change now, before the SDK and app wire to chain.

## 2026-09-16 — M2–M5 (program hardening, SDK, app, docs, C2 rehearsal)

- **Two PDAs, implemented.** Claimer `["authority", config]` is the DBC `fee_claimer` / `leftover_receiver` and the DAMM v2 position NFT owner, and signs every external CPI. Vault authority `["vault_authority", config]` owns the vault and signs only the `transfer_checked` in `redeem`; it is not even an account of the harvest transactions. Verified on the fork: a forged claimer signature cannot transfer, burn, approve, re-authorize or close the vault. `Launch` is v2 (351 bytes, both bumps stored).
- **`burn_claimer_base` replaces `harvest_leftover`.** DBC `withdraw_leftover` is unreachable for dynamic-supply configs, so the instruction now only burns base tokens held by the claimer, with no DBC CPI. · Keep the dead CPI branch · Smaller account list, less to audit.
- **New `sync_migration` instruction.** The one-shot harvests can all run before `migration_damm_v2`, in which case nothing would ever latch `Launch.migrated` and every `redeem` would keep decoding the upgradeable DBC pool. A permissionless `sync_migration` latches it; the crank runs it after migration. · Reorder the crank only · The crank is permissionless, so the program must not depend on a particular order.
- **Transfer-hook support in `redeem` is deferred, not implemented.** If the SPYx issuer ever enables a transfer hook, harvests and redeem fail cleanly and the vault is frozen until a program upgrade forwards the hook accounts. Documented as a limitation and as an argument for keeping the upgrade authority for now. · Implement extra-account resolution now · It needs a hook test program and fixtures; the brief accepts clean failure for the MVP.
- **Surfpool never relays transactions to mainnet** — verified in the v1.5.0 source (`sendTransaction` only reaches the embedded LiteSVM; the remote client makes read-only calls) and cross-checked on mainnet after every run (rehearsal `20260915T215423Z`: none of its 969 local signatures or 40 created accounts exist there; the later runs re-checked 986, 988 and 503 signatures with the same result). Local Surfpool runs are therefore safe under the "no mainnet transactions" rule. Note: the release binary makes one read-only version check to `cloud.txtx.run` at startup.
- **Mainnet send guard (SDK + CLI + app).** A send is refused unless the RPC is loopback; a loopback RPC that reports the mainnet genesis hash must also answer as a Surfpool surfnet. Overriding requires BOTH `--allow-mainnet` and `STOCKFLOOR_ALLOW_MAINNET=1` (in the app: `NEXT_PUBLIC_ALLOW_MAINNET=1` plus the same env var, both build-time). Reserved for C2 with the user's approval.
- **CLI launch sessions.** `create-launch` writes `keys/launches/<config>.json` (0600, gitignored) with the input and both generated secret keys *before* the first transaction, so a partial launch can be resumed instead of being orphaned.
- **Priority fee 100,000 µlamports/CU** on every mainnet transaction (app and CLI), 0 on local forks. Measured against recent mainnet samples in the rehearsal.
- **C2 demo threshold: $50 in SPYx** (~$53 of buys), so the whole demo is cheap while the flow stays identical to the $1,000 default. $25 and $100 also pass validation.
- **Fresh clone runs the tests.** `keys/` is gitignored, and Anchor needs the program keypair only for its program-id check, so `build-programs.sh` falls back to `--ignore-keys` and produces the same `.so` and IDL. · Commit a dev keypair · Judges must be able to clone and run `pnpm test`.

## 2026-09-16 — review pass (security findings, judge-lens findings)

### Program and SDK

- **`create_launch` rejects a migration threshold whose partner migration fee rounds to zero**
  (`MigrationQuoteThresholdTooSmall`, appended to the error enum so no existing Anchor code shifts). DBC only
  requires `migration_quote_threshold > 0`, and its rounding (`quote_amount = ceil(T × (100 − pct) / 100)`,
  `fee = T − quote_amount`) pays the partner 0 for a dust threshold — e.g. any `T ≤ 3` at `pct = 30`. Such a
  launch would reach the `redeemable` phase with a provably empty vault while carrying a `Launch` PDA, which is
  the one marker the design asks integrators to trust. · A minimum expressed in quote raw units or in USD ·
  A fiat minimum needs a price oracle, which the program deliberately does not have, and a raw minimum is a
  price-dependent policy. "Not provably empty" is the strongest statement the program can make on its own; the
  $1 minimum raise stays SDK/UI policy and README now says so. Covered by a Rust unit test over the whole
  accepted percentage range and by a fork test that shows DBC accepting `T = 1` where StockFloor refuses it.
- **Dust minimums for the two remaining crank actions.** `harvest_curve_fees` now needs `minCurveFeeQuote`
  (default: the same 0.00001-quote threshold as the LP harvest, 1,000 raw for 8-decimal xStocks) and a
  standalone `burn_claimer_base` needs `minClaimerBaseBurn` (default: one whole base token). · Leave them at
  1 raw · The claimer base ATA is a derivable address and the DBC partner fee grows with any trade, so at 1 raw
  a `crank --loop` operator paid for one transaction per pass forever. A minimum does not make griefing
  impossible (a griefer sends exactly the minimum, and the cost ratio stays about 1:1), but dust stops
  scheduling transactions, and nothing is stranded: a real harvest burns the whole ATA anyway.

### C2 process

- **The deployer is funded with 5.05 SOL, not 2.70.** · Keep the headroom optional · `solana program deploy`
  verifies the deployed ELF only *after* the 2.57 SOL of rent is spent. If that `cmp` fails, the only
  non-destructive repair is an upgrade, which needs 2.3329 SOL available at once; funded with 2.70 the only way
  out would be the irreversible `solana program close`. `scripts/c2/preflight.ts` now requires the headroom by
  default (`--no-upgrade-headroom` opts out).
- **Two more assertions in the §9 block-0 pre-flight and in `preflight.ts`:** the program keypair really is
  `98NLryxeg…` (`build-programs.sh` falls back to `--ignore-keys` when `keys/` is missing, so nothing else
  enforces it at deploy time, and deploying at the wrong address strands the rent in a program whose every
  instruction fails with `DeclaredProgramIdMismatch`), and there is no stale deploy buffer on the cluster (a
  resumed `--buffer` would mix two ELFs).
- **The mainnet RPC URL never reaches a command line.** The deploy takes the endpoint from `--config` only
  (the redundant `--url "$MAINNET_RPC_URL"` is gone) and the CLI config file is `chmod 600`. · Keep `--url` ·
  §9 is meant to be run while recording; the Solana CLI does not redact, and a provider key in a published
  video cannot be taken back.

### Docs

- **The README status table states what exists instead of four TBDs.** Each row names the local-fork evidence
  and the report file, and says plainly that nothing is on mainnet. · Leave "TBD (C2)" until C2 happens ·
  A judge spends five minutes; "TBD" reads as a rehearsal for something that never happened, while the
  Surfpool report is real, dated, reproducible evidence. The rows become Solscan links the day C2 runs.
- **The headline claim is qualified everywhere it appears:** "while the vault holds SPYx and the program is
  unchanged, it cannot go to zero". · Keep the short version · The README's own risk table contradicted the
  unqualified sentence, and a reader who notices discounts the honest labelling everywhere else too.
- **`LICENSE` (MIT) added, matching the root `package.json`,** with `tests/fixtures/README.md` naming the
  upstream licences of the redistributed Meteora and SPL binaries. · Wait for the user's licence decision ·
  `package.json` already declares MIT, so the repository was making a claim its files did not back;
  without a LICENSE file the code is strictly all-rights-reserved on a hackathon that requires open-source
  disclosure. **If the owner wants a different licence, this file is the only thing to change.**
- **The market claim is backed by a committed, re-runnable scan**
  (`scripts/research/stock-quoted-dbc-configs.ts` → `docs/research/stock-quoted-dbc-configs.json`), and the
  README quotes that scan's numbers. · Keep the undocumented 2026-09-15 figures (1,118 / 1,058) · Meteora's
  judges can query their own program in a minute; the one claim they are best placed to test was the one with
  no method shown. The scan defines "a stock token" as a Token-2022 mint whose permanent delegate is the SPYx
  issuer authority, which is an on-chain property rather than a curated list.
- **The roadmap is three committed items with evidence, not a wish list.** · Keep the eight-item list ·
  A long list of unstarted ambitions reads as a toy; three items with an honest status reads as a plan.

## 2026-09-16 — app: graduation threshold on `/create`, frozen parameters, honest money labels

- **Threshold control shape: quick-pick buttons ($50 / $100 / $1,000 default / $10,000) plus an always-visible
  custom USD field** · a slider; a select with "Other…"; a plain number input · The demo needs one click for
  $50 and a judge needs to see it is a real parameter, not a preset list. The buttons write into the same
  field, so there is one source of truth, and `aria-pressed` makes the current choice testable.
- **Threshold validation runs the SDK's `previewLaunch` *and* `buildDbcConfigParams`** (the port of everything
  DBC's `create_config` checks) on every keystroke, on top of the `MIN_THRESHOLD_USD`/`THRESHOLD_MAX_USD`
  range · range check only; `previewLaunch` only; no client validation · `previewLaunch` alone does not cover
  the migration-base threshold, the u64 initial supply or `CurveCannotComplete`. The full port is what the
  chain enforces and costs 0.03 ms per keystroke, so the user learns at typing time, not at signing time.
- **`THRESHOLD_MAX_USD = $10,000,000` is an app bound, not a chain limit** · no maximum; a tighter $100,000 ·
  With no maximum one extra zero silently 10×s the raise, and the true chain limit (about 1e21 for SPYx) is
  not a usable guardrail. Documented as an app choice.
- **The parameter fieldsets freeze while a launch is in flight, after it succeeded and while a retry is
  pending** · reset the form on success; clear the retry handle on any edit · This was a real bug:
  `ChainLaunchActions.createLaunch` with a `resume` handle ignores its `input` argument and re-sends the
  transactions built from the original one, while the first-buy field and the live preview stayed editable —
  so the form promised a floor and a threshold that were not being launched.
- **The post-redemption floor is labelled "(never falls in SPYx)", not "(never lower)"** · drop the
  qualifier; show the floor in SPYx · The guarantee is real but only in the quote asset, and the figure shown
  is USD, which moves with the underlying.
- **The vault card rounds the floor per token *down*** (new `formatSignificantDown`) · leave `Intl`'s
  round-half-up · It is a quote-asset amount, so it falls under `format.ts`'s existing "never overstate a
  balance or payout" rule; `Intl` could show a floor above what the vault backs.
- **The $50 UI demo is a second end-to-end case in `app/e2e/render.e2e.tsx`, through to a redemption**, rather
  than a re-tuning of the existing $1,000 driver · re-tune `local-fork.e2e.ts`; assert only that the launch
  was created · The $1,000 driver's raw amounts and PartialFill assertions are tuned to that threshold, and
  the point is to prove the whole demo can be recorded from the UI — crank and redemption included.

## 2026-09-16 — C2 runbook and the gated mainnet run

- **The approval marker is a file the user creates by hand, `keys/c2-approved`** · a CLI flag only; an env
  var only · Agents never write `keys/` (it is gitignored and `run.sh` never touches it), and the file
  survives an orchestrator restart. `run.sh --mainnet` additionally requires `--allow-mainnet`,
  `STOCKFLOOR_ALLOW_MAINNET=1` and a GO preflight.
- **`scripts/c2/preflight.ts` is structurally read-only**: its JSON-RPC client has a method allowlist with no
  `sendTransaction`, no `requestAirdrop` and no `simulateTransaction`, and its `ChainReader.simulate()` throws
  · reuse the SDK `ConnectionSender` · The go/no-go tool must be impossible to turn into a sender by a later
  edit.
- **The dry run is the same script and the same command list as the mainnet run, switched only by
  `--mainnet`** · a separate rehearsal script · One code path means the prompts, guards, resume and report
  format are all verified before real funds move.
- **A dry run does not set `STOCKFLOOR_ALLOW_MAINNET` / `--allow-mainnet`** (guard mode `surfnet`, not
  `mainnet-override`) · replay the documented mainnet commands verbatim, as
  `scripts/e2e/replay-doc-commands.sh` does · Without the override the SDK guard accepts only a loopback
  Surfpool surfnet, so a mistyped RPC in a dry run cannot reach mainnet at all. The verbatim-override replay
  is still covered by `replay-doc-commands.sh`.
- **A DBC / DAMM v2 binary drift against `tests/fixtures/manifest.json` is a preflight NO-GO**, with
  `--accept-program-drift` as the conscious escape hatch · a plain warning · Every CU, fee and behaviour
  figure in the C2 evidence was measured against those exact binaries, so a silent Meteora upgrade
  invalidates the rehearsal. Both still matched mainnet on 2026-09-16.
- **Deploy verification compares the ELF prefix and requires the remainder to be zero** · compare the whole
  programdata hash · `--max-len` pads the programdata past the ELF, so a full-buffer hash never matches; this
  is what the doc's `cmp <(head -c … dump) so` does.
- **Run state, per-step logs and the Solana CLI config live in `target/c2/<run id>/` (gitignored); only the
  sanitized report goes to `scripts/c2/reports/`** · keep everything in `reports/` · The CLI config and raw
  logs can contain an RPC URL with an API key; the report has the RPC string redacted.
- **Demo amounts come from one price snapshot per run** (`scripts/e2e/plan.ts`, reused by the preflight via
  `--plan-file`) · recompute them inside `preflight.ts` · A single source of truth means the checked amounts
  are exactly the amounts the run sends, and the same snapshot is the baseline for the price-drift abort.

## 2026-09-16 — C2 script review fixes

- **`--allow-mainnet` goes only to the SDK commands that send.** Read-only commands accept the switch but never receive it, and a regression test parses `scripts/c2/run.sh`, rebuilds the exact mainnet argv and spawns every command so a flag the CLI does not declare cannot reach it again. · Declare the switch everywhere · The bug (`status` dying in its own parser after all 495 transactions had landed) was invisible to the dry run, because the flag is only added in mainnet mode.
- **An existing deploy buffer is compared with the local ELF, not treated as a blocker.** Same bytes → GO, and the deploy resumes into it; different bytes → NO-GO whose only remedy is `solana program close --buffers --keypair keys/deployer.json`. · NO-GO on any existing buffer · `solana program deploy` creates the buffer in its first transaction, so the old rule blocked exactly the recovery path the runbook prescribes.
- **A run and its report are bound to their mode.** `MODE` is persisted in the run state, a cross-mode resume is refused, `--resume latest` resolves by mtime within the current mode's prefix, and `report.ts` refuses to overwrite a report of a different mode. · Trust the operator to pass the right run id · `--resume latest` sorted alphabetically, and "dry" > "c2": a mainnet resume would have rewritten a committed dry-run report into a fake mainnet one, with Solscan links over local-fork signatures.
- **Any endpoint reporting `surfnet-version` is a surfnet, whatever its host.** · Consult it only for literal loopback addresses · A local surfnet reached as `http://localtest.me:48899` was classified as mainnet, which would have produced a "mainnet" report full of dead links. A dry run whose preflight cluster is not `surfnet` now aborts instead of continuing into an unguarded `solana program deploy`.
- **The price guard applies only to steps whose amounts derive from the price** (create-launch and the buys), and becomes a warning once the first buy has landed. · Guard every step · Redemption amounts come from chain state, so a Jupiter blip would have aborted the demo after the money moved but before the redemptions.
- **The approval marker authorises one run** (its hash is recorded in the run state), and an aborted step now collects the signatures it already sent before writing the report, because a confirmation timeout does not mean the transaction failed.

## 2026-09-16 — C2, the mainnet run

- **Demo launch parameters as rehearsed:** $50 threshold in SPYx, 50% vault share, 2% exit fee, gentle curve,
  priority fee 100,000 µlamports/CU. The run matched the rehearsal to the raw unit.
- **The token's name was not set and cannot be fixed.** `TOKEN_URI` was exported for the run, but `TOKEN_NAME` and
  `TOKEN_SYMBOL` kept `run.sh`'s defaults, so the mint carries `StockFloor Demo` / `SFDEMO` while the metadata JSON
  behind it describes "Harbor Roasters". StockFloor configs make metadata immutable and the URI is pinned to a
  commit, so both sides are frozen. · Launch a second token with matching branding · The on-chain name is honest and
  self-explanatory for a platform demo, and a second launch costs another ~$26–53 of real SPYx. Recorded in the
  README instead of hidden. **Lesson: `run.sh` should refuse to launch when `TOKEN_NAME`/`TOKEN_SYMBOL` are defaults
  while `TOKEN_URI` is set — the mismatch is unfixable after the fact.**
- **Stale reads from a load-balanced RPC are the norm, not an anomaly.** Four guards aborted correct mainnet runs
  after reading state that a lagging node had not caught up on (up to minutes behind). Every post-send verification
  now polls: `fund.ts` balances, the deploy's program-state check, the `launch-phase` guard, and the preflight's
  handling of steps a resumed run already completed. · Raise the commitment level · Polling is what actually matches
  the failure mode, and it costs only the retry window when something is genuinely wrong.
- **The preflight must model a resumed run,** not just a fresh one: a wallet whose spending step already landed no
  longer needs its balance (`--spyx-spent`, `--spent-roles`).

## 2026-09-24 — Visual style: the Pastel direction

- **The app takes the Pastel direction** chosen on the style canvas: a pink-lavender-sky wash, white cards,
  midnight `#0b0b24`, a teal-green floor `#16735c` (mint `#7fe0bf` on dark), a coral risk band, Outfit for display
  and Plus Jakarta Sans for UI. · The editorial and broadsheet directions · The founder found them too stiff for an
  audience that includes memecoin launchers; Pastel reads as friendly without being a casino.
- **Fonts are self-hosted** (`app/src/fonts`, OFL) through `next/font/local`. · Google Fonts via `next/font/google`
  · A build must never wait on a font host.
- **Token covers are built from the token's own logo:** the logo scaled up and blurred over a pastel tone picked
  from the symbol; a token without a logo gets the tone alone. · A second, creator-uploaded cover image · That needs
  a new metadata field, form input and storage a day before the deadline; the automatic cover works for every
  token, including ones already launched. An uploaded cover can replace it later.
- **"floor" in headlines sits on the brand underline** (a bar whose top edge rises to the right, like the mark).

## 2026-09-25 — Presale fees stay out of the vault until graduation (to implement)

- **The partner share of curve (presale) fees is not harvested into the vault before migration.** It stays
  claimable in the DBC pool and is harvested into the vault once the pool has migrated. · Harvest any time (the
  current behaviour of the crank; `harvest_curve_fees` is permissionless and callable before migration) · The
  founder wants the presale to read as a clean fundraise: the vault starts at graduation. Today, fees harvested from
  a presale that never graduates sit in the vault forever, because `redeem` only opens after migration. Not yet
  implemented: needs `harvest_curve_fees` to require migration (or the crank to skip it) plus tests. What to do with
  the fees of a presale that never graduates is still open.
- **Supersedes the entry above (same day, founder decision):** the presale fee is the DBC minimum, 0.25%, and the
  whole partner share (80% of the fee after Meteora's 20%) goes to the platform treasury, on successful and failed
  presales alike. The creator gets no share of presale fees and the vault gets nothing from the presale; the floor is
  funded at graduation. The platform also passes its referral account on UI swaps (Meteora's host fee, 4% of the
  fee). · Hold presale fees until graduation and put them into the vault · Most launches fail, so presale fees are
  real platform income; a creator share at 0.25% would be about $24 per successful raise and would reward churn.
  Needs: a platform treasury destination in `harvest_curve_fees` (today it pays the vault) and creator_trading_fee_
  percentage 0 in the preset.
- **Graduation split (founder decision, 2026-09-25):** of the raised threshold, 40% seeds the DAMM v2 pool, 50% goes
  to the vault, 5% to the platform treasury and 5% to the creator as a one-off success bonus at graduation. Founder
  share of the raise with vesting is dropped for now. · 3% or 0% platform; 0% or 2% creator bonus; Star-style vested
  founder budget · The flat curve removes the creator's usual early-buyer profit, so a paid-on-success bonus replaces
  it honestly; 5% for the platform is market rate (Ember 10%, Scribe and RevShare 5%) and the most reliable platform
  income. Buyer guarantee at listing ≈ 0.50 / (1.005 + 0.40) × 0.98 ≈ 35% of the listing price. Implementation note:
  the migration fee is 60% of the threshold; DBC's `creator_migration_fee_percentage` is an integer share of that fee,
  so 5% of the raise is 8.33% of it (8% gives 4.8%, 9% gives 5.4%), or our program splits the partner share instead.
  Needs relaxing the `creator_migration_fee_percentage == 0` check and a vault/platform split of the partner share.
