#!/usr/bin/env python3
"""Generate the reserved-name confusables table for both implementations.

    python3 scripts/gen-reserved-confusables.py path/to/confusables.txt

Rewrites the block between the GENERATED markers in
  programs/stockfloor/src/reserved_names.rs   (CONFUSABLES, Rust)
  packages/sdk/src/reservedNames.ts            (CONFUSABLES, TypeScript)
so the two tables are identical by construction (packages/sdk/test/reservedNames.test.ts also
parses both and compares them).

Every non-ASCII code point gets a lowercase skeleton byte, or none (dropped), from, in priority order:
  1. BASE: the hand-picked Cyrillic, Greek and Latin look-alikes the product rule names explicitly.
  2. The arithmetic rules in the code (fullwidth, circled, math Latin letters and digits); these code
     points are left out of the table.
  3. NFKD compatibility decomposition (Python unicodedata), combining marks and ASCII punctuation
     removed: precomposed accented letters, math Greek, letterlike symbols, Roman numerals, modifier
     and enclosed letters, superscripts, ... when exactly one letter or digit remains.
  4. Unicode confusables.txt (UTS #39): single code points whose prototype resolves to exactly one
     letter or digit (Lisu, Cherokee, Runic, box drawing bars, Arabic-Indic digits, ...).
The output byte is already folded by the ASCII rule (lowercase, i/1/|/! -> l, 0 -> o), and runs of
consecutive code points with the same output are merged into one range.

The confusables file is an input, not a dependency: it is downloaded by hand from
https://www.unicode.org/Public/security/latest/confusables.txt when the table is refreshed.
"""

import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUST = ROOT / "programs/stockfloor/src/reserved_names.rs"
TS = ROOT / "packages/sdk/src/reservedNames.ts"

# Hand-picked look-alikes (inclusive ranges). These win over everything else.
BASE = [
    # Latin-1 and Latin Extended-A accented forms of the letters that spell the brand.
    (0x00C0, 0x00C5, "a"), (0x00CC, 0x00CF, "l"), (0x00D1, 0x00D1, "n"), (0x00D2, 0x00D6, "o"),
    (0x00D8, 0x00D8, "o"), (0x00E0, 0x00E5, "a"), (0x00EC, 0x00EF, "l"), (0x00F1, 0x00F1, "n"),
    (0x00F2, 0x00F6, "o"), (0x00F8, 0x00F8, "o"), (0x0100, 0x0105, "a"), (0x0128, 0x0131, "l"),
    (0x0139, 0x0142, "l"), (0x0143, 0x0148, "n"), (0x014C, 0x0151, "o"), (0x0162, 0x0167, "t"),
    (0x021A, 0x021B, "t"), (0x038C, 0x038C, "o"), (0x03AF, 0x03AF, "l"), (0x03CA, 0x03CA, "l"),
    (0x03CC, 0x03CC, "o"),
    (0x00A1, 0x00A1, "l"), (0x01C0, 0x01C0, "l"),
    (0x026A, 0x026A, "l"), (0x0274, 0x0274, "n"), (0x029F, 0x029F, "l"),
    (0x0391, 0x0391, "a"), (0x0399, 0x0399, "l"), (0x039A, 0x039A, "k"), (0x039C, 0x039C, "m"),
    (0x039D, 0x039D, "n"), (0x039F, 0x039F, "o"), (0x03A1, 0x03A1, "p"), (0x03A4, 0x03A4, "t"),
    (0x03B1, 0x03B1, "a"), (0x03B9, 0x03B9, "l"), (0x03BA, 0x03BA, "k"), (0x03BC, 0x03BC, "u"),
    (0x03BD, 0x03BD, "v"), (0x03BF, 0x03BF, "o"), (0x03C1, 0x03C1, "p"), (0x03C4, 0x03C4, "t"),
    (0x0406, 0x0407, "l"), (0x0408, 0x0408, "j"), (0x0410, 0x0410, "a"), (0x0415, 0x0415, "e"),
    (0x041A, 0x041A, "k"), (0x041C, 0x041C, "m"), (0x041D, 0x041D, "h"), (0x041E, 0x041E, "o"),
    (0x041F, 0x041F, "n"), (0x0420, 0x0420, "p"), (0x0421, 0x0421, "c"), (0x0422, 0x0422, "t"),
    (0x0423, 0x0423, "y"), (0x0425, 0x0425, "x"), (0x0430, 0x0430, "a"), (0x0435, 0x0435, "e"),
    (0x043A, 0x043A, "k"), (0x043C, 0x043C, "m"), (0x043D, 0x043D, "h"), (0x043E, 0x043E, "o"),
    (0x043F, 0x043F, "n"), (0x0440, 0x0440, "p"), (0x0441, 0x0441, "c"), (0x0442, 0x0442, "t"),
    (0x0443, 0x0443, "y"), (0x0445, 0x0445, "x"), (0x0456, 0x0457, "l"), (0x0458, 0x0458, "j"),
    (0x04C0, 0x04C0, "l"), (0x04CF, 0x04CF, "l"),
    (0x1D00, 0x1D00, "a"), (0x1D0F, 0x1D0F, "o"), (0x1D18, 0x1D18, "p"), (0x1D1B, 0x1D1B, "t"),
    (0x2113, 0x2113, "l"), (0x2160, 0x2160, "l"), (0x2170, 0x2170, "l"), (0x217C, 0x217C, "l"),
    (0x3163, 0x3163, "l"),  # Hangul vowel I (not in confusables.txt)
]

# Bidi controls: a name holding one is reserved outright, so they never get a mapping.
BIDI = {0x061C, 0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A)}


