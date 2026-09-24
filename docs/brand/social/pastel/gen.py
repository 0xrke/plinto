"""Generate the Pastel-direction X avatars and headers as SVG with text converted to outlines."""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

_fonts = {}


def font(name, wght):
    key = (name, wght)
    if key not in _fonts:
        f = TTFont(os.path.join(HERE, name))
        _fonts[key] = instantiateVariableFont(f, {"wght": wght})
    return _fonts[key]


def text_path(s, x, y, size, name="Outfit.ttf", wght=700, tracking=0.0):
    """Outline `s` with its baseline at (x, y). Returns (path d, advance width in px)."""
    f = font(name, wght)
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    upm = f["head"].unitsPerEm
    scale = size / upm
    pen = SVGPathPen(gs)
    cx = 0.0
    for ch in s:
        g = cmap.get(ord(ch))
        if g is None:
            continue
        tp = TransformPen(pen, (scale, 0, 0, -scale, x + cx, y))
        gs[g].draw(tp)
        cx += gs[g].width * scale + tracking * size
    return pen.getCommands(), cx - tracking * size


def width(s, size, name="Outfit.ttf", wght=700, tracking=0.0):
    return text_path(s, 0, 0, size, name, wght, tracking)[1]


# Pastel palette (from the Pastel style tile)
MIDNIGHT = "#0b0b24"
INK = "#14142b"
SLATE = "#4a4a66"
MINT_DARK = "#7fe0bf"  # floor on midnight
FLOOR = "#16735c"      # floor on light
BUTTER = "#f3e46f"
IRIS = "#8b7cf6"
ROSE = "#e46a8c"
WASH = ["#fbdde8", "#e8defb", "#d9ebfb"]

# The mark, drawn in its 64-unit box: a floor wedge under a rising line (the shipped waitlist mark).
MARK_FLOOR = "M14 50.5h36v-8l-36 4.5z"
MARK_LINE = "M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1"


TILE = "#1c1c3d"  # the mark's tile: a lighter indigo than the midnight ground


def mark(x, y, size, bg=TILE, floor=MINT_DARK, line="#ffffff", dot=BUTTER, rx=18):
    s = size / 64
    dot_svg = f'<circle cx="50.3" cy="17.1" r="4.2" fill="{dot}"/>' if dot else ""
    bg_svg = f'<rect width="64" height="64" rx="{rx}" fill="{bg}"/>' if bg else ""
    return (
        f'<g transform="translate({x} {y}) scale({s:.5f})">{bg_svg}'
        f'<path d="{MARK_FLOOR}" fill="{floor}" stroke="{floor}" stroke-width="4" stroke-linejoin="round"/>'
        f'<path d="{MARK_LINE}" fill="none" stroke="{line}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
        f"{dot_svg}</g>"
    )


def wash_defs(id_="wash", w=3000, h=1000):
    return (
        f'<linearGradient id="{id_}" x1="0" y1="0" x2="{w}" y2="{h}" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{WASH[0]}"/><stop offset="0.5" stop-color="{WASH[1]}"/>'
        f'<stop offset="1" stop-color="{WASH[2]}"/></linearGradient>'
    )


def svg(w, h, body, defs=""):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
        f"<defs>{defs}</defs>{body}</svg>\n"
    )


def write(name, content):
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(content)


# ---------- Avatars (1000×1000, full bleed: X crops them to a circle) ----------
AV_FLOOR = "M215 792h570v-130l-570 74z"
AV_LINE = "M214 588L392 426l125 89L786 265"


def avatar(bg_svg, floor, line, dot, defs=""):
    dot_svg = f'<circle cx="786" cy="265" r="66" fill="{dot}"/>' if dot else ""
    body = (
        bg_svg
        + f'<path d="{AV_FLOOR}" fill="{floor}" stroke="{floor}" stroke-width="62" stroke-linejoin="round"/>'
        + f'<path d="{AV_LINE}" fill="none" stroke="{line}" stroke-width="80" stroke-linecap="round" stroke-linejoin="round"/>'
        + dot_svg
    )
    return svg(1000, 1000, body, defs)


write(
    "avatar-pastel-midnight.svg",
    avatar(f'<rect width="1000" height="1000" fill="{TILE}"/>', MINT_DARK, "#ffffff", BUTTER),
)
write(
    "avatar-pastel-wash.svg",
    avatar('<rect width="1000" height="1000" fill="url(#aw)"/>', FLOOR, MIDNIGHT, None, wash_defs("aw", 1000, 1000)),
)
write("avatar-pastel-butter.svg", avatar(f'<rect width="1000" height="1000" fill="{BUTTER}"/>', FLOOR, MIDNIGHT, None))

