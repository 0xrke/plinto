"""X cover drafts in the Pastel direction: the phase chart, a slogan, and 'floor' underlined by a heavy bar."""
from gen import (
    text_path, width, mark, wash_defs, svg, write,
    MIDNIGHT, SLATE, MINT_DARK, FLOOR, BUTTER, IRIS, TILE,
    PRESALE, FLOOR_EDGE, FLOOR_AREA, PRICE,
)

W, H = 3000, 1000
OUTFIT = "Outfit.ttf"
JAK = "Jakarta.ttf"


def words(parts, x, base, size, wght=800, tracking=-0.02):
    """Set a line made of (text, fill) parts. Returns (svg, {text: (x, width)})."""
    out, spans, cx = "", {}, x
    for t, fill in parts:
        d, w = text_path(t, cx, base, size, OUTFIT, wght, tracking)
        out += f'<path d="{d}" fill="{fill}"/>'
        spans[t] = (cx, w)
        cx += w + (width(" ", size, OUTFIT, wght) if not t.endswith(" ") else 0)
    return out, spans, cx - x


def line_width(parts, size, wght=800, tracking=-0.02):
    return words(parts, 0, 0, size, wght, tracking)[2]


def wedge(x, w, y, t0, t1, fill):
    """A bar under a word whose top edge rises left to right, like the mark's floor. y is the bottom edge."""
    r = min(t0, t1) * 0.35
    return (
        f'<path d="M{x + r} {y - r} L{x + w - r} {y - r} L{x + w - r} {y - t1 + r} L{x + r} {y - t0 + r} Z" '
        f'fill="{fill}" stroke="{fill}" stroke-width="{2 * r}" stroke-linejoin="round"/>'
    )


def steps(x, w, y, t, fill):
    """Three rising steps under a word, like the stepped mark."""
    third = w / 3
    rx = t * 0.35
    return "".join(
        f'<rect x="{x + i * third}" y="{y - i * t * 0.55}" width="{w - i * third}" height="{t + i * t * 0.55}" rx="{rx}" fill="{fill}"/>'
        for i in range(3)
    )


def label(t, x, y, size, fill, wght=700, tracking=0.14):
    d, w = text_path(t, x, y, size, JAK, wght, tracking)
    return f'<path d="{d}" fill="{fill}"/>', w


def phase_chart(price, floor_fill, floor_stroke, floor_opacity, presale, touch, labels, divider, end_dot=None):
    """The price-over-floor drawing from the existing headers, with the three phases named."""
    s = (
        f'<path d="{PRESALE}" fill="none" stroke="{presale}" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 34"/>'
        f'<line x1="1150" y1="560" x2="1150" y2="1000" stroke="{divider}" stroke-width="5" stroke-dasharray="14 16"/>'
        f'<path d="{FLOOR_AREA}" fill="{floor_fill}" fill-opacity="{floor_opacity}"/>'
        f'<path d="{FLOOR_EDGE}" fill="none" stroke="{floor_stroke}" stroke-width="12" stroke-linecap="round"/>'
        f'<path d="{PRICE}" fill="none" stroke="{price}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<circle cx="1500" cy="877" r="20" fill="{touch}"/><circle cx="2270" cy="833" r="20" fill="{touch}"/>'
    )
    if end_dot:
        s += f'<circle cx="2985" cy="503" r="30" fill="{end_dot}"/>'
    if labels is None:
        return s
    a, _ = label("PRESALE", 700, 700, 34, labels)
    b, _ = label("MARKET OPENS", 1180, 590, 34, labels)
    c, _ = label("TRADING · THE FLOOR ONLY RISES", 1900, 590, 34, labels)
    return s + a + b + c


def centred_headline(parts, cx, base, size, underline_word, ul_fill, style="wedge", wght=800):
    lw = line_width(parts, size, wght)
    x = cx - lw / 2
    txt, spans, _ = words(parts, x, base, size, wght)
    ux, uw = spans[underline_word]
    y = base + size * 0.16
    if style == "wedge":
        ul = wedge(ux + 4, uw - 8, y + size * 0.17, size * 0.07, size * 0.17, ul_fill)
    else:
        ul = steps(ux + 4, uw - 8, y + size * 0.1, size * 0.07, ul_fill)
    return ul + txt


