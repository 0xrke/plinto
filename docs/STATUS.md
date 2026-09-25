# Status — 2026-09-25 (ET)

## Current milestone
**C2 done: StockFloor is live on Solana mainnet** (launch v2 fee model). **The launch v3 fee model is implemented
on branch `feat/fee-model`** (program, SDK, CLI/crank, app, docs; all gated suites green), not merged and not
deployed. What remains is the founder's review of the branch, C3 (hosting the app, the video, the submission)
and the decisions below.

## Done (with test results)
- **Fee model, branch `feat/fee-model` (2026-09-25, not merged).** Decisions D1–D13 and implementation notes in
  `docs/DECISIONS.md`; mechanics in `docs/architecture.md` §3.0, §4.1, §5, §6; user-facing tables in the README
  ("Who pays for this", "The floor math", "Parameters").
  - **Program (launch v3):** presale fee 0.25%, its partner share (80%) to the platform treasury
    `78tRFS255ADZT2oMSXi5xjHt7Y2SVDLdDEBz759eQsqJ`; graduation split 5% of T to the platform, 5% of T to
    `launch.creator`, the rest (vault share 30–60%) to the vault; LP fees creator 50% / platform 20% / vault 30%
    through the claimer's transit ATA; unpayable payees fall back to the vault; `create_launch` creates the
    three quote ATAs and now requires `mf` 40–70, creator trading 0, a Customizable migrated pool at a fixed 1%
    with no dynamic or compounding fee, and no min-fee first swap (audit F04/F05/F08 closed); v2 launches keep
    paying 100% into the vault; `FeesDistributed` event; seven errors appended, none renumbered; `Launch` size
    unchanged (343).
  - **SDK / CLI / crank:** IDL synced, v3 builders and decoder, presets (25 bps, creator 0, vault 30–60%,
    `mf` = vault + 10, default threshold $10,000), a mirror of the `create_launch` checks, split-aware preview
    (floor per $100 at listing: flat 50/40 $34.88, gentle 50/40 $32.77), crank split and idempotent re-creation
    of the treasury ATA before a v3 curve harvest, `CU_LIMITS` from fork measurements; tx1 still fits (1,175
    bytes worst case).
  - **App:** threshold policy (normal $10K default / $25K / $50K, min $10,000, max $100,000;
    `NEXT_PUBLIC_DEMO_THRESHOLDS=1` gives $50 / $100 / $1,000 and a $1 minimum), flat curve by default, vault
    slider 30–60% with the split caption, split in dollars, floor per $100, price move of a $1,000 buy, fee copy
    everywhere, v2/v3-aware token page.
  - **Tests (gated commands, all run on 2026-09-25):**

    | Command | Result |
    |---|---|
    | `cargo test -p stockfloor --lib` | 58 passed |
    | `pnpm --filter @stockfloor/sdk test` | 310 passed |
    | `pnpm --filter @stockfloor/tests exec vitest run --exclude 'integration/audit-poc/**'` | **129 passed, 0 failed** (18 files; `fee-model.test.ts` 14/14) |
    | `pnpm --filter @stockfloor/app test` | 242 passed (26 files) |
    | SDK, tests and app `tsc --noEmit` | clean |
    | `pnpm build:local` + `pnpm e2e:local` (fresh Surfpool fork, v3 binary) | 11 + 4 passed |
    | `pnpm test` (whole repo) | fails only on the untracked audit PoCs (below); everything else passes |
    | `pnpm lint` | fails repo-wide on 109 files that were already unformatted (not `app/`); unchanged by this branch |

  - **Compute units (v3, max of six runs → limit):** `create_launch` 163,053 → 200,000; `harvest_curve_fees`
    91,276 → 120,000 (creating the claimer base ATA) / 59,180 → 85,000; `harvest_migration_fee` 69,817 → 100,000;
    `harvest_lp_fees` 90,551 → 120,000. The `.so` grew from 459,064 to 537,568 bytes.
  - **Review:** the workflow's review and fix step reported no fixes needed, and the recheck reported nothing
    open. The program, SDK and app parts were each self-reviewed by the implementing session; no separate
    adversarial audit of the branch has been done.
- **M0–M5** repo, program, SDK, CLI, web app, docs, screenshots — see `docs/DECISIONS.md`.
- **C1** full lifecycle on a LiteSVM mainnet fork (`docs/research/c1-evidence.md`).
- **C2 — the mainnet run, 2026-09-16** (`scripts/c2/reports/c2-20260916T071644Z.md`, 15 transactions plus a
  481-transaction deploy, no failures):
  - `stockfloor` deployed at `98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA`; the dumped on-chain ELF equals
    `target/deploy/stockfloor.so` byte for byte (sha256 `9fd9a0a8…`), verified independently after the run.
  - Demo launch **StockFloor Demo (SFDEMO)**, mint `2tDGrasjypSU7aaUiCDNTKErFi9m8WYd1a4t62Req6Nw`, $50 threshold in
    SPYx: presale filled to 6,548,267 / 6,548,266 raw, graduation crank, migration into DAMM v2, market trades,
    LP-fee harvest, two redemptions. Phase `redeemable`.
  - **The core claim is proven on mainnet:** in `3XRDzbBY…` the claimer PDA signed a CPI into DBC
    `withdraw_migration_fee` and moved **3,274,133 raw SPYx — exactly half the threshold — into the floor vault**
    `8Y6vZa3zJJNFjvADg3pEGeDAUg6WcufECWohvzmEDmZr`. Verified by decoding the transaction's own balance changes.
  - Funding run first (`scripts/c2/reports/fund-20260916T070256Z.md`): 0.7865 SOL moved, SPYx bought through
    Jupiter in a $5 test swap followed by the remainder, all five wallets verified from chain.
  - Cost: ≈3.36 SOL in total, of which 2.571 SOL is recoverable programdata rent. Deployer holds 2.747 SOL.
