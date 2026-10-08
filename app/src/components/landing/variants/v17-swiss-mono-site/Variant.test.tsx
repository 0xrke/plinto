import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, TILE_REDEEMED, beatCaption, storyFrame } from "../shared";
import { Chart, FLOOR_PENDING, Numbers } from "./SwissStage";
import { swissChart, swissInset } from "./swissChart";
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

describe("Swiss mono, site style (v17)", () => {
  it("renders every beat's caption in order, the rail and the figures", () => {
    const { container } = render(<Variant m={m} />);
    expect(screen.getByTestId("story-track")).toBeTruthy();
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(container.querySelectorAll("[data-rail] button")).toHaveLength(8);
    expect(screen.getAllByText(TILE_NOW).length).toBeGreaterThan(0);
    expect(screen.getAllByText(TILE_FLOOR).length).toBeGreaterThan(0);
    expect(container.querySelector("[data-brand-chart]")).toBeTruthy();
  });

  it("renders 8 static frames under reduced motion", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(8);
    for (const key of BEAT_KEYS) expect(stills.textContent).toContain(beatCaption(m, key));
  });

  it("labels made-up paths, the real-scale close-up and the magnified inset", () => {
    for (const pos of [3, 4.5, 7.95]) {
      render(<Chart m={m} frame={storyFrame(m, pos)} />);
      expect(screen.getByText(ILLUSTRATION)).toBeTruthy();
      cleanup();
    }
    render(<Chart m={m} frame={storyFrame(m, 5)} />);
    expect(screen.getByText(REAL_SCALE_LABEL)).toBeTruthy();
    cleanup();
    const f = storyFrame(m, 2.6);
    expect(swissInset(m, f)!.factor).toBeGreaterThan(1);
    render(<Chart m={m} frame={f} />);
    expect(screen.getByText(/Steps magnified \d+×/)).toBeTruthy();
  });

  it("marks the bounce on the arbitrage line and stamps the floor as redeemed", () => {
    const f = storyFrame(m, 6);
    const g = swissChart(m, f);
    expect(g.dip).not.toBeNull();
    expect(g.arbStripD).not.toBe("");
    const { container } = render(<Chart m={m} frame={f} />);
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
    cleanup();
    render(<Numbers frame={storyFrame(m, 8)} />);
    expect(screen.getByText(TILE_REDEEMED)).toBeTruthy();
  });

  it("shows a note, not a ghosted figure, before the floor exists, and fills the presale band", () => {
    const f = storyFrame(m, 0.6);
    render(<Numbers frame={f} />);
    expect(screen.getByText(FLOOR_PENDING)).toBeTruthy();
    expect(screen.queryByText("$—")).toBeNull();
    cleanup();
    const g = swissChart(m, f);
    expect(g.raiseBandD).not.toBe("");
    expect(g.raiseD).not.toBe("");
    expect(swissChart(m, storyFrame(m, 3)).raiseBandD).toBe("");
  });

  it("draws the price at the brand's 2.5px and gives every still a full-width, taller chart", () => {
    const { container } = render(<Chart m={m} frame={storyFrame(m, 3.5)} />);
    const paths = [...container.querySelectorAll("path")].filter((p) => p.getAttribute("style")?.includes("--color-white"));
    expect(paths.length).toBe(1);
    expect(paths[0]!.style.strokeWidth).toBe("2.5");
    cleanup();
    reduceMotion = true;
    render(<Variant m={m} />);
    const charts = screen.getByTestId("story-stills").querySelectorAll<HTMLElement>('[data-brand-chart="still"]');
    charts.forEach((c) => {
      expect(c.style.height).toBe("240px");
      // The chart sits in its own named grid area, first in the still (the tiles follow it).
      expect(c.parentElement!.nextElementSibling).toBeTruthy();
    });
  });
});
