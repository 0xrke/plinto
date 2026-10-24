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
