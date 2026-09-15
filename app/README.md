# StockFloor web app

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind CSS 4 + `@solana/wallet-adapter-react`.

## Run

```bash
pnpm --filter @stockfloor/app dev        # http://localhost:3000
pnpm --filter @stockfloor/app test       # vitest (jsdom)
pnpm --filter @stockfloor/app typecheck
pnpm --filter @stockfloor/app build
```

Environment (all optional, public):

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | `http://127.0.0.1:8899` | RPC for the wallet adapter connection (local Surfpool mainnet fork) |
| `NEXT_PUBLIC_DATA_SOURCE` | `mock` | `mock` or `chain`; `chain` falls back to mock until M4 lands |

Never put a keyed RPC URL in a committed file.

## Pages

- `/` launches list: phase, progress to graduation, price, floor, max loss, quote asset.
- `/create` launch form with a live `previewLaunch` preview (start price, graduation price, floor at graduation). Submit calls `LaunchActions.createLaunch`, a stub that validates the params with `buildDbcConfigParams` and sends nothing.
- `/t/[mint]` token page: phase stepper; presale progress and curve trade panel; after graduation the floor meter, the honest buy label (`Price $X · Floor $Y · Max loss if you buy now: −Z%`), the redeem panel (`redeemQuote`, 2% exit fee) and vault stats; disclosures with the non-US attestation on every token page.

## Layout

```
src/
  app/                      routes, root layout, globals.css (theme tokens)
  components/
    layout/                 header, footer, wallet button (wallet-standard auto-detection)
    launch/                 launch list and cards
    create/                 create form, preview panel, curve sketch
    token/                  token view, floor meter, trade/buy/redeem panels, vault stats, disclosures
    ui/                     small primitives (avatar, badge, progress bar, amount field)
  lib/
    format.ts               USD / percent / token amount formatting (bigint-safe, rounds down)
    metrics.ts              floor, progress, buy label, redeem preview (uses @stockfloor/sdk math)
    estimates.ts            price-based trade estimates and redeem validation
    launchForm.ts           create form validation
    attestation.tsx         non-US self-attestation (localStorage, per browser)
    config.ts               public env config and fixed launch terms
    data/
      types.ts              LaunchDataSource (read) and LaunchActions (write) interfaces
      mock.ts               MockDataSource: four launches in presale, graduating and graduated phases
      actions.ts            StubLaunchActions: validation only, no transactions
      context.tsx           React Query hooks over the data source
```

## M4 integration points

- Implement `ChainDataSource` (`LaunchDataSource`) reading `Launch` accounts, DBC pools, DAMM v2 pools, the vault balance and mint supply; switch in `lib/data/index.ts`.
- Replace `StubLaunchActions` with real transactions: DBC config + pool + `create_launch` + `register_pool`; curve buy/sell (with a Jupiter USDC/SOL → quote swap first); Jupiter swap after graduation; `redeem`.
- Launch metadata: `LaunchInput.uri` currently carries the image URL; it needs a metadata JSON URI.
- Quote prices: Jupiter Price V3 (`usdPrice` per UI token) and the on-chain ScaledUiAmount multiplier.
