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
