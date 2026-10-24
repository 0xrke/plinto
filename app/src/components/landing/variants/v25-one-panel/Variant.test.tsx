import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, ILLUSTRATION, beatCaption, storyFrame } from "../shared";
import { PanelChart, columnGone, floorPaysLabel, panelScales, splitLabels } from "./PanelChart";
import Variant from "./Variant";

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

const yOf = (el: Element) => Number(el.getAttribute("y"));
const hOf = (el: Element) => Number(el.getAttribute("height"));

describe("v25 one panel", () => {
  it("renders one white card with every beat's caption in place and one midnight chart", () => {
    const { container } = render(<Variant m={m} />);
    const cards = container.querySelectorAll('[data-part="panel-card"]');
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(card.className).toContain("card");
    expect(card.querySelectorAll("[data-brand-chart]")).toHaveLength(1);
    // Every beat's text is in the card, stacked in place; only the active one is shown.
    const texts = card.querySelectorAll("[data-beat]");
    expect(texts).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      expect(texts[i]!.getAttribute("data-beat")).toBe(key);
      expect(within(texts[i] as HTMLElement).getByText(beatCaption(m, key))).toBeTruthy();
    });
    expect(card.querySelectorAll('[data-shown="true"]')).toHaveLength(1);
    expect(card.querySelector('[data-shown="true"]')!.getAttribute("data-beat")).toBe("redeem");
    expect(container.querySelectorAll("[data-step]")).toHaveLength(BEAT_KEYS.length);
    // No deck: no stacked slots, no card-number badges.
    expect(container.querySelector("[data-card]")).toBeNull();
    expect(card.textContent).not.toMatch(/\b\d \/ 8\b/);
    // Server/first paint is the finished frame: the redeem step is current, the floor is a staircase.
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    const steps = card.querySelector('[data-part="floor-steps"]')!;
    expect((steps.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(4);
    expect(within(card).getByText(ILLUSTRATION)).toBeTruthy();
    expect(card.querySelector('[data-part="scale"]')).not.toBeNull();
    expect(card.querySelector('[data-part="tile-now"]')).not.toBeNull();
    expect(card.querySelector('[data-part="tile-floor"]')!.textContent).toMatch(/\$/);
  });

  it("fills the raise column up to your $100 during the presale", () => {
    const { container } = render(<PanelChart m={m} frame={storyFrame(m, 0.5)} />);
    const raise = container.querySelector('[data-part="raise"]')!;
    expect(raise.tagName.toLowerCase()).toBe("rect");
    expect(hOf(raise)).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/Raised \$/);
  });

  it("splits the raise into a vertical column: floor at the bottom, market above, fees on top, labelled", () => {
    const { container } = render(<PanelChart m={m} frame={storyFrame(m, 1.4)} />);
    const floor = container.querySelector('[data-part="split-floor"]')!;
    const market = container.querySelector('[data-part="split-market"]')!;
    const fees = container.querySelector('[data-part="split-creator"]')!;
    // SVG y grows downwards: the floor is lowest, the fees highest; all share the column's x.
    expect(yOf(floor)).toBeGreaterThan(yOf(market));
    expect(yOf(market)).toBeGreaterThan(yOf(fees));
    expect(floor.getAttribute("x")).toBe(market.getAttribute("x"));
    expect(hOf(market)).toBeGreaterThan(hOf(fees));
    const labels = splitLabels(m);
    expect(labels.floor).toBe("Floor 50%");
    expect(labels.market).toBe("Market 40%");
    expect(labels.fees).toBe("Fees 5% · 5%");
    for (const text of Object.values(labels)) expect(screen.getByText(text)).toBeTruthy();
    expect(floor.getAttribute("style") ?? "").toContain("--color-mint");
    expect(market.getAttribute("style") ?? "").toContain("--color-iris");
    expect(fees.getAttribute("style") ?? "").toContain("--color-butter");
  });

  it("settles the floor segment onto the floor slab, then fades the column out early in the pump", () => {
    const top = (pos: number) => {
      const { container, unmount } = render(<PanelChart m={m} frame={storyFrame(m, pos)} />);
      const el = container.querySelector('[data-part="split-floor"]')!;
      const out = yOf(el);
      unmount();
      return out;
    };
    // The floor's top drops (its SVG y grows) as the beat finishes, onto the floor per $100.
    expect(top(2)).toBeGreaterThan(top(1.4));
    const end = storyFrame(m, 2);
    const s = panelScales(end);
    expect(top(2)).toBeCloseTo(s.yOf(m.floorPer100GrossUsd), 3);
    // The split still (pos 2) keeps the column; the pump fades it, and later beats never draw it.
    expect(columnGone(end)).toBe(0);
    expect(columnGone(storyFrame(m, 2.5))).toBe(1);
    // The settled slab is named with what it pays back, matching the "Floor pays back" tile.
    {
      const { container, unmount } = render(<PanelChart m={m} frame={end} />);
      expect(container.querySelector('[data-part="label-slab"]')!.textContent).toBe(floorPaysLabel(end.floorNet100!));
      unmount();
    }
    const { container } = render(<PanelChart m={m} frame={storyFrame(m, 5)} />);
    expect(container.querySelector('[data-part="raise-column"]')).toBeNull();
  });

  it("keeps the presale and the split in one fixed frame, and the frame continuous after", () => {
    const a = panelScales(storyFrame(m, 0.3));
    const b = panelScales(storyFrame(m, 1.9));
    for (const t of [0, 1, 2]) expect(a.pctX(t)).toBeCloseTo(b.pctX(t), 6);
    for (let i = 1; i < BEAT_KEYS.length; i++) {
      const c = panelScales(storyFrame(m, i));
      const d = panelScales(storyFrame(m, i + 1e-9));
      for (const t of [0, 2, 5, 9]) expect(c.pctX(t)).toBeCloseTo(d.pctX(t), 4);
    }
  });

  it("renders static frames under reduced motion", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(BEAT_KEYS.length);
    // The split still shows the labelled column.
    expect(within(stills).getByText("Market 40%")).toBeTruthy();
  });
});
