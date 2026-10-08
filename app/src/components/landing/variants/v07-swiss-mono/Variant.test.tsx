import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, TILE_REDEEMED, beatCaption, storyFrame } from "../shared";
import { Chart, Numbers } from "./SwissStage";
import { stepsFrom, swissChart, swissInset, xEnd } from "./swissChart";
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

describe("Swiss mono variant", () => {
  it("renders every beat's caption in order, plus the figures", () => {
    const { container } = render(<Variant m={m} />);
    expect(screen.getByTestId("story-track")).toBeTruthy();
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getAllByText(TILE_FLOOR).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-rail] button")).toHaveLength(8);
  });

  it("renders 8 static frames under reduced motion", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    for (const key of BEAT_KEYS) expect(stills.textContent).toContain(beatCaption(m, key));
  });

  it("labels made-up paths and the real-scale close-up", () => {
    render(<Chart m={m} frame={storyFrame(m, 3)} />);
    expect(screen.getByText(ILLUSTRATION)).toBeTruthy();
    cleanup();
    render(<Chart m={m} frame={storyFrame(m, 5)} />);
    expect(screen.getByText(REAL_SCALE_LABEL)).toBeTruthy();
  });

  it("draws the floor as a staircase that never goes down", () => {
    const f = storyFrame(m, 8);
    const ys = f.floorSteps.map(([, v]) => v);
    expect(new Set(ys.map((v) => v.toFixed(6))).size).toBeGreaterThan(2);
    ys.forEach((v, i) => i && expect(v).toBeGreaterThanOrEqual(ys[i - 1]! - 1e-12));
    const arb = stepsFrom(f.floorSteps, 7);
    expect(arb[0]![0]).toBe(7);
    expect(arb.every(([t]) => t >= 7)).toBe(true);
  });

  it("tags the made-up path on every beat after the presale", () => {
    for (const pos of [4.5, 7.95]) {
      render(<Chart m={m} frame={storyFrame(m, pos)} />);
      expect(screen.getByText(ILLUSTRATION)).toBeTruthy();
      cleanup();
    }
  });

  it("keeps the $100 key at redeem and stamps the floor as redeemed", () => {
    render(<Numbers frame={storyFrame(m, 8)} />);
    expect(screen.getByText(TILE_NOW)).toBeTruthy();
    expect(screen.getByText(TILE_REDEEMED)).toBeTruthy();
  });

  it("draws the arbitrage line under the whole staircase", () => {
    const f = storyFrame(m, 5.5);
    const g = swissChart(m, f);
    expect(g.arbStart!.x).toBeCloseTo(g.floorStart!.x, 6);
    expect(g.arbStart!.y).toBeGreaterThan(g.floorStart!.y);
  });

  it("follows the price head before the close-up and shows a labelled magnified floor", () => {
    const f = storyFrame(m, 2.6);
    expect(f.zoom).toBe(0);
    expect(f.t / xEnd(f)).toBeGreaterThan(0.85);
    expect(xEnd(storyFrame(m, 5.5))).toBeCloseTo(9.4, 6);
    const inset = swissInset(m, f)!;
    expect(inset.factor).toBeGreaterThan(1);
    render(<Chart m={m} frame={f} />);
    expect(screen.getByText(/Steps magnified \d+×/)).toBeTruthy();
    expect(swissInset(m, storyFrame(m, 5.5))).toBeNull();
  });
});
