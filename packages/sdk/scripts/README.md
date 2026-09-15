# StockFloor SDK scripts

Command-line tools on top of `@stockfloor/sdk`: create a launch, trade, crank, redeem and inspect
launches. They are thin wrappers: every transaction is built by the SDK (`buildLaunchTransactions`,
`buildTrade`, `runCrank`, `buildRedeem`) and sent with `ConnectionSender`.

```bash
bash packages/sdk/scripts/run.sh <script> [flags]           # runs from the repo root
pnpm --filter @stockfloor/sdk exec tsx scripts/<script>.ts [flags]   # same, from packages/sdk
```

| Script | What it does |
|---|---|
| `create-launch` | DBC `create_config` + `create_launch` (tx 1), DBC pool + `register_pool` (+ creator first buy) (tx 2, tx 3 only if the buy does not fit). Writes a session file with both throwaway keypairs before sending; `--resume` finishes an interrupted launch |
| `buy` | Buy with the quote asset: DBC curve in presale (ExactIn, PartialFill when crossing the migration price), DAMM v2 after migration |
| `sell` | Sell base tokens (same venues) |
| `crank` | Everything due: `register_pool`, `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus`, DBC `migration_damm_v2`, `sync_migration`, `harvest_lp_fees`, `burn_claimer_base`. One launch or all; `--loop` |
| `redeem` | Burn base tokens for the vault pro rata minus the exit fee (after migration and the migration-fee harvest) |
| `status` | Read-only: phase, progress, vault, supply, floor (on-chain `floor` view by simulation), price and max loss, positions, due crank actions |

## Common flags

| Flag | Meaning |
|---|---|
| `--rpc <url>` | RPC endpoint, default `http://127.0.0.1:8899` |
| `--keypair <path>` | Fee payer / signer. Must resolve inside the repo `keys/` directory (or a `stockfloor-test-*` temp dir created by tests). `~/.config/solana/id.json` and every other path are refused |
| `--launch <addr>` / `--mint <base mint>` / `--config <dbc config>` | Which launch. `--mint` uses getProgramAccounts with a memcmp on the Launch base mint and then keeps the launch that owns the mint's DBC pool (anyone can create extra pool-less `Launch` accounts for a mint); it fails with `AmbiguousLaunchError` when several matches have no pool yet. Public mainnet RPCs may refuse getProgramAccounts, so prefer `--launch` there |
| `--amount <units>` / `--raw <raw>` / `--all` | Amounts: `units = raw / 10^decimals` (the ScaledUiAmount multiplier is **not** applied); SPYx has 8 decimals, launch tokens 6 |
| `--slippage-bps <n>` | Trades, default 100 (quotes are exact program math, so this only absorbs state changes) |
| `--priority-fee <micro-lamports>` | ComputeBudget unit price; every transaction also sets a compute unit limit from `CU_LIMITS` |
| `--json` | Machine-readable output where applicable |

Script-specific flags are documented at the top of each file: `create-launch` (`--name --symbol --uri
--quote --preset gentle|flat --vault-share --threshold-usd --exit-fee-bps --price-usd --first-buy
--session --resume --out`), `buy` (`--no-partial-fill`), `crank` (`--loop --interval --skip-migration
--max-actions --dry-run --min-lp-fee-raw --min-lp-base-raw --max-lp-harvests
--include-foreign-positions`), `status` (`--price-usd | --live-price`).

The RPC endpoint is printed as scheme, host and port only: provider URLs carry API keys in the query
string or the path, and CLI output may end up in a recording.

## Resuming an interrupted launch

`create-launch` spans two or three transactions and two throwaway keypairs (the DBC config, which signs
tx 1, and the base mint, which signs the pool creation). `create_launch` commits the base mint in tx 1, so
without that keypair the launch could never get its pool. Before the first transaction the script writes
`keys/launches/<config>.json` (gitignored, mode 0600, `--session` to choose another path under `keys/`)
with the launch input and both secret keys, and the `--out` file with the addresses and per-step status.
It also refuses to start when the quote mint is paused or the creator cannot pay the first buy.

```bash
bash packages/sdk/scripts/run.sh create-launch --keypair keys/cli-creator.json --resume keys/launches/<config>.json \
  --out launch.json
# skip create_config+create_launch: Launch account exists
# sent create_pool+register_pool+first_buy: 5avveqFL… (1036 bytes, 176421 CU)
```

