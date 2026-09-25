# Meteora config marketplace review

Reviewed 2026-09-25: all 24 recipes on https://www.meteora.fyi/marketplace were extracted by 4 agents, analyzed through
three lenses (curve design, fees vs our program, creator and holder economics) and merged by a synthesizer.
This is the synthesizer's memo, unedited except for this header. The deadline notes in it are out of date: the user
asked to set the deadline aside and keep designing.

# StockFloor: what the meteora.fyi config marketplace means for our presets

Sources: three analyst reports (curve, fees, creator) and a check of the repo. I checked these against the code: `external.rs:147-244`, `constants.rs:27-43`, `harvest_dbc_quote.rs:109-131`, `harvest_lp_fees.rs:16-40` and `floor.rs:34-58`. The ratios below come from v/(√r+1−m), recomputed in a script. v is the vault's share of the raise T. m is the share of T that leaves before pairing into DAMM v2.

**Deadline flag:** today is 2026-09-25, which CLAUDE.md gives as the hackathon hard deadline. That changes what we should build today. See §3 and Q1.

---

## 1. What the marketplace teaches

1. **None of the 22 configs can be registered as published.**
   - The curated recipes use `migrationFee.feePercentage = 0`. Live configs go no higher than 10% (revshare-calm).
   - Our validator requires 30–99 (`constants.rs:27-28`, `external.rs:170-174`).
   - No pad in the set funds anything with a graduation skim larger than 10%. A 50–60% skim into a redeemable vault is a real differentiator.
2. **Creators get paid through locked LP and a trading-fee share, not upfront.**
   - Post-graduation creator income ranges from 0.24% of volume (Ember with GMEx) to 2.4% (revshare pads at a 6% fee).
   - The only upfront payment built into DBC in the set is revshare-calm: 50% of a 10% migration fee, so 5% of the raise.
   - Balance's 25% founder share is 5× that, but it is still below Star.fun's roughly 50%.
3. **Gentle curves sell.** The same fee claimer runs a 1.69× config with 180 pools and a 32.65× config with 105 pools. That is about 1.7×, which is weak but real evidence. Every other live curve is steep: 8.75× (Ember), 9× (Ethics), 10× (Trends), 13.33× (otc), 15.33× (purps).
4. **Curve fees:**
   - Live pads charge 1.5–6%. Recipes charge 0.5–5%.
   - The DBC minimum is 25 bps (`MIN_FEE_NUMERATOR = 2_500_000`), which is exactly Balance's 0.25%. It cannot go lower.
   - One recipe page wrongly implies 0.25% is below the minimum.
5. **Migrated pool fees:** 1% (Ember), 1.2% (purps), 1.5% (Ethics), 2% (otc, FixedBps200), 6% (revshare).
   - Balance's 1.5% is normal for the market.
   - Non-preset values use `migration_fee_option = 6` (Customizable). Ember, Ethics, purps and revshare all do this.
   - The recipe pages describe `FixedBps100` as a "1% migration-fee slice out of the quote". That is wrong: it is the fee tier of the migrated pool.
6. **DBC configs quoted in stock tokens already exist.** Ember runs a GMEx config (Token-2022 quote, 8 decimals) with a 412.8 GMEx graduation (about $10K), and 301 configs use that shape. We should pitch the floor vault and redeem, not "first stock-quoted DBC".
7. **One config per quote mint is standard.** Ember uses 835 and 301 configs across its two shapes, and otc-locked has 37 of 37 identical. This supports our plan of one config per xStock from each preset.
8. **Curve shape barely moves the floor at r ≤ 1.3.** The difference is at most about 1 point of floor ÷ graduation price.
   - Symmetric liquidity weights reproduce k = √r exactly.
   - Equal weights `[1,1,1,1]` give the same curve as a single segment. The recipes' "straight climb" is a sketch, not the real price path.
   - The floor is set by v and m. Shape only decides who gets the edge.

## 2. Recommended presets

