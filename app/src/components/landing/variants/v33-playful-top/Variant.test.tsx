import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, SINCE_LISTING, TILE_FLOOR, TILE_NOW, TILE_SUPPLY, beatCaption, supplyBurns } from "../shared";
import Variant, { SUPPLY_EQUATION, SUPPLY_NOTE } from "./Variant";
import { TopStage } from "./TopStage";
import { T_LISTING, clearOfBall, netPress, plotFor, treads } from "./scene";
import { SUPPLY_LANE_LABEL, SUPPLY_LANE_TOP, burnFloorText, burnLabel, burnsSoFar, floorAfter, isTinyBurn, laneSteps } from "./supplyLane";
import { supplyFresh, supplyText, topTiles } from "./tiles";

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

describe("v33 playful, values on top", () => {
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
    // The three tiles sit above the card (now, floor, supply); the ball has no face.
    expect(container.querySelector("[data-mood]")).toBeNull();
    const card = container.querySelector('[data-brand-chart="stage"]')!;
    for (const part of ["tile-now", "tile-floor", "tile-supply"]) {
      const tile = container.querySelector(`[data-part="${part}"]`)!;
      expect(tile).toBeTruthy();
      expect(card.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    }
    expect(container.textContent).toContain(TILE_SUPPLY);
    // The tile keeps only the current value: its own shrinking bar is gone (the lane draws supply).
    expect(container.querySelector('[data-part="supply-bar"]')).toBeNull();
    expect(container.querySelector('[data-part="supply-lane"]')).toBeTruthy();
    // The old "+0.9% from exits" chip is replaced by the burn label on the chart.
    expect(container.textContent).not.toContain("from exits");
    expect(container.textContent).toContain("−30% supply → floor +0.9%");
    // Finished frame: supply 69.7%, −30% since listing, the floor up since listing; your $100 redeemed (no %).
    expect(container.querySelector('[data-part="tile-supply"]')!.textContent).toBe("69.7%");
    const supplyTile = container.querySelector('[data-tile="supply"]')!;
    expect(supplyTile.textContent).toContain(`−30% ${SINCE_LISTING}`);
    expect(container.querySelector('[data-tile="now"]')!.textContent).not.toContain(SINCE_LISTING);
    expect(container.querySelector('[data-tile="floor"] [data-tone="floor"]')!.textContent).toMatch(/^\+/);
    // The step rail: eight line segments with the beat names, the last one current.
    const rail = container.querySelector('nav[aria-label="Story steps"]')!;
    expect(rail.querySelectorAll("button")).toHaveLength(8);
    expect(rail.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(rail.textContent).toContain("Presale");
    expect(rail.textContent).toContain("Redeem");
    // The why-line under the bounce and exits captions only.
    expect(container.querySelectorAll('[data-part="supply-note"]')).toHaveLength(2);
    expect(steps[5]!.textContent).toContain(SUPPLY_NOTE);
    expect(steps[6]!.textContent).toContain(`${SUPPLY_NOTE} ${SUPPLY_EQUATION}`);
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

  it("shows no change before listing, then price and floor changes with the right tones", () => {
    const pre = topTiles(m, storyFrame(m, 1.5));
    expect(pre.now.change).toBeNull();
    expect(pre.floor.change).toBeNull();
    expect(pre.supply.change).toBeNull();
    expect(pre.supply.value).toBe("—");
    expect(pre.supply.listed).toBe(false);
    const peak = topTiles(m, storyFrame(m, 2.9));
    expect(peak.now.change!.tone).toBe("up");
    expect(peak.now.change!.text).toMatch(/^\+/);
    const low = topTiles(m, storyFrame(m, 4.6));
    expect(low.now.change!.tone).toBe("down");
    expect(low.now.change!.text).toMatch(/^−/);
    expect(low.floor.change!.tone).toBe("floor");
    expect(low.supply.value).toBe("100%");
    expect(low.supply.change!.tone).toBe("flat");
  });

  it("shrinks the supply at the burns and lights the tile up only right after one", () => {
    expect(supplyText(1)).toBe("100%");
    expect(supplyText(0.6971)).toBe("69.7%");
    expect(supplyFresh(m, storyFrame(m, 4.5))).toBe(0);
    const end = topTiles(m, storyFrame(m, 8));
    expect(end.supply.value).toBe("69.7%");
    expect(end.supply.change).toEqual({ text: "−30%", tone: "burn" });
    expect(end.supply.fresh).toBe(0);
    // Somewhere in the exits beat the burn has just happened: the tile is lit.
    let lit = 0;
    for (let pos = 6; pos < 7; pos += 0.01) lit = Math.max(lit, supplyFresh(m, storyFrame(m, pos)));
    expect(lit).toBeGreaterThan(0.8);
    // Supply only ever falls.
    let prev = 1;
    for (let pos = 2; pos <= 8; pos += 0.05) {
      const s = topTiles(m, storyFrame(m, pos)).supply.share;
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
  });

  it("fades a chip while the ball passes under it, and only then", () => {
    const box = { left: 100, right: 220, top: 50, bottom: 74 };
    // Ball inside the box: hidden.
    expect(clearOfBall(box, 160, 80, 10)).toBe(0);
    // Well clear on either side, above or below: fully shown.
    expect(clearOfBall(box, 40, 80, 10)).toBe(1);
    expect(clearOfBall(box, 280, 80, 10)).toBe(1);
    expect(clearOfBall(box, 160, 120, 10)).toBe(1);
    expect(clearOfBall(box, 160, 30, 10)).toBe(1);
    // Half the margin away: half faded.
    expect(clearOfBall(box, 236, 80, 10)).toBeCloseTo(0.5);
  });

  it("labels each burn with its supply drop and the small floor step it causes", () => {
    const [tiny, big] = supplyBurns(m);
    expect(isTinyBurn(tiny!)).toBe(true);
    expect(isTinyBurn(big!)).toBe(false);
    expect(burnLabel(big!)).toBe("−30% supply → floor +0.9%");
    expect(burnLabel(tiny!)).toBe("−0.4% supply → floor +0.01%");
    expect(burnFloorText(0.008)).toBe("+0.01%");
    expect(burnFloorText(0.0004)).toBe("0.0%");
    // Honesty: the 30% burn lifts the floor by under 1%.
    expect(big!.floorPct).toBeGreaterThan(0);
    expect(big!.floorPct).toBeLessThan(1);
  });

  it("adds burns only once the frame passes them, and none before listing", () => {
    const [tiny, big] = supplyBurns(m);
    const at = (t: number, beatIndex = 7) => ({ ...storyFrame(m, 8), t, beatIndex });
    expect(burnsSoFar(m, storyFrame(m, 1.5))).toEqual([]);
    expect(laneSteps(m, storyFrame(m, 1.5))).toBeNull();
    expect(burnsSoFar(m, at(tiny!.t - 0.01))).toEqual([]);
    expect(burnsSoFar(m, at(tiny!.t))).toEqual([tiny]);
    expect(burnsSoFar(m, at(big!.t - 0.01))).toEqual([tiny]);
    expect(burnsSoFar(m, at(big!.t + 0.01))).toEqual([tiny, big]);
  });

  it("steps the supply lane down exactly at the burn times", () => {
    const [tiny, big] = supplyBurns(m);
    const flat = laneSteps(m, storyFrame(m, 4.5))!;
    expect(flat[0]).toEqual([T_LISTING, 1]);
    expect(flat.every(([, v]) => v === 1)).toBe(true);
    const end = laneSteps(m, storyFrame(m, 8))!;
    expect(end.map(([t]) => t)).toEqual([T_LISTING, tiny!.t, tiny!.t, big!.t, big!.t, storyFrame(m, 8).t]);
    expect(end[2]![1]).toBeCloseTo(0.996, 9);
    expect(end[4]![1]).toBeCloseTo(0.6972, 4);
    expect(end[5]![1]).toBeCloseTo(big!.supplyAfter, 9);
    // Each marker sits on the floor step its burn causes.
    const steps = storyFrame(m, 8).floorSteps;
    const before = floorAfter(steps, big!.t - 1e-6)!;
    expect(floorAfter(steps, big!.t)! / before - 1).toBeCloseTo(big!.floorPct / 100, 6);
  });

  it("draws the lane and the burn markers from the frame, scrolling back included", () => {
    const [tiny, big] = supplyBurns(m);
    const draw = (pos: number) => {
      cleanup();
      return render(<TopStage m={m} frame={storyFrame(m, pos)} still />).container;
    };
    const burnsAt = (c: HTMLElement) => [...c.querySelectorAll('[data-part="burn"]')].map((g) => Number(g.getAttribute("data-t")));
    // Before listing: no lane, no markers.
    let c = draw(1.5);
    expect(c.querySelector('[data-part="supply-lane"]')).toBeNull();
    expect(burnsAt(c)).toEqual([]);
    // Selloff: the lane is flat at 100% with its name and tick; no burns yet.
    c = draw(4.5);
    const lane = c.querySelector('[data-part="supply-lane"]')!;
    expect(lane.textContent).toContain(SUPPLY_LANE_LABEL);
    expect(lane.textContent).toContain(SUPPLY_LANE_TOP);
    expect(burnsAt(c)).toEqual([]);
    // The end: both markers (the tiny one smaller), the 30% label, the tiny label off its beat.
    c = draw(8);
    expect(burnsAt(c)).toEqual([tiny!.t, big!.t]);
    expect(c.querySelector(`[data-part="burn"][data-t="${tiny!.t}"]`)!.hasAttribute("data-tiny")).toBe(true);
    const labels = [...c.querySelectorAll('[data-part="burn-label"]')].map((e) => e.textContent);
    expect(labels).toEqual([burnLabel(big!)]);
    // Scrolling back before the exits drops the 30% marker again.
    c = draw(5.6);
    expect(burnsAt(c).every((t) => t < big!.t)).toBe(true);
    // The lane stays under the main chart, inside the card.
    const p = plotFor(640, 420);
    expect(p.bottom).toBeLessThan(p.ground);
    expect(p.lane.top).toBe(p.ground);
    expect(p.lane.y100).toBeGreaterThan(p.lane.top);
    expect(p.lane.y0).toBeLessThan(420);
    expect(p.ground).toBeGreaterThanOrEqual(420 - 56);
  });

  it("shows the tiny burn's label only on its own beat", () => {
    const [tiny] = supplyBurns(m);
    let shown = false;
    for (let pos = 5; pos < 6; pos += 0.02) {
      const f = storyFrame(m, pos);
      cleanup();
      const c = render(<TopStage m={m} frame={f} still />).container;
      const has = [...c.querySelectorAll('[data-part="burn-label"]')].some((e) => e.textContent === burnLabel(tiny!));
      if (has) {
        shown = true;
        expect(f.beat).toBe("bounce");
        expect(f.t).toBeGreaterThanOrEqual(tiny!.t);
      }
    }
    expect(shown).toBe(true);
  });
});
