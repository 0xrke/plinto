import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, beatCaption, storyFrame } from "../shared";
import { cardScales } from "./MiniChart";
import Variant, { cardEntry } from "./Variant";

const m = launchMath(simConstantsFromSdk(), simConstantsFromSdk().defaultVaultSharePct);

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
  vi.stubGlobal("requestAnimationFrame", () => 0);
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

describe("v04 card stack", () => {
  it("renders a card with its caption for every beat, and one runway step per beat", () => {
    const { container } = render(<Variant m={m} />);
    const deck = container.querySelector('[data-part="deck"]')!;
    expect(deck.querySelectorAll("[data-card]")).toHaveLength(BEAT_KEYS.length);
    for (const key of BEAT_KEYS) {
      expect(within(deck as HTMLElement).getByText(beatCaption(m, key))).toBeTruthy();
    }
    expect(container.querySelectorAll("[data-step]")).toHaveLength(BEAT_KEYS.length);
    // Server/first paint is the finished frame: the redeem card is on top and the floor is a staircase.
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    const steps = deck.querySelectorAll('[data-part="floor-steps"]');
    expect(steps.length).toBeGreaterThan(0);
    expect((steps[steps.length - 1]!.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(4);
  });

  it("slides each card in during the previous beat's hold, card 0 always in", () => {
    expect(cardEntry(0, 0)).toBe(1);
    expect(cardEntry(3, 2.5)).toBe(0);
    expect(cardEntry(3, 3.06)).toBe(1);
    expect(cardEntry(3, 2.9)).toBeGreaterThan(0);
    expect(cardEntry(3, 2.9)).toBeLessThan(1);
  });

  it("renders static frames under reduced motion", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
  });

  it("draws a story pos at one scale whichever card shows it (no mid-slide jump)", () => {
    for (let i = 1; i < BEAT_KEYS.length; i++) {
      const a = cardScales(storyFrame(m, i));
      const b = cardScales(storyFrame(m, i + 1e-9));
      for (const t of [0, 2, 5, 9]) expect(a.pctX(t)).toBeCloseTo(b.pctX(t), 4);
    }
  });

  it("keeps the Illustration tag on the finished (redeem) frame, where the made-up path is still drawn", () => {
    const { container } = render(<Variant m={m} />);
    const last = container.querySelector('[data-card="7"]')!;
    expect(within(last as HTMLElement).getByText(ILLUSTRATION)).toBeTruthy();
  });
});
