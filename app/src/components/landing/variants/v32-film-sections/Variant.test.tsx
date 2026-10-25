import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEATS, storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, BEAT_LABELS, ILLUSTRATION, REAL_SCALE_LABEL, SINCE_LISTING, TILE_FLOOR, TILE_NOW, beatCaption, formatPctChange, sinceListing } from "../shared";
import { cameraAt } from "./camera";
import { Scene } from "./FilmScene";
import { filmGeometry, layoutTags, stripLayout } from "./sections";
import Variant from "./Variant";

const k = simConstantsFromSdk();
const m = launchMath(k, k.defaultVaultSharePct);
const WIDE = filmGeometry(1024, 600);
const PHONE = filmGeometry(358, 420);

let reduceMotion = false;

class FakeIO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduceMotion : true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const scene = (pos: number, g = WIDE) => {
  const f = storyFrame(m, pos);
  return render(<Scene m={m} frame={f} cam={cameraAt(m, f)} g={g} />);
};

describe("v32 film, with sections", () => {
  it("renders the 8 beats: one caption and one runway step each, the step bar on top, the film card", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    const rail = container.querySelector("[data-rail]")!;
    BEAT_KEYS.forEach((key, i) => {
      expect(rail.querySelector(`[data-beat="${key}"]`)?.textContent).toBe(beatCaption(m, key));
      expect(steps[i]!.textContent).toContain(beatCaption(m, key));
    });
    // The step bar: one line segment per beat, named, above the caption and the frame.
    const bar = container.querySelector('[data-part="progress"]')!;
    expect(bar.children).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(bar.children[i]!.textContent).toBe(BEAT_LABELS[key]));
    const card = container.querySelector("[data-brand-chart]")!;
    expect(bar.compareDocumentPosition(rail.querySelector('[data-beat="presale"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // First paint is the finished frame: real-scale close-up with the Illustration pill.
    expect(card.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(card.querySelector('[data-part="illustration"]')?.textContent).toBe(ILLUSTRATION);
    // The two values ride the head inside the card, and appear nowhere else.
    expect(card.querySelectorAll('[data-part="tile-now"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-part="tile-now"]')).toHaveLength(1);
  });

  it("the section strip names every beat and marks only the current one", () => {
    // The whole story in one wide view: every section is named in full, in order.
    const whole = stripLayout((t) => 20 + (t + 0.2) * 150, 1600, false, 5);
    expect(whole.labels.map((l) => l.key)).toEqual([...BEAT_KEYS]);
    whole.labels.forEach((l, i) => {
      expect(l.name).toBe(BEAT_LABELS[BEAT_KEYS[i]!]);
      expect(l.num).toBe(String(i + 1).padStart(2, "0"));
      expect(l.opacity).toBeGreaterThan(0.9);
    });
    expect(whole.labels.filter((l) => l.state === "current").map((l) => l.key)).toEqual(["bounce"]);
    // Rendered: across the story every beat's section is named, and each frame marks its own beat.
    const seen = new Set<string>();
    for (const pos of [0.5, 1.5, 2.6, 3.6, 4.6, 5.6, 6.6, 7.6, 8]) {
      const { container, unmount } = scene(pos);
      const labels = [...container.querySelectorAll('[data-part="section-label"]')];
      labels.forEach((l) => seen.add(l.getAttribute("data-beat")!));
      const cur = labels.filter((l) => l.getAttribute("data-state") === "current");
      const want = BEAT_KEYS[storyFrame(m, pos).beatIndex]!;
      expect(cur.map((l) => l.getAttribute("data-beat")), `pos ${pos}`).toEqual([want]);
      expect(cur[0]!.textContent).toContain(String(BEAT_KEYS.indexOf(want) + 1).padStart(2, "0"));
      unmount();
    }
    expect([...seen].sort()).toEqual([...BEAT_KEYS].sort());
  });

  it("strip labels never collide: narrow sections show only their number or nothing", () => {
    for (const pxPerT of [12, 30, 60, 120, 300]) {
      for (const compact of [true, false]) {
        const { labels } = stripLayout((t) => 30 + t * pxPerT, 1000, compact, 3);
        const shown = labels
          .filter((l) => l.opacity > 0.02)
          .map((l) => {
            const w = l.name ? (l.name.length + 3) * (compact ? 7.2 : 8.9) : 18;
            const x0 = l.anchor === "end" ? l.x - w : l.x;
            return [x0, x0 + w] as const;
          })
          .sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < shown.length; i++) expect(shown[i]![0], `${pxPerT} ${compact}`).toBeGreaterThanOrEqual(shown[i - 1]![1] - 1);
      }
    }
    // Out of view: a section left of the card is not named.
    const panned = stripLayout((t) => (t - 6) * 300, 1000, false, 6);
    expect(panned.labels.find((l) => l.key === "presale")).toBeUndefined();
    // Squeezed: the presale band 30px wide shows its number only.
    expect(stripLayout((t) => 30 + t * 40, 1000, false, 0).labels[0]!.name).toBeNull();
  });

  it("strip labels stay readable while panned: a name stuck at the left edge is not a half-faded ghost", () => {
    for (const pxPerT of [60, 120, 300]) {
      for (const shift of [0.5, 1.5, 2.5, 3.5, 4.5]) {
        for (const compact of [true, false]) {
          const W = compact ? 360 : 1000;
          const { labels } = stripLayout((t) => (t - shift) * pxPerT, W, compact, 5);
          const shown = labels.filter((l) => l.opacity > 0.02 && l.anchor === "start");
          // Every label at or right of the sticky position (and clear of the right edge) is at full strength.
          for (const l of shown) {
            const w = l.name ? (l.name.length + 3) * (compact ? 7.2 : 8.9) : 18;
            if (l.x >= (compact ? 12 : 16) && l.x + w <= W - 40) expect(l.opacity, `${pxPerT} ${shift} ${l.key}`).toBe(1);
          }
          // And still no collisions when panned.
          const spans = shown.map((l) => [l.x, l.x + (l.name ? (l.name.length + 3) * (compact ? 7.2 : 8.9) : 18)] as const).sort((a, b) => a[0] - b[0]);
          for (let i = 1; i < spans.length; i++) expect(spans[i]![0], `${pxPerT} ${shift}`).toBeGreaterThanOrEqual(spans[i - 1]![1] - 1);
        }
      }
    }
  });

  it("the tooltips show both values on the head's right, and the % since listing only after listing", () => {
    const pct = (c: ParentNode, p: string) => c.querySelector(`[data-part="pct-${p}"]`);
    for (const pos of [0.5, 1.9]) {
      const { container, unmount } = scene(pos);
      expect(container.querySelector('[data-part="tile-now"]')?.textContent).toBe("$100.00");
      expect(pct(container, "now")).toBeNull();
      expect(pct(container, "floor")).toBeNull();
      expect(container.textContent).not.toContain(SINCE_LISTING);
      unmount();
    }
    for (const [pos, sign] of [
      [3, "+"],
      [4, "−"],
    ] as const) {
      const f = storyFrame(m, pos);
      const want = sinceListing(m, f);
      const { container, unmount } = scene(pos);
      expect(container.textContent).toContain(TILE_NOW);
      expect(container.textContent).toContain(TILE_FLOOR);
      const now = pct(container, "now")!;
      expect(now.textContent).toBe(`${formatPctChange(want.now!)} ${SINCE_LISTING}`);
      expect(now.textContent!.startsWith(sign)).toBe(true);
      expect(now.querySelector("tspan")!.getAttribute("class")).toMatch(sign === "+" ? /pctUp/ : /pctDown/);
      const floor = pct(container, "floor")!;
      expect(floor.textContent).toBe(`${formatPctChange(want.floor!)} ${SINCE_LISTING}`);
      expect(floor.querySelector("tspan")!.getAttribute("class")).toMatch(/pctFloor/);
      unmount();
    }
  });

  it("keeps the tooltips inside the card, right of the head dot and the bounce", () => {
    for (const g of [WIDE, PHONE]) {
      const plotW = g.W - g.pl - g.pr;
      for (let pos = 0; pos <= 8; pos += 0.05) {
        const f = storyFrame(m, pos);
        const cam = cameraAt(m, f);
        const headX = g.pl + ((f.t - cam.x0) / (cam.x1 - cam.x0)) * plotW;
        // Room on the head's right for the gap and the tooltip, inside the card.
        expect(headX + g.tagGap + g.tagW, `pos ${pos.toFixed(2)}`).toBeLessThanOrEqual(g.W - 4);
        if (f.dip) expect(g.pl + ((f.dip.t - cam.x0) / (cam.x1 - cam.x0)) * plotW).toBeLessThanOrEqual(headX + 0.5);
      }
    }
    const tags = layoutTags(200, 205, 74, 76, 600);
    expect(Math.abs(tags.floor! - tags.price)).toBeGreaterThanOrEqual(80 - 1e-9);
  });

  it("split: a labelled vertical column whose floor part lands on the slab; presale fills from $0", () => {
    const mid = scene(1.4);
    const text = (part: string) => mid.container.querySelector(`[data-part="${part}"]`)?.textContent;
    expect(text("split-label-floor")).toBe("Floor 50%");
    expect(text("split-label-market")).toBe("Market 40%");
    expect(text("split-label-fees")).toBe("Fees 5% · 5%");
    const floorRect = mid.container.querySelector('[data-part="split-floor"]')!;
    const marketRect = mid.container.querySelector('[data-part="split-market"]')!;
    expect(Number(floorRect.getAttribute("y"))).toBeGreaterThan(Number(marketRect.getAttribute("y")));
    mid.unmount();
    const landed = scene(1.92);
    expect(Number(landed.container.querySelector('[data-part="split-floor"]')!.getAttribute("y"))).toBeCloseTo(-m.floorPer100GrossUsd * 100, 6);
    landed.unmount();
    const half = scene(0.5);
    expect(half.container.querySelector('[data-part="raise-label"]')?.textContent).toBe("Raised $5,000 of $10,000");
    half.unmount();
    // The staircase is never flat, and the bounce comes with the arbitrage line.
    const b = scene(6);
    expect((b.container.querySelector('[data-part="floor-steps"]')!.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(8);
    expect(b.container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(b.container.querySelector('[data-part="bounce"]')).toBeTruthy();
  });

  it("presale and split get longer runways (120 / 150 svh)", () => {
    const { container } = render(<Variant m={m} />);
    const runway = (i: number) => (container.querySelectorAll("[data-step]")[i] as HTMLElement).style.getPropertyValue("--runway");
    expect(runway(BEAT_KEYS.indexOf("presale"))).toBe("120svh");
    expect(runway(BEAT_KEYS.indexOf("split"))).toBe("150svh");
    expect(BEATS).toHaveLength(BEAT_KEYS.length);
  });

  it("renders one static frame per beat under reduced motion, with the strip and tooltips", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    const figures = stills.querySelectorAll("figure");
    expect(figures).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
    figures.forEach((fig, i) => {
      expect(fig.querySelector('[data-brand-chart="still"]')).toBeTruthy();
      expect(fig.querySelector('[data-part="tile-now"]')).toBeTruthy();
      expect(fig.querySelector('[data-part="section-label"][data-state="current"]')?.getAttribute("data-beat")).toBe(BEAT_KEYS[i]);
    });
    expect(figures[BEAT_KEYS.indexOf("bounce")]!.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
  });

  it("uses site tokens only: no raw hex colours in the variant's sources", () => {
    for (const f of readdirSync(__dirname).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
