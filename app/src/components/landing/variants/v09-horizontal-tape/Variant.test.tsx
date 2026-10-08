import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, TILE_FLOOR, TILE_NOW, beatCaption, storyFrame } from "../shared";
import { beatBounds, layoutTags, niceTicks, showsIllustration } from "./geometry";
import { tapeSpan } from "./Tape";
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

describe("v09 horizontal tape", () => {
  it("renders every beat's caption on the runway and the tape with both value tags", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    // The finished frame: both tags on the tape, the redeem beat is not illustrative.
    expect(container.textContent).toContain(TILE_NOW);
    expect(container.textContent).toContain(TILE_FLOOR);
    expect(container.querySelector("[data-stage]")).toBeTruthy();
  });

  it("reduced motion: no track, eight static tape frames with their captions", () => {
    reduceMotion = true;
    const { container } = render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    const figures = stills.querySelectorAll("figure");
    expect(figures).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => {
      expect(figures[i]!.textContent).toContain(beatCaption(m, key));
      expect(figures[i]!.querySelector("svg")).toBeTruthy();
    });
    // Illustrated beats carry the label.
    expect(figures[BEAT_KEYS.indexOf("pump")]!.textContent).toContain(ILLUSTRATION);
    expect(figures[BEAT_KEYS.indexOf("presale")]!.textContent).not.toContain(ILLUSTRATION);
    expect(figures[BEAT_KEYS.indexOf("split")]!.textContent).not.toContain(ILLUSTRATION);
    // The made-up path stays on the tape after the pump, so steps and redeem are labelled too.
    expect(figures[BEAT_KEYS.indexOf("steps")]!.textContent).toContain(ILLUSTRATION);
    expect(figures[BEAT_KEYS.indexOf("redeem")]!.textContent).toContain(ILLUSTRATION);
    expect(container.textContent).toContain(TILE_FLOOR);
  });

  it("geometry: beat windows match the engine, tags never overlap", () => {
    const b = beatBounds(m);
    expect(b.start[0]).toBe(0);
    expect(b.end[b.end.length - 1]).toBeCloseTo(storyFrame(m, 8).t);
    expect(b.start[BEAT_KEYS.indexOf("steps")]).toBe(b.end[BEAT_KEYS.indexOf("steps")]);
    const t = layoutTags(100, 104, 36, 0, 300);
    expect(Math.abs((t.floor ?? 0) - t.price)).toBeGreaterThanOrEqual(36);
    expect(niceTicks(0, 120, 4)).toEqual([0, 50, 100]);
  });

  it("illustration label from the pump on; the tape zooms out during steps to hold the whole staircase", () => {
    BEAT_KEYS.forEach((_, i) => expect(showsIllustration(storyFrame(m, i + 0.5))).toBe(i >= BEAT_KEYS.indexOf("pump")));
    for (const compact of [true, false]) {
      expect(tapeSpan(compact, 1)).toBeGreaterThan(tapeSpan(compact, 0));
      // At the end of steps the window behind the playhead reaches back past the first step (t = 1).
      const steps = storyFrame(m, BEAT_KEYS.indexOf("steps") + 1);
      expect(steps.t - tapeSpan(compact, steps.zoom)).toBeLessThan(steps.floorSteps[0]![0]);
    }
  });
});
