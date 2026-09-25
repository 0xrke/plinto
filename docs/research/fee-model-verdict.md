# Fee model verdict

2026-09-25. Three designers proposed 9 fee models, two reference models were added (current code and the model from
the founder chat), one evaluator simulated all 11 (`fee-eval.cjs`, based on the price-sim model), three judges scored
them (creator, holder, business lenses), a synthesizer ranked them and a critic checked the numbers. The synthesizer's
memo is below, followed by the critic's corrections, which take precedence where they conflict. Deadline notes are out
of date: the founder set the deadline aside. The founder has not chosen a model yet.

# StockFloor fee model: final verdict

*Synthesis of 11 candidates, the evaluator's metrics and three judges (creator, holder, business). All figures come from the evaluator (`fee-eval.cjs`, scenario sims at a $10K raise, $100 buyer) or are derived from them. Derived numbers are marked (est.).*

---

## 1. Recommended default: "Fair Share" (`fair-share`)

| Stage | Setting | Per $100 traded / share of raise |
|---|---|---|
| **Presale** | 1% fee, flat curve (end price 1.01x start), anti-snipe on (starts at up to 20%, decays to 1%) | Meteora 0.20 · creator 0.12 · platform 0.28 · floor 0.40 (held until graduation) |
| **Graduation** | Threshold $12K (~70 SOL) | Pool 35% ($4.2K) · floor vault 60% ($7.2K) · platform 5% ($600) · founder 0 |
| **Trading** | DAMM v2, 1% fee, LP permanently locked | Meteora 0.20 · creator 0.32 · platform 0.20 (+0.04 referral on trades routed through our UI) · floor 0.28 |
| **Exit (redeem)** | 2%, all of it stays in the vault, the same for every token | Bots hold the price near floor x 0.98/1.01 ≈ 0.97 x floor (est.) |

**Why, in plain words**
- It is the only candidate that all three judges rank in the upper half: creator 6.5, holder 7.5, business 8, total **22 of 30**, the highest.
- It follows every founder decision:
  - flat curve;
  - no founder share;
  - no free allocations;
  - the creator earns mainly after graduation (0.32 vs 0.12 in presale);
  - presale floor fees are held until graduation.
- **Buyers.** $100 bought at listing is guaranteed **$43.97** back (competitors: $0).
  - In every stress scenario the lowest value is **$43**, against $17-35 for an Ember-like token with no floor.
  - Trading cost is 1% one way, about 2% round trip.
- **Platform.** It earns recurring income: 5% of each raise, 0.20% of trading, and referral.
  - About **$14.3K a month** by month 12 (**$8.8K** at a 2% graduation rate).
  - Per graduated token over 12 months: $813 / $1,381 / $3,511 (low / medium / high volume).
- **Creator.** Earns 0.32 per $100 traded, as much as Ember and more than 7 of the 13 competitor pads.
  - Over 12 months: $239 / $1,081 / $4,236.
- **Honest pitch.** "Every trade grows the floor more than it pays us": floor 0.28 vs platform 0.20.
- **Security.** It keeps the 100% partner-locked LP check. The creator is paid through our on-chain split, not through a relaxed LP check.

**Program changes needed**
1. A three-way split of partner flows (curve fees, migration fee, LP quote fees) between the vault, a platform treasury and the creator, using fixed basis points stored in the config PDA.
2. `harvest_curve_fees` requires migration before paying the floor portion.
3. Validate the migrated pool fee (1%).
4. Reject a first swap at the minimum fee.

**Hackathon note (deadline today, 2026-09-25)**
- Do not ship an untested splitter on deadline day.
- **Demo and C1 run on `floor-max-zero-change`**, which needs no program change: guarantee $42.63, $6K pool, +36% move on a $1K buy.
- Present Fair Share as the commercial default in the pitch, stored as basis points in config.

---

## 2. Ranked top 4

