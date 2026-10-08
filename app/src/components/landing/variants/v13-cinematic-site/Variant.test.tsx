import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, REAL_SCALE_LABEL, beatCaption } from "../shared";
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

describe("v13 cinematic (site style)", () => {
  it("renders one subtitle and one runway step per beat, on the brand chart card", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    const rail = container.querySelector("[data-rail]");
    BEAT_KEYS.forEach((key, i) => {
      expect(rail?.querySelector(`[data-beat="${key}"]`)?.textContent).toContain(beatCaption(m, key));
      expect(steps[i]!.textContent).toContain(beatCaption(m, key));
    });
    // The screen is the site's midnight card; first paint is the finished frame (pos 8).
    const card = container.querySelector("[data-brand-chart]");
    expect(card).toBeTruthy();
    const floor = card!.querySelector('[data-part="floor-steps"]');
    expect((floor?.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(8);
    expect(card!.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(card!.querySelector('[data-part="illustration"]')).toBeTruthy();
    expect(container.querySelector('[data-part="tile-now"]')).toBeTruthy();
    expect(container.querySelector('[data-part="tile-floor"]')).toBeTruthy();
  });

  it("renders one static frame per beat under reduced motion", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    const figures = stills.querySelectorAll("figure");
    expect(figures).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
    figures.forEach((fig) => {
      expect(fig.querySelector('[data-brand-chart="still"]')).toBeTruthy();
      expect(fig.querySelector('[data-part="tile-floor"]')).toBeTruthy();
    });
  });
});
