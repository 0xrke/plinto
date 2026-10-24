import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, beatCaption, storyFrame } from "../shared";
import { BEATS, storyValueAt } from "@/lib/landing/sim/story";
import { EditorialPlusChart, columnSegments, landedValue, splitPhases, spreadLabels } from "./EditorialPlusChart";
import Variant from "./Variant";

const k = simConstantsFromSdk();
const m = launchMath(k, k.defaultVaultSharePct);
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
  vi.stubGlobal("requestAnimationFrame", () => 0);
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

describe("v21 Editorial plus", () => {
  it("renders each beat's caption in order on the motion track, with the beat index", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll<HTMLElement>("[data-step]");
    expect(steps).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    expect(screen.queryByTestId("story-stills")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Story steps" }).querySelectorAll("button")).toHaveLength(8);
    expect(container.querySelector("[data-brand-chart]")).toBeTruthy();
  });

  it("reduced motion renders eight static frames in still chart cards and no track", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    expect(stills.querySelectorAll('[data-chart="still"]')).toHaveLength(8);
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(8);
    for (const key of BEAT_KEYS) expect(stills.textContent).toContain(beatCaption(m, key));
    expect(stills.querySelectorAll('[data-part="floor-steps"]').length).toBeGreaterThan(0);
  });

  it("bounce frame: floor staircase, arbitrage line, bounce dot, Illustration and real-scale chips", () => {
    const { container } = render(<EditorialPlusChart m={m} frame={storyFrame(m, 6)} />);
    expect(Number(container.querySelector('[data-part="floor-steps"]')!.getAttribute("data-vertices"))).toBeGreaterThan(4);
    expect(container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
    expect(container.querySelector('[data-part="illustration"]')!.textContent).toBe(ILLUSTRATION);
    expect(container.querySelector('[data-part="scale"]')!.textContent).toBe(REAL_SCALE_LABEL);
    cleanup();
    const presale = render(<EditorialPlusChart m={m} frame={storyFrame(m, 1)} />);
    expect(presale.container.querySelector('[data-part="illustration"]')).toBeNull();
    expect(presale.container.querySelector('[data-part="now"]')!.textContent).toBe("$100.00");
  });

  it("draws the bounce landing on the arbitrage line, never under it, and leaves every other beat alone", () => {
    const bounce = BEATS.find((b) => b.key === "bounce")!;
    const fb = storyValueAt(m, bounce.start);
    let min = Infinity;
    for (let i = 0; i <= 600; i++) {
      const t = bounce.start + ((bounce.end - bounce.start) * i) / 600;
      min = Math.min(min, landedValue(m, t, storyValueAt(m, t)));
    }
    expect(min).toBeCloseTo(fb * m.arbLineRatio, 9);
    for (const t of [0, 3, bounce.start, bounce.end, bounce.end + 0.3, 9.4]) {
      expect(landedValue(m, t, storyValueAt(m, t))).toBe(storyValueAt(m, t));
    }
    const dip = render(<EditorialPlusChart m={m} frame={storyFrame(m, 5.5)} />);
    expect(dip.container.querySelector('[data-part="arb-strip"]')).toBeTruthy();
  });

  it("spreads x-axis labels so neighbours keep a gap and stay inside the axis", () => {
    const xs = spreadLabels([10, 100, 100, 140], [20, 30, 30, 40], 0, 170, 12);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(25 + 12 - 1e-9);
    expect(xs[3]! + 20).toBeLessThanOrEqual(170 + 1e-9);
  });

  it("presale: the raise is its own vertical column that fills from $0, labelled directly, apart from the price line", () => {
    const at = (pos: number) => render(<EditorialPlusChart m={m} frame={storyFrame(m, pos)} />).container;
    const half = at(0.5);
    const col = half.querySelector('[data-part="raise-column"]')!;
    expect(col).toBeTruthy();
    expect(col.closest('[data-part="price"]')).toBeNull();
    expect(half.querySelector('[data-part="raise-bar"]')).toBeNull();
    const halfH = Number(half.querySelector('[data-part="raise-fill"]')!.getAttribute("height"));
    expect(half.querySelector('[data-part="raise-label"]')!.textContent).toMatch(/^Raised \$[\d,]+ of \$10,000$/);
    cleanup();
    const full = at(0.98);
    const fullH = Number(full.querySelector('[data-part="raise-fill"]')!.getAttribute("height"));
    expect(halfH).toBeGreaterThan(0);
    expect(fullH).toBeGreaterThan(halfH);
    expect(full.querySelector('[data-part="split-column"]')).toBeNull();
  });

  it("presale to split is continuous: the same column, same x and width, divides", () => {
    const at = (pos: number) => render(<EditorialPlusChart m={m} frame={storyFrame(m, pos)} />).container;
    const pre = at(1).querySelector('[data-part="raise-fill"]')!;
    const box = ["x", "width"].map((a) => Number(pre.getAttribute(a)));
    const preTop = Number(pre.getAttribute("y"));
    cleanup();
    const split = at(1.001);
    for (const part of ["split-floor", "split-market", "split-platform"]) {
      const el = split.querySelector(`[data-part="${part}"]`)!;
      expect(["x", "width"].map((a) => Number(el.getAttribute(a)))).toEqual(box);
    }
    expect(Number(split.querySelector('[data-part="split-platform"]')!.getAttribute("y"))).toBeCloseTo(preTop, 0);
    expect(split.querySelector('[data-part="raise-column"]')).toBeNull();
  });

  it("split beat: a tall stacked column of floor, market and fees with big direct labels", () => {
    const { container } = render(<EditorialPlusChart m={m} frame={storyFrame(m, 1.4)} />);
    for (const part of ["split-floor", "split-market", "split-creator", "split-platform"]) {
      expect(container.querySelector(`[data-part="${part}"]`)).toBeTruthy();
    }
    expect(container.querySelector('[data-part="split-label-floor"]')!.textContent).toContain("Floor 50%");
    expect(container.querySelector('[data-part="split-label-market"]')!.textContent).toContain("Market 40%");
    expect(container.querySelector('[data-part="split-label-fees"]')!.textContent).toContain("Fees 5% · 5%");
    // Stacked bottom to top: floor under market under fees, all inside the plot.
    const y = (part: string) => Number(container.querySelector(`[data-part="${part}"]`)!.getAttribute("y"));
    expect(y("split-floor")).toBeGreaterThan(y("split-market"));
    expect(y("split-market")).toBeGreaterThan(y("split-creator"));
    const segs = columnSegments(m);
    expect(segs[segs.length - 1]!.to).toBeCloseTo(1, 9);
  });

  it("the floor segment settles onto the slab: it drops, slides across onto it and hands over to the staircase", () => {
    const at = (pos: number) => render(<EditorialPlusChart m={m} frame={storyFrame(m, pos)} />).container;
    const full = at(1.42).querySelector('[data-part="split-floor"]')!;
    const fullY = Number(full.getAttribute("y"));
    const fullX = Number(full.getAttribute("x"));
    cleanup();
    const landed = at(1.95).querySelector('[data-part="split-floor"]')!;
    expect(Number(landed.getAttribute("y"))).toBeGreaterThan(fullY);
    // The column stands in the presale slot; the slab starts at graduation, to its right.
    expect(Number(landed.getAttribute("x"))).toBeGreaterThan(fullX);
    const p0 = splitPhases(storyFrame(m, 1.3));
    const p1 = splitPhases(storyFrame(m, 1.97));
    expect(p0.drop).toBe(0);
    expect(p1.land).toBeGreaterThan(0.5);
    expect(splitPhases(storyFrame(m, 3)).land).toBe(1);
  });
});
