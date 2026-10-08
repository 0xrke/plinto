import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, beatCaption, storyFrame } from "../shared";
import { cameraAt, closeness, lerpAxis } from "./camera";
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

describe("v03 cinematic", () => {
  it("renders one subtitle and one runway step per beat, with its caption", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const sub = container.querySelector(`[data-beat="${key}"]`);
      expect(sub?.textContent).toContain(beatCaption(m, key));
      expect(steps[i]!.textContent).toContain(beatCaption(m, key));
    });
    // The subtitles read the driver's --qN from their own [data-rail] layer.
    expect(container.querySelector("[data-rail]")?.querySelectorAll("[data-beat]")).toHaveLength(BEAT_KEYS.length);
    // First paint is the finished frame: the floor is a staircase, the real-scale label is up.
    const floor = container.querySelector('[data-part="floor-steps"]');
    expect((floor?.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(8);
    expect(screen.getByText("Close-up · real scale")).toBeTruthy();
  });

  it("renders static frames under reduced motion", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
  });

  it("keeps the price head in frame at every scroll position, wide on the pump and close on the bounce", () => {
    for (let pos = 0; pos <= 8; pos += 0.01) {
      const f = storyFrame(m, pos);
      const c = cameraAt(m, f);
      expect(c.x1).toBeGreaterThan(c.x0);
      expect(c.y1).toBeGreaterThan(c.y0);
      expect(f.t).toBeGreaterThanOrEqual(c.x0);
      expect(f.t).toBeLessThanOrEqual(c.x1);
      expect(f.valueOf100).toBeGreaterThanOrEqual(c.y0);
      expect(f.valueOf100).toBeLessThanOrEqual(c.y1);
    }
    expect(closeness(cameraAt(m, storyFrame(m, 3)))).toBe(0);
    expect(closeness(cameraAt(m, storyFrame(m, 6)))).toBe(1);
    // The arbitrage line and the dip are in the bounce shot.
    const b = storyFrame(m, 6);
    const cb = cameraAt(m, b);
    expect(b.arbLine100! > cb.y0 && b.arbLine100! < cb.y1).toBe(true);
    expect(b.dip!.value > cb.y0).toBe(true);
  });

  it("interpolates an axis from shot to shot, exact at both ends", () => {
    expect(lerpAxis(0, 460, 34, 38, 0)).toEqual([0, 460]);
    const [lo, hi] = lerpAxis(0, 460, 34, 38, 1);
    expect(lo).toBeCloseTo(34, 9);
    expect(hi).toBeCloseTo(38, 9);
    const [mlo, mhi] = lerpAxis(0, 460, 34, 38, 0.5);
    expect(mlo).toBeLessThan(36);
    expect(mhi).toBeGreaterThan(36);
  });
});
