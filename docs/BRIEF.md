# StockFloor — Build Brief

Status: approved concept, ready to build. Written 2026-09-15.
**Deadline: Friday 2026-09-18, 16:00 ET.** Read `CLAUDE.md` first for the language rule, the autonomy rules, the hard stops and the checkpoints.

---

## 1. One-liner and pitch

> **A token launchpad on Meteora DBC where every token gets a hard price floor backed by tokenized S&P 500.** It works like pump.fun, but a large share of the money raised becomes a redeemable floor in SPYx the moment the market opens. The token can go up without limit, and it cannot go to zero.

Pitch lines for README and video:
- "Everyone else builds a piggy bank that might become a floor someday. We ship the floor on day one."
- "Launch mechanics for equity-like assets: the raise is locked in stocks, not burned on hype."

The product is **not** a memecoin casino. Present it as launches for communities, creators and projects where buyers are protected from zero by real stocks.

---

## 2. Hackathon context

Source: https://hackathons.solana.com/hackathons/stocklana

- **Timeline:** submissions close Fri 2026-09-18 16:00 ET. Judging runs through 2026-10-02.
- **Main track ($100K, Solana Foundation).** One question: *"could this be a real app that people will actually use?"* Judges look for a real user and problem, a working end-to-end demo, a reason it belongs on Solana, and quality of execution.
- **Bounty: Best Use of Meteora DBC ($5,000).** Verbatim:
  > Meteora's Dynamic Bonding Curve (DBC) is a fully configurable token launch primitive: you control the curve shape, fee schedule, quote token, graduation threshold, and how the pool migrates into Meteora DAMM v2 liquidity. Most launches today use it for memecoins. We want to see what it looks like for tokenized stocks. Build something on DBC that outlasts the current meme-stock meta. Ideas we'd love to see: launch mechanics tuned for equity-like assets (price discovery for thinly traded or newly tokenized stock pairs), novel curve or fee configurations, creative graduation rules, or tooling that helps issuers configure and monitor DBC pools. **Working code on mainnet beats slides.** Judging: originality of the DBC configuration or use case, technical soundness, and whether the idea has a life after the hackathon.
- **Submission:** at least one link (GitHub, live demo or video). Edits are allowed until close. One submission per team. Open-source components must be disclosed. The user will check with organizers whether one project can enter both the main track and the bounty.

---

## 3. How it works (product behavior)

Three phases per token.

### Phase 1: Presale on the DBC bonding curve ("the till")
- The creator launches a token on our platform. DBC creates the mint and a virtual pool.
- Buyers purchase from the curve with the **quote asset**: SPYx by default, or another asset from the allowlist.
  - In the UI, buyers pay USDC or SOL, and the app routes USDC/SOL → SPYx through Jupiter.
- Buyers can sell back to the curve during presale.
- There is **no floor vault yet** and **no AMM market yet**.
- The curve is flat or gently rising (equity-like, IPO-style), not a steep memecoin curve.

### Phase 2: Graduation (a single moment)
When the quote reserve reaches the migration threshold:
1. DBC completes the curve.
2. The **partner migration fee** (default **50%** of the threshold, allowed 30–70%) becomes claimable. Our program harvests it into the token's **vault**.
3. The remainder plus base tokens migrate to a **Meteora DAMM v2** pool. Free trading starts: Jupiter, wallets.
4. Migrated LP positions go to our PDA and are **permanently locked**. Only fees are claimable.

### Phase 3: Free market with a floor
- The token trades freely on DAMM v2, and its price is set by supply and demand.
- **Any holder can redeem at any time.** Burn N tokens and receive `N / supply × vault` in the quote asset, minus a **2% exit fee** that stays in the vault.
- Redemption is permissionless and cannot be paused by us. There is no admin withdraw.
- **Floor per token** = `vault_quote_raw / base_mint_supply`.
- Arbitrage keeps the market price near or above the floor: buy below the floor, then redeem.
- The floor **never decreases** through redemptions. It rises through:
  - the partner share of trading fees, both during presale and from DAMM v2 LP fees;
  - the retained exit fee;
  - burned base-token fees and leftovers;
  - SPYx dividends via the Token-2022 ScaledUiAmount multiplier (the raw balance is constant and its UI value rises).
