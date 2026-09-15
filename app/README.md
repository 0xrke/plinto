# StockFloor web app

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind CSS 4 + `@solana/wallet-adapter-react`
(wallet-standard auto-detection), wired to the chain through `@stockfloor/sdk`.

## Run

```bash
pnpm --filter @stockfloor/app dev        # http://localhost:3000, mock data (default)
pnpm --filter @stockfloor/app test       # vitest unit tests (jsdom / node)
pnpm --filter @stockfloor/app typecheck
pnpm --filter @stockfloor/app build
```

Against a local Surfpool mainnet fork (see `docs/research/surfpool.md` and `scripts/surfpool/`):

```bash
FUND_WALLETS="<your wallet pubkey>" bash scripts/surfpool/up.sh                    # RPC 127.0.0.1:8899
NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 pnpm --filter @stockfloor/app dev
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `mock` | `mock` (design work, tests) or `chain` (on-chain launches through the SDK) |
| `NEXT_PUBLIC_RPC_URL` | `http://127.0.0.1:8899` | RPC for reads, the wallet connection and sends |
| `NEXT_PUBLIC_WS_URL` | RPC port + 1 | WebSocket endpoint, only if it is not the RPC port + 1 |
| `NEXT_PUBLIC_ALLOW_MAINNET` | unset | First mainnet send switch. Sending through a non-loopback RPC needs `1` here **and** `STOCKFLOOR_ALLOW_MAINNET=1` (checkpoint C2 only), the same two-switch rule as the CLI (`--allow-mainnet` + `STOCKFLOOR_ALLOW_MAINNET=1`). With neither, the app sends only to a loopback surfnet or local validator; with only one, it sends nowhere and says which switch is missing |
| `STOCKFLOOR_ALLOW_MAINNET` | unset | Second mainnet send switch, read at build time by `next.config.ts` and inlined into the bundle |
| `NEXT_PUBLIC_PRIORITY_FEE_MICROLAMPORTS` | `100000` on mainnet, `0` locally | Priority fee (micro-lamports per compute unit) on every app transaction: launch (also used for the launch composer's size accounting), trades, redeem and every crank step. Jupiter Ultra swaps set their own |
| `STOCKFLOOR_RPC_URL` | `NEXT_PUBLIC_RPC_URL` | Server-side RPC for the route handlers (faucet, JSON API) |
| `STOCKFLOOR_NEXT_DIST_DIR` | `.next` | Build directory, so several builds can coexist in one checkout |

`NEXT_PUBLIC_*` values are inlined at build time. Never put a keyed RPC URL in a committed file.

## Pages and routes

- `/` launches list: phase, progress to graduation, price, floor, max loss, quote asset.
- `/create` launch form with a live `previewLaunch` preview and an optional creator first buy. Submitting
  runs the SDK launch composer's transactions with step-by-step progress (see below).
- `/t/[mint]` token page: phase stepper; presale progress and curve trade panel, whose buy button reads
  `Price $X · Floor at graduation (est.) $Y · Max loss if it graduates: −Z%` (there is no floor before
  graduation, and the page says so); after graduation the floor meter, the market panel with the honest buy
  label (`Price $X · Floor $Y · Max loss if you buy now: −Z%`). With an exact quote, X is the buy's average
  price (pool fee and price impact included), so a thin pool does not understate the max loss; the redeem panel and vault stats; the permissionless crank panel; disclosures (tracker certificate, issuer controls,
  program upgradeability with the StockFloor upgrade authority read from chain, floor in USD, unaudited) with the non-US
  attestation on every token page, and on `/create` when the launch includes a first buy (a curve trade in the xStock).
- `GET /api/launches`, `GET /api/launches/[mint]`: read-only JSON of the same `LaunchSummary` mapping the
  pages use (raw amounts as strings, floor, max loss, buy label, due crank actions).
- `GET|POST /api/faucet`: local-fork faucet (below).

## Chain integration (M4)

### Read side: `ChainDataSource` (`src/lib/data/chain.ts`)

- `listLaunches`: SDK `listLaunches` (getProgramAccounts on the `Launch` discriminator), then
  `fetchLaunchState` per launch without DAMM positions. One broken launch does not hide the others; if
  every read fails the error reaches the page's error state.
- `getLaunch(mint)`: getProgramAccounts with a memcmp on `Launch.base_mint` (offset 113, cached per mint),
  then `fetchLaunchState` with claimer positions (for the LP-fee crank). An invalid or unknown mint is
  "not found"; an RPC failure is an error, not "not found".
- Mapping (`toLaunchSummary`): SDK phases `presale`/`graduating` map 1:1, `graduated` and `redeemable`
  become the UI's `graduated` (redeem opens only with `migrationFeeHarvested`). Price from the DBC curve
  sqrt price before migration and the DAMM v2 pool after; floor = vault ÷ supply; ScaledUiAmount
  multiplier from the quote mint at the cluster clock; preset from the config's price ratio; vault share =
  the DBC migration fee percentage; the graduation projection = vault now + partner migration fee (added only while the fee is still in
  DBC: the Launch flag and the DBC partner withdraw bit are both unset) over
  `swap_base_amount + migration_base_threshold` (equals the launch composer preview). Name, symbol and
  image come from the Metaplex metadata account (cached; metadata is immutable).
- Launches quoted in a mint outside the allowlist, or without a DBC pool yet, are not shown.
- Prices: Jupiter Price V3 (lite-api, one request for the allowlist plus USDC and SOL, 30 s cache). If
  Jupiter is unreachable, the last read is served, labelled "stale" once it is older than 5 minutes;
  with nothing read yet, a dated reference table (one Jupiter read, 2026-09-15 22:45 UTC) is used and
  labelled. Creating a launch outside a local cluster refuses stale and reference prices.
- React Query polls chain data (launch page 6 s, list 15 s, balances 10 s, markets 60 s) and refetches
  right after a confirmed transaction. Mock data is never polled.

### Write side: `ChainLaunchActions` (`src/lib/data/chainActions.ts`)

Every action: wallet check → cluster send guard (SDK `evaluateSendGuard` over a read-only probe) → fresh
chain state → balance checks with a readable message (and a faucet hint on the local fork) → transactions
through `ConnectionSender` with the wallet's `signTransaction` (extra keypairs sign locally after the
wallet) → progress through the transaction flow state machine (`src/lib/chain/txFlow.ts`, rendered by
`TxProgress`: pending / preparing / approve in wallet / confirming / done / failed / skipped, explorer
links) → errors mapped to one sentence (`src/lib/chain/errors.ts`: wallet rejection, StockFloor IDL
messages, DBC/DAMM slippage and liquidity, missing SOL, expired blockhash, unreachable RPC).

