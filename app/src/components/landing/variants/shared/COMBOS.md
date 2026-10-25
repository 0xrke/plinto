# Combos 21–27: what the founder's review of 1–20 asked for

Variants 21–27 are new treatments. Each mixes the favourites from the founder's review of
`/lab/story/1…20`. They follow `README.md` (harness rules) and `BRAND.md` (site style). This page
records the review, so every combo answers it.

## The review, ranked

| Rank | Variant | What the founder said |
| --- | --- | --- |
| 1 | **11** Editorial · site | "Good, the leader so far, I like it the most." |
| 1.2 | **20** Playful · site | "Probably the cleanest of all the similar ones." |
| 1.5 | **18** Cause & effect · site | "Very good: the chart plus the sidebar on the right shows everything clearly." |
| 2 | **14** Card stack · site | "Looks good, but I don't like the cards." |
| 3 | **15** Blocks · site | "Not bad." |
| 4 | **16** Reservoir · site | Not bad, but the split is shown best in 1 and 3. |
| 5 | **17** Swiss mono · site | Same note about the split. |
| top | **19** Horizontal tape · site | "Maybe the cleanest of all, but a bit buggy." |
| — | **13** Cinematic · site | "Very similar to 12 but looks cleaner. I like it." |
| — | **12** Trading desk · site | "OK overall, but something is missing." |
| liked | 1, 3, 5, 9 | The layout and the idea of the presentation. |
| liked | 4 | The layout, but not the cards (or the way they replace each other), and not the horizontal split. |
| liked | 8, 10 | The layout and the idea, but the split is shown better in 1 and 3. |

## The rules that follow from it

1. **The split is a vertical column, as in 1 and 3.** It is never a horizontal bar.
   - At the split beat the raise is one tall stacked column on the chart, in dollars on the chart's
     own y axis.
   - The **floor** share sits at the bottom (mint, `CHART.floor`). The **market** share is above it
     (iris, `CHART.market`), and the **fees** (creator and platform, butter, `CHART.fees`) are on top.
   - Each segment is labelled directly with its name and percent ("Floor 50%", "Market 40%",
     "Fees 5% · 5%"), large enough to read at a glance (at least 12px on desktop).
   - The floor segment then visibly settles into the floor: it slides or drops onto the floor slab
     that the staircase starts from. It must be obvious which part is the floor and which isn't.
   - The column is wide and saturated enough to read as the main object of the beat. Variant 3
     (`v03-cinematic/Scene.tsx`, `RaiseColumn` / `SplitLabels`) is the reference; variant 11's
     column is too thin and dim.
2. **No card decks.** Captions don't slide over each other, and cards don't replace each other.
   Captions scroll past (as in 11) or change in place.
3. **Clean.** Less chrome, fewer borders, generous white space, one midnight chart card per view.
   The chart is large: on a 1440×900 screen it should take most of the stage column's height.
4. **No bugs.** Nothing overlaps, no label clips at an edge, no jumps or flicker when scrolling
   either way, nothing hidden at 390×844, and no horizontal scroll.

## The combos

| n | Folder | Main source | Mix |
| --- | --- | --- | --- |
| 21 | `v21-editorial-plus` | 11 | A bigger chart and the 1/3 split column, cleaner |
| 22 | `v22-editorial-ledger` | 11 + 18 | The editorial chart and captions, with 18's vault ledger sidebar |
| 23 | `v23-clean-steps` | 20 | 20's clean numbered bubbles, dots and tiles, with the 1/3 split column |
| 24 | `v24-cinematic-clean` | 13 | The wide film frame and camera, one caption line under it, a labelled split column |
| 25 | `v25-one-panel` | 14 | 14's framed panel (header, rail, chart beside caption and tiles), caption changes in place, no deck |
| 26 | `v26-blocks-clean` | 15 | The split column's floor part breaks into blocks that become the staircase |
| 27 | `v27-tape-fixed` | 19 | 19 cleaned and with its glitches fixed, with a vertical split column |

Each combo lives in its own folder. Copy code from its sources into the folder and change the
copy; never edit another variant's folder or `shared/`.

## Round 2 review of 21–27 (2026-10-25)

All seven look decent; the founder picked these points.

| n | Liked | Disliked |
| --- | --- | --- |
| 21 | Chart on the left, a ribbon of step captions on the right that changes as you scroll | The "In this story" index block: useful, but big and pointless in this form; make it a horizontal step line like 24, 25, 27. The "Your $100 now" / "Floor pays back" tiles are not prominent; they belong somewhere visible, as in 22 and 25 |
| 22 | — | Candidate to drop: too many numbers on the right, repeating what the chart shows; the step captions at the top are hard to look at, the chart and the sidebar take all the attention |
| 23 | — | The dotted step progress (24, 25, 27 do it better with line segments); the tiles are not prominent |
| 24 | Big, clear chart | The info strip under the frame gets lost against the chart |
| 25 | **Top-1 candidate.** Layout: title with the step progress bar on top, chart left, step caption right | The boxed panel look (21 without boxes looks better); no caption animation when the step changes, unlike 21 |
| 26 | Layout and the block chart; the animation looks great | The tiles sit at the bottom and go unnoticed; the "Floor blocks" tile has no point |
| 27 | Best and most descriptive chart: the step names along the top, the tooltip riding with the price dot | The caption at the bottom gets lost against the chart |

New rule for every variant: **show the change since listing**. Next to "Your $100 now" and "Floor
pays back", show how far each has moved since trading opened, for example "−61% since listing" and
"+4.8% since listing". Use `sinceListing(m, frame)` and `formatPctChange` from `shared`; both values
are null before trading opens, so show no percent then. The floor's change is never negative and
reads in the floor colour; the price's change is floor-green when up and coral (`risk`) when down,
never alarm red.

