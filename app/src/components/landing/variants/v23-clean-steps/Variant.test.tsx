import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, BEAT_LABELS, ILLUSTRATION, REAL_SCALE_LABEL, SINCE_LISTING, TILE_FLOOR, TILE_NOW, beatCaption, formatPctChange, sinceListing } from "../shared";
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
    // The two numbers are their own block (not the small tiles under the card); the ball has no face.
    expect(container.querySelector('[data-part="metrics"] [data-part="tile-now"]')).toBeTruthy();
    expect(container.querySelector('[data-part="metrics"] [data-part="tile-floor"]')).toBeTruthy();
    expect(container.querySelector("[data-mood]")).toBeNull();
    // The step rail: eight line segments with the beat names, no dots; the last one is current.
    const rail = container.querySelector('nav[aria-label="Story steps"]')!;
    const buttons = rail.querySelectorAll("button");
    expect(buttons).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => expect(buttons[i]!.textContent).toBe(BEAT_LABELS[key]));
    expect(buttons[7]!.getAttribute("aria-current")).toBe("step");
    expect(buttons[0]!.getAttribute("data-state")).toBe("done");
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

  it("shows the change since listing beside both numbers only once trading has opened", () => {
    const at = (pos: number) => render(<StepsStage m={m} frame={storyFrame(m, pos)} still />).container;
    // Presale and split: no market yet, no percents (and no stray suffix).
    for (const pos of [0.5, 1.6, 2]) {
      const c = at(pos);
      expect(c.querySelector('[data-part="since-now"]')).toBeNull();
      expect(c.querySelector('[data-part="since-floor"]')).toBeNull();
      expect(c.textContent).not.toContain(SINCE_LISTING);
      cleanup();
    }
    // The pump's peak: price up (floor green), floor flat-or-up (floor colour).
    const pump = storyFrame(m, 2.7);
    const up = sinceListing(m, pump);
    expect(up.now!).toBeGreaterThan(0);
    let c = at(2.7);
    const nowUp = c.querySelector('[data-part="since-now"]')!;
    expect(nowUp.textContent).toBe(`${formatPctChange(up.now!)} ${SINCE_LISTING}`);
    expect(nowUp.textContent).toMatch(/^\+/);
    expect(nowUp.getAttribute("data-tone")).toBe("up");
    expect(nowUp.className).toContain("text-floor");
    cleanup();
    // After the selloff: price down (coral risk), floor up since listing.
    const late = storyFrame(m, 5.5);
    const down = sinceListing(m, late);
    c = at(5.5);
    const nowDown = c.querySelector('[data-part="since-now"]')!;
    expect(nowDown.textContent).toBe(`${formatPctChange(down.now!)} ${SINCE_LISTING}`);
    expect(nowDown.textContent).toMatch(/^\u2212\d/);
    expect(nowDown.getAttribute("data-tone")).toBe("down");
    expect(nowDown.className).toContain("text-risk");
    const floor = c.querySelector('[data-part="since-floor"]')!;
    expect(floor.textContent).toBe(`${formatPctChange(down.floor!)} ${SINCE_LISTING}`);
    expect(floor.textContent).toMatch(/^\+/);
    expect(floor.className).toContain("text-floor");
    // Each percent sits with its own value, in the same tile.
    expect(nowDown.closest("dd")!.querySelector('[data-part="tile-now"]')).toBeTruthy();
    expect(floor.closest("dd")!.querySelector('[data-part="tile-floor"]')).toBeTruthy();
    cleanup();
    // Redeemed: the price percent goes, the floor's stays.
    c = at(8);
    expect(c.querySelector('[data-part="tile-now"]')!.textContent).toBe("Redeemed");
    expect(c.querySelector('[data-part="since-now"]')).toBeNull();
    expect(c.querySelector('[data-part="since-floor"]')).toBeTruthy();
  });
});
