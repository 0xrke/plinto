# Monetization research: Meteora DBC launchpads and a revenue model for StockFloor

Researched 2026-09-24. Competitor list is the meteora.fyi DBC screener (13 pads) plus Solana benchmarks
(pump.fun, Bags, Believe, Jupiter Studio, Heaven, bonk.fun, Boop, Moonshot, Time.fun). Each profile was
researched by one agent from primary sources (sites, docs, APIs, decoded on-chain DBC configs) and then
fact-checked by a second, adversarial agent. Three agents designed models independently, a judge merged
them, and a critic reviewed the result. Numbers marked `~` or `U` are estimates or unverified.
The interactive calculator lives in the `StockFloor Fee Lab` artifact.

All "% of volume" figures are gross trade volume. On DBC, Meteora always takes 20% of every trading fee;
the remaining 80% is split creator/partner by `creator_trading_fee_percentage`. DAMM v2 also takes 20% of
pool fees before LPs are paid.

## 1. Key findings

1. **Nobody offers a redeemable floor.** Holder value everywhere else is either nothing (One Only, Trends,
   Scribe, Stonk), a permanently locked LP, or keeper-run, custodial payouts (Ember, OTC Desks, Purps,
   RevShare, Bags) that operators can change or stop. OTC's and Ember's own terms/status pages admit
   delayed or failed payouts. The burn-to-redeem SPYx vault is our only real moat.
2. **A stock quote asset is not a moat.** Ember (1,298 pair tokens incl. xStocks), RevShare (22 xStocks),
   Scribe, One Only, ClawPump, Ethics and StonkOptions already support xStock quotes. Almost nobody uses
   them: Ember has 42 SPYx coins ($22K volume); Scribe and One Only have SPYx configs with **0** pools.
3. **The market norm is a 1–2% trade fee.** On the curve, platforms keep ~0.2–1% of volume and creators get
   0–1.6%. After graduation platforms keep ~0.05–0.8%.
4. **Post-graduation volume is where the money is.** At Ember, DAMM v2 carries ~89% of lifetime volume
   ($112M of $126M). A model that earns only on the curve leaves most revenue on the table.
5. **Graduation rates are low:** Ember ~3%, RevShare 1/479, Stonk 2/78, One Only 1/33, ClawPump 0/35.
   Any forecast must be built on per-launch economics, not on "every token graduates".
6. **Creator trend is down or redirected.** pump.fun added Cashback Coins (creator fee to traders),
   BONK Classic pays creators 0%, Scribe/OTC/ClawPump (on-chain) pay creators 0%. Pads that pay creators well
   (Ethics 0.84%, Trends 1.6%) charge 1.5–4% total.
7. **Launch fees are rare** (RevShare 0.01–0.2 SOL, ClawPump 0.012 SOL, Bags 0.02 ETH on Robinhood Chain).
   A tiny SOL pool-creation fee works as anti-spam, not as revenue.
8. **Today StockFloor earns $0.** Every partner flow goes to the vault. The creator gets 0.24% of curve
   volume (30% × 80% × 1%), which is below pump.fun (0.30%) and One Only (0.5%), and nothing after graduation.

## 2. Revenue knobs available on DBC 0.2.1 + DAMM v2 0.2.4

| Knob | Range | Who gets it |
|---|---|---|
| Curve trading fee | 0.25% end fee … 99% cliff; flat, linear or exponential scheduler; optional dynamic fee | Meteora 20%; rest split by `creator_trading_fee_percentage` (0–100) |
| Referral (host) fee | 20% of Meteora's cut = 4% of the gross fee, on DBC and DAMM v2 swaps that pass a referral account | Whoever builds the swap (our UI can collect it at no cost to users) |
| Pool creation fee | 0 or 0.001–100 SOL | Partner 90%, Meteora 10% |
| Migration fee | 0–99% of `migration_quote_threshold`, split by `creator_migration_fee_percentage` | Partner / creator, withdrawn once each |
| Surplus | Quote above the threshold at completion | Meteora 20%, rest split like trading fees |
| Leftover | Fixed-supply configs only | `leftover_receiver` |
| Migrated LP | Six buckets (partner/creator × unlocked/permanent-locked/vesting); ≥10% locked on day 1 | Position NFT owners claim fees |
| DAMM v2 pool fee | Fixed 0.25/0.3/1/2/4/6%, or 0.1–10% customizable (market-cap scheduler, dynamic fee, quote-only / both / compounding collection) | Meteora 20%; LPs 80% pro rata |
| Creator token allocation | `locked_vesting` via Jupiter Lock | Creator |