| Action | Local fork (Surfpool) | Mainnet (`NEXT_PUBLIC_ALLOW_MAINNET=1` and `STOCKFLOOR_ALLOW_MAINNET=1`) |
|---|---|---|
| Create launch | SDK `buildLaunchTransactions` (tx1 config + `create_launch`, tx2 pool + `register_pool` + first buy when it fits, tx3 otherwise), config and base mint keypairs generated in memory. A failed attempt can be retried from the failed step with the same keypairs; steps already on chain are detected and not resent | same |
| Presale buy / sell | DBC `swap2` with the quote asset, exact SDK quote and 1% slippage floor; a buy that crosses the migration price becomes PartialFill. The panel passes the venue and minimum it displayed: the action re-quotes at fresh state, refuses (nothing sent) when the venue changed or the fresh output is below that minimum, and never signs a lower minimum than the one shown | USDC/SOL → quote via Jupiter Ultra, then the curve buy with the routed amount (two transactions); quote asset directly as on the fork |
| Buy / sell after migration | DAMM v2 `swap2` with the quote asset, with the same displayed-minimum rule | USDC/SOL through Jupiter Ultra to the pool; quote asset directly |
| Redeem | SDK `buildRedeem`; enabled only when migrated, the migration fee is harvested and the payout is above zero | same |
| Crank | SDK `runCrank` (harvest curve fees, migration fee, surplus, DBC → DAMM v2 migration, LP fees, claimer base burn); the wallet pays fees, each step shows up in the progress list | same |

On the local fork USDC and SOL options are disabled with the explanation that Jupiter routing is
mainnet-only, and the quote asset is the default.

### Local fork helpers

- **Badge**: the header shows "Local fork" (and a strip below it for chain data) whenever the RPC host is
  loopback.
- **Faucet**: the header button (chain data, loopback RPC, connected wallet) calls `POST /api/faucet`
  `{ wallet, token? }`. The route (`src/lib/faucet/`) refuses with 403 before any network call unless the
  server RPC host parses as 127.0.0.1 / localhost / ::1 without credentials, then requires a Surfpool
  surfnet (`getVersion` `surfnet-version` and `surfnet_getLocalSignatures`). It airdrops 10 SOL, creates the
  wallet's SPYx (or another allowlisted quote) associated token account through the ATA program paid by a
  throwaway in-memory keypair, and adds 5 whole raw-unit tokens (5×10^8 raw SPYx) with `surfnet_setAccount` (token account amount and
  mint supply). The button reports the UI amount the wallet shows (≈5.03 SPYx at the current multiplier). A JSON content type is required (cross-site form posts are refused).
- **Wallets**: the app only asks the wallet to sign and sends through its own RPC, so transactions go to
  the fork whatever network the wallet shows. Wallet simulation previews may warn because the wallet
  simulates against its own network; Solflare and Backpack can point their RPC at the fork for accurate
  previews.

