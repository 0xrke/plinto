# What works on X for Meteora DBC launchpads

**Date:** 2026-09-23

**Scope.** The X accounts of 11 of the 12 launchpads listed on the Meteora DBC screener [new.meteora.fyi](https://new.meteora.fyi/) (see [`dbc-launchpad-economics.md`](dbc-launchpad-economics.md) for their products and economics): Perpspad, Purps, OTC Desks, RevShare, Ethics, Trends, ClawPump, StonkOptions, Scribe, OneOnly and LFOwn. Ember is excluded by request. OTC Desks is covered through its backup account @otcdotcash, because its main account @otc_labs was suspended on 2026-09-15.

**Questions answered.**
1. Which topics, words and formats get reach on these accounts, measured against each account's own baseline? (§2–§4)
2. Which ecosystem accounts amplify them, and is tagging @MeteoraAG, @solana or @JupiterExchange worth it? (§5)
3. What does each pad post, and what failed? (§6, §7)
4. What should our own account post? (§8) The product name may change (a rename to e.g. "Plinto" is under consideration), so the recommendations are name-agnostic.

**Method.**
- **Data.** Scraped on 2026-09-23 from X's own web API through the user's logged-in browser (UserTweets plus SearchTimeline with `-filter:replies`). Per post: text, views, likes, retweets, replies, quotes, bookmarks, media type, links, quote target, pinned flag. Replies to other accounts are missing for every account, and some accounts are only partly covered (see the coverage table).
- **Views are X impressions.** The data has no traffic sources, follower history, link clicks or reposter lists. Every "why it worked" below is a hypothesis unless it cites a visible event (a quote, a repost, a reply by @solana).
- **Per-account analyses.** One agent per account classified every post into content pillars by hand and computed medians and keyword lifts with python. A second pass rechecked the numbers against the files and corrected them (11–21 corrections per account). This report uses the corrected versions.
- **Cross-account quant study.** Each post's views and likes are divided by its own account's median (a score of 1.00 is a typical post for that account). *Lift* is the pooled median score of posts with a feature divided by the median of posts without it. *Balanced lift* is the median of the per-account lifts, so each account counts once. *Accts >1* counts the accounts (with at least 3 posts on each side) where the feature did better. The 76 posts under 2 days old are left out, leaving 1,249 posts. Pooled score spread: p25 0.64, p50 1.00, p75 1.72, p90 3.23, p99 15.3, max 54.8. A 2x post is roughly in the top 15%.
- **Time corrections.** Several accounts grew or decayed fast, so raw medians mislead. Where available we quote a time-normalized ratio: Perpspad's *relWin* (views over the median of posts from 7 days before to 8 days after, the post included), RevShare's *rel* (over the median of the 20 posts before and after), Scribe's *relday* (over the median of its own day), and LFOwn's numbers with its Sep 17–18 attention wave excluded.
- **Young posts.** Posts under about 2 days old are still gaining views. They are flagged wherever they appear.
- **Weak evidence** is marked *(weak)* or *(small n)*. Most per-account keyword cells rest on n ≤ 10, and many on n ≤ 3. Features travel together (launch posts tend to carry video, long text and partner tags), so every lift here is correlation, not causation.
- Scripts and full tables live in the session scratchpad: `x/quant.py` and `x/quant.md` (cross-account), `x/accounts/<handle>.json` (raw data). They are not in the repo.

### Coverage

"Posts" counts own posts (originals, quotes and self-replies), not reposts. Engagement rate is the per-post median of the scraper's precomputed `eng_rate_pct` (engagements over views). "Of lifetime" compares own posts plus reposts captured with the profile's status count.

| Account | Pad | Followers | Posts (reposts) | Of lifetime | Date range | Median views | Median likes | Median eng. rate | Posts/day |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|
| [@clawpumptech](https://x.com/clawpumptech) | ClawPump | 11,317 | 280 (not captured) | 280 of 9,416 | 2026-04-28 – 09-22 | 5,346.5 | 44 | 1.19% | 1.89 |
| [@revshare_app](https://x.com/revshare_app) | RevShare | 8,368 | 372 (18) | 390 of 1,402 | 2025-08-08 – 2026-09-22 | 1,812.5 | 27 | 2.21% | 0.91 |
| [@perpspadfun](https://x.com/perpspadfun) | Perpspad | 4,153 | 227 (79) | 306 of 511 | 2026-06-29 – 09-22 | 2,608 | 42 | 2.12% | 2.64 |
| [@buypurps](https://x.com/buypurps) | Purps | 2,127 | 83 (7) | 90 of 123 | 2026-08-13 – 09-23 | 3,101 | 32 | 1.61% | 1.98 |
| [@otcdotcash](https://x.com/otcdotcash) | OTC Desks | 2,091 | 36 (7) | 43 of 79 | 2026-09-15 – 09-23 | 11,825 | 215.5 | 2.01% | 4.0 |
| [@ethicslaunch](https://x.com/ethicslaunch) | Ethics | 2,057 | 86 (1) | 87 of 122 | 2026-08-02 – 09-21 | 4,441.5 | 31.5 | 1.03% | 1.69 |
| [@trendsdotrun](https://x.com/trendsdotrun) | Trends | 1,943 | 81 (14) | 95 of 133 | 2026-07-09 – 09-22 | 2,249 | 25 | 2.04% | 1.07 |
| [@getstonkoptions](https://x.com/getstonkoptions) | StonkOptions (Star) | 1,908 | 30 (2) | 32 of 62 | 2026-09-11 – 09-22 | 4,733.5 | 34.5 | 0.96% | 2.5 |
| [@Scribeonsol](https://x.com/Scribeonsol) | Scribe | 1,661 | 38 (0) | 38 of 89 | 2026-09-15 – 09-21 | 7,937 | 75.5 | 1.06% | 5.43 |
| [@LFOWNDOTFUN](https://x.com/LFOWNDOTFUN) | LFOwn | 481 | 57 (43) | 100 of 147 | 2026-09-08 – 09-22 | 901 | 9 | 1.49% | 3.8 |
| [@oneonlylol](https://x.com/oneonlylol) | OneOnly | 143 | 35 (0) | 35 of 85 | 2026-09-12 – 09-22 | 842 | 15 | 2.9% | 3.18 |

Coverage notes:
- **ClawPump**: the source query returns neither reposts nor self-replies, so this is a sample biased toward original posts (about 3% of lifetime statuses).
- **RevShare**: about 27% of its history. The launch period (Mar–Aug 2025) is missing.
- **OTC Desks**: the account is 9 days old and its early reach came from the suspended @otc_labs audience moving over (the founder says over 13K followers).
- **Trends**: 70 of 81 posts fall in one launch week (Sep 16–22).
- **StonkOptions, Scribe, OneOnly, LFOwn, OTC Desks** are 1–3 weeks old. Their numbers describe a launch, not a steady state.
- Follower counts range 80x (143 to 11,317). Compare accounts only through scores relative to their own median.

---

## 1. TL;DR

- **Launch moments carry most of the reach.** About half of the top 30 posts across all 11 accounts are "X is live" / "Introducing" / V2 reveals (50% contain a launch word vs 27% of all older posts), and most of the rest are KOL-event posts and X Articles. The best ones state the mechanism in one line ("every coin is backed by a live perp", "stock-paired tokens"). A normal day's post gets roughly the account median.
- **The single best pattern: ship a feature a partner just announced, and quote the announcement with a long "how we use it" post.** When Meteora announced that DBC supports any token pair (424.9k views), Purps quoted it 34 minutes later with "Purps V2 is live" (155.5k, 45.9x its median) and Perpspad quoted it about 8.5 hours later with a 1,277-character explainer (142.9k, relWin 25.75). Quotes of big posts without a shipped feature stayed at or below baseline on every account that tried them (Perpspad median relWin 0.93 for quotes of 50k+ posts; Purps 2.2k–2.3k; Ethics 0.73x for quoting others).
- **@MeteoraAG is the most consistent tag.** Posts mentioning Meteora beat their account's median on 6 of 6 accounts with enough posts (pooled lift 1.54x); posts tagging @MeteoraAG score a median 2.35 (n=37, 8 accounts). It is confounded with launch moments, and a passing "Powered by @MeteoraAG" works as well as a deep one. @MeteoraEco is the one amplifier the pads share: 6 of 11 accounts retweet it.
- **@solana tags are close to neutral** (pooled score 1.30, n=113; relWin 1.00 on Perpspad, n=16; 1.07x on Trends' mature posts). But a dedicated @solana post or newsletter feature about you is large (StonkOptions, Trends). **@JupiterExchange** is rarely tagged (n=10, score 1.14, small n); being *listed* on Jupiter's launchpad page did work as a legitimacy post (Perpspad 206 likes; Ethics 92 likes).
- **Words that lift reach:** launchpad (balanced lift 2.27x, 6/7 accounts), backed/floor/NAV/treasury (1.70x, 5/6), fees/revenue/buyback/burn (1.60x, 8/9), numbers and $ amounts (1.47x, 8/10), stocks/xStocks/RWA (1.39x, 6/7), cashtags (1.37x, 7/9). **"DBC / bonding curve" does not lift reach** (0.86x balanced, 1/3). Name the outcome, not the mechanism.
- **Formats:** video scores 1.51 (6/7 accounts), photo 1.12, text-only 0.89 (0/11 accounts above their median). Posts of 281+ characters score 1.23 and posts of 0–40 characters 0.70. Three or more line breaks lift 1.52x (9/11). Self-replies score 0.32 (0/9 accounts), so the thread tail is almost invisible. Link cards without media score 0.68. All-lowercase text scores 0.49.
- **Receipts work when they carry numbers and land on an attention day.** Perpspad's "Two months in review" (28.1k, relWin 4.4), Purps' "five days on DBC" (12.0k), OTC's daily recap (302 likes within hours), RevShare's "$62,000 paid to holders" (12.8k). A typo'd one-liner milestone on a busy day got relWin 0.45.
- **Holder-benefit hooks in one plain sentence** get the most likes: "You hold, you get paid" (Perpspad, 236 likes, young), "Hold $HAN, receive $SOLO" (LFOwn), "Get paid to create" (Purps, 85 replies).
- **Run launches as a planned arc**, not scattered posts: teaser, date drop, reveal video (pinned), legitimacy milestone, first receipts. ClawPump's AnsemHack arc produced posts of 115k, 112k and 197k; Perpspad's Sep 9–14 "narrative week" produced four posts above 25k in six days. Keep countdown promises (Perpspad's slipped "24 hours" teaser: relWin 0.35).
- **What fails:** gm and vibe one-liners, emoji-only quotes, tag-only handshakes, "wen integration" asks, vague "coming soon" teasers, bare links, link-only self-replies, the 3rd–5th near-identical "new pair" post in a day, and in-joke memes.
- **The stock angle is taken but the floor is not.** At least five pads already pitch stock pairing (Perpspad, Purps, Ethics, OTC Desks, Scribe, ClawPump's "Stocknized Agents"). "Pair with a stock" alone is not a hook (ClawPump's September stock posts: 1.06x their month; LFOwn's only stock post: 0.47x, n=1). No pad claims a redeemable floor. Lead with the floor and a live number.
- **Timing matters little** (±20%). 09–11 UTC (score 1.23, 7/8 accounts) and Fridays (1.17, 8/10) are slightly ahead; 15–17 UTC, the busiest window, is below average (0.90). No account uses hashtags.

---

## 2. Keywords and narratives

Cross-account lift, posts older than 2 days (from the quant study).

| Keyword / narrative | n | Accounts | Lift (views) | Lift (likes) | Balanced lift | Accts >1 |
|---|---:|---:|---:|---:|---:|---:|
| hackathon / colosseum / stocklana | 21 | 3 | 1.96x | 1.16x | 2.03x | 2/3 *(small n)* |
| meteora / @MeteoraAG | 52 | 10 | 1.54x | 1.34x | 1.38x | **6/6** |
| backed / floor / NAV / treasury | 60 | 8 | 1.53x | 1.12x | 1.70x | 5/6 |
| perps | 126 | 4 | 1.48x | 1.13x | 1.68x | 3/4 *(mostly Perpspad)* |
| pump / pumpfun | 50 | 7 | 1.40x | 1.10x | 1.38x | 4/4 |
| cashtag ($TICKER) | 139 | 11 | 1.35x | 1.30x | 1.37x | 7/9 |
| any @mention | 457 | 11 | 1.32x | 1.14x | 1.23x | 9/10 |
| launchpad | 68 | 8 | 1.32x | 1.32x | **2.27x** | 6/7 |
| stock / xStock / SPYx / RWA / tokenized | 141 | 10 | 1.32x | 1.11x | 1.39x | 6/7 |
| numbers / $ amounts | 512 | 11 | 1.30x | 1.08x | 1.47x | 8/10 |
| jupiter | 16 | 4 | 1.28x | 1.29x | 1.14x | 2/3 *(small n)* |
| creator(s) | 112 | 8 | 1.27x | 1.15x | 1.01x | 4/6 |
| solana / @solana | 373 | 11 | 1.24x | 1.05x | 1.27x | 8/9 |
| fees / revenue / buyback / burn / dividend / yield | 391 | 11 | 1.20x | 1.07x | 1.60x | 8/9 |
| emoji | 192 | 8 | 1.14x | 0.96x | 1.41x | 5/6 |
| launch (any) | 335 | 10 | 1.12x | 1.15x | 1.34x | 6/8 |
| CA / contract address | 105 | 9 | 1.09x | 1.05x | 1.38x | 5/6 |
| AI / agent | 214 | 4 | 1.07x | 1.00x | 1.19x | 1/2 *(mostly ClawPump)* |
| holders / rewards / airdrop | 174 | 9 | 1.06x | 1.04x | 1.33x | 4/6 |
| live / now live | 109 | 8 | 1.01x | 1.04x | 1.27x | 5/8 |
| DBC / bonding curve | 48 | 8 | 0.97x | 1.08x | **0.86x** | 1/3 |

@clawpumptech (272 posts) and @revshare_app (370) are about half the pool, so read the balanced and Accts >1 columns before the pooled ones.

**Per-account signals that agree with the table** (time-normalized where available):
- **Stock / RWA words beat generic crypto words on Perpspad even after time correction:** "stock/stonk" relWin 1.46 (n=28), "tokenized" 2.15 (n=13), "RWA" 2.50 (n=6), "only possible / only on" 2.39 (n=10), "launchpad" 2.88 (n=10). The core word "perp" is at 1.03 (n=163), i.e. baseline.
- **Concrete numbers:** RevShare posts with a $ or k/M figure in the first 100 characters: median 2,461 (rel 1.26, n=63) vs 1,496.5 (rel 0.94) without. LFOwn, excluding its attention wave: $ figure 1,165 (n=13) vs 648 without (n=16), its most robust copy signal. Perpspad "$ figure in text" relWin 1.38 (n=23).
- **"Backed" and "real market" (Ethics):** "backed" 2.12x (n=9), "real market" 3.19x (n=2), "first…" claims 3.67x (n=3). *(small n)*
- **Named companies beat the word "stock" (StonkOptions):** McDonald's / $MCD / dollar amounts 2.49x (n=3); generic "stock" 0.72x (n=6).
- **Holder-value words on Scribe** (relday): $SCRIBE cashtag 1.70x (n=9), "keeper" 1.70x (n=3), "fees" 1.54x (n=4). Tech words sell less: "v1 transaction" 0.32x (n=3), "first-ever" claims 0.53x (n=4).
- **Mechanism jargon doesn't pull:** RevShare "bonding curve" rel 0.94 (n=27); Ethics "DBC" 0.74x raw, but the 3 non-reply DBC posts median 10,459 (2.35x), so naming the protocol doesn't hurt when the post is a real update.
- **Enemy words (OneOnly):** "vamp" 1.28x (n=11). The recurring brand sign-off "One Only" by itself is 0.89x (n=17).

**Things that only look strong** (confounded or tiny n): Perpspad's "DBC" (10.6x) and "DLMM" (12x) come from the same 2–3 breakout posts. Purps' "meteora" 27x is n=2, one of them the 155k post. ClawPump's "incubator" and "backed" are n=2. Trends' "dbc" 32.9x is one post with 0.18% likes/views.

---

## 3. Formats

### Media

| Media | n | Accounts | Median score (views) | Median score (likes) | Accts >1 |
|---|---:|---:|---:|---:|---:|
| text-only | 677 | 11 | 0.89 | 0.89 | 0/11 |
| photo | 400 | 11 | 1.12 | 1.06 | 6/10 |
| video | 158 | 8 | **1.51** | 1.30 | 6/7 |
| X Article | 12 | 4 | 0.85 | 1.26 | 1/2 *(small n)* |
| gif | 2 | 2 | 1.64 | 0.72 | *(weak)* |

- On standalone posts over 100 characters: video 1.50, photo 1.26, text-only 1.01.
- **Video is confounded with launches.** On Trends, "Introducing" + video (n=9) had a median of 5,631 while video without "Introducing" was 0.84x. On ClawPump original posts, video was 0.94x of the originals median; media lifted quote posts instead (video quotes 12,438, plain quotes 3,679). The winning unit is a new feature shown in a short demo video.
- **X Articles are high-variance.** ClawPump's 4 bare-link Articles scored 13.8x (110.6k, 82.0k, 65.4k, 15.7k); RevShare's 6 scored 0.75x. Ethics' short "Built on @MeteoraAG" header linking an Article got 17.8k (4.0x).

### Kind, structure, length

| Kind / format | n | Accounts | Median score | Lift | Balanced | Accts >1 |
|---|---:|---:|---:|---:|---:|---:|
| standalone post | 783 | 11 | 1.07 | – | – | 10/11 |
| quote post | 393 | 11 | 0.98 | 0.97x | 1.09x | 6/10 |
| self-reply (thread) | 73 | 9 | **0.32** | 0.31x | 0.26x | 0/9 |
| 3+ line breaks | 614 | 11 | 1.23 | 1.52x | 1.34x | 9/11 |
| bullet / list lines | 64 | 9 | 1.32 | 1.33x | 1.50x | 4/5 |
| question | 106 | 11 | 1.00 | 1.00x | 1.08x | 5/8 |
| external link | 230 | 11 | 0.92 | 0.91x | 0.81x | 4/10 |
| link card, no media | 97 | 10 | **0.68** | 0.67x | 0.62x | 3/9 |
| all-lowercase | 73 | 9 | **0.49** | 0.49x | 0.44x | 1/4 |

| Length (characters) | n | Median score | Accts >1 |
|---|---:|---:|---:|
| 0–40 | 184 | 0.70 | 2/10 |
| 41–100 | 225 | 0.89 | 4/10 |
| 101–200 | 306 | 0.95 | 4/10 |
| 201–280 | 224 | 1.18 | 5/8 |
| 281+ | 310 | **1.23** | 7/8 |

- Line breaks help even at fixed length: for 201–280 characters, 3+ line breaks score 1.27 vs 0.76 without.
- Quoting your own post scores 1.14 (n=91); quoting others 0.92 (n=302). Perpspad self-quotes relWin 1.20 vs 0.86 for others; Ethics 1.50x vs 0.73x; Purps 5,765 vs 967.5 for self-replies. **Put follow-ups in a self-quote, not a thread reply.**
- Perpspad's length curve is the steepest: under 40 characters relWin 0.82; 800+ characters (n=6) relWin 5.69, median 17,079. Long, self-contained explainers are its best format.
- The best copy often dies in a thread. Ethics' sharpest line ("DBC for discovery. DAMMv2 for instant books. Stocks as the quote.") got 870 views as reply #2 (0.20x). StonkOptions' tokenomics and partner replies got 1.4–1.5% of the head post's views.
- The site link in a bare self-reply reaches 8–22% of the head post (StonkOptions median 957; LFOwn "Launch now: <link>" median 304, 0.34x).

---

## 4. Timing

| UTC hours | n | Median score | Accts >1 | | Weekday | n | Median score | Accts >1 |
|---|---:|---:|---:|---|---|---:|---:|---:|
| 00–02 | 137 | 0.97 | 4/7 | | Mon | 174 | 0.88 | 1/8 |
| 03–05 | 113 | 1.08 | 6/8 | | Tue | 191 | 0.96 | 3/8 |
| 06–08 | 79 | 0.89 | 2/8 | | Wed | 178 | 1.00 | 3/9 |
| **09–11** | 98 | **1.23** | **7/8** | | Thu | 207 | 0.96 | 4/9 |
| 12–14 | 188 | 1.00 | 6/10 | | **Fri** | 225 | **1.17** | **8/10** |
| 15–17 | 256 | 0.90 | 3/9 | | Sat | 132 | 0.97 | 4/8 |
| 18–20 | 191 | 1.00 | 5/7 | | Sun | 142 | 1.12 | 4/11 |
| 21–23 | 187 | 1.07 | 6/9 | | | | | |

- Effects are within ±20%. Partner news beats the clock: Purps' 155k post went out at 06:09 UTC because Meteora posted then.
- **Bursts hurt later posts.** Ethics: first post of the day 1.19x, later posts 0.93x (original posts 1.63x vs 0.95x). ClawPump's 5–6-post days in mid-May (May 15, 20–22) had a median of 2,397 against its 5,346.5 baseline. Perpspad's second "you can now launch coins paired with $X" post of one evening (its 5th post that day) got relWin 0.40.
- **Launch-week decay is steep.** StonkOptions' daily median fell from 10,848 (Sep 11) to under 2,000 within a week. Scribe's day medians went 18,376 → 13,635.5 → 5,667 → about 5,000. Trends: 2,972 → about 1,800–1,900 within 3 days of launch.
- Burst days can still pay in total: Scribe posted 21 times on launch day (median 18,376) and OTC 11 times on Sep 22 (highest total views, 119,587).

---

## 5. Ecosystem amplifiers

### Tags

Mentions in at least 5 older posts, own handle excluded (quant study).

| Mentioned | n | By accounts | Median score (views) | Median score (likes) |
|---|---:|---:|---:|---:|
| @MeteoraAG | 37 | 8 | **2.35** | 1.61 |
| @MeteoraEco | 6 | 3 | 2.24 | 1.97 *(small n)* |
| @prestocks | 8 | 3 | 2.61 | 1.32 *(small n)* |
| @pumpfun | 21 | 3 | 2.01 | 1.25 |
| @hyperliquidx | 11 | 3 | 1.76 | 1.05 *(small n)* |
| @metadaoproject | 6 | 3 | 1.51 | 1.22 *(small n)* |
| @solana | 113 | 7 | 1.30 | 1.27 |
| @RobinhoodCrypto | 19 | 4 | 1.28 | 0.86 |
| @sunrise | 14 | 5 | 1.15 | 1.11 *(small n)* |
| @JupiterExchange | 10 | 3 | 1.14 | 1.29 *(small n)* |
| @xStocksFi | 10 | 3 | 1.01 | 1.19 *(small n)* |
| @backpack | 17 | 5 | 0.91 | 1.21 |
| @toly | 6 | 3 | 0.64 | 0.86 *(small n)* |

Handles used by only 1–2 accounts (weak evidence): @nousresearch 4.72, @ponsdotfamily 2.41, @colosseum 2.01, @blknoiz06 1.59, @PhoenixTrade 1.49 (n=40).

**@MeteoraAG — worth tagging on real DBC news, not as decoration.**
- Perpspad: 12 tagged posts, relWin 4.05, 9 of 12 above their window. The misses were "Bullish on @MeteoraAG" (0.64), a creator-profiles post (0.50) and a $14m milestone (0.65).
- Ethics: Meteora-tagged substantive posts 2.12x (n=11), 1.63x without the roundups; August 1.25x, September 4.02x (timing confound).
- Trends: 1.63x (n=6), 1.41x on mature posts. ClawPump originals 16,508.5 (n=2).
- Counter-examples: Scribe's tag-only "@MeteoraAG x @Scribeonsol x @sunrise 🤝" (591 views); StonkOptions' partner self-reply tagging @MeteoraAG and xStocks (2,004, 0.42x); OTC's hours-old roadmap post (4,970, 0.42x). RevShare and LFOwn never tagged @MeteoraAG at all.

**@solana — neutral as a tag, large as a feature.**
- As a tag: Perpspad relWin 1.00, n=16 (September tagged 5,113 vs untagged 5,282); Trends 1.07x on mature posts; Ethics 1.20x (n=4). ClawPump originals 9,862.5 tagged vs 5,346.5 untagged, but its big announcements all carry the tag.
- As a feature: @solana replied "👀👀👀" to StonkOptions' first teaser within 2.5 minutes (25,180 views on the reply) and published a dedicated post ("Your next benefits package could come from a meme", 152,623 views) 36 minutes after the launch post, which reached 131,905. Trends was listed in @solana's weekly newsletter twice (171k and 149k views). Quoting the newsletter is hit-or-miss: StonkOptions quoted both issues and got 7,519 (1.59x) and 2,655 (0.56x); Trends' own quotes of them got 3,498 and 1,944.
- @toly tags did nothing (score 0.64; Perpspad relWin 1.06).

**@JupiterExchange — rarely tagged; the listing is the content.** Perpspad's "now listed as a launchpad on @JupiterExchange" got 12,458 views, 206 likes and relWin 2.02. Ethics' "verified on launch.meteora.ag / available on Jupiter list" got 10,881 views and 92 likes (2.45x). ClawPump's @JupiterExchange originals were below its originals median (5,679, n=5).

**Stock issuers:** tagging @xStocksFi or @Backpack did not help by itself (Ethics 0.82x each; Purps' @Backpack single-pair posts 0.59x, n=10). A novel asset plus the issuer's tag did (Ethics' PreStocks post 27,344; RealityFi "first launchpad pair with stocks" 16,295).

**Mention count (Ethics, top-level posts):** 0 mentions 4,206; 1 mention 4,726; 2 mentions 7,741.5 (1.74x); 3+ 7,160.

### Who retweets and quotes

| Retweeted account | Reposts | By how many of the 11 | Median views of the reposted post |
|---|---:|---:|---:|
| **@MeteoraEco** | 12 | **6** (LFOwn, Purps, OTC, Perpspad, RevShare, Trends) | 6,583 |
| @vesper792 | 5 | 3 | 10,941 |
| @solana | 4 | 2 | 150,432 |

Every other retweeted account is picked up by only one pad.

- **@MeteoraEco is the shared amplifier, and it amplifies pads back.** It posted "perpify everything on solana… powered by meteora" (15.3k) and "2 months in review… perpspad" (6.1k) about Perpspad; "five days since introducing meteora dbc pools, over $1,000,000 total volume" (7,049) the same day Purps posted its DBC update; "social fi on solana powered by meteora dbc" (8,703) on Trends' launch day; a ship-emoji reply to OTC's "Introducing @MeteoraAG smart launches"; and its "meteora ecosystem highlights" roundup (104k) named LFOwn. Getting into MeteoraEco's highlights and quoting it is the cheapest partner reach available to us.
- **@vesper792** posts Meteora DBC trend threads ("alignment coins assemble", 25k; a DBC leaderboard, 16.7k). LFOwn's short quotes of vesper got 3.3x and 4.2x (inside its attention wave); Scribe's "Scribe has Joined!" quote of the leaderboard got 1.17x its day.
- **KOLs about you, not KOLs in general.** Perpspad's quote of @ethtwit calling it "the most novel and overlooked launchpad" (99.1k) got 39.1k (relWin 6.12) 18 minutes later. ClawPump's co-branded AnsemHack with @blknoiz06 produced 3 of its top 12. Quick quotes of big posts that are not about you stay near baseline: Perpspad's quotes of @solana (608k), Ansem (1.09M) and WatcherGuru (1.4M) all landed below 1; Purps' "memefi" quote of Ansem got 2,244; OneOnly captured 0.5–0.9% of Ansem's and frankdegods' views.
- **Paid or coordinated reach exists.** Trends' Sep 3, Sep 4 and Sep 21 posts have RT/like of 0.61–0.73 and reply/like of 0.85–0.99 against medians of 0.23/0.35; its 74k launch video has 0.18% likes/views. Several Ethics posts reach 9–20x followers at 0.27–0.45% engagement, and RevShare's top post (25k views, 3x followers) had 0.38%. OneOnly's engagement is unusually flat (10 posts with exactly 3 RTs). Benchmark against organic medians, not these outliers.

---

## 6. Top posts across all pads

Posts at least 2 days old, ranked by score (views over the account's median). ClawPump has 13 of the top 30 and Perpspad 7, so a per-account top 3 follows.

| # | Account | Post | Views | Likes | Score | Kind / media | What it is |
|---:|---|---|---:|---:|---:|---|---|
| 1 | Perpspad | [2097686544190431547](https://x.com/perpspadfun/status/2097686544190431547) | 142,908 | 166 | 54.8 | quote / text | 1,277-char DBC explainer quoting Meteora's any-pair announcement: "a coin whose price is discovered in NVDAx or SPYx instead of SOL", live numbers |
| 2 | Purps | [2097567969022750946](https://x.com/buypurps/status/2097567969022750946) | 155,537 | 670 | 45.9 | quote / text | "Purps V2 is live… launch stock paired tokens, RWAs", quoting Meteora's announcement 34 min later |
| 3 | ClawPump | [2090141776535310837](https://x.com/clawpumptech/status/2090141776535310837) | 196,517 | 423 | 36.8 | post / photo | "The AnsemHack Clawrena is officially open… $320K" (payoff of a 9-day KOL arc) |
| 4 | Purps | [2096656066104668215](https://x.com/buypurps/status/2096656066104668215) | 110,849 | 579 | 32.7 | post / video | "Introducing Purps - Our Official Walkthrough" (48 bookmarks, account max) |
| 5 | Trends | [2098767236387508526](https://x.com/trendsdotrun/status/2098767236387508526) | 73,989 | 133 | 28.9 | post / video | Launch video, "Powered by @MeteoraAG DBC" (0.18% likes/views: likely external reach) |
| 6 | StonkOptions | [2099615539295572001](https://x.com/getstonkoptions/status/2099615539295572001) | 131,905 | 243 | 23.6 | post / video | "Meet The Internet's Benefits Department…" pinned launch; @solana spotlight 36 min later |
| 7 | Perpspad | [2099580418110472293](https://x.com/perpspadfun/status/2099580418110472293) | 59,747 | 336 | 22.9 | post / video | Relaunch video "Powered by @MeteoraAG and @PhoenixTrade" (pinned) |
| 8 | ClawPump | [2061539553484132524](https://x.com/clawpumptech/status/2061539553484132524) | 119,259 | 319 | 22.3 | quote / video | Integration + usage metric, quoting a 271k-view Pump-side Article 33 min later |
| 9 | ClawPump | [2086928251608277444](https://x.com/clawpumptech/status/2086928251608277444) | 115,488 | 278 | 21.6 | post / photo | "Hey @blknoiz06 do you know what this is?" (teaser, 104 replies) |
| 10 | ClawPump | [2089831550829338866](https://x.com/clawpumptech/status/2089831550829338866) | 112,064 | 353 | 21.0 | post / video | "AnsemHack Clawrena. 1pm EST. 08/19." (date drop) |
| 11 | ClawPump | [2069505504234139674](https://x.com/clawpumptech/status/2069505504234139674) | 110,638 | 71 | 20.7 | post / X Article | Bare Article link, content unknown |
| 12 | Perpspad | [2081774965779554737](https://x.com/perpspadfun/status/2081774965779554737) | 48,518 | 108 | 18.6 | quote / photo | Self-quote: "proudly powered my @MeteoraAG, Meteora DLMM was chosen…"; a meme that "drives real buys into the underlying stock" |
| 13 | ClawPump | [2057222029007266218](https://x.com/clawpumptech/status/2057222029007266218) | 82,831 | 187 | 15.5 | post / video | "MCP v2 is live" with a copy-paste command |
| 14 | ClawPump | [2100631378903588966](https://x.com/clawpumptech/status/2100631378903588966) | 81,973 | 210 | 15.3 | post / X Article | Bare Article link |
| 15 | Perpspad | [2098801993347195239](https://x.com/perpspadfun/status/2098801993347195239) | 39,121 | 152 | 15.0 | quote / text | Four-line pitch quoting the @ethtwit endorsement 18 min later |
| 16 | RevShare | [2078512538614943844](https://x.com/revshare_app/status/2078512538614943844) | 25,052 | 59 | 13.8 | post / photo | Robinhood Chain launches + $1,000 bounty (0.38% engagement) |
| 17 | Perpspad | [2081724214944428420](https://x.com/perpspadfun/status/2081724214944428420) | 35,247 | 48 | 13.5 | post / photo | "Stock paired tokens are now live… Meme volume becomes stock volume" |
| 18 | ClawPump | [2084339103399911446](https://x.com/clawpumptech/status/2084339103399911446) | 70,280 | 313 | 13.1 | post / video | Expansion to @RobinhoodCrypto, "10,000 tokenized agents for free" |
| 19 | ClawPump | [2061952763932618885](https://x.com/clawpumptech/status/2061952763932618885) | 65,384 | 200 | 12.2 | post / X Article | Bare Article link |
| 20 | ClawPump | [2071698773793783978](https://x.com/clawpumptech/status/2071698773793783978) | 65,044 | 158 | 12.2 | post / video | Fundraise from @Pumpfun & @colosseum + product release |
| 21 | Perpspad | [2099121087879503874](https://x.com/perpspadfun/status/2099121087879503874) | 28,140 | 166 | 10.8 | post / photo | "Two months in review" with "How we use DBC / Why DBC made this possible" |
| 22 | ClawPump | [2052487047043014931](https://x.com/clawpumptech/status/2052487047043014931) | 57,188 | 88 | 10.7 | post / video | "250 million people log onto Twitter every day…" |
| 23 | Perpspad | [2090900560144986387](https://x.com/perpspadfun/status/2090900560144986387) | 27,259 | 98 | 10.5 | quote / text | "Everything About Phase 2", 48h deadline, allowlist leaderboard |
| 24 | RevShare | [1954597150236504468](https://x.com/revshare_app/status/1954597150236504468) | 17,294 | 85 | 9.5 | post / photo | Co-branded PreStocks contests, $10k/$1k prizes |
| 25 | Scribe | [2099714061554372749](https://x.com/Scribeonsol/status/2099714061554372749) | 93,967 | 290 | 9.5 | post / text | "$SCRIBE is live" with CA |
| 26 | ClawPump | [2101233240673509732](https://x.com/clawpumptech/status/2101233240673509732) | 49,254 | 242 | 9.2 | post / video | Hackathon extended "due to demand" |
| 27 | Ethics | [2098273607562780975](https://x.com/ethicslaunch/status/2098273607562780975) | 40,532 | 93 | 9.1 | post / video | "Launch token on any chain with any pair" roundup, 5 DEX tags |
| 28 | ClawPump | [2059381799533314090](https://x.com/clawpumptech/status/2059381799533314090) | 43,146 | 97 | 8.1 | post / photo | "new bio 👀 @Pumpfun" |
| 29 | OneOnly | [2098757099467559299](https://x.com/oneonlylol/status/2098757099467559299) | 6,707 | 49 | 8.0 | post / photo | "R*tarded Memefi Era On Solana / early access" |
| 30 | Ethics | [2096421589202170037](https://x.com/ethicslaunch/status/2096421589202170037) | 35,529 | 66 | 8.0 | post / text | "Launchpad szn." + 6 DEX tags |

What the top 30 have in common (share in top 30 vs share of all older posts): @mentions 77% vs 37%; **@MeteoraAG / meteora 33% vs 4%**; Solana 53% vs 30%; perps 33% vs 10%; stocks/RWA 30% vs 11%; backed/floor 17% vs 5%; launchpad 17% vs 5%; "live" 23% vs 9%; video 40% vs 13%; 281+ characters 40% vs 25%; 3+ line breaks 77% vs 49%; standalone posts 80% vs 63%. Almost none are self-replies (0%), emoji-heavy (7% vs 15%) or all-lowercase.

**Young posts (under 2 days) already far above their account's median:** ClawPump [2102149780524662950](https://x.com/clawpumptech/status/2102149780524662950) at 17.8x ("backed by @Pumpfun, @colosseum, & now Solana's @incubator", $200M volume, $42M ecosystem ATH); Perpspad [2102091595390636215](https://x.com/perpspadfun/status/2102091595390636215) at 9.0x ("Perpetual Dividends is now live… You hold, you get paid", 236 likes); Trends [2101955237053636764](https://x.com/trendsdotrun/status/2101955237053636764) at 7.4x (raid-like ratios); OTC [2102430179687596145](https://x.com/otcdotcash/status/2102430179687596145) at 2.7x ("Introducing @MeteoraAG smart launches", most RTs, quotes and bookmarks on the account).

### Top 3 per account

| Account | Post | Views | Likes | Score | Note |
|---|---|---:|---:|---:|---|
| LFOwn | [2100960214648258946](https://x.com/LFOWNDOTFUN/status/2100960214648258946) | 6,308 | 42 | 7.1 | Pinned 3-sentence positioning video |
| LFOwn | [2100929997229674988](https://x.com/LFOWNDOTFUN/status/2100929997229674988) | 3,737 | 36 | 4.2 | "ownership szn 🔥" quote of vesper792 |
| LFOwn | [2100887548809576706](https://x.com/LFOWNDOTFUN/status/2100887548809576706) | 3,731 | 33 | 4.2 | $LFOWN on DexScreener: 4 pools, $214k liquidity, $445k traded |
| Scribe | [2099714061554372749](https://x.com/Scribeonsol/status/2099714061554372749) | 93,967 | 290 | 9.5 | "$SCRIBE is live" + CA |
| Scribe | [2099837257955844394](https://x.com/Scribeonsol/status/2099837257955844394) | 56,772 | 180 | 5.7 | "Many of you… want buybacks and burns… being changed right now" |
| Scribe | [2099833864340304375](https://x.com/Scribeonsol/status/2099833864340304375) | 32,396 | 176 | 3.3 | "Keeper is now live… 80% of fees go back to holders in sol" |
| Purps | [2097567969022750946](https://x.com/buypurps/status/2097567969022750946) | 155,537 | 670 | 45.9 | V2 on DBC any-pair |
| Purps | [2096656066104668215](https://x.com/buypurps/status/2096656066104668215) | 110,849 | 579 | 32.7 | Walkthrough video |
| Purps | [2097555267244224970](https://x.com/buypurps/status/2097555267244224970) | 19,809 | 56 | 5.8 | "Status: working through a few issues" (V2-day spillover) |
| ClawPump | [2090141776535310837](https://x.com/clawpumptech/status/2090141776535310837) | 196,517 | 423 | 36.8 | AnsemHack open |
| ClawPump | [2061539553484132524](https://x.com/clawpumptech/status/2061539553484132524) | 119,259 | 319 | 22.3 | Squire integration video quote |
| ClawPump | [2086928251608277444](https://x.com/clawpumptech/status/2086928251608277444) | 115,488 | 278 | 21.6 | "Hey @blknoiz06" teaser |
| Ethics | [2098273607562780975](https://x.com/ethicslaunch/status/2098273607562780975) | 40,532 | 93 | 9.1 | "Any chain, any pair" roundup |
| Ethics | [2096421589202170037](https://x.com/ethicslaunch/status/2096421589202170037) | 35,529 | 66 | 8.0 | "Launchpad szn." |
| Ethics | [2096633218544161049](https://x.com/ethicslaunch/status/2096633218544161049) | 27,344 | 71 | 6.2 | PreStocks added as quote assets (13 bookmarks) |
| StonkOptions | [2099615539295572001](https://x.com/getstonkoptions/status/2099615539295572001) | 131,905 | 243 | 23.6 | Pinned launch video |
| StonkOptions | [2098274034915942633](https://x.com/getstonkoptions/status/2098274034915942633) | 27,155 | 106 | 4.9 | "They weren't supposed to get this call." teaser |
| StonkOptions | [2098811745699537352](https://x.com/getstonkoptions/status/2098811745699537352) | 23,453 | 69 | 4.2 | "Four years is a long time to wait for a better deal." |
| OneOnly | [2098757099467559299](https://x.com/oneonlylol/status/2098757099467559299) | 6,707 | 49 | 8.0 | Early-access teaser |
| OneOnly | [2101406619141570843](https://x.com/oneonlylol/status/2101406619141570843) | 5,607 | 34 | 6.7 | Pinned "Meet oneonly.lol… Built on @MeteoraAG DBC" |
| OneOnly | [2101011913085706535](https://x.com/oneonlylol/status/2101011913085706535) | 1,691 | 17 | 2.0 | Quote of Ansem: "one ticker. no copies." |
| OTC Desks | [2099983122272055628](https://x.com/otcdotcash/status/2099983122272055628) | 90,205 | 435 | 6.1 | Pinned suspension notice |
| OTC Desks | [2101686092088987862](https://x.com/otcdotcash/status/2101686092088987862) | 38,165 | 394 | 2.6 | Dated "$OTC Protocol Update" changelog with bullets |
| OTC Desks | [2100856223931183501](https://x.com/otcdotcash/status/2100856223931183501) | 37,908 | 349 | 2.6 | Founder "updates tomorrow" teaser |
| Perpspad | [2097686544190431547](https://x.com/perpspadfun/status/2097686544190431547) | 142,908 | 166 | 54.8 | DBC explainer |
| Perpspad | [2099580418110472293](https://x.com/perpspadfun/status/2099580418110472293) | 59,747 | 336 | 22.9 | Relaunch video |
| Perpspad | [2081774965779554737](https://x.com/perpspadfun/status/2081774965779554737) | 48,518 | 108 | 18.6 | "Powered by @MeteoraAG" self-quote |
| RevShare | [2078512538614943844](https://x.com/revshare_app/status/2078512538614943844) | 25,052 | 59 | 13.8 | Robinhood Chain + $1k bounty |
| RevShare | [1954597150236504468](https://x.com/revshare_app/status/1954597150236504468) | 17,294 | 85 | 9.5 | PreStocks contests |
| RevShare | [1990244628545544301](https://x.com/revshare_app/status/1990244628545544301) | 12,976 | 109 | 7.2 | "$SECURE… just reached 780k market cap" (most-liked) |
| Trends | [2098767236387508526](https://x.com/trendsdotrun/status/2098767236387508526) | 73,989 | 133 | 28.9 | Launch video |
| Trends | [2100699652484149746](https://x.com/trendsdotrun/status/2100699652484149746) | 17,497 | 82 | 6.8 | Pinned launch livestream |
| Trends | [2095443807584264489](https://x.com/trendsdotrun/status/2095443807584264489) | 17,071 | 340 | 6.7 | "You built it. Now it's time to market it." (raid-like ratios) |

---

## 7. Pad profiles

Short versions. Ratios are to the account's own median unless a time-normalized measure is named.

### 7.1 Perpspad (@perpspadfun) — the best-documented breakout

- **Positioning.** "Launch coins on @Solana, backed by perps, stocks and RWA." Coin fees fund a leveraged perp on @PhoenixTrade; profits go to buyback-and-burn or LP, later "Perpetual Dividends" to holders. Coins can be quoted in tokenized stocks. Moved from DLMM to Meteora DBC on 2026-09-09. Slogans: "Trade memes backed by perps", "PERPIFY EVERYTHING".
- **Growth.** Monthly median views 1,430 (Jul), 2,269 (Aug), 5,282 (Sep), so relWin is used below.
- **Pillars (share, relWin).** Vibes one-liners 19.4% (0.81); product launch / "you can now" 14.1% (1.37); roadmap / teasers 14.1% (0.98); milestones / burn stats 7.9% (1.33); long-form flywheel explainers 4.8% (1.39); ops / incident 4.4% (1.10); KOL tag bait 4.4% (0.74); $PERPSPAD shill 4.4% (0.70).
- **Best posts.** The DBC explainer quoting Meteora (142.9k, relWin 25.75, most bookmarks); the relaunch video (59.7k, 336 likes, pinned); the "powered by Meteora DLMM" self-quote (48.5k, relWin 22.39); the @ethtwit endorsement quote (39.1k); "Two months in review… How we use DBC" (28.1k, relWin 4.4); Jupiter launchpad listing (12.5k, 206 likes).
- **Tactics.** A coordinated "narrative week" (Sep 9–14: DBC explainer, endorsement quote, receipts, two-month review, T-24h, slogan, reveal video, Jupiter listing): four posts above 25k in six days. Self-quotes of launch posts with a second angle. Receipts with exact counts ("212 additions… 50 SOL paired with 3,063,762 PERPSPAD", relWin 2.67 on endorsement day).
- **What failed.** Contentless "gm" / "Big week" (relWin 0.35–0.89); a manual "RT" copy of its own post (relWin 0.09); a "24 hours" teaser that slipped a week (0.35); the second near-identical pair post of an evening (0.40); a typo'd milestone one-liner on a 6-post day (0.45).

### 7.2 Purps (@buypurps) — ship-and-quote

- **Positioning.** "Launch tokens backed by perps or paired with anything." Started on Hyperliquid perps; V2 on Meteora DBC (2026-09-09) with 925 pairable tokens and fee routing to perps, holder airdrops or the creator.
- **Pillars (share, ratio).** Feature launches 24.1% (1.28x); thread-detail self-replies 21.7% (0.34x); single-pair listings 15.7% (0.88x); status / incident 9.6% (1.22x); integrations 8.4% (1.87x); metrics / proof 8.4% (1.88x); product intro video 3.6% (4.28x).
- **Best posts.** V2 quote of Meteora (155.5k, 45.9x median); walkthrough video (110.8k, 48 bookmarks); "Introducing Creator Incentives… Get paid to create" (12.1k, 85 replies); "five days since introducing Meteora DBC pools… $105,000 paid out to holders" (12.0k).
- **Tactics.** Turn a user's request into a shipped feature and quote the requester ("NEW: pair your coins with $PURPS", 12.5k). "Status:" incident post followed by a quoted "Update: mostly fixed". Bulk asset drops ("WBTC, ETH… + 800 more", 8.7k) instead of single tickers.
- **What failed.** The single-ticker "New pair has been added: $X, issued by @Backpack" template, 10 copies, falling from about 3,400 to under 1,000 (the last three are young). "Coming" teasers without a visual (1,597; 1,874) vs the shipped version with an image (6,437). Fast quotes without product news (Hyperliquid $PONS 12 minutes later: 2,310).

### 7.3 OTC Desks (@otcdotcash) — crisis content and a competitor contrast

- **Positioning.** Yield-bearing NFTs ("Desks") plus, from Sep 22, a Meteora DBC launchpad with "1,300 newly added custom pairs", where rewards arrive as LP fees in the underlying stock: "ZERO sell pressure", set explicitly against @LaunchOnSF / Stonk's transfer tax.
- **Context.** Backup account after @otc_labs was suspended. 20 older posts only; all 13 posts from Sep 22–23 are a day old or less.
- **Pillars.** Suspension / status updates 25% (1.24x); founder build-in-public 22.2% (1.09x); product launches 22.2% (0.80x, young); community logistics 13.9% (1.19x).
- **Best posts.** Pinned suspension notice (90.2k; oldest and pinned); "Introducing @MeteoraAG smart launches" with bullets and numbers (39.5k in under a day, 136 RTs, 21 bookmarks; MeteoraEco replied); dated "$OTC Protocol Update" with image (38.2k); Daily Recap "$2M cumulative volume… 51 SOL bought back and burned" (8.5k, 302 likes within hours).
- **Format.** Bold one-line hook, 3–5 "- " bullets with numbers, image card, long explanation in a self-reply. Photo posts median 28,462 (n=4) vs 14,613 text among top-level posts. Self-replies median 5,106.
- **What failed.** "Could someone create an X Chat?" (0.28x), "Big week, let's win." as a self-reply (0.20x), a UI changelog buried as thread item 3 (0.20x).

### 7.4 RevShare (@revshare_app) — the long-running pad, a year of data

- **Positioning.** Tax / reflection launchpad: creators pick a 1–10% fee and route a share to holders. Multichain from Oct 2025; RWA/stock quotes from Sep 2026; calls itself "Meteora partners" in its $REVS migration post but never tagged @MeteoraAG in 372 posts.
- **Reach declines over time** (2025 median 2,082, 2026 median 1,401), so the local-median *rel* is used.
- **Pillars (share, rel).** Daily top-volume leaderboard 23.9% (0.97); ecosystem project shoutouts 18.5% (1.29); product updates 16.1% (0.91); pitch / fee comparison 10.5% (0.94); contests 4.3% (**1.66**, best); chain expansion 4.3% (1.43); bear-market commentary 4.3% (0.72); education 3.5% (0.68).
- **Best posts.** PreStocks co-branded contests ($10k/$1k prizes, 17.3k); "$SECURE… 780k market cap" (13.0k, 109 likes) and its 3-day follow-up at $2M (99 likes); "$62,000 has already been paid out" to holders (12.8k); a $250–350 weekly contest whose entry rule is "comment below and share" (11.9k, 56 replies); Dexscreener-boost crowdfunding that "works for all tokens" (9.1k, rel 6.4); "Imagine… $1M volume, you earn $100K in fees" (4.7k, rel 2.05).
- **What failed.** Both Meteora stock-quote announcements as bare one-liners (DAMM v2 1,393; DBC 1,259; no example token, no number, no tag). Bare links (rel 0.35). Mechanism explainers without numbers (721). "We keep building" (709). Shoutouts of tokens without an active community (Apollo AI: 0 RTs). Thread tails (rel 0.35).

### 7.5 Ethics (@ethicslaunch) — the repeatable positioning roundup

- **Positioning.** "Launch token backed by real market on any chain." RWA/xStocks-quoted pad on Meteora, then multichain (Uniswap V4, Sushi, Pancake) and "universal launchpad" with 80+ quote assets, Multipair and Ethics Trust. States its stack: "DBC for discovery. DAMMv2 for instant books. Stocks as the quote."
- **Pillars (share, ratio).** Product updates 17.4% (0.92x); new quote pairs 15.1% (1.09x); multichain 11.6% (1.63x); newsjack quotes 10.5% (0.83x); emoji / "Let's go" reaction quotes 9.3% (0.60x); **positioning roundups 8.1% (3.09x)**; teasers 7.0% (1.69x); credibility self-replies 7.0% (0.33x).
- **Best posts.** "Any chain, any pair" roundup with 5 DEX tags (40.5k); "Launchpad szn." (35.5k); PreStocks added as quotes (27.3k, 13 bookmarks); DAMM v2 Instant-mode explainer with exact splits (22.1k, 11 bookmarks); "Built on @MeteoraAG. A launch backed by a real market." linking an X Article (17.8k); DBC update with "~0.02 SOL / ~$3K initial mcap / ~$27K migration mcap" (10.5k, 79 likes).
- **Tactics.** [New]/[Live]/[Upcoming] prefixes (about 2x median likes); mock-poll teasers ("Should we release Multipair…?", 77 likes); a novel asset class per post (Chiliz fan tokens 19.9k; the Arsenal repeat got 1,771).
- **What failed.** Emoji-only partner quotes (0.57x); contract-link self-replies (about 0.2–0.4x); repeat chain announcements late at night (1,678).

### 7.6 Trends (@trendsdotrun) — a sequenced launch night

- **Positioning.** SocialFi app and launchpad on Meteora DBC: tokenize any creator or post; creator fees become TikTok/Kick gifts. iOS first.
- **Pillars (share, ratio).** Feature launches 24.7% (0.94x); livestream / Spaces promos 18.5% (0.92x); hype teasers 13.6% (1.13x); milestones 8.6% (0.58x, mature 0.72x); token / buyback 7.4% (1.59x); partner quotes (MeteoraEco, @solana) 7.4% (1.32x).
- **Best posts.** Launch video "Powered by @MeteoraAG DBC" (74.0k; amplified by MeteoraEco and the @solana newsletter, paid reach possible); tokenized-stocks custom pairs (14.3k, 6.35x); "Introducing $TRENDS… flywheel" (8.3k); "Introducing callouts… posted directly to @X" (5.4k; @solana replied 🔥).
- **Tactics.** Stream → token (+14 min) → Streamflow lock link ("Locked!", 3.9k) → solscan buyback tx ("First buyback of many.", 3.3k). A sub-account (@trendsecosystem) for user stories. Crypto-news coverage (WhaleInsider "JUST IN").
- **What failed.** Self-replies (median 600); small daily metrics ("1 token bonded", 1,028); quoting a third-party schedule (1,126). Superlatives ("fastest-growing", "biggest update yet" 4 times in 15 hours) did not lift reach (1.12x).

### 7.7 ClawPump (@clawpumptech) — KOL-branded events and X Articles

- **Positioning.** "The capital market for agents on @solana & @robinhoodcrypto chain. Backed by @pumpfun, @colosseum, & @incubator." Tokenized AI agents with an MCP/CLI harness. In September: "Stocknized Agents" paired with stocks on Meteora DBC, pitched at the Stocklana track. **A direct competitor in the same hackathon track.**
- **Pillars (share, ratio).** Ecosystem project spotlights 19.6% (1.22x); meme / vibe one-liners 17.5% (0.38x); product launches 14.3% (1.26x); hackathon / bounty 13.6% (1.56x); token shill 12.1% (0.87x); X Articles 1.4% (13.78x).
- **Best posts.** AnsemHack open (196.5k, 77 bookmarks); Squire integration video quote (119.3k); "Hey @blknoiz06 do you know what this is?" (115.5k, 104 replies); "backed by @Pumpfun, @colosseum, & now Solana's @incubator… $200M" (95.0k, young); MCP v2 with `npx` command (82.8k).
- **Tactics.** A KOL relationship built by giving his token utility first ($ANSEM as an inference payment method, 39.7k), then a co-branded hackathon arc: teaser → date drop → open → prize raises → deadline extension, each its own post. Credibility stacking (named backers plus three metrics).
- **Stock angle.** Their September stock/RWA posts ran about 1.06x their September median; the best "Stocknized" post got 20.5k. Their quote of Meteora's any-pair announcement got only 5,292.
- **What failed.** In-joke memes ("clanker" 0.24x); 5-word quotes without media (602); strong metrics without media or tags on a 5-post day (1,164).

### 7.8 StonkOptions (@getstonkoptions) — persona and a named outcome

- **Positioning.** "Launch stock-paired tokens that pay verified employees in their employer's tokenized stock." A Star sub-product styled as "The Internet's Benefits Department" (HR / labor-revolution parody). Never uses launchpad, DBC or bonding-curve language.
- **Pillars (share, ratio).** Pre-launch teaser videos 20% (3.15x); rewards proof / employer call-outs 13.3% (1.81x); quotes of @solana 16.7% (1.59x); daily static brand memes 20% (0.30x); bare-link self-replies 10% (0.20x).
- **Best posts.** Pinned launch video (131.9k; @solana spotlight 36 minutes later); six cinematic teasers over 3 days (pillar median 14,896.5); "BREAKING: Verified @McDonalds employees can claim up to $12K in $MCD" (17.9k, best non-video); "$22.9K in stock rewards waiting for… @McDonalds, @amazon and @Apple" (11.8k); first real payout to a McDonald's France employee, "~$250… Who's next?" (5.3k, 1.34% engagement).
- **What failed.** After launch, a scheduled daily static meme at 15:00 UTC: reach about 0.3x, although like rates were the account's best. The @MeteoraAG / xStocks partner tag buried in a reply (0.42x). Quoting the @solana newsletter a second time (0.56x; the first quote got 1.59x).

### 7.9 Scribe (@Scribeonsol) — launch-day blitz by a solo dev

- **Positioning.** Memecoin and NFT launchpad that inscribes media into the mint through 4KB v1 transactions ("If Scribe disappeared tomorrow, the page is still on-chain"), with a keeper that buys back and burns $SCRIBE. Stock pairing (70+ pairs) from Sep 18; pump.fun expansion pinned.
- **Pillars (share, relday).** Feature ships 34.2% (1.17x); tokenomics / keeper / burn 13.2% (1.70x); ops / fixes 15.8% (0.91x); proof / explainers 13.2% (0.74x); partner tags 13.2% (0.65x).
- **Best posts.** "$SCRIBE is live" + CA (94.0k); the keeper chain in 25 minutes, post → "you asked, changing it now" → "done" (32.4k + 56.8k + 31.3k); "3D Models can now be inscribed" (32.2k); "A coin that is a website" (25.2k); burns dashboard (14.3k, best after day 1); stock pairing "70+ pairs… paired to the company's stock" (11.7k, 2.06x its day, n=1).
- **What failed.** "@MagicEden… wen scribe integration?" (254); tag-only "@MeteoraAG x @Scribeonsol x @sunrise 🤝" (591); "More stock pairs coming" (3,677); a devnet tx link as proof (0.20x its day); "Update coming" beaten 2.7x by its own "now live" 14 minutes later.

### 7.10 OneOnly (@oneonlylol) — one enemy word, fast quote-jacks

- **Positioning.** "One Ticker, No copies." A ticker can exist only once on the pad; half of revenue to $ONEONLY buybacks. "Built on @MeteoraAG DBC." Never pitches stocks (mentions $STONK only as a competitor).
- **Pillars (share, ratio).** Anti-vamp quote-jacks 37.1% (1.00x); KOL meme art 28.6% (0.75x); launch / product 11.4% (3.94x); ticker-dispute newsjacks 8.6% (1.57x).
- **Best posts.** Early-access teaser (6.7k); pinned "Meet oneonly.lol… No copies. No confusion. No vampire forks. Built on @MeteoraAG DBC" (5.6k); "100k$+ volume in a day" (1.5k); "Which $JEANPHIL is real?" (1.3k).
- **Tactics.** Fast quotes (<6h) of CT complaints median 1,019.5 vs 653.5 for slow ones. A competitor card "$PUMP… $STONK… $ONEONLY: killed the vamps" had the best engagement rate (6.6%) but low reach (561).
- **What failed.** Untagged or tagged KOL caricatures (0.75x; tags added nothing); a Clarity Act newsjack (416); vague quote replies ("OneOnly is the new meta", 404).

### 7.11 LFOwn (@LFOWNDOTFUN) — numbers-first, wave-dependent

- **Positioning.** "Every meme is paired with an ownership coin from @MetaDAOProject, not $SOL… Hold the meme, earn the ownership coin. Paid every hour, on-chain." Built on the DBC SDK; graduation to DAMM v2.
- **Attention wave.** Sep 17 17:00 – Sep 18 (14 posts, median 2,915) vs about 750 before, tied to a $LFOWN pump and KOL posts. Excluding it (n=29 older top-level posts, median 756): metrics 1.59x, contests 1.35x, new pairs 1.0x, explainers 0.88x, reactions 0.85x, coin spotlights 0.58x.
- **Best posts.** Pinned positioning video (6.3k); "We counted. 105 coins. 20 pairs… The pair you launch against matters." (3.1k); a serialized hero coin, $HAN: 20% of curve (3.1k), 50%, graduated (2.6k, 15 replies), "Hold $HAN, receive $SOLO… 239 $SOLO sent to 44 wallets" (2.9k); "Just shipped!" 8 minutes after a user asked for a share button (3.3k).
- **What failed.** Link-only "Launch now" self-replies (median 304); the only tokenized-stocks post (419, 0.47x, n=1); governance inside-baseball (429); templated graduation cards off-peak (504; the same template got 1,371 on a wave day).

---

## 8. What fails, across accounts

| Pattern | Evidence |
|---|---|
| Thread tails / self-replies | Score 0.32, 0/9 accounts; Ethics 0.21x, Purps 0.34x, RevShare rel 0.35, Scribe 0.41x day, Trends 0.27x |
| Link-only replies and bare links | LFOwn 304 (0.34x); StonkOptions 957; RevShare bare links rel 0.35–0.93; link card without media 0.68 |
| Contentless vibe posts | Perpspad posts opening with "gm" 0.80 (n=11), "big week" 0.75 (n=8) (relWin); ClawPump memes 0.38x, "clanker" 0.24x; OTC "Big week, let's win." 0.20x |
| Emoji-only or tag-only quotes | Ethics 0.57x; Scribe "🤝" handshake 591 views |
| "Wen integration" / admin asks | Scribe → @MagicEden 254; OTC "Could someone create an X Chat?" 0.28x |
| Vague teasers | Scribe "Update coming" 4,563 vs "now live" 12,354; Purps "coming" 1,597–1,874 vs shipped 6,437; Perpspad "Big updates today Stay tuned" relWin 0.43 |
| Broken countdowns | Perpspad "24 hours" that slipped a week, relWin 0.35 |
| Repeated one-ticker listings | Purps single-pair template fell from about 3,400 to under 1,000; Perpspad later same-evening pair posts relWin 0.40–0.74 |
| Quoting big posts with nothing to add | Perpspad quotes of 50k+ posts median relWin 0.93; Purps "memefi" 2,244; OneOnly captured 0.5–0.9% of source views |
| Capability one-liners with no example | RevShare's DBC stock-quote post 1,259 and DAMM v2 1,393; Scribe "v1 transaction" 0.32x day |
| Tokenomics buried in replies | StonkOptions $STAR buyback reply 1,820 (1.4% of the head post) |
| All-lowercase text | Score 0.49 (1/4 accounts) |

---

## 9. Implications for StockFloor

**Where we stand.** Stock-quoted DBC launches are common: Perpspad, Purps, Ethics, OTC Desks, Scribe, ClawPump and StonkOptions all post about them, and ClawPump pitches "Stocknized Agents" in the same Stocklana track. None of the 11 claims a redeemable floor. The words closest to ours already test well ("backed/floor/NAV/treasury" balanced lift 1.70x, 5/6 accounts; "launchpad" 2.27x; "stock/RWA" 1.39x), while "pair with a stock" alone does not (ClawPump about 1.06x in-month; LFOwn 0.47x, n=1; RevShare's bare stock-quote posts 1,259–1,393). **Lead with the floor and a live number; the stock is the backing, not the headline.**

### What to post

1. **One definitive explainer post** (800+ characters, with a diagram or 30–60s video): a coin whose curve is quoted in SPYx; the migration fee goes to a vault PDA; holders can redeem against it; the floor per token in USD. Model: Perpspad's DBC explainer (142.9k, relWin 25.75) and Ethics' DAMM v2 explainer (22.1k, 11 bookmarks). Mirror it as an X Article linked from a short "Built on @MeteoraAG" header (Ethics 17.8k; ClawPump Articles are high-variance).
2. **A pinned 3-sentence positioning post with a short video**: what it is, what backs it instead of SOL, what the holder gets. Model: LFOwn's pinned post (its #1), OneOnly's "Meet…" (6.66x), Purps' walkthrough (110.8k). Draft: "Every coin launched here has a floor backed by tokenized stocks. The floor is funded at graduation and held by a program, not a wallet. Redeem against it on-chain, any time."
3. **Receipts as a series, with numbers in the first line**: vault SPYx balance, floor price per token, migration fee harvested (with the transaction), first redemption. Each is its own short post with an explorer link, timed to announcement days. Models: Trends' lock and buyback-tx posts (1.45–1.73x on launch night), OTC's daily recap, Perpspad's receipts (milestones relWin 1.33). Don't expect the link itself to add reach (Purps' dashboard-link posts 0.93x).
4. **A floor dashboard or public "floor checker"** as a recurring link, like Scribe's burns page (its best post after day 1). RevShare's tool that "works for all tokens" reached rel 6.4.
5. **Holder-benefit line in plain words**, mechanics in a follow-up self-quote: "Your bag has a floor you can redeem at." Models: "You hold, you get paid" (236 likes, young), "Hold $HAN, receive $SOLO".
6. **A creator-side post**: the floor makes a coin easier to buy. Purps' "Get paid to create" drew 85 replies.
7. **One hero launch, serialized**: curve %, halfway, graduation, floor funded, first redeem, with the creator named (LFOwn's $HAN arc). A hypothesis: LFOwn's arc peaked only inside its attention wave.
8. **A comparison card** against transfer-tax and LP-fee-reward models (OTC, RevShare) and against "pair with anything" pads: "they pay rewards, we hold a floor". OneOnly's competitor card had the account's best engagement rate but low reach; OTC's contrast posts are young.

### How to post

- **Format:** video or image on every substantive post (video 1.51, photo 1.12, text-only 0.89). 200+ characters with line breaks or 3–5 bullets with numbers. Standalone posts; follow-ups as self-quotes, never thread replies. Link in the main post or in the bio and pin, not in a reply. No all-lowercase, no hashtags.
- **Tags:** @MeteoraAG and @MeteoraEco on real DBC milestones (launch, first graduation, first migration fee into the vault), not as decoration. Aim for 2 relevant tags. Tag the stock issuer (xStocks / Backed) when the post is about a new backing asset, and expect novelty, not the tag, to do the work. @solana as a tag is neutral; aim instead for a @solana spotlight or a slot in its weekly newsletter (Trends made it twice), using the Stocklana hackathon and the tokenized-equities narrative as the hook. List on Jupiter's launchpad page and on launch.meteora.ag, then post the listing.
- **Pre-write the partner quote.** Have a long "how we use it" post ready for the next Meteora, xStocks or Backed announcement that concerns a feature we use (SPYx quotes, DBC migration fees, DAMM v2), and publish within hours, only if we can say "live now" with a link.
- **Launch week as one arc:** 1–3 teasers naming the deliverable (keep every countdown), then the reveal video with infra tags (pin it), the Jupiter / Meteora listing the same day, then receipts over the next days. Plan the second and third catalysts before launch (first curve completion, first vault harvest, first redeem): StonkOptions' daily median fell from 10.8k to under 2k within a week because it had none. Batch small updates into one post instead of 5 near-identical ones.
- **Cadence on normal days:** 1–2 substantive posts, first post of the day carries the news. 09–11 UTC and Fridays are slightly better, 15–17 UTC slightly worse, but partner timing overrides the clock.
- **Hackathon posts** should carry the substance (the explainer and live numbers), not rely on the event tag (Perpspad's STOCKLANA quote: relWin 0.82; only its EasyA entry broke out).
- **Quote third-party posts about us within minutes** (Perpspad's @ethtwit quote 18 minutes later: 39.1k; StonkOptions' emoji quotes of @solana's replies captured 30–56% of their views). Watch CT threads about stock-paired launchpads (KookCapitalLLC, DeltaXtc, vesper792) and answer with the specific variant: a floor, not just a pair.
- **Name-agnostic copy.** Build slogans and the sign-off around the mechanism ("Every coin has a floor."), not the brand name, so a rename (e.g. to Plinto) keeps the narrative. RevShare's brand did not carry posts; numbers, prizes and partner tags did.
- **Protect the account.** OTC lost its main handle to mass reporting. Reserve a backup handle and an off-X channel on day one.
- **Treat competitor peaks skeptically.** Trends, RevShare, Ethics and OneOnly show signs of paid or coordinated reach. Plan against organic medians: about 1–3k views per post for a 2k-follower account in its first weeks, with launch posts at 5–30x.

### Hard stop

Posting from any account, contacting Meteora, Solana or KOLs, and publishing anything are hard stops under the project rules (CLAUDE.md, rule 4). This report is a plan; nothing has been posted.

---

## 10. Caveats

- Views are impressions; sources of reach are not observable. Reposts by tagged partners are inferred from timing unless a repost or reply is in the data.
- Replies to other accounts are missing everywhere. ClawPump's data also lacks reposts and self-replies, and covers about 3% of its lifetime.
- Five of the 11 accounts are 1–3 weeks old, and their numbers describe launches. Perpspad grew fast and RevShare declined, so raw medians favor late and early posts respectively; use relWin and rel.
- 76 posts were under 2 days old at scrape time and are excluded from cross-account lifts; where cited, they are marked young. Pinned posts keep collecting profile-visit views (Perpspad relaunch video, Purps Creator Authority, OTC suspension notice, StonkOptions launch, OneOnly "Meet", LFOwn positioning, RevShare migration, Trends livestream, Scribe pump.fun post).
- Pillars are manual labels, one per post. Keyword matches are regex-based and some are noisy ("solana" matches `solana:<mint>` strings; "stock" matches project names on RevShare; "win" matches "winner").
- Many per-account cells have n ≤ 10 and overlap on the same breakout posts. Treat them as directional.
