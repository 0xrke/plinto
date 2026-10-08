import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, TILE_FLOOR, TILE_NOW, beatCaption } from "../shared";
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
  vi.stubGlobal("requestAnimationFrame", () => 1);
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

describe("v19 horizontal tape, site style", () => {
  it("renders every beat's caption on the runway, the rail, and the tape in the brand chart card", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Step \d of 8/ })).toHaveLength(8);
    const card = container.querySelector('[data-brand-chart="stage"]');
    expect(card?.querySelector("svg")).toBeTruthy();
    // The finished frame: both value tags ride the playhead.
    expect(card!.textContent).toContain(TILE_NOW);
    expect(card!.textContent).toContain(TILE_FLOOR);
  });

  it("reduced motion: no track, eight static tape frames with captions and the Illustration pill", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const figures = screen.getByTestId("story-stills").querySelectorAll("figure");
    expect(figures).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => {
      expect(figures[i]!.textContent).toContain(beatCaption(m, key));
      expect(figures[i]!.querySelector('[data-brand-chart="still"] svg')).toBeTruthy();
    });
    const pill = (i: number) => figures[i]!.querySelector('[data-part="illustration"]')?.textContent ?? null;
    expect(pill(BEAT_KEYS.indexOf("presale"))).toBeNull();
    expect(pill(BEAT_KEYS.indexOf("pump"))).toBe(ILLUSTRATION);
    // The made-up path stays on the tape after the pump, so redeem keeps the label too.
    expect(pill(BEAT_KEYS.indexOf("redeem"))).toBe(ILLUSTRATION);
  });

  it("uses site tokens only: no raw hex colours in the variant's sources", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