- In USD terms the floor moves with the underlying stock or index.

### What the floor is NOT
It protects buyers from **zero**, not from loss. Someone who buys at 12× the floor can lose about 92%. The UI must show this honestly on the buy button: *"Price $X · Floor $Y · Max loss if you buy now: −Z%"*, where `Z = 1 − floor/price`.

---

## 4. Default parameters (decide in code; record changes in `docs/DECISIONS.md`)

| Parameter | Default | Notes |
|---|---|---|
| Base token | SPL Token, 6 decimals, 1,000,000,000 supply target, immutable metadata | Token authority option `Immutable` (1). DBC revokes mint authority on standard configs. Verify. |
| Supply model | Dynamic (DBC mints what the curve needs) | If fixed supply is used, `leftover_receiver` is our PDA and leftovers are **burned**. |
| Quote allowlist (UI-level) | **SPYx** (default), QQQx, GLDx, NVDAx, AAPLx, MSFTx, GOOGLx, TSLAx | Show a volatility label: index/gold are calm, single stocks are volatile. Exclude leveraged products (TQQQx) and hyper-volatile names (MSTRx). |
| Curve preset | `gentle` (last price = 1.2× first) and `flat` (1.01×) | Near-flat is allowed: DBC only requires strictly increasing sqrt prices, liquidity > 0, and ≤16 points. Watch for u64 overflow. |
| Migration threshold | ≈ $1,000 USD equivalent in the quote asset, computed at launch from the Jupiter price × multiplier | Meteora keepers auto-migrate stock-quote pairs only at ≥ $750 equivalent. We also run our own crank; `migration_damm_v2` is permissionless. |
| Base trading fee (curve) | 1% fixed (scheduler with constant fee) | Optional anti-snipe preset: exponential decay, e.g. 20% → 1% over 30 min. Minimum is 25 bps. |
| Collect fee mode | QuoteToken (0) | Fees accrue in the quote asset, so they can go straight to the vault. |
| `creator_trading_fee_percentage` | 30 | Creator gets 30% of non-protocol trading fees; the partner share (70%) is harvested into the vault. Protocol always takes 20% of the total fee. |
| `migration_fee_percentage` | 50 (UI range 30–70) | Max allowed by the deployed program is 99. |
| `creator_migration_fee_percentage` | 0 | The entire migration fee goes to the partner, i.e. the vault. |
| Migration target | DAMM v2 | DAMM v1 is deprecated for new configs. |
| Migrated pool fee | 1% (Customizable option, 0.1–10% allowed) | Prefer collecting fees in the quote token if DAMM v2 supports it; otherwise burn the base-token side. |
| Liquidity distribution | 100% partner permanent-locked | The positions' NFT owner is our PDA. DBC requires ≥10% locked at day 1. |
| Pool creation fee | 0 | |
| Exit fee | 200 bps, immutable per launch, capped at 500 bps | Retained in the vault. |
| Free token allocations | **None** | Free tokens would drain buyers' money from the vault. No team, airdrop or vesting allocations. |

---

## 5. On-chain architecture