Fixed costs to Meteora: 20% of every DBC and DAMM fee, 0.2% of migrated liquidity, 20% of surplus.
Both Meteora programs are upgradeable, so any of these rates can change.

## 3. Competitors (meteora.fyi screener)

Rates are on-chain verified unless marked. "Plat." and "Creator" are the share of curve volume.

| Pad | Hook | Curve fee | Plat. | Creator | Migration fee → platform | After graduation | Holder value | Traction |
|---|---|---|---|---|---|---|---|---|
| **Ember Curve** | "Tax modules" routed by keeper; 1,298 pair tokens | 1 / 2 (default) / 3% | 0.96% (Keep) … 0.08% (Stock Basket) at 2% | 0.64% Keep; up to ~1.04% via holder mode | 10% of T (recent configs) | DAMM 1%, LP locked 60/40 partner/creator | Keeper payouts: rewards, burns, lotto, stock basket. No floor | 3,157 coins, 98 grad., ~$1.5M fees in ~2 weeks, EMBER $16M |
| **Perpspad** | Fees fund perp positions for holders | 4%→2.5% scheduler + dynamic | ≥0.30% (15% of claims) | ≥0.30% (15%) | 0 | DAMM 1%, LP 50/50 in keeper wallet; 10% of perp take-profit | Perps, burns, dividends (70% of claims) | 269 coins, ~$88K fees / 30d |
| **Purps** | Creator-set fee leg; perps and xStock airdrops | 1% platform + 0.5–9.8% creator leg | 0.8% | 0.8% leg by default (half to holders) | 2% of T | ~0.16% of DAMM volume; 25% of perp profits | Discretionary custodial buybacks/airdrops | ~$42.5K platform revenue |
| **OTC Desks** | Fees converted to stock payouts for holders | 2% | ~0.08% (5% of claims) | 0 | 0 | LP 100% partner (0 graduations) | 67.5% of fees → stock payouts; OTC buyback | 25K coins (mostly pump.fun); Meteora 97 coins, 0 grad. |
| **RevShare** | Holder-reward tax tokens, multichain | 1 / 3 / 6 / 10% | 0.4% at 1% tier | 0.4% to a distribution pot (dev 30% of it by default) | 5% of 60 SOL (~3 SOL) | LP 50/50 locked; +9% distribution fee | Pro-rata distributions | 479 coins, 1 grad. Already lists 22 xStock quotes |
| **Ethics** | Multi-venue, creator-first | 1.5% + dynamic | 0.36% | 0.84% | 0 | DAMM 1.5%, LP 30/70 partner/creator | Modes for holder airdrops | 98 launches, 5 stock-quoted |
| **ClawPump** | AI-agent launchpad | 1.25% flat | 1.0% on-chain | 0 on-chain (off-chain split U) | 0 | LP 100% partner | CLAW buyback (U on DBC) | 35 DBC pools, 0 grad.; also API tiers $0/$49/$199 |
| **StonkOptions** | Fees go to employees of the paired company | 50%→1.26% in 90 s + dynamic | ~0.20% | ~0.10% | 0 | DAMM 1.25%, same split | None (terms deny any) | 78 coins, 2 grad., ~$6.8K platform revenue |
| **LFOwn** | Memes quoted in MetaDAO ownership coins | 2.5% + dynamic | 1.0% (DAO treasury) | 0.25% default (up to 1%) | 0 | DAMM 1%, LP 50/50 | 0.75% of volume to holders by default | 131 coins, 5 grad., $4.7K fees |
| **Trends** | iOS social app, creator coins | 4% | 1.6% | 1.6% | 0 | DAMM 4%, LP 50/50 | None | 92 pools, 4 grad.; VIP $14.99/mo |
| **One Only** | One ticker, one token | 1.25% | 0.5% | 0.5% | 0 | DAMM 1.25%, LP 50/50 | None | 33 pools, 1 grad. (its own token); 0 on SPYx configs |
| **Scribe** | Inscriptions; SCRIBE buyback | 1% | 0.8% (80% → SCRIBE buyback) | 0 | 5% of T | LP 100% partner (~0.8% of DAMM vol.) | None for launched coins | 109 coins, 1 grad. |
| **Star.fun** | Startup raises, futarchy treasury | 50%→1% in 90 s + dynamic | 0.8% | 0 | 50% of T (≈ founder raise, U) | Docs: 0.1% Star / 0.7% founder (U) | DAO governance; 20% team allocation | $1.3–1.6M raised, 7 tokens |

