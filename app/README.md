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
| `NEXT_PUBLIC_SITE_URL` | unset (Vercel's production URL when it is set) | Public origin of the deployment, used as the metadata base for link previews (Open Graph / Twitter card) |
| `NEXT_PUBLIC_REPO_URL` | unset | Source repository (https). When set, the footer links to the code, `docs/architecture.md` and the README security section; when unset those links are hidden rather than guessed |
| `NEXT_PUBLIC_LIVE_APP_URL` | unset | The chain-connected deployment. Named by the demo-data banner of a preview build |
| `NEXT_PUBLIC_DEMO_THRESHOLDS` | unset | `1` switches `/create` to the demo threshold policy: quick picks $50 / $100 / $1,000 (default $1,000) and a $1 minimum (the SDK's `MIN_THRESHOLD_USD`), for cheap demo launches. Unset (or any other value): quick picks $10,000 (default) / $25,000 / $50,000 and a $10,000 minimum. The maximum is $100,000 either way. UI-level only; the program has no USD oracle |
| `STOCKFLOOR_LOCAL_BUILD` | unset | `1` marks a production build as local (fork or demo data), which is what the deploy guard below asks for |
| `NEXT_PUBLIC_WS_URL` | RPC port + 1 | WebSocket endpoint, only if it is not the RPC port + 1 |
| `NEXT_PUBLIC_ALLOW_MAINNET` | unset | First mainnet send switch. Sending through a non-loopback RPC needs `1` here **and** `STOCKFLOOR_ALLOW_MAINNET=1` (checkpoint C2 only), the same two-switch rule as the CLI (`--allow-mainnet` + `STOCKFLOOR_ALLOW_MAINNET=1`). With neither, the app sends only to a loopback surfnet or local validator; with only one, it sends nowhere and says which switch is missing |
| `STOCKFLOOR_ALLOW_MAINNET` | unset | Second mainnet send switch, read at build time by `next.config.ts` and inlined into the bundle |
| `NEXT_PUBLIC_PRIORITY_FEE_MICROLAMPORTS` | `100000` on mainnet, `0` locally | Priority fee (micro-lamports per compute unit) on every app transaction: launch (also used for the launch composer's size accounting), trades, redeem and every crank step. Jupiter Ultra swaps set their own |
| `STOCKFLOOR_RPC_URL` | `NEXT_PUBLIC_RPC_URL` | Server-side RPC for the route handlers (faucet, JSON API) |
| `STOCKFLOOR_NEXT_DIST_DIR` | `.next` | Build directory, so several builds can coexist in one checkout |

`NEXT_PUBLIC_*` values are inlined at build time. Never put a keyed RPC URL in a committed file.

## Deploying the app

The defaults are development defaults: **demo data** (four invented launches, every button refused) and a
**loopback RPC** (a Surfpool fork on the machine that ran the build). A hosted build that forgets both
shows made-up tokens to whoever opens the link, so `next build` refuses to produce one. Required for a
hosted deployment:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `chain` |
| `NEXT_PUBLIC_RPC_URL` | the mainnet RPC endpoint the browser uses (a provider key restricted to the deployment's domain; the public endpoint is rate-limited) |
| `STOCKFLOOR_RPC_URL` | the RPC the server routes use (`/api/launches`, `/api/launches/[mint]`). Can be a second, unrestricted key; it never reaches the browser |
| `NEXT_PUBLIC_SITE_URL` | the public origin, so a shared link previews with a card instead of blank |
| `NEXT_PUBLIC_REPO_URL` | the repository, so a judge who likes the app can reach the code from the footer |

Do **not** set `NEXT_PUBLIC_ALLOW_MAINNET` / `STOCKFLOOR_ALLOW_MAINNET` unless the deployment is meant to
send mainnet transactions from the browser; without them the app reads mainnet and refuses to send
(useful for a read-only demo deployment next to the C2 launch). `/api/faucet` refuses anything but a
loopback surfnet, so it is inert on a hosted build.

```bash
# hosted build (what a deploy platform runs)
NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=https://<provider>/<key> \
NEXT_PUBLIC_SITE_URL=https://<domain> NEXT_PUBLIC_REPO_URL=https://github.com/<org>/<repo> \
pnpm --filter @stockfloor/app build

# local production build (Surfpool fork, or a design preview on demo data)
pnpm --filter @stockfloor/app build:local      # = STOCKFLOOR_LOCAL_BUILD=1 next build
```

The guard lives in `src/lib/deployGuard.ts` and runs from `next.config.ts` in the production-build phase
only (`next dev` and `next start` are untouched). It fails the build when the data source is not `chain`
or the RPC URL is loopback, unless `STOCKFLOOR_LOCAL_BUILD=1` says the build is local. A build that does
run on demo data shows a banner above the launch list saying the launches are made up, and every action
answers with the same sentence instead of a developer message.

## Pages and routes

- `/` launches list: phase, progress to graduation, price, floor, max loss, quote asset.
- `/create` launch form with a live `previewLaunch` preview and an optional creator first buy. Submitting
  runs the SDK launch composer's transactions with step-by-step progress (see below).
  - **Token metadata JSON URL**: the value goes into DBC's `initialize_virtual_pool_with_spl_token` as the
    token `uri` and from there into the immutable Metaplex metadata account, which is what Phantom,
    Solscan, Jupiter and DexScreener read. The field asks for a metadata JSON document
    (`{ name, symbol, description, image }`); a bare image URL still works (the app reads it as the image)
    but leaves the token without a description everywhere else, forever. The preview avatar shows initials
    for a JSON URI, because the document is only fetched once the token exists.
  - **Graduation threshold (advanced)**: quick picks $10,000 (default), $25,000 and $50,000 plus a custom
    USD amount; a build with `NEXT_PUBLIC_DEMO_THRESHOLDS=1` offers $50, $100 and $1,000 (default) instead.
    The preview (threshold in the quote asset, floor at graduation, vault, prices) follows it. The rules
    live in `thresholdPolicy()` in `src/lib/config.ts` and the validation in `src/lib/launchForm.ts`: the
    field takes a dollar amount with at most two decimals between the policy minimum ($10,000, or the
    SDK's `MIN_THRESHOLD_USD` of $1 in a demo build) and `THRESHOLD_MAX_USD` ($100,000, an app bound so one
    extra zero cannot 10× a raise), and `previewLaunchInput` then runs `previewLaunch` **and**
    `buildDbcConfigParams`, the SDK's port of everything DBC's `create_config` checks on chain. A
    threshold the chain would reject (the raw u64 threshold at the live quote price, the DBC sqrt-price
    range) shows up on the field and disables Launch instead of failing at signing time. Below
    `METEORA_KEEPER_MIN_THRESHOLD_USD` ($750, reachable only in a demo build) the form says that Meteora's
    keeper will not migrate the pool and the permissionless crank has to. The demo build's $50 quick pick
    is the C2 mainnet demo threshold (`docs/research/surfpool-e2e.md` §3), so the whole demo can be driven
    from the UI. The threshold policy is UI-level only: the program has no USD oracle.
  - Once a launch is on chain — and while a retry is pending, because a retry re-sends the transactions
    built from the original input — every parameter fieldset is disabled, so the preview can never
    promise a floor or a threshold other than the launched one.
- `/t/[mint]` token page: phase stepper; presale progress and curve trade panel, whose buy button reads
  `Price $X · Floor at graduation (est.) $Y · Max loss if it graduates: −Z%` (there is no floor before
  graduation, and the page says so); after graduation the floor meter, the market panel with the honest buy
  label (`Price $X · Floor $Y · Max loss if you buy now: −Z%`). With an exact quote, X is the buy's average
  price (pool fee and price impact included), so a thin pool does not understate the max loss; the redeem panel and vault stats (which end with the two sentences about where the floor can and cannot move; there is no empty chart card); the permissionless crank panel; disclosures (tracker certificate, issuer controls,
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
- `getLaunch(mint)`: the SDK's `resolveLaunchByBaseMint` (getProgramAccounts with a memcmp on
  `Launch.base_mint`, offset 113), then `fetchLaunchState` with claimer positions (for the LP-fee crank).
  `create_launch` takes any base mint, so anyone can create a pool-less `Launch` account that commits a
  live launch's mint for about 0.01 SOL; getProgramAccounts returns matches in no guaranteed order, so the
  page must not take the first one. The SDK picks the launch that owns the mint's DBC pool (a mint has
  exactly one) and refuses to guess when several pool-less launches claim it — the page then says so
  instead of showing a wrong or empty token. Only a launch that owns the pool is cached per mint, in
  `getLaunch` and in `listLaunches`. An invalid or unknown mint is "not found"; an RPC failure is an error,
  not "not found".
- Mapping (`toLaunchSummary`): SDK phases `presale`/`graduating` map 1:1, `graduated` and `redeemable`
  become the UI's `graduated` (redeem opens only with `migrationFeeHarvested`). Price from the DBC curve
  sqrt price before migration and the DAMM v2 pool after; floor = vault ÷ supply; ScaledUiAmount
  multiplier from the quote mint at the cluster clock; preset from the config's price ratio; vault share =
  the DBC migration fee percentage; the graduation projection = vault now + partner migration fee (added only while the fee is still in
  DBC: the Launch flag and the DBC partner withdraw bit are both unset) over
  `swap_base_amount + migration_base_threshold` (equals the launch composer preview). Name, symbol and the
  token URI come from the Metaplex metadata account (cached; metadata is immutable). The image is the URI
  itself when it is an image, or the `image` field of the metadata JSON document when the URI ends in
  `.json` (fetched once per mint, 4 s timeout; any failure means the token shows its initials).
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

`pnpm --filter @stockfloor/app test` (part of the root `pnpm test`): 23 files, 200 tests.

- `lib/data/chain.test.ts`: mapping of SDK `LaunchState`s built with the launch composer (presale,
  graduating, graduated, redeemable, paused, flat preset, missing metadata, unlisted quote, no pool) and
  `ChainDataSource` over a fake `ChainReader` with hand-encoded Metaplex metadata, `Launch` accounts,
  Token-2022 mints with ScaledUiAmount and token accounts (sorting, caching, partial failures, base-mint
  resolution, RPC errors). Two of them are the shadow-launch cases: a pool-less `Launch` account that
  commits a live launch's base mint never takes over its token page (in either getProgramAccounts order,
  and it cannot poison the mint → launch cache through the list), and two pool-less launches for one mint
  produce a message rather than a wrong page. A third checks that the image of a metadata JSON URI is read
  from the document once per mint and that a failed read degrades to initials.
- `lib/chain/metadata.test.ts`: the Metaplex decoder, and `resolveTokenImageUrl` (a plain image URI needs
  no network read; the `image` field of a JSON document is used; a failed, non-JSON, hanging or non-https
  document means no image).
- `lib/deployGuard.test.ts`: the production-build guard refuses demo data and a loopback RPC, names both
  in one message, and lets an explicitly local build through.
- `components/layout/DemoDataBanner.test.tsx`, `components/layout/SiteFooter.test.tsx`: the demo-data
  banner appears only on mock data and can be dismissed; the footer always links the deployed program and
  links the repository documents only when `NEXT_PUBLIC_REPO_URL` is a valid https URL.
- `app/page.test.tsx`: the home page leads with the quote-asset path (Jupiter routing is named as a
  mainnet convenience, not as the headline) and no longer claims a fixed ~$1,000 raise.
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
- `lib/launchForm.test.ts`: the threshold field (parsing, the `MIN_THRESHOLD_USD` and `THRESHOLD_MAX_USD`
  bounds) and `previewLaunchInput` (the floor scales with the threshold, max loss does not; a threshold
  the chain would reject comes back as the chain's own message).
- `components/create/CreateLaunchForm.test.tsx`: the threshold presets and the custom field move the
  preview, an out-of-range threshold disables Launch, the chosen threshold is what reaches the action,
  the parameters are frozen after a launch and while a retry is pending, and the metadata JSON URL reaches
  the SDK input as the token `uri` while never being rendered as an `<img>`.
- `lib/chain/{cluster,errors,metadata,prices}.test.ts`, `components/token/TradePanels.test.tsx` (the buy
  label stays exactly the price / floor / max-loss sentence; USDC/SOL disabled on the fork; exact curve
  quote), plus the earlier format, metrics, estimates, form, card, floor meter and redeem panel tests.
- Money-wording and rounding regressions: `RedeemPanel.test.tsx` checks that the post-redemption floor is
  labelled "never falls in SPYx" (the per-token floor only rises in the quote asset; in USD it moves with
  the underlying) and that the vault card's floor per token in the quote asset is rounded **down**;
  `format.test.ts` covers `formatSignificantDown`.

## Local fork end-to-end

Needs a running surfnet and a chain build of the app; never part of `pnpm test`. Ports used for the
recorded run: RPC 28899, WS 28900, Surfpool studio 38488, app 3288.

```bash
RPC_PORT=28899 bash scripts/surfpool/up.sh
cd app
STOCKFLOOR_LOCAL_BUILD=1 NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=http://127.0.0.1:28899 STOCKFLOOR_NEXT_DIST_DIR=.next-e2e-local pnpm build
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
`CreateLaunchForm` (including the advanced threshold control), the curve trade panel, the crank button
and the redeem panel with a keypair-backed wallet context.

Recorded run, 2026-09-16 ~02:40 local (2026-09-15 23:40Z), fresh surfnet (Surfpool 1.5.0,
`target/deploy/stockfloor.so` 458,160 bytes, sha256
`b1a1531ca855730382334c7e66cb9635e7bdde3d0cbc12cb8ae4f354243df0e3`, not rebuilt), `next build &&
next start` of the working tree at commit `abf8c9b` plus the threshold control and the money-wording
fixes, live Jupiter SPYx price $758.70 at launch. `pnpm e2e:local`: **11 + 4 tests passed**.

| Step | Verified |
|---|---|
| Guard | loopback RPC, SDK send guard mode `surfnet` (mainnet genesis + `surfnet-version` 1.5.0 + `surfnet_getLocalSignatures`) before any send; `GET /api/faucet` enabled, `/api/launches` source `chain` |
| Faucet route | 415 for a non-JSON body, 400 for a bad wallet; three wallets got 10 SOL and exactly 500,000,000 raw SPYx |
| Create launch | two transactions (config + `create_launch`; pool + `register_pool` + first buy of 0.1 SPYx UI), every step done; the app lists "E2E Floor 3bdpk2" / E2EF (mint `3CyMi2YH…zNQgq`) as presale, gentle preset, 50% vault share, 200 bps, image URL; `/`, `/create`, `/t/<mint>` return 200 |
| Refusals | USDC buy on the fork → "Routing USDC through Jupiter works on mainnet only…"; redeem in presale → "Redeem opens after migration…"; empty wallet → "Trading needs at least 0.005 SOL… Use the local faucet"; nothing sent |
| Curve trades | buys of 40,000,000 and 30,000,000 raw SPYx ("Paid 0.40228582 SPYx, received 217,809,165 $E2EF.") and a sell of 21,780,916,499,955 base for 4,190,557 raw: every spent and received amount equals the SDK quote |
| Crank (presale) | `harvest_curve_fees`; vault increased, partner fee reset to 0 |
| Completing buy | 200,000,000 raw requested; PartialFill used 56,710,884 and received 278,925,404,130,425 base (= quote); the app shows `graduating`, progress 1, due `harvest_migration_fee`, `harvest_surplus`, `migrate`; a buy is refused while graduating |
| Crank (graduation) | `harvest_curve_fees`, `harvest_migration_fee`, `harvest_surplus`, `migrate`, `sync_migration` (5 transactions); vault 66,316,287 (≥ the 65,527,317 partner fee); the app shows `graduated` / `redeemable`, the DAMM v2 pool, buy label "Price $0.0000016 · Floor $0.000000506 · Max loss if you buy now: −68.3%" |
| DAMM v2 trades | buy 30,000,000 raw SPYx → 97,681,355,424,988 base; sell 86,897,389,843,556 base → 27,091,006 raw SPYx; both equal the SDK quotes |
| Crank (LP fees) | `harvest_lp_fees` on the claimer position; the vault grew by exactly the pending quote fee |
| Redeem | 146,854,801,962,294 base → net 9,610,133 raw SPYx, fee 196,126, both equal `previewRedeem`; vault and supply moved by exactly those amounts; floor Q64 1,231,785,098,657 → 1,236,025,751,674; a 1-raw redemption → "This amount is too small: the redemption would pay nothing." |
| After each step | `/api/launches/[mint]` equals a direct SDK read: vault, supply, quote reserve, SDK phase, floor Q64, due crank actions |
| Page render (jsdom) | `TokenView`: heading, Graduated badge, the exact buy-label sentence (max loss equal to the route's), vault balance and supply equal to the JSON, redeem field open, local-fork routing note, crank panel consistent with due actions, disclosures; `LaunchList` links the launch to `/t/<mint>` |
| UI-driven, default threshold (jsdom) | a faucet-funded keypair wallet filled `CreateLaunchForm` ("UI Form bf1ab", first buy 0.05 SPYx) and clicked Launch: two steps done, "Open the token page" link, and the parameter fieldsets disabled afterwards; on its `TokenView` it ticked the attestation, bought 0.1 SPYx in the curve panel ("Paid 0.1 SPYx, received … $UIFL.") and ran the crank button (curve fees harvested, vault 83,525 raw, nothing left due) |
| **UI-driven, $50 threshold (jsdom)** | the whole demo through the real components at the C2 threshold: the **$50** quick pick moved the preview off the $1,000 default (threshold row and floor at graduation) and showed the "Meteora's keeper does not migrate the pool for you" note; Launch created "UI $50 bf3kl" / UI50 (mint `896DLBzX…18BSF`) with a first buy of 0.02 SPYx and an on-chain threshold of **6,586,828 raw SPYx ≈ $50.26** at the read price (the $1,000 launches: 131,054,635 and 131,736,542 raw); one 0.2 SPYx curve buy completed the curve ("… The curve completed with this buy; the unused input stayed in your wallet."); the crank button ran the 5-step graduation crank; the page turned into the graduated view (Graduated badge, `Price $… · Floor $… · Max loss if you buy now: −…%`) and a Max redemption paid out with "Received … SPYx. The exit fee of … SPYx stayed in the vault." Afterwards: `phase` graduated, `redeemable` true, `crankDue` [], vault 1,089,548 raw, supply 313,392,654,522,230, floor Q64 61,440,109,317 → **64,132,368,203** (the exit fee raised it) |
| Mainnet | the flow's 16 app signatures plus the surfnet's local signature list looked up with read-only `getSignatureStatuses` on mainnet: **0 of 27 found** |

Final JSON (excerpt) for "E2E Floor 3bdpk2": `chainPhase` redeemable, `vaultRaw` 57,165,071, `supplyRaw`
853,145,198,037,703, `crankDue` [], buy label "Price $0.00000171 · Floor $0.000000511 · Max loss if you
buy now: −70.1%", `priceSource` jupiter. For "UI $50 bf3kl": "Price $0.0000000801 · Floor $0.0000000265 ·
Max loss if you buy now: −66.9%". The surfnet and the app server were stopped afterwards.

`next dev` generates `AGENTS.md` and
`CLAUDE.md` in `app/`; `agentRules: false` in `next.config.ts` turns that off and both names are gitignored.

## Screenshots

The four images in [`docs/screenshots/`](../docs/screenshots), shown in the root README, come from this app
running against a **local Surfpool mainnet fork** — never from mock data, never from mainnet. Regenerate
them (about three minutes, Playwright's Chromium downloads into the user cache on the first run):

```bash
bash app/scripts/seed-fork.sh     # from the repo root: fork on RPC 28899, deploy, four launches; SKIP_UP=1 reuses a running fork
cd app
export NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=http://127.0.0.1:28899 \
       STOCKFLOOR_RPC_URL=http://127.0.0.1:28899 STOCKFLOOR_NEXT_DIST_DIR=.next-screens
pnpm build:local
pnpm exec next start -p 3288 -H 127.0.0.1 &
pnpm exec playwright install chromium   # first run only
pnpm screenshots                        # writes ../docs/screenshots/*.png
RPC_PORT=28899 bash ../scripts/surfpool/stop.sh
```

`scripts/screenshots.ts` reads `/api/launches` and shoots the graduated launch with the largest vault
(override with `STOCKFLOOR_SCREENSHOT_MINT`; `STOCKFLOOR_SCREENSHOT_APP_URL` and
`STOCKFLOOR_SCREENSHOT_DIR` move the source and the target). It types a buy and a redemption so both panels
show exact on-chain quotes, and it **fails instead of saving** when a skeleton or an error state is still on
the page, when any value is still a "—" placeholder, when the buy button is not the exact
`Price $X · Floor $Y · Max loss if you buy now: −Z%` sentence, when a jump to `#launches` leaves the heading
under the sticky header (it uses the anchor's own `scroll-margin-top`, so a wrong offset in the app fails the
run rather than being papered over), or when the header does not say "Local fork". That last check is what
keeps the README's captions true; pointing the script at a hosted mainnet build means dropping it and
rewriting those captions.