def by_rule(cp):
    """The arithmetic rules in the code (left out of the table)."""
    if 0xFF01 <= cp <= 0xFF5E:
        return chr(cp - 0xFF01 + 0x21)
    if 0x24B6 <= cp <= 0x24CF:
        return chr(0x41 + cp - 0x24B6)
    if 0x24D0 <= cp <= 0x24E9:
        return chr(0x61 + cp - 0x24D0)
    if 0x249C <= cp <= 0x24B5:
        return chr(0x61 + cp - 0x249C)
    if 0x1F130 <= cp <= 0x1F189 and (cp - 0x1F130) % 32 < 26:
        return chr(0x41 + (cp - 0x1F130) % 32)
    if 0x1D400 <= cp <= 0x1D6A3:
        k = (cp - 0x1D400) % 52
        return chr(0x41 + k) if k < 26 else chr(0x61 + k - 26)
    if 0x1D7CE <= cp <= 0x1D7FF:
        return chr(0x30 + (cp - 0x1D7CE) % 10)
    return None


def fold(c):
    """The ASCII rule; None when the ASCII char is dropped."""
    c = c.lower()
    if not (c.isascii() and (c.isalnum() or c in "|!")):
        return None
    return {"i": "l", "1": "l", "|": "l", "!": "l", "0": "o"}.get(c, c)


base = {}
for first, last, out in BASE:
    for cp in range(first, last + 1):
        base[cp] = fold(out)

# Generated (non-BASE) mappings keep only the letters of the brand. Any other look-alike is dropped,
# which can only join its neighbours into a hit, never hide one, and keeps the on-chain table small.
BRAND = set("plnto" "a")

confusables = {}


def load_confusables(path):
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        src, dst = [f.strip() for f in line.split(";")[:2]]
        if " " in src:
            continue
        confusables[int(src, 16)] = [int(x, 16) for x in dst.split()]


memo = {}


def resolve(cp, depth=0):
    """Skeleton byte (a str of length 1) of a non-ASCII code point, or None (dropped)."""
    if cp < 0x80:
        return fold(chr(cp))
    if cp in memo:
        return memo[cp]
    if depth > 4 or cp in BIDI or 0xD800 <= cp <= 0xDFFF:
        return None
    memo[cp] = None  # cycle guard
    out = None
    if cp in base:
        out = base[cp]
    elif by_rule(cp) is not None:
        out = fold(by_rule(cp))
    else:
        nfkd = unicodedata.normalize("NFKD", chr(cp))
        if nfkd != chr(cp):
            out = single(nfkd, depth)
        if out is None and cp in confusables:
            out = single("".join(map(chr, confusables[cp])), depth)
    memo[cp] = out
    return out


def single(s, depth):
    """The one skeleton byte of a decomposition or prototype, or None unless exactly one remains."""
    outs = []
    for ch in s:
        cp = ord(ch)
        if unicodedata.category(ch).startswith("M"):
            continue
        if cp < 0x80:
            if ch.isalnum() or ch in "|!":
                outs.append(fold(ch))
            elif ch.isspace() or not ch.isprintable() or ch in "()[].,'\"-_":
                continue
            else:
                return None
            continue
        r = resolve(cp, depth + 1)
        if r is None:
            # An unmapped letter or digit means the sequence is not one Latin character; an
            # unmapped symbol or punctuation mark is dropped like ASCII punctuation.
            if unicodedata.category(ch)[0] in "LN":
                return None
            continue
        outs.append(r)
    return outs[0] if len(outs) == 1 else None


def table():
    rows = []
    for cp in range(0x80, 0x110000):
        if by_rule(cp) is not None:
            continue
        out = resolve(cp)
        if out is None or (cp not in base and out not in BRAND):
            continue
        if rows and rows[-1][1] == cp - 1 and rows[-1][2] == out:
            rows[-1][1] = cp
        else:
            rows.append([cp, cp, out])
    return rows


def label(cp):
    ch = chr(cp)
    cat = unicodedata.category(ch)
    if cat[0] in "MCZ":
        return f"U+{cp:04X}"
    return ch


def comment(first, last):
    name = unicodedata.name(chr(first), "")
    head = f"U+{first:04X}" if first == last else f"U+{first:04X}..U+{last:04X}"
    return f"{head} {name}" if name and first == last else head


def splice(path, body, begin, end):
    text = path.read_text(encoding="utf-8")
    pat = re.compile(re.escape(begin) + r"\n(?:.*?\n)?([ \t]*)" + re.escape(end), re.S)
    m = pat.search(text)
    if not m:
        sys.exit(f"markers not found in {path}")
    indent = m.group(1)
    new = begin + "\n" + body + "\n" + indent + end
    path.write_text(text[: m.start()] + new + text[m.end():], encoding="utf-8")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    load_confusables(sys.argv[1])
    rows = table()
    rust = "\n".join(f"    (0x{a:04X}, 0x{b:04X}, b'{o}'), // {comment(a, b)}" for a, b, o in rows)
    ts = "\n".join(f'  [0x{a:04x}, 0x{b:04x}, "{o}"], // {comment(a, b)}' for a, b, o in rows)
    splice(RUST, rust, "    // BEGIN GENERATED CONFUSABLES (scripts/gen-reserved-confusables.py)", "// END GENERATED CONFUSABLES")
    splice(TS, ts, "  // BEGIN GENERATED CONFUSABLES (scripts/gen-reserved-confusables.py)", "// END GENERATED CONFUSABLES")
    print(f"{len(rows)} ranges, {sum(b - a + 1 for a, b, _ in rows)} code points")


if __name__ == "__main__":
    main()
