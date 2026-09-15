# C2 rehearsal on a local Surfpool mainnet fork

Date: 2026-09-16. Nothing was sent to mainnet. Mainnet was only read, for rent, prices and the relay
check.

The rehearsal ran the full planned C2 sequence with the SDK CLI scripts on a fresh local Surfpool 1.5.0
fork of mainnet (127.0.0.1:8899):
- deploy `stockfloor`, then `create-launch`;
- buys from three wallets, then a crank that migrates and runs every harvest;
- a DAMM v2 buy and sell, then a crank for LP fees;
- two redemptions and a final `status`.

Commands:

```bash
bash scripts/e2e/rehearsal.sh [--restart] [--keep]      # the rehearsal (about 2.5 min), stops Surfpool afterwards
bash scripts/e2e/replay-doc-commands.sh [--restart]     # replays the mainnet command list in this doc against a local fork
```

Evidence: `scripts/e2e/reports/<run id>.md` and `.json` contain every signature, CU figure, fee, created account and
wallet balance. Per-step logs are in `.surfpool/rpc-8899/e2e/<run id>/` (gitignored). The numbers below come from run
`20260915T215423Z` (`scripts/e2e/reports/20260915T215423Z.md`) with `stockfloor.so` 450,560 bytes, sha256 `580ecbee45bc952fc95f60700ebea1b24d610e9a591b82a37f6847f9dd8e5843`.
Prices at the time: SOL $96.66, SPYx $757.52, SPYx multiplier 1.005714560286254. A verification run with the final
scripts (`20260915T220548Z`, not saved) passed the same checks with the same SOL costs. Its SPYx amounts differ by the
price move, and its CU figures are included in the ranges in §4.

## 1. Result

**The planned C2 sequence works end to end on a live fork, and costs 2.58 SOL plus about $53 of SPYx, of which about $15 comes back.**

| Check | Result |
|---|---|
| Transactions | 485 mainnet-equivalent: 472 deploy, 13 launch lifecycle. No transaction failed. |
| Quotes vs chain | All 6 CLI trades and redemptions `exact: true`; SDK quote = on-chain amount |
| Crank | `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus`, `migrate` (DBC `migration_damm_v2`), `harvest_lp_fees`: all executed |
| Final state | `redeemable`; the on-chain `floor` view equals the decoded state; the floor per token rose after each redemption |
| Fees | For every transaction, the lamports charged equal `5,000 × signatures + ceil(CU limit × CU price / 1e6)` |
| Rent | The surfnet Rent sysvar was set to mainnet's (5,080 lamports/byte); still equal at the end |
| Nothing relayed | 0 of 969 local signatures exist on mainnet; 0 of 40 accounts created locally exist on mainnet |
| Threshold | The $50 demo launch graduated. $25 and $100 launches also passed DBC `create_config` and our `create_launch`. |

## 2. Fidelity: where a local fork differs from mainnet, and what the rehearsal does

| Difference | Impact | Handling |
|---|---|---|
| **Rent.** Surfpool 1.5.0 (litesvm 0.14) ships `lamports_per_byte_year` 6,960. **Mainnet now uses 5,080** (read 2026-09-16; `getMinimumBalanceForRentExemption(0)` = 650,240). | Every rent-exempt balance would be 37% too high. | `setup.ts mainnet-rent` copies mainnet's `SysvarRent` bytes into the surfnet with `surfnet_setAccount`. `getMinimumBalanceForRentExemption` then matches mainnet for 0/82/165/1048 bytes. The runtime enforces the new minimum: a `create_account` 1 lamport below it fails with `InsufficientFundsForRent`. Verified again after the run. |
| **Priority fee reporting.** Surfpool charges the priority fee, but its `meta.fee` contains only the base fee. | Fee reports taken from `meta.fee` would be too low. | The ledger measures the charged fee as the lamport difference over all accounts of a transaction and compares it with the mainnet formula. They matched for every transaction. |
| **Token programs.** Surfpool bundles its own Token-2022 / SPL Token builds. | 13–22 CU per step (docs/research/surfpool.md) | The mainnet ELFs from `tests/fixtures` are installed first (`syncMainnetTokenPrograms`). |
| **Deploy transport.** A surfnet has no TPU port. | The local deploy uses `--use-rpc`; mainnet uses the default TPU (QUIC) client. | The transactions, their count and their fees are the same either way. The replay adds only `--use-rpc`. |
| **Metaplex creation fee** | 0.01 SOL is stored in the metadata account on top of its rent | Not a difference: Surfpool runs the mainnet Token Metadata program, so the fee is included (the "Above rent" column in §5). |
| **Other actors.** Surfpool does not replay mainnet traffic. | On mainnet a third party could buy on the curve, crank or migrate first. Meteora keepers do not migrate stock-quoted pools below about $750. | The completing buy uses PartialFill. The crank re-plans after every step and records "done concurrently" as skipped (SDK `runCrank`). |
| **IDL upload** | `anchor idl init` refuses loopback clusters ("Skipping IDL initialization on localnet") | Not rehearsed; optional at C2 (§6). |
| **Clock, feature set** | The surfnet clock follows wall time; its feature snapshot is from 2026-07-10 (docs/research/surfpool.md) | Our transactions showed no difference. |

