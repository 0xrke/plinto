# Brand marks (drafts)

Drafts of the product mark while the name is under review (`StockFloor` → possibly `Plinto`). Nothing here
is wired into the app yet: `app/src/app/icon.svg` and `LogoMark` still ship the original mark.

Both drafts keep the shipped mark exactly as it is — the navy badge, the four-point white polyline with
round caps, the same proportions, scaled from its 28px viewBox to 64 — and change only the floor.

| File | What changed | Use it for |
|---|---|---|
| `mark-wedge.svg` | The floor tapers from 5px on the left to 11px on the right: the floor grows continuously | The default mark, 32px and up |
| `mark-wedge-small.svg` | Stronger taper, thicker line, slightly tighter corner radius | 16–24px: favicon, wallet lists, token rows |
| `mark-steps.svg` | The floor rises in three steps of 3.5px | Where the floor should read as rising in jumps |
| `mark-steps-small.svg` | Two steps of 6.5px instead of three | 16–24px, where a 3.5px step disappears |

## Why two sizes of each

A 3.5px step in a 64px drawing is 0.9px at 16px, so it vanishes in a browser tab. The `-small` files
exaggerate the same idea until it survives. Pick per context rather than scaling one file everywhere.

## Colors

| Token | Value | Where |
|---|---|---|
| Badge | `#16324f` | The app's `--color-brand` |
| Floor | `#7fd1ad` | The app's mint accent |
| Line | `#ffffff` | Fixed |

The floor color is the one worth revisiting: mint reads closer to wellness than to finance. Brass
(`#b08a3e`), slate blue (`#3f7ea8`) and verdigris (`#3d8a68`) were the alternatives tested on the
exploration page. Swapping it means editing the two `fill`/`stroke` values in each file.

## Still to do before this ships

- The wordmark. It is set in a web font on the exploration page; a real lockup needs the letters converted
  to outlines and the spacing corrected by hand.
- PNG exports (180px for Apple touch icons, 512px for manifests) and the OG image.
- A decision on the name, which is tracked in `docs/STATUS.md`.

## Social images (`social/`)

Drawn as SVG and rasterised with `rsvg-convert`; regenerate with the script kept alongside this repo's
brand notes. Every file exists as both `.svg` (the source) and `.png` (what you upload).

| File | Size | Use |
|---|---|---|
| `avatar-navy.png` | 400×400 | Profile picture, the app's navy |
| `avatar-ink.png` | 400×400 | Profile picture, near-black — pairs with the ink headers |
| `avatar-light.png` | 400×400 | Profile picture on white, with a hairline ring so it does not vanish on a light timeline |
| `header-white-wordmark.png` | 1500×500 | Header: mark, wordmark and tagline over the price-and-floor line |
| `header-ink-wordmark.png` | 1500×500 | The same on near-black |
| `header-navy-wordmark.png` | 1500×500 | The same on the app's navy |
| `header-white-statement.png` | 1500×500 | Header: "The floor ships on day one." |
| `header-ink-chart.png` | 1500×500 | Header: wordmark small, the chart carrying the image |

Notes for X specifically:

- **Avatars are cropped to a circle.** These are drawn full-bleed, so the crop takes the middle and the
  corners are spare on purpose. Do not add padding.
- **The avatar sits over the lower left of the header**, roughly the first 300×160 points. That corner
  holds nothing but the faint presale line in every header here.
- **Headers are cropped on narrow screens**, most on the left and right. The wordmark sits near the
  middle for that reason; the statement variant is the one to avoid if that bothers you.
- Sources are 3000×1000 and 1000×1000, so the exports stay sharp on retina displays.

## Social images, Pastel direction (`social/pastel/`)

The same set redrawn in the Pastel style direction: a pink-to-lavender-to-sky wash, midnight `#0b0b24`, the
mint floor `#7fe0bf` (`#16735c` on light grounds), butter `#f3e46f` for the one live accent, and Outfit for the
wordmark with Plus Jakarta Sans for the tagline. Text is converted to outlines, so the SVGs render the same
everywhere without the fonts installed. The mark is the wedge floor from the waitlist page, with a butter dot at
the end of the price line on midnight grounds.

| File | Size | Use |
|---|---|---|
| `avatar-pastel-midnight.png` | 400×400 | Profile picture: indigo `#1c1c3d` (the mark tile of the midnight header), mint floor, butter dot |
| `avatar-pastel-wash.png` | 400×400 | Profile picture on the pastel wash |
| `avatar-pastel-butter.png` | 400×400 | Profile picture on butter, the loudest of the three |
| `header-pastel-wordmark.png` | 1500×500 | Header: mark, wordmark and tagline over the price-and-floor line, on the wash |
| `header-pastel-midnight.png` | 1500×500 | The same on midnight, iris price line, butter dot at the latest price |
| `header-pastel-card.png` | 1500×500 | Header: the midnight card with "The floor ships on day one.", a floor meter and a butter tab |
| `header-pastel-cover.png` | 1500×500 | **Chosen header.** Midnight, "Token launches with a floor" with a mint wedge under "floor", the labelled phase chart. Pairs with `avatar-pastel-midnight.png` |

`gen.py` regenerates the SVGs. It needs `fonttools` and the variable fonts `Outfit[wght].ttf` and
`PlusJakartaSans[wght].ttf` from Google Fonts saved next to it as `Outfit.ttf` and `Jakarta.ttf`; rasterise with
`rsvg-convert -w 1500` (headers) and `-w 400` (avatars).

### Cover drafts (`social/pastel/cover-*`)

X headers built from the launch's three phases (presale, market opens, trading) with a slogan and "floor" underlined
by a heavy bar: a wedge whose top edge rises like the mark's floor, or three steps in draft D. `covers.py`
regenerates them (it imports `gen.py`).

| File | Idea |
|---|---|
| `cover-a-wash-slogan.png` | "Token launches with a floor" over the labelled phase chart, on the wash |
| `cover-b-midnight-memes.png` | "Memes, with a floor." on midnight, iris price, butter at the latest price |
| `cover-c-wash-card.png` | "Up without limit. With a floor under it." beside a white "How a launch runs" card |
| `cover-d-card-steps.png` | The midnight card: "Every launch ships a floor." with a stepped underline and the chart |
| `cover-e-midnight-type.png` | Type-led: a huge "floor" on a mint wedge, the chart faint behind |

### Post images (`social/pastel/post-*`)

| File | Size | Use |
|---|---|---|
| `post-01-floor-vs-zero.png` (`@2x` for 3200×1800) | 1600×900 | First post: "Most go to zero. Yours gets a floor." Two cards: a launchpad token selling off to $0, and the same launch stopping at a rising floor. `post1.py` regenerates it |
| `post-01-floor-vs-zero-wash.png` (`@2x`) | 1600×900 | The same post in the light style of `cover-a`: wash ground, white cards, midnight price, green floor, coral sell-off |
