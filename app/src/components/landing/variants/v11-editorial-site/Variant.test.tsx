import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, beatCaption, storyFrame } from "../shared";
import { BEATS, storyValueAt } from "@/lib/landing/sim/story";
import { SiteEditorialChart, landedValue, spreadLabels } from "./SiteEditorialChart";
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

describe("v11 Editorial · site style", () => {
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
    const { container } = render(<SiteEditorialChart m={m} frame={storyFrame(m, 6)} />);
    expect(Number(container.querySelector('[data-part="floor-steps"]')!.getAttribute("data-vertices"))).toBeGreaterThan(4);
    expect(container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
    expect(container.querySelector('[data-part="illustration"]')!.textContent).toBe(ILLUSTRATION);
    expect(container.querySelector('[data-part="scale"]')!.textContent).toBe(REAL_SCALE_LABEL);
    cleanup();
    const presale = render(<SiteEditorialChart m={m} frame={storyFrame(m, 1)} />);
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
    const dip = render(<SiteEditorialChart m={m} frame={storyFrame(m, 5.5)} />);
    expect(dip.container.querySelector('[data-part="arb-strip"]')).toBeTruthy();
  });

  it("spreads x-axis labels so neighbours keep a gap and stay inside the axis", () => {
    const xs = spreadLabels([10, 100, 100, 140], [20, 30, 30, 40], 0, 170, 12);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(25 + 12 - 1e-9);
    expect(xs[3]! + 20).toBeLessThanOrEqual(170 + 1e-9);
  });
});
