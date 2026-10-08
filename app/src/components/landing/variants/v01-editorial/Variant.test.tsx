import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, beatCaption, storyFrame } from "../shared";
import { EditorialChart } from "./EditorialChart";
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
  vi.restoreAllMocks();
});

describe("v01 Editorial", () => {
  it("renders each beat's caption in order, on the motion track", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll<HTMLElement>("[data-step]");
    expect(steps).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    expect(screen.queryByTestId("story-stills")).toBeNull();
  });

  it("reduced motion renders eight static frames and no track", () => {
    reduceMotion = true;
    const { container } = render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    expect(stills.querySelectorAll('[data-chart="still"]')).toHaveLength(8);
    for (const key of BEAT_KEYS) expect(stills.textContent).toContain(beatCaption(m, key));
    expect(container.querySelectorAll('[data-part="floor-steps"]').length).toBeGreaterThan(0);
  });

  it("draws the floor as a staircase, labels illustration and real scale, bounces off the arbitrage line", () => {
    const bounce = storyFrame(m, 6);
    const { container } = render(<EditorialChart m={m} frame={bounce} />);
    const floor = container.querySelector('[data-part="floor-steps"]')!;
    expect(Number(floor.getAttribute("data-vertices"))).toBeGreaterThan(4);
    expect(container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
    expect(container.textContent).toContain(ILLUSTRATION);
    expect(container.textContent).toContain(REAL_SCALE_LABEL);
    cleanup();
    const presale = render(<EditorialChart m={m} frame={storyFrame(m, 1)} />);
    expect(presale.container.textContent).not.toContain(ILLUSTRATION);
    expect(presale.container.querySelector('[data-part="now"]')!.textContent).toBe("$100.00");
  });

  it("keeps the Illustration tag whenever the made-up price path is drawn", () => {
    for (const pos of [3, 4, 5, 6, 7, 8]) {
      const { container } = render(<EditorialChart m={m} frame={storyFrame(m, pos)} />);
      expect(container.querySelector('[data-part="price"]')).toBeTruthy();
      expect(container.querySelector('[data-part="illustration"]'), `pos ${pos}`).toBeTruthy();
      cleanup();
    }
  });

  it("shows the presale raise on its own 0..100% bar and fills only the floor wash at the bounce", () => {
    const presale = render(<EditorialChart m={m} frame={storyFrame(m, 0.6)} />);
    const bar = presale.container.querySelector('[data-part="raise-bar"]')!;
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain("100%");
    cleanup();
    const bounce = render(<EditorialChart m={m} frame={storyFrame(m, 6)} />);
    expect(bounce.container.querySelector('[data-part="arb-strip"]')).toBeNull();
    expect(bounce.container.querySelector('[data-part="off-scale"]')).toBeTruthy();
    expect(bounce.container.querySelectorAll('[data-part="x-label"]')).toHaveLength(8);
  });

  it("renders a beat index that jumps with native scroll", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<Variant m={m} />);
    const nav = screen.getByRole("navigation", { name: "Story steps" });
    const buttons = nav.querySelectorAll("button");
    expect(buttons).toHaveLength(8);
    buttons[3]!.click();
    expect(scrollTo).toHaveBeenCalled();
  });
});