## Layout

```
src/
  app/                      routes, root layout, globals.css; api/ route handlers (launches, faucet)
  components/
    layout/                 header (network badge, faucet), footer, wallet button
    launch/                 launch list and cards
    create/                 create form (first buy, launch progress, retry), preview panel, curve sketch
    token/                  token view, floor meter, curve / market trade panels, redeem, crank, vault stats, disclosures
    ui/                     primitives (avatar, badge, progress bar, amount field, transaction progress)
  lib/
    format.ts, metrics.ts, estimates.ts, launchForm.ts, attestation.tsx, tradeQuote.ts
    config.ts               public env config, polling intervals, fixed launch terms
    chain/                  cluster probe + send guard, connection/reader, prices, metadata, errors,
                            transaction flow state machine, wallet sender, Jupiter Ultra leg, explorer links
    data/
      types.ts              LaunchDataSource (read) and LaunchActions (write) interfaces
      mock.ts, actions.ts   MockDataSource and StubLaunchActions (design work and tests)
      chain.ts              ChainDataSource and the LaunchState → LaunchSummary mapping
      chainActions.ts       ChainLaunchActions
      serialize.ts, server.ts  JSON view and the server-side data source for route handlers
      context.tsx           React Query hooks (polling, balances, cluster, transaction flow)
    faucet/                 localhost guard, Surfpool funding, request handler
  test/                     vitest setup and chain fixtures (SDK-built LaunchState, account encoders, fake reader)
e2e/                        local-fork end-to-end driver and page render check (not part of pnpm test)
```

## Tests

`pnpm --filter @stockfloor/app test` (part of the root `pnpm test`): 17 files, 130 tests.

- `lib/data/chain.test.ts`: mapping of SDK `LaunchState`s built with the launch composer (presale,
  graduating, graduated, redeemable, paused, flat preset, missing metadata, unlisted quote, no pool) and
  `ChainDataSource` over a fake `ChainReader` with hand-encoded Metaplex metadata, Token-2022 mints with
  ScaledUiAmount and token accounts (sorting, caching, partial failures, memcmp resolution, RPC errors).
- `lib/chain/txFlow.test.ts`: the flow reducer (order, single active step, failure, resume, late events,
  discovered steps) and the step runner (phases, earlier completions, on-chain detection, first failure).
- `lib/data/chainActions.test.ts`: create launch through the real `ConnectionSender` over a fake
  connection that verifies every signature (config and base mint keypairs), first buy placement, SOL and
  quote balance refusals, resume after a failed second transaction, wallet rejection, send guard; curve
  trades with measured amounts, mainnet-only routing refusals, Jupiter-then-curve routing on mainnet;
  redeem gating and payout; crank step mapping (executed, skipped, failed).
- `lib/faucet/faucet.test.ts`: the localhost guard (mainnet URL, private IPs, `127.0.0.1.nip.io`,
  `localhost.evil.example`, credentials, other schemes refused without a probe; loopback non-surfnet
  refused), the request handler and the `/api/faucet` route module with stubbed env and fetch.
- `lib/chain/{cluster,errors,metadata,prices}.test.ts`, `components/token/TradePanels.test.tsx` (the buy
  label stays exactly the price / floor / max-loss sentence; USDC/SOL disabled on the fork; exact curve
  quote), plus the earlier format, metrics, estimates, form, card, floor meter and redeem panel tests.

## Local fork end-to-end

Needs a running surfnet and a chain build of the app; never part of `pnpm test`. Ports used for the
recorded run: RPC 28899, WS 28900, Surfpool studio 38488, app 3288.

```bash
RPC_PORT=28899 bash scripts/surfpool/up.sh
cd app
NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=http://127.0.0.1:28899 STOCKFLOOR_NEXT_DIST_DIR=.next-e2e-local pnpm build
NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=http://127.0.0.1:28899 STOCKFLOOR_NEXT_DIST_DIR=.next-e2e-local pnpm exec next start -p 3288 -H 127.0.0.1 &
pnpm e2e:local        # STOCKFLOOR_E2E_RPC_URL / STOCKFLOOR_E2E_APP_URL override the defaults above
RPC_PORT=28899 bash scripts/surfpool/stop.sh
```

A browser wallet cannot be driven here, so `e2e/local-fork.e2e.ts` runs the exact code the UI calls
(`createBackend("chain")` → `ChainLaunchActions` / `ChainDataSource`) with in-memory keypairs standing in
for `signTransaction`, funds them through the running app's faucet route, and after each step compares
the running app's `/api/launches/[mint]` JSON with a direct SDK read (vault, supply, reserve, phase,
floor Q64, due crank actions). `e2e/render.e2e.tsx` then renders the real `TokenView` and `LaunchList`
components in jsdom against the fork and checks them against the same JSON, and drives
`CreateLaunchForm`, the curve trade panel and the crank button with a keypair-backed wallet context.

