"""Image for the first X post: most launchpad tokens fall to zero; ours fall to a floor."""
from gen import text_path, mark, svg, write, MIDNIGHT, MINT_DARK, BUTTER, IRIS, TILE
from covers import words, wedge, label, OUTFIT, JAK

W, H = 1600, 900
ROSE = "#e46a8c"
MUTED = "#a9a9c6"

# Headline, centred: "Most go to zero. Yours gets a floor."
size = 76
parts = [("Most go to zero. ", "#b9b9d0"), ("Yours gets a ", "#ffffff"), ("floor.", "#ffffff")]
_, _, lw = words(parts, 0, 0, size)
hx = (W - lw) / 2
head, spans, _ = words(parts, hx, 150, size)
fx, fw = spans["floor."]
ul = wedge(fx + 3, fw - 22, 150 + size * 0.34, size * 0.07, size * 0.17, MINT_DARK)

CARD_W, CARD_H, GAP = 680, 560, 40
LX = (W - 2 * CARD_W - GAP) / 2
RX = LX + CARD_W + GAP
CY = 250
PAD = 44
CH_W, CH_H = CARD_W - 2 * PAD, 300  # chart box inside each card
CH_Y = 150  # chart top, card-local

# Same launch shape on both sides: presale, a pump at the open, then the sell-off.
LEFT = "M0 300 C110 300, 128 300, 150 236 C185 136, 215 40, 250 44 C290 48, 300 170, 340 160 C380 150, 390 230, 430 236 C480 244, 520 290, 592 300"
# Right: the sell-off stops at the floor, bounces, and trades on above it.
FLOOR_EDGE = "M150 232 C300 228, 450 222, 592 212"
RIGHT = (
    "M0 250 L150 236 C190 150, 215 40, 250 44 C290 48, 300 170, 340 160 C380 150, 390 222, 420 224 "
    "C450 226, 470 150, 505 140 C540 130, 560 100, 592 84"
)


def card(x, eyebrow, eyebrow_fill, chart_svg, caption_lines, caption_fill):
    ey, _ = label(eyebrow, x + PAD, CY + 70, 20, eyebrow_fill, wght=700, tracking=0.16)
    cap = ""
    for i, t in enumerate(caption_lines):
        d, _ = text_path(t, x + PAD, CY + CARD_H - 70 + i * 34, 24, JAK, 500)
        cap += f'<path d="{d}" fill="{caption_fill}"/>'
    return (
        f'<rect x="{x}" y="{CY}" width="{CARD_W}" height="{CARD_H}" rx="36" fill="{TILE}"/>'
        + ey
        + f'<g transform="translate({x + PAD} {CY + CH_Y - 40})">{chart_svg}</g>'
        + cap
    )


zero, _ = text_path("$0", CH_W - 4, 330, 22, JAK, 700)
left_chart = (
    f'<line x1="0" y1="300" x2="{CH_W}" y2="300" stroke="#3a3a63" stroke-width="3" stroke-dasharray="8 10"/>'
    f'<path d="{LEFT}" fill="none" stroke="{ROSE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    f'<circle cx="592" cy="300" r="11" fill="{ROSE}"/>'
    f'<path d="{zero}" fill="{MUTED}" transform="translate(-30 0)"/>'
)
fl_label, _ = label("FLOOR", 470, 262, 18, MINT_DARK, wght=700, tracking=0.16)
right_chart = (
    f'<line x1="0" y1="300" x2="{CH_W}" y2="300" stroke="#3a3a63" stroke-width="3" stroke-dasharray="8 10"/>'
    f'<path d="{FLOOR_EDGE} L592 300 L150 300 Z" fill="{MINT_DARK}" fill-opacity="0.22"/>'
    f'<path d="{FLOOR_EDGE}" fill="none" stroke="{MINT_DARK}" stroke-width="6" stroke-linecap="round"/>'
    f'<path d="{RIGHT}" fill="none" stroke="{IRIS}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    f'<circle cx="420" cy="224" r="10" fill="{MINT_DARK}"/>'
    f'<circle cx="592" cy="84" r="12" fill="{BUTTER}"/>'
    + fl_label
)

