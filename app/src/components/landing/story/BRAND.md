# Looking native: the Plinto style for story variants 11–20

Variants 11–20 keep each original's idea, composition and motion, but they must look like they
belong to the landing (`/`) and the token page (`/app/t/…`). This page lists the rules. The tokens
live in `app/src/app/globals.css` (`@theme`). The palette as code is `./brand.ts`, and the chart card
is `./BrandChartFrame.tsx`. Import both from `../shared`.

Reference screens (1440×900 and 390×844): the landing hero, the "Set the split" sandbox
(`landing/lab/SplitSandbox.tsx`), the current story (`landing/lab/LaunchStory.tsx`, `StoryChart.tsx`,
`story.module.css`), and the token page (`token/PriceChartCard.tsx`, `FloorMeter.tsx`, `TradeBits.tsx`,
the `MidnightCard` redeem panel).

## 1. The look in one paragraph

The landing is a white page with a 1120px content column. Display type is big and tight Outfit, and
body text is Plus Jakarta Sans. The surfaces are soft and rounded: cloud (`#f7f6fe`) panels and white
cards with violet-tinted shadows. There is exactly **one midnight card per view**, and it carries the
chart or the number that matters. Inside it the price is white, the floor is mint, and the arbitrage
line and bounce are rose. On light grounds the floor is teal-green (`floor`), and risk is coral on a
rose hatch, never alarm red. Accents are sparse: the butter "Illustration" pill, violet links, and the
floor-green primary button. Motion is calm and scroll-scrubbed. Nothing bounces for fun or loops.

## 2. Page and layout

| Thing | Rule |
| --- | --- |
| Page ground | The variant's root is full-width **white**: `BRAND_CLASS.page` (`bg-surface text-ink`), like `Landing.tsx`. The lab layout's pastel wash may show only above the variant. Don't add your own gradient. |
| Column | `BRAND_CLASS.container` (`mx-auto max-w-[1120px] px-5 sm:px-10 lg:px-12`). Phones get at least a 16–20px gutter. |
| Section title | `<h2 className="heading text-ink sm:text-[28px]">{STORY_TITLE}</h2>`, optionally followed by a `chip` ("Floor share **50%**"), as in `LaunchStory`. |
| Wide layout (≥1024px) | Chart on the left (about 6fr) and captions on the right (about 4fr), with a 48px gap. The sticky stage is at most `min(640px, 82svh)` tall and vertically centred. |
| Phone layout (390×844) | The sticky stage is on top, at most `min(55svh, 480px)` tall. The caption card sticks just under it. No horizontal scroll: give the root `overflow-x: clip`. |
| Spacing | Use the 4px scale: 8 or 12px between tiles, 16–24px inside cards (`p-4`/`p-6`/`p-7`), and 40–56px of section padding. |

## 3. Surfaces

| Surface | Class / component | Radius | Shadow | Use for |
| --- | --- | --- | --- | --- |
| Midnight chart card | `BrandChartFrame` (`rounded-tile bg-midnight`) | 24 | none | The chart, film frame, tank or tape. One per view. |
| Midnight feature card | `MidnightCard` + `MidnightValue` (`card-midnight`) | 32 | none | A single big number ("Redeem $36.87"), optionally with a butter `NotchedCta`. |
| White card | `card` | 28 | `--shadow-card` | Stacked beat cards, panels, ledgers. Sits on white or cloud. |
| Cloud panel | `rounded-card bg-cloud` (`BRAND_CLASS.panel`) | 28 | none | A group container, like the split sandbox's panel. |
| White tile | `tile` | 24 | `--shadow-tile` | Count or phase tiles on a cloud panel (`CountTile`). |
| Soft tiles | `tile-soft`, `tile-floor`, `tile-risk`, `tile-presale`, `tile-lilac` | 20 | none | Stat tiles inside a card (`StatTile`). |
| Story tiles | `BrandTiles` | 10 | none | "Your $100 now" (cloud) and "Floor pays back" (floor wash), under the chart. |
| Caption card (phone) | `BRAND_CLASS.captionPhone` | 28 | none | Cloud card, 14×16 padding. |

Borders are rare. Use `border-line` (1px) only as a divider or on `chip` and `btn-secondary`.
Shadows are always the violet-tinted tokens (`shadow-card`, `shadow-tile`, `shadow-chip`,
`shadow-pop`). Never use a grey or black drop shadow.