### 5.1 Programs involved
- **Meteora DBC**: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`. Deployed version is 0.2.1, which adds Token Badges for stock quote mints.
  - Source: https://github.com/MeteoraAg/dynamic-bonding-curve (0.2.1 commit `f552f20aa3c1c7631427c3827aeea7c58b902813`).
  - SDK: `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12 (repo https://github.com/MeteoraAg/dynamic-bonding-curve-sdk). The IDL is inside the npm package.
  - Docs: https://docs.meteora.ag/developer-guides/dbc, and Rust CPI at https://docs.meteora.ag/developer-guides/dbc/rust-integration/cpi.md.
- **Meteora DAMM v2**: the program id is believed to be `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`. **Verify it** against SDK constants.
- **Our program (`stockfloor`, Anchor)**: vault, harvest cranks, redemption.
- Token-2022 (quote assets such as SPYx) and SPL Token (base token).

### 5.2 Per-launch accounts (suggested; refine as needed)
Create one DBC config per launch so each config maps to exactly one intended pool. Config accounts are keypair accounts created in the launch transaction.

| PDA | Seeds | Purpose |
|---|---|---|
| `Launch` | `["launch", config]` | Registry: config, canonical pool, base_mint, quote_mint, exit_fee_bps, flags (migration_fee_harvested, …), created_at |
| `Authority` | `["authority", config]` | Set as the DBC `fee_claimer` and `leftover_receiver`. Signs every CPI. Owns the vault token account and the LP position NFTs. |
| Vault token account | ATA of `Authority` for `quote_mint` (Token-2022) | Holds the floor backing |

### 5.3 Instructions (our program)
Every crank instruction is **permissionless**. The PDA signs its CPIs.
1. `create_launch(exit_fee_bps)`: validates the DBC config fields.
   - `fee_claimer` == Authority PDA, `leftover_receiver` == Authority PDA.
   - `creator_migration_fee_percentage` == 0, `migration_fee_percentage` within [30, 99].
   - Partner permanent-locked liquidity == 100%, and the other buckets are 0.
   - Collect mode is quote.
   - Then initializes the `Launch` and vault token account.
2. `register_pool`: records the canonical DBC virtual pool for this config (first pool only). It must check `pool.config == config` and set the base mint. Funds from any extra pools created on our config are ignored and never mixed into the vault.
3. `harvest_curve_fees`: CPI DBC `claim_trading_fee` (partner side), then deposit the quote into the vault. Burn any base-token fees.
4. `harvest_migration_fee`: CPI DBC `withdraw_migration_fee(flag=0)` (partner) into the vault. Sets `migration_fee_harvested`.
5. `harvest_surplus`: CPI DBC `partner_withdraw_surplus` into the vault.
6. `harvest_leftover`: after DBC `withdraw_leftover` pays the PDA's base ATA, burn it.
7. `harvest_lp_fees`: CPI DAMM v2 `claim_position_fee` for the PDA-owned positions. The quote goes to the vault; the base token is burned.
8. `redeem(amount)`: the holder burns `amount` base tokens and receives the quote asset.
   - Only allowed after migration is complete **and** the migration fee has been harvested.
   - `gross = floor(vault_raw × amount / supply_before)`
   - `fee = ceil(gross × exit_fee_bps / 10_000)`
   - The holder receives `gross − fee` via `transfer_checked`; `fee` stays in the vault.
   - Use u128 math and round in the vault's favor.
9. (view) `floor`: returns `vault_raw`, `supply`, and floor per token (raw); also used by the UI.

### 5.4 Invariants (each needs tests)
- The only way quote leaves the vault is `redeem`. There is no admin, no withdraw and no sweep.
- `vault_raw / supply` after `redeem` ≥ before (strictly greater when the exit fee is > 0). Write a property test over random sequences.
- Rounding never favors the redeemer. Many tiny redemptions must not extract more than one large one.
- `redeem` accepts only the registered base mint and pays only from that launch's vault.
- The quote mint of the vault == the config's quote mint.
- All base tokens the program ever holds are burned in the same instruction, so `mint.supply` is the source of truth.
- Donations to the vault only raise the floor.
- Market price manipulation cannot change the floor (the floor math uses no price oracle).
- Behavior when the quote mint is **paused**: redeem and harvest fail cleanly with a clear error and no state corruption.
- Transfers must be written so that a future transfer hook on the quote mint does not corrupt state (fail cleanly is acceptable for the MVP; document it).
- Before mainnet, plan to revoke upgrade authority. That requires the user's OK (hard stop).

---

## 6. Verified technical facts (research 2026-09-15; re-verify anything critical)

### DBC program behavior
- **Max migration fee is 99%** (`MAX_MIGRATION_FEE_PERCENTAGE = 99`, checked at config creation). On mainnet there are 636 configs at 99% and 1,193 at 50%.
  - The migration fee is computed from the **threshold**, not the actual reserve: `fee = threshold − ceil(threshold × (100 − pct) / 100)`.
  - Creator share = `floor(fee × creator_pct / 100)`; the partner gets the rest.
- **`withdraw_migration_fee(flag)`**
  - Accounts: pool_authority, config, virtual_pool (mut), token_quote_account (mut, any owner), quote_vault, quote_mint, sender (Signer), token_quote_program, event_authority, program.
  - `flag=0` = partner and requires `sender == config.fee_claimer`; `flag=1` = creator and requires `sender == pool.creator`. Each is claimable once (bits in `migration_fee_withdraw_status`).
  - Requires `quote_reserve ≥ threshold`. Migration does **not** need to be finished.
- **`claim_trading_fee`**
  - Accounts: pool_authority, config, pool, token_a_account, token_b_account, base_vault, quote_vault, base_mint, quote_mint, fee_claimer (Signer), plus the token programs.
  - Can be called anytime. Pools whose base token has a transfer hook use `claim_trading_fee2`.
- **`partner_withdraw_surplus`**: fee_claimer signs. Available once, after the curve is complete. The partner gets 80% of surplus × (1 − creator%).
- **PDA signers work.** There is no `is_on_curve` check anywhere in DBC; access control is `Signer` plus a key comparison, so `invoke_signed` from our program works.
  - Mainnet precedent: Star's `dbc_settlement` program (`2BxLeMqUTvToiV6b6AivMbh7crp5F8kBoDc5gg6uzNHD`) CPIs DBC `CreatorWithdrawSurplus` signed by a PDA.
  - A PDA as **partner `fee_claimer`** is the same code path but has not been seen on mainnet yet. **C1 must prove it on a fork.**
- **`withdraw_leftover`** is permissionless, pays the `leftover_receiver`'s ATA (a PDA ATA works), and only runs after the DAMM pool is created. `leftover_receiver` must not be the default pubkey.
- **DAMM v2 migration**
  - `migration_damm_v2` has no access control (payer and NFT-mint signers only).
  - The partner's position NFT goes to `config.fee_claimer`.
  - DAMM v2 `claim_position_fee` accepts the signer == NFT account owner, so our PDA can claim through CPI.
- **Keepers:** Meteora migration keepers (`Asi5DTGEeiso6k7ya6ndDabEZ7DRCgfTpCBLPH5E3aQs`, `DeQ8dPv6ReZNQ45NfiWwS5CchWpB2BVq1QMyNV8L2uSW`) migrate stock-token quote pairs when the threshold is ≥ $750 equivalent. The manual migrator is at https://migrator.meteora.ag.

### DBC config constraints
- Token decimals 6–9.
- ≥10% of liquidity locked at day 1; vesting ≤ 2 years.
- Trading fee between 0.25% minimum and a 99% cap; protocol takes 20% of trading fees; the protocol migration liquidity fee is 0.2%.
- Pool creation fee, if non-zero, is 0.001–100 SOL.
- Rate limiter and DAMM v1 are deprecated and rejected for new configs.
- **Token badges:** a Token-2022 quote mint with extensions beyond metadata needs a DBC token badge.
  - The badge PDA is `["token_badge", quote_mint]`, passed as remaining account index 0 on `create_config` and pool init.
  - It requires a zero transfer fee.
  - 737 xStocks have badges on mainnet, including all the liquid ones.

### SPYx mint (read 2026-09-15)
`XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`, Token-2022, 8 decimals.
- Freeze authority `JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs`.
- **DefaultAccountState = initialized**: new accounts are not frozen.
- **Pausable**: paused = false, authority `JDq14…`.
- **PermanentDelegate** `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq`.
- **TransferHook**: programId null, but authority `5aMNNL…` can set one later.
- **ScaledUiAmount**: multiplier ≈ 1.0057 (changes on dividends). Always do math in **raw** units; display UI = raw × multiplier.
- ConfidentialTransferMint present (auto-approve false); it does not affect normal transfers.
- **No TransferFee.**
- PDA-owned SPYx accounts already exist and work without allowlisting: the DBC pool authority owns 94 SPYx accounts, the DAMM v2 pool authority owns 27.
- xStocks asks venues to pause about ±15 minutes around multiplier activation, which happens at 00:30 UTC the day after ex-date. Docs: https://docs.xstocks.fi/developers/multipliers
- xStocks is not offered to US persons (also excluded: UK, Canada, Australia per Kraken).

### Quote allowlist mints (Solana)

| Symbol | Mint | Jupiter liquidity (2026-09-14) |
|---|---|---|
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | ~$3.9M |
| QQQx | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | ~$1.65M |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | ~$1.73M |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | ~$1.23M |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | ~$0.86M |
| MSFTx | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` | ~$0.45M |
| GOOGLx | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | ~$0.44M |
| GLDx | `Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re` | ~$0.37M |

Full list: https://api.xstocks.fi/api/v2/public/assets (paginated, `?page=N`).

### Prices and swaps
- Jupiter Price V3 without an API key: `https://lite-api.jup.ag/price/v3?ids=<mints>`. It returns `usdPrice`, `liquidity`, `stockData.price` and `scaledUiConfig.multiplier`.
- Jupiter swap: `https://lite-api.jup.ag/ultra/v1/order` (includes RFQ market makers) and `https://lite-api.jup.ag/swap/v1/quote` (AMM routes). Both are mainnet only.
- There are **no xStocks on devnet**. Test on a **mainnet fork** (Surfpool or LiteSVM with cloned accounts).

---

## 7. Off-chain components

1. **SDK/scripts (TypeScript)**
   - `create-launch`: builds the DBC config with our defaults, creates the pool, calls `create_launch` and `register_pool`, and optionally does a first buy.
   - `crank`: loops over launches; harvests fees, migrates when ready, harvests the migration fee, surplus, leftover and LP fees.
   - `redeem` CLI.
2. **Web app (Next.js + wallet adapter/Phantom)**
   - `/`: list of launches with phase, progress, price, floor.
   - `/create`: form with name, symbol, image URL, quote asset (allowlist with volatility labels), curve preset, vault share (30–70%), fixed 2% exit fee. Show a preview: start price, graduation price, floor at graduation.
   - `/t/[mint]`: phase indicator.
     - Presale: progress bar plus buy and sell on the curve; the UI routes USDC/SOL → quote via Jupiter, and two transactions are acceptable for the MVP.
     - After graduation: trade via Jupiter; **floor meter** (price vs floor, max loss if you buy now); **Redeem** button; vault stats (vault in quote and USD, supply, floor, history).
   - Disclosures on every token page:
     - the quote asset is a tracker certificate with no voting rights;
     - the issuer can pause, freeze, or move tokens via the permanent delegate;
     - the floor moves with the underlying in USD;
     - non-US self-attestation.

---

## 8. Testing requirements (thorough coverage is a hard requirement)

- **Program unit tests:** every instruction, every error path, every account-validation check.
- **Integration on a mainnet fork (Surfpool, or LiteSVM with dumped programs and cloned accounts).** Use the real DBC and DAMM v2 programs, the real SPYx mint and the token badge. Fund test wallets with SPYx via cheatcodes. Cover this flow:
  1. create config (SPYx quote, our params)
  2. create pool
  3. `create_launch` and `register_pool`
  4. multiple buys and sells
  5. harvest curve fees
  6. complete the curve (including surplus)
  7. migrate to DAMM v2
  8. harvest migration fee, surplus and leftover
  9. DAMM trades
  10. harvest LP fees
  11. redeem by several holders
  12. assert floor invariants throughout
- **Adversarial tests:**
  - redeem before migration
  - redeem with a wrong mint or wrong vault
  - a second pool on the same config
  - repeated tiny redemptions
  - a donation to the vault
  - harvest signed by a random key (must still route funds only to the vault)
  - migration fee harvested twice
  - paused quote mint (flip `paused` via cheatcode)
  - multiplier change mid-lifecycle (raw math unchanged)
  - redeeming the entire supply
- **Property/fuzz test** of the redeem math and floor monotonicity.
- **TS/SDK tests** for parameter building: curve presets, threshold conversion with multiplier, max-loss math.
- **Web app:** unit tests for display math. Add a Playwright smoke test against a local fork only if time allows (stretch).
- One command runs everything (e.g. `pnpm test` or `make test`). Report results in `docs/STATUS.md`.

---

## 9. Milestones and schedule
Local timezone of the user is about ET+7. Aim to hit checkpoints early.

| # | Milestone | Target |
|---|---|---|
| M0 | Repo setup: git init, Anchor workspace, pnpm workspace, gitignore, install Surfpool, fetch DBC/DAMM v2 IDLs, generate test keypairs in `keys/` | Tue night |
| M1 | **Fork spike:** full DBC lifecycle with a SPYx quote on a fork, with the partner `fee_claimer` = a PDA of a minimal program doing `withdraw_migration_fee` via CPI → **C1** | Tue night / Wed morning |
| M2 | `stockfloor` program complete, with unit, integration, adversarial and property tests green | Wed |
| M3 | TS SDK, `create-launch`, `crank`, `redeem` scripts, with tests | Wed night |
| M4 | Web app (create, token page, floor meter, redeem, disclosures) working against the fork | Thu |
| M5 | README (problem, how it works, diagrams, prior art table, security model, parameters, how to run), demo script, `docs/DECISIONS.md` | Thu |
| M6 | **C2 → mainnet** (needs the user): deploy program, real launch with small threshold, graduation, harvest, redeem; record Solscan links | Thu evening / Fri morning ET |
| M7 | **C3 → submission** (the user submits); the user records the video | Fri before 12:00 ET |

If M1 reveals a blocker (e.g. PDA `fee_claimer` cannot withdraw a badged Token-2022 migration fee), try this fallback first and record the decision: the fee claimer is a PDA of a thin "forwarder" instruction invoked in the same transaction. Report at C1.

---

## 10. Prior art and differentiation (for README; research 2026-09-15)

Every individual mechanism exists somewhere. **The combination was not found**:
- Meteora DBC
- a curve quoted in a stock token
- the **raise** funding (via the partner migration fee) an admin-less vault
- a permanent pro-rata burn floor in S&P 500, growing from fees, the exit fee and dividends
- DAMM v2 trading above it

Closest analogs:

| Project | What it does | Difference |
|---|---|---|
| Basket (basketrwa.fun, Solana/pump.fun) | Creator fees go to an xStock vault with burn redemption of the unassigned balance | Fee-funded and mostly paid out, so the floor stays near zero; not DBC |
| $BACKED (backed.is, Robinhood Chain) | A 3% tax buys stocks; burn for a pro-rata share; 5% exit fee retained | Fee-funded (starts at zero), single token, EVM |
| FLOOR $FLR (floorfi.app, Robinhood Chain/Pons) | Same idea as a plugin for Pons launches | Fee-funded; deployment status unclear |
| Robinpad (robinpad.app, Robinhood Chain) | "Hard NAV floor" from LP fees, buyback | Fee-funded; redemption unclear |
| hookit (github.com/deadpouule/hookit, Ink) | FloorVault `V/S` ratchet, wrapped xStock quote option | Funded by swap tax (starts at zero), admin-controlled, EVM |
| Solum (github.com/BallastSystems/solum, Solana) | Stock vault with burn redemption, fee-grown | Abandoned; never shipped; not raise-funded |
| Amplestocks (github.com/camdengrieh/amplestock, EVM) | Auction proceeds become a stock vault with NAV redemption and a 2.5% retained fee | Single index token, not a launchpad; undeployed |
| GluedLaunch / Glue (EVM testnet) | Curve raise becomes redeemable ETH collateral, then Uniswap | ETH, not stocks; dormant |
| Nautilus (github.com/zungrymukkury/nautilus, Solana) | SOL treasury; sell price = treasury/supply | No DEX market, SOL-denominated, dormant |
| Star (star.fun, Solana DBC) | 50% DBC migration fee goes to a futarchy DAO treasury | Spendable treasury, no redemption |
| daos.fun | Part of the raise goes to a fund; redemption at expiry only | Not a floor while trading; SOL |
| Juicebox cash-outs / Revnets, Baseline, NOTCH, RISE, Nirvana, MetaDAO bid wall, Moloch ragequit | The floor / cash-out mechanism family | Not stocks, not DBC |

Stock-quoted DBC landscape:
- 1,118 DBC configs quote a stock token; 1,058 of them use a 0% migration fee. None routes the raise to a redemption vault.
  - **Re-measured on chain 2026-09-16** with a committed, re-runnable scan (`scripts/research/stock-quoted-dbc-configs.ts` → `docs/research/stock-quoted-dbc-configs.json`, slot 447,385,123): **931** configs quote an xStock and **871 (93.6%)** use a 0% migration fee. The scan defines a stock token as a Token-2022 mint whose permanent delegate is the SPYx issuer authority `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq`, and the population as mints with a DBC token badge; the brief's original figures used a mint list that was not recorded, so the numbers differ. It also measures the stronger fact: **0 of the 931** pay a migration fee to a program rather than a wallet. README quotes the scan, not these figures.
- Ember (embercurve.fun) is the largest operator: about 2,720 markets, 81 graduated. It pays dividends and buys back. No floor.
- StockLaunch and Lattice: fee rewards, no floor.

Pitch context: Solana's share of tokenized-equity volume fell from ~71% to ~30% by late Aug 2026 (https://cryptobriefing.com/solana-tokenized-equity-share-drops-memecoins/). Stock-backed floors are emerging on Robinhood Chain. **We bring a stronger version, a day-one floor, to Solana.**

---

## 11. `docs/STATUS.md` format

```
# Status — <timestamp ET>
## Current milestone
## Done (with test results)
## In progress
## Blocked on user (explicit asks, what exactly is needed)
## Next
## Risks / surprises
```
Also keep `docs/DECISIONS.md`: date, decision, alternatives, reason.

---

## 12. Demo script (2–3 min video; the user records)

1. **Hook (15s):** "Most tokens go to zero. What if the money raised became a floor in the S&P 500?"
2. **Create (20s):** a creator launches a token quoted in SPYx; show the presets and the floor preview.
3. **Presale (25s):** buyers pay USDC and the progress bar fills; show the Solscan link.
4. **Graduation (20s):** the pool migrates to DAMM v2, and the vault gets 50% of the raise; the floor meter appears.
5. **Market (20s):** the price moves; "max loss if you buy now" updates.
6. **Crash and redeem (25s):** a holder redeems and receives SPYx; the floor stays the same for everyone else; show the Solscan link.
7. **Why Solana / why DBC (15s):** composable DBC migration fee → PDA vault → Token-2022 stock, all on-chain, no admin.
8. **Prior art and next steps (15s):** fee-funded floors start at zero, ours starts full; roadmap is basket vaults and yield on the vault.

---

## 13. Risks to disclose (README "Security & risks")
- **Issuer controls on the quote asset:** pause, freeze, permanent delegate, and a future transfer hook. Mitigation: disclose; handle failures cleanly; allowlist only.
- **Floor protects from zero, not from loss.** Max-loss display on buy.
- **Floor in USD moves with the underlying.**
- **Thinner market liquidity,** because part of the raise goes to the floor. This is the intended trade-off.
- **Upgrade authority:** revoke before production (hard stop — user decides).
- **Eligibility:** non-US only; tracker certificates.
- **Unaudited hackathon code.**