Shared conventions for round 2:
- **Step progress** is a row of line segments with the beat names under them (as in 24, 25, 27), not dots
  and not an index card.
- **Prominent metrics** means the two values are large (about 28–32px numbers on desktop), near the
  reader's eye line (beside or right above the chart, or riding with the price head as in 27), and
  never parked under the chart where the eye doesn't go.
- **Captions** must sit where the eye already is: beside the chart, or as a large heading right above
  it. Never a small line under a big chart.

| n | Round 2 change |
| --- | --- |
| 21 | Horizontal step line instead of the index card; prominent metrics; % since listing |
| 23 | Line-segment progress instead of dots; prominent metrics; % since listing |
| 24 | Caption and metrics move out of the bottom strip, to where the eye is; % since listing |
| 25 | % since listing (the layout stays: 28 is its new take) |
| 26 | Prominent metrics, "Floor blocks" tile removed; % since listing |
| 27 | Caption moves out from under the chart; % since listing |
| 28 | New: 25's layout in 21's unboxed style, with 21's caption animation; % since listing |
| 22 | Unchanged, candidate to drop |

## Round 3: the founder's principles (2026-10-25)

22 is dropped (its folder is deleted). Every new variant follows these four principles.

1. **Layout.** One of two:
   - **A, chart left + content right**, as in 21, 23, 25, 26 and 28;
   - **B, one big chart with the content on top**, as in 24 and 27.
2. **Step progress bar.** A row of line segments with beat names. It is mandatory: on its own it is
   "useless", but it shows progress, and that matters. It goes at the top, in the header above the
   chart.
3. **Beat sections on the chart, exactly as in 27.**
   - Read `v27-tape-fixed/FixedTape.tsx` and `fixedTape.module.css`, then copy and adapt them.
   - The chart is divided into one section per beat. A strip along the top of the chart card names
     each section ("01 Presale", "02 Split", …).
   - The current section is bright (white name, mint number). Past and next sections are readable, not
     ghostly.
   - Thin dividers separate the sections. The current section is highlighted.
   - With a camera that zooms or pans, the section names follow the camera. A name whose section is
     out of view hides; names never collide.
4. **Values as tooltips riding the price dot, exactly as in 27.**
   - "Your $100 now" and "Floor pays back", each with its % since listing, sit in tooltips that ride
     beside the price head on the chart. The founder rates these as the best way to show the values.
   - Do not repeat the two values elsewhere, so there are fewer numbers on screen.
   - The tooltips must stay inside the card and never cover the head dot or the bounce.

| n | Folder | Layout | Built from |
| --- | --- | --- | --- |
| 29 | `v29-split-tape` | A | 27's tape chart (sections, strip, riding tooltips) in the left column; 28's right column with 21's caption ribbon; step bar in the header |
| 30 | `v30-split-sections` | A | 28's whole-story chart split into 27-style sections, with 27's riding tooltips instead of the right-column metrics |
| 31 | `v31-blocks-sections` | A | 26's block floor and animation, with a step bar on top, 27-style sections and riding tooltips |
| 32 | `v32-film-sections` | B | 24's big film-frame chart and content on top, with 27-style sections and riding tooltips |

## Round 4: 20's size and 18's token supply (2026-10-25)

Finalists after round 3: **29** (layout A, tape chart; the founder's favourite), **31** (layout A,
block floor) and **32** (layout B). 29 and 31 differ only in the chart. On a second look the founder
also picked out two older variants:

- **18** is the only one that shows, besides the price and the floor, that the **token supply
  shrinks** (its vault ledger's "Token supply" row). Show that too.
- **20**: the chart size and the layout as a whole are the best. Bring every finalist to that size.
  20 itself is liked as it is: move its two value tiles from under the chart to the top and replace
  its dotted rail with the step bar, and it is a finalist too.

**20's size**, the target for every round-4 variant on desktop:
- The brand container (`BRAND_CLASS.container`: max-width 1120px, 48px side padding on desktop), not
  a wider page.
- The stage is the harness default: `--stage-h: min(640px, 82svh)` for everything in it (step bar,
  chart, anything stacked with it), vertically centred on the reading line; the chart and the
  content column split 6fr / 4fr with a 48px gap (layout A). On a 1440×900 screen 20's chart card is
  about 590×510px. Layout B keeps the same 1120px container and 640px stage, with the chart full
  width.
- White space around the stage is intended; it is what makes 20 calm.

**Token supply** (`supplyAt(m, frame)` and `TILE_SUPPLY` from `shared`):
- The share of the listing supply still outstanding (100% → 99.6% at the bounce's arbitrage redeem
  → 69.7% after the holders' exits) and its change since listing ("−30% since listing").
- Draw it as 18 does (`v18-cause-effect-site/LedgerPanel.tsx`, the supply row): a supply icon
  (`SupplyIcon` from `@/components/ui/icons`), the label, the value, the change, and a bar that
  shrinks with the burned part hatched. The burn is the event: when supply drops, the row lights up
  for a moment, as 18's rows do.
- One short line says why it matters: redeemed tokens are burned, so the same vault backs fewer
  tokens (floor = vault ÷ supply).
- Null before listing: show the row from listing on, or at 100% with "—" for the change.

| n | Folder | From | Change |
| --- | --- | --- | --- |
| 33 | `v33-playful-top` | 20 | Value tiles above the chart, line-segment step bar with names, a token-supply tile, % since listing |
| 34 | `v34-tape-compact` | 29 | 20's size; token supply in the right column under the caption |
| 35 | `v35-blocks-compact` | 31 | 20's size; token supply in the right column under the caption |
| 36 | `v36-film-compact` | 32 | 20's size; token supply in the content on top |
