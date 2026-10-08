import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, beatCaption, storyFrame } from "../shared";
import { cardScales } from "./MiniChart";
import Variant, { cardEntry, chartDarkness } from "./Variant";

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

describe("v14 card stack (site style)", () => {
  it("renders a white card with its caption for every beat, in the site's midnight chart card", () => {
    const { container } = render(<Variant m={m} />);
    const deck = container.querySelector('[data-part="deck"]')!;
    const cards = deck.querySelectorAll("[data-card]");
    expect(cards).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const card = cards[i] as HTMLElement;
      expect(within(card).getByText(beatCaption(m, key))).toBeTruthy();
      expect(card.querySelector("article")!.className).toContain("card");
      expect(card.querySelector("[data-brand-chart]")).not.toBeNull();
    });
    expect(container.querySelectorAll("[data-step]")).toHaveLength(BEAT_KEYS.length);
    // Server/first paint is the finished frame: the redeem card is on top and the floor is a staircase.
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    const steps = deck.querySelectorAll('[data-part="floor-steps"]');
    expect((steps[steps.length - 1]!.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(4);
    // Illustration pill on the finished frame, and the real-scale chip once zoomed in.
    const last = cards[cards.length - 1] as HTMLElement;
    expect(within(last).getByText(ILLUSTRATION)).toBeTruthy();
    expect(last.querySelector('[data-part="scale"]')).not.toBeNull();
    expect(last.querySelector('[data-part="tile-floor"]')!.textContent).toMatch(/\$/);
  });

  it("keeps the original's deck motion: a card slides in during the previous beat's hold", () => {
    expect(cardEntry(0, 0)).toBe(1);
    expect(cardEntry(3, 2.5)).toBe(0);
    expect(cardEntry(3, 3.06)).toBe(1);
    expect(cardEntry(3, 2.9)).toBeGreaterThan(0);
    expect(cardEntry(3, 2.9)).toBeLessThan(1);
    for (let i = 1; i < BEAT_KEYS.length; i++) {
      const a = cardScales(storyFrame(m, i));
      const b = cardScales(storyFrame(m, i + 1e-9));
      for (const t of [0, 2, 5, 9]) expect(a.pctX(t)).toBeCloseTo(b.pctX(t), 4);
    }
  });

  it("keeps one midnight chart in view: the covered card's chart fades as the next one lands", () => {
    for (let d = 0; d <= BEAT_KEYS.length; d += 0.01) {
      const entries = BEAT_KEYS.map((_, i) => cardEntry(i, d));
      const dark = BEAT_KEYS.map((_, i) => chartDarkness(i, entries));
      expect(dark.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(dark.filter((x) => x > 0.5).length).toBeLessThanOrEqual(1);
    }
  });

  it("draws the raise as the presale band filling up", () => {
    const { container } = render(<Variant m={m} />);
    const raise = container.querySelector('[data-card="0"] [data-part="raise"]')!;
    expect(raise.tagName.toLowerCase()).toBe("rect");
    expect(Number(raise.getAttribute("height"))).toBeGreaterThan(0);
  });

  it("renders static frames under reduced motion", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(BEAT_KEYS.length);
  });
});