# ---------- Headers (3000×1000). The avatar covers roughly x<600, y>680: keep it quiet. ----------
# The price-over-floor line used by the existing headers, reused so the family stays one drawing.
PRESALE = "M0 824 L1150 745"
FLOOR_EDGE = "M1150 886 C1500 872, 1900 850, 2300 824 C2560 806, 2800 793, 3000 780"
FLOOR_AREA = FLOOR_EDGE + " L3000 1000 L1150 1000 Z"
PRICE = (
    "M1150 736 C1230 604, 1290 586, 1350 692 C1410 806, 1440 877, 1500 877 C1590 877, 1620 666, 1710 657 "
    "C1800 648, 1820 780, 1900 780 C1990 780, 2000 630, 2090 630 C2180 630, 2170 833, 2270 833 "
    "C2380 833, 2400 648, 2520 630 C2680 604, 2820 560, 3000 498"
)


def chart(price, floor_fill, floor_stroke, presale, touch, end_dot, floor_opacity=1.0):
    return (
        f'<path d="{PRESALE}" fill="none" stroke="{presale}" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 34"/>'
        f'<path d="{FLOOR_AREA}" fill="{floor_fill}" fill-opacity="{floor_opacity}"/>'
        f'<path d="{FLOOR_EDGE}" fill="none" stroke="{floor_stroke}" stroke-width="12" stroke-linecap="round"/>'
        f'<path d="{PRICE}" fill="none" stroke="{price}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<circle cx="1500" cy="877" r="20" fill="{touch}"/><circle cx="2270" cy="833" r="20" fill="{touch}"/>'
        + (f'<circle cx="3000" cy="498" r="30" fill="{end_dot}"/>' if end_dot else "")
    )


def lockup(cx, top, mark_size, word_size, tag_size, word_fill, tag_fill, mark_kw, tag="Token launches with a floor"):
    """Mark + 'plinto' + tagline, the group centred on cx."""
    gap = mark_size * 0.28
    ww = width("plinto", word_size, wght=800, tracking=-0.02)
    total = mark_size + gap + ww
    x0 = cx - total / 2
    word_x = x0 + mark_size + gap
    base = top + mark_size * 0.80
    d_word, _ = text_path("plinto", word_x, base, word_size, wght=800, tracking=-0.02)
    d_tag, _ = text_path(tag, word_x + 6, base + tag_size * 1.9, tag_size, name="Jakarta.ttf", wght=500)
    return (
        mark(x0, top, mark_size, **mark_kw)
        + f'<path d="{d_word}" fill="{word_fill}"/>'
        + f'<path d="{d_tag}" fill="{tag_fill}"/>'
    )


# 1. Wash + wordmark + chart
body = (
    '<rect width="3000" height="1000" fill="url(#hw)"/>'
    + chart(MIDNIGHT, MINT_DARK, FLOOR, SLATE, FLOOR, None, floor_opacity=0.45)
    + lockup(1500, 190, 250, 210, 58, MIDNIGHT, SLATE, {})
)
write("header-pastel-wordmark.svg", svg(3000, 1000, body, wash_defs("hw")))

# 2. Midnight + wordmark + chart (iris price, mint floor, butter at the latest price)
body = (
    f'<rect width="3000" height="1000" fill="{MIDNIGHT}"/>'
    '<ellipse cx="2300" cy="120" rx="1100" ry="420" fill="url(#glow)"/>'
    + chart(IRIS, MINT_DARK, MINT_DARK, "#6b6b85", MINT_DARK, BUTTER, floor_opacity=0.16)
    + lockup(1500, 190, 250, 210, 58, "#ffffff", "#b9b9d0", {})
)
glow = (
    '<radialGradient id="glow"><stop offset="0" stop-color="#5b45d6" stop-opacity="0.38"/>'
    '<stop offset="1" stop-color="#5b45d6" stop-opacity="0"/></radialGradient>'
)
write("header-pastel-midnight.svg", svg(3000, 1000, body, glow))

