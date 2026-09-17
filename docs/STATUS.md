# Status — 2026-09-16 (04:00 ET)

## Current milestone
**C2 done: StockFloor is live on Solana mainnet.** What remains is C3 (hosting the app, the video, the submission)
and a handful of decisions only the user can make.

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
   Also dropped: Ironfloor (echoes the collapsed Iron Finance). The user now ranks easy reading and pronunciation above
   brevity. Under review: Nonzero (nonzero.fi), Footing (footing.fi), Stockroot (.xyz/.app/.fi), Lowerbound,
   Underpin, Hardpan, Lastro, Holdground. A rename would be
   user-facing only: the program id, the crate name and the immutable demo token (`StockFloor Demo` / `SFDEMO`) keep
   the old name.

## Next (local)
- Nothing is blocking. Remaining work is the app deploy and the recording, both of which need the decisions above.

## Risks / surprises
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