- **Test run (`pnpm test`, own verification, rebuilt binaries): 577 tests, all steps passed** — Rust 44, SDK 217,
  LiteSVM fork 113, web app 203. Also from a fresh clone with no `keys/`.

## In progress
- Nothing is running. The fee-model branch waits for the founder's review; the optional C17 (platform ATA as
  the DBC referral account on UI curve swaps) was not started.

## Blocked on user
0. **Fee model (branch `feat/fee-model`):**
   - **Merge or not.** Everything is on the branch; `main` still carries the v2 model.
   - **Mainnet program upgrade** before the v3 SDK or app can talk to mainnet (a hard stop; the deployed binary
     speaks the v2 account lists). The `.so` grew by 78,504 bytes, so the upgrade may need `solana program
     extend` (costs SOL; the deployer holds about 2.747 SOL). Existing v2 launches, SFDEMO included, keep paying
     100% into the vault after the upgrade.
   - **Treasury key.** `keys/platform-treasury.json` is a hot key that receives all platform income; replace it
     with a hardware or multisig key before the upgrade if wanted (changing it later needs another upgrade).
   - **Untracked audit PoCs** (`tests/integration/audit-poc/*.test.ts`, `programs/stockfloor/tests/audit_poc_*.rs`):
     they pass when a bug exists and encode the v2 fee model, so `pnpm test` reports them failing: 39 fork PoC
     tests in 20 files (F01, F02, F04, F05, F07–F13, F19–F21; F19's failure is an IDL name lookup in the PoC
     itself) and the 4 tests of `audit_poc_f04_fable.rs`. Delete them, or turn them into regression tests?
   - **PoC formatting.** An early `cargo fmt -p stockfloor` also reformatted 6 of the 7 untracked Rust PoCs
     (layout only). The originals were rebuilt and are in the session scratchpad
     (`/private/tmp/claude-501/-Users-rk-Projects-stockfloor/a96026aa-ad2e-4ab1-8817-66f7d23901d5/scratchpad/poc_restore/`);
     copy them back or keep the reformatted files.
1. **Host the app** so a judge can click through the live mainnet launch. Hosting is publishing, so it needs the OK,
   the env of `app/README.md` ("Deploying the app") and a mainnet RPC for the browser bundle.
2. **Record the video** — `docs/demo-script.md` now carries the real links and numbers.
3. **Organizer question:** whether one project may enter both the main track and the DBC bounty.
   The deadline is now Fri 2026-09-25 (the user confirmed the extension on 2026-09-16).
4. **Upgrade authority:** keep (recommended while the transfer-hook limitation stands) or revoke at C3.
5. **Address for the leftover SOL** (~2.7 SOL on the deployer, minus whatever C3 needs). Not the exchange address
   the funding came from.
6. **Optional:** the Pyth market-data bounty is a cheap fit (USD valuation of the floor, xStock premium/discount);
   PreStocks and Tessera are not reachable without a redesign (their mints carry transfer fees, which DBC rejects).
