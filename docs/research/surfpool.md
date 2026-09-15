# Surfpool: local mainnet-fork dev environment

Date: 2026-09-15. Surfpool **1.5.0** (`~/.local/bin/surfpool`, release tarball; source tag `v1.5.0`,
commit `86493c4`). `getVersion` → `{"surfnet-version":"1.5.0","solana-core":"4.1.2","feature-set":3345198602}`.

**Verdict.** Surfpool executes every transaction in an in-process LiteSVM and uses the datasource
RPC (mainnet) only for reads. This is confirmed from the v1.5.0 source and checked on mainnet
(read-only) for every local signature. The StockFloor first steps run on the local fork: a
SPYx-quoted DBC config, a pool, `create_launch`, `register_pool` and one buy. With the mainnet
token-program ELFs installed, their compute units are identical to the LiteSVM fixture fork.

The LiteSVM fixture fork stays the test harness (`pnpm test`). Surfpool is for the web app, the
scripts and e2e runs against live state.

## Commands

| What | Command |
|---|---|
| Start (background) | `bash scripts/surfpool/start.sh` |
| Second instance | `RPC_PORT=9899 bash scripts/surfpool/start.sh` (WS 9900, studio/HTTP 19488) |
| Start without any datasource | `bash scripts/surfpool/start.sh --offline` |
| Start + token programs + deploy + fund | `FUND_WALLETS="<pk> <pk>" FUND_SOL=10 FUND_SPYX=25 bash scripts/surfpool/up.sh` |
| Deploy stockfloor (cheatcode) | `bash scripts/surfpool/run.sh deploy-local --mainnet-token-programs` |
| Deploy with real loader txs | `bash scripts/surfpool/run.sh deploy-local --mode loader` (`solana program deploy --use-rpc`, ~12 s) |
| Faucet | `bash scripts/surfpool/run.sh fund <pubkey> --sol 10 --token SPYx --amount 10` (`--raw N`, `--token QQQx`/`<mint>`, `--token none`) |
| Smoke + LiteSVM comparison | `bash scripts/surfpool/run.sh smoke --with-launch [--live-price]` |
| Stop | `bash scripts/surfpool/stop.sh` · `RPC_PORT=9899 bash scripts/surfpool/stop.sh` · `bash scripts/surfpool/stop.sh --all` |

`run.sh <name>` is `tests/node_modules/.bin/tsx scripts/surfpool/<name>.ts`. The same thing via pnpm:
`pnpm --filter @stockfloor/tests exec tsx ../scripts/surfpool/<name>.ts`. The scripts resolve
`@solana/web3.js` from the tests package with `createRequire`, so they share one web3 instance
with the `tests/src` harness they import.

### What `start.sh` runs

It runs from `.surfpool/<instance>/`, so Surfpool never sees `Anchor.toml` or `txtx.yml`, and it
unsets the `SURFPOOL_DATASOURCE_RPC_URL` and `SURFPOOL_PUBLIC_*` variables first. The command is:

```
surfpool start --no-tui --no-deploy --yes --host 127.0.0.1 --port $RPC_PORT --ws-port $WS_PORT \
  --studio-port $STUDIO_PORT --airdrop-keypair-path <repo>/keys/deployer.json \
  --airdrop-amount 1000000000000 --slot-time 400 --log-level info \
  --log-path .surfpool/<instance>/logs --surfnet-id <instance> --no-studio \
  (--network mainnet | --rpc-url $MAINNET_RPC_URL | --offline)
```

`start.sh` then waits until three things hold: `getHealth` is `ok`, `getVersion` answers, and in
fork mode the log shows `Datasource connection successful`. It writes
`.surfpool/<instance>/{surfpool.pid, surfpool.log, logs/, env}`. The `env` file sets
`SURFPOOL_RPC_URL` and `SURFPOOL_WS_URL`, and `.surfpool` is already gitignored.