## 3. Proposed threshold: **$50 in SPYx**

Decision · alternatives · reason: **$50** · $25, $100, the default $1,000 · Rationale:
- **Small spend.** Buyers put in about $53 of SPYx.
- **Enough to show.** The vault still gets $25, and the floor, vault and redeem numbers stay readable on Solscan and on
  camera.
- **Precision.** The raw amounts are about 6.6M, far above rounding effects.
- **Our crank migrates, not Meteora's keeper.** At $50 the keeper does not act (it needs about $750 or more), which is what
  the demo wants to show.

Checks:
- **SDK:** `MIN_THRESHOLD_USD` is 1, so $50 passes.
- **On-chain:** DBC `create_config` and stockfloor `create_launch` accepted $25 (3,281,511 raw), $50 (6,563,021 raw) and
  $100 (13,126,042 raw). The $50 launch completed the whole lifecycle.

Where the demo money goes (raw SPYx; 1 raw = 1e-8 SPYx before the multiplier, $757.52 × 1.0057 per 1e8 raw):

| | Raw SPYx | USD |
|---|---:|---:|
| Paid in: creator first buy 662,932 + buyer1 2,983,191 (curve) + 328,152 (DAMM) + buyer2 2,983,192 (completing, PartialFill) | 6,957,467 | $53.0 |
| Back to wallets: buyer2 DAMM sell 730,732, buyer1 redeem 565,338, buyer2 redeem 720,910 | 2,016,980 | $15.4 |
| Still in the floor vault (redeemable by remaining holders, including the creator's tokens) | 2,040,920 | $15.5 |
| Permanently locked in the DAMM v2 pool (holders can still sell into it) | 2,863,837 | $21.8 |
| Curve fees to protocol and creator, DBC protocol migration fee | 35,730 | $0.3 |

Graduation:
- **Vault:** 3,318,637 raw, made of the migration fee 3,281,510 (= 50% of the threshold, exact) plus curve fees
  37,127.
- **Token prices:** floor $2.53e-8, price $7.98e-8, max loss if buying at graduation 68.3%.
- **After LP fees and two redemptions:** floor $2.56e-8 (it rose); supply 606,444,173,859,510 raw.

## 4. Sequence and measured costs

Priority fee: **100,000 µlamports/CU** on every transaction, including deploy writes. Recent mainnet samples
(2026-09-16):
- DBC: p50 510, p90 50,000.
- DAMM v2: p50 2,001, p90 10,100.

CU limits are the SDK `CU_LIMITS`; the Solana CLI sets its own limits from simulation.

| # | Step (command) | Wallet | Txs | CU used | CU limit | Fees (lamports) | New-account lamports |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | deploy (`solana program deploy --max-len 495616`) | deployer | 472 | 1,260,690 | 1,260,690 | 2,496,069 | 2,519,441,240 (buffer 2,518,608,120 refunded, see §6) |
| 2 | `create-launch` (tx1 config + launch, tx2 pool + register + first buy) | creator | 2 | 238,272–254,811 | 435,000 | 63,500 | 32,087,840 |
| 3 | `buy` 45% of T on the curve | buyer1 | 1 | 49,047–53,551 | 95,000 | 14,500 | 1,488,440 |
| 4 | `buy` completing (PartialFill) | buyer2 | 1 | 51,883–54,894 | 95,000 | 14,500 | 1,488,440 |
| 5 | `crank` (4 txs, below) | cranker | 4 | 296,976–310,488 | 420,000 | 72,000 | 18,039,080 |
| 6 | `buy` 5% of T on DAMM v2 | buyer1 | 1 | 22,852–27,350 | 75,000 | 12,500 | 0 |
| 7 | `sell` 25% of base on DAMM v2 | buyer2 | 1 | 25,303–25,318 | 75,000 | 12,500 | 0 |
| 8 | `crank` LP fees | cranker | 1 | 53,506–56,506 | 100,000 | 15,000 | 0 |
| 9 | `redeem` 50% | buyer1 | 1 | 35,142–35,159 | 75,000 | 12,500 | 0 |
| 10 | `redeem --all` | buyer2 | 1 | 33,485–33,502 | 75,000 | 12,500 | 0 |
| 11 | `status` (read-only) | — | 0 | | | | |

CU ranges cover the four rehearsal runs; bump searches over random keys cause the variation.

Per transaction type:

| Transaction | CU used | CU limit | Headroom | Size (bytes) | Signers | Fee (lamports) |
|---|---:|---:|---:|---:|---:|---:|
| Loader InitializeBuffer | 2,820 | 2,820 | CLI-simulated | 412 | 2 | 10,282 |
| Loader Write (×470) | 2,670 | 2,670 | CLI-simulated | 1,232 | 1 | 5,267 each |
| Loader DeployWithMaxDataLen | 2,970 | 2,970 | CLI-simulated | 554 | 2 | 10,297 |
| DBC `create_config` + `create_launch` | 74,545–91,060 | 170,000 | 46% | 947 | 2 | 27,000 |
| DBC pool + `register_pool` + ATA + `swap2` | 162,228–174,243 | 265,000 | 34% | 1,109 | 2 | 36,500 |
| ATA + DBC `swap2` | 49,047–54,894 | 95,000 | 42% | 719 | 1 | 14,500 |
| `harvest_curve_fees` (creates the claimer base ATA) | 68,353–77,353 | 100,000 | 23% | 791 | 1 | 15,000 |
| `harvest_migration_fee` | 37,531 | 60,000 | 37% | 592 | 1 | 11,000 |
| `harvest_surplus` | 37,538 | 60,000 | 37% | 592 | 1 | 11,000 |
| DBC `migration_damm_v2` | **153,554–165,554** | 200,000 | **17%** | 1,151 | 3 | 35,000 |
| ATA + DAMM v2 `swap2` | 22,852–27,350 | 75,000 | 64% | 686 | 1 | 12,500 |
| `harvest_lp_fees` | 53,506–56,506 | 100,000 | 43% | 824 | 1 | 15,000 |
| ATA + `redeem` | 33,485–35,159 | 75,000 | 53% | 642 | 1 | 12,500 |

## 5. Accounts and rent per launch (mainnet rent, 5,080 lamports/byte)

| Created by | Account | Owner | Bytes | Lamports | Above rent | Paid by |
|---|---|---|---:|---:|---:|---|
| tx1 | DBC config | DBC | 1,048 | 5,974,080 | 0 | creator |
| tx1 | stockfloor `Launch` | stockfloor | 351 | 2,433,320 | 0 | creator |
| tx1 | floor vault (SPYx ATA of the vault authority) | Token-2022 | 179 | 1,559,560 | 0 | creator |
| tx2 | base mint | SPL Token | 82 | 1,066,800 | 0 | creator |
| tx2 | base token metadata | Token Metadata | 607 | 13,733,800 | **10,000,000** (Metaplex fee) | creator |
| tx2 | DBC virtual pool | DBC | 424 | 2,804,160 | 0 | creator |
| tx2 | DBC base vault | SPL Token | 165 | 1,488,440 | 0 | creator |
| tx2 | DBC quote vault (SPYx) | Token-2022 | 175 | 1,539,240 | 0 | creator |
| tx2 | creator base ATA | SPL Token | 165 | 1,488,440 | 0 | creator |
| buy | buyer base ATA (each buyer) | SPL Token | 165 | 1,488,440 | 0 | buyer |
| crank | claimer base ATA | SPL Token | 165 | 1,488,440 | 0 | cranker |
| migrate | DAMM v2 pool | DAMM v2 | 1,112 | 6,299,200 | 0 | cranker (flash rent) |
| migrate | DAMM v2 position (permanently locked) | DAMM v2 | 408 | 2,722,880 | 0 | cranker |
| migrate | position NFT mint | Token-2022 | 465 | 3,012,440 | 0 | cranker |
| migrate | position NFT account (owner = claimer PDA) | Token-2022 | 165 | 1,488,440 | 0 | cranker |
| migrate | DAMM v2 token A vault (base) | SPL Token | 165 | 1,488,440 | 0 | cranker |
| migrate | DAMM v2 token B vault (SPYx) | Token-2022 | 175 | 1,539,240 | 0 | cranker |
| funding | SPYx ATA of each demo wallet | Token-2022 | 179 | 1,559,560 | 0 | whoever sends the SPYx |

Totals per launch, excluding the deploy and the wallet SPYx ATAs:
- **Rent and fees:** 53,103,800 lamports of new accounts plus 229,500 in transaction fees = **0.0533 SOL**.
- **Creator:** 0.0322 SOL.
- **Cranker:** 0.0181 SOL. This includes the migration flash rent: DBC's pool authority pays the DAMM v2 accounts
  during `migration_damm_v2`, and the cranker reimburses it in the same transaction.
- **Each buyer:** 0.0015 SOL.

No account is closed afterwards; `redeem --all` leaves an empty base ATA of 1,488,440 lamports that the holder can close.

## 6. Program deploy

Measured with `--max-len 495616` (ELF 450,560 bytes + 10%, KiB-rounded):
- **Transactions:** 1 × `InitializeBuffer` (creates the buffer), 470 × `Write`, 1 × `DeployWithMaxDataLen` (creates the
  program account and programdata).
- **Buffer:** the CLI funds it with the **programdata** rent, 2,518,608,120 lamports. The final transaction refunds it
  and charges the programdata rent, so the peak balance needed equals the net cost.
- **Net cost:** programdata 2,518,608,120 + program account 833,120 + fees 2,496,069 = **2,521,937,309 lamports (2.5219 SOL)**.

| `--max-len` option | Bytes | Programdata rent (SOL) | Deploy total (SOL) | USD at $96.66 |
|---|---:|---:|---:|---:|
| exact ELF (CLI default) | 450,560 | 2.2897 | 2.2931 | $221.66 |
| **ELF + 10% (recommended, rehearsed)** | 495,616 | 2.5186 | **2.5219** | $243.78 |
| ELF + 25% | 563,200 | 2.8619 | 2.8653 | $276.97 |
| 2 × ELF | 901,120 | 4.5786 | 4.5819 | $442.90 |

Decision · alternatives · reason: **ELF + 10%** · exact size, +25%, 2× · Solana CLI 4.1 auto-extends programdata on upgrade
(`--no-auto-extend` is opt-out), so a large margin only prepays rent. 10% (+0.23 SOL) absorbs a typical fix without an
extend transaction.

**Upgrade** (rehearsed with the same ELF, not part of C2):
- 472 transactions; the buffer is funded with 2,289,723,640 lamports and refunded by `Upgrade`.
- Net cost is the fees, 2,491,039 lamports.
- The deployer needs **2.2922 SOL available at once** to upgrade. An ELF above max-len also pays the extension rent.
- **Buffer keypair:** `keys/stockfloor-deploy-buffer.json` (created if missing). After a failed deploy, rerunning the same
  command resumes into the same buffer. `solana program close --buffers` recovers a stranded buffer.

**Optional IDL account:** `anchor idl init` through the Program Metadata program. Anchor refuses loopback clusters, so it
was not rehearsed. Estimate: 0.03–0.12 SOL of rent (IDL 46,825 bytes; 22,685 minified; about 5,100 zlib-compressed).

## 7. C2 funding requirement

Measured SOL per wallet over the C2 steps and the recommendation:
- **Deployer:** +2% and 0.05 SOL for re-sent writes, rounded up to 0.05 SOL.
- **App wallets:** +25% and 0.01 SOL, rounded up to 0.01 SOL.
- **SPYx:** planned amount +10%, for price moves between funding and launch. The threshold is fixed in USD at
  launch, so the raw SPYx needed scales inversely with the SPYx price.

| Wallet | Address | Key file | Measured SOL | **Send SOL** | Planned SPYx raw | **Send SPYx** (raw / as wallets show it) | USD |
|---|---|---|---:|---:|---:|---:|---:|
| deployer | `BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV` | keys/deployer.json | 2.521937 | **2.65** | — | — | $256 |
| creator | `EFSrr7pe6fJqRLXWMBYzNCJj2uVBxtn9fxYM91U2vY5f` | keys/cli-creator.json | 0.032151 | **0.06** | 662,932 | **730,000 / 0.00734 SPYx** | $11 |
| buyer1 | `ED77vdfSwwJzrvQqUo7RtQRYsMA3bGSP213ZEBoBin99` | keys/cli-buyer1.json | 0.001528 | **0.02** | 3,311,343 | **3,650,000 / 0.03671 SPYx** | $30 |
| buyer2 | `5WgdkguwV2EcLuPE8sGCjrRqcxXui5kbkaxdHE4viAJJ` | keys/cli-buyer2.json | 0.001528 | **0.02** | 3,314,657 | **3,650,000 / 0.03671 SPYx** | $30 |
| cranker | `FhaZVX91912MJTxoPDW3JtmbeDEuZdRjDQ9QfkaWohyC` | keys/cli-cranker.json | 0.018126 | **0.04** | — | — | $4 |
| **Total** | | | **2.575270** | **2.79 SOL** | 7,288,932 | **8,030,000 raw = 0.0808 SPYx** | **$270 SOL + $61 SPYx** |

The planned SPYx for buyer2 is the PartialFill **offer** (50% of T). The completing buy used 2,983,192 raw.

Notes for the user's transfers:
- **Send SPYx directly**, not USDC: the CLI sequence pays in SPYx. Buying 0.0808 SPYx through Jupiter costs about
  **$62 of USDC**.
- **The sender pays** 1,559,560 lamports to create each demo wallet's SPYx ATA (three wallets: 0.0047 SOL), plus its
  own fees. This is not in the table.
- **Optional upgrade headroom:** send the deployer **4.95 SOL** instead of 2.65. After the deploy, 2.43 SOL remains, enough
  for one upgrade (2.29 SOL needed at once). The upgrade refunds its buffer, so only about 0.0025 SOL of fees is spent.
- **What is really spent:**
  - **SOL:** ≈ 2.58 SOL. The 2.52 SOL of program rent stays locked while the program exists;
    `solana program close` would return it, but that is irreversible and not planned.
  - **SPYx:** ≈ $37.6 of the $53 paid in. $15.5 stays redeemable in the vault; $21.8 is permanently locked DAMM v2
    liquidity.
- **Re-check before funding** (read-only): `solana rent 495661` and the SPYx price. Rent was 5,080 lamports/byte on
  2026-09-16.

## 8. Mainnet transactions C2 will send (for the user's approval)

Every row is a mainnet transaction. Nothing here has been sent; the rehearsal ran the same list on the local fork.

| # | Step | Instructions | Signer(s) / fee payer | CU limit | Fee (lamports) | SOL moved into new accounts | SPYx raw moved |
|---:|---|---|---|---:|---:|---:|---|
| 1 | deploy | System `CreateAccount` + Loader `InitializeBuffer` | deployer, buffer keypair | 2,820 | 10,282 | 2,518,608,120 (buffer, refunded in #472) | |
| 2–471 | deploy | 470 × Loader `Write` | deployer | 2,670 | 5,267 each (2,475,490) | 0 | |
| 472 | deploy | System `CreateAccount` + Loader `DeployWithMaxDataLen` (upgrade authority = deployer) | deployer, program keypair | 2,970 | 10,297 | 833,120 program + 2,518,608,120 programdata − buffer refund | |
| 473 | create-launch | DBC `create_config` + stockfloor `create_launch` | creator, config keypair | 170,000 | 27,000 | 9,966,960 | |
| 474 | create-launch | DBC `initialize_virtual_pool_with_spl_token` + stockfloor `register_pool` + ATA + DBC `swap2` (first buy) | creator, base mint keypair | 265,000 | 36,500 | 22,120,880 | creator → DBC 662,932 |
| 475 | buy | ATA + DBC `swap2` (ExactIn) | buyer1 | 95,000 | 14,500 | 1,488,440 | buyer1 → DBC 2,983,191 |
| 476 | buy | ATA + DBC `swap2` (PartialFill, completes the curve) | buyer2 | 95,000 | 14,500 | 1,488,440 | buyer2 → DBC 2,983,192 |
| 477 | crank | stockfloor `harvest_curve_fees` | cranker | 100,000 | 15,000 | 1,488,440 | DBC → vault 37,127 |
| 478 | crank | stockfloor `harvest_migration_fee` | cranker | 60,000 | 11,000 | 0 | DBC → vault 3,281,510 |
| 479 | crank | stockfloor `harvest_surplus` | cranker | 60,000 | 11,000 | 0 | 0 |
| 480 | crank | DBC `migration_damm_v2` (DAMM v2 Customizable config) | cranker, 2 position NFT mint keypairs | 200,000 | 35,000 | 16,550,640 | DBC → DAMM v2 3,274,948 |
| 481 | buy | ATA + DAMM v2 `swap2` | buyer1 | 75,000 | 12,500 | 0 | buyer1 → DAMM 328,152 |
| 482 | sell | ATA + DAMM v2 `swap2` | buyer2 | 75,000 | 12,500 | 0 | DAMM → buyer2 730,732 |
| 483 | crank | stockfloor `harvest_lp_fees` | cranker | 100,000 | 15,000 | 0 | DAMM → vault 8,531 |
| 484 | redeem | ATA + stockfloor `redeem` (50% of balance) | buyer1 | 75,000 | 12,500 | 0 | vault → buyer1 565,338 |
| 485 | redeem | ATA + stockfloor `redeem` (all) | buyer2 | 75,000 | 12,500 | 0 | vault → buyer2 720,910 |

Raw SPYx amounts scale with the SPYx price at launch time. Every transaction also carries `SetComputeUnitLimit` and
`SetComputeUnitPrice(100000)`.

Not in the list and **not planned without a separate OK**:
- the optional IDL upload;
- a creator `redeem`;
- a crank `--loop`;
- any upgrade;
- revoking the upgrade authority (hard stop 3).

## 9. Mainnet commands for C2 — **DO NOT RUN WITHOUT THE USER'S OK**

These are the rehearsal commands with the mainnet RPC and the SDK guard override (`--allow-mainnet` together with
`STOCKFLOOR_ALLOW_MAINNET=1`).
- **Local replay.** `bash scripts/e2e/replay-doc-commands.sh` runs the blocks below verbatim against a fresh local fork.
  It forces `MAINNET_RPC_URL=http://127.0.0.1:8899` and adds `--use-rpc` to the deploy. Last result: §10.
- **Deploy transport.** On mainnet the deploy uses the default TPU client. Add `--use-rpc` only with a private RPC that
  accepts about 470 `sendTransaction` calls quickly.
- **Launch references.** Run every command in bash from the repo root. Launch commands use `--launch`, which avoids
  `getProgramAccounts` on public RPCs.

<!-- c2-commands:begin -->
```bash
# ---- 0. Environment and read-only pre-flight (no transactions) ------------------------------------
export MAINNET_RPC_URL="${MAINNET_RPC_URL:?set MAINNET_RPC_URL to the mainnet RPC chosen by the user}"
export TOKEN_URI="${TOKEN_URI:?set TOKEN_URI to the token metadata JSON URL chosen by the user}"
export C2_DIR="${C2_DIR:-target/c2}"
export THRESHOLD_USD=50 PRIORITY_FEE=100000
TSX=packages/sdk/node_modules/.bin/tsx
mkdir -p "$C2_DIR"
printf 'json_rpc_url: "%s"\nwebsocket_url: ""\nkeypair_path: "%s"\naddress_labels: {}\ncommitment: confirmed\n' \
  "$MAINNET_RPC_URL" "$PWD/keys/deployer.json" >"$C2_DIR/solana-cli.yml"
shasum -a 256 target/deploy/stockfloor.so
for k in deployer cli-creator cli-buyer1 cli-buyer2 cli-cranker; do
  pk="$(solana-keygen pubkey "keys/$k.json")"
  echo "$k $pk $(solana balance --config "$C2_DIR/solana-cli.yml" "$pk")"
  spl-token balance --config "$C2_DIR/solana-cli.yml" --owner "$pk" XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W || true
done
solana rent 495661 --config "$C2_DIR/solana-cli.yml"
solana account 98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA --config "$C2_DIR/solana-cli.yml" || echo "program id is free"
```

```bash
# ---- 1. Deploy stockfloor (472 transactions, about 2.522 SOL from the deployer) -- DO NOT RUN WITHOUT OK
solana program deploy --config "$C2_DIR/solana-cli.yml" --url "$MAINNET_RPC_URL" \
  --keypair keys/deployer.json --fee-payer keys/deployer.json --upgrade-authority keys/deployer.json \
  --program-id keys/stockfloor-program.json --buffer keys/stockfloor-deploy-buffer.json --max-len 495616 \
  --with-compute-unit-price 100000 --commitment confirmed target/deploy/stockfloor.so
# verify (read-only): upgrade authority = deployer, data length 495616, deployed ELF = local file
solana program show 98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA --config "$C2_DIR/solana-cli.yml"
solana program dump 98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA "$C2_DIR/onchain.so" --config "$C2_DIR/solana-cli.yml"
cmp <(head -c "$(wc -c <target/deploy/stockfloor.so)" "$C2_DIR/onchain.so") target/deploy/stockfloor.so && echo "deployed ELF matches"
```

```bash
# ---- 2. Demo amounts from the live SPYx price (read-only) -------------------------------------------
"$TSX" scripts/e2e/plan.ts pre-launch --threshold-usd "$THRESHOLD_USD" --rpc "$MAINNET_RPC_URL" | tee "$C2_DIR/plan.env"
source "$C2_DIR/plan.env"
```

```bash
# ---- 3. Create the launch (2 transactions, creator) -- DO NOT RUN WITHOUT OK -------------------------
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh create-launch --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-creator.json --name "StockFloor Demo" --symbol SFDEMO --uri "$TOKEN_URI" \
  --quote SPYx --preset gentle --vault-share 50 --threshold-usd "$THRESHOLD_USD" --exit-fee-bps 200 \
  --price-usd "$PRICE_USD" --first-buy "$FIRST_BUY_UNITS" --slippage-bps 100 --priority-fee "$PRIORITY_FEE" \
  --out "$C2_DIR/launch.json"
export LAUNCH="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).addresses.launch)' "$C2_DIR/launch.json")"
bash packages/sdk/scripts/run.sh status --rpc "$MAINNET_RPC_URL" --launch "$LAUNCH" --price-usd "$PRICE_USD"
```

```bash
# ---- 4. Presale buys (1 transaction each) -- DO NOT RUN WITHOUT OK ----------------------------------
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh buy --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_BUY_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
"$TSX" scripts/e2e/plan.ts completing-buy --launch "$LAUNCH" --offer-raw "$BUYER2_OFFER_RAW" --rpc "$MAINNET_RPC_URL"
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh buy --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-buyer2.json --launch "$LAUNCH" --raw "$BUYER2_OFFER_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
```

```bash
# ---- 5. Graduation crank (4 transactions, cranker) -- DO NOT RUN WITHOUT OK ---------------------------
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh crank --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-cranker.json --launch "$LAUNCH" --dry-run
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh crank --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-cranker.json --launch "$LAUNCH" --priority-fee "$PRIORITY_FEE" --json
bash packages/sdk/scripts/run.sh status --rpc "$MAINNET_RPC_URL" --launch "$LAUNCH" --price-usd "$PRICE_USD"
```

```bash
# ---- 6. DAMM v2 market and LP fees (3 transactions) -- DO NOT RUN WITHOUT OK ------------------------
"$TSX" scripts/e2e/plan.ts post-migration --launch "$LAUNCH" --buyer1 "$(solana-keygen pubkey keys/cli-buyer1.json)" \
  --buyer2 "$(solana-keygen pubkey keys/cli-buyer2.json)" --rpc "$MAINNET_RPC_URL" | tee "$C2_DIR/plan-post.env"
source "$C2_DIR/plan-post.env"
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh buy --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_DAMM_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh sell --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-buyer2.json --launch "$LAUNCH" --raw "$BUYER2_SELL_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh crank --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-cranker.json --launch "$LAUNCH" --priority-fee "$PRIORITY_FEE" --json
```

```bash
# ---- 7. Redemptions (2 transactions) -- DO NOT RUN WITHOUT OK, then final status (read-only) ---------
"$TSX" scripts/e2e/plan.ts post-migration --launch "$LAUNCH" --buyer1 "$(solana-keygen pubkey keys/cli-buyer1.json)" \
  --buyer2 "$(solana-keygen pubkey keys/cli-buyer2.json)" --rpc "$MAINNET_RPC_URL" | tee "$C2_DIR/plan-redeem.env"
source "$C2_DIR/plan-redeem.env"
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh redeem --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_REDEEM_RAW" --priority-fee "$PRIORITY_FEE"
STOCKFLOOR_ALLOW_MAINNET=1 bash packages/sdk/scripts/run.sh redeem --rpc "$MAINNET_RPC_URL" --allow-mainnet \
  --keypair keys/cli-buyer2.json --launch "$LAUNCH" --all --priority-fee "$PRIORITY_FEE"
bash packages/sdk/scripts/run.sh status --rpc "$MAINNET_RPC_URL" --launch "$LAUNCH" --price-usd "$PRICE_USD"
```
<!-- c2-commands:end -->

Operational notes for C2:
- **Timing.** Avoid 00:15–00:45 UTC, when xStocks may pause around a multiplier activation. A paused SPYx fails
  swaps, harvests and redeem cleanly.
- **Solscan links.** Record them after each step: `$C2_DIR/launch.json` has the addresses, and `status` prints the DAMM v2
  pool and the position.
- **Failed crank step.** If a crank step fails (for example `migration_damm_v2` running out of CU), rerun the same crank
  command: it re-plans from chain state, and a new migration uses new random position NFT keys.
- **`target/c2/`** (gitignored) holds the CLI config with the RPC URL and the plan and launch files. Never commit it.

## 10. Local replay of §9

**Passed:** run `replay-20260915T220310Z`, `bash scripts/e2e/replay-doc-commands.sh`, 2026-09-16.

Every command block above ran verbatim, with two changes: `MAINNET_RPC_URL=http://127.0.0.1:8899`, and `--use-rpc`
appended to `solana program deploy`. The demo wallets were funded by cheatcodes with the plan +10%.
- **Pre-flight:** printed the stockfloor.so sha256, SOL and SPYx balances, and `solana rent 495661` = 2.51860812 SOL. It
  printed "program id is free". `spl-token balance` fails for the cranker, which has no SPYx ATA; `|| true` covers
  that.
- **Deploy:** `solana program show` reported authority `BBU1tTr4…` and data length 495,616. `solana program dump` +
  `cmp` printed "deployed ELF matches".
- **SDK CLI:** ran in guard mode `mainnet-override` (both switches set, loopback URL). Threshold 6,557,938 raw at
  $758.10; the completing buy was PartialFill.
- **Outcome:** all 6 quotes `exact: true`; final phase `redeemable`, vault 2,039,340 raw, supply 606,444,122,020,960,
  floor view = state.
- **Relay check:** 0 of 493 local signatures exist on mainnet.

## Decisions

- **Rehearse on Surfpool with mainnet's Rent sysvar copied in** · keep Surfpool's rent; scale the lamports afterwards · The
  runtime rent-state check and programs' `Rent::get()` then produce mainnet's exact lamport amounts, including the
  migration flash rent. Scaling would only guess at what programs compute.
- **Attribute costs from local signatures (`surfnet_getLocalSignatures`) and measure the charged fee by lamport conservation** ·
  parse CLI output; trust `meta.fee` · This catches every transaction, including those the Solana CLI sends. Surfpool's
  `meta.fee` leaves out the priority fee.
- **Real loader transactions for the deploy (`solana program deploy --use-rpc`), with a buffer keypair under keys/** · the
  `surfnet_writeProgram` cheatcode · Only real transactions show the buffer funding (programdata rent, refunded), the
  470 writes and their fees. A named buffer makes a failed mainnet deploy resumable.
- **Priority fee 100,000 µlamports/CU for every C2 transaction** · no priority fee; a dynamic estimate · This is above the p90
  of recent DBC and DAMM v2 transactions (50,000 and 10,100), and costs at most 26,500 lamports per app transaction.
- **Demo split 10% / 45% / PartialFill completion, then a 5% DAMM buy, a 25% crash sell, and 50% / all redemptions** ·
  a single buyer; exact completing amounts · Three distinct holders show on Solscan, the completion is robust to
  third-party curve buys, and redemptions return part of the SPYx.
- **Threshold $50** (§3) and **max-len ELF + 10%** (§6).
- **Launch commands use `--launch`, not `--mint`** · `--mint` (getProgramAccounts) · Public mainnet RPCs may refuse or throttle
  `getProgramAccounts`.

## Open issues

- **`migration_damm_v2` CU headroom is 17%.** Measured 153,554–165,554 against the SDK limit of 200,000 (earlier fork
  tests: 151,921–160,921). The spread comes from PDA bump searches over random position NFT keys. Suggestion for the SDK
  owner: raise `CU_LIMITS.dbcMigrationDammV2` to 240,000 (+4,000 lamports). A failure costs only the fee, and the
  crank retries with new keys.
- **Token metadata URI.** The user must choose and host the metadata JSON (`TOKEN_URI`). Hosting counts as
  publishing, a hard stop. The rehearsal used a placeholder GitHub raw URL of realistic length (88 characters),
  which gave a 607-byte metadata account. Other URI lengths were not measured.
- **IDL upload** is not rehearsed (Anchor skips localnet). Decide at C2 whether to upload it (estimate 0.03–0.12 SOL).
- **Rent can change** (mainnet moved from 6,960 to 5,080 lamports/byte). Re-run `solana rent 495661` before funding. The
  recommendation has about 5% headroom on the deployer.
- **Mainnet send path.** The deploy was rehearsed with `--use-rpc`; the mainnet default is the TPU client. If QUIC is
  blocked on the user's network, use `--use-rpc` with a private RPC.
