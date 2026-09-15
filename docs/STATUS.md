# Status — 2026-09-16 ~19:20 ET (2026-09-15 ET evening)

## Current milestone
M2–M5 done. **Waiting on the user for C1 OK and for the C2 decisions + funding below.** Nothing has touched mainnet.

## Done (with test results)
- **M0** repo setup. **M1 / C1** full lifecycle on a LiteSVM mainnet fork (see `docs/research/c1-evidence.md`).
- **M2** program hardening: two-PDA split (claimer signs external CPIs, vault authority owns the vault and signs only redeem), `burn_claimer_base`, `sync_migration` latch, on-chain enforcement of the StockFloor config shape, post-CPI vault integrity checks. Fork tests for CU budgets (every transaction ≤ 200k CU), redemption splits, LP positions, a fast-check property run (40 runs, 959 actions) and instruction-level error paths.
- **M3** SDK chain client: instruction builders for all 10 instructions, `Launch`/DBC/DAMM decoders, exact bigint ports of the DBC and DAMM v2 swap math, launch composer (all transactions ≤ 1232 bytes), `planCrank`/`runCrank`, Jupiter price + Ultra helpers (mainnet-only, mocked in tests), CLI scripts (`create-launch`, `buy`, `sell`, `crank`, `redeem`, `status`) with the mainnet send guard.
- **M4** web app wired to chain: `ChainDataSource` + `ChainLaunchActions` (create, curve buy/sell, DAMM v2 trades, redeem, permissionless crank), local-fork faucet route (loopback + surfnet guard), transaction progress states, honest labels (presale and market buy both show max loss), upgrade-authority disclosure read from chain.
- **M5** docs: `README.md` (pitch, mechanics, DBC configuration table, floor math, architecture, security, parameters, testing, run-locally, prior art, disclosures), `docs/architecture.md`, `docs/demo-script.md`.
- **C2 rehearsal on a live Surfpool mainnet fork** (`docs/research/surfpool-e2e.md`, report `scripts/e2e/reports/`): the whole planned mainnet sequence ran through the CLI — deploy, launch, buys, graduation crank, DAMM trade, LP fee harvest, redemptions. All quotes exact, 494 mainnet-equivalent transactions, none sent to mainnet (verified: 0 of 969 local signatures exist on mainnet).
- **Independent reviews** (program security, SDK/scripts, app+docs): no critical or high findings; 25 medium/low findings, 24 fixed with regression tests, 1 deferred (transfer-hook support, documented).
- **Test run (`pnpm test`, own verification, rebuilt binaries): ALL STEPS PASSED — 523 tests.** Rust unit + property 43, SDK 210, LiteSVM fork integration 112, web app 158. Also verified in a **fresh clone without `keys/`** (95 s).

## Blocked on user
1. **C1 OK** (evidence: `docs/research/c1-evidence.md`).
2. **C2 approval + funding.** Deployer `BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV` needs **2.70 SOL** (or 5.05 SOL to keep headroom for one program upgrade); demo wallets need **0.10 SOL and 0.0802 SPYx (~$61)** in total — the addresses and per-wallet amounts are in `docs/research/surfpool-e2e.md` §7. The C2 run sends **494 mainnet transactions** (480 deploy writes + 14 lifecycle), listed in §9.
3. **C2 decisions:** which mainnet RPC to use; where to host the token metadata JSON/image (hosting is publishing → needs the OK); whether to upload the program IDL on-chain (+0.03–0.12 SOL); keep the upgrade authority for now (recommended while the transfer-hook limitation stands) or revoke at C3.
4. **License** for the repository (`package.json` says MIT, there is no LICENSE file), and a check that redistributing the Meteora mainnet binaries and IDLs in `tests/fixtures/` and `idls/` is acceptable (their sources are under a Meteora non-commercial licence).
5. Organizer question: whether one project may enter both the main track and the DBC bounty.

## Next (local, while waiting)
- Let the `/create` form set a small threshold so the C2 demo can be driven from the UI.
- Re-run the app end-to-end against a local Surfpool fork after the latest app changes.
- Judge-lens pass over README and the demo script; prepare the C2 runbook so the mainnet run is one approved command sequence.

## Risks / surprises
- SPYx issuer controls (pause, freeze, permanent delegate, a future transfer hook) can block or drain; disclosed in the app and README. A transfer hook would freeze the vault until a program upgrade.
- DBC and DAMM v2 remain upgradeable by Meteora; mitigated by the migration latch, relaxed decoders, post-CPI vault checks and the two-PDA split.
- Between migration and the migration-fee harvest the floor reads low, so the crank must run right after migration in the demo.
- LiteSVM and Surfpool feature snapshots lag mainnet slightly; the rehearsal found no behavioural difference.
