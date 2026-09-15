# @stockfloor/sdk

TypeScript client for StockFloor launches: floor math and presets, instruction builders for the
stockfloor program, Meteora DBC 0.2.1 and DAMM v2 0.2.4, exact swap quotes, the launch composer, the
crank, senders, the mainnet send guard and Jupiter helpers. web3.js v1 + `@coral-xyz/anchor` 0.31.1.

- `@stockfloor/sdk`: browser-safe (no filesystem, no Node `Buffer` APIs in SDK code; bundles with
  esbuild `--platform=browser`).
- `@stockfloor/sdk/node`: Node-only helpers (`loadKeypair` with the repo `keys/` rule).
- CLI: [scripts/README.md](scripts/README.md).

## Chain access

Everything that reads takes a `ChainReader`; everything that sends takes a `TxSender`
(`src/chain.ts`).

```ts
import { Connection, Keypair } from "@solana/web3.js";
import { ConnectionSender } from "@stockfloor/sdk";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const sender = new ConnectionSender(connection, keypair);                   // CLI / crank
const walletSender = new ConnectionSender(connection, {                     // web app
  publicKey: wallet.publicKey!,
  signTransaction: wallet.signTransaction!,
}, { computeUnitPriceMicroLamports: 10_000 });

await sender.send(instructions, { signers, computeUnitLimit, label });      // -> { signature, logs, unitsConsumed }
```

Failures throw `TransactionFailedError` (`logs`, `errorName` such as `NothingToRedeem`, `errorCode`).
A wallet signs first, then extra keypairs (config, base mint, position NFT mints) are added.
The fork tests use `tests/sdk/litesvm-sender.ts`, the same interface over LiteSVM.

## Reading launches

```ts
import { listLaunches, fetchLaunchState, getFloor, launchMetrics, previewRedeem } from "@stockfloor/sdk";

const launches = await listLaunches(sender);                                // [{ address, launch }] newest first
const s = await fetchLaunchState(sender, { baseMint });                     // or { launch } / { config }; null if absent
const m = await resolveLaunchByBaseMint(sender, baseMint);                  // { address, launch, canonical } | null
s.phase;              // "presale" | "graduating" | "graduated" | "redeemable"
s.progress;           // { quoteReserve, threshold, fraction 0..1 }
s.vaultBalance; s.baseSupply; s.floor;                                      // raw bigint; floor = FloorInfo (vaultRaw, supply, exitFeeBps, floorQ64)
s.quoteMultiplier;    // effective ScaledUiAmount multiplier at the cluster clock
s.dbcConfig; s.dbcPool; s.damm.state; s.positions;                          // decoded Meteora state, claimer DAMM v2 positions with pending fees
const view = await getFloor(sender, s.launch);                              // the on-chain floor view (simulation), equals s.floor
const m = launchMetrics(s, { quotePriceUsd });                              // priceUsd, floorUsd, maxLossIfBuyNow, vaultUsd, ...
const r = previewRedeem(s, amountRaw);                                      // { gross, fee, net, blockedReason }
```

App phase mapping: `presale` → presale, `graduating` → graduating, `graduated` and `redeemable` →
graduated (redeem enabled only for `redeemable`).

**Lookup by base mint.** `create_launch` accepts any base mint, so anyone can create extra pool-less
`Launch` accounts that commit the mint of a live launch, and `getProgramAccounts` returns matches in no
guaranteed order. `resolveLaunchByBaseMint` (used by `resolveLaunchAddress`, `getLaunch` and
`fetchLaunchState({ baseMint })`) returns the launch that owns the mint's DBC pool — registered, or the
canonical pool exists and belongs to the launch's config — and there can be at most one. A single
pool-less match comes back with `canonical: false` (a launch between its two transactions; do not cache
it), several throw `AmbiguousLaunchError`.

## Creating a launch

```ts
import { buildLaunchTransactions, getMintInfo, getClock, effectiveMintMultiplier, getJupiterPrices } from "@stockfloor/sdk";

const built = buildLaunchTransactions(input, creator, { firstBuy: { quoteAmount, slippageBps: 100 } });
for (const tx of built.transactions) {
  await sender.send(tx.instructions, { signers: tx.signers, computeUnitLimit: tx.computeUnitLimit, label: tx.label });
}
built.addresses;      // config, launch, claimer, vaultAuthority, vault, baseMint, pool, ...
built.preview;        // start / graduation price, floor at graduation, vault at graduation
built.firstBuyQuote;  // exact DBC quote of the creator's first buy on the fresh pool
```

tx 1: DBC `create_config` (token badge) + `create_launch` (signer: config keypair). tx 2: DBC pool +
`register_pool` (+ first buy when it fits; signer: base mint keypair). tx 3: the first buy when it does
not fit. Every transaction is a legacy transaction ≤ 1232 bytes (tested for all quotes, presets, maximum
metadata and priority fees).

## Trading and redeeming

```ts
import { quoteTrade, buildTrade, buildRedeem } from "@stockfloor/sdk";

const t = buildTrade(s, trader, "buy", quoteRaw, { slippageBps: 100 });     // or "sell" with base raw
t.quote.venue;        // "dbc" (presale; PartialFill when the buy would cross the migration price) | "damm"
t.quote.amountIn; t.quote.amountOut; t.minAmountOut;
await sender.send(t.instructions, { computeUnitLimit: t.computeUnitLimit });

const red = buildRedeem(s, holder, baseRaw);                                // throws TradeUnavailableError when blocked
await sender.send(red.instructions, { computeUnitLimit: red.computeUnitLimit });
```

Quotes (`quoteDbcSwap`, `quoteDammV2ExactIn`) are exact ports of the program math: the fork tests
assert every quoted amount, fee and sqrt price equals the program's result.

## Crank

```ts
import { planCrank, buildCrankAction, runCrank, runCrankAll } from "@stockfloor/sdk";

planCrank(s);         // pure: ordered due actions (register_pool, harvest_curve_fees, harvest_migration_fee,
                      // harvest_surplus, migrate, sync_migration, harvest_lp_fees per position, burn_claimer_base)
await runCrank(sender, { launch });   // executes until nothing is due; races are re-planned and skipped
await runCrankAll(sender);            // every launch
```

- **`sync_migration`** is planned as soon as DBC reports the migration while `Launch.migrated` is unset,
  which is the normal case: the one-shot DBC harvests run before `migration_damm_v2` and latch nothing.
  After it, `redeem` never decodes the (upgradeable) DBC pool again.
- **LP fee harvests are limited by default** (`PlanCrankOptions`): only positions on the launch's own
  DAMM v2 pool (`includeForeignPositions` opts in), only with at least `defaultMinLpFeeQuote(decimals)`
  = 0.00001 quote token pending (`minLpFeeQuote`; `minLpFeeBase` enables base-only harvests), at most
  `maxLpHarvests` = 4 per plan, largest first. DAMM v2 `create_position` takes an arbitrary owner, so
  anyone can give the claimer dust positions on their own pool and make one swap trigger many paid
  harvests.

## Guard, Jupiter, IDLs

- `evaluateSendGuard` / `probeCluster`: local-only sending rules (see scripts/README.md).
- `getJupiterPrices`, `getUltraOrder`, `getUsdcToQuoteOrder`, `getSolToQuoteOrder`, `executeUltraOrder`
  (mainnet only).
- `STOCKFLOOR_IDL` (+ `Stockfloor` type), trimmed `DBC_IDL` / `DAMM_V2_IDL`. After a program build run
  `pnpm --filter @stockfloor/sdk run sync-idl`; `test/idl-sync.test.ts` fails until the copies match.