## 4. Chart colours (midnight card)

Use `CHART` from `./brand`. Every value is a `var(--color-…)` reference. Apply colours with
`style={{ stroke: CHART.floor }}` or `style={{ fill: … }}`, not with hex values.

| Element | Token | Stroke / form |
| --- | --- | --- |
| Card ground | `CHART.bg`: midnight `#0b0b24` | |
| Grid, beat dividers, ticks | `CHART.grid`: midnight-line `#2a2a52` | 1px, non-scaling |
| Axis labels, $100 reference | `CHART.axis`: on-dark-3 `#b9b8d6` | Reference line dashed `DASH.ref` (`4 5`) at 50% opacity; labels 10.5–11px, semibold, `tnum` |
| **Price** line and head dot | `CHART.price`: white | 2.5px, round joins and caps; the head dot is white, 8–10px |
| **Floor staircase** | `CHART.floor`: mint `#7fe0bf` | 2.5px, `stroke-linejoin: miter`, exact vertical risers from `frame.floorSteps`, never smoothed |
| Floor slab | `CHART.floorSlab`: mint at 14% | Fill under the staircase |
| Harvest / exit dots, "+x% from fees" | `CHART.floor` | 6px dots; labels 11.5px bold mint |
| **Arbitrage line** | `CHART.arb`: risk-on-dark `#ff9fbd` | 1.5px, dashed `DASH.arb` (`5 4`), a staircase at `floor × arbLineRatio` |
| Arb strip (between arb and floor) | `CHART.arbStrip`: rose at 12% | Fill |
| **Bounce marker** | `CHART.bounce` dot, 10px, with a `CHART.bounceHalo` ring (`ring-4 ring-white/10`) | The "Bounce" label is 11.5px bold rose, under the dot |
| Presale band / raise fill | `CHART.presale` at 7% / `CHART.presaleFill` at 20% | |
| Split columns | floor `CHART.floor`, market `CHART.market` (iris), fees `CHART.fees` (butter) | Same order and colours as the sandbox legend |
| Value chips ("Peak $400 ↑", "$40.28") | `BRAND_CLASS.pillRaised` (`bg-tile text-white`) | 22px pill |
| **"Illustration" pill** | `BRAND_CLASS.pillIllustration`: butter `#f3e46f` with ink text, top-left | Muted (`pillOnDark`) once the numbers are real |
| **Real-scale chip** | `BRAND_CLASS.pillOnDark`: midnight-chip `#26264c` with on-dark-2 text, top-right | Text is `REAL_SCALE_LABEL` or `magnifiedLabel(x)` |

On light grounds (blocks, ledgers, meters outside the midnight card) use `LIGHT`:

- The price is `ink`.
- The floor is `floor` for text and strokes, and `floorBar` / `floorBarHi` for fills, with
  `floorWash` / `floorSoft` grounds.
- The arbitrage line is `risk-line` (dashed). The bounce is `risk`.
- The risk band is the `hatch-risk` class, as in `FloorMeter`.

## 5. Typography

| Role | Desktop (≥1024) | Phone (390) | Face |
| --- | --- | --- | --- |
| Hero-size number or title (rare) | `display` 46–64px | `display` 36–46px | Outfit 800, -0.03em |
| Section title | `heading` 28px | `heading` 22px | Outfit 600 |
| **Caption** (active beat) | 26px / 1.25, bold, ink | 18px / 1.35, bold, ink | Outfit 700 (`font-display`) |
| Caption (inactive) | same size, `text-ink-2` | same | |
| Tile label / value | 12.5px semibold / 20px Outfit 700 | 11.5px / 15px | |
| Big figure in a card | `MidnightValue` 40px, or 26–30px Outfit 700 on light | 26px | `tnum` |
| Chart labels | 10.5–11.5px, semibold or bold | same | Jakarta, `tnum` |
| Micro label | `caps` (10.5px, 0.14em, uppercase) | same | |
| Footnote | 12.5px `text-ink-3` | 11px | |

Numbers always get `tnum`. Captions come from `beatCaption(m, key)`, and you can highlight their
numbers by colouring them (floor green for floor numbers). Never change the face or the weight
family.

## 6. Motion character

- Scroll scrubs every value: `frame` comes from the shared hooks. There are no timers, no CSS
  transitions on values, and no loops or idle animation.
- Only `transform` and `opacity` move. Cards or captions enter with at most 16px of travel
  (`MOTION.maxTravel`) and an opacity ramp. Camera moves ease in and out, never overshoot.
