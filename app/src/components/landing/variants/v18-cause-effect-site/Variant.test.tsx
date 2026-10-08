import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, ILLUSTRATION, TILE_FLOOR, TILE_NOW, beatCaption } from "../shared";
import { Panels } from "./Panels";
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

describe("variant 18: cause and effect, site style", () => {
  it("renders every beat's caption, the tiles, the ledger and the midnight chart card", () => {
    const { container } = render(<Variant m={m} />);
    for (const key of BEAT_KEYS) expect(screen.getAllByText(beatCaption(m, key)).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-step]")).toHaveLength(8);
    expect(screen.getAllByText(TILE_NOW).length).toBeGreaterThan(0);
    expect(screen.getAllByText(TILE_FLOOR).length).toBeGreaterThan(0);
    expect(screen.getByText("Vault ledger")).toBeTruthy();
    expect(container.querySelector("[data-brand-chart]")).not.toBeNull();
    expect(screen.queryByTestId("story-stills")).toBeNull();
  });

  it("renders eight static frames under reduced motion, each with its caption", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = screen.getByTestId("story-stills");
    const figures = stills.querySelectorAll("figure");
    expect(figures).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => expect(figures[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.queryByTestId("story-track")).toBeNull();
  });

  it("labels made-up paths and draws the floor and the arbitrage line as staircases at the bounce", () => {
    const bounce = storyFrame(m, BEAT_KEYS.indexOf("bounce") + 0.85);
    const { container } = render(<Panels m={m} frame={bounce} />);
    expect(container.querySelector('[data-part="illustration"]')?.textContent).toBe(ILLUSTRATION);
    const polylines = [...container.querySelectorAll("polyline")].map((p) => p.getAttribute("points")!.trim().split(" ").length);
    expect(polylines.filter((n) => n === bounce.floorSteps.length)).toHaveLength(2);
  });

  it("uses site tokens only: no raw hex or rgb colours in the variant's code", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });
});
