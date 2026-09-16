# Status — 2026-09-16 (ET evening)

## Current milestone
M2–M5 done, plus a full review pass (program security, SDK, app, docs, C2 process).
**Waiting on the user for C1 OK and for the C2 decisions + funding below.** Nothing has touched mainnet.

## Done (with test results)
- **M0** repo setup. **M1 / C1** full lifecycle on a LiteSVM mainnet fork (see `docs/research/c1-evidence.md`).
- **M2** program hardening: two-PDA split (claimer signs external CPIs, vault authority owns the vault and signs only redeem), `burn_claimer_base`, `sync_migration` latch, on-chain enforcement of the StockFloor config shape, post-CPI vault integrity checks. Fork tests for CU budgets (every transaction ≤ 200k CU), redemption splits, LP positions, a fast-check property run (40 runs, 959 actions) and instruction-level error paths.
- **M3** SDK chain client: instruction builders for all 10 instructions, `Launch`/DBC/DAMM decoders, exact bigint ports of the DBC and DAMM v2 swap math, launch composer (all transactions ≤ 1232 bytes), `planCrank`/`runCrank`, Jupiter price + Ultra helpers (mainnet-only, mocked in tests), CLI scripts (`create-launch`, `buy`, `sell`, `crank`, `redeem`, `status`) with the mainnet send guard.
- **M4** web app wired to chain: `ChainDataSource` + `ChainLaunchActions` (create, curve buy/sell, DAMM v2 trades, redeem, permissionless crank), local-fork faucet route (loopback + surfnet guard), transaction progress states, honest labels (presale and market buy both show max loss), upgrade-authority disclosure read from chain.
- **M5** docs: `README.md`, `docs/architecture.md`, `docs/demo-script.md`.
- **Advanced threshold control on `/create`** (quick picks $50/$100/$1,000/$10,000 plus a custom USD field), validated on every keystroke against the SDK's port of DBC `create_config`, so the C2 demo can be driven entirely from the UI.
- **App end-to-end re-run on a live Surfpool fork** after those changes: `pnpm e2e:local` 11 + 4 tests, including a new UI-driven $50 launch that goes create → completing buy → graduation crank → redeem through the real components. 0 of 27 local signatures exist on mainnet. Details in `app/README.md`.
- **C2 runbook, preflight and gated run script** (`docs/c2-runbook.md`, `scripts/c2/`): a structurally read-only go/no-go preflight (19 checks), a one-command run with per-step confirmation, resume and abort guards, and a committed dry-run report. The dry run passed on a local fork (15 transactions, relay check 0 of 502).
- **C2 rehearsal on a live Surfpool mainnet fork**, re-run on the current binary (`docs/research/surfpool-e2e.md`, report `scripts/e2e/reports/20260916T000744Z.md`): deploy, launch, buys, graduation crank, DAMM trade, LP fee harvest, redemptions. All quotes exact, **495 mainnet-equivalent transactions**, none sent to mainnet (verified: 0 of 988 local signatures exist on mainnet). The documented §9 command blocks were then replayed verbatim (`replay-20260916T001340Z`, 0 of 503 signatures on mainnet).
- **Independent reviews** (program security, SDK/scripts, app+docs): no critical or high findings in the program; every medium/low finding fixed with a regression test or documented, see `docs/DECISIONS.md` 2026-09-16.
- **Screenshots in the README** (`docs/screenshots/`), captured headlessly from the app running against a local Surfpool mainnet fork with four seeded launches (two presales, two graduated and cranked): token page with the floor meter and the exact max-loss buy label, `/create` with the live preview, the launch list, and a 400 px mobile shot. Seeding and capture are scripted (`app/scripts/seed-fork.sh`, `app/scripts/screenshots.ts`) and the capture refuses to save a loading state, a `—` placeholder, a wrong buy label or a non-fork header, so the images can be regenerated against the real mainnet launch after C2. Driving the UI for them exposed four defects (a run-together sentence, two different max-loss numbers under near-identical labels, an anchor hidden by the sticky header, three `—` placeholders in the redeem card) — all fixed with regression tests; app suite 203.
- **Headline claim made consistent:** the home-page hero and the link-preview image promised "it cannot go to zero" unconditionally while the README and the token page already carried the two conditions; both now say "while the vault holds its stock token, it cannot fall to zero".
- **Test run (`pnpm test`, own verification, rebuilt binaries): 571 tests, all steps passed** — Rust unit + property 44, SDK 214, LiteSVM fork integration 113, web app 203. Re-verified from a fresh clone with no `keys/` (clone + `pnpm install --frozen-lockfile` + `pnpm test`, 97 s): the build falls back to `--ignore-keys` and every suite passes.

## Blocked on user
1. **C1 OK** (evidence: `docs/research/c1-evidence.md`).
2. **C2 approval + funding.** Deployer `BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV` needs **5.05 SOL** — 2.574 SOL is actually spent on the deploy, and the rest is the headroom that makes a failed ELF verification repairable by an upgrade instead of the irreversible `solana program close` (see `docs/research/surfpool-e2e.md` §7). Demo wallets need **0.14 SOL and 0.0806 SPYx (~$61)** in total; addresses and per-wallet amounts are in §7. The C2 run sends **495 mainnet transactions** (481 deploy + 14 lifecycle), listed in §8.
   **Approval is a file the user creates by hand, from the repo root:**
   `printf 'C2 approved %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > keys/c2-approved`
   Then: `export MAINNET_RPC_URL=… TOKEN_URI=… STOCKFLOOR_ALLOW_MAINNET=1; bash scripts/c2/run.sh --mainnet --allow-mainnet`.
3. **C2 decisions:** which mainnet RPC to use (the public endpoint is slow and rate-limited for the 479 deploy writes); where to host the token metadata JSON/image (hosting is publishing → needs the OK); whether to upload the program IDL on-chain (+0.03–0.12 SOL, not rehearsed); keep the upgrade authority for now (recommended while the transfer-hook limitation stands) or revoke at C3.
4. **Licence.** `LICENSE` (MIT) now exists and matches the root `package.json`; `tests/fixtures/README.md` names the upstream licences of the redistributed Meteora and SPL binaries. **If the owner wants a different licence, that one file is what changes.**
5. **Organizer question, still unanswered:** whether one project may enter both the main track and the DBC bounty. The README is structured so either answer works (a "For the Meteora DBC bounty" block sits directly under the status table), but the question gates how the submission is framed and should be asked today.

## Next (local, while waiting)
- Hosted app deploy checklist, so a judge opens the real mainnet launch rather than the example data (needs the C3 hosting decision).
- Hosted app deploy checklist, so a judge opens the real mainnet launch rather than the example data.

## Risks / surprises
- SPYx issuer controls (pause, freeze, permanent delegate, a future transfer hook) can block or drain; disclosed in the app and README. A transfer hook would freeze the vault until a program upgrade.
- DBC and DAMM v2 remain upgradeable by Meteora; mitigated by the migration latch, relaxed decoders, post-CPI vault checks and the two-PDA split.
- Between migration and the migration-fee harvest the floor reads low, so the crank must run right after migration in the demo.
- LiteSVM and Surfpool feature snapshots lag mainnet slightly; the rehearsal found no behavioural difference.
- The program binary changed with the `MigrationQuoteThresholdTooSmall` fix (459,064 bytes, sha256 `9fd9a0a8…`). The rehearsal and the preflight baseline were regenerated for it; **`scripts/c2/preflight.ts` says NO-GO on any binary that no saved report names**, so a rebuild before C2 means re-running `bash scripts/e2e/rehearsal.sh` with `SAVE_REPORT=1`.
