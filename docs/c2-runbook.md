# C2 runbook — the mainnet run

**Executed on mainnet on 2026-09-16.** The run and its every signature are in
[`../scripts/c2/reports/c2-20260916T071644Z.md`](../scripts/c2/reports/c2-20260916T071644Z.md); four guards had to be
taught to poll a load-balanced RPC before it completed (see `docs/DECISIONS.md`). What follows is the plan it
executed, still accurate for a repeat run. It is the plan the user approves, and the
scripts that run it. The whole sequence was rehearsed on a live Surfpool mainnet fork
(`docs/research/surfpool-e2e.md`) and the runbook's own scripts were verified with a dry run on the
current binary, 2026-09-16 (`scripts/c2/reports/dry-20260916T020703Z.md`: 15 lifecycle transactions
plus a 481-transaction deploy, 0 of 503 local signatures on mainnet).

| | |
|---|---|
| What it does | Deploys the `stockfloor` program, launches a $50-threshold demo token quoted in SPYx, graduates it into a DAMM v2 pool with a redeemable floor, trades it, harvests LP fees and redeems twice |
| Mainnet transactions | **495**: 481 program-deploy transactions + 14 lifecycle transactions |
| Cost | **≈ 2.62 SOL** (2.57 of it recoverable program rent) **+ ≈ $53 of SPYx**, of which ≈ $15 comes back to the demo wallets |
| Duration | ≈ 10 minutes of machine time; plan **30–45 minutes** with the confirmation prompts and the checks |
| Irreversible | program rent, real SPYx spent, immutable token metadata, permanently locked LP position |
| Approval | the marker file `keys/c2-approved` (the command is in §1) |

---

## 1. What the user approves

Three things, in one decision:

1. **Spending real funds** — 5.19 SOL and 0.0806 SPYx sent to the dedicated repo wallets (§3), of
   which ≈ 2.62 SOL and ≈ $53 of SPYx are actually used by the run.
2. **A permanent mainnet footprint** — the deployed program, the launch's token and metadata, the
   DBC pool and the migrated DAMM v2 pool with a permanently locked LP position (§7).
3. **Three open decisions:**

   | Decision | Default in this runbook | Alternatives |
   |---|---|---|
   | Mainnet RPC | the user's choice, passed as `MAINNET_RPC_URL`; the public endpoint is enough for the 14 lifecycle transactions but is slow and rate-limited for the 479 deploy writes | any private RPC; add `--use-rpc` if QUIC/TPU is blocked on the network |
   | Token metadata JSON (`TOKEN_URI`) | **must be provided by the user** — hosting it is publishing, a hard stop | any https URL; the length only affects the metadata rent (88 characters → 607 bytes) |
   | Program IDL upload | **not uploaded** (not rehearsed, Anchor refuses localnet) | upload later for 0.03–0.12 SOL |
   | Upgrade authority | **kept** with the deployer, and disclosed in the app | revoking is a separate hard stop, planned for C3 at the earliest |

**Approval command** (the user runs it themselves; `keys/` is gitignored, so the marker never leaves
the machine):

```bash
printf 'C2 approved %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > keys/c2-approved
```

`scripts/c2/run.sh --mainnet` refuses to start without that file, and also without
`--allow-mainnet`, `STOCKFLOOR_ALLOW_MAINNET=1`, `MAINNET_RPC_URL`, `TOKEN_URI` and a preflight
verdict of GO.

**One marker, one run.** The run records the marker's sha256 in its own state. A *new* mainnet run
refuses to start on a marker that already authorised an earlier one, and names it: resuming that run
(`--resume <run id>`) is always allowed, while a second full run needs the user to write the marker
again. Nothing but the user ever creates or changes `keys/c2-approved`.

---

## 2. Preflight (read-only, run it as often as you like)

```bash
MAINNET_RPC_URL="<the RPC the user chose>" \
  packages/sdk/node_modules/.bin/tsx scripts/c2/preflight.ts
```

It sends nothing: its JSON-RPC client has a read-only method allowlist (no `sendTransaction`, no
`requestAirdrop`, no `simulateTransaction`), and the only other calls are Jupiter Price V3 and the
read-only amount planner. Verdict `GO` exits 0, `NO-GO` exits 3.