Benchmarks outside the screener:

| Platform | Curve fee | Plat. | Creator | After graduation |
|---|---|---|---|---|
| pump.fun | 1.25% | 0.95% | 0.30% | PumpSwap tiered: 0.93% protocol below 420 SOL mcap, ~0.05% above; 50% of net fees buy back PUMP |
| Bags (DBC) | 2% | 1% | 1% (creator pool) | 0.75% / 0.75% + 0.5% compounded into LP; xStock launches go straight to single-sided DAMM v2 |
| Believe (DBC) | 2% | 0.9% | 1% (+0.1% scouts) | Class action and founder arrest in 2026 |
| Jupiter Studio (DBC) | 1% | ~0.5% | ~0.5% | Same split; up to 80% of supply can vest to the creator |
| Heaven | 1% → 0.25–0.5% | 100% to LIGHT buyback | 1% creator coins, 0.1% community | — |
| bonk.fun | LaunchLab | 51% of fees buy BONK | BONK Classic 0% | — |

## 4. Patterns worth copying (and ones to avoid)

Copy:
- **Earn after graduation**, not only on the curve (Ember, Ethics, Scribe, Bags).
- **Referral/host fee** in our own UI: free money from Meteora's cut, no cost to users.
- **Tiered graduation thresholds** (Star $10K/$25K/$50K, LFOwn Starter/Standard/Serious).
- **Anti-snipe fee window** as an option (Star, Stonk: 50% decaying to base over 90 s).
- **Creator-controlled split** within bounds, e.g. "donate my share to the floor" (LFOwn, Purps, Perpspad).
- **Public revenue dashboard** (One Only, Purps). Ours can show the floor growing.
- **Tiny SOL pool-creation fee** against spam (partner keeps 90%).

Avoid:
- **Off-chain keeper promises.** Every custodial-payout pad has outages or operator-mutable splits (OTC changed its split ~5 times). Our splits must be on-chain and frozen per token.
- **Changing splits after launch** (pump.fun and Perpspad backlash).
- **High total fees** (Trends 4%, LFOwn 2.5%). Keep the total at or under 1.5%.
- **Team token allocations.** They drain the vault's per-token backing and contradict "no free tokens".

## 5. Proposed models

All four run on one code path. Creator-side flows use native DBC fields. The platform cut needs one
program change: a `PlatformConfig` PDA (treasury + hard caps) and per-launch split bps frozen in `Launch`,
applied inside the three existing partner harvest paths (curve fees, migration fee, LP fees) **before**
the deposit into the vault. Nothing ever leaves the vault except `redeem`, so the floor invariant holds.
Surplus and leftover go to the vault in every model. Exit fee stays 100% in the vault in every model.

Shares of the curve fee are shares of the non-Meteora 80%. Shares of LP fees are shares of the LP's 80%.

