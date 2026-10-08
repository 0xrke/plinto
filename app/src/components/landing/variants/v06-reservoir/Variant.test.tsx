import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, beatCaption } from "../shared";
import Variant from "./Variant";
import { niceTicks, scaledStepsFrom, tankBox, timeScale } from "./geometry";

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
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("requestAnimationFrame", () => 1);
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

describe("v06 Reservoir", () => {
  it("renders every beat's caption in order, with the tank stage", () => {
    const { container } = render(<Variant m={m} />);
    const track = screen.getByTestId("story-track");
    const steps = track.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(within(steps[i] as HTMLElement).getByText(beatCaption(m, key))).toBeTruthy());
    expect(screen.queryByTestId("story-stills")).toBeNull();
    // Finished frame on first paint: redeemed, floor shown, real-scale close-up.
    expect(within(track).getByText("Redeemed")).toBeTruthy();
    expect(within(track).getByText("Close-up · real scale")).toBeTruthy();
    expect(container.querySelector("[data-stage] svg")).toBeTruthy();
    // The staircase is drawn on the glass and in the strip, with one riser per floor event.
    const tankSteps = track.querySelector('[data-part="tank-steps-line"]')?.getAttribute("d") ?? "";
    const stripSteps = track.querySelector('[data-part="strip-steps"]')?.getAttribute("d") ?? "";
    expect(tankSteps.split("L").length).toBeGreaterThanOrEqual(1 + 2 * 7);
    expect(stripSteps.split("L").length).toBeGreaterThanOrEqual(1 + 2 * 7);
    // The dip stays marked after the bounce, and the arbitrage line is labelled.
    expect(track.querySelector('[data-part="dip"]')).toBeTruthy();
    expect(within(track).getAllByText("Arbitrage line").length).toBeGreaterThan(0);
    expect(within(track).getAllByText("Price of your $100").length).toBeGreaterThan(0);
  });

  it("reduced motion: no track, one static tank per beat with its caption", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    const figures = stills.querySelectorAll("figure");
    expect(figures).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const fig = figures[i] as HTMLElement;
      expect(within(fig).getByText(beatCaption(m, key))).toBeTruthy();
      expect(fig.querySelector("svg")).toBeTruthy();
    });
    // The pump still is an illustration; the presale still is not.
    expect(within(figures[2] as HTMLElement).getByText("Illustration")).toBeTruthy();
    expect(within(figures[0] as HTMLElement).queryByText("Illustration")).toBeNull();
  });

  it("geometry: phone tank fits 358px with its gauge; ticks are round; arbitrage staircase", () => {
    const b = tankBox(358, 400);
    expect(b.narrow).toBe(true);
    expect(b.gaugeX + 34).toBeLessThanOrEqual(358);
    expect(b.tx0).toBeGreaterThan(b.x0);
    expect(b.tx1).toBeLessThan(b.x1);
    const sx = timeScale(10, 0, 100);
    expect([sx(-1), sx(5), sx(20)]).toEqual([0, 50, 100]);
    const steps: Array<[number, number]> = [[1, 10], [3, 10], [3, 11], [7, 11], [7, 12], [9, 12]];
    expect(scaledStepsFrom(steps, 0.5, 5, 8)).toEqual([[5, 5.5], [7, 5.5], [7, 6], [8, 6]]);
    expect(scaledStepsFrom(steps, 0.5, 5, 4)).toEqual([]);
    expect(niceTicks(33.1, 41.4, 4)).toEqual([35, 40]);
    expect(niceTicks(0, 460, 4)).toEqual([0, 200, 400]);
  });
});
