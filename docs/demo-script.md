# StockFloor demo video: shot list

**Target length:** 2:35 (hard maximum 3:00). **Recorded by:** the user. **Outline:** the eight beats of the
build brief (§12).

**Status (2026-09-16).**
- UI labels below are quoted from the web app wired to the chain (`NEXT_PUBLIC_DATA_SOURCE=chain`), after the
  post-M5 review fixes. **Re-check every quoted label against the running app before recording**, and re-check
  the C2 amounts in [`research/surfpool-e2e.md`](research/surfpool-e2e.md).
- Everything marked TBD is not true yet.
- **Two things the app cannot do on camera today:** the create form fixes the graduation threshold at $1,000
  (`DEFAULT_THRESHOLD_USD`), and Jupiter routing (paying with USDC or SOL) has never been exercised against
  the live API. Scenes 2, 3 and 5 below take that into account.

**Environment tags used in every scene:**

| Tag | Meaning |
|---|---|
| `MAINNET (C2)` | Needs the mainnet deploy and a real demo launch. This is the preferred take: Meteora's bounty says "working code on mainnet beats slides". |
| `FORK` | Can be recorded on the local Surfpool mainnet fork. Every fork shot must carry the overlay "Local mainnet fork", so nobody mistakes it for mainnet. |
| `ANY` | Static screens: the home page, the README, diagrams. |

---

## 0. Before recording

### 0.1 Mainnet take (preferred)

- [ ] **C2 done.** `stockfloor` deployed on mainnet (program link TBD (C2)). The upgrade-authority decision is
      made by the user (TBD (C2)).
- [ ] **Demo launch: threshold $50 in SPYx, created with the CLI.** The C2 plan funds about $53 of SPYx in
      total (`research/surfpool-e2e.md` §3 and §7), and the create form fixes the threshold at $1,000, which
      those funds cannot graduate. So the **mainnet** launch is created with
      `packages/sdk/scripts/run.sh create-launch --threshold-usd 50 …` (§9 of that document), and scene 2
      records the form and its live preview plus a short terminal shot of the CLI.
  - If the app gains a threshold control (or a build-time default) before C2, record scene 2 entirely in the
    app instead and drop the terminal shot.
  - On the **fork** take the form works as is: the faucet funds enough SPYx for a $1,000 launch.
  - Meteora keepers reportedly auto-migrate stock-quoted pools only from about $750. At $50 our crank
    migrates (`migration_damm_v2` is permissionless), which is what the demo shows.
- [ ] **Dedicated demo wallets only.**
  - The five C2 keypairs under `keys/` (deployer, creator, buyer1, buyer2, cranker), funded per
    `research/surfpool-e2e.md` §7: 2.84 SOL and 8,020,000 raw SPYx in total. A third buyer or a separate
    "crash" seller needs its own SOL and SPYx.
  - **Funded with SPYx, not USDC:** the CLI and the demo pay in SPYx.
  - Never show a seed phrase, a private key or a personal wallet on screen.
- [ ] **Crank ready.** `packages/sdk/scripts/run.sh crank --keypair keys/cli-cranker.json --launch <addr>`,
      or the app's **Run crank** button. After the completing buy it runs `harvest_curve_fees`,
      `harvest_migration_fee`, `harvest_surplus`, DBC `migration_damm_v2` and `sync_migration` (5
      transactions), and `harvest_lp_fees` later.
