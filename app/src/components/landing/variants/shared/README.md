# Story variant harness

Shared scroll mechanics for the ten "Follow your $100" variants at `/lab/story/{n}`. Each variant
lives in `../v{NN}-{slug}/Variant.tsx`, starts with `"use client"`, and default-exports
`function Variant({ m }: VariantProps)`. `m` is the `LaunchMath`, computed on the server. Change only
your own folder. Import everything from `../shared`.

The harness reuses the landing's driver (`components/landing/scroll/progress.ts`). It attaches one
passive scroll/resize listener for the whole page, coalesced to one rAF. It has no wheel or touch
handlers and no scroll-snap, so the browser scrolls natively. The story is a pure function of the
scroll position, so scrolling back reverses exactly. The server render and the first paint show the
finished frame (pos 8).

Variants 11–20 restyle originals 1–10 in the site's own style. They follow `BRAND.md` and use
`brand.ts` (`CHART`, `LIGHT`, `STROKE`, `DASH`, `RADIUS`, `MOTION`, `BRAND_CLASS`, `alpha`) and
`BrandChartFrame` / `BrandTiles`. Every export is available from `../shared`.

## Mechanics

- **Steps.** There is one `<li data-step={i}>` per beat (8 in total), in `BEAT_KEYS` order:
  presale, split, pump, selloff, steps, bounce, exits, redeem. Step i's progress `q` runs 0→1 while
  it crosses the reading line. The beat plays over q 0.05..0.75 and then holds its finished frame.
  - `pos = i + progress` (0..8). `storyFrame(m, pos)` returns everything to draw: path, floorSteps,
    arbLine100, events, camera, and so on.
- **Reading line.** On wide screens (≥1024px or a landscape phone) it sits at 50% of the viewport.
  On phones, `stacked` stages (`[data-stage]`) put it at stageH + 40% of the space below the stage.
  Non-stacked (overlay) stages put it at 40% of the viewport.
- **Step heights.** Steps are measured in svh. The defaults are in `BEAT_RUNWAY_SVH` (60–90 svh);
  override them with `heights`.
- **CSS variables.** The driver writes `data-active` on the root and on each step (`"true"` or
  `"false"`). It writes `--q0…--q7` on the first `[data-rail]` element inside the root, or on the
  root itself if there is none. Pure-CSS effects can read them, using `var(--qN, 1)` as the fallback.

## Exports

| Export | What it is |
| --- | --- |
| `StoryHarness` | Ready-made layout. Props are listed below. |
| `StoryRoot({ m, children, id?, className?, style?, label? })` | The chapter `<section>`. Attaches the driver unless reduced motion is on, and provides the context every hook needs. |
| `StoryTrack({ children, className? })` | Wrapper that renders only while motion is allowed or not yet known. CSS hides it under reduced motion. |
| `StoryStage({ children, stacked = true, className?, style? })` | Sticky stage slot. You set the sticky CSS yourself; `StoryHarness` does it for you. |
| `StorySteps({ heights?, renderStep?, className?, stepClassName? })` | The runway. Memoised, so it never re-renders on scroll. |
| `DefaultCaption(slot)` | The default caption card: the caption plus an sr-only sentence. |
| `StoryStills({ renderStill, footer?, className? })` | Reduced motion: one `<figure>` per beat with its label, caption, sr text and `renderStill(frame, beat, i)`. |
| `FrameView({ render, step? })` | Subscribes to the frame and calls `render(frame)`. Use it to isolate re-renders. |
| `usePos(step = 0.005)` | `pos` from 0 to 8, quantised. Re-renders only when the value changes. |
| `useStoryFrame(step = 0.005)` | `storyFrame(m, pos)`, memoised. |
| `useActiveBeat()` | `{ index, key }` of the active step. |
| `useStoryProgress(select)` | Low level: `select({ q[], active })`. Return a primitive from `select`. |
| `useStoryReducedMotion()` | `true`, `false`, or `null` when not yet known (server and first client render). |
| `useJumpToBeat()` | Returns `(i, q = 0.85) => void`, a native `scrollTo` to beat i (finished). |
| `jumpToBeat(root, i, { q?, reduced? })` | The same jump without React. |
| `useStillFrames()` / `stillFrames(m)` | The 8 static frames: `storyFrame(m, i + 1)`. |
| `useStoryLaunch()` | `m`. |
| `BEAT_KEYS`, `STORY_POS_END`, `storyFrame`, `BeatKey`, `StoryFrame` | Re-exported from the engine. |
| Copy | `STORY_TITLE`, `STORY_FOOTNOTE`, `STORY_HONESTY`, `BEAT_LABELS`, `BEAT_RUNWAY_SVH`, `beatCaption(m, key)`, `beatSrText(m, key)`, `railLabel(i)`, `railStatus(i)`, `TILE_NOW` ("Your $100 now"), `TILE_FLOOR` ("Floor pays back"), `TILE_REDEEMED`, `tileValues(frame)`, `ILLUSTRATION`, `CHART_COPY`, `REAL_SCALE_LABEL`, `magnifiedLabel(x)`, `floorSharePct(m)`, `storyNumbers(m)`, `sinceListing(m, frame)` (percent change of your $100 and of the floor since trading opened; null before), `listingBaseline(m)`, `formatPctChange(pct)` ("+4.8%", "−61%"), `SINCE_LISTING`, and the formatters `formatUsdCents`, `formatUsdWhole`, `formatUsdCompact` and `formatMultiple`. |
| `VariantProps` | `{ m: LaunchMath }` |