7. **Product name:** the user is reconsidering "StockFloor" now that there is time. Rejected so far: Stoa (a Stoa
   Protocol exists or existed; stoa.xyz taken, stoa.fun registry-reserved), Stowa (a German watch brand), Keel and
   every Keel compound (Sky runs a Solana capital allocator called Keel), Ballast (DeFi on Sui), Cellar (Sommelier
   vaults). Plain English words are taken on .com/.xyz/.app but mostly free on .fi; compounds are free everywhere.
   Also dropped: Ironfloor (echoes the collapsed Iron Finance). The user ranks easy reading and pronunciation above
   brevity, and on 2026-09-17 asked to stop describing the mechanism in the name: invented words only, domains in
   .xyz / .fun / .fi / .finance. Invented-word shortlist: Nardo, Ravona, Orvelo, Bevano, Norvo, Talaro, Tamo, Amvo.
   Dropped for existing tokens or look-alikes: Lorvan, Zonto, Zamo, Tavro, Tanzo, Temaro, Monavo, Lumaro, Venzo.
   Later the same day the user asked to follow launchpad naming (pump.fun, bonk.fun, bags.fm, believe.app,
   metadao.fi): a short everyday word with the domain as part of the brand. Free on .fun at registry level (price and
   premium tier unknown): wall, street, steady, solid, keep, stay, par, share, sober; sober is also free on .fi and
   .finance.
   The user then chose a serious launchpad for tokens meant to outlive memecoins. Long-term names free on .fi:
   decade, tenure, cohort, annum, lasting, staying, slowburn (keepsake only on .finance). Dropped: long* (Long.xyz),
   Perennial (Perennial Finance), Evergreen, Redwood, Keeper.
   Stock-derived coinages: Stockhold (.fi/.finance), Stockstead and Stockvale (all four zones), Stonking and Stonko
   (all four, but the stonk family is crowded). Dropped: Stocko (an Indian trading platform), Stockr (STOKR), Stoken.
   The user dropped .fi (too expensive) and asked for "floor / foundation" in other languages. Shortlist: Taban
   (Turkish floor; "taban fiyat" = floor price), Lantai (Malay/Indonesian floor), Sakafu (Swahili floor), Osnova,
   Patoma (Greek floor), Zemin, Alusta, Temel, Planko, Karka. Dropped: Zoru (one letter from Zora), Solera, Yesod.
   The user liked Planko; its risk is Plinko (a crypto-casino game). Plank-rooted alternatives, all free on .xyz/.fun/
   .finance: Planken, Plankway, Plankr, Plankly, Plankstone, Plankade, Tabulo. Dropped: Plank (taken; $PLANK exists),
   Planka (Swedish slang for fare dodging). A rename would be
   user-facing only: the program id, the crate name and the immutable demo token (`StockFloor Demo` / `SFDEMO`) keep
   the old name.

## Next (local)
- Fee model, small leftovers: the test title "the brief's anti-snipe schedule (exponential 20% -> ~1%, creator
  share 30%) …" in `tests/integration/review-regressions.test.ts` still names a creator share of 30% (the config
  now uses 0); the optional C17 referral account; optionally require `exit_fee_bps == 200` on chain (D9).
- Out of scope of the fee model, still open from the audit: F11 (the migration harvest accepts any delta), F10
  (floor minimum above 1 raw), F21 (zero-value events).
- The README's C1 numbers and the 2026-09-16 screenshots show the v2 model; re-record them once the branch is
  merged (the README says so next to the numbers).
- Remaining C3 work is the app deploy and the recording, both of which need the decisions above.

## Risks / surprises
- **The fee model changes what the app and SDK send.** After a merge, the SDK and app build v3 account lists; the
  mainnet program is still the v2 binary, so the app must not be deployed against mainnet before the program
  upgrade.
- **Presale fees depend on the treasury ATA.** If the treasury key closes its quote ATA, v3 curve harvests fail
  (`PlatformQuoteAccountUnavailable`) until it is re-created; the SDK crank re-creates it idempotently, at up to
  35k extra CU. The fees wait in DBC meanwhile and never reach the vault.
- **The price move of a $1,000 buy is large at the $10,000 default** (about +56% into a pool holding 40% of
  the raise); the create form shows it. It is the thin-market side of a large vault share.
- **StonkFun (stonkfun.xyz, $STONK) already pairs new Solana tokens with tokenized stocks** (Raydium LaunchLab;
  STONK rose to about $140M market cap on 2026-09-06 per The Block). "Tokens quoted in stocks" is therefore not our
  differentiator any more. The pitch has to lead with the redeemable floor funded at graduation and with DBC.
  Long.xyz does the same on Robinhood Chain (tokens paired with Robinhood Stock Tokens).
- **A close concept already exists under a "floor" name.** FLOOR ($FLR, thefloor.finance) routes a token's creator
  fees into four tokenized equities plus gold, half claimable by holders and half backing a floor (per its own
  description in search results; the site itself failed TLS when fetched on 2026-09-17). Floors Finance and FloorFi
  also pitch floor-backed tokens. The README should state the difference plainly: here the floor is funded once, at
  graduation, from half of the raise, and holders redeem by burning. It is also a reason to drop "Floor" from the name.
- **The demo token's on-chain name is `StockFloor Demo` / `SFDEMO`, while its metadata JSON describes a fictional
  roastery.** `TOKEN_URI` was set for the run but `TOKEN_NAME` / `TOKEN_SYMBOL` were left at the script's defaults.
  The metadata is immutable (`isMutable: 0`, update authority cleared) and the URI is pinned to a commit, so neither
  side can be corrected. Documented openly in the README rather than hidden.
- **A provider RPC behind a load balancer serves stale reads.** Four separate guards aborted correct runs because a
  node had not caught up — the funding transfer, the deploy verification, the launch-phase guard, and the preflight's
  view of completed steps. All four now poll instead of reading once. Nothing was lost, but every one of them cost a
  restart mid-run.
- A third party traded on the demo curve between our steps: real public market, not a sandbox.
- SPYx issuer controls (pause, freeze, permanent delegate, a future transfer hook) can block or drain; disclosed.
- DBC and DAMM v2 remain upgradeable by Meteora; mitigated by the migration latch, relaxed decoders, the post-CPI
  vault check and the two-PDA split.