# 3. Wash + the signature midnight card with a statement and a floor meter + butter tab
CARD_X, CARD_Y, CARD_W, CARD_H = 740, 150, 1560, 700
line1, _ = text_path("The floor ships", CARD_X + 110, CARD_Y + 245, 132, wght=800, tracking=-0.015)
line2, _ = text_path("on day one.", CARD_X + 110, CARD_Y + 395, 132, wght=800, tracking=-0.015)
cap, _ = text_path("Token launches with a floor in tokenized stocks", CARD_X + 112, CARD_Y + 490, 44, name="Jakarta.ttf", wght=500)
# Floor meter inside the card: floor 27.5% (1 / 3.64), risk band up to the price tick at 88%.
MX, MY, MW, MH = CARD_X + 110, CARD_Y + 560, 700, 56
floor_w = MW * 0.88 * 0.275
tick_x = MX + MW * 0.88
tab_label, tab_w = text_path("Launch with a floor", 0, 0, 50, name="Jakarta.ttf", wght=700)
TAB_W, TAB_H = tab_w + 190, 150
TAB_X, TAB_Y = CARD_X + CARD_W - TAB_W - 26, CARD_Y + CARD_H - TAB_H - 26
tab_text, _ = text_path("Launch with a floor", TAB_X + 130, TAB_Y + 93, 50, name="Jakarta.ttf", wght=700)
body = (
    '<rect width="3000" height="1000" fill="url(#hs)"/>'
    # a soft shadow and the card
    f'<rect x="{CARD_X}" y="{CARD_Y + 30}" width="{CARD_W}" height="{CARD_H}" rx="84" fill="#5b45d6" fill-opacity="0.16" filter="url(#blur)"/>'
    f'<rect x="{CARD_X}" y="{CARD_Y}" width="{CARD_W}" height="{CARD_H}" rx="84" fill="{MIDNIGHT}"/>'
    f'<path d="{line1}" fill="#ffffff"/><path d="{line2}" fill="#ffffff"/>'
    f'<path d="{cap}" fill="#b9b9d0"/>'
    # gauge arc top-right of the card
    f'<g transform="translate({CARD_X + CARD_W - 270} {CARD_Y + 220})">'
    f'<circle r="120" fill="none" stroke="#2a2a4d" stroke-width="22" stroke-dasharray="565 754" transform="rotate(135)" stroke-linecap="round"/>'
    f'<circle r="120" fill="none" stroke="{IRIS}" stroke-width="22" stroke-dasharray="210 754" transform="rotate(135)" stroke-linecap="round"/>'
    + mark(-60, -70, 120, bg=None)
    + "</g>"
    # meter
    f'<rect x="{MX}" y="{MY}" width="{MW}" height="{MH}" rx="28" fill="#1c1c3d"/>'
    f'<rect x="{MX + floor_w}" y="{MY}" width="{tick_x - MX - floor_w}" height="{MH}" fill="url(#hatch)"/>'
    f'<rect x="{MX}" y="{MY}" width="{floor_w}" height="{MH}" rx="28" fill="{MINT_DARK}"/>'
    f'<rect x="{MX + floor_w - 28}" y="{MY}" width="28" height="{MH}" fill="{MINT_DARK}"/>'
    f'<rect x="{tick_x - 5}" y="{MY - 18}" width="10" height="{MH + 36}" rx="5" fill="#ffffff"/>'
    # notched butter tab in the card corner
    f'<path d="M{TAB_X + 40} {TAB_Y} H{TAB_X + TAB_W - 58} Q{TAB_X + TAB_W} {TAB_Y} {TAB_X + TAB_W} {TAB_Y + 58} '
    f'V{TAB_Y + TAB_H - 58} Q{TAB_X + TAB_W} {TAB_Y + TAB_H} {TAB_X + TAB_W - 58} {TAB_Y + TAB_H} H{TAB_X + 28} '
    f'Q{TAB_X - 6} {TAB_Y + TAB_H} {TAB_X + 2} {TAB_Y + TAB_H - 40} L{TAB_X + 14} {TAB_Y + 36} Q{TAB_X + 20} {TAB_Y} {TAB_X + 40} {TAB_Y} Z" fill="{BUTTER}"/>'
    f'<path d="M{TAB_X + 62} {TAB_Y + 75} h44 m-18 -18 l18 18 l-18 18" fill="none" stroke="{MIDNIGHT}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
    f'<path d="{tab_text}" fill="{MIDNIGHT}"/>'
)
defs = (
    wash_defs("hs")
    + '<filter id="blur" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="40"/></filter>'
    + f'<pattern id="hatch" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + f'<rect width="22" height="22" fill="#2a1f3d"/><rect width="7" height="22" fill="{ROSE}"/></pattern>'
)
write("header-pastel-card.svg", svg(3000, 1000, body, defs))
print("ok")
