import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_KEYS, ILLUSTRATION, REAL_SCALE_LABEL, beatCaption } from "../shared";
import { cameraAt, closeness } from "./camera";
import { Scene } from "./CleanScene";
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

describe("v24 cinematic, clean", () => {
  it("renders one subtitle and one runway step per beat, on the brand chart card", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    const rail = container.querySelector("[data-rail]");
    BEAT_KEYS.forEach((key, i) => {
      expect(rail?.querySelector(`[data-beat="${key}"]`)?.textContent).toContain(beatCaption(m, key));
      expect(steps[i]!.textContent).toContain(beatCaption(m, key));
    });
    // The screen is the site's midnight card; first paint is the finished frame (pos 8).
    const card = container.querySelector("[data-brand-chart]");
    expect(card).toBeTruthy();
    const floor = card!.querySelector('[data-part="floor-steps"]');
    expect((floor?.getAttribute("d") ?? "").split("L").length).toBeGreaterThan(8);
    expect(card!.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(card!.querySelector('[data-part="illustration"]')).toBeTruthy();
    expect(container.querySelector('[data-part="tile-now"]')).toBeTruthy();
    expect(container.querySelector('[data-part="tile-floor"]')).toBeTruthy();
    expect(card!.querySelector('[data-part="illustration"]')?.textContent).toBe(ILLUSTRATION);
  });

  it("shows the split as a labelled vertical column whose floor part lands on the slab", () => {
    // The divided column holds: it stands with all three direct labels.
    const mid = storyFrame(m, 1.4);
    const { container, unmount } = render(<Scene m={m} frame={mid} cam={cameraAt(m, mid)} />);
    const text = (part: string) => container.querySelector(`[data-part="${part}"]`)?.textContent;
    expect(text("split-label-floor")).toBe("Floor 50%");
    expect(text("split-label-market")).toBe("Market 40%");
    expect(text("split-label-fees")).toBe("Fees 5% · 5%");
    const floorRect = container.querySelector('[data-part="split-floor"]')!;
    const marketRect = container.querySelector('[data-part="split-market"]')!;
    // SVG y grows downwards: the floor sits under the market part, and is taller than it.
    expect(Number(floorRect.getAttribute("y"))).toBeGreaterThan(Number(marketRect.getAttribute("y")));
    expect(Number(floorRect.getAttribute("height"))).toBeGreaterThan(Number(marketRect.getAttribute("height")));
    unmount();

    // Landed: the floor block's top is the floor the staircase starts from, and the column's rest stays.
    const landed = storyFrame(m, 1.92);
    const r = render(<Scene m={m} frame={landed} cam={cameraAt(m, landed)} />);
    const block = r.container.querySelector('[data-part="split-floor"]')!;
    expect(Number(block.getAttribute("y"))).toBeCloseTo(-m.floorPer100GrossUsd * 100, 6);
    expect(r.container.querySelector('[data-part="split-market"]')).toBeTruthy();
    expect(r.container.querySelector('[data-part="floor-steps"]')).toBeTruthy();
    r.unmount();

    // Past the split the column is gone.
    const pump = storyFrame(m, 2.6);
    const p = render(<Scene m={m} frame={pump} cam={cameraAt(m, pump)} />);
    expect(p.container.querySelector('[data-part="split-column"]')).toBeNull();
  });

  it("fills the presale column from $0 with a Raised $X of $10,000 label, and divides that same column", () => {
    const at = (pos: number) => {
      const f = storyFrame(m, pos);
      return render(<Scene m={m} frame={f} cam={cameraAt(m, f)} />);
    };
    const start = at(0.02);
    const fill0 = Number(start.container.querySelector('[data-part="raise-fill"]')!.getAttribute("height"));
    start.unmount();
    const half = at(0.5);
    const fill = half.container.querySelector('[data-part="raise-fill"]')!;
    expect(Number(fill.getAttribute("height"))).toBeGreaterThan(fill0);
    expect(half.container.querySelector('[data-part="raise-label"]')?.textContent).toBe("Raised $5,000 of $10,000");
    const box = (el: Element) => [el.getAttribute("x"), el.getAttribute("width")];
    const presaleBox = box(fill);
    half.unmount();
    // Just into the split: the floor part and the market part sit in the same x and width as the presale fill.
    const early = at(1.01);
    expect(box(early.container.querySelector('[data-part="split-floor"]')!)).toEqual(presaleBox);
    expect(box(early.container.querySelector('[data-part="split-market"]')!)).toEqual(presaleBox);
    early.unmount();
    // The camera does not jump at the presale/split boundary.
    const a = cameraAt(m, storyFrame(m, 0.999));
    const b = cameraAt(m, storyFrame(m, 1.001));
    expect(Math.abs(a.x0 - b.x0) + Math.abs(a.x1 - b.x1)).toBeLessThan(0.01);
  });

  it("keeps the price head in frame, wide on the pump and close on the bounce", () => {
    for (let pos = 0; pos <= 8; pos += 0.01) {
      const f = storyFrame(m, pos);
      const c = cameraAt(m, f);
      expect(f.t).toBeGreaterThanOrEqual(c.x0);
      expect(f.t).toBeLessThanOrEqual(c.x1);
      expect(f.valueOf100).toBeGreaterThanOrEqual(c.y0);
      expect(f.valueOf100).toBeLessThanOrEqual(c.y1);
    }
    expect(closeness(cameraAt(m, storyFrame(m, 3)))).toBe(0);
    expect(closeness(cameraAt(m, storyFrame(m, 6)))).toBe(1);
    const b = storyFrame(m, 6);
    const cb = cameraAt(m, b);
    expect(b.arbLine100! > cb.y0 && b.arbLine100! < cb.y1).toBe(true);
  });

  it("moves the floor and arbitrage labels continuously with the camera (no jumps)", () => {
    const where = (part: string, el: ParentNode) => {
      const t = (el.querySelector(`[data-part="${part}"]`)?.parentElement as HTMLElement | null)?.style.transform;
      const mm = t?.match(/translate\(([-\d.e]+)%, ([-\d.e]+)%\)/);
      return mm ? [Number(mm[1]), Number(mm[2])] : null;
    };
    const prev: Record<string, number[] | null> = { "floor-label": null, "arb-label": null };
    for (let pos = 2.2; pos <= 8; pos += 0.01) {
      const f = storyFrame(m, pos);
      const { container, unmount } = render(<Scene m={m} frame={f} cam={cameraAt(m, f)} />);
      for (const part of Object.keys(prev)) {
        const p = where(part, container);
        const q = prev[part];
        if (p && q) {
          expect(Math.abs(p[0]! - q[0]!), `${part} x at pos ${pos.toFixed(2)}`).toBeLessThan(3);
          expect(Math.abs(p[1]! - q[1]!), `${part} y at pos ${pos.toFixed(2)}`).toBeLessThan(6);
        }
        prev[part] = p;
      }
      unmount();
    }
  });

  it("renders one static frame per beat under reduced motion", async () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    const stills = await screen.findByTestId("story-stills");
    const figures = stills.querySelectorAll("figure");
    expect(figures).toHaveLength(BEAT_KEYS.length);
    expect(screen.queryByTestId("story-track")).toBeNull();
    for (const key of BEAT_KEYS) expect(within(stills).getByText(beatCaption(m, key))).toBeTruthy();
    figures.forEach((fig) => {
      expect(fig.querySelector('[data-brand-chart="still"]')).toBeTruthy();
      expect(fig.querySelector('[data-part="tile-floor"]')).toBeTruthy();
    });
  });
});