| Env | Default |
|---|---|
| `RPC_PORT` | 8899 |
| `WS_PORT` | `RPC_PORT + 1` (web3.js derives the WS endpoint as port + 1; otherwise export `SURFPOOL_WS_URL`) |
| `STUDIO_PORT` | `18488 + (RPC_PORT − 8899)` |
| `INSTANCE` | `rpc-<RPC_PORT>` |
| `MAINNET_RPC_URL` | unset → `--network mainnet` (https://api.mainnet-beta.solana.com) |
| `AIRDROP_KEYPAIR` | `keys/deployer.json` (must be under `keys/`) |
| `STUDIO=1`, `SLOT_TIME_MS`, `READY_TIMEOUT` (90), `LOG_LEVEL`, `SURFPOOL_EXTRA_ARGS` (e.g. `--db .surfpool/x.sqlite`) | |

Sockets checked with `lsof`: the process listens only on `127.0.0.1:{RPC, WS, studio}`. Two
instances (8899 and 9899) ran side by side.

## Evidence that nothing is relayed to mainnet

### Source, Surfpool v1.5.0 (`solana-foundation/surfpool`, tag `v1.5.0`)

1. **`sendTransaction` never leaves the process.**
   - `crates/core/src/rpc/full.rs:1564` `send_transaction` decodes the tx and puts
     `SimnetCommand::ProcessTransaction` on an in-process channel (`:1589`), then waits for the status.
   - `crates/core/src/runloops/mod.rs:481-486` hands the command to `svm_locker.process_transaction`.
   - `crates/core/src/surfnet/locker.rs:1177` → `fetch_all_tx_accounts_then_process_tx_returning_profile_res`
     (`:1266`). This step loads missing accounts and ALTs with `get_multiple_accounts`, a **read**.
   - `do_process_transaction_internal` (`:2033`) → `SurfnetSvm::send_transaction` (`surfnet/svm.rs:2016`).
   - That calls `self.inner.send_transaction(tx)` (`svm.rs:2056`), which is
     `SurfnetLiteSvm::send_transaction` → `self.svm.send_transaction(tx)`
     (`surfnet/surfnet_lite_svm.rs:166-167`): the embedded LiteSVM.
2. **The only datasource connection is read-only.** It is `SurfnetRemoteClient`
   (`surfnet/remote.rs:38-90`), created once in `runloops/mod.rs:166-176`.
   - Its methods are `get_epoch_info`, `get_epoch_schedule`, `get_account` (plus the mint or
     programdata of the fetched account), `get_multiple_accounts`, `get_transaction`,
     `get_token_accounts_by_owner`/`_by_delegate`, `get_token_largest_accounts`,
     `get_program_accounts`, `get_largest_accounts`, `get_genesis_hash`,
     `get_signatures_for_address` and `get_block`.
   - The only other uses of its inner `client` are `minimum_ledger_slot` and `get_blocks`
     (`rpc/full.rs:1877, 2030-2147`).
   - A grep over `crates/` finds no `send_transaction`, `sendBundle` or `requestAirdrop` call on it.
3. **The one real `RpcClient::send_transaction` outside tests targets the local RPC.** It is the
   TUI's "break solana" helper (`crates/cli/src/tui/simnet.rs:436-449`).
   - Its URL is `SanitizedConfig.rpc_url` = `http://<bind host>:<port>` (`cli/simnet/mod.rs:152-189`).
   - It exists only with the TUI (`:109`). We always pass `--no-tui`.
4. **The rest stays local.** Jito `sendBundle` runs the bundle in a local sandbox VM (doc comment in
   `rpc/jito.rs`). The README says: "Simulate, debug, and replay transactions — all without touching mainnet."
   The Solana docs page (https://solana.com/docs/tools/surfpool) says only that accounts are
   "fetched just in time". It does not describe transaction handling, so the source is the primary evidence.

### Other outbound requests by the binary

- **Datasource reads** (above).
- **A version check.** The release binaries are built with `--features version_check`
  (`.github/workflows/release_cli.yaml:201-213`). After startup they send one GET to
  `https://cloud.txtx.run/api/versions?v=/1.5.0` (`cli/simnet/mod.rs:270-289`). There is no
  flag to turn it off.
- **`surfpool update`** calls api.github.com. We never run it.

### Wallet safety found in the source

- `--airdrop-keypair-path` defaults to `~/.config/solana/id.json`, and Surfpool reads that file at
  startup to airdrop to it (`cli/mod.rs:311-319, 501-553`). **`start.sh` always passes
  `keys/deployer.json`**, so the user wallet is never opened.
- Without `--no-deploy`, Surfpool scaffolds txtx runbooks. Their default payer and authority is
  `id.json` (`cli/scaffold/mod.rs:359-360`), and it executes them (`cli/simnet/mod.rs:259`).
  **`--no-deploy`** is always passed.

### Empirical check (read-only mainnet RPC)

- **Signatures.** Every local signature was passed to mainnet `getSignatureStatuses`
  (`searchTransactionHistory: true`). The sets were the fund ATA transaction, three smoke runs
  (33 signatures), and 200 of the 460 on the second instance, including the final signature
  `HujqLmz…` of the loader deploy. **All returned `null`.** The smoke repeats this check on every
  run (`mainnetRelayCheck` in the report).
- **Accounts.** After the local deploys, mainnet `getMultipleAccounts` returned `null` for the
  program `98NLryxe…`, its programdata `DPuT7zBK…` and the deployer `BBU1tTr4…`. So did
  `getAccountInfo` for the locally created SPYx ATA `4hd26MqY…`.
- **Safety net.** No signer used locally has mainnet funds: the deployer account does not exist
  on mainnet, and the other signers are in-memory keypairs.

## Cheatcodes and RPC used

| Method | Where | Notes |
|---|---|---|
| `requestAirdrop` | deploy-local, fund, smoke | Local SVM airdrop |
| `surfnet_writeProgram(programId, hexChunk, offset, authority?)` | deploy-local | Creates or updates the upgradeable program and programdata; forces a LiteSVM recompile. Chunks up to 5 MB RPC (we use 2 MB) |
| `surfnet_setAccount(pubkey, {lamports?, data?: hex, owner?, executable?, rent_epoch?})` | fund | Partial update; **`data` is hex** (the doc example says base58; the code does `hex::decode`, `rpc/surfnet_cheatcodes.rs:89-93`) |
| `surfnet_registerIdl(idl)` | deploy-local | Best effort, for Studio / `surfnet_getActiveIdl` |
| `surfnet_getLocalSignatures(limit)` | smoke | Source of the mainnet relay check |
| `getVersion`, `getHealth`, `simulateTransaction` | all | The guard requires `surfnet-version` |

**Not used: `surfnet_setTokenAccount`.** For a Token-2022 mint it writes a bare 165-byte account
(`TokenAccount::pack_into_vec`, `crates/core/src/types.rs:1085-1098`). If the account already
exists, the rewrite drops its ImmutableOwner, PausableAccount and TransferHookAccount extensions.
`fund.ts` avoids this:
- it creates the ATA through the real ATA program (179 bytes for SPYx);
- it patches the amount at bytes 64..72 with `surfnet_setAccount`;
- it adds the same amount to the mint supply at bytes 36..44.

**Faucet recipe** for a web API route, with the app's own web3.js:
1. `requestAirdrop` for SOL.
2. Send an ATA `CreateIdempotent` (instruction data `[1]`) paid by a server-side local key.
3. `getAccountInfo` the ATA, set `amount += raw` at offset 64, then
   `surfnet_setAccount(ata, {data: hex})`.
4. Do the same for the mint supply at offset 36.

Refuse non-loopback RPC URLs, as `assertLocalRpcUrl` does.

## Smoke results (compute units)

`smoke.ts` builds each step once and sends the identical signed instructions to the surfnet and
to `Fork.create()` (LiteSVM with the `tests/fixtures` mainnet ELFs). Transactions have no
ComputeBudget instruction, and every step fit the default limit. Within one run both backends
use the same keys, so their CU are comparable. Between runs, CU shift because the PDA bump
search depends on the random config and mint keys.

| Step | Run A: bundled token programs (surfnet / LiteSVM) | Run B: `--mainnet-token-programs` | Run C: B + `--with-launch` | Run D: loader deploy, bundled, `--with-launch` |
|---|---|---|---|---|
| DBC `create_config` (SPYx + badge) | 31,332 / 31,332 | 31,332 / 31,332 | 31,332 / 31,332 | 31,332 / 31,332 |
| DBC `initialize_virtual_pool_with_spl_token` | 110,066 / 110,079 | 107,079 / 107,079 | 117,579 / 117,579 | 108,566 / 108,579 |
| stockfloor `create_launch` | — | — | 50,626 / 50,626 | 58,104 / 58,126 |
| stockfloor `register_pool` | — | — | 7,132 / 7,132 | 7,132 / 7,132 |
| ATA + DBC `swap2` buy (20% of T = 26,269,264 raw) | 50,222 / 50,239 | 50,239 / 50,239 | 53,239 / 53,239 | 53,222 / 53,239 |

- **Parameters.** SDK `buildDbcConfigParams` with SPYx at $757.02, the live multiplier 1.005714560286254,
  a $1,000 threshold = 131,346,320 raw, the `gentle` preset and a 50% vault share.
- **Checks after the buy.** The pool `quote_reserve` is 26,006,571, the buyer holds 146,161,747,317,098 base, the
  buyer spent exactly the input, and the config is owned by DBC. The stockfloor binary deployed
  on the surfnet matched `target/deploy/stockfloor.so` (sha256 `77905e34…`, 450,552 bytes).
- **Fees and latency.** 5,000 lamports per signature. From send to `confirmed` took 306–462 ms with 400 ms slots.
- **First fetch from api.mainnet-beta.solana.com** on a fresh surfnet:

  | Account | First fetch | Cached |
  |---|---|---|
  | DBC programdata (2.3 MB) | 295 ms | 11–18 ms |
  | DAMM v2 programdata | 367 ms | 11–18 ms |
  | Metaplex programdata | 220 ms | 1–7 ms |
  | SPYx mint | 167 ms | 1–7 ms |
  | DBC token badge | 97 ms | 1–7 ms |
  | DBC pool authority | 98 ms | 1–7 ms |
  | DAMM v2 Customizable config | 94 ms | 1–7 ms |

The smoke writes the full report to `.surfpool/rpc-<port>/smoke-report.json`.

## Differences from the LiteSVM fixture fork

1. **Token programs are not the mainnet binaries by default.**
   - **What is bundled.** Surfpool 1.5.0 embeds litesvm 0.14.0, whose `with_default_programs`
     (`crates/litesvm/src/programs/mod.rs`) loads Token-2022 **11.0.0** (615,936-byte ELF) and, with
     `replace_spl_token_with_p_token` active, the p-token ELF for `Tokenkeg…` (100,312 bytes).
   - **Never fetched.** These accounts exist locally, so they never come from mainnet.
   - **Mainnet.** Token-2022 is 1,382,016 bytes (sha256 `0999dbf7…`) and SPL Token 108,600 bytes (`8190d3f7…`).
   - **Effect.** 13–22 CU less per step here, but SPYx (Pausable, ScaledUiAmount, TransferHook
     with a null program) still transfers correctly.
   - **Fix.** `deploy-local --mainnet-token-programs` (also run by `up.sh`) writes the fixture ELFs
     with `surfnet_writeProgram`, after which CU are identical.
   - The ATA program (1.1.1) is byte-identical to mainnet.
2. **Feature gates.** Both are static snapshots of mainnet's active features (`LiteSVM::mainnet_feature_set()`),
   not read from mainnet.
   - **Surfpool** (litesvm 0.14.0) has 235 entries, "sourced from the cluster on 2026-07-10".
   - **The test harness** (`litesvm` node 1.4.1, `new LiteSVM()` → `into_basic` →
     `with_mainnet_features`) has 242 entries, sourced 2026-08-24.
   - **Extra in the harness:** `commission_rate_in_basis_points`, `define_ltds_fee_only_semantics`,
     `discard_unexpected_data_complete_shreds`, `loader_v3_minimum_extend_program_size`,
     `raise_block_limits_to_100m`, `reduce_slot_time_to_350ms`, `validator_admission_ticket`.
     None showed up in the DBC, token or stockfloor paths: create_config CU are identical.
   - **Adjusting.** Surfpool can change the set with `-f/--feature`, `--disable-feature` and `--features-all`.
3. **Clock.**
   - **Surfpool.** The clock follows wall time (Clock sysvar `unix_timestamp` 1789501882 while the
     wall clock read 1789501882). Slots advance every 400 ms from the mainnet slot at startup.
     `surfnet_timeTravel` takes `absoluteTimestamp` in **milliseconds**.
   - **The fixture fork** starts at the dump time (2026-09-15T17:56:10Z) and moves only by `warp`.
4. **Live state and drift.**
   - **Unchanged since the dump.** DBC, DAMM v2, Metaplex, the DBC token badge `D2THzeQ…`
     (168 bytes), the DBC pool authority (58.46 SOL, needed for migration flash rent) and the DAMM v2
     Customizable config are byte-identical to `tests/fixtures`.
   - **Drifted.** The SPYx supply moves (live 9,523,220,691,233 vs fixture 9,523,194,870,404).
     The multiplier is unchanged: 1.003909240011759 → 1.005714560286254, effective 1781755200 (2026-06-18).
   - **Snapshot per run.** Once fetched, an account is never refreshed; the local copy and any cheat
     writes win. A mainnet multiplier change or a DBC upgrade shows up only after a restart
     (or `surfnet_resetAccount` / `surfnet_streamAccount`).
5. **Token badge.** It works as on LiteSVM: remaining account 0 for `create_config` and pool init.
6. **Transaction checks.**
   - Signature verification and the blockhash check are on, and fees are charged (5,000 lamports per signature).
   - Transaction logs are capped at 10,000 bytes each (`--log-bytes-limit`).
   - Instruction profiling is on by default (`--disable-instruction-profiling`).
7. **State lives in memory.** A restart loses deploys and launches. Use `--db <file>.sqlite`
   through `SURFPOOL_EXTRA_ARGS` to persist.

## Caveats

- **`surfnet_writeProgram` never shrinks programdata.** `deploy-local` pads with zeros when the
  new ELF is smaller and checks that the tail is zero.
- **Surfpool binds the studio port even with `--no-studio`.** Its HTTP server always starts, which is
  why `start.sh` offsets `STUDIO_PORT` per instance.
- **`--daemon` is disabled on macOS.** `start.sh` uses `nohup` in the background with a pid file.
  The process survives the calling shell.
- **An unreachable datasource makes Surfpool exit** ("Solana RPC client error"). `start.sh`
  reports this with the log tail.
- **`MAINNET_RPC_URL` with an API key.** Surfpool logs only `scheme://host`
  (`get_sanitized_datasource_url`), and `start.sh` prints only the origin. The full URL is still
  visible in `ps` output.
- **Public RPC limits.** `getProgramAccounts` and `getTokenAccountsByOwner` are proxied to the
  datasource and merged with local state. On the public RPC these calls can be slow or
  rate-limited; set `MAINNET_RPC_URL` for heavy web-app scans.
- **The Anchor IDL and builders must match the deployed binary.** Another agent may rebuild
  `target/deploy/stockfloor.so`, so rerun `deploy-local` after each rebuild. The smoke records
  whether the deployed ELF matches the file.