The resume reads the chain first and sends only what is missing (checked on a local Surfpool fork by
sending tx 1 alone and then resuming; a second resume sent nothing).

## Mainnet send guard

Every sending script (`create-launch`, `buy`, `sell`, `crank`, `redeem`) evaluates
`evaluateSendGuard` (`src/guard.ts`) before loading the keypair, and again before transactions in
long-running loops (at most every 30 s). A send is allowed only when:

1. **Local cluster.** The RPC host is loopback (`127.0.0.1`, `localhost`, `::1`) and
   - the cluster genesis hash is not mainnet's (a local test validator), or
   - the genesis hash **is** mainnet's (`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`) and the endpoint is a
     Surfpool surfnet: `getVersion` has `surfnet-version` **and** the Surfpool-only method
     `surfnet_getLocalSignatures` answers. Surfpool forks mainnet and reports its genesis hash, but executes
     every transaction in its embedded LiteSVM (`docs/research/surfpool.md`).
2. **Override (reserved for checkpoint C2 with the user's approval).** `--allow-mainnet` **and** the
   environment variable `STOCKFLOOR_ALLOW_MAINNET=1` are both set.

Refused: any non-loopback host without the full override (it is not even probed), a loopback endpoint
that reports the mainnet genesis but is not a surfnet (for example an SSH tunnel to a mainnet RPC), an
unreachable RPC, and either override switch alone. `status` sends nothing and has no guard.

Tests: `test/guard-keypair.test.ts` (decision table, probe with mocked fetch, keypair rules) and
`test/cli.test.ts` (the scripts spawned against fake local JSON-RPC servers).

## End-to-end run on a local Surfpool mainnet fork (2026-09-16)

Recorded before the post-M5 review fixes: the crank output below has no `sync_migration` step (the crank
now sends it right after `migrate`), and LP-fee harvests had no minimum. Every other figure still holds.
The C2 sequence was re-run on the current binary; see
[`docs/research/surfpool-e2e.md`](../../../docs/research/surfpool-e2e.md).

Surfpool 1.5.0 on 127.0.0.1:8899 / 8900 (`scripts/surfpool/*`), stockfloor `target/deploy/stockfloor.so`
sha256 `580ecbee45bc952fc95f60700ebea1b24d610e9a591b82a37f6847f9dd8e5843`, real mainnet DBC 0.2.1, DAMM v2,
SPYx and its DBC token badge fetched lazily by Surfpool. All keypairs are local files under `keys/`
(gitignored): `cli-creator` `EFSrr7pe…vY5f`, `cli-buyer1` `ED77vdfS…in99`, `cli-buyer2` `5Wgdkguw…iAJJ`,
`cli-cranker` `FhaZVX91…WohyC`.

### 1. Start the surfnet, deploy, fund

```bash
FUND_WALLETS="EFSrr7pe6fJqRLXWMBYzNCJj2uVBxtn9fxYM91U2vY5f ED77vdfSwwJzrvQqUo7RtQRYsMA3bGSP213ZEBoBin99 \
  5WgdkguwV2EcLuPE8sGCjrRqcxXui5kbkaxdHE4viAJJ FhaZVX91912MJTxoPDW3JtmbeDEuZdRjDQ9QfkaWohyC" \
  FUND_SOL=10 FUND_SPYX=3 bash scripts/surfpool/up.sh
```

Each wallet: 10 SOL and 3 SPYx (`rawAfter 300000000`, 179-byte Token-2022 ATA). The surfnet reports
`getGenesisHash = 5eykt4Us…` (mainnet's) and `getVersion = {"surfnet-version":"1.5.0",...}`, so the guard
runs in `surfnet` mode.

### 2. Create the launch (live Jupiter SPYx price, creator first buy 0.1 SPYx)

```bash
bash packages/sdk/scripts/run.sh create-launch --keypair keys/cli-creator.json --name "Floor Demo" --symbol FLOOR \
  --uri https://example.com/floor-demo.json --quote SPYx --preset gentle --vault-share 50 --threshold-usd 1000 \
  --exit-fee-bps 200 --first-buy 0.1 --out launch.json
```

```
rpc http://127.0.0.1:8899 (surfnet: loopback Surfpool surfnet 1.5.0 forking mainnet (transactions stay local))
quote SPYx XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W: $759.3264126505499 per UI token (Jupiter Price V3 (lite-api)), multiplier 1.005714560286254
threshold 1.30947363 SPYx (130947363 raw)
preview: start $1.3295e-6, graduation $1.5954e-6, floor at graduation $5.0000e-7, vault at graduation 65473681 raw
first buy: 10000000 raw quote -> 56456657188049 raw base
sent create_config+create_launch: 3ezxecwj…uxAMSYbj (935 bytes, 78884 CU)
sent create_pool+register_pool+first_buy: 4ghUwux2…MefoqJAz (1037 bytes, 170117 CU)
launch ATr3hnWyDDyzVhX7DWk8mA571u6USKGgN8kq6sYcj8gN, base mint 2k4DTzXQ68JnpKun76jT1yV5p89Cv6ZQYW5m3w6Sty7R,
config EGxBEH4UeYEiC2xhnYohZ5WpKNJRK296zb5CQBWTqBZ1, vault DjvdFNa7DYytp3VvXKW778ee2tWwUL6Nkd7czt9PreQv
phase presale, progress 7.56% (9900000 / 130947363 raw quote), partnerQuoteFeePending 56000
```

### 3. Presale trades

```bash
MINT=2k4DTzXQ68JnpKun76jT1yV5p89Cv6ZQYW5m3w6Sty7R
bash packages/sdk/scripts/run.sh buy  --keypair keys/cli-buyer1.json --mint $MINT --amount 0.3 --slippage-bps 50
bash packages/sdk/scripts/run.sh buy  --keypair keys/cli-buyer2.json --mint $MINT --amount 0.2
bash packages/sdk/scripts/run.sh sell --keypair keys/cli-buyer1.json --mint $MINT --raw 20000000000000
bash packages/sdk/scripts/run.sh status --mint $MINT
```

| Step | Quote (SDK) | On chain | CU |
|---|---|---|---|
| buyer1 buy, DBC ExactIn | pay 30,000,000 → 164,618,471,926,545 base | spent 30,000,000, received 164,618,471,926,545 (`exact: true`) | 48,888 |
| buyer2 buy, DBC ExactIn | pay 20,000,000 → 105,950,383,051,057 base | identical (`exact: true`) | 51,889 |
| buyer1 sell, DBC | 20,000,000,000,000 base → 3,742,215 quote | identical (`exact: true`) | 42,481 |

Status: `presale`, 42.48% (55,619,984 / 130,947,363), `partnerQuoteFeePending 357169`, floor view by
simulation equals the state (`floorViewMatchesState: true`), `dueCrankActions: ["harvest_curve_fees"]`.

### 4. Crank, complete the curve, graduate

```bash
bash packages/sdk/scripts/run.sh crank --keypair keys/cli-cranker.json --mint $MINT
bash packages/sdk/scripts/run.sh buy   --keypair keys/cli-buyer2.json --mint $MINT --amount 1.5
bash packages/sdk/scripts/run.sh crank --keypair keys/cli-cranker.json --mint $MINT --dry-run
bash packages/sdk/scripts/run.sh crank --keypair keys/cli-cranker.json          # all launches
bash packages/sdk/scripts/run.sh status --mint $MINT --live-price
```

```
harvest_curve_fees executed 3ME2Zt2n… (77203 CU)                    # 357,169 into the vault, creates the claimer base ATA
buy on DBC curve (PartialFill): pay 76088263 raw quote, receive 379582210784751 raw base   # 1.5 SPYx offered, exact: true
phaseAfter graduating, progress 100.00% (130947364 / 130947363 raw quote)
--dry-run due: harvest_curve_fees 426095, harvest_migration_fee 65473681, harvest_surplus 0, migrate (DAMM v2 config A8gMrEPJ…)
harvest_curve_fees executed 38vuvqnY… (54107 CU)
harvest_migration_fee executed 2a9nSiVR… (37381 CU)
harvest_surplus executed 2R9Kayqu… (37388 CU)
migrate executed dy5DaQMG… (154926 CU)                              # DAMM v2 pool 8JnB2c7MTwnBDGUpon34sqPiBMfk13nFtiYSQcVhF5hY
```

Status after graduation: phase `redeemable`, vault **66,256,945** raw = 357,169 + 426,095 (curve fees) +
65,473,681 (migration fee, equal to the create-launch preview) + 0 (surplus). Base supply
999,999,999,999,996 raw (the preset targets 1B tokens). One claimer-owned DAMM v2 position
(`Aowf4dN5…`) found through `getTokenAccountsByOwner`. With the live SPYx price: price $1.5929e-6,
floor $5.0518e-7, max loss if buying now 68.29%, vault $505.18.

### 5. DAMM v2 trades, LP fees, redemptions

```bash
bash packages/sdk/scripts/run.sh buy    --keypair keys/cli-buyer1.json  --mint $MINT --amount 0.4
bash packages/sdk/scripts/run.sh sell   --keypair keys/cli-buyer2.json  --mint $MINT --raw 100000000000000
bash packages/sdk/scripts/run.sh crank  --keypair keys/cli-cranker.json --mint $MINT --dry-run
bash packages/sdk/scripts/run.sh crank  --keypair keys/cli-cranker.json --mint $MINT
bash packages/sdk/scripts/run.sh redeem --keypair keys/cli-buyer1.json  --mint $MINT --raw 100000000000000
bash packages/sdk/scripts/run.sh redeem --keypair keys/cli-buyer2.json  --mint $MINT --all
```

| Step | SDK quote / preview | On chain | CU |
|---|---|---|---|
| buyer1 buy, DAMM v2 | 40,000,000 quote → 118,021,601,432,412 base | identical (`exact: true`) | 22,737 |
| buyer2 sell, DAMM v2 | 100,000,000,000,000 base → 35,248,682 quote | identical (`exact: true`) | 25,167 |
| crank `harvest_lp_fees` | pending 604,838 quote, 0 base | vault 66,256,945 → 66,861,783 | 56,356 |
| buyer1 redeem 1e14 base | gross 6,686,178, fee 133,724, net 6,552,454 | received 6,552,454; vault → 60,309,329; floor_q64 1,233,382,199,312 → 1,236,123,063,689 | 34,993 |
| buyer2 redeem all (385,532,593,835,808) | gross 25,834,680, fee 516,694, net 25,317,986 | received 25,317,986; vault → 34,991,343; floor_q64 → 1,254,649,646,182 | 33,335 |

### 6. Refusals, crank loop, final status

```bash
bash packages/sdk/scripts/run.sh redeem --keypair keys/cli-buyer1.json --mint $MINT --raw 1
#   redeem 1 raw base: gross 0, exit fee 0, net 0 raw quote (blocked: ... NothingToRedeem)   exit 1
bash packages/sdk/scripts/run.sh buy --keypair keys/cli-buyer1.json --mint $MINT --raw 1 --rpc https://api.mainnet-beta.solana.com
#   error: refusing: RPC host api.mainnet-beta.solana.com is not localhost/127.0.0.1 (local clusters only)   exit 1
bash packages/sdk/scripts/run.sh crank --keypair ~/.config/solana/id.json
#   error: refusing ~/.config/solana/id.json: use a dedicated keypair under keys/   exit 1
bash packages/sdk/scripts/run.sh crank --keypair keys/cli-cranker.json --loop --interval 2   # stopped with SIGINT
#   ATr3hnWy…: nothing due (phase redeemable)   (x3), then "stopping after this pass"
bash packages/sdk/scripts/run.sh status --mint $MINT --price-usd 759.3264126505499
```

Final status: `redeemable`, vault 34,991,343 raw, supply 514,467,406,164,188 raw, floor_q64
1,254,649,646,182 (floor view = state), floor $5.1940e-7, max loss 71.09%, no crank action due.

### 7. Nothing reached mainnet, then stop

All 26 local signatures from `surfnet_getLocalSignatures` (funding, launch, trades, cranks,
redemptions) were checked with a read-only mainnet `getSignatureStatuses`
(`searchTransactionHistory: true`): **0 found**. The launch, base mint, DBC config and DAMM v2 pool
accounts do not exist on mainnet (`getMultipleAccounts` → all null).

```bash
bash scripts/surfpool/stop.sh      # surfnet 'rpc-8899': stopped (SIGINT)
```
