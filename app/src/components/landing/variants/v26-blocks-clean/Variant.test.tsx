import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, storyFrame } from "@/lib/landing/sim/story";
import { SINCE_LISTING, beatCaption, beatSrText, formatPctChange, sinceListing, tileValues } from "../shared";
import Variant from "./Variant";
import { CleanBlocksStage, Metrics, onArbLine, splitLabels } from "./CleanBlocksStage";

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

/** The split beat at beat progress p (pos 1 + p). */
const splitAt = (p: number) => storyFrame(m, 1 + p);

describe("v26 Blocks · clean", () => {
  it("renders every beat's caption and screen-reader text in its step, in order", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      expect(steps[i]!.textContent).toContain(beatCaption(m, key));
      expect(steps[i]!.textContent).toContain(beatSrText(m, key));
    });
    expect(screen.getByTestId("story-track")).toBeTruthy();
  });

  it("reduced motion renders eight static frames, each in the midnight chart card", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key) => expect(stills.textContent).toContain(beatCaption(m, key)));
    // The split's still shows the labelled vertical column.
    expect(stills.querySelector('[data-part="split-labels"]')).not.toBeNull();
  });

  it("the presale is its own bar labelled \"Raised $X of $10,000\", and the split divides that same column", () => {
    const pre = render(<CleanBlocksStage m={m} frame={storyFrame(m, 0.5)} />).container;
    const label = pre.querySelector('[data-part="raise-label"]');
    expect(label?.textContent).toMatch(/^Raised \$[\d,]+of \$10,000$/);
    expect(pre.querySelector('[data-part="raise-bar"]')).not.toBeNull();
    // The same column, at the same x, from the end of the presale into the split (no jump).
    const frontX = (c: Element, kind: string) => c.querySelector(`[data-block="${kind}"] polygon:last-of-type`)!.getAttribute("points")!.split(/[ ,]/)[0];
    const end = render(<CleanBlocksStage m={m} frame={storyFrame(m, 0.999)} />).container;
    const start = render(<CleanBlocksStage m={m} frame={splitAt(0.001)} />).container;
    expect(frontX(start, "presale")).toBe(frontX(end, "presale"));
    const divided = render(<CleanBlocksStage m={m} frame={splitAt(0.4)} />).container;
    expect(frontX(divided, "colFloor")).toBe(frontX(end, "presale"));
    // The raise label hands over to the segment labels once the column has divided.
    expect(divided.querySelector('[data-part="raise-label"]')).toBeNull();
  });

  it("splits the column vertically into floor, market and fees, labelled directly", () => {
    const labels = splitLabels(m);
    expect(labels.floor).toBe("Floor 50%");
    expect(labels.market).toBe("Market 40%");
    expect(labels.fees).toMatch(/^Fees \d+(\.\d)?% · \d+(\.\d)?%$/);
    const { container } = render(<CleanBlocksStage m={m} frame={splitAt(0.4)} />);
    const group = container.querySelector('[data-part="split-labels"]');
    expect(group?.textContent).toContain("Floor");
    expect(group?.textContent).toContain("50%");
    expect(group?.textContent).toContain("Market");
    expect(group?.textContent).toContain("40%");
    expect(group?.textContent).toContain(labels.fees);
    for (const kind of ["colFloor", "colMarket", "colFees"]) expect(container.querySelector(`[data-block="${kind}"]`)).not.toBeNull();
    // The floor segment sits under the market segment, which sits under the fees (SVG y grows downwards).
    const top = (kind: string) => Math.min(...[...container.querySelectorAll(`[data-block="${kind}"] polygon:last-of-type`)].map((p) => Number(p.getAttribute("points")!.split(/[ ,]/)[1])));
    expect(top("colFloor")).toBeGreaterThan(top("colMarket"));
    expect(top("colMarket")).toBeGreaterThan(top("colFees"));
  });

  it("the floor's slabs settle into the foundation by the end of the split", () => {
    const end = render(<CleanBlocksStage m={m} frame={splitAt(1)} />).container;
    expect(end.querySelector('[data-block="colMarket"]')).toBeNull();
    expect(end.querySelector('[data-block="colFloor"]')).toBeNull();
    expect(end.querySelectorAll('[data-block="floor"]').length).toBe(Math.round(m.v * 20));
    // The mint staircase edge is drawn once every slab has landed.
    expect(end.querySelector("path[style*='var(--color-mint)']")).not.toBeNull();
  });

  it("the floor is a staircase of blocks: one per event on the foundation, and the bounce frame is labelled", () => {
    const final = storyFrame(m, 8);
    expect(final.events.length).toBeGreaterThan(1);
    const levels = new Set(final.floorSteps.map(([, v]) => v.toFixed(6)));
    expect(levels.size).toBeGreaterThan(2);
    const { container } = render(<CleanBlocksStage m={m} frame={final} />);
    const eventBlocks = container.querySelectorAll('[data-block="harvest"], [data-block="harvestAlt"], [data-block="redeem"]');
    expect(eventBlocks.length).toBe(final.events.length);
    expect(container.querySelector('[data-part="tile-floor"]')?.textContent).toMatch(/^\$\d+\.\d{2}$/);
    const bounce = render(<CleanBlocksStage m={m} frame={storyFrame(m, 6)} />).container;
    expect(bounce.querySelector('[data-part="illustration"]')?.textContent).toBe("Illustration");
    expect(bounce.querySelector('[data-part="scale"]')?.textContent).toBe("Close-up · real scale");
    expect(bounce.textContent).toContain("Arbitrage line");
    expect(bounce.textContent).toContain("Bounce");
  });

  it("shows the Illustration label from the pump on, and not on the presale", () => {
    expect(render(<CleanBlocksStage m={m} frame={storyFrame(m, 0.5)} />).container.querySelector('[data-part="illustration"]')).toBeNull();
    cleanup();
    expect(render(<CleanBlocksStage m={m} frame={storyFrame(m, 2.5)} />).container.querySelector('[data-part="illustration"]')?.textContent).toBe("Illustration");
  });

  it("uses site tokens only: no raw hex colours in the stage markup", () => {
    const { container } = render(<CleanBlocksStage m={m} frame={storyFrame(m, 6)} />);
    const html = container.innerHTML.replace(/url\(#[^)]*\)/g, "");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).toContain("var(--color-mint)");
  });

  it("shows the two metrics large in the stage, and no \"Floor blocks\" tile", () => {
    const { container } = render(<CleanBlocksStage m={m} frame={storyFrame(m, 4.5)} />);
    const metrics = container.querySelector('[data-part="metrics"]');
    expect(metrics?.textContent).toContain("Your $100 now");
    expect(metrics?.textContent).toContain("Floor pays back");
    expect(container.querySelector('[data-part="tile-now"]')?.textContent).toMatch(/^\$\d+\.\d{2}$/);
    expect(container.querySelector('[data-part="blocks"]')).toBeNull();
    expect(container.textContent).not.toContain("Floor blocks");
  });

  it("shows the change since listing only once trading opens, with the right signs and tones", () => {
    const pct = (c: Element, part: string) => c.querySelector(`[data-part="${part}"]`);
    // Presale and split: no percent yet.
    for (const pos of [0.5, 1.5, 1.999]) {
      const c = render(<CleanBlocksStage m={m} frame={storyFrame(m, pos)} />).container;
      expect(pct(c, "pct-now")).toBeNull();
      expect(pct(c, "pct-floor")).toBeNull();
      expect(c.textContent).not.toContain(SINCE_LISTING);
      cleanup();
    }
    // The pump: the price is up, in floor green.
    const pump = render(<CleanBlocksStage m={m} frame={storyFrame(m, 2.9)} />).container;
    expect(pct(pump, "pct-now")?.textContent).toMatch(new RegExp(`^\\+\\d+(\\.\\d)?% ${SINCE_LISTING}$`));
    expect(pct(pump, "pct-now")?.getAttribute("data-tone")).toBe("up");
    cleanup();
    // The exits: the price is down (coral), the floor is up (floor colour); both match the shared helper.
    const raw = storyFrame(m, 6.9);
    const frame = { ...raw, valueOf100: onArbLine(m, raw, raw.t, raw.valueOf100) };
    const exits = render(<Metrics m={m} frame={frame} />).container;
    const want = sinceListing(m, frame);
    expect(want.now).not.toBeNull();
    expect(want.now!).toBeLessThan(0);
    expect(want.floor!).toBeGreaterThan(0);
    expect(pct(exits, "pct-now")?.textContent).toBe(`${formatPctChange(want.now!)} ${SINCE_LISTING}`);
    expect(pct(exits, "pct-now")?.textContent).toMatch(/^−/);
    expect(pct(exits, "pct-now")?.getAttribute("data-tone")).toBe("down");
    expect(pct(exits, "pct-floor")?.textContent).toBe(`${formatPctChange(want.floor!)} ${SINCE_LISTING}`);
    expect(pct(exits, "pct-floor")?.textContent).toMatch(/^\+/);
    expect(pct(exits, "pct-floor")?.getAttribute("data-tone")).toBe("floor");
    cleanup();
    // Redeemed: the price has no percent, the floor keeps its.
    const end = render(<CleanBlocksStage m={m} frame={storyFrame(m, 8)} />).container;
    expect(end.querySelector('[data-part="tile-now"]')?.textContent).toBe(tileValues(storyFrame(m, 8)).now);
    expect(pct(end, "pct-now")).toBeNull();
    expect(pct(end, "pct-floor")?.textContent).toMatch(/^\+/);
  });
});