Common to all three presets:
- Base token: SPL, dynamic supply.
- Metadata: immutable. Already enforced at `ext:237`.
- Curve fees and migrated pool fees are collected in quote. Already enforced.
- Quote: SPYx.
- `buildCurve` with a single segment. `migrationQuoteThreshold` = the raise, e.g. $10K in SPYx.
- LP: 100% partner permanently locked to our claimer PDA. No DBC LP vesting or locked vesting.
- `enableFirstSwapWithMinFee = false`.
- `percentageSupplyOnMigration` = (1−m)/(√r+1−m).

Floor ÷ price paid runs from floor ÷ graduation price for the last buyer up to (floor ÷ graduation price) × r for the first buyer.

### Preset A: "Floor-first" (current tested config; ships today)

| Parameter | Value |
|---|---|
| Base fee | FeeSchedulerLinear, 100→100 bps (1% flat), 0 periods |
| `creator_trading_fee_percentage` | 30 |
| Migration fee | 50%, creator migration fee 0 |
| Migrated pool | option 6, 100 bps (per DECISIONS.md:30) |
| Partner-flow split in our program | 100% to the vault: migration fee, LP quote fees, curve fees and surplus. LP base fees are burned. |

| Variant | `percentageSupplyOnMigration` | Floor ÷ graduation price | Floor ÷ average buyer price | Floor ÷ first buyer price |
|---|---|---|---|---|
| flat, r = 1.01 | 33.2 | 33.2% | 33.4% | 33.6% |
| gentle, r = 1.2 | 31.3 | 31.3% | 34.3% | 37.6% |

- **For:** the hackathon submission and holders who put protection first. The creator earns only the 30% share of the curve fee, so this preset is weak for creators.

### Preset B: "Balance / Fair raise" (flat)

| Parameter | Value |
|---|---|
| Curve | r = 1.01, `percentageSupplyOnMigration` 28.5 |
| Base fee | 25→25 bps flat, 0 periods |
| `creator_trading_fee_percentage` | **0** (see note below) |
| Migration fee | 60%, creator migration fee 0 |
| Migrated pool | option 6, 150 bps, migrated dynamic fee off |

**Why the creator share is 0 here.** The analysts implicitly assumed 30. At 0.25%, a 30% share is worth about $6 per $10K of volume. At 0 the whole partner share goes to the vault, which matters once an anti-snipe window is added. With a creator share of 30%, the creator analyst's "+4% floor" from anti-snipe becomes +2.8%.

**Partner-flow split in our program:**
- **Migration fee (60% of T):** vault 53.33% (32% of T), founder escrow 41.67% (25% of T), platform 5% (3% of T). Rounding dust goes to the vault.
- **LP quote fees:** founder or creator 45%, vault 37.5%, platform 17.5%. That is 0.54%, 0.45% and 0.21% of post-graduation volume. The Meteora 20% cut is taken first.
- **Curve fees and surplus:** 100% to the vault.

**Outcome:**

| Case | Floor ÷ graduation price | Floor ÷ average buyer price |
|---|---|---|
| Founder paid | 22.8% | 22.9% |
| Founder fully forfeits (v = 0.57) | 40.6% | 40.8% |

- The pool gets $4K of quote. Holder tokens equal 2.5× the pool's token reserve.
- Selling 10% of holder tokens moves the price about −36%. Holders must dump about 44% of their tokens to reach the floor.
- **For:** a founder who wants a real upfront raise ($2,500, vested) and 0.54% of volume for life, and buyers who want one fair price.

### Preset C: "Balance / Small early edge" (gentle)

- Same as B, except r = 1.2 and `percentageSupplyOnMigration` 26.7.
- **Outcome:**
  - Floor ÷ graduation price: 21.4%.
  - Floor ÷ average buyer price: 23.4%.
  - Floor ÷ first buyer price: 25.7%.
  - Gain at graduation: first buyer +20%, average about +9.5%, last buyer 0.
  - Founder forfeit: floor ÷ graduation price 38.1%.
  - A 10% dump moves the price about −38%.
- **Disagreement:** the curve analyst proposed r = 1.25. I pick **r = 1.2**:
  - The preset already exists and is tested.
  - The difference in floor ÷ graduation price is only 0.3 points.
  - The curve analyst's own table shows the share of tokens at +10% or more at listing, which is the dump overhang, rising with r.
- **For:** communities that want a small, provable reward for early buyers.

