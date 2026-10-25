import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEATS } from "@/lib/landing/sim/story";
import { BEAT_KEYS, BEAT_LABELS, ILLUSTRATION, SINCE_LISTING, beatCaption, formatPctChange, sinceListing, storyFrame } from "../shared";
import { SPLIT_DIVIDE, SPLIT_SETTLE, SectionChart, columnGone, panelScales, raisedOf, splitLabels, splitPhase } from "./SectionChart";
import { STEPS_I, headFraction, layoutSections, tagSize } from "./sections";
import Variant from "./Variant";

const m = launchMath(simConstantsFromSdk(), simConstantsFromSdk().defaultVaultSharePct);

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

const yOf = (el: Element) => Number(el.getAttribute("y"));
const hOf = (el: Element) => Number(el.getAttribute("height"));
const css = readFileSync(join(__dirname, "splitSections.module.css"), "utf8");
/** The unmeasured plot (jsdom has no layout): SectionChart's stage fallback box. */
const BOX = { w: 600, h: 600 };
const translate = (el: Element) => {
  const hit = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform);
  return hit ? { x: Number(hit[1]), y: Number(hit[2]) } : null;
};
const chartAt = (pos: number) => render(<SectionChart m={m} frame={storyFrame(m, pos)} />);
/** Mid-beat (finished frame) positions, one per beat. */
const MID = BEAT_KEYS.map((_, i) => i + 0.7);