body = (
    f'<rect width="{W}" height="{H}" fill="{MIDNIGHT}"/>'
    '<ellipse cx="1250" cy="40" rx="700" ry="300" fill="url(#g)"/>'
    + ul + head
    + card(LX, "MOST LAUNCHPAD TOKENS", MUTED, left_chart, ["Nothing underneath. The sell-off", "runs all the way to zero."], MUTED)
    + card(RX, "WITH A FLOOR", MINT_DARK, right_chart, ["A redeemable vault in tokenized stocks", "underneath. The floor only moves up."], "#d6d6ea")
    + mark(W - LX - 44, CY + CARD_H + 24, 44, bg=TILE)
)
glow = (
    '<radialGradient id="g"><stop offset="0" stop-color="#5b45d6" stop-opacity="0.35"/>'
    '<stop offset="1" stop-color="#5b45d6" stop-opacity="0"/></radialGradient>'
)
write("post-01-floor-vs-zero.svg", svg(W, H, body, glow))
print("post ok")


# ---- Wash version, in the style of cover-a: light wash, midnight type, white cards, green floor ----
from gen import wash_defs, FLOOR, SLATE

CORAL = "#c2345f"  # the Pastel risk colour, readable on white
parts = [("Most go to zero. ", SLATE), ("Yours gets a ", MIDNIGHT), ("floor.", MIDNIGHT)]
head_w, spans_w, _ = words(parts, hx, 150, size)
fx, fw = spans_w["floor."]
ul_w = wedge(fx + 3, fw - 22, 150 + size * 0.34, size * 0.07, size * 0.17, FLOOR)


def card_light(x, eyebrow, eyebrow_fill, chart_svg, caption_lines):
    ey, _ = label(eyebrow, x + PAD, CY + 70, 20, eyebrow_fill, wght=700, tracking=0.16)
    cap = ""
    for i, t in enumerate(caption_lines):
        d, _ = text_path(t, x + PAD, CY + CARD_H - 70 + i * 34, 24, JAK, 500)
        cap += f'<path d="{d}" fill="{SLATE}"/>'
    return (
        f'<rect x="{x}" y="{CY + 16}" width="{CARD_W}" height="{CARD_H}" rx="36" fill="#5b45d6" fill-opacity="0.10" filter="url(#b)"/>'
        f'<rect x="{x}" y="{CY}" width="{CARD_W}" height="{CARD_H}" rx="36" fill="#ffffff"/>'
        + ey
        + f'<g transform="translate({x + PAD} {CY + CH_Y - 40})">{chart_svg}</g>'
        + cap
    )


left_w = (
    f'<line x1="0" y1="300" x2="{CH_W}" y2="300" stroke="#c9c3e3" stroke-width="3" stroke-dasharray="8 10"/>'
    f'<path d="{LEFT}" fill="none" stroke="{CORAL}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    f'<circle cx="592" cy="300" r="11" fill="{CORAL}"/>'
    f'<path d="{zero}" fill="{SLATE}" transform="translate(-30 0)"/>'
)
fl_label_w, _ = label("FLOOR", 470, 262, 18, FLOOR, wght=700, tracking=0.16)
right_w = (
    f'<line x1="0" y1="300" x2="{CH_W}" y2="300" stroke="#c9c3e3" stroke-width="3" stroke-dasharray="8 10"/>'
    f'<path d="{FLOOR_EDGE} L592 300 L150 300 Z" fill="{MINT_DARK}" fill-opacity="0.45"/>'
    f'<path d="{FLOOR_EDGE}" fill="none" stroke="{FLOOR}" stroke-width="6" stroke-linecap="round"/>'
    f'<path d="{RIGHT}" fill="none" stroke="{MIDNIGHT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    f'<circle cx="420" cy="224" r="10" fill="{FLOOR}"/>'
    f'<circle cx="592" cy="84" r="12" fill="{MIDNIGHT}"/>'
    + fl_label_w
)
body = (
    f'<rect width="{W}" height="{H}" fill="url(#w)"/>'
    + ul_w + head_w
    + card_light(LX, "MOST LAUNCHPAD TOKENS", SLATE, left_w, ["Nothing underneath. The sell-off", "runs all the way to zero."])
    + card_light(RX, "WITH A FLOOR", FLOOR, right_w, ["A redeemable vault in tokenized stocks", "underneath. The floor only moves up."])
    + mark(W - LX - 44, CY + CARD_H + 24, 44, bg=TILE)
)
defs = wash_defs("w", W, H) + '<filter id="b" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="24"/></filter>'
write("post-01-floor-vs-zero-wash.svg", svg(W, H, body, defs))
print("wash post ok")
