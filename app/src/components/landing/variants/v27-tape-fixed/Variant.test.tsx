import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, beatCaption, storyFrame } from "../shared";
import { FixedTape } from "./FixedTape";
import { layoutTags } from "./tapeGeometry";
import Variant from "./Variant";

const m = launchMath(simConstantsFromSdk(), 50);
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
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IntersectionObserver", FakeIO);
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

/** The vertices of an "M x y L x y …" path. */
const vertices = (d: string) =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((v) => [Number(v[1]), Number(v[2])] as const);

describe("v27 tape, fixed", () => {
  it("renders every beat's caption on the runway, the rail, and the tape in the brand chart card", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Step \d of 8/ })).toHaveLength(8);
    const card = container.querySelector('[data-brand-chart="stage"]');
    expect(card?.querySelector("svg")).toBeTruthy();
    // The finished frame: both value tags ride the playhead.
    expect(card!.textContent).toContain(TILE_NOW);
    expect(card!.textContent).toContain(TILE_FLOOR);
    // The caption under the deck follows the chart's beat: the finished frame is the redeem beat.
    expect(container.textContent).toContain(beatCaption(m, "redeem"));
  });

  it("split: one stacked vertical column, floor at the bottom, market above, fees on top, labelled with percents", () => {
    const { container } = render(<FixedTape m={m} frame={storyFrame(m, 2)} w={960} h={600} />);
    const box = (part: string) => {
      const r = container.querySelector(`[data-part="${part}"]`)!;
      const y = Number(r.getAttribute("y"));
      return { x: Number(r.getAttribute("x")), w: Number(r.getAttribute("width")), top: y, bottom: y + Number(r.getAttribute("height")) };
    };
    const floor = box("split-floor");
    const market = box("split-market");
    const creator = box("split-creator");
    const platform = box("split-platform");
    // One column: same x and width for every part, and wide enough to be the beat's main object.
    for (const p of [market, creator, platform]) {
      expect(p.x).toBe(floor.x);
      expect(p.w).toBe(floor.w);
    }
    expect(floor.w).toBeGreaterThanOrEqual(48);
    // Stacked bottom to top (SVG y grows downwards).
    expect(floor.top).toBeGreaterThan(market.bottom);
    expect(market.top).toBeGreaterThan(creator.bottom - 1e-6);
    expect(creator.top).toBeGreaterThan(platform.bottom - 1e-6);
    const label = (key: string) => container.querySelector(`[data-part="split-label-${key}"]`)!.textContent;
    expect(label("floor")).toBe("Floor 50%");
    expect(label("market")).toBe("Market 40%");
    expect(label("fees")).toBe("Fees 5% · 5%");
    // The floor part has settled onto the floor slab: its top is what the floor pays per $100, which
    // is where the staircase starts, and its right edge is the staircase's first vertex.
    const first = vertices(container.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!)[0]!;
    expect(Math.abs(floor.top - first[1])).toBeLessThan(1);
    expect(Math.abs(floor.x + floor.w - first[0])).toBeLessThan(1);
  });

  it("presale and split get longer runways (120 / 150 svh)", () => {
    const { container } = render(<Variant m={m} />);
    const runway = (i: number) => (container.querySelectorAll("[data-step]")[i] as HTMLElement).style.getPropertyValue("--runway");
    expect(runway(BEAT_KEYS.indexOf("presale"))).toBe("120svh");
    expect(runway(BEAT_KEYS.indexOf("split"))).toBe("150svh");
  });

  it("the playhead sits in the middle of the card", () => {
    for (const [w, pos] of [[960, 0.5], [960, 5.5], [358, 0.5], [358, 6.5]] as const) {
      const { container } = render(<FixedTape m={m} frame={storyFrame(m, pos)} w={w} h={600} />);
      const head = container.querySelector('[data-part="playhead"]')!;
      expect(Math.abs(Number(head.getAttribute("x1")) - w / 2)).toBeLessThanOrEqual(1);
      cleanup();
    }
  });

  it("presale: the raise is its own bar filling from $0, labelled 'Raised $X of $10,000'", () => {
    const rect = (c: HTMLElement, part: string) => {
      const r = c.querySelector(`[data-part="${part}"]`)!;
      const y = Number(r.getAttribute("y"));
      return { x: Number(r.getAttribute("x")), w: Number(r.getAttribute("width")), top: y, bottom: y + Number(r.getAttribute("height")) };
    };
    const early = render(<FixedTape m={m} frame={storyFrame(m, 0.3)} w={960} h={600} />).container;
    const a = rect(early, "raise-fill");
    const track = rect(early, "raise-track");
    expect(early.querySelector('[data-part="raise-label"]')!.textContent).toMatch(/^Raised \$[\d,]+of \$10,000$/);
    cleanup();
    const late = render(<FixedTape m={m} frame={storyFrame(m, 0.9)} w={960} h={600} />).container;
    const b = rect(late, "raise-fill");
    cleanup();
    // Same bar, same place; it grows upwards from $0, and is clear of the playhead at x = 480.
    expect(b.x).toBe(a.x);
    expect(b.w).toBe(a.w);
    expect(b.bottom).toBeCloseTo(a.bottom, 5);
    expect(b.top).toBeLessThan(a.top);
    expect(a.w).toBeGreaterThanOrEqual(72);
    expect(a.x + a.w).toBeLessThanOrEqual(480 - 20);
    expect(track.bottom).toBeCloseTo(a.bottom, 5);
    // Across the presale/split boundary the same column divides: no jump in either direction.
    const at = (pos: number, part: string) => {
      const c = render(<FixedTape m={m} frame={storyFrame(m, pos)} w={960} h={600} />).container;
      const r = rect(c, part);
      cleanup();
      return r;
    };
    const end = at(0.999, "raise-fill");
    const start = at(1.001, "split-market");
    expect(Math.abs(start.x - end.x)).toBeLessThan(1);
    expect(start.w).toBe(end.w);
  });

  it("the floor is a staircase: horizontal treads and exact vertical risers, never flat", () => {
    const { container } = render(<FixedTape m={m} frame={storyFrame(m, 6)} w={960} h={600} />);
    const pts = vertices(container.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!);
    expect(pts.length).toBeGreaterThan(4);
    let risers = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      // Every segment is either a tread (same y) or a riser (same x).
      expect(Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6).toBe(true);
      if (Math.abs(x1 - x0) < 1e-6 && y1 < y0) risers++;
    }
    expect(risers).toBeGreaterThan(1);
    expect(container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
  });

  it("value tags read in the order of their numbers when asked, without overlapping", () => {
    // The price line sits under the floor line, but the price's number is the larger one.
    const tags = layoutTags(200, 190, 50, 0, 600, 6, true);
    expect(tags.price).toBeLessThan(tags.floor!);
    expect(tags.floor! - tags.price).toBeGreaterThanOrEqual(56 - 1e-9);
    const free = layoutTags(200, 100, 50, 0, 600);
    expect(free.floor!).toBeLessThan(free.price);
  });

  it("reduced motion: no track, eight static tape frames with captions and the Illustration pill", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const figures = screen.getByTestId("story-stills").querySelectorAll("figure");
    expect(figures).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => {
      expect(figures[i]!.textContent).toContain(beatCaption(m, key));
      expect(figures[i]!.querySelector('[data-brand-chart="still"] svg')).toBeTruthy();
    });
    const pill = (i: number) => figures[i]!.querySelector('[data-part="illustration"]')?.textContent ?? null;
    expect(pill(BEAT_KEYS.indexOf("presale"))).toBeNull();
    expect(pill(BEAT_KEYS.indexOf("pump"))).toBe(ILLUSTRATION);
    // The made-up path stays on the tape after the pump, so redeem keeps the label too.
    expect(pill(BEAT_KEYS.indexOf("redeem"))).toBe(ILLUSTRATION);
    // The close-up never magnifies silently.
    expect(figures[BEAT_KEYS.indexOf("bounce")]!.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    // The split still shows the labelled column.
    expect(figures[BEAT_KEYS.indexOf("split")]!.textContent).toContain("Market 40%");
  });

  it("uses site tokens only: no raw hex colours in the variant's sources", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