describe("v30 split sections", () => {
  it("lays out 28's panel with the step bar on top, the chart left and only the caption ribbon right", () => {
    const { container } = render(<Variant m={m} />);
    expect(container.querySelectorAll("[data-brand-chart]")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Follow your $100" })).toBeTruthy();
    // The step bar: one line segment per beat, the current one marked; first paint is the finished frame.
    const rail = screen.getByRole("navigation", { name: "Story steps" });
    expect(within(rail).getAllByRole("button")).toHaveLength(BEAT_KEYS.length);
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    // The rail sits in the header, above the chart.
    const top = rail.closest("div")!;
    const chart = container.querySelector('[data-part="chart-slot"]') as HTMLElement;
    expect(top.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 8 beats, each a runway step carrying its caption, in order.
    const steps = container.querySelectorAll("li[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const cap = steps[i]!.querySelector('[data-part="caption"]') as HTMLElement;
      expect(within(cap).getByText(beatCaption(m, key))).toBeTruthy();
    });
    // The values ride the price head inside the chart and appear nowhere else.
    expect(container.querySelectorAll('[data-part="tile-now"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-part="tile-floor"]')).toHaveLength(1);
    expect(chart.querySelector('[data-part="tag-price"]')).not.toBeNull();
    expect(chart.querySelector('[data-part="tag-floor"]')).not.toBeNull();
    // The chart: a real staircase, the illustration pill, the real-scale chip.
    expect((chart.querySelector('[data-part="floor-steps"]')!.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(4);
    expect(within(chart).getByText(ILLUSTRATION)).toBeTruthy();
    expect(chart.querySelector('[data-part="scale"]')).not.toBeNull();
  });

  it("styles the captions as 21's ribbon: sticky at the right column's top, the read ones fade out, no scroll-snap", () => {
    expect(css).toMatch(/\.cap \{[^}]*position: sticky/);
    expect(css).toMatch(/\.cap \{[^}]*top: calc\(var\(--ep-main-top\) \+ var\(--ep-cap-gap\)\)/);
    expect(css).toMatch(/\.step:has\(~ \.step\[data-active="true"\]\) \.cap \{[^}]*opacity: 0;/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/scroll-snap|scroll-behavior/);
  });

  it("names every beat's section on the strip and marks the current one (white, mint number)", () => {
    const seen = new Set<string>();
    MID.forEach((pos, i) => {
      const { container, unmount } = chartAt(pos);
      const names = [...container.querySelectorAll('[data-part="section-name"]')];
      for (const n of names) seen.add(n.getAttribute("data-beat")!);
      const current = names.filter((n) => n.getAttribute("data-current") === "true");
      expect(current).toHaveLength(1);
      expect(current[0]!.getAttribute("data-beat")).toBe(BEAT_KEYS[i]);
      // The current section keeps its full name: "05 Steps".
      expect(current[0]!.textContent).toBe(`${String(i + 1).padStart(2, "0")} ${BEAT_LABELS[BEAT_KEYS[i]!]}`);
      expect(current[0]!.className).toMatch(/current/);
      // Past and next sections are readable, not hidden: at least one other name is shown.
      expect(names.length).toBeGreaterThan(1);
      // The current section is lit (the steps beat is a moment: its diamond and dashed divider mark it).
      if (i !== STEPS_I) expect(container.querySelector('[data-part="section-current"]')!.getAttribute("data-beat")).toBe(BEAT_KEYS[i]);
      unmount();
    });
    expect([...seen].sort()).toEqual([...BEAT_KEYS].sort());
    expect(css).toMatch(/\.current \.secNum \{[^}]*--color-mint/);
    expect(css).toMatch(/\.current \{[^}]*--color-white/);
  });

  it("follows the camera: out-of-view sections lose their names, names never collide, narrow ones show the number", () => {
    // Zoomed in on the staircase, the presale is out of view.
    {
      const { container, unmount } = chartAt(8);
      const beats = [...container.querySelectorAll('[data-part="section-name"]')].map((n) => n.getAttribute("data-beat"));
      expect(beats).not.toContain("presale");
      unmount();
    }
    for (const w of [280, 420, 600, 760]) {
      for (let pos = 0; pos <= 8; pos += 0.05) {
        const f = storyFrame(m, pos);
        const s = panelScales(f, headFraction(w, tagSize(w < 440)));
        const px = BEATS.map((b) => ({ x0: (s.pctX(b.start) / 100) * w, x1: (s.pctX(b.end) / 100) * w }));
        const names = layoutSections(px, w, f.beatIndex, w < 440).filter((n) => n.level !== "hidden");
        names.sort((a, b) => a.left - b.left);
        for (let k = 1; k < names.length; k++) {
          expect(names[k - 1]!.left + names[k - 1]!.width).toBeLessThanOrEqual(names[k]!.left);
          // Names read in beat order.
          expect(names[k - 1]!.i).toBeLessThan(names[k]!.i);
        }
        for (const n of names) {
          expect(n.left).toBeGreaterThanOrEqual(0);
          expect(n.left + n.width).toBeLessThanOrEqual(w);
          // A shown name belongs to a section that is in view.
          if (n.i !== STEPS_I) expect(Math.min(n.i === BEATS.length - 1 ? w : px[n.i]!.x1, w)).toBeGreaterThan(Math.max(px[n.i]!.x0, 0));
        }
        expect(names.some((n) => n.i === f.beatIndex)).toBe(true);
      }
    }
    // A band too narrow for its name shows only its number.
    const narrow = layoutSections(
      BEATS.map((_, i) => ({ x0: i * 40, x1: i === STEPS_I ? i * 40 : (i + 1) * 40 })),
      600,
      7,
      false,
    );
    expect(narrow.some((n) => n.level === "num" && n.text === "01")).toBe(true);
  });

  it("shows no change since listing before trading opens", () => {
    for (const pos of [0, 0.5, 1, 1.5, 1.99]) {
      const { container, unmount } = chartAt(pos);
      expect(container.querySelector('[data-part="tag-price"] [data-part="tile-now"]')!.textContent).toBe("$100.00");
      expect(container.querySelector('[data-part="since-now"]')).toBeNull();
      expect(container.querySelector('[data-part="since-floor"]')).toBeNull();
      expect(container.textContent).not.toContain(SINCE_LISTING);
      unmount();
    }
  });

  it("shows the values and the change since listing in the tooltips once trading opens", () => {
    // Pump finished: the price is far up (floor green), the floor has not fallen.
    {
      const frame = storyFrame(m, 3);
      const change = sinceListing(m, frame);
      const { container, unmount } = chartAt(3);
      const now = container.querySelector('[data-part="since-now"]')!;
      const floor = container.querySelector('[data-part="since-floor"]')!;
      expect(now.textContent).toBe(`${formatPctChange(change.now!)} ${SINCE_LISTING}`);
      expect(now.getAttribute("data-sign")).toBe("up");
      expect(now.querySelector("b")!.className).toMatch(/pctUp/);
      expect(floor.querySelector("b")!.className).toMatch(/pctFloor/);
      expect(container.querySelector('[data-part="tile-floor"]')!.textContent).toMatch(/^\$\d+\.\d\d$/);
      unmount();
    }
    // Steps finished: the price is well below listing (coral, true minus), the floor up from fees.
    {
      const frame = storyFrame(m, 5);
      const change = sinceListing(m, frame);
      const { container, unmount } = chartAt(5);
      const now = container.querySelector('[data-part="since-now"]')!;
      expect(now.textContent).toMatch(/^−\d/);
      expect(now.getAttribute("data-sign")).toBe("down");
      expect(now.querySelector("b")!.className).toMatch(/pctDown/);
      expect(container.querySelector('[data-part="since-floor"]')!.textContent).toBe(`${formatPctChange(change.floor!)} ${SINCE_LISTING}`);
      unmount();
    }
    // Redeemed: the price tag says so and has no percent; the floor keeps its own.
    {
      const { container, unmount } = chartAt(8);
      expect(container.querySelector('[data-part="tile-now"]')!.textContent).toBe("Redeemed");
      expect(container.querySelector('[data-part="since-now"]')).toBeNull();
      expect(container.querySelector('[data-part="since-floor"]')!.textContent).toMatch(/^\+[\d.]+% since listing$/);
      unmount();
    }
    expect(css).toMatch(/\.pctDown \{[^}]*--color-risk\)/);
    expect(css).toMatch(/\.pctUp \{[^}]*--color-floor\)/);
  });

  it("keeps the tooltips inside the card, right of the head dot and clear of the bounce", () => {
    for (let pos = 0; pos <= 8; pos += 0.1) {
      const f = storyFrame(m, pos);
      const s = panelScales(f, headFraction(BOX.w, tagSize(false)));
      const headX = (Math.min(100, Math.max(0, s.pctX(f.t))) / 100) * BOX.w;
      const { container, unmount } = chartAt(pos);
      const tags = [...container.querySelectorAll('[data-part^="tag-"]')] as HTMLElement[];
      expect(tags.length).toBeGreaterThan(0);
      const boxes = tags.map((t) => ({ ...translate(t)!, w: parseFloat(t.style.width), h: parseFloat(t.style.height) }));
      for (const b of boxes) {
        expect(b.x, `pos ${pos.toFixed(2)}`).toBeGreaterThanOrEqual(headX + 8);
        expect(b.x + b.w).toBeLessThanOrEqual(BOX.w);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h).toBeLessThanOrEqual(BOX.h);
        if (f.dip) expect(b.x).toBeGreaterThan((s.pctX(f.dip.t) / 100) * BOX.w + 8);
      }
      // Two tooltips never overlap.
      if (boxes.length === 2) {
        const [a, b] = boxes as [(typeof boxes)[0], (typeof boxes)[0]];
        expect(a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
      unmount();
    }
    // The head never sits left of the middle (on a plot too narrow for the room, the tooltip flips left).
    expect(headFraction(200, tagSize(true))).toBe(0.5);
  });

  it("fills the raise as its own sky bar, then divides it into the labelled vertical column", () => {
    {
      const { container, unmount } = chartAt(0.5);
      expect(container.querySelectorAll('[data-part="raise-column"] rect')).toHaveLength(1);
      expect(container.querySelector('[data-part="raised"]')!.textContent).toMatch(/^Raised \$[\d,]+of \$10,000$/);
      expect(raisedOf(m)).toBe("of $10,000");
      unmount();
    }
    const { container } = chartAt(1.4);
    const floor = container.querySelector('[data-part="split-floor"]')!;
    const market = container.querySelector('[data-part="split-market"]')!;
    const fees = container.querySelector('[data-part="split-creator"]')!;
    expect(yOf(floor)).toBeGreaterThan(yOf(market));
    expect(yOf(market)).toBeGreaterThan(yOf(fees));
    expect(hOf(market)).toBeGreaterThan(hOf(fees));
    const labels = splitLabels(m);
    expect(labels).toEqual({ floor: "Floor 50%", market: "Market 40%", fees: "Fees 5% · 5%" });
    for (const text of Object.values(labels)) expect(screen.getByText(text)).toBeTruthy();
    expect(floor.getAttribute("style") ?? "").toContain("--color-mint");
    expect(market.getAttribute("style") ?? "").toContain("--color-iris");
    expect(fees.getAttribute("style") ?? "").toContain("--color-butter");
  });

  it("holds the labelled column, settles the floor onto the slab, and fades the column early in the pump", () => {
    expect(SPLIT_DIVIDE[1]).toBeLessThan(SPLIT_SETTLE[0]);
    expect(splitPhase(storyFrame(m, 1 + (SPLIT_DIVIDE[1] + SPLIT_SETTLE[0]) / 2))).toEqual({ grow: 1, reveal: 0 });
    const top = (pos: number) => {
      const { container, unmount } = chartAt(pos);
      const out = yOf(container.querySelector('[data-part="split-floor"]')!);
      unmount();
      return out;
    };
    expect(top(2)).toBeGreaterThan(top(1.4));
    expect(top(2)).toBeCloseTo(panelScales(storyFrame(m, 2), headFraction(BOX.w, tagSize(false))).yOf(m.floorPer100GrossUsd), 3);
    expect(columnGone(storyFrame(m, 2))).toBe(0);
    expect(columnGone(storyFrame(m, 2.5))).toBe(1);
  });

  it("keeps the presale and the split in one fixed frame, and the frame continuous after", () => {
    const a = panelScales(storyFrame(m, 0.3));
    const b = panelScales(storyFrame(m, 1.9));
    for (const t of [0, 1, 2]) expect(a.pctX(t)).toBeCloseTo(b.pctX(t), 6);
    for (let i = 1; i < BEAT_KEYS.length; i++) {
      const c = panelScales(storyFrame(m, i));
      const d = panelScales(storyFrame(m, i + 1e-9));
      for (const t of [0, 2, 5, 9]) expect(c.pctX(t)).toBeCloseTo(d.pctX(t), 4);
    }
  });

  it("renders static frames under reduced motion", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(BEAT_KEYS.length);
    // Each still keeps its sections and its tooltips; the split still shows the labelled column.
    expect(stills.querySelectorAll('[data-part="sections"]')).toHaveLength(BEAT_KEYS.length);
    expect(stills.querySelectorAll('[data-part="tag-price"]')).toHaveLength(BEAT_KEYS.length);
    expect(within(stills).getByText("Market 40%")).toBeTruthy();
    expect(stills.querySelectorAll('[data-part="since-floor"]').length).toBeGreaterThan(0);
  });
});