Recorded run, 2026-09-16 ~01:07 local (22:07Z), fresh surfnet (Surfpool 1.5.0, stockfloor.so sha256
`580ecbee…`), `next build && next start` of commit `80fe9a7`, live Jupiter SPYx price $757.28, on-chain
multiplier 1.005714560286254. `pnpm e2e:local`: 11 + 3 tests passed.

| Step | Verified |
|---|---|
| Guard | loopback RPC, SDK send guard mode `surfnet` (mainnet genesis + `surfnet-version` 1.5.0 + `surfnet_getLocalSignatures`) before any send; `GET /api/faucet` enabled, `/api/launches` source `chain` |
| Faucet route | 415 for a non-JSON body, 400 for a bad wallet; three wallets got 10 SOL and exactly 500,000,000 raw SPYx |
| Create launch | two transactions (config + `create_launch`; pool + `register_pool` + first buy of 0.1 SPYx UI), every step done; the app lists "E2E Floor 382qvl" / E2EF as presale, gentle preset, 50% vault share, 200 bps, image URL; `/`, `/create`, `/t/<mint>` return 200 |
| Refusals | USDC buy on the fork → "Routing USDC through Jupiter works on mainnet only…"; redeem in presale → "Redeem opens after migration…"; empty wallet → "Trading needs at least 0.005 SOL… Use the local faucet"; nothing sent |
| Curve trades | buys of 40,000,000 and 30,000,000 raw SPYx ("Paid 0.40228582 SPYx, received 217,417,683.41 $E2EF.") and a sell of 21,741,768,340,849 base for 4,190,052 raw: every spent and received amount equals the SDK quote |
| Crank (presale) | `harvest_curve_fees`; vault increased, partner fee reset to 0 |
| Completing buy | 200,000,000 raw requested; PartialFill used 56,959,147 and received 279,648,004,926,911 base (= quote); the app shows `graduating`, progress 1, due `harvest_migration_fee`, `harvest_surplus`, `migrate`; a buy is refused while graduating |
| Crank (graduation) | `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus`, `migrate` (4 transactions); vault 66,440,819 (≥ the 65,650,462 partner fee); the app shows `graduated` / `redeemable`, the DAMM v2 pool, buy label "Price $0.0000016 · Floor $0.000000506 · Max loss if you buy now: −68.3%" |
| DAMM v2 trades | buy 30,000,000 raw SPYx → 97,555,278,891,992 base; sell 86,988,750,348,138 base → 27,134,999 raw SPYx; both equal the SDK quotes |
| Crank (LP fees) | `harvest_lp_fees` on the claimer position; the vault grew by exactly the pending quote fee |
| Redeem | 146,615,596,979,819 base → net 9,612,424 raw SPYx, fee 196,172, both equal `previewRedeem`; vault and supply moved by exactly those amounts; floor Q64 1,234,088,857,184 → 1,238,329,324,966; a 1-raw redemption → "This amount is too small: the redemption would pay nothing." |
| After each step | `/api/launches/[mint]` equals a direct SDK read: vault, supply, quote reserve, SDK phase, floor Q64, due crank actions |
| Page render (jsdom) | `TokenView`: heading, Graduated badge, the exact buy-label sentence (max loss equal to the route's), vault balance and supply equal to the JSON, redeem field open, local-fork routing note, crank panel consistent with due actions, disclosures; `LaunchList` links the launch to `/t/<mint>` |
| UI-driven (jsdom) | a faucet-funded keypair wallet filled `CreateLaunchForm` ("UI Form 842j7", first buy 0.05 SPYx) and clicked Launch: two steps done, "Open the token page" link; on its `TokenView` it ticked the attestation, bought 0.1 SPYx in the curve panel ("Paid 0.1 SPYx, received … $UIFL.") and ran the crank button (curve fees harvested, vault 83,525 raw, nothing left due) |
| Mainnet | the flow's 15 app signatures plus the surfnet's local signature list (26) looked up with read-only `getSignatureStatuses` on mainnet: 0 found; after the UI-driven run all 33 local signatures: 0 found |

Final JSON (excerpt) for "E2E Floor 382qvl": `chainPhase` redeemable, `vaultRaw` 57,287,667, `supplyRaw`
853,384,403,020,178, `crankDue` [], buy label "Price $0.00000171 · Floor $0.000000513 · Max loss if you
buy now: −70.1%", `priceSource` jupiter. The surfnet and the app server were stopped afterwards.

`next dev` generates `AGENTS.md` and
`CLAUDE.md` in `app/`; `agentRules: false` in `next.config.ts` turns that off and both names are gitignored.
