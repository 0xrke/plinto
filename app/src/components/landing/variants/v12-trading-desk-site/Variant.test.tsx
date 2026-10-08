import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS } from "@/lib/landing/sim/story";
import { REAL_SCALE_LABEL, beatCaption } from "../shared";
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

describe("v12 trading desk, site style", () => {
  it("renders every beat's caption in its step, the rail, and the site's chart card", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      expect(within(steps[i] as HTMLElement).getByText(beatCaption(m, key))).toBeTruthy();
    });
    expect(container.querySelectorAll("[data-rail] button")).toHaveLength(BEAT_KEYS.length);
    // First paint is the finished story: one midnight chart card, real-scale chip, the illustration pill.
    const desk = container.querySelector('[data-desk="live"]')!;
    expect(desk.querySelectorAll("[data-brand-chart]")).toHaveLength(1);
    expect(desk.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(desk.querySelector('[data-part="illustration"]')).toBeTruthy();
    expect(desk.querySelector('[data-part="tile-floor"]')?.textContent).toMatch(/^\$\d/);
  });

  it("reduced motion renders eight static desks with their captions and no track", () => {
    reduce = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(stills.querySelectorAll('figure [data-desk="still"] [data-brand-chart="still"] svg')).toHaveLength(BEAT_KEYS.length);
    expect(stills.querySelector("[data-rail]")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
  });
});
