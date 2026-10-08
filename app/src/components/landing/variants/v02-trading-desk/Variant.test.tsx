import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, storyFrame } from "@/lib/landing/sim/story";
import { beatCaption } from "../shared";
import { BEAT_START } from "@/lib/landing/sim/timeline";
import { arbStrength, preK, showsIllustration, spreadTags, volumeBars, warpT } from "./deskMath";
import Variant from "./Variant";

const k = simConstantsFromSdk();
const m = launchMath(k, k.defaultVaultSharePct);

let reduce = false;

beforeEach(() => {
  reduce = false;
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
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
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduce : true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("v02 trading desk", () => {
  it("renders every beat's caption in its step", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      expect(within(steps[i] as HTMLElement).getByText(beatCaption(m, key))).toBeTruthy();
    });
    // The rail carries the driver's --qN variables and jumps to each beat.
    expect(container.querySelectorAll("[data-rail] button")).toHaveLength(BEAT_KEYS.length);
  });

  it("reduced motion renders eight static frames and no track", () => {
    reduce = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(stills.querySelectorAll("figure svg")).toHaveLength(BEAT_KEYS.length);
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
  });

  it("volume lane: deposits in the presale, an activity proxy after, pure in pos", () => {
    const end = storyFrame(m, 8);
    const bars = volumeBars(m, end);
    expect(bars.some((b) => b.kind === "deposit")).toBe(true);
    expect(bars.some((b) => b.kind === "down")).toBe(true);
    for (const b of bars) {
      expect(b.v).toBeGreaterThanOrEqual(0);
      expect(b.v).toBeLessThanOrEqual(1);
      if (b.kind !== "deposit") expect(b.t0).toBeGreaterThanOrEqual(BEAT_START.pump);
    }
    expect(Math.max(...bars.filter((b) => b.kind !== "deposit").map((b) => b.v))).toBeCloseTo(1, 9);
    // Scrolling back redraws the same bars.
    const mid = storyFrame(m, 4.3);
    expect(volumeBars(m, storyFrame(m, 4.3))).toEqual(volumeBars(m, mid));
  });

  it("labels the made-up path as an illustration from the pump to the end", () => {
    expect(showsIllustration(storyFrame(m, 1))).toBe(false);
    expect(showsIllustration(storyFrame(m, 2))).toBe(false);
    for (const pos of [2.5, 3, 4, 5, 6, 7, 7.5, 8]) expect(showsIllustration(storyFrame(m, pos))).toBe(true);
  });

  it("arbitrage line is faint before the bounce and full after; the x warp is continuous", () => {
    expect(arbStrength(storyFrame(m, 3))).toBeLessThan(0.5);
    expect(arbStrength(storyFrame(m, 7))).toBe(1);
    expect(preK(storyFrame(m, 2))).toBe(1);
    expect(preK(storyFrame(m, 4))).toBeLessThan(0.5);
    const k = 0.4;
    expect(warpT(BEAT_START.pump - 1e-9, k)).toBeCloseTo(warpT(BEAT_START.pump + 1e-9, k), 6);
  });

  it("price tags never overlap", () => {
    const tags = spreadTags(
      [{ y: 100 }, { y: 104 }, { y: 109 }, { y: 300 }],
      23,
      0,
      400,
    ).sort((a, b) => a.ty - b.ty);
    for (let i = 1; i < tags.length; i++) expect(tags[i]!.ty - tags[i - 1]!.ty).toBeGreaterThanOrEqual(23 - 1e-9);
  });
});