- [ ] **Links.** The [Solscan links table](#3-solscan-links-to-record-c2) is filled in, and each link is open
      in its own browser tab before recording.
- [ ] **Browser setup.**
  - Phantom (or another wallet-standard wallet) connected to the demo wallet.
  - App on the live URL (TBD (C3)), browser zoom 110–125%.
  - OS notifications off; no other tabs with personal data.
- [ ] **Attestation.** The non-US attestation is stored per browser. Untick it before the take so scene 3 can
      show it once.

### 0.2 Local fork take (fallback or rehearsal)

- [ ] **Surfpool fork running locally.**
      `STUDIO=1 FUND_WALLETS="<demo pubkeys>" FUND_SOL=10 FUND_SPYX=3 bash scripts/surfpool/up.sh` starts the
      fork, deploys `stockfloor` with `keys/deployer.json` and funds the demo wallets with SOL and SPYx.
      The app's own faucet (`/api/faucet`, loopback only) tops a connected wallet up from the page.
  - Verified not to relay transactions to mainnet before anything is sent (`research/surfpool.md`, and every
    rehearsal re-checks it).
- [ ] **App against the fork.**
  - `NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 NEXT_PUBLIC_DATA_SOURCE=chain pnpm --filter @stockfloor/app dev`
  - The header network badge reads "Local fork".
- [ ] **No Jupiter on the fork** (its APIs are mainnet-only).
  - In "Pay with", choose **SPYx**, not USDC or SOL. The panel then says "Trades SPYx directly against the
    Meteora DAMM v2 pool."
  - Scene 5 moves the price with the app's own market panel (a SPYx buy and a sell), no extra script.
- [ ] **No Solscan.** Show transactions in Surfpool Studio, the local UI on `http://127.0.0.1:18488` when
      started with `STUDIO=1`, or show the signature in the app (TBD which).

### 0.3 Rules for the voiceover

- **Say "protects from zero, not from loss".** Never say "guaranteed", "risk-free" or "can't lose".
- **Graduation.** Say "half of the raise goes to the vault" only together with the setting "at the default 50%
  vault share". On-chain, the amount is 50% of the threshold, `T − ceil(T × 50 / 100)`.
- **After a redemption,** the floor for everyone else "does not go down; the 2% exit fee nudges it up". Do not
  say it "stays exactly the same".
- **Lower-third overlay in scene 1 and the last scene:** "Not for US persons · Unaudited hackathon code".

---

## 1. Shot list

### Scene 1: Hook · 0:00–0:15 · `ANY`

| | |
|---|---|
| **Screen** | `/`, the home page. Hero headline "Token launches with a floor in tokenized S&P 500" |
| **Actions** | 1. Hold on the hero for 3 s. 2. Slow scroll to the "How it works" card (Presale on a bonding curve → Graduation → Free market with a floor). |
| **Voiceover** | "Most tokens go to zero. What if the money raised became a floor in the S&P 500? StockFloor is a launchpad on Meteora's Dynamic Bonding Curve where every token gets a hard floor in tokenized stocks from day one." |
| **Overlay** | Lower third, 2 s: "Not for US persons · Unaudited hackathon code" |
| **Proof** | — |

### Scene 2: Create · 0:15–0:35 · `MAINNET (C2)` or `FORK`

| | |
|---|---|
| **Screen** | Click **"Launch a token"** (or **Create** in the header) to open `/create` |
| **Actions** | 1. **Name:** `StockFloor Demo`, **Symbol:** `SFDEMO` (a clearly fictional demo token). 2. **Quote asset:** keep **SPYx** and point at its "calm" tag. 3. **Curve preset:** **Gentle**. 4. Drag **"Share of the raise locked in the floor vault"** from 50% to 70%, then back to 50%. Keep the right-hand preview in frame: "Floor at graduation", "Floor vs graduation price", "Max loss at graduation price". 5. Point at **Fixed terms**: Exit fee 2%, Graduation threshold, Curve trading fee 1%, Team allocation None. 6. Click **"Launch token"** and approve in the wallet. |
| **Expected preview values** | From the SDK formula `floor / price = f / (√r + 1 − f)`. Gentle at 50%: floor ≈ 31% of the graduation price, max loss ≈ 69%. Gentle at 70%: ≈ 50% and ≈ 50%. If the app shows something else, stop and report it. |
| **Voiceover** | "A creator launches a token quoted in SPYx, on a gentle IPO-style curve. They choose how much of the raise becomes the floor: at fifty percent, the preview shows the floor at graduation and the maximum loss for a buyer at the opening price. No team allocation, no free tokens." |
| **Proof** | Solscan: DBC config creation and `create_launch` transactions, TBD (C2) |

### Scene 3: Presale · 0:35–1:00 · `MAINNET (C2)` for USDC; `FORK` with SPYx

| | |
|---|---|
| **Screen** | `/t/<mint>`, the token page. Phase stepper on **Presale** |
| **Actions** | 1. Scroll to **Disclosures** and tick "I confirm that I am not a US person…". Scroll back up. 2. In **"Trade on the curve"**, choose **Buy**, keep "Pay with" on **SPYx**, enter an amount and click the buy button (its label reads `Price $X · Floor at graduation (est.) $Y · Max loss if it graduates: −Z%`). Approve. 3. Cut to the second buyer wallet (pre-staged) that buys again. 4. Show **"Progress to graduation"** filling, plus "Floor at graduation (est.)" and "Vault at graduation". |
| **Voiceover** | "Buyers pay in SPYx, tokenized S&P 500, straight into the bonding curve. The raise stays in SPYx inside the DBC pool, and the partner share of every trading fee is already flowing into this token's vault." |
| **If Jupiter is exercised first** | The "Pay with" selector also offers USDC and SOL, routed through Jupiter (mainnet only). That path has never been run against the live API, so test it with a small amount before recording, or keep SPYx. |
| **Proof** | Solscan: a curve buy transaction and the DBC pool account, TBD (C2) |

### Scene 4: Graduation · 1:00–1:20 · `MAINNET (C2)` or `FORK`

| | |
|---|---|
| **Screen** | Token page, then Solscan |
| **Actions** | 1. A pre-staged buyer makes the completing buy. The page shows the progress at 100% and the message "The raise is complete. Next, the pool migrates to Meteora DAMM v2 and the vault share is harvested (Meteora keepers or anyone running the crank). Redemption opens as soon as the vault is funded." 2. Click **"Run crank (5 steps)"** in the permissionless crank card and approve each step (or a 2 s terminal shot of `run.sh crank`): harvest curve fees, harvest the migration fee, harvest the surplus, migrate to DAMM v2, record the migration. 3. Refresh: the stepper shows the floor live, and the **"Price and floor"** card appears with the floor meter. 4. Solscan, `harvest_migration_fee` transaction: highlight the SPYx transfer from the DBC quote vault into the StockFloor vault, 50% of the threshold, signed by our claimer PDA through CPI. 5. Solscan, DAMM v2 position NFT account: owner is the claimer PDA, and the position is permanently locked. |
| **Voiceover** | "The curve hits its threshold and graduates. A permissionless crank migrates the pool to Meteora DAMM v2 with all liquidity locked forever, and our program pulls the migration fee — half the raise by default — into the vault. The floor is live." |
| **Proof** | Solscan: completing buy, `migration_damm_v2`, `harvest_migration_fee`, DAMM v2 pool, position NFT account. All TBD (C2) |

### Scene 5: Market · 1:20–1:40 · `MAINNET (C2)` (Jupiter); fork variant below

| | |
|---|---|
| **Screen** | Token page, "Buy on the market" panel. With "Pay with" on SPYx it says "Trades SPYx directly against the Meteora DAMM v2 pool."; with USDC or SOL, "Routed through Jupiter to the Meteora DAMM v2 pool." |
| **Actions** | 1. Zoom on the buy button label **"Price $X · Floor $Y · Max loss if you buy now: −Z%"**. 2. A pre-staged wallet buys through the panel with SPYx; approve. 3. After the refresh, point at the higher price and the larger "Max loss if you buy now". |
| **Voiceover** | "Now the token trades freely, and the price can run far above the floor. The buy button always tells the truth: the price, the floor, and your maximum loss if you buy right now." |
| **Fork variant** | Identical, with SPYx selected (Jupiter is mainnet-only). |
| **Proof** | Solscan: the market buy transaction, TBD (C2) |

### Scene 6: Crash and redeem · 1:40–2:05 · `MAINNET (C2)` or `FORK`

| | |
|---|---|
| **Screen** | Token page, then Solscan, then the "Vault" card |
| **Actions** | 1. The pre-staged "crash" wallet sells a large amount, and the price on the floor meter drops toward the floor. 2. As a holder, open **"Redeem at the floor"**. Enter an amount in "Amount to redeem" and show "Share of the vault", the exit fee "(stays in the vault)", **"You receive"**, "Selling at market instead (est.)" and "Floor for remaining holders". 3. Click **"Redeem for N SPYx"** and approve. 4. Solscan, redeem transaction: the base-token burn and the SPYx transfer from the vault to the holder, signed by the vault-authority PDA. 5. Back on the **Vault** card: "Floor per token" did not drop. |
| **Voiceover** | "Then the market crashes. A holder doesn't have to sell into it: they burn their tokens and receive their share of the vault in SPYx, minus a two percent exit fee that stays in the vault. The floor for everyone else doesn't go down — the fee nudges it up." |
| **Proof** | Solscan: the crash sell and the redeem transaction, TBD (C2) |

### Scene 7: Why Solana, why DBC · 2:05–2:20 · `ANY`

| | |
|---|---|
| **Screen** | The README "Where the money goes" diagram rendered on GitHub (repository link TBD (C3)), or the same diagram as a slide |
| **Actions** | Slow pan along the arrows: curve fee split → vault; migration fee → vault; DAMM v2 LP fees → vault; redeem. |
| **Voiceover** | "This only works because it all composes on Solana: a DBC migration fee routed to a program-owned vault, a Token-2022 stock that passes dividends through its multiplier, and no admin key anywhere near the floor." |
| **Proof** | — |

### Scene 8: Prior art and next steps · 2:20–2:35 · `ANY`

| | |
|---|---|
| **Screen** | README "Prior art and differentiation" table, then "Roadmap" |
| **Actions** | Scroll the prior-art table; stop on the StockFloor row. Cut to the roadmap. |
| **Voiceover** | "Other stock-backed floors are funded by fees, so they start at zero. Ours starts with a share of the raise. Next up: basket vaults and yield on the vault. StockFloor: the floor ships on day one." |
| **Overlay** | End card: repository link (TBD (C3)), live app (TBD (C3)), "Not for US persons · Unaudited hackathon code" |
| **Proof** | — |

---

## 2. Which parts need mainnet

| Scene | `MAINNET (C2)` needed for | Works on `FORK` |
|---|---|---|
| 1 Hook | — | yes (`ANY`) |
| 2 Create | Solscan links; the launch itself is created with the CLI at the $50 threshold | yes, the form's $1,000 threshold is affordable on the fork |
| 3 Presale | Solscan links; Jupiter routing only if that path is tested first | yes, paying SPYx directly |
| 4 Graduation | Solscan links; real Meteora keeper behaviour | yes (our crank migrates) |
| 5 Market | Solscan links | yes, SPYx buy in the market panel |
| 6 Crash and redeem | Solscan links | yes |
| 7 Why Solana | — | yes (`ANY`) |
| 8 Prior art | — | yes (`ANY`) |

## 3. Solscan links to record (C2)

Fill this in during C2 and copy the links into the README status table.

| Item | Link | Scene |
|---|---|---|
| `stockfloor` program | TBD (C2) | 7, end card |
| DBC config of the demo launch | TBD (C2) | 2 |
| `create_launch` transaction | TBD (C2) | 2 |
| DBC virtual pool | TBD (C2) | 3 |
| Curve buy transaction | TBD (C2) | 3 |
| Completing (PartialFill) buy | TBD (C2) | 4 |
| `migration_damm_v2` transaction | TBD (C2) | 4 |
| `harvest_migration_fee` transaction | TBD (C2) | 4 |
| Vault token account | TBD (C2) | 4, 6 |
| DAMM v2 pool | TBD (C2) | 4, 5 |
| Position NFT account (owner = claimer PDA) | TBD (C2) | 4 |
| Market buy (DAMM v2 through the app) | TBD (C2) | 5 |
| Crash sell | TBD (C2) | 6 |
| `redeem` transaction | TBD (C2) | 6 |
| `harvest_lp_fees` transaction (optional B-roll) | TBD (C2) | 7 |

## 4. If something fails on camera

- **SPYx is paused** (for example around a multiplier activation, when xStocks asks venues to pause about ±15
  minutes). Harvests and redemptions fail with "Quote mint is paused by its issuer" and nothing changes.
  Wait and retake. This can itself be a short honest B-roll: "the issuer can pause; nothing breaks".
- **The completing buy fails with `InsufficientLiquidity`.** The buy was exact-in across the migration price.
  Retry in PartialFill mode.
- **Redeem is disabled after migration.** The migration fee is not harvested yet
  (`MigrationFeeNotHarvested`). Run the crank.
- **A Jupiter route is missing** for a brand-new pool. Pay with SPYx (the default for the demo) or record
  scene 5 on the fork and label it.
- **The crank stops after a rejected wallet prompt.** Click "Run crank" again: it re-plans from chain state
  and only sends what is still due.
