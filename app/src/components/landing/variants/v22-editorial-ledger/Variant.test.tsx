import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, beatCaption, storyFrame } from "../shared";
import { BEATS, storyValueAt } from "@/lib/landing/sim/story";
import { LedgerChart, chipOpacity, landedValue, spreadLabels } from "./LedgerChart";
import { LedgerSidebar } from "./LedgerSidebar";
import { ledgerAt } from "./vaultLedger";
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
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IntersectionObserver", FakeIO);
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

const chart = (pos: number) => {
  const f = storyFrame(m, pos);
  return render(<LedgerChart m={m} frame={f} ledger={ledgerAt(m, f)} />);
};

describe("v22 Editorial ledger", () => {
  it("renders all 8 beats' captions in order on the runway, and the stage heading, chart and ledger", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll<HTMLElement>("[data-step]");
    expect(steps).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    expect(screen.queryByTestId("story-stills")).toBeNull();
    expect(container.querySelector('[data-part="caption"]')!.textContent).toBe(beatCaption(m, BEAT_KEYS[BEAT_KEYS.length - 1]!)); // first paint: the finished frame
    expect(container.querySelector("[data-brand-chart]")).toBeTruthy();
    const ledger = container.querySelector("[data-ledger]")!;
    expect(ledger.textContent).toContain("Vault ledger");
    expect(ledger.textContent).toContain(TILE_NOW);
    expect(ledger.textContent).toContain(TILE_FLOOR);
  });

  it("reduced motion renders eight static frames with still chart cards and no track", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(8);
    expect(stills.querySelectorAll("[data-ledger]")).toHaveLength(8);
    for (const key of BEAT_KEYS) expect(stills.textContent).toContain(beatCaption(m, key));
    expect(stills.querySelectorAll('[data-part="floor-steps"]').length).toBeGreaterThan(0);
  });

  it("split: a vertical column with floor, market, fee segments and big direct labels", () => {
    const { container } = chart(1.6);
    const col = container.querySelector('[data-part="split-column"]')!;
    for (const seg of ["floor", "market", "creator", "platform"]) expect(col.querySelector(`[data-seg="${seg}"]`)).toBeTruthy();
    const labels = container.querySelector('[data-part="split-labels"]')!.textContent!;
    expect(labels).toContain("Floor 50%");
    expect(labels).toContain("Market 40%");
    expect(labels).toContain("Fees 5% · 5%");
    // Floor at the bottom, market above it, fees on top.
    const y = (s: string) => Number(col.querySelector(`[data-seg="${s}"] rect:last-child, rect[data-seg="${s}"]`)?.getAttribute("y") ?? NaN);
    expect(y("market")).toBeGreaterThan(y("creator"));
    cleanup();
    const presale = chart(0.6);
    expect(presale.container.querySelector('[data-part="raise-fill"]')).toBeTruthy();
    expect(presale.container.querySelector('[data-part="illustration"]')).toBeNull();
  });

  it("the split column fades out as the pump opens instead of popping off at the beat boundary", () => {
    const end = chart(2).container;
    expect(end.querySelector('[data-part="split-column"]')).toBeTruthy();
    cleanup();
    // Just into the pump (pos 2 + small): still drawn, partly faded.
    const start = chart(2.005).container;
    const col = start.querySelector('[data-part="split-column"]');
    expect(col).toBeTruthy();
    const o = Number(col!.parentElement!.getAttribute("opacity"));
    expect(o).toBeGreaterThan(0.5);
    expect(o).toBeLessThanOrEqual(1);
    cleanup();
    expect(chart(2.5).container.querySelector('[data-part="split-column"]')).toBeNull();
  });

  it("the ledger shows the split as rows and the numbered journal matches the chart's chips", () => {
    const f = storyFrame(m, 8);
    const ledger = ledgerAt(m, f);
    const side = render(<LedgerSidebar m={m} frame={f} ledger={ledger} />);
    const rows = side.container.querySelector('[data-part="split-rows"]')!;
    expect(rows.querySelectorAll("li")).toHaveLength(3);
    expect(rows.textContent).toContain("$5,000");
    const journal = side.container.querySelectorAll('[data-part="journal"] li');
    expect(journal).toHaveLength(ledger.entries.length);
    cleanup();
    const c = render(<LedgerChart m={m} frame={f} ledger={ledger} />);
    const chips = [...c.container.querySelectorAll("[data-chip]")].map((e) => Number(e.getAttribute("data-chip")));
    expect(chips).toEqual(ledger.entries.map((e) => e.n));
  });

  it("wide camera marks only the newest ledger entry; close-up marks them all", () => {
    const pump = storyFrame(m, 3.5);
    const lp = ledgerAt(m, pump);
    const visible = lp.entries.filter((e) => chipOpacity(pump, lp, e) > 0);
    expect(visible.map((e) => e.n)).toEqual([lp.latest!.n]);
    const close = storyFrame(m, 6);
    const lc = ledgerAt(m, close);
    expect(lc.entries.every((e) => chipOpacity(close, lc, e) === 1)).toBe(true);
  });

  it("bounce frame: floor staircase, arbitrage line, bounce dot, Illustration and real-scale chips", () => {
    const { container } = chart(6);
    expect(Number(container.querySelector('[data-part="floor-steps"]')!.getAttribute("data-vertices"))).toBeGreaterThan(4);
    expect(container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
    expect(container.querySelector('[data-part="illustration"]')!.textContent).toBe(ILLUSTRATION);
    expect(container.querySelector('[data-part="scale"]')!.textContent).toBe(REAL_SCALE_LABEL);
  });

  it("draws the bounce landing on the arbitrage line, never under it, and leaves every other beat alone", () => {
    const bounce = BEATS.find((b) => b.key === "bounce")!;
    const fb = storyValueAt(m, bounce.start);
    let min = Infinity;
    for (let i = 0; i <= 600; i++) {
      const t = bounce.start + ((bounce.end - bounce.start) * i) / 600;
      min = Math.min(min, landedValue(m, t, storyValueAt(m, t)));
    }
    expect(min).toBeCloseTo(fb * m.arbLineRatio, 9);
    for (const t of [0, 3, bounce.start, bounce.end, bounce.end + 0.3, 9.4]) {
      expect(landedValue(m, t, storyValueAt(m, t))).toBe(storyValueAt(m, t));
    }
  });

  it("spreads x-axis labels so neighbours keep a gap and stay inside the axis", () => {
    const xs = spreadLabels([10, 100, 100, 140], [20, 30, 30, 40], 0, 170, 12);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(25 + 12 - 1e-9);
    expect(xs[3]! + 20).toBeLessThanOrEqual(170 + 1e-9);
  });
});
