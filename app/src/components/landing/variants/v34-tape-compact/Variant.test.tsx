import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, BEAT_LABELS, ILLUSTRATION, REAL_SCALE_LABEL, SINCE_LISTING, TILE_FLOOR, TILE_NOW, TILE_SUPPLY, beatCaption, formatPctChange, sinceListing, storyFrame, supplyAt, supplyBurns } from "../shared";
import { SPLIT_DIVIDE, SPLIT_SETTLE, CompactTape, splitPhase } from "./CompactTape";
import Variant from "./Variant";
import { burnFloorText, stackTags } from "./tapeGeometry";

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

const vertices = (d: string) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((v) => [Number(v[1]), Number(v[2])] as const);
const css = readFileSync(join(__dirname, "tapeCompact.module.css"), "utf8");
/** Drawing sizes: the tape inside 20's card at 1440 (586 x 524, less the 40px chip row) and the phone card. */
const SIZES = [
  [586, 484],
  [358, 430],
] as const;

describe("v34 tape compact", () => {
  it("renders the header, the step rail on top, the tape card left and the 8 captions as the ribbon", () => {
    const { container } = render(<Variant m={m} />);
    expect(screen.getByRole("heading", { name: "Follow your $100" })).toBeTruthy();
    expect(container.textContent).toContain("Floor share");
    const rail = screen.getByRole("navigation", { name: "Story steps" });
    expect(within(rail).getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    // The rail sits above the chart card.
    const card = container.querySelector('[data-brand-chart="stage"]')!;
    expect(rail.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[data-brand-chart]")).toHaveLength(1);
    const steps = container.querySelectorAll("li[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const cap = steps[i]!.querySelector('[data-part="caption"]') as HTMLElement;
      expect(within(cap).getByText(beatCaption(m, key))).toBeTruthy();
    });
    // No metric tiles: the values live only in the riding tags.
    expect(container.querySelector('[data-part="tile-now"]')).toBeNull();
    expect(container.querySelector('[data-part="metrics"]')).toBeNull();
    expect(card.textContent).toContain(TILE_NOW);
    expect(card.textContent).toContain(TILE_FLOOR);
  });

  it("styles the captions as a sticky ribbon, with no scroll-snap", () => {
    expect(css).toMatch(/\.cap \{[^}]*position: sticky/);
    expect(css).toMatch(/\.step:has\(~ \.step\[data-active="true"\]\) \.cap \{[^}]*opacity: 0;/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/scroll-snap|scroll-behavior/);
  });

  it("the section strip names every beat over the story, and marks the current one in full", () => {
    for (const [w, h] of SIZES) {
      const seen = new Set<string>();
      for (let pos = 0.1; pos <= 8; pos += 0.1) {
        const frame = storyFrame(m, pos);
        const { container } = render(<CompactTape m={m} frame={frame} w={w} h={h} />);
        const current = container.querySelectorAll('[data-current="true"]');
        expect(current).toHaveLength(1);
        const key = BEAT_KEYS[frame.beatIndex]!;
        expect(current[0]!.getAttribute("data-section")).toBe(key);
        // The current section is named in full (number and name).
        expect(current[0]!.querySelector('[data-part="section-name"]')!.textContent).toContain(BEAT_LABELS[key]);
        for (const g of container.querySelectorAll("[data-section]")) {
          if (g.querySelector('[data-part="section-name"]')?.textContent?.includes(BEAT_LABELS[g.getAttribute("data-section") as (typeof BEAT_KEYS)[number]])) seen.add(g.getAttribute("data-section")!);
        }
        cleanup();
      }
      expect([...seen].sort()).toEqual([...BEAT_KEYS].sort());
    }
    // The current section is lit.
    const { container } = render(<CompactTape m={m} frame={storyFrame(m, 3.5)} w={586} h={484} />);
    expect(container.querySelector('[data-part="section-current"]')).toBeTruthy();
  });

  it("the riding tags show the values, and the change since listing only once trading opens", () => {
    const pct = (c: HTMLElement, part: string) => c.querySelector(`[data-part="pct-${part}"]`);
    for (const pos of [0.6, 1.9]) {
      const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={586} h={484} />);
      expect(container.textContent).toContain(TILE_NOW);
      expect(container.textContent).not.toContain(SINCE_LISTING);
      expect(pct(container, "price")).toBeNull();
      cleanup();
    }
    for (const [pos, sign] of [
      [2.7, "+"],
      [3.8, "−"],
    ] as const) {
      const frame = storyFrame(m, pos);
      const want = sinceListing(m, frame);
      const { container } = render(<CompactTape m={m} frame={frame} w={586} h={484} />);
      const price = pct(container, "price")!;
      expect(price.textContent).toBe(`${formatPctChange(want.now!)} ${SINCE_LISTING}`);
      expect(price.textContent!.startsWith(sign)).toBe(true);
      expect(price.querySelector("tspan")!.getAttribute("class")).toMatch(sign === "+" ? /pctUp/ : /pctDown/);
      const floor = pct(container, "floor")!;
      expect(floor.textContent).toBe(`${formatPctChange(want.floor!)} ${SINCE_LISTING}`);
      expect(floor.querySelector("tspan")!.getAttribute("class")).toMatch(/pctFloor/);
      cleanup();
    }
  });

  it("the playhead stays centred and the tags stay inside the card (flipping left when there is no room)", () => {
    for (const [w, h] of [...SIZES, [270, 400] as const]) {
      for (const pos of [0.5, 2.6, 5.5, 7.9]) {
        const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={w} h={h} />);
        const head = container.querySelector('[data-part="playhead"]')!;
        expect(Math.abs(Number(head.getAttribute("x1")) - w / 2)).toBeLessThanOrEqual(1);
        for (const r of container.querySelectorAll('[data-part^="tag-"] > rect')) {
          const x = Number(r.getAttribute("x"));
          const y = Number(r.getAttribute("y"));
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x + Number(r.getAttribute("width"))).toBeLessThanOrEqual(w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y + Number(r.getAttribute("height"))).toBeLessThanOrEqual(h);
        }
        cleanup();
      }
    }
    // 270px: a 124px tag cannot fit right of the centre (135 + 12 + 124 > 264), so it sits left.
    const { container } = render(<CompactTape m={m} frame={storyFrame(m, 3.5)} w={270} h={400} />);
    const tag = container.querySelector('[data-part="tag-price"] > rect')!;
    expect(Number(tag.getAttribute("x")) + Number(tag.getAttribute("width"))).toBeLessThan(135);
  });

  it("split: the raise bar divides into the labelled column, holds, then the floor part settles on the slab", () => {
    expect(SPLIT_DIVIDE[1]).toBeLessThan(SPLIT_SETTLE[0]);
    expect(splitPhase(storyFrame(m, 1 + (SPLIT_DIVIDE[1] + SPLIT_SETTLE[0]) / 2))).toEqual({ grow: 1, reveal: 0 });
    const held = render(<CompactTape m={m} frame={storyFrame(m, 1.45)} w={586} h={484} />).container;
    const label = (key: string) => held.querySelector(`[data-part="split-label-${key}"]`)!.textContent;
    expect(label("floor")).toBe("Floor 50%");
    expect(label("market")).toBe("Market 40%");
    expect(label("fees")).toBe("Fees 5% · 5%");
    const box = (c: HTMLElement, part: string) => {
      const r = c.querySelector(`[data-part="${part}"]`)!;
      const y = Number(r.getAttribute("y"));
      return { x: Number(r.getAttribute("x")), w: Number(r.getAttribute("width")), top: y, bottom: y + Number(r.getAttribute("height")) };
    };
    const f = box(held, "split-floor");
    const mk = box(held, "split-market");
    expect(f.top).toBeGreaterThan(mk.bottom);
    expect(mk.x).toBe(f.x);
    cleanup();
    // Same bar across the presale/split boundary.
    const end = box(render(<CompactTape m={m} frame={storyFrame(m, 0.999)} w={586} h={484} />).container, "raise-fill");
    cleanup();
    const start = box(render(<CompactTape m={m} frame={storyFrame(m, 1.001)} w={586} h={484} />).container, "split-market");
    cleanup();
    expect(Math.abs(start.x - end.x)).toBeLessThan(1);
    expect(start.w).toBe(end.w);
    // Settled: the floor part's top is where the staircase starts.
    const done = render(<CompactTape m={m} frame={storyFrame(m, 2)} w={586} h={484} />).container;
    const first = vertices(done.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!)[0]!;
    expect(Math.abs(box(done, "split-floor").top - first[1])).toBeLessThan(1);
  });

  it("presale and split get the long runways (120 / 150 svh)", () => {
    const { container } = render(<Variant m={m} />);
    const runway = (i: number) => (container.querySelectorAll("[data-step]")[i] as HTMLElement).style.getPropertyValue("--runway");
    expect(runway(0)).toBe("120svh");
    expect(runway(1)).toBe("150svh");
  });

  it("the floor is a staircase, never flat, with the arbitrage line and the bounce", () => {
    const { container } = render(<CompactTape m={m} frame={storyFrame(m, 6)} w={586} h={484} />);
    const pts = vertices(container.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!);
    let risers = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      expect(Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6).toBe(true);
      if (Math.abs(x1 - x0) < 1e-6 && y1 < y0) risers++;
    }
    expect(risers).toBeGreaterThan(1);
    expect(container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
  });

  it("reduced motion: no track, eight static tape frames with captions, pills and the scale chip", () => {
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
    expect(pill(0)).toBeNull();
    expect(pill(BEAT_KEYS.indexOf("pump"))).toBe(ILLUSTRATION);
    expect(figures[BEAT_KEYS.indexOf("bounce")]!.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(figures[1]!.textContent).toContain("Market 40%");
  });

  it("uses site tokens only: no raw hex colours", () => {
    for (const f of readdirSync(__dirname).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
  it("brings the stage to 20's size: brand container width, min(640px, 82svh), 6fr / 4fr, 48px gap", () => {
    expect(css).toMatch(/--st-frame-h: min\(640px, 82svh\)/);
    expect(css).toMatch(/--st-width: min\(1024px, calc\(100% - 96px\)\)/);
    expect(css).toMatch(/--st-cols: minmax\(0, 6fr\) minmax\(0, 4fr\)/);
    expect(css).toMatch(/--st-col-gap: 48px/);
  });

  /** Story pos at which the tape's time reaches t (the frame's t is monotone in pos). */
  const posAt = (t: number) => {
    let lo = 0;
    let hi = 8;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (storyFrame(m, mid).t < t) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const burns = supplyBurns(m);

  it("burn markers: one flame per burn, appearing only once the tape passes it, labelled with the supply drop and its small floor step", () => {
    expect(burns.map((b) => b.t)).toEqual([6.8, 8.2]);
    for (const [w, h] of SIZES) {
      for (const pos of [0.5, 1.5, 2.5, 4.5, 5.2]) {
        const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={w} h={h} />);
        expect(container.querySelectorAll('[data-part="burn"]'), `pos ${pos}`).toHaveLength(0);
        cleanup();
      }
      // Just before and just after each burn.
      burns.forEach((b, i) => {
        const p = posAt(b.t);
        const before = render(<CompactTape m={m} frame={storyFrame(m, p - 0.01)} w={w} h={h} />).container;
        expect(before.querySelectorAll('[data-part="burn"]')).toHaveLength(i);
        cleanup();
        const after = render(<CompactTape m={m} frame={storyFrame(m, p + 0.01)} w={w} h={h} />).container;
        expect(after.querySelectorAll('[data-part="burn"]')).toHaveLength(i + 1);
        cleanup();
      });
      // The end: both flames stay; the big one is labelled, pairing the supply drop with the floor step.
      const end = render(<CompactTape m={m} frame={storyFrame(m, 8)} w={w} h={h} />).container;
      expect(end.querySelectorAll('[data-part="burn"]')).toHaveLength(2);
      const big = end.querySelector('[data-burn="big"] [data-part="burn-label"]')!;
      expect(big.textContent).toBe("−30% supply→ floor +0.9%");
      // The old "+x% from exits" label is gone: the burn label says it.
      expect(end.textContent).not.toContain("from exits");
      expect(end.querySelector('[data-burn="big"] [data-part="burn-leader"]')).toBeTruthy();
      // The tiny burn names itself only during its own beat.
      expect(end.querySelector('[data-burn="small"] [data-part="burn-label"]')).toBeNull();
      cleanup();
      const bounce = render(<CompactTape m={m} frame={storyFrame(m, 5.75)} w={w} h={h} />).container;
      expect(bounce.querySelector('[data-burn="small"] [data-part="burn-label"]')!.textContent).toBe("−0.4% supply→ floor +0.01%");
      cleanup();
    }
    expect(burnFloorText(burns[0]!.floorPct)).toBe("+0.01%");
    expect(burnFloorText(burns[1]!.floorPct)).toBe("+0.9%");
    // Honesty: a 30% burn lifts the floor by under 1%.
    expect(burns[1]!.floorPct).toBeLessThan(1);
  });

  it("the supply lane: nothing before listing, then 100% stepping down at the burn times, under the flames", () => {
    for (const pos of [0.5, 1.5, 1.99]) {
      const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={586} h={484} />);
      expect(container.querySelector('[data-part="supply-lane"]')).toBeNull();
      expect(container.querySelector('[data-part="supply-scale"]')).toBeNull();
      expect(container.querySelector('[data-part="tag-supply"]')).toBeNull();
      cleanup();
    }
    const listed = render(<CompactTape m={m} frame={storyFrame(m, 2.5)} w={586} h={484} />).container;
    expect(listed.querySelector('[data-part="supply-scale"]')!.textContent).toBe("100%Supply");
    const flat = vertices(listed.querySelector('[data-part="supply-line"]')!.getAttribute("d")!);
    expect(new Set(flat.map(([, y]) => y)).size).toBe(1);
    cleanup();
    const end = render(<CompactTape m={m} frame={storyFrame(m, 8)} w={586} h={484} />).container;
    const pts = vertices(end.querySelector('[data-part="supply-line"]')!.getAttribute("d")!);
    // Listing, then a vertical drop at each burn, then on to the playhead.
    expect(pts).toHaveLength(6);
    const drops = pts.filter((p, i) => i > 0 && Math.abs(p[0] - pts[i - 1]![0]) < 1e-6);
    expect(drops).toHaveLength(2);
    const flames = [...end.querySelectorAll('[data-part="burn"] path')].map((p) => vertices(p.getAttribute("d")!)[0]![0]);
    drops.forEach(([x], i) => expect(Math.abs(x - flames[i]!)).toBeLessThan(0.2));
    // Each drop is the burn's share: 100 → 99.6 → 69.7 on the lane's own scale.
    const [y100, yA, yB] = [pts[0]![1], pts[2]![1], pts[4]![1]];
    // (the 0.4% drop is a fraction of a pixel on a 33px scale; the 30% one is about a third of it).
    expect(yA).toBeGreaterThanOrEqual(y100);
    expect(yA - y100).toBeLessThan(0.5);
    expect(yB - y100).toBeGreaterThan(8);
    // The playhead ends the line.
    expect(Math.abs(pts[5]![0] - 293)).toBeLessThan(0.2);
    // The lane lies under the main plot: below every floor vertex.
    const floorYs = vertices(end.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!).map(([, y]) => y);
    expect(Math.min(...pts.map(([, y]) => y))).toBeGreaterThan(Math.max(...floorYs));
  });

  it("the third riding tag shows the token supply and its change since listing, from listing on", () => {
    for (const [w, h] of SIZES) {
      for (const pos of [2.5, 6.5, 7.5, 8]) {
        const frame = storyFrame(m, pos);
        const want = supplyAt(m, frame)!;
        const { container } = render(<CompactTape m={m} frame={frame} w={w} h={h} />);
        const tag = container.querySelector('[data-part="tag-supply"]')!;
        expect(tag.textContent).toContain(TILE_SUPPLY);
        expect(tag.querySelector('[data-part="supply-value"]')!.textContent).toBe(`${(want.share * 100).toFixed(1)}%`);
        expect(tag.querySelector('[data-part="pct-supply"]')!.textContent).toBe(`${formatPctChange(want.pct)} ${SINCE_LISTING}`);
        // Three tags, none overlapping, none on the head dot.
        const boxes = [...container.querySelectorAll('[data-part^="tag-"] > rect, [data-part="tag-price"] > rect')].map((r) => {
          const y = Number(r.getAttribute("y"));
          const x = Number(r.getAttribute("x"));
          return { x, y, r: x + Number(r.getAttribute("width")), b: y + Number(r.getAttribute("height")) };
        });
        expect(boxes.length).toBe(3);
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) expect(boxes[i]!.b <= boxes[j]!.y || boxes[j]!.b <= boxes[i]!.y).toBe(true);
        for (const bx of boxes) expect(bx.x).toBeGreaterThan(w / 2 + 6);
        cleanup();
      }
    }
    const end = render(<CompactTape m={m} frame={storyFrame(m, 8)} w={586} h={484} />).container;
    expect(end.querySelector('[data-part="tag-supply"]')!.textContent).toContain("69.7%");
    expect(end.querySelector('[data-part="pct-supply"]')!.textContent).toBe(`−30% ${SINCE_LISTING}`);
  });

  it("stackTags keeps a column of tags in order, apart and inside its bounds", () => {
    const at = stackTags(
      [
        { want: 100, h: 40 },
        { want: 105, h: 40 },
        { want: 300, h: 30 },
      ],
      0,
      290,
      6,
    );
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(46 - 1e-9);
    expect(at[2]! + 15).toBeLessThanOrEqual(290);
    expect(at[0]).toBe(100);
  });

  it("the separate supply block is gone: no supply row in the stage or the stills, no repeated numbers", () => {
    const { container } = render(<Variant m={m} />);
    expect(container.querySelector('[data-part="supply-slot"]')).toBeNull();
    expect(container.querySelector('[data-part="supply"]')).toBeNull();
    expect(container.querySelectorAll('[data-part="tag-supply"]')).toHaveLength(1);
    cleanup();
    reduceMotion = true;
    render(<Variant m={m} />);
    const figures = screen.getByTestId("story-stills").querySelectorAll("figure");
    expect(figures).toHaveLength(8);
    figures.forEach((f, i) => {
      expect(f.querySelector('[data-part="supply"]')).toBeNull();
      expect(!!f.querySelector('[data-part="tag-supply"]'), `still ${i}`).toBe(i >= 2);
    });
  });

  it("redeem: the price tag stays at full strength (only its dot dims with the price line)", () => {
    const frame = storyFrame(m, 7.9);
    expect(frame.priceOpacity).toBeLessThan(1);
    const { container } = render(<CompactTape m={m} frame={frame} w={586} h={484} />);
    expect(container.querySelector('[data-part="tag-price"]')!.getAttribute("opacity")).toBeNull();
    expect(Number(container.querySelector('[data-part="price-head"]')!.getAttribute("opacity"))).toBeLessThan(1);
  });
});