**The core trade-off.** Balance lowers the floor from 33% to about 23% of the listing price, because 28% of the raise leaves the system (founder plus platform) and 10 more points go to the pool. Compare a config-only variant with a 60% migration fee sent entirely to the vault (v = m = 0.6). It gives a 42.7% floor with no program change, but it pays the founder and the platform nothing.

## 3. Program changes needed for each preset

**Preset A:** no functional change. Recommended hardening, small and useful for every preset:
- **(a)** Require `migration_fee_option == 6` and a migrated pool fee in 25..=200 bps. Require the migrated dynamic fee to be off.
  - Verified: there is no such check in `external.rs`, where grep finds no `migration_fee_option` or `migrated_pool_fee`.
  - Today a config with a 10% migrated fee would pass.
- **(b)** Require `enable_first_swap_with_min_fee == 0`.
  - Verified absent in `external.rs`.
  - The bypass behaviour is cited from DBC `process_swap.rs:214-221` and is **unverified** by me.
  - The field name in our vendored `PoolConfig` is **unverified**.

**Preset B and C.** All of these are in addition to (a) and (b).
1. **`Launch` v3.**
   - Bump `LAUNCH_VERSION` (verified at `constants.rs:43`, currently 2).
   - New fields: `platform_bps`, `founder_bps`, the LP split bps, `founder_total`, `founder_claimed`, `stream_start`, `period_secs`, `n_periods`, `last_founder_claim`.
   - Cap `platform_bps` and `founder_bps` at creation.
   - Add a platform treasury constant.
2. **`harvest_migration_fee` split.** Today it sends everything to the vault (verified at `harvest_dbc_quote.rs:109-131`).
   - Withdraw into an escrow ATA owned by a new PDA `["founder_escrow", config]`. It must be separate from the vault authority (`constants.rs:15-19`).
   - Measure the delta. Send the platform share to the treasury and the floor share to the vault, and keep the founder share in escrow.
   - Move the nonzero check at `ext:181-187` so it applies to the post-split floor share.
3. **New `claim_founder`**, signed by `launch.creator`: vested = total × min(elapsed/period, n)/n, minus what was already claimed.
4. **New `forfeit_founder`**, permissionless: after K missed periods, the unvested remainder moves escrow → vault.
   - The floor only rises, so the redeem invariant holds. Redeem reads the vault and supply only (verified at `floor.rs:34-58`).
   - The escrow must never be the vault account.
5. **`harvest_lp_fees` split.** Today all quote goes to the vault and base is burned (verified at `harvest_lp_fees.rs:16-40`). Change it to 45 / 37.5 / 17.5.
   - Route the creator's 45% to escrow, or directly to the creator. Paying it directly makes it non-forfeitable.
6. **Unchanged:** `harvest_curve_fees` and `harvest_surplus`.
7. **Tests:**
   - Split math and dust.
   - Vesting at 0, at n and after n.
   - Forfeit.
   - A fork run of the C1 flow with a 60% migration fee and a 150 bps migrated pool.
8. **Effort:** one new PDA, two instructions, a state migration and a re-review. That is not safe to finish, test and review on deadline day.

**Unverified assumptions (check in the SDK or a fork test):**
- `percentageSupplyOnMigration` is net of the migration fee. The on-chain rounding comment at `ext:175-180` is consistent with m = pct/100.
- The DAMM v2 protocol cut on the migrated pool is 20%. It is cited from vendor `damm-v2/constants.rs:146` and not checked on the actual migrated pool config.
- The SDK spaces segments geometrically in sqrt price. This only matters for multi-segment curves.

**Where the analysts were wrong:**
- **Scheduler periods.** The creator analyst said the program "must allow a scheduler with periods" for anti-snipe. That is wrong. `ext:225-230` checks only mode ≤ exponential and cliff ≤ 20% (`MAX_CURVE_FEE_NUMERATOR = 200_000_000`). Anti-snipe works with the config alone today.
- **Burning base LP fees.** The creator analyst listed "burn base tokens" as an idea. `harvest_lp_fees` already does it, and migrated collect mode is already forced to quote.
- **Multi-segment floor.** Several recipe notes said "the program's floor assumes a single segment". That is wrong: the program is shape-agnostic because floor = vault/supply. Only the SDK presets and the UI formula would need generalizing.

