# Status — 2026-09-15 ~09:30 ET

## Current milestone
M1 — fork spike (PDA as DBC partner `fee_claimer`, SPYx quote) → C1.

## Done (with test results)
- M0 repo setup: git repo, Anchor 1.0.2 workspace (`programs/stockfloor` skeleton), pnpm workspace (`packages/sdk`, `tests`, `app`) with dependencies installed, `.gitignore` (keys, env, vendor), repo-local keypairs in `keys/`, Surfpool 1.5.0 installed, DBC 0.2.1 and DAMM v2 IDLs in `idls/`, reference sources in `vendor/`. No tests yet.

## In progress
- Multi-agent workflow: M1 spike (fixtures + LiteSVM harness + spike program), DBC/DAMM research notes, `stockfloor` program core, SDK parameter math, web app scaffold.

## Blocked on user
—

## Next
C1 integration flow on the fork using the `stockfloor` program (harvest migration fee → vault → redeem), independent review, then checkpoint C1.

## Risks / surprises
- A PDA as the DBC partner `fee_claimer` has not been observed on mainnet yet. M1 must prove it on a fork.
- LiteSVM's bundled Token-2022 may not support SPYx extensions (Pausable, ScaledUiAmount); plan is to load the mainnet Token-2022 binary from fixtures.