Real output against mainnet before funding (2026-09-16 01:55 UTC, public endpoint, 2.5 s; the funding rows are
red as expected and the approval marker is the user's):

```
StockFloor C2 preflight — read-only, nothing is sent
2026-09-16T01:55:33.123Z · rpc https://api.mainnet-beta.solana.com · threshold $50 · priority fee 100,000 µlamports/CU

STATUS  CHECK               DETAIL
GO      mainnet RPC         https://api.mainnet-beta.solana.com healthy, solana-core 4.3.0-rc.0, slot 447,402,568, genesis mainnet
GO      stockfloor.so       459,064 bytes, sha256 9fd9a0a8fc80cbfe… = the rehearsed binary (20260916T000744Z)
GO      program keypair     keys/stockfloor-program.json = 98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA (declare_id!)
GO      deploy buffer       keys/stockfloor-deploy-buffer.json exists but GLjqCV1f… holds no account on this cluster: the deploy writes a fresh buffer at that address
GO      program id free     98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA does not exist yet
GO      deploy cost         2.574004 SOL = programdata rent 2.570627 SOL (max-len 505,856 + 45 B at 5,080 lamports/byte) + program account 0.000833 SOL + 481 tx fees 2,543,472 lamports
GO      SPYx mint           not paused, no transfer hook, multiplier 1.005714560286254, 8 decimals, supply 9,523,191,354,017
GO      SPYx price          $754.6075 per SPYx (Jupiter Price V3), multiplier 1.005714560286254 → threshold $50 = 6,588,312 raw (0.06588312 SPYx)
NO-GO   deployer funded     BBU1tTr4… has 0.000000 SOL; needs 2.574004 SOL + 2.332924 SOL to repair a bad deploy by upgrade, recommended 5.008408 SOL
NO-GO   creator funded      EFSrr7pe… 0.000000 SOL (need 0.032151 SOL, rec. 0.060000 SOL), SPYx 0 raw (need 665,486, rec. 732,035)
NO-GO   buyer1 funded       ED77vdfS… 0.000000 SOL (need 0.001528 SOL, rec. 0.020000 SOL), SPYx 0 raw (need 3,324,103, rec. 3,656,514)
NO-GO   buyer2 funded       5Wgdkguw… 0.000000 SOL (need 0.001528 SOL, rec. 0.020000 SOL), SPYx 0 raw (need 3,327,431, rec. 3,660,175)
NO-GO   cranker funded      FhaZVX91… 0.000000 SOL (need 0.018133 SOL, rec. 0.040000 SOL)
GO      DBC binary          dbcij3LW… sha256 4c26a8a5da99f8ce… = tests/fixtures (2,326,577 bytes)
GO      DAMM v2 binary      cpamdpZC… sha256 4d5b920baebc090f… = tests/fixtures (2,174,352 bytes)
GO      priority fees       planned 100,000 µlamports/CU vs the last 150 slots: cluster p50 0 / max 0, DBC+DAMM accounts p50 0 / p90 0 / max 10,001
GO      timing window       01:55 UTC, outside the 00:15–00:45 UTC xStocks multiplier window
WARN    user approval       keys/c2-approved is missing: run.sh --mainnet refuses to start until the user creates it
WARN    token metadata URI  TOKEN_URI is unset or not an https URL: the user must choose and host the metadata JSON (publishing is a hard stop)

VERDICT: NO-GO — 19 checks, 2 warning(s), 5 blocker(s)
blockers: fund-deployer, fund-creator, fund-buyer1, fund-buyer2, fund-cranker
```

The SPYx amounts move with the price: they are recomputed from the live quote on every run, which is why they differ
slightly from the funding table in §3 (that one carries the +10% headroom).

| Check | Blocks the run when |
|---|---|
| mainnet RPC | the endpoint is unreachable, or is not the expected cluster. A surfnet is recognised by `getVersion().surfnet-version`, whatever its host name, and is a blocker for a mainnet run; `--expect-cluster surfnet` turns it round for the dry run, where real mainnet is the blocker |
| stockfloor.so | the local binary is not the rehearsed one (sha256 from the newest `scripts/e2e/reports/<run id>.json`). `--expect-sha <hex>` accepts another hash, and then the row can only be a warning |
| program keypair | `keys/stockfloor-program.json` is not the declared program id |
| deploy buffer | `keys/stockfloor-deploy-buffer.json` has an on-chain account holding a **different** binary, or one the deployer may not write to. A buffer that holds a prefix of this binary is a GO: it is an interrupted deploy, and re-running resumes into it (§6.1). The row says how many bytes are already written |
| program id free | `98NLry…` already exists with a different binary (an identical one only warns: the deploy is then skipped) |
| deploy cost / rent | never blocks; warns when mainnet rent rose above the rehearsed 2.5740 SOL |
| SPYx mint | the mint is paused, or a transfer hook appeared (unsupported, documented limitation) |
| SPYx price | never blocks; warns when Jupiter is unreachable or the price moved > 2% from the planned amounts |
| funding | any wallet holds less than the measured requirement |
| DBC / DAMM v2 binary | Meteora upgraded a program since `tests/fixtures` was dumped, so the rehearsal evidence is stale (override: `--accept-program-drift`) |
| priority fees | never blocks; warns when the planned fee is below recent levels |
| timing window | never blocks; warns inside 00:15–00:45 UTC, when xStocks may pause around a multiplier activation |
| approval / TOKEN_URI | never blocks the preflight (`run.sh --mainnet` enforces both) |

---

## 3. Funding table

These are the balances every wallet must hold **before** the run. They can be sent from the user's
own wallet (SPYx directly, not USDC — the sequence pays in SPYx), but the intended route is §3.1:
the user funds the **deployer** alone, and `scripts/c2/fund.ts` spreads the SOL and buys the SPYx in
one gated, idempotent command. The SPYx column is the rehearsal plan + 10% for price moves; the
preflight and the funding script both recompute the exact requirement from the live price.

| Wallet | Address | Key file | Send SOL | Send SPYx (raw / as wallets show it) |
|---|---|---|---:|---:|
| deployer | `BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV` | `keys/deployer.json` | **5.05** | — |
| creator | `EFSrr7pe6fJqRLXWMBYzNCJj2uVBxtn9fxYM91U2vY5f` | `keys/cli-creator.json` | **0.06** | **740,000 / 0.00744 SPYx** |
| buyer1 | `ED77vdfSwwJzrvQqUo7RtQRYsMA3bGSP213ZEBoBin99` | `keys/cli-buyer1.json` | **0.02** | **3,660,000 / 0.03681 SPYx** |
| buyer2 | `5WgdkguwV2EcLuPE8sGCjrRqcxXui5kbkaxdHE4viAJJ` | `keys/cli-buyer2.json` | **0.02** | **3,660,000 / 0.03681 SPYx** |
| cranker | `FhaZVX91912MJTxoPDW3JtmbeDEuZdRjDQ9QfkaWohyC` | `keys/cli-cranker.json` | **0.04** | — |
| **Total** | | | **5.19 SOL** | **8,060,000 raw = 0.0806 SPYx (≈ $61)** |

- The sender also pays ≈ 0.0047 SOL to create the three SPYx token accounts.
- Buying 0.0806 SPYx through Jupiter costs about **$62 of USDC**.
- **Why the deployer gets 5.05 SOL when the deploy costs 2.574.** `solana program deploy` verifies
  the deployed ELF only after the rent is spent. If that check fails, the only non-destructive
  repair is an upgrade, which needs 2.3329 SOL available at once (refunded when it lands; the
  preflight prints the exact figure it computed from the live rent). Funded with 2.70 the only way
  out is `solana program close`, which is irreversible and a hard stop.
  After a clean deploy the extra 2.48 SOL is untouched and can be swept back. The preflight requires
  the headroom by default; `--no-upgrade-headroom` drops it to a warning.
- Re-check the rent before funding (read-only): `solana rent 505901`. It was 5,080 lamports/byte on
  2026-09-16; the recommendation carries about 5% headroom.
- Full derivation: `docs/research/surfpool-e2e.md` §7.

### 3.1 Spreading it from the deployer — `scripts/c2/fund.ts`

The user funds **one** wallet. `keys/deployer.json` (`BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV`)
was funded with **6.108 SOL** on 2026-09-16. `scripts/c2/fund.ts` is the single command that turns
that into the table above: it spreads the SOL to the four demo wallets, buys the SPYx through
Jupiter, creates the three SPYx token accounts and transfers each wallet its share. Nothing else in
the repo moves funds between the wallets.

**Check the plan first — read-only, any time, no switches:**

```bash
packages/sdk/node_modules/.bin/tsx scripts/c2/fund.ts --rpc "$MAINNET_RPC_URL" --plan-only
```

**Run it** (this spends real money; it is the step the user approves together with §1):

```bash
export MAINNET_RPC_URL="<the RPC the user chose>"
export STOCKFLOOR_ALLOW_MAINNET=1
packages/sdk/node_modules/.bin/tsx scripts/c2/fund.ts \
  --rpc "$MAINNET_RPC_URL" --allow-mainnet --yes-i-am-spending-real-money
```

It stops twice and waits for `yes`: once on the whole plan, and once after the test swap. Run the
identical sequence against a local mainnet fork first with `bash scripts/c2/fund-fork-test.sh`.

**The stages**, in order; each is confirmed on chain and written to the run state before the next one
starts, so a crash can never lose track of what already moved:

| # | Stage | What it sends | Idempotent because |
|---:|---|---|---|
| 1 | `sol:creator` … `sol:cranker` | one `System::Transfer` per wallet, topping it up to its target (0.06 / 0.02 / 0.02 / 0.04 SOL) | a wallet already at or above its target is skipped |
| 2 | `ata:deployer` | the deployer's own SPYx token account | skipped when the account exists |
| 3 | `swap:test` | a **≈ $5** Jupiter swap (SOL → SPYx), then the received amount is read back from chain and checked against the accepted range and printed | the deployer's SPYx balance is re-read; what the test swap bought counts toward the requirement |
| 4 | — | **second confirmation**, showing exactly what the rest of the swap will cost | — |
| 5 | `swap:main` | the remaining SPYx, sized against the quote so the output lands in [needed, needed + 2%] | only the shortfall against the deployer's balance is bought |
| 6 | `ata:creator` … `ata:buyer2` | `ATA::CreateIdempotent`, rent paid by the deployer (≈ 0.00156 SOL each on mainnet) | skipped when the account exists |
| 7 | `spyx:creator` … `spyx:buyer2` | `Token-2022::TransferChecked` of each wallet's SPYx | a wallet already holding its target is skipped |
| 8 | `verify` | nothing — re-reads every balance from chain, prints the end-state table and **exits non-zero on any shortfall** | — |

**How much it moves** (measured by `--plan-only` against mainnet, 2026-09-16 05:25 UTC, SPYx
$757.81, SOL $97.09):

| | |
|---|---:|
| SOL to the four wallets | 0.140000 SOL ($13.59) |
| SPYx to buy (8,060,000 raw = 0.0806 SPYx) | ≈ 0.6516 SOL ($61.43) |
| Rent for 4 SPYx token accounts | 0.006238 SOL |
| Fee buffer | 0.005000 SOL |
| **Total off the deployer** | **≈ 0.8029 SOL ≈ $77.47** |
| **Deployer afterwards** | **≈ 5.3051 SOL** (floor **5.05**) |

The SPYx target of each wallet is the **larger** of the rehearsed plan in §3 and the live requirement
recomputed the way the preflight computes it (`scripts/e2e/plan.ts pre-launch` against the live
Jupiter price) **+ 10%**, so a price move between funding and launch cannot underfund the run. At the
price above the rehearsed plan is the larger of the two; a 30% SPYx drop would make the live figure
win. The swap is sized 1% over the requirement, so the deployer keeps ≈ 0.7% of the SPYx (≈ $0.50) as
a leftover — it stays in the deployer's token account and is reported as such.

**The gate.** Sending on mainnet needs **all four** of: `--allow-mainnet`,
`STOCKFLOOR_ALLOW_MAINNET=1` (together these are the SDK send guard of `packages/sdk/src/guard.ts`,
reused unchanged), a **non-loopback `--rpc` that really is mainnet**, and
`--yes-i-am-spending-real-money`. It deliberately does **not** require `keys/c2-approved`: that
marker authorises the C2 run itself (§1), not the funding. On top of that the script refuses to
start when the plan would leave the deployer under the 5.05 SOL the deploy needs, when the deployer
cannot pay for the plan at all, when a `keys/` file no longer derives the address this table names,
when SPYx is paused or has grown a transfer hook or transfer fee, and when a Jupiter route's implied
price is more than **2%** (`--max-deviation-bps`) from the Jupiter Price V3 mid. Both swaps carry a
hard **50 bps** slippage cap (`--slippage-bps`) and a minimum-received assertion checked against the
balance the chain actually shows. The RPC URL is never printed or written to the report
(`rpcDisplay`), and only keypairs under `keys/` can be loaded.

**What the fork test proves, and what it cannot.** `bash scripts/c2/fund-fork-test.sh` runs the whole
command against a local Surfpool mainnet fork (RPC 127.0.0.1:58899, WS 58900) with the deployer set
to the same 6.108 SOL and the demo wallets empty, and stops the surfnet afterwards. Committed
evidence: `scripts/c2/reports/fund-dry-20260916T054016Z.md` — **11 transactions** (4 SOL transfers, 4
token accounts, 3 SPYx transfers; on mainnet the two swap stages add 2 more), end state all `OK`,
deployer 6.108 → 5.3019 SOL.
The test also asserts the refusals (deploy floor, deployer too poor, the mainnet override pointed at
a loopback RPC, Jupiter asked for on a fork) and the recovery paths.
**The Jupiter swap path itself is only exercised on mainnet**: Jupiter has no local fork, so
`--swap-provider cheat` replaces it with a Surfpool cheatcode that mints the SPYx at the live mid
price and charges the SOL. Everything around the swap — the sizing, the quote checks, the deviation
and slippage caps, the received-amount assertion, the second confirmation, the resume logic — runs
the same code on the fork as on mainnet; the quote request, the signature and the
`POST /ultra/v1/execute` do not. A Jupiter **quote** was fetched read-only against mainnet while this
was written (0.6 SOL → 7,612,126 raw SPYx, 14 bps from the Price V3 mid, route SOL → USDC → SPYx),
which is what the checks are calibrated against.

**If it dies midway.** Run exactly the same command again.

- Every stage recomputes what is missing **from the balances it reads**, not from the state file, so
  the only effect of a resume is that the missing transfers are sent. Proved on the fork by deleting
  the state file and wiping one wallet's SPYx: the run topped that wallet up and touched nothing
  else.
- The state file `target/c2/fund/<mainnet|fork>.json` (gitignored) carries the run id, every stage,
  every signature and the prices used, and is rewritten after every confirmed transaction. The
  report `scripts/c2/reports/fund-<run id>.md` is rewritten at the same points, so an interrupted run
  still leaves a complete log.
- A swap is the one stage that could have landed while the process was dying. It is marked `pending`
  with the pre-swap SPYx balance **before** the transaction is signed; on the next run that balance
  decides: if the deployer gained SPYx, the stage is recorded as landed and not repeated; if it did
  not, the swap is re-quoted. Either way the next swap only buys the shortfall, so a double spend
  would have to survive both the balance check and the plan's deployer floor.
- If the state file is lost entirely, nothing breaks: the run starts a new run id and, because the
  wallets are already funded, sends nothing. The one cost is that the ≈ $5 test swap is repeated —
  and even that SPYx counts toward the requirement rather than being wasted.
- A resume that would have to buy SPYx again while the deployer is near 5.05 SOL is **refused**, not
  half-done: the deploy money is never spent on a repair. Top the deployer up and re-run.
- After a successful funding, `scripts/c2/preflight.ts` is the independent check: all five funding
  rows must turn `GO`.

---

## 4. The run

### 4.1 Dry run first (no approval needed, nothing leaves the machine)

```bash
bash scripts/c2/run.sh --yes                     # fresh local Surfpool fork on 127.0.0.1:8899, ~2 minutes
bash scripts/c2/run.sh --yes --rpc-port 48899    # on another port, when 8899 is taken
```

It runs the identical sequence against a local mainnet fork: same commands, same amounts, same
guards, same report format. It funds the demo wallets with Surfpool cheatcodes, and at the end
verifies that **none** of the local signatures exist on mainnet, then stops the surfnet.

Three separate things keep a dry run local, and all three are load-bearing:

1. it never sets the mainnet override switches, so the SDK send guard accepts only a loopback
   Surfpool surfnet;
2. the preflight classifies the endpoint and the run **aborts unless it is a surfnet** (`getVersion`
   must report `surfnet-version`);
3. `scripts/e2e/setup.ts mainnet-rent` writes the Rent sysvar through a Surfpool-only cheatcode, so
   it fails against anything that is not a surfnet — including a mainnet RPC behind a loopback
   tunnel.

The last committed dry run is `scripts/c2/reports/dry-20260916T020703Z.md` (the `--rpc-port 48899`
form, which is why its cluster row names that port).

### 4.2 Mainnet run

```bash
export MAINNET_RPC_URL="<the RPC the user chose>"
export TOKEN_URI="<the metadata JSON URL the user hosts>"
export STOCKFLOOR_ALLOW_MAINNET=1
printf 'C2 approved %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > keys/c2-approved   # the user

bash scripts/c2/run.sh --mainnet --allow-mainnet
```

The script stops before each step and prints what it is about to send — the step, the amount and the
wallet that pays it — then asks: answer `yes`, `skip` or `abort` (case does not matter; anything else
is asked again rather than treated as an answer). `--yes` runs unattended (not recommended for the
first mainnet run).

What it does, in order — each row is exactly the command the rehearsal and the dry run executed:

| # | Step | Command behind it | Txs | Signer |
|---:|---|---|---:|---|
| 1 | `deploy` | `solana program deploy … --max-len 505856 --with-compute-unit-price 100000` | 481 | deployer |
| 2 | `create-launch` | SDK `create-launch --threshold-usd 50 --preset gentle --vault-share 50 --exit-fee-bps 200 --first-buy …` | 2 | creator |
| 3 | `buy1` | SDK `buy --raw <45% of the threshold>` | 1 | buyer1 |
| 4 | `buy2` | SDK `buy --raw <50% offer>` (PartialFill completes the curve) | 1 | buyer2 |
| 5 | `crank-graduate` | SDK `crank` → `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus`, DBC `migration_damm_v2`, `sync_migration` | 5 | cranker |
| 6 | `damm-buy` | SDK `buy --raw <5% of the threshold>` on DAMM v2 | 1 | buyer1 |
| 7 | `damm-sell` | SDK `sell --raw <25% of its balance>` on DAMM v2 | 1 | buyer2 |
| 8 | `crank-lp` | SDK `crank` → `harvest_lp_fees` | 1 | cranker |
| 9 | `redeem1` | SDK `redeem --raw <50% of its balance>` | 1 | buyer1 |
| 10 | `redeem2` | SDK `redeem --all` | 1 | buyer2 |
| 11 | `status-final` | SDK `status` (read-only) | 0 | — |

Before every step the script re-checks the abort conditions (§5) and rewrites the transaction log
`scripts/c2/reports/<run id>.md` with a Solscan link per signature. Working files that contain the
RPC URL stay in `target/c2/<run id>/` (gitignored); the report never contains it.

The per-transaction costs, CU limits and the exact instruction list are in
`docs/research/surfpool-e2e.md` §4 and §8.

---

## 5. What to watch, and when to abort

The script checks these automatically before each step and stops the run when one trips:

| Abort condition | Checked before | What it means |
|---|---|---|
| **SPYx paused** | every step | the issuer paused transfers; every swap, harvest and redeem would fail cleanly. Wait, then resume |
| **SPYx transfer hook appeared** | same | unsupported by the deployed program (documented limitation): the vault would be stuck until a program upgrade |
| **Price moved > 5%** since the plan | `create-launch`, `buy1`, `buy2`, `damm-buy` | only these steps take their raw amount from the planned price. The sell and the redemptions spend on-chain balances, so they are not stopped by a price move (`--max-price-drift-pct` to change the window; a new run re-plans) |
| **Jupiter unreachable** | same four steps | no price baseline. **After the first buy has landed it is only a warning**: the threshold is then fixed on chain in raw units, so a rate-limit blip cannot strand a run between the buys and the redemptions. Before that, `--skip-price-guard` continues with the pause and transfer-hook checks alone |
| **Deploy write failed** | during `deploy` | the CLI exits non-zero; see §6.1 |
| **Deployed ELF ≠ local binary** | after `deploy` | the run stops before anything else is sent |
| **Unexpected launch phase** | steps 3–10 | someone else traded, cranked or migrated the pool first; check `status` before continuing |

Watch by eye:

- **Progress to graduation** after step 4 must read 100%; the crank in step 5 must print
  `migrate executed` and `sync_migration executed`.
- **Vault after step 5** must be ≈ 50% of the threshold (the migration fee is exact:
  `threshold − ceil(threshold × 50 / 100)`) plus the curve fees.
- **Between migration and the migration-fee harvest the floor reads low.** The crank runs both in
  the same step; if step 5 is interrupted, run it again before showing anything on camera.
- **Floor per token never decreases** — `status` prints `floorQ64` and `floorViewMatchesState: true`
  (the on-chain view equals the decoded state) after each redemption.
- **`migration_damm_v2` has only 17% CU headroom** (153k–165k used of a 200k limit). If it runs out
  of compute the only cost is the fee, and re-running the crank retries with fresh position NFT keys.
- **Avoid 00:15–00:45 UTC** (xStocks may pause around a multiplier activation).

To stop the run at any point: answer `abort` at a prompt, or press Ctrl-C. Nothing is sent after
that; the transaction log keeps everything already sent.

**A failed step may still have landed.** A send whose confirmation timed out is a failure to the
script but may be a transaction on chain. On abort the script collects the signatures of the failing
step into the report and prints them, so the first thing to do is check them
(`solana confirm -v <signature> --url "$MAINNET_RPC_URL"`, or the launch state with `status`). If one
landed, answer `skip` for that step when you resume: buys, sells and redemptions are not
idempotent.

---

## 6. Recovery

A failure of the **funding step** (§3.1) has its own recovery, in §3.1: re-run the same command, it
sends only what is still missing. This section is about the run itself.

Every failure leaves a resumable run. The generic move is:

```bash
bash scripts/c2/run.sh --resume <run id> --mainnet --allow-mainnet     # the id is printed on abort
```

Steps already marked `done` are skipped; the run continues from the failed one. (Verified on the
local fork: a run aborted after the deploy resumed and finished the remaining 13 transactions.)

`--resume latest` picks the newest run **of the same mode** (by modification time), and a run
recorded as a dry run is refused in mainnet mode and the other way round — so a mainnet resume can
never continue a local-fork run, nor rewrite its committed report.

### 6.1 A failed deploy

- The buffer keypair `keys/stockfloor-deploy-buffer.json` keeps the chunks already written, so
  **re-running the same deploy resumes into the same buffer** instead of paying for the writes again.
  Resuming the run does exactly that; the preflight first compares what the buffer holds with
  `target/deploy/stockfloor.so` and prints how many bytes are already written.
- **Never delete the buffer keypair to "start clean".** The account and its ≈ 2.57 SOL of rent stay
  on chain; the file is only how the deployer addresses it. The one way to get that rent back is
  `solana program close --buffers --keypair keys/deployer.json` (the deployer is the buffer
  authority); `solana program show --buffers --keypair keys/deployer.json` lists what exists.
- A buffer holding a *different* binary is the only buffer state that blocks the run: close it as
  above, then re-run.
- If the program account was created but the ELF does not match the local file, the run stops before
  anything else. Re-deploying the correct binary is a normal upgrade (fees only, ≈ 0.0025 SOL, needs
  2.3329 SOL free at once for the buffer).

### 6.2 A partial launch (step 2)

`create-launch` writes `keys/launches/<config>.json` (mode 0600, gitignored) with the launch input
and **both throwaway keypairs before the first transaction**, so a launch can never be orphaned:
resuming rebuilds the same transactions and sends only what is not on chain yet. The run does this
automatically; manually it is:

```bash
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh create-launch --rpc "$MAINNET_RPC_URL" \
  --allow-mainnet --keypair keys/cli-creator.json --resume keys/launches/<config>.json --out launch.json
```

### 6.3 A failed crank (steps 5, 8)

The crank is permissionless and re-plans from chain state: just run the step again. Steps already
executed are reported as skipped. This also covers a third party migrating the pool first.

### 6.4 A failed buy, sell or redeem (steps 3, 4, 6, 7, 9, 10)

These are single transactions: either it landed or it did not. Check the launch state
(`bash packages/sdk/scripts/run.sh status --rpc "$MAINNET_RPC_URL" --launch <launch>`), then resume.
Buys and redemptions are **not** idempotent, so the run only replays a step it has not marked
`done`; when in doubt, skip it at the prompt and continue.

### 6.5 What cannot be undone

| | |
|---|---|
| Program rent (≈ 2.57 SOL) | recoverable only by `solana program close`, which permanently kills the program id. Not planned |
| Deploy transaction fees (≈ 0.0025 SOL) | gone |
| SPYx paid into the curve | ≈ 50% of the threshold becomes the vault (redeemable pro rata by any holder), the rest seeds the permanently locked DAMM v2 liquidity (tradable against, never withdrawable), minus ≈ 0.5% of protocol and creator fees |
| Token metadata | immutable by design (`TokenAuthorityOption::Immutable`): name, symbol and URI are final |
| The DBC config, pool and the migrated DAMM v2 pool | permanent; the LP position is permanently locked and only its fees can be claimed, into the vault |
| The floor vault | has no admin, no withdraw and no sweep: the only way out is `redeem` |

---

## 7. What the judges will see

Artifacts the run produces:

- **`scripts/c2/reports/<run id>.md`** — every transaction with a Solscan link, every address with a
  Solscan link, the steps, the preflight verdict and the irreversible parts. The dry-run version of
  exactly this file is committed: `scripts/c2/reports/dry-20260916T020703Z.md` (a report is bound to
  its cluster: rendering refuses to overwrite a dry-run report with a mainnet run, or the reverse).
- **Solscan**: the program `98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA`, the launch PDA, the base
  mint with its metadata, the DBC pool, the DAMM v2 pool, and the floor vault whose SPYx balance
  moves with every harvest and redemption.
- **The token trades on Jupiter and any Solana wallet** once the DAMM v2 pool exists.
- **The app**: `NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=<mainnet rpc> pnpm --filter
  @stockfloor/app dev` shows the real launch, the floor meter, the max-loss label and the vault
  stats, read-only. Sending from the UI on mainnet additionally needs `NEXT_PUBLIC_ALLOW_MAINNET=1`
  and `STOCKFLOOR_ALLOW_MAINNET=1` **at build time** — a separate decision, not part of C2. For the
  video, the same app against the local fork (`RPC_PORT=28899 bash scripts/surfpool/up.sh`) behaves
  identically.
- **The evidence trail**: `docs/research/c1-evidence.md` (LiteSVM fork lifecycle),
  `docs/research/surfpool-e2e.md` (this exact sequence on a live fork, 495 mainnet-equivalent
  transactions), and `pnpm test` (577 tests) from a fresh clone.

---

## 8. Files

| Path | What |
|---|---|
| `scripts/c2/fund.ts` | the funding step: deployer SOL → the four demo wallets + the SPYx purchase (§3.1) |
| `scripts/c2/libfund.ts` | its pure parts: the plan, the guard, the swap checks, the end-state verification (unit-tested in `packages/sdk/test/c2-fund.test.ts`) |
| `scripts/c2/fund-fork-test.sh` | runs the funding step end to end on a local Surfpool fork and asserts the refusals (§3.1) |
| `target/c2/fund/<mainnet\|fork>.json` | funding run state: stages, signatures, prices (gitignored) |
| `scripts/c2/preflight.ts` | read-only go/no-go table (§2) |
| `scripts/c2/run.sh` | the sequence, dry run by default, `--mainnet` behind the gate (§4) |
| `scripts/c2/checks.ts` | the abort conditions checked between steps (§5) |
| `scripts/c2/report.ts` | renders the transaction log with Solscan links |
| `scripts/c2/reports/` | the logs, one `.md` and one `.json` per run |
| `target/c2/<run id>/` | run state, per-step logs, the Solana CLI config with the RPC URL (gitignored) |
| `keys/c2-approved` | the approval marker (gitignored, created by the user) |
| `keys/stockfloor-deploy-buffer.json` | deploy buffer keypair, makes a failed deploy resumable (never delete it: see §6.1) |
| `keys/launches/<config>.json` | launch session: input + both throwaway keypairs (mode 0600) |
