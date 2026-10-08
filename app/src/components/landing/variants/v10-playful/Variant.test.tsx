import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, beatCaption, ILLUSTRATION, REAL_SCALE_LABEL } from "../shared";
import Variant from "./Variant";
import { T_END, dollarTicks, netPath, netPress, plotFor, scalesFor, treads, xMaxFor } from "./scene";

const m = launchMath(simConstantsFromSdk(), 50);
let reduceMotion = false;

beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduceMotion : true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("v10 playful", () => {
  it("renders every beat's caption in order, with the finished frame's numbers", () => {
    render(<Variant m={m} />);
    const steps = document.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    // First paint is the finished frame: real-scale close-up, the redeem chip.
    expect(screen.getAllByText(REAL_SCALE_LABEL).length).toBeGreaterThan(0);
  });

  it("reduced motion renders eight static frames and no track", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    BEAT_KEYS.forEach((key) => expect(stills.textContent).toContain(beatCaption(m, key)));
    // The made-up beats carry the label.
    expect(stills.textContent).toContain(ILLUSTRATION);
  });

  it("the net dents exactly to the ball at the dip and is taut otherwise", () => {
    const dip = storyFrame(m, 5 + (2 / 6) * 1); // bounce, dip knot (index 2 of 7 knots)
    expect(netPress(dip)).toBeGreaterThan(0.9);
    expect(netPress(storyFrame(m, 8))).toBe(0);
    expect(netPath(0, 100, 50, null)).toBe("M0,50 L100,50");
    expect(netPath(0, 100, 50, { x: 50, y: 70 })).toContain("50.0,70.0");
  });

  it("draws the floor as a rising staircase", () => {
    const runs = treads(storyFrame(m, 8).floorSteps);
    expect(runs.length).toBeGreaterThan(4);
    for (let i = 1; i < runs.length; i++) expect(runs[i]![2]).toBeGreaterThan(runs[i - 1]![2]);
  });

  it("close-up $ ticks are round, inside the band, and 2-4 of them", () => {
    const f = storyFrame(m, 8);
    const { values, label } = dollarTicks(f.y.min, f.y.max);
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values.length).toBeLessThanOrEqual(4);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(f.y.min);
      expect(v).toBeLessThanOrEqual(f.y.max);
      expect(label(v)).toMatch(/^\$\d/);
    }
  });

  it("the time camera keeps the ball ahead of the right edge and ends at the story's end", () => {
    const p = plotFor(640, 420);
    for (const pos of [0.5, 2.9, 3.5, 5.5, 6.5]) {
      const f = storyFrame(m, pos);
      const s = scalesFor(p, f);
      expect(s.x(f.t)).toBeLessThan(p.right - 20);
      expect(s.x(0)).toBe(p.left);
    }
    expect(xMaxFor(storyFrame(m, 8))).toBe(T_END);
  });
});