## 4. Ideas to adopt later, and ideas to reject

**Adopt later:**
- **Anti-snipe window.**
  - Settings: FeeSchedulerExponential 2000→25 bps, 60 periods, 120 s, dynamic fee off.
  - It passes validation today. It needs hardening (b) so the creator's bundled first swap cannot skip it. It also needs `creator_trading_fee_percentage = 0` so the proceeds reach the vault.
  - The UI must drop the "~0.5% exit" promise during the window.
- **Back-loaded liquidity weights `[1,2,4]`, 1.25×.**
  - Floor ÷ graduation price +0.5 points. Tokens at +10% or more at listing fall from 59% to 36%, per the curve analyst's script.
  - The edge concentrates in the first ~1/7 of the raise, so it needs anti-snipe.
  - The threshold is derived from market cap, not set.
  - The only on-chain cost is tests. The UI formula has to be generalized.
- **Hybrid founder pay:** founder 15% of the raise plus 45% creator-permanently-locked LP.
  - Floor = 0.42/1.405 = 29.9% for flat, versus 22.8% in B.
  - It needs `ext:188-194` relaxed. The creator's LP income can then no longer be clawed back.
  - Keep it as the fallback to program change 5.
- **RateLimiter "whale toll"** (base-fee mode 2) with our share to the vault. Needs `ext:225` relaxed.
- **Two presets per quote mint, cloned per xStock,** as the pads above do.

**Reject:**
- **Withdrawable creator LP** (creator-share's 10%): it drains a pool that is already only $4K.
- **DBC team token vesting** (team-vest's 15%): it adds redeemable supply against the same vault. A 10% vest cuts the floor by 9.1%; 15% cuts it by 13%.
- **DBC's own creator migration fee:** it pays the founder in one lump at graduation, with no claw-back. It also rounds 25/60 up to 42%, which pays 25.2%. Keep `ext:167`.
- **Steep curves (4–33×)** and front-loaded or tiered shapes (long-tail, finish-line, staircase, twin-hump):
  - The last buyer's floor falls to 5–15% of cost at native multiples.
  - Jumps read as unfair: 37–39% of the raise pays within ±5% of the median price, against 88% for shelves.
- **Dynamic or volatility fee:** it breaks "same price for everyone", and the program already forbids it.
- **Token-2022 base:** redeem and burn assume SPL.
- **Moving the floor's 30% post-graduation share to the creator or platform:** vault growth is already slow. Doubling a $3.2K vault needs about $711K of volume at 0.45%.
- **Raising the creator curve-fee cap above 30%:** it does not hurt the floor, but it is worthless at 0.25% fees.

## 5. Open questions for the user

1. **Deadline:** today is 2026-09-25. Do we submit with Preset A (tested) and present Balance (B and C) as the designed next version? The alternative is to attempt program v3 before closing. What is the exact closing time?
2. **Floor versus founder pay.** Is the drop from 33% to 23% of the listing price acceptable for a 25% vested founder share and a 3% platform cut? The alternatives are the hybrid (29.9%) or founder 20% (26.4%, per the creator analyst).
3. **Founder stream terms:**
   - Number of monthly periods n: not specified in Balance.
   - Forfeit trigger K: the analysts proposed 3 missed 30-day claims.
   - Note that forfeit only catches a founder who disappears. A founder who keeps claiming is never checked.
4. **Creator's 45% of post-graduation LP fees:** route it through escrow, so it can be clawed back, or pay it directly or natively? Direct or native payment is simpler and cannot be forfeited.
5. **Creator trading share:** 0 in Balance presets (my recommendation), or keep 30?
6. **Pool depth:** accept a $4K pool (40% of the raise), where a $500 sell moves the price −21%? Or raise the minimum raise, or the pool share?
7. **Anti-snipe:** enable it by default on Balance (and accept a fee window at the open), or leave it off?
8. **Platform treasury:** which address? A dedicated key under `keys/` for devnet or fork, and a mainnet one only after C2.

Numbers script: `/private/tmp/claude-501/-Users-rk-Projects-stockfloor/a96026aa-ad2e-4ab1-8817-66f7d23901d5/scratchpad/curves.py` (curve analyst). I rechecked the ratios above with an inline script.
