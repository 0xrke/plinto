import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, beatCaption } from "../shared";
import { Panels } from "./Panels";
import { ledgerAt } from "./ledger";
import Variant from "./Variant";

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

describe("variant 8: cause and effect", () => {
  it("renders every beat's caption, the tiles and the ledger", () => {
    render(<Variant m={m} />);
    for (const key of BEAT_KEYS) expect(screen.getAllByText(beatCaption(m, key)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(TILE_NOW).length).toBeGreaterThan(0);
    expect(screen.getAllByText(TILE_FLOOR).length).toBeGreaterThan(0);
    expect(screen.getByText("Vault ledger")).toBeTruthy();
    expect(screen.queryByTestId("story-stills")).toBeNull();
  });

  it("renders eight static frames under reduced motion", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(8);
    expect(screen.queryByTestId("story-track")).toBeNull();
  });

  it("the ledger replays the engine's floor: vault ÷ supply = the staircase", () => {
    const end = storyFrame(m, 8);
    const l = ledgerAt(m, end);
    expect(l.entries.map((e) => e.kind)).toEqual(["split", "harvest", "harvest", "harvest", "harvest", "harvest", "redeem", "redeem"]);
    const floor = (m.floorPer100GrossUsd * (l.vaultUsd / m.split.floorUsd)) / l.supplyShare;
    expect(floor).toBeCloseTo(end.floor100!, 9);
    expect(l.fromRaiseUsd + l.fromFeesUsd).toBeCloseTo(l.vaultUsd, 6);
    // Scrolling back undoes the ledger exactly.
    expect(ledgerAt(m, storyFrame(m, 1)).entries).toHaveLength(0);
  });

  it("labels made-up paths, magnifies the wide-camera floor only with a label, and draws the arbitrage line as a staircase", () => {
    const at = (key: (typeof BEAT_KEYS)[number]) => storyFrame(m, BEAT_KEYS.indexOf(key) + 0.85);
    for (const key of ["pump", "selloff", "steps", "bounce", "exits", "redeem"] as const) {
      const { container, unmount } = render(<Panels m={m} frame={at(key)} />);
      expect(container.textContent).toContain(ILLUSTRATION);
      unmount();
    }
    // Pump: the lens carries an explicit magnification label and the numbered chips.
    const pump = render(<Panels m={m} frame={at("pump")} />);
    expect(pump.container.textContent).toMatch(/Steps magnified \d+×/);
    expect(pump.container.textContent).not.toContain(REAL_SCALE_LABEL);
    pump.unmount();
    // Bounce: the arbitrage polyline has a vertex pair per floor step (a staircase, not a stub).
    const bounce = at("bounce");
    const { container } = render(<Panels m={m} frame={bounce} />);
    const polylines = [...container.querySelectorAll("polyline")].map((p) => p.getAttribute("points")!.trim().split(" ").length);
    // The floor and the arbitrage line both follow every step.
    expect(polylines.filter((n) => n === bounce.floorSteps.length)).toHaveLength(2);
    expect(container.textContent).not.toMatch(/Steps magnified/);
  });
});
