# Status — 2026-09-16 (04:00 ET)

## Current milestone
**C2 done: StockFloor is live on Solana mainnet.** What remains is C3 (hosting the app, the video, the submission)
and a handful of decisions only the user can make.

## Fee model, branch `feat/fee-model` (2026-09-25, in progress, not merged)
- **Program part done** (docs/DECISIONS.md, "Fee model: implementation decisions"): launch v3 with presale fees to
  the platform treasury, the 5% / 5% / rest graduation split, the 50 / 20 / 30 LP split through the claimer's transit
  account, payee fallbacks to the vault, the F04/F05 config checks, v2 launches unchanged.
- **SDK, scripts and crank done** (docs/DECISIONS.md, "implementation notes (SDK, scripts, crank)"): IDL synced, v3
  builders and decoder, presets (25 bps presale fee, creator trading 0, vault 30–60%, DBC migration fee = vault + 10,
  default threshold $10,000), the create_launch config mirror, the graduation split in the preview with "floor per $100
  at listing" and the 1%-buy price sensitivity, the crank's migration split and platform ATA re-creation, `CU_LIMITS`
  from the fork measurements. tx1 still fits (1,175 bytes worst case).
- **Tests:** `cargo test -p stockfloor --lib` 58 passed; `pnpm --filter @stockfloor/sdk test` 310 passed; fork suite
  (`pnpm --filter @stockfloor/tests exec vitest run --exclude 'integration/audit-poc/**'`) **129 passed, 0 failed**
  (the C1 lifecycle, `fee-model`, `sdk-presets-fork` and the SDK-only product flow included); SDK, tests and app
  type-check clean.
- **App done (C13–C15)** (docs/DECISIONS.md, "implementation notes (app)"): threshold policy (min $10,000, picks
  $10K default / $25K / $50K, max $100K; `NEXT_PUBLIC_DEMO_THRESHOLDS=1` restores $50 / $100 / $1,000 and a $1
  minimum), flat curve by default, vault share slider 30–60% with the "Vault X% · Pool 90−X% · Platform 5% · Creator
  5%" caption, preview with the graduation split in dollars, floor per $100 at listing and the price move of a $1,000
  buy, fee copy everywhere (create form, token page, disclosures, crank, home, waitlist), token page floor per $100
  next to the vault share, v2/v3-aware vault share and fee wording. `pnpm --filter @stockfloor/app test` **242
  passed**; app type-check clean; `next build` OK; local-fork e2e (`pnpm e2e:local`, fresh surfnet with the v3
  binary) **11 + 4 passed**.
- **Not done yet:** the architecture / README fee docs (C16) and the independent review.
- **The deployed mainnet program is still the old binary.** The SDK and app must not ship v3 account lists against it
  without a program upgrade (a hard stop; the `.so` grew from 459,064 to 537,568 bytes, so it may need
  `solana program extend`).
- **Untracked audit PoCs** (`tests/integration/audit-poc/*.test.ts`, `programs/stockfloor/tests/audit_poc_*.rs`): they
  pass when a bug exists and encode the v2 fee model, so `pnpm test` (which runs them) reports failures: on
  2026-09-25 39 fork PoC tests in 20 files (F01, F02, F04, F05, F07–F13, F19–F21: the bugs this branch fixes, curve
  fees no longer entering the vault, mf 30 now rejected, the new split amounts and `FeesDistributed` event; F19's
  failure is an IDL name lookup in the PoC itself) and the 4 tests of `audit_poc_f04_fable.rs`. Everything else in
  `pnpm test` passes. The founder should decide whether to delete the PoCs or turn them
  into regression tests.

## Done (with test results)
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

## Blocked on user
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
- Nothing is blocking. Remaining work is the app deploy and the recording, both of which need the decisions above.

## Risks / surprises
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