| | Pure Floor | Balanced Floor (recommended) | Creator 70 | Builder Raise |
|---|---|---|---|---|
| For | Hackathon build, communities, "0% house" promo | Default for most launches | Creators who pick by payout | Projects raising $25–100K (Star's segment) |
| Curve fee | 1% | 1.5% | 1.5% | 1% |
| Curve split creator / platform / vault | 30 / 0 / 70 | 35 / 15 / 50 | 70 / 10 / 20 | 40 / 15 / 45 |
| → % of volume creator / platform / vault | 0.24 / 0 / 0.56 | 0.42 / 0.18 / 0.60 | 0.84 / 0.12 / 0.24 | 0.32 / 0.12 / 0.36 |
| Migration fee (of T) | 50% | 50% | 50% | 60% |
| Migration split creator / platform / vault | 0 / 0 / 100 | 10 / 6 / 84 | 20 / 8 / 72 | 40 / 5 / 55 |
| → % of T creator / platform / vault | 0 / 0 / 50 | 5 / 3 / 42 | 10 / 4 / 36 | 24 / 3 / 33 |
| DAMM v2 fee | 1% | 1% | 1.5% | 1% |
| LP split creator / platform / vault | 0 / 0 / 100 | 20 / 15 / 65 | 60 / 10 / 30 | 40 / 15 / 45 |
| Referral (4% of gross fee, UI swaps) | platform | platform | platform | platform |
| **Floor ÷ graduation price** (gentle r = 1.2, curve volume = 2T) | **32%** | **27%** | **23%** | **23%** |
| Max loss for a buyer at graduation price, after 2% exit fee | −69% | −73% | −78% | −78% |
| Program change | none | platform split | platform split | platform split (+ streamed allowance later) |

Floor ÷ graduation price is `v / (√r + 1 − m)`, where `m` is the migration fee share of T and `v` is
everything the vault holds at graduation divided by T (see `docs/architecture.md`, "Floor at graduation").
The often-quoted "X% of the raise backs the floor" is **not** the buyer's protection. The table above is.

Per graduated token at T = $25K, curve volume $50K and DAMM volume $500K over 90 days (optimistic;
median launches never graduate):

| | Platform | Creator | Vault |
|---|---|---|---|
| Pure Floor | ~$0.1K (referral only) | ~$0.1K | ~$16.8K |
| Balanced Floor | ~$1.6K | ~$2.3K | ~$13.4K |
| Creator 70 | ~$1.9K | ~$6.5K | ~$10.9K |
| Builder Raise (T = $50K) | ~$3.1K | ~$15.5K | ~$20.5K |

### Why Balanced is the default
- It answers the judges' "is this a real business" question: the platform earns on every flow, mostly after graduation.
- Platform take (0.18% of curve volume, 3% of T, 0.12% of DAMM volume) is below every major competitor except OTC's thin cut.
- Creators earn 0.42% on the curve (vs 0.24% today and 0.30% at pump.fun), 5% of the raise and LP fees for life, all on-chain.
- The vault gets a slightly larger share of each curve trade than today (0.60% vs 0.56% of volume).
- **Honest trade-off:** overall, the vault gets less than in Pure Floor (floor 27% vs 32% of graduation price;
  ~20% less vault in the example above). The pitch must say this plainly, and the UI must show floor ÷ price per token.

### Corrections the critic made to the judge's draft
- A creator share of the migration fee is **rare, not unique**: RevShare's 20 SOL configs pay 5% of T to the
  creator, some Scribe configs split 50/50, and Star's whole 50% is effectively the founder's raise.
- Creator 70 is not second only to Trends: Purps creators can set up to ~7.8% of volume, and Ember's holder mode
  lets a creator keep up to ~1.04%.
- pump.fun's post-graduation protocol take is ~0.05% only above 420 SOL market cap; below that it is 0.93%.
- With quote-only DAMM collection there are no base-side LP fees to burn.
- Use DAMM option 6 at a fixed fee (deterministic) rather than option 2 if that config has a dynamic fee.
- A creator self-buying to graduation loses only a few percent (Meteora fees, 0.2% migration fee, platform cut,
  exit fee, slippage), so the creator migration cut is not self-policing. Add a dev-buy cap.
- The floor is fixed in SPYx units. In USD it moves with the S&P 500 and carries xStock issuer risk (pause,
  freeze, permanent delegate). Show this next to every floor figure.

## 6. Rollout

1. **Hackathon build (by 2026-09-25):** ship Pure Floor, the tested config, and add the referral account on
   UI swaps if time allows (web-only change). Present Balanced as the product default in the pitch and the
   calculator.
2. **After C1:** implement `PlatformConfig` + frozen per-launch split bps + split in the three harvest paths,
   with tests (each split, rounding in the vault's favor, caps) and an independent review.
3. **Later:** tiered thresholds ($10K / $25K / $50K), optional Launch Shield (anti-snipe), a creator slider
   "donate my share to the floor", a small anti-spam pool creation fee (~0.02 SOL), a streamed SPYx allowance
   for Builder Raise, and a public floor/revenue dashboard.

## 7. Open questions for the user
- Which model is the product default: Balanced (recommended) or Pure Floor with a later switch?
- Is a 1.5% trade fee acceptable, given pump.fun's 1.25%?
- Should the platform ever take a cut of the exit fee? All models say no.

## Sources
Verified profiles with full evidence (on-chain accounts, API endpoints, doc URLs) are in the workflow
output of run `wf_e1e51a1a-daf` (2026-09-24). Key primary sources: embercurve.fun `/api/solana/*`,
perpspad.fun/paper, purps.lol Terms, otcdesks.cash API and Terms, app.revshare.ltd/docs, ethics.ltd,
clawpump.tech/docs, stonkoptions.xyz FAQ and `/api/capabilities`, letsfuckingown.fun and
github.com/sparkfun-labs/lfown, oneonly.lol, scribe.ong `/burns`, star-fun.gitbook.io, pump.fun help
center, docs.bags.fm, docs.meteora.ag, and the DBC 0.2.1 / DAMM v2 0.2.4 source.