- Discrete UI changes (hover, chip swaps) use `MOTION.quick` (120ms ease).
- Under reduced motion, use `StoryStills` with one static frame per beat. Use
  `<BrandChartFrame size="still">` there.
- The bounce must read physically: the price comes down onto the dashed arbitrage line and turns
  up. Show it with the line, not with a cartoon spring.

## 7. Reuse these, don't redraw them

| Need | Reuse |
| --- | --- |
| Chart card and chips | `BrandChartFrame` (`illustration`, `illustrationLive`, `scale="real"` or a magnification factor, `chips`, `overlay`, `size`) |
| Your $100 / Floor pays back | `BrandTiles`, or `StatTile` (`tone="floor"` / `"cloud"`, `marker="floor"` / `"price"`) inside a `<dl>` |
| The single big number | `MidnightCard` + `MidnightValue` (`ui/MidnightCard.tsx`) |
| Numbered beat badge or icon square | `IconTile` (`tone="floor"`, `"violet"`, `"presale"` or `"risk"`, size 40/44, radius 35%) |
| Status pills | `Pill` (`tone`, `dot`, `size="sm"`) or the `pill pill-sm pill-floor` classes |
| Phase tiles (Presale, Graduating, Floor live) | `CountTile`, `PhaseBadge` |
| Quote asset | `QuoteChip symbol="SPYx" coin`, `QuoteCoin` (midnight disc with mint letters) |
| Floor-vs-price bar | Copy the look of `FloorMeter`: track `bg-track`, floor `bg-floor-bar`, risk `hatch-risk`, price marker an ink bar |
| A CTA corner | `NotchedCta` (butter) on a midnight card, or `NotchedTab` (lilac) on a white card |
| Progress rail | The landing's rail: 4px `bg-track` segments filled with `bg-floor`; the current one is 8px tall with a floor ring |
| Icons | `ui/icons.tsx` (`VaultIcon`, `StepIcon`, `FloorChartIcon`, `RedeemIcon`, `LockIcon`, …) |

Note: `ui/QuoteChip.tsx` imports a *type* from `@stockfloor/sdk`, which is fine (type-only).
`ui/MidnightCard` and `ui/Notched` use `next/link`, which is fine in client code. Never import the
`@stockfloor/sdk` barrel for values, and never import `@/lib/format`. Use the formatters in
`../shared` instead.

## 8. Do / don't

**Do**
- Put the chart in `BrandChartFrame`, the tiles in `BrandTiles` or `StatTile`, and the captions as in
  `story.module.css` (bare Outfit text on wide screens, a cloud card on phones).
- Keep one dark element per view, and keep everything else white, cloud or a pastel tint.
- Use the tints for categories: presale is sky (`presale-*`), graduating is butter or cream
  (`graduating-*`), the floor is green/mint, risk is rose, and links or neutral emphasis are violet.
- Use generous rounding (20–32px) on containers and 999px on pills and chips.
- Label magnification every time (`magnifiedLabel`) and show "Illustration" while
  `frame.illustrative` is true.

**Don't**
- Cream or newsprint paper, serif faces, or FT pink. (v01 used cream and serif. v11 keeps the
  editorial annotations and prose captions, on white with Outfit.)
- Neon or terminal looks: green-on-black monospace, scanlines, glows, `#00ff…`. (v12 keeps the desk's
  panels as white cards, with one midnight chart.)
- Sky gradients, photo-like water, glassmorphism or blur. (v16's tank is a midnight card with a mint
  level and a flat mint-at-14% fill.)
- Foreign fonts, `font-mono` for prose, or all-caps headings (use `caps` only for micro labels).
- Off-palette colours: no raw hex in variant code, no Tailwind default palette (`red-500`,
  `emerald-400`, …), and no pure black `#000`. Every colour is a `var(--color-…)` token through
  `CHART` / `LIGHT` or the token utilities (`bg-floor-wash`, `text-risk`, …).
- Hard 1px black rules, grey shadows, or square corners on cards (the Swiss variant keeps its grid
  and hierarchy, not black rules).
- Confetti, emoji, mascots that wobble, or score counters that invent numbers. (v20 is playful
  through tiles, `IconTile` badges and pastel pills, and every number comes from the engine.)
- Wheel or touch handlers, scroll-snap, your own scroll listeners, or a flat or smoothed floor.