### `StoryHarness` props

| Prop | Meaning |
| --- | --- |
| `m` | The `LaunchMath`. |
| `stage` | `(frame) => ReactNode`: the harness subscribes for you, and only the stage re-renders on scroll. A plain `ReactNode` is rendered as is, and it calls the hooks itself. |
| `still?` | `(frame, beat, i) => ReactNode` for reduced motion. Defaults to `stage` when `stage` is a function. |
| `layout?` | `"split"` (the default): on phones the sticky stage sits on top and the caption card is stuck under it; on wide screens they sit side by side. `"overlay"`: a 100svh sticky stage with the caption cards scrolling over it. |
| `stageSide?` | `"left"` (the default) or `"right"`. Applies to wide split layouts. |
| `heights?` | Step runway in svh: one number, or `{ [beat]: svh }`. |
| `renderStep?` | `(slot: { beat, i, label, caption, srText }) => ReactNode`. Render `srText` in an `.sr-only` element. |
| `header?` | Content above the track. |
| `footer?` | Content below the track. Defaults to the footnote and the honesty line. |
| `posStep?` | Quantisation step for the stage function. Defaults to 0.005. |
| `className`, `stageClassName`, `stepsClassName`, `stepClassName`, `style` | Styling hooks. |

The CSS custom properties on the root are `--stage-h`, `--gap`, `--card-room` and `--runway` (per
step). The defaults are in `harness.module.css`.

## Minimal example

```tsx
"use client";

import { StoryHarness, ILLUSTRATION, TILE_FLOOR, TILE_NOW, tileValues, type StoryFrame, type VariantProps } from "../shared";

function Stage({ frame }: { frame: StoryFrame }) {
  const { now, floor } = tileValues(frame);
  return (
    <svg viewBox="0 0 100 60" aria-hidden>
      {/* draw frame.floorSteps as a staircase, frame.path as the price, frame.arbLine100 … */}
      {frame.illustrative ? <text x="2" y="6">{ILLUSTRATION}</text> : null}
      <text x="2" y="58">{TILE_NOW} {now} · {TILE_FLOOR} {floor}</text>
    </svg>
  );
}

export default function Variant({ m }: VariantProps) {
  return <StoryHarness m={m} stage={(frame) => <Stage frame={frame} />} heights={{ steps: 110, bounce: 110 }} />;
}
```

## Hooks-only example (your own layout)

```tsx
<StoryRoot m={m} className={styles.root}>
  <StoryTrack className={styles.track}>
    <StoryStage stacked={false} className={styles.stage}><MyStage /></StoryStage>   {/* MyStage calls useStoryFrame() */}
    <StorySteps heights={80} renderStep={(s) => <h3 className={styles.cap}>{s.caption}<span className="sr-only">{s.srText}</span></h3>} />
  </StoryTrack>
  <StoryStills renderStill={(f) => <MyStill frame={f} />} />
</StoryRoot>
```

## Rules that every variant keeps

- Show all 8 beats in order, using the captions from `beatCaption`. Tiny wording tweaks are allowed,
  up to 7 words.
- Scroll natively. Don't call `preventDefault`, don't listen to `wheel` or `touch`, and don't use
  scroll-snap. Don't add your own scroll listener; use the hooks.
- Draw the floor as a staircase from `frame.floorSteps` or `frame.events`. It must never be flat, and
  you must never magnify it silently: show `REAL_SCALE_LABEL` or `magnifiedLabel(x)`.
- At the bounce beat, the price bounces off `frame.arbLine100`, which sits just below the floor.
- When `frame.illustrative` is true, show the `ILLUSTRATION` label.
- Show "Your $100" (`tileValues(frame).now`) and "Floor pays back" (`tileValues(frame).floor`)
  somewhere.
- Under `prefers-reduced-motion`, show static frames (`StoryStills`).
- At 390×844 the active caption is always readable, and there is no horizontal scroll.
- Use SVG, CSS and canvas only. Don't add npm dependencies. Don't import the `@stockfloor/sdk` barrel
  or `@/lib/format` in this code.
