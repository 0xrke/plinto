# Status — 2026-09-15 ~15:40 ET

## Current milestone
**C1 reached, awaiting the user's OK.** Meanwhile continuing with local-only work: M2 (program hardening + remaining adversarial/property tests), M3 (SDK chain client + scripts), M4 (web wiring), M5 (docs draft). Nothing touches mainnet.

## Done (with test results)
- **M0** repo setup (Anchor 1.0.2 + pnpm workspace, keys in `keys/`, Surfpool 1.5.0, IDLs, vendor sources).
- **M1 / C1** on a LiteSVM mainnet fork (real DBC 0.2.1, DAMM v2, Token-2022 binaries; real SPYx mint and DBC token badge):
  - SPYx-quoted DBC config built by the SDK, `fee_claimer` = `leftover_receiver` = stockfloor Authority PDA → pool → `create_launch` + `register_pool` → 4 buys / 2 sells → `harvest_curve_fees` (+481,750 raw exactly) → curve completion (PartialFill) → `migration_damm_v2` → `harvest_migration_fee` (+65,673,160 raw = 50% of the 131,346,320 raw ≈ $1,000 threshold, exact) → DAMM v2 swaps → `harvest_lp_fees` (+681,460 exact) → 4 redemptions with exact net/fee → floor invariants checked after all 26 steps.
  - Evidence: `docs/research/c1-evidence.md`, `docs/research/m1-spike.md`, `docs/research/dbc-facts.md`, `docs/research/program-design.md`.
  - Independent review (security + evidence): C1 verdict YES from both. 15 findings, all fixed with regression tests except the deferred items below.
- **Test run (`pnpm test`, rebuilt binaries, 2026-09-15 22:27 local): ALL STEPS PASSED.**
  - Rust unit + property (`cargo test -p stockfloor`): 40 passed
  - Typecheck SDK + fork tests: pass
  - SDK unit + property: 93 passed
  - Fork integration (LiteSVM): 76 passed (C1 lifecycle 20, adversarial 16, review regressions 11, SDK presets on fork 7, stockfloor smoke 1 with 43 checks, spike 21)
  - Web app: 58 passed
- **SDK math** (presets, threshold conversion, preview, config builder validated against a port of DBC `create_config` checks and against the real DBC on the fork).
- **Web app scaffold** on mock data: `/`, `/create` (live preview), `/t/[mint]` (floor meter, max-loss buy label, redeem panel, disclosures). `next build` passes.

## In progress
- M2: vault-authority PDA split, simplify `harvest_leftover`, remaining fork tests (200 bps split bound, random multi-holder redeem property test, second position donation), program-design doc refresh.
- M3: SDK chain client (stockfloor + DBC + DAMM builders, fetchers, Jupiter), `create-launch` / `crank` / `redeem` scripts, Surfpool live-fork run.
- M4: wire the web app to the SDK against a local Surfpool fork.
- M5: README / demo script draft.

## Blocked on user
1. **C1 OK** — review `docs/research/c1-evidence.md` and confirm; work continues locally in the meantime.
2. (Later, C2) Fund the deployer `BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV` for the mainnet deploy and the demo launch; exact amounts will be computed before asking. Organizer question (main track + bounty) is on the user.

## Next
M2/M3 in parallel → M4 → independent review → C2 request.

## Risks / surprises
- SPYx issuer controls: a pause or a future transfer hook blocks swaps, harvests, migration and redeem (atomic, clean errors, funds stay put). The permanent delegate can move vault funds. Disclose.
- DBC/DAMM v2 are upgradeable by Meteora. Mitigated by the migration latch, relaxed decoders, the post-CPI vault check and (M2) the vault-authority split.
- The DBC config fee claimer and LP NFT owner is a PDA; the only mainnet precedent found is for `claim_trading_fee` (program `BLANKpB…`). Our migration-fee path is proven on the fork only until C2.
- LiteSVM fidelity (feature set, CU limits) is not mainnet; a Surfpool live-fork run is planned before C2.
- Prices per token are tiny (≈$1.5e-6 at 1B supply); the UI handles small-number formatting.