# A. Wash · "Token launches with a floor" (wedge underline) over the phase chart
body = (
    '<rect width="3000" height="1000" fill="url(#w)"/>'
    + phase_chart(MIDNIGHT, MINT_DARK, FLOOR, 0.45, SLATE, FLOOR, "#4a4a66", "#b9b3d6")
    + centred_headline([("Token launches with a ", MIDNIGHT), ("floor", MIDNIGHT)], 1500, 330, 190, "floor", FLOOR)
)
write("cover-a-wash-slogan.svg", svg(W, H, body, wash_defs("w")))

# B. Midnight · "Memes, with a floor." mint wedge, iris price, butter at the latest price
body = (
    f'<rect width="3000" height="1000" fill="{MIDNIGHT}"/>'
    '<ellipse cx="2300" cy="120" rx="1100" ry="420" fill="url(#g)"/>'
    + phase_chart(IRIS, MINT_DARK, MINT_DARK, 0.16, "#6b6b85", MINT_DARK, "#a9a9c6", "#34345c", BUTTER)
    + centred_headline([("Memes, with a ", "#ffffff"), ("floor.", "#ffffff")], 1500, 330, 190, "floor.", MINT_DARK)
)
glow = (
    '<radialGradient id="g"><stop offset="0" stop-color="#5b45d6" stop-opacity="0.38"/>'
    '<stop offset="1" stop-color="#5b45d6" stop-opacity="0"/></radialGradient>'
)
write("cover-b-midnight-memes.svg", svg(W, H, body, glow))

# C. Wash · two-line slogan on the left, the chart framed in a white card on the right
t1, sp1, _ = words([("Up without limit.", MIDNIGHT)], 560, 400, 104)
t2, sp2, _ = words([("With a ", MIDNIGHT), ("floor", MIDNIGHT), ("under it.", MIDNIGHT)], 560, 530, 104)
fx, fw = sp2["floor"]
ul = wedge(fx + 4, fw - 8, 530 + 104 * 0.34, 104 * 0.07, 104 * 0.17, FLOOR)
sub, _ = label("PRESALE  →  MARKET OPENS  →  TRADING", 566, 670, 28, SLATE, wght=600, tracking=0.12)
CX, CY, CW, CH = 1740, 200, 1160, 600
k = (CW - 80) / 2400
chart = (
    f'<g transform="translate({CX + 40 - 600 * k} {CY + CH - 100 - 1000 * k}) scale({k:.4f})">'
    + phase_chart(MIDNIGHT, MINT_DARK, FLOOR, 0.45, SLATE, FLOOR, "#4a4a66", "#c9c3e3")
    + "</g>"
)
ch_title, _ = text_path("How a launch runs", CX + 60, CY + 110, 60, OUTFIT, 700)
leg_p, _ = text_path("Price", CX + 110, CY + CH - 42, 32, JAK, 600)
leg_f, _ = text_path("Floor", CX + 290, CY + CH - 42, 32, JAK, 600)
body = (
    '<rect width="3000" height="1000" fill="url(#w)"/>'
    + t1 + ul + t2 + sub
    + f'<rect x="{CX}" y="{CY + 24}" width="{CW}" height="{CH}" rx="64" fill="#5b45d6" fill-opacity="0.12" filter="url(#b)"/>'
    + f'<rect x="{CX}" y="{CY}" width="{CW}" height="{CH}" rx="64" fill="#ffffff"/>'
    + f'<path d="{ch_title}" fill="{MIDNIGHT}"/>'
    + f'<clipPath id="cc"><rect x="{CX}" y="{CY}" width="{CW}" height="{CH - 100}" rx="64"/></clipPath>'
    + f'<g clip-path="url(#cc)">{chart}</g>'
    + f'<rect x="{CX + 60}" y="{CY + CH - 56}" width="36" height="8" rx="4" fill="{MIDNIGHT}"/><path d="{leg_p}" fill="{SLATE}"/>'
    + f'<rect x="{CX + 240}" y="{CY + CH - 56}" width="36" height="8" rx="4" fill="{FLOOR}"/><path d="{leg_f}" fill="{SLATE}"/>'
)
defs = wash_defs("w") + '<filter id="b" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="40"/></filter>'
write("cover-c-wash-card.svg", svg(W, H, body, defs))

