import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, beatCaption } from "../shared";
import Variant from "./Variant";
import { netPress, treads } from "./scene";

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

describe("v20 playful (site style)", () => {
  it("renders every beat's caption in order inside the midnight chart card's story", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    // First paint is the finished frame: the brand chart card with the real-scale chip, the HUD tiles.
    expect(container.querySelector('[data-brand-chart="stage"]')).toBeTruthy();
    expect(container.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(container.textContent).toContain(TILE_NOW);
    expect(container.textContent).toContain(TILE_FLOOR);
    expect(container.querySelector('[data-part="ball"]')).toBeTruthy();
    // The landing's tiles sit under the card; the ball has no face; the pill stays butter.
    expect(container.querySelector('[data-part="tile-now"]')).toBeTruthy();
    expect(container.querySelector("[data-mood]")).toBeNull();
    const card = container.querySelector('[data-brand-chart="stage"]')!;
    const tiles = container.querySelector('[data-part="tile-now"]')!;
    expect(card.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The final frame (redeem) shows the arbitrage line as a full staircase, no dent.
    const arb = container.querySelector('[data-part="arb"] path[stroke-dasharray]');
    expect(arb).toBeTruthy();
    expect((arb!.getAttribute("d")!.match(/L/g) ?? []).length).toBeGreaterThan(8);
    expect(container.querySelector('[data-part="net"]')).toBeNull();
  });

  it("reduced motion renders eight static frames and no track", () => {
    reduceMotion = true;
    const { container } = render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(8);
    BEAT_KEYS.forEach((key) => expect(stills.textContent).toContain(beatCaption(m, key)));
    // The made-up beats carry the label; the stills have no level dots to scroll with.
    expect(stills.textContent).toContain(ILLUSTRATION);
    expect(container.querySelector('nav[aria-label="Story steps"]')).toBeNull();
  });

  it("keeps the floor a rising staircase and the net taut except at the dip", () => {
    const runs = treads(storyFrame(m, 8).floorSteps);
    expect(runs.length).toBeGreaterThan(4);
    for (let i = 1; i < runs.length; i++) expect(runs[i]![2]).toBeGreaterThan(runs[i - 1]![2]);
    expect(netPress(storyFrame(m, 5 + 1 / 3))).toBeGreaterThan(0.9);
    expect(netPress(storyFrame(m, 8))).toBe(0);
  });
});
