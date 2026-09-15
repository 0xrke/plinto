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
