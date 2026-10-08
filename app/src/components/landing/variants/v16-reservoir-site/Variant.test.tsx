import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, beatCaption } from "../shared";
import Variant from "./Variant";
import { tankBox } from "./geometry";

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

describe("v16 Reservoir · site style", () => {
  it("renders every beat's caption in order, with the tank in the site's chart card", () => {
    const { container } = render(<Variant m={m} />);
    const track = screen.getByTestId("story-track");
    const steps = track.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(within(steps[i] as HTMLElement).getByText(beatCaption(m, key))).toBeTruthy());
    expect(screen.queryByTestId("story-stills")).toBeNull();
    // Finished frame on first paint: the tank sits in the midnight chart card, with the site's chips and tiles.
    const card = container.querySelector('[data-stage] [data-brand-chart="stage"]');
    expect(card?.querySelector("svg")).toBeTruthy();
    expect(card?.querySelector('[data-part="scale"]')?.textContent).toBe("Close-up · real scale");
    // The made-up path stays drawn at the redeem beat, so the pill stays too (muted, as on the landing).
    const pill = card?.querySelector('[data-part="illustration"]');
    expect(pill?.textContent).toBe("Illustration");
    expect(pill?.className).toContain("bg-midnight-chip");
    // The tank stands on its plate; the floor strip sits beside the captions, not in the stage.
    expect(card?.querySelector('[data-part="stand"]')?.textContent).toBe("Floor vault · SPYx");
    expect(track.querySelector('aside [data-part="floor-strip"]')).toBeTruthy();
    expect(track.querySelector('[data-stage] [data-part="floor-strip"]')).toBeNull();
    expect(track.querySelector('[data-part="tile-now"]')?.textContent).toBe("Redeemed");
    expect(track.querySelector('[data-part="tile-floor"]')?.textContent).toMatch(/^\$\d+\.\d\d$/);
    // The floor is a staircase on the glass and in the strip (one riser per floor event), the dip stays marked.
    const tankSteps = track.querySelector('[data-part="tank-steps-line"]')?.getAttribute("d") ?? "";
    const stripSteps = track.querySelector('[data-part="strip-steps"]')?.getAttribute("d") ?? "";
    expect(tankSteps.split("L").length).toBeGreaterThanOrEqual(1 + 2 * 7);
    expect(stripSteps.split("L").length).toBeGreaterThanOrEqual(1 + 2 * 7);
    expect(track.querySelector('[data-part="tank-arb"]')).toBeTruthy();
    expect(track.querySelector('[data-part="dip"]')).toBeTruthy();
    // Site palette only: no raw hex colours in the drawn marks.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("reduced motion: no track, one static tank per beat with its caption", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const figures = screen.getByTestId("story-stills").querySelectorAll("figure");
    expect(figures).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const fig = figures[i] as HTMLElement;
      expect(within(fig).getByText(beatCaption(m, key))).toBeTruthy();
      expect(fig.querySelector('[data-brand-chart="still"] svg')).toBeTruthy();
    });
    // The pump still is an illustration; the presale still is not.
    expect(figures[2]!.querySelector('[data-part="illustration"]')?.textContent).toBe("Illustration");
    expect(figures[0]!.querySelector('[data-part="illustration"]')).toBeNull();
    // Every still from the pump on keeps the pill: the made-up path is on the glass.
    for (let i = 2; i < figures.length; i++) expect(figures[i]!.querySelector('[data-part="illustration"]')).toBeTruthy();
  });

  it("geometry: the phone tank and its gauge fit 358px inside the card padding", () => {
    const b = tankBox(358, 400);
    expect(b.narrow).toBe(true);
    expect(b.x0).toBeGreaterThanOrEqual(12);
    expect(b.gaugeX + 36).toBeLessThanOrEqual(358);
    expect(b.barY - 20).toBeGreaterThanOrEqual(34);
    // The stand sits under the glass and inside the card.
    expect(b.baseY).toBeGreaterThan(b.bottom);
    expect(b.baseY + b.baseH).toBeLessThanOrEqual(400 - 6);
  });
});