### #1 Fair Share (`fair-share`): the default for everyone
- **Who it's for:** meme and community creators who sell trust. This is the core of "safe memes".
- **Numbers:** as in section 1.
- **Key metrics:**

| Metric | Value |
|---|---|
| Guarantee per $100 at listing | $43.97 |
| Floor growth, 12 months, medium volume | +12.6% |
| $1K buy / $1K sell price move | +52.7% / -34.8% |
| Creator per $100 traded | 0.32 (better than 7 of 13) |
| Platform per $100 traded | 0.20 (8 of 13 pads take more) |
| Revenue at month 12 (4% / 2% graduation rate) | $14,256 / $8,798 |

- **Strengths:**
  - highest guarantee of the commercial models;
  - the floor gets more than the platform;
  - no new LP security surface;
  - follows all founder rules.
- **Weaknesses:**
  - thin $4.2K pool, so the price is jumpy (flagged at +53%, against about +21% on a competitor's ~$10K pool);
  - a medium-sized build (recurring splitter);
  - the creator's headline 0.32 loses to Ethics (0.84) and One Only (0.50) on the first number creators compare.
- **Program changes:** see section 1.

### #2 Meme Balance (`meme-balanced`): if creator pay has to be louder
- **Who it's for:** the same audience as #1, tuned to recruit creators.
- **Numbers:**

| Stage | Setting | Split |
|---|---|---|
| Presale | 1% flat curve | Meteora 0.20 / creator 0.16 / platform 0.32 / floor 0.32 |
| Graduation | $12K | pool 40% ($4.8K) / floor 55% / platform 5% |
| Trading | 1% | Meteora 0.20 / creator 0.40 / platform 0.16 / floor 0.24 |
| Exit | 2% to vault | anti-snipe on |

- **Key metrics:**

| Metric | Value |
|---|---|
| Guarantee per $100 at listing | $38.81 |
| Floor growth, 12 months | +11.8% |
| $1K buy / $1K sell price move | +45.5% / -31.5% |
| Creator per $100 traded | 0.40 (better than 8 of 13; ties Purps) |
| Creator income, 12 months | $301 / $1,353 / $5,298 |
| Platform income per token, 12 months | $796 / $1,259 / $2,995 |
| Revenue at month 12 (4% / 2%) | $13,096 / $8,122 |

- **Strengths:**
  - better creator headline at the same 1% fee;
  - calmer pool than #1.
- **Weaknesses:**
  - about $5 less guarantee;
  - less value goes to the floor (creator plus platform take 0.56 per $100);
  - slightly less platform revenue;
  - no business gain over #1 (business judge).
- **Program changes:** the same splitter as #1. Pay the creator through our split, and do not relax the LP check.

### #3 Success Fee (`success-fee-low-trade`): the low-fee, "we earn only if you graduate" option
- **Who it's for:** holders who care about price, and a framing that appeals to buyers and regulators.
- **Numbers:**

| Stage | Setting | Split |
|---|---|---|
| Presale | 0.25% (the DBC minimum), flat curve | Meteora 0.05 / floor 0.20 |
| Graduation | $20K | pool 35% ($7K) / floor 57% / platform 8% ($1.6K) |
| Trading | 0.6% | Meteora 0.12 / creator 0.24 (native locked LP) / floor 0.24 / platform 0 |
| Exit | 2% to vault | anti-snipe on |

- **Key metrics:**

| Metric | Value |
|---|---|
| Guarantee per $100 at listing | $41.51 |
| Floor growth, 12 months | +6.9% |
| $1K buy / $1K sell price move | +30.4% / -23.4% (calmest of the meme models) |
| Creator income, 12 months | $158 / $789 / $3,156 |
| Platform income per token, 12 months | $1,608 / $1,633 / $1,728 |
| Revenue at month 12 (4% / 2%) | $13,096 / $6,564 |

- **Strengths:**
  - cheapest trading on the market;
  - deepest pool;
  - one visible platform cut, no recurring skim;
  - small build.
- **Weaknesses:**
  - 98% of revenue comes from graduations, so it halves at a 2% graduation rate;
  - earns nothing from the roughly 89% of volume that happens after graduation;
  - the $20K threshold lowers graduation odds;
  - relaxes the 100% partner-LP check;
  - weak creator pay (creator judge: 5).
- **Program changes:**
  1. Split the migration fee once: vault 57% / treasury 8%.
  2. Give the creator a 50% locked LP share by relaxing the LP check.
  3. Enforce a 0.6% migrated pool fee.
- **Best use:** as a framing idea to borrow ("5% only on success"), not as the full model.

### #4 Project Raise (`project-escrow`): a separate mode, not before v2
- **Who it's for:** teams and communities that need working capital. The only competitor here is Star.fun, which sends about 50% of the raise to the treasury.
- **Numbers:**

| Stage | Setting | Split |
|---|---|---|
| Presale | 1% flat curve | Meteora 0.20 / platform 0.32 / floor 0.48 / creator 0 |
| Graduation | $50K | pool 30% ($15K) / floor 50% / platform 5% / founder 15% ($7.5K) |
| Founder payout | escrow | $625 a month for 12 months; forfeits to the floor after 60 days of inactivity |
| Trading | 1.5% | Meteora 0.30 / creator 0.36 / platform 0.36 / floor 0.48 |
| Exit | 2.5% to vault | |

- **Key metrics:**

| Metric | Value |
|---|---|
| Guarantee per $100 at listing | $38.07, rising to about $49-50 if the team walks away |
| $1K buy / $1K sell price move | +13.6% / -12.1% (calmest of all candidates) |
| Creator income, 12 months | $7,737 / $8,683 / $12,234 |
| Revenue at month 12 | $48,453 at 4% (inflated, since $50K at 4% is unrealistic); $32,386 at 2% |

- **Strengths:**
  - real funding for the team;
  - when the team leaves, holders end up better off.
- **Weaknesses:**
  - 2.98% round-trip trading cost;
  - largest build (escrow PDA, forfeit instruction, per-mode parameters);
  - raising team money from the public invites securities-style scrutiny;
  - the founder leans toward no founder share.
- **Program changes:** everything in #1, plus the escrow PDA, a permissionless `forfeit_to_floor`, a per-mode exit fee and a mode flag.

---

## 3. Default (Fair Share) vs competitors, per $100 traded

### Presale (curve)

| Pad (total fee) | Platform | Creator | Floor / holders | Curve |
|---|---|---|---|---|
| **StockFloor (1%)** | **0.28** | **0.12** | **0.40 floor (on-chain, redeemable)** | **flat 1.01x** |
| pump.fun (1.25%) | 0.95 | 0.30 | 0 | steep |
| Ember (2%) | 0.96 | 0.64 | 0 | steep |
| Ethics (1.5%) | 0.36 | 0.84 | 0 | steep |
| Purps (2%) | 0.80 | 0.40 | 0.40 (custodial) | steep |
| RevShare (1%) | 0.44 | 0.11 | 0.25 (custodial) | steep |
| Star.fun (1%) | 0.80 | 0 | 0 | steep |
| LFOwn (2.5%) | 1.00 | 0.25 | 0.75 (custodial) | steep |
| Trends (4%) | 1.60 | 1.60 | 0 | steep |

- Steep competitor curves run 8.75x-15x.
- **Buyers:** among the cheapest (tied with RevShare, Star.fun and Scribe at 1%). On a flat curve the round trip costs about 2% and early buyers have no edge. On steep curves, later buyers fund the earlier buyers' dump.
- **Creator:** earns the least in presale. This is by design (founder rule, no wash-trading incentive).
- **Platform:** 0.28, below every mainstream pad (0.36-1.60).

### Graduation (% of raise)

| | Platform | Creator / founder | Floor | Pool |
|---|---|---|---|---|
| **StockFloor** | **5% ($600)** | **0** | **60% ($7.2K)** | **35% ($4.2K)** |
| Ember | 10% | 0 | 0 | rest |
| Scribe / RevShare | 5% | 0 (RevShare sometimes 5%) | 0 | rest |
| Purps | 2% | 0 | 0 | rest |
| Star.fun | ? | ~50% to treasury (unverified) | 0 | rest |
| Others | 0 | 0 | 0 | ~100% (pool ~$10K) |

- **Buyers:** get a $43.97 guarantee per $100 instead of $0. The cost is a pool 2.4x shallower than a competitor's (+53% vs +21% on a $1K buy, est.).
- **Platform:** half of Ember's cut, equal to Scribe and RevShare.

### Trading (after graduation)

| Pad (total fee) | Platform | Creator | Floor / holders |
|---|---|---|---|
| **StockFloor (1%)** | **0.20 (+0.04 referral)** | **0.32** | **0.28 floor** |
| Ember (1%) | 0.48 | 0.32 | 0 |
| Ethics (1.5%) | 0.36 | 0.84 | 0 |
| One Only (1.25%) | 0.50 | 0.50 | 0 |
| Purps (1.2%) | 0.16 | 0.40 | 0.40 (custodial) |
| RevShare (1%) | 0.44 | 0.11 | 0.25 (custodial) |
| LFOwn (1%) | 0.40 | 0.10 | 0.30 (custodial) |
| Scribe (1%) | 0.80 | 0 | 0 |
| ClawPump (1.25%) | 1.00 | 0 | 0 |
| Star.fun (1%, unverified) | 0.10 | 0.70 | 0 |
| PumpSwap | ~0.05 above 420 SOL market cap | 0.05-0.95 by tier | 0 |

- **Creators:** at the same level as Ember, and above RevShare, LFOwn, Scribe, ClawPump and the low PumpSwap tiers.
- **Platform:** 8 of 13 pads take more.
- **Floor:** the only non-custodial holder share. Keeper-bot payouts elsewhere have changed (OTC changed its split about 5 times) or failed (Ember).

---

## 4. Meme vs "safe meme": one model or two presets?

**Run one model.** Fair Share should be the single default for every meme token, with no "degen" preset.
- **"Safe" is the product; "meme" is the audience.** The floor and the flat curve make the product different. Meme culture brings the audience, and steep-curve dump economics are not needed for it.
- **A degen preset destroys the brand.** Creator Rocket (1.2x curve, 1.5% fee, $30.75 guarantee) scores 9 with creators but 3.5 with holders and 5 on business. It "chases pump.fun on pump.fun's own terms". If there are two meme presets, buyers have to check which one a token uses, and "every StockFloor token has the same floor rules" stops being true.
- **We will lose the "dump creators", and that is fine.** Much of what creators earn on steep-curve pads comes from dev buys dumped on 10x+ curves, not from fees. Target community and "serious meme" creators, who value a floor they can advertise ("you can't go to zero").
- **A second segment only where the need is really different:** Project Raise (#4) as an opt-in mode later, labeled "15% to the team, vested monthly, forfeits to the floor".
- **For the hackathon only:** the zero-change config (`floor-max-zero-change`) as the demo.

---

## 5. Rejected models

- **`creator-rocket`:**
  - weakest guarantee ($30.75);
  - 2.98% round trip;
  - 1.2x curve;
  - creator presale cut;
  - 5 red flags;
  - undermines the "safe" pitch.
- **`simple-split-5pct`:**
  - highest revenue at a 1% fee ($18.4K) but the weakest guarantee at 1% ($36.6);
  - 1.2x curve (9.4% listing sell-off vs 5% on flat curves);
  - relaxes the LP check;
  - its native locked-LP creator payout is worth revisiting after an audit.
- **`ref-discussed` (the model from our chat):**
  - good creator pay (0.54) and floor share (0.45);
  - 1.5% trading fee (2.98% round trip);
  - $4K pool (+55% on a $1K buy);
  - lowest revenue among the commercial models ($9.3K; $5.1K at 2%), because of the 0.25% presale and the 3% graduation cut;
  - Fair Share keeps its structure with a 1% fee that is friendlier to traders.
- **`floor-max-zero-change`:** use it for the demo and C1 only. $551 a month is not a business, and the creator gets $0 after graduation.
- **`pure-floor`:**
  - the trust ceiling ($47.8);
  - $551 a month;
  - creator gets $0 after graduation;
  - contradicts the decision to hold presale fees until graduation.
- **`floor-maxi-mvp`:**
  - dominated by `floor-max-zero-change`;
  - $3.5K pool (+65% on a $1K buy);
  - no anti-snipe.
- **`ref-now` (current code):**
  - guarantee $31.4;
  - 1.2x curve;
  - $508 a month;
  - creator gets $0 after graduation.

---

## 6. Sensitivities: what changes the ranking

- **Graduation rate** (revenue at month 12, 4% → 2%):

| Model | 4% | 2% | Change |
|---|---|---|---|
| Fair Share | $14.3K | $8.8K | -38% |
| Meme Balance | $13.1K | $8.1K | -38% |
| Success Fee | $13.1K | $6.6K | -50% |
| Reference (chat model) | $9.3K | $5.1K | -46% |

  At low graduation rates Fair Share's lead widens. Success Fee only catches up if graduation rates are high.
- **Post-graduation volume:**
  - Success Fee earns the same per graduated token at any volume ($1.6-1.7K). Fair Share earns $813 at low volume and $3,511 at high.
  - **If tokens trade little after graduation, Success Fee earns more per token** (though its $20K threshold means fewer graduations).
  - At medium or high volume Fair Share wins.
  - The 12-month figures assume the same volume at a 1.5% fee as at 1%, which flatters the 1.5% models.
- **Threshold** (with a 35% pool):

| Threshold | Pool | $1K buy moves price |
|---|---|---|
| $10K | $3.5K | +65% |
| $12K | $4.2K | +53% |
| $15K | $5.25K | +41% |

  - The guarantee ratio does not depend on the threshold, but a higher threshold lowers graduation odds.
  - Creators favor $10-12K. Holders favor deeper pools.
- **Pool share** (Fair Share at $12K):
  - 35% → 40% of the raise to the pool: the guarantee drops from $43.97 to about $38.9 (est.) and a $1K buy moves the price about +45.5% instead of +53%.
  - That is essentially Meme Balance's graduation split.
  - Holder judge: pool depth matters more to holders than a few dollars of guarantee.
- **Failed-presale fees:** $3,207 of Fair Share's $14,256 month-12 revenue (22.5%) comes from failed presales.
  - About $1.8K of that is the held "floor" share routed to the platform (est.: 0.40% of about $461K of failed presale volume).
  - If it is not routed to the platform, revenue drops to about $12.4K (est.).
- **Creator acquisition:** if launches stall because creators pay-shop, move toward #2 (creator 0.40), or raise the creator's trading share to 50% of the partner share, taken from the floor rather than the platform.

---

## 7. Open questions for the founder

1. **Failed-presale floor fees** (~$1.8K a month, est.): send them to the platform and disclose it up front ("if the raise fails, the presale fee is a platform fee")? Or leave them stuck? Advertising them as floor money and then taking them reads as bait-and-switch.
2. **Pool depth vs guarantee:** keep 35% at $12K (+53%), move to 40% (about $39 guarantee), or raise the threshold to $15K?
3. **Creator presale cut of 0.12:** keep it, or set it to 0 and send it to the floor (a stricter "earn after graduation" rule)?
4. **Exit fee:** confirm 2%, all to the vault, the same for every token.
5. **Creator payout mechanism:** our on-chain split for now; switch to native locked creator LP after a security review?
6. **Referral 0.04:** keep it for the platform, or later share it with creators through referral links?
7. **Anti-snipe settings:** starting cliff (up to 20%) and decay time to 1%.
8. **Project Raise mode:** timing, the 15% founder share, and a legal review before any launch.
9. **Hackathon:** confirm the demo on the zero-change config, with Fair Share presented as the commercial model rather than shipped today.

Working files: `/private/tmp/claude-501/-Users-rk-Projects-stockfloor/a96026aa-ad2e-4ab1-8817-66f7d23901d5/scratchpad/fee-eval.cjs`, `fee-candidates.json`, `fee-eval.json`

---

# Critic's corrections

**Verdict check: corrections and fixes**

Most numbers match the metrics. I checked every split (candidate % × 0.8), guarantee, price impact, 12-month figure, portfolio figure, rank count, competitor total, the 2% sensitivity figures, the 40%-pool estimate of $38.9 (recomputed at $38.92) and the failed-presale arithmetic ($460.8K × 0.40% = $1,843; $3,207 / $14,256 = 22.5%; $12.4K without routing). The corrections below are the claims that do not hold.

**A. Wrong or non-derivable numbers**

1. §6, post-graduation volume: "At medium or high volume Fair Share wins" -> wrong at medium. Per graduated token at MED, Fair Share earns $1,381 and Success Fee $1,633. Fair Share wins only at HIGH ($3,511 vs $1,728). Fix: "Success Fee earns more per token at low and medium volume. Fair Share wins only at high volume."
2. §5, simple-split: "weakest guarantee at 1% ($36.6)" -> ref-now is also a 1% model and has $31.4. Fix: "weakest guarantee among the commercial 1% models."
3. §5, floor-maxi-mvp: "dominated by floor-max-zero-change" -> not true. floor-maxi-mvp has the better guarantee ($47.82 vs $42.63) and the better floor growth (39.8% vs 28.7%). It loses only on pool depth (+65% vs +36% on a $1K buy) and revenue ($508 vs $551). Fix: "worse pool and revenue, better floor."
4. §5, floor-maxi-mvp: "no anti-snipe" -> no candidate except meme-balanced specifies an anti-snipe setting, floor-max-zero-change included. This is not a difference between them. Remove it.
5. §1 table: "anti-snipe on (starts at up to 20%)" -> the fair-share candidate that was evaluated has no anti-snipe setting. Its sims assume a flat 1% fee, and the scheduler is not in its program-change list (only meme-balanced has one). Fix: mark it as an addition that was not evaluated, or add "allow anti-snipe fee scheduler" to the changes.
6. §5, creator-rocket: "5 red flags" -> its red_flags field lists 6: round trip, creator presale cut, founder 2%, 1.2x curve, large changes, weakest guarantee. The evaluator's own note also says 5. Fix: "6 red flags."
7. §3, #3 Success Fee: "cheapest trading on the market" -> the data supports only "cheapest among the Meteora pads listed". PumpSwap above 420 SOL charges about 0.05% platform plus 0.05% creator at the low tier, and its total may be below 0.6%. Fix: "cheapest among the listed Meteora DBC pads."
8. §2, #3 Success Fee: "deepest pool" -> project-escrow's is deeper ($15K vs $7K). Fix: "deepest pool of the meme-threshold models."
9. §2, #3 Success Fee, framing "5% only on success" -> Success Fee's graduation cut is 8%, not 5%. Fix: "8% only on success", or say the 5% belongs to Fair Share.
10. §3, presale: "Platform 0.28, below every mainstream pad (0.36-1.60)" -> 4 of the 13 Meteora pads take less in presale: Perpspad 0.30, StonkOptions 0.20, Scribe 0.16, OTC 0.08. Fix: "below pump.fun, Ember, Purps, Star.fun, LFOwn, Trends, One Only, RevShare, Ethics and ClawPump. Scribe, Stonk, OTC and Perpspad take less."
11. §2, #1 weaknesses: "creator 0.32 loses to Ethics (0.84) and One Only (0.50)" -> incomplete. It also loses to Trends (1.60), Star.fun (0.70) and Purps (0.40). Fix: list all five (6 of 13 pay creators the same or more).
12. Judge scores (6.5 / 7.5 / 8 = 22/30; creator-rocket 9 / 3.5 / 5; success-fee creator 5): these are not in the evaluator's metrics and cannot be checked here. Label them as judge scores and do not merge them with the "all figures come from the evaluator" line.
13. §6, graduation rate: "Fair Share's lead widens" -> it leads only the three models in that table. simple-split ($18.4K / $11.7K), creator-rocket ($16.3K / $9.7K) and project-escrow earn more at both rates. Fix: "lead over Meme Balance, Success Fee and ref-discussed."
14. §4: "Much of what creators earn on steep-curve pads comes from dev buys dumped on 10x+ curves" -> the context supports only that dev buys are allowed and that curves run 8.75-15x. It has no earnings split. Label it as opinion.

**B. Conflicts with founder decisions**

15. The hackathon demo on `floor-max-zero-change`, "needs no program change", conflicts with the decision to hold presale fees until graduation.
    - In zero-change the hold is only a crank policy ("a crank can simply wait"). The program does not enforce it.
    - §5 rejects pure-floor for exactly this reason, which is inconsistent.
    - The same demo model also gives the creator 30% of presale partner fees (wash-trading red flag, against "creator earns mainly after graduation") and $0 after graduation.
    - Fix: either run the demo on floor-maxi-mvp with the `harvest_curve_fees` migration gate, or state these deviations for the demo.
16. The headline revenue ($14.3K at 4%, $8.8K at 2%) includes about $1.84K a month of failed-presale floor fees routed to the platform. The founder has not confirmed that routing; the assistant only proposed it. Fix: give both figures in §1 and §2 ($14.3K with routing, about $12.4K without), not only in §6.
17. #4 Project Raise exit fee of 2.5% conflicts with the recommended "2%, same for all tokens" (open question 4, still undecided). It also needs a per-mode exit fee change. Fix: flag the inconsistency, or keep 2%.
18. Fair Share still pays the creator 0.12 per $100 in presale. Other models got a wash-trading red flag for their creator presale cut; Fair Share's did not. Fix: note it is smaller but still present (it is open question 3).

**C. Could mislead a buyer about the floor**

19. "$100 bought at listing is guaranteed $43.97 back" in dollars -> the floor is held in SPYx, so its dollar value moves with the S&P 500. A 20% index drop cuts the floor by about 20%. Fix: "about 44% of the listing price, redeemable in SPYx."
20. The guarantee applies at the listing price only. Buyers at higher prices get proportionally less: at the calm-scenario end price (1.87x) it is about $23.5 per $100. Also, "lowest value $43 in every stress scenario" is for a mid-presale buyer ($43.75), not a listing buyer. Fix: say whose guarantee it is and at what price.
21. The $43.97 assumes presale volume of 2x the raise (the formula uses presaleFee × 2). The sim assumes 1x and gives $43.75. Fix: "about $44, depends on presale volume."
22. §3 labels presale floor fees "0.40 floor (on-chain, redeemable)". They are not redeemable until graduation. If the presale fails, the proposal sends them to the platform. Fix: "0.40 held for the floor, released at graduation; goes to the platform if the raise fails (proposed)." Disclose this before the sale, or it reads as bait-and-switch.
23. "Every trade grows the floor more than it pays us" is false for failed presales, where the platform would get 0.28 + 0.40 and the floor 0. Fix: add "on graduated tokens."
24. "Enter and exit the presale at about 2% round trip" does not hold during the anti-snipe window, where the fee can be up to 20%. Disclose the window.
25. The exit fee (2%) is not decided yet, so every guarantee figure depends on it. Also, bots hold the price about 3% below the floor (0.97x), so the market price can sit under the redeem value. Say so rather than implying the price never goes below the floor.

Everything else matches the metrics and the context, including the competitor tables in §3.
