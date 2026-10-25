import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, SINCE_LISTING, beatCaption, formatPctChange, sinceListing, storyFrame } from "../shared";
import { PanelChart, SPLIT_DIVIDE, SPLIT_SETTLE, columnGone, floorPaysLabel, panelScales, raisedOf, splitLabels, splitPhase } from "./PanelChart";
import Variant, { Metrics } from "./Variant";

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
const css = readFileSync(join(__dirname, "editorialPanel.module.css"), "utf8");

describe("v28 editorial panel", () => {
  it("lays out 25's panel unboxed: title, rail, one midnight chart, the metrics, and the captions as the runway", () => {
    const { container } = render(<Variant m={m} />);
    // No cloud panel and no white card: the chart card is the one surface.
    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".bg-cloud")).toBeNull();
    expect(container.querySelectorAll("[data-brand-chart]")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Follow your $100" })).toBeTruthy();
    // The rail: one line segment per beat; the server/first paint is the finished frame.
    const rail = screen.getByRole("navigation", { name: "Story steps" });
    expect(within(rail).getAllByRole("button")).toHaveLength(BEAT_KEYS.length);
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    // The ribbon: every beat's caption is its own runway step, in order (they scroll past natively).
    const steps = container.querySelectorAll("li[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const cap = steps[i]!.querySelector('[data-part="caption"]') as HTMLElement;
      expect(cap).not.toBeNull();
      expect(within(cap).getByText(beatCaption(m, key))).toBeTruthy();
    });
    // The chart: a real staircase, the illustration pill, the real-scale chip.
    const chart = container.querySelector('[data-part="chart-slot"]') as HTMLElement;
    expect(((chart.querySelector('[data-part="floor-steps"]')!.getAttribute("d") ?? "").split("L").length)).toBeGreaterThan(4);
    expect(within(chart).getByText(ILLUSTRATION)).toBeTruthy();
    expect(chart.querySelector('[data-part="scale"]')).not.toBeNull();
    // The metrics: both values, the floor in dollars.
    expect(container.querySelector('[data-part="tile-now"]')!.textContent).toBe("Redeemed");
    expect(container.querySelector('[data-part="tile-floor"]')!.textContent).toMatch(/^\$\d/);
  });

  it("styles the captions as 21's ribbon: sticky, the read ones fade out, no scroll-snap", () => {
    expect(css).toMatch(/\.cap \{[^}]*position: sticky/);
    // Wide screens: the metrics head the right column and each caption sticks just under them.
    expect(css).toMatch(/\.metrics \{[^}]*height: var\(--ep-metrics-h\)/);
    expect(css).toMatch(/\.cap \{[^}]*top: calc\(var\(--ep-main-top\) \+ var\(--ep-metrics-h\) \+ var\(--ep-cap-gap\)\)/);
    expect(css).toMatch(/\.step:has\(~ \.step\[data-active="true"\]\) \.cap \{[^}]*opacity: 0;/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/scroll-snap|scroll-behavior/);
  });

  it("shows no change since listing before trading opens", () => {
    for (const pos of [0, 0.5, 1, 1.5, 1.99]) {
      const { container, unmount } = render(<Metrics m={m} frame={storyFrame(m, pos)} />);
      expect(container.querySelector('[data-part="since-now"]')).toBeNull();
      expect(container.querySelector('[data-part="since-floor"]')).toBeNull();
      expect(container.textContent).not.toContain(SINCE_LISTING);
      unmount();
    }
  });

  it("shows the change since listing once trading opens, with the right signs and colours", () => {
    const at = (pos: number) => {
      const frame = storyFrame(m, pos);
      const change = sinceListing(m, frame);
      const view = render(<Metrics m={m} frame={frame} />);
      return { change, view, now: view.container.querySelector('[data-part="since-now"]'), floor: view.container.querySelector('[data-part="since-floor"]') };
    };
    // Pump finished: the price is far up (floor green), the floor has not fallen.
    {
      const { change, view, now, floor } = at(3);
      expect(change.now!).toBeGreaterThan(0);
      expect(now!.textContent).toBe(`${formatPctChange(change.now!)} ${SINCE_LISTING}`);
      expect(now!.textContent).toMatch(/^\+/);
      expect(now!.getAttribute("data-sign")).toBe("up");
      expect(now!.className).toContain("text-floor");
      expect(floor!.className).toContain("text-floor");
      expect(change.floor!).toBeGreaterThanOrEqual(0);
      view.unmount();
    }
    // Steps finished: the price is well below listing (coral, true minus), the floor up from fees.
    {
      const { change, view, now, floor } = at(5);
      expect(change.now!).toBeLessThan(0);
      expect(now!.textContent).toMatch(/^−\d/);
      expect(now!.getAttribute("data-sign")).toBe("down");
      expect(now!.className).toContain("text-risk");
      expect(change.floor!).toBeGreaterThan(0);
      expect(floor!.textContent).toBe(`${formatPctChange(change.floor!)} ${SINCE_LISTING}`);
      expect(floor!.textContent).toMatch(/^\+/);
      expect(floor!.className).toContain("text-floor");
      view.unmount();
    }
    // Redeemed: the price has no percent (the value says "Redeemed"), the floor keeps its own.
    {
      const { view, now, floor } = at(8);
      expect(view.container.querySelector('[data-part="tile-now"]')!.textContent).toBe("Redeemed");
      expect(now).toBeNull();
      expect(floor!.textContent).toMatch(/^\+[\d.]+% since listing$/);
      view.unmount();
    }
  });

  it("fills the raise as its own solid sky bar from $0, labelled Raised $X of $10,000", () => {
    const at = (pos: number) => render(<PanelChart m={m} frame={storyFrame(m, pos)} />);
    {
      const { container, unmount } = at(0);
      expect(container.querySelector('[data-part="raised"]')!.textContent).toBe(`Raised $0${raisedOf(m)}`);
      unmount();
    }
    const { container } = at(0.5);
    const raise = container.querySelector('[data-part="raise"]')!;
    expect(raise.tagName.toLowerCase()).toBe("rect");
    expect(hOf(raise)).toBeGreaterThan(0);
    // One bar, no backdrop: the fill is the column's only rect, in the solid presale sky.
    expect(container.querySelectorAll('[data-part="raise-column"] rect')).toHaveLength(1);
    expect(raise.getAttribute("style") ?? "").toContain("--color-presale-ring");
    expect(raisedOf(m)).toBe("of $10,000");
    expect(container.querySelector('[data-part="raised"]')!.textContent).toMatch(/^Raised \$[\d,]+of \$10,000$/);
  });

  it("divides the same bar at the split: same x and width on both sides of the boundary", () => {
    const box = (pos: number, part: string) => {
      const { container, unmount } = render(<PanelChart m={m} frame={storyFrame(m, pos)} />);
      const el = container.querySelector(`[data-part="${part}"]`)!;
      const out = { x: Number(el.getAttribute("x")), w: Number(el.getAttribute("width")) };
      unmount();
      return out;
    };
    const a = box(1 - 1e-6, "raise");
    for (const part of ["split-floor", "split-market", "split-creator"]) {
      const b = box(1 + 1e-6, part);
      expect(b.x).toBeCloseTo(a.x, 4);
      expect(b.w).toBeCloseTo(a.w, 4);
    }
  });

  it("holds the labelled, divided column before the floor settles", () => {
    expect(SPLIT_DIVIDE[1]).toBeLessThan(SPLIT_SETTLE[0]);
    const mid = splitPhase(storyFrame(m, 1 + (SPLIT_DIVIDE[1] + SPLIT_SETTLE[0]) / 2));
    expect(mid).toEqual({ grow: 1, reveal: 0 });
    expect(splitPhase(storyFrame(m, 0.5))).toEqual({ grow: 0, reveal: 0 });
    expect(splitPhase(storyFrame(m, 2.5))).toEqual({ grow: 1, reveal: 1 });
    expect(splitPhase(storyFrame(m, 2)).reveal).toBeCloseTo(1, 6);
  });

  it("splits the raise into a vertical column: floor at the bottom, market above, fees on top, labelled", () => {
    const { container } = render(<PanelChart m={m} frame={storyFrame(m, 1.4)} />);
    const floor = container.querySelector('[data-part="split-floor"]')!;
    const market = container.querySelector('[data-part="split-market"]')!;
    const fees = container.querySelector('[data-part="split-creator"]')!;
    // SVG y grows downwards: the floor is lowest, the fees highest; all share the column's x.
    expect(yOf(floor)).toBeGreaterThan(yOf(market));
    expect(yOf(market)).toBeGreaterThan(yOf(fees));
    expect(floor.getAttribute("x")).toBe(market.getAttribute("x"));
    expect(hOf(market)).toBeGreaterThan(hOf(fees));
    const labels = splitLabels(m);
    expect(labels.floor).toBe("Floor 50%");
    expect(labels.market).toBe("Market 40%");
    expect(labels.fees).toBe("Fees 5% · 5%");
    for (const text of Object.values(labels)) expect(screen.getByText(text)).toBeTruthy();
    expect(floor.getAttribute("style") ?? "").toContain("--color-mint");
    expect(market.getAttribute("style") ?? "").toContain("--color-iris");
    expect(fees.getAttribute("style") ?? "").toContain("--color-butter");
  });

  it("settles the floor segment onto the floor slab, then fades the column out early in the pump", () => {
    const top = (pos: number) => {
      const { container, unmount } = render(<PanelChart m={m} frame={storyFrame(m, pos)} />);
      const el = container.querySelector('[data-part="split-floor"]')!;
      const out = yOf(el);
      unmount();
      return out;
    };
    // The floor's top drops (its SVG y grows) as the beat finishes, onto the floor per $100.
    expect(top(2)).toBeGreaterThan(top(1.4));
    const end = storyFrame(m, 2);
    const s = panelScales(end);
    expect(top(2)).toBeCloseTo(s.yOf(m.floorPer100GrossUsd), 3);
    // The split still (pos 2) keeps the column; the pump fades it, and later beats never draw it.
    expect(columnGone(end)).toBe(0);
    expect(columnGone(storyFrame(m, 2.5))).toBe(1);
    // The settled slab is named with what it pays back, matching the "Floor pays back" tile.
    {
      const { container, unmount } = render(<PanelChart m={m} frame={end} />);
      expect(container.querySelector('[data-part="label-slab"]')!.textContent).toBe(floorPaysLabel(end.floorNet100!));
      unmount();
    }
    const { container } = render(<PanelChart m={m} frame={storyFrame(m, 5)} />);
    expect(container.querySelector('[data-part="raise-column"]')).toBeNull();
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
    // The split still shows the labelled column; later stills carry the change since listing.
    expect(within(stills).getByText("Market 40%")).toBeTruthy();
    expect(stills.querySelectorAll('[data-part="since-floor"]').length).toBeGreaterThan(0);
  });
});
