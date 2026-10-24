import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, beatCaption } from "../shared";
import Variant from "./Variant";
import { StepsStage } from "./StepsStage";
import { COLUMN_TOP, columnBox, netPress, plotFor, scalesFor, splitPhases, treads } from "./geometry";

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

describe("v23 clean steps (v20 + the v1/v3 split column)", () => {
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
    // The split still shows the vertical column with its direct labels.
    const split = stills.querySelectorAll("figure")[1]!;
    expect(split.querySelector('[data-part="split"]')).toBeTruthy();
    expect(split.querySelector('[data-label="floor"]')?.textContent).toBe("Floor 50%");
  });

  it("draws the split as a vertical column (floor bottom, market, fees on top) with direct labels", () => {
    const { container } = render(<StepsStage m={m} frame={storyFrame(m, 1.45)} still />);
    const seg = (k: string) => container.querySelector(`[data-seg="${k}"]`)!;
    const y = (k: string) => Number(seg(k).getAttribute("y"));
    const h = (k: string) => Number(seg(k).getAttribute("height"));
    ["floor", "market", "creator", "platform"].forEach((k) => expect(seg(k)).toBeTruthy());
    // Stacked bottom to top, in one column (same x), taller than wide for the floor + market.
    expect(y("floor")).toBeGreaterThan(y("market"));
    expect(y("market")).toBeGreaterThan(y("creator"));
    expect(y("creator")).toBeGreaterThan(y("platform"));
    expect(seg("market").getAttribute("x")).toBe(seg("platform").getAttribute("x"));
    expect(h("floor") + h("market")).toBeGreaterThan(Number(seg("market").getAttribute("width")));
    expect(seg("floor").getAttribute("style")).toContain("--color-mint");
    expect(seg("market").getAttribute("style")).toContain("--color-iris");
    expect(seg("creator").getAttribute("style")).toContain("--color-butter");
    const label = (k: string) => container.querySelector(`[data-label="${k}"]`)?.textContent;
    expect(label("floor")).toBe("Floor 50%");
    expect(label("market")).toBe("Market 40%");
    expect(label("fees")).toBe("Fees 5% · 5%");
    // No horizontal split bar.
    expect(container.textContent).not.toContain("Raised $10,000");
  });

  it("drops the floor segment onto the floor slab by the end of the split", () => {
    const p = plotFor(640, 420);
    const early = storyFrame(m, 1.3);
    const late = storyFrame(m, 1.95);
    const at = (pos: number) => {
      const { container } = render(<StepsStage m={m} frame={storyFrame(m, pos)} still />);
      const r = container.querySelector('[data-seg="floor"]')!;
      const out = { x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")) };
      cleanup();
      return out;
    };
    const a = at(1.3);
    const b = at(1.95);
    const sa = scalesFor(p, early);
    const sb = scalesFor(p, late);
    // Early: in the column, its top at the floor share of the column (50 of 100).
    expect(a.x).toBeCloseTo(columnBox(p, sa).x0, 0);
    expect(a.y).toBeLessThan(sa.y(0.5 * COLUMN_TOP) + 3);
    // Late: at the floor's real level, over the slab that starts at the split (t = 1).
    expect(b.y).toBeCloseTo(sb.y(late.floorSteps[0]![1]), 0);
    expect(b.x).toBeCloseTo(sb.x(1), 0);
  });

  it("gives presale and split longer runways and labels the raise as its own column", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll<HTMLElement>("[data-step]");
    expect(steps[0]!.style.getPropertyValue("--runway")).toBe("120svh");
    expect(steps[1]!.style.getPropertyValue("--runway")).toBe("150svh");
    cleanup();
    // Presale: "Raised $X of $10,000" beside the filling column.
    const pre = render(<StepsStage m={m} frame={storyFrame(m, 0.5)} still />).container;
    expect(pre.querySelector('[data-part="raise-fill"]')).toBeTruthy();
    expect(pre.querySelector('[data-label="raised"]')?.textContent).toMatch(/^Raised \$[\d,]+ of \$10,000$/);
    cleanup();
    // Split: the labelled column holds from ~40% to 60% of the beat before the floor drops.
    expect(splitPhases(storyFrame(m, 1.42)).sp).toBe(1);
    expect(splitPhases(storyFrame(m, 1.58)).reveal).toBe(0);
    expect(splitPhases(storyFrame(m, 1.96)).reveal).toBe(1);
  });

  it("keeps the floor a rising staircase and the net taut except at the dip", () => {
    const runs = treads(storyFrame(m, 8).floorSteps);
    expect(runs.length).toBeGreaterThan(4);
    for (let i = 1; i < runs.length; i++) expect(runs[i]![2]).toBeGreaterThan(runs[i - 1]![2]);
    expect(netPress(storyFrame(m, 5 + 1 / 3))).toBeGreaterThan(0.9);
    expect(netPress(storyFrame(m, 8))).toBe(0);
  });
});