# D. Wash · the midnight card holds the slogan and a small phase chart, stepped underline
CX, CY, CW, CH = 700, 130, 1600, 740
h1, sp, _ = words([("Every launch ships a ", "#ffffff"), ("floor.", "#ffffff")], CX + 100, CY + 210, 110)
fx, fw = sp["floor."]
ul = steps(fx + 4, fw - 30, CY + 210 + 110 * 0.26, 110 * 0.09, MINT_DARK)
k = (CW - 60) / 2600
chart = (
    f'<g transform="translate({CX + 30 - 400 * k} {CY + CH - 1000 * k}) scale({k:.4f})">'
    + phase_chart(IRIS, MINT_DARK, MINT_DARK, 0.16, "#6b6b85", MINT_DARK, "#a9a9c6", "#34345c", BUTTER)
    + "</g>"
)
body = (
    '<rect width="3000" height="1000" fill="url(#w)"/>'
    + f'<rect x="{CX}" y="{CY + 30}" width="{CW}" height="{CH}" rx="84" fill="#5b45d6" fill-opacity="0.16" filter="url(#b)"/>'
    + f'<rect x="{CX}" y="{CY}" width="{CW}" height="{CH}" rx="84" fill="{MIDNIGHT}"/>'
    + f'<clipPath id="dc"><rect x="{CX}" y="{CY}" width="{CW}" height="{CH}" rx="84"/></clipPath>'
    + ul + h1
    + f'<g clip-path="url(#dc)">{chart}</g>'
)
write("cover-d-card-steps.svg", svg(W, H, body, defs))

# E. Midnight, type-led: a huge "floor" on a mint wedge, the chart faint behind
BIG = 330
big, bw = text_path("floor", 0, 0, BIG, OUTFIT, 800, -0.03)
pre, pw = text_path("Token launches with a", 0, 0, 92, OUTFIT, 700)
total = pw + 50 + bw
bx = 1500 - total / 2 + pw + 50
base = 470
big, _ = text_path("floor", bx, base, BIG, OUTFIT, 800, -0.03)
pre, _ = text_path("Token launches with a", bx - pw - 50, base, 92, OUTFIT, 700)
body = (
    f'<rect width="3000" height="1000" fill="{MIDNIGHT}"/>'
    '<ellipse cx="2300" cy="120" rx="1100" ry="420" fill="url(#g)"/>'
    + '<g opacity="0.5">'
    + phase_chart(IRIS, MINT_DARK, MINT_DARK, 0.12, "#6b6b85", MINT_DARK, None, "#34345c", BUTTER)
    + "</g>"
    + wedge(bx + 10, bw - 20, base + BIG * 0.2, BIG * 0.05, BIG * 0.12, MINT_DARK)
    + f'<path d="{big}" fill="#ffffff"/><path d="{pre}" fill="#b9b9d0"/>'
)
write("cover-e-midnight-type.svg", svg(W, H, body, glow))
print("covers ok")

# Chosen: B's midnight look with A's slogan.
body = (
    f'<rect width="3000" height="1000" fill="{MIDNIGHT}"/>'
    '<ellipse cx="2300" cy="120" rx="1100" ry="420" fill="url(#g)"/>'
    + phase_chart(IRIS, MINT_DARK, MINT_DARK, 0.16, "#6b6b85", MINT_DARK, "#a9a9c6", "#34345c", BUTTER)
    + centred_headline([("Token launches with a ", "#ffffff"), ("floor", "#ffffff")], 1500, 330, 190, "floor", MINT_DARK)
)
write("header-pastel-cover.svg", svg(W, H, body, glow))
print("final cover ok")
