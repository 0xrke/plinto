import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, BEAT_LABELS, SINCE_LISTING, TILE_FLOOR, TILE_NOW, TILE_SUPPLY, supplyAt, supplyBurns, beatCaption, beatSrText, formatPctChange, sinceListing, storyFrame, tileValues } from "../shared";
import { CompactStage, onArbLine, placeBox, sectionLabels, xMaxFor, TAG } from "./CompactStage";
import { LANE, beatBounds, layoutTags, plotFor, stackTags } from "./geometry";
import { burnLabel, burnsSoFar, shareText, supplyLane, supplyPctText } from "./supply";
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

const stage = (pos: number) => render(<CompactStage m={m} frame={storyFrame(m, pos)} />).container;
const part = (c: Element, name: string) => c.querySelector(`[data-part="${name}"]`);

describe("v35 Blocks · compact", () => {
  it("renders the 8 beats' captions in order, as plain scrolling captions", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("li[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const cap = steps[i]!.querySelector('[data-part="caption"]') as HTMLElement;
      expect(cap).not.toBeNull();
      expect(cap.textContent).toContain(beatCaption(m, key));
      expect(cap.textContent).toContain(beatSrText(m, key));
    });
    expect(screen.getByTestId("story-track")).toBeTruthy();
    // One midnight chart card, no pinned metric tiles beside it.
    expect(container.querySelectorAll("[data-brand-chart]")).toHaveLength(1);
    expect(part(container, "metrics")).toBeNull();
  });

  it("has the header on top: title, floor-share chip and the line-segment step bar", () => {
    const { container } = render(<Variant m={m} />);
    expect(screen.getByRole("heading", { name: "Follow your $100" })).toBeTruthy();
    expect(container.textContent).toContain("Floor share 50%");
    const rail = screen.getByRole("navigation", { name: "Story steps" });
    expect(within(rail).getAllByRole("button")).toHaveLength(BEAT_KEYS.length);
    // The server/first paint is the finished frame.
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    // The rail comes before the chart in the stage.
    const chart = part(container, "chart-slot")!;
    expect(rail.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the section strip names every beat and marks the current one", () => {
    for (const pos of [0.5, 1.5, 3.5, 6.5, 8]) {
      const c = stage(pos);
      const strip = part(c, "section-strip")!;
      const frame = storyFrame(m, pos);
      // Every section is on the strip; its full name is the title of whatever it shows.
      const sections = strip.querySelectorAll("[data-section]");
      expect(sections).toHaveLength(BEAT_KEYS.length);
      const current = strip.querySelectorAll('[data-current="true"]');
      expect(current).toHaveLength(1);
      expect(current[0]!.getAttribute("data-section")).toBe(frame.beat);
      // The current section always shows its number and name.
      const label = current[0]!.querySelector("text")!;
      expect(label.textContent).toContain(`${String(frame.beatIndex + 1).padStart(2, "0")} ${BEAT_LABELS[frame.beat]}`);
      expect(current[0]!.getAttribute("class")).toMatch(/current/);
      cleanup();
    }
    // The finished frame: every section is named on the strip, and the drawn labels show their numbers.
    const end = part(stage(8), "section-strip")!;
    BEAT_KEYS.forEach((key, i) => {
      const g = end.querySelector(`[data-section="${key}"]`)!;
      expect(g.getAttribute("data-name")).toBe(`${String(i + 1).padStart(2, "0")} ${BEAT_LABELS[key]}`);
    });
    expect(end.querySelectorAll("text").length).toBeGreaterThanOrEqual(6);
  });

  it("section names never collide, narrow sections show their number, out-of-view ones hide", () => {
    const b = beatBounds(m);
    for (const [w, pos] of [[358, 0.5], [358, 3.5], [358, 6.9], [358, 8], [760, 2.5], [760, 6.5], [900, 8]] as const) {
      const frame = storyFrame(m, pos);
      const p = plotFor({ w, h: 600 });
      const xMax = xMaxFor(frame, p);
      const X = (t: number) => p.l + (t / xMax) * (p.r - p.l);
      const labels = sectionLabels(b.start.map(X), b.end.map(X), w, p.compact, frame.beatIndex).filter((l) => l.show);
      const sorted = [...labels].sort((a, c) => a.left - c.left);
      // A clear gap between labels (their widths are generous estimates of the rendered text).
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.left).toBeGreaterThanOrEqual(sorted[i - 1]!.right + 5);
      for (const l of labels) {
        expect(l.left).toBeGreaterThanOrEqual(0);
        expect(l.right).toBeLessThanOrEqual(w);
      }
      expect(labels.find((l) => l.i === frame.beatIndex)?.full).toBe(true);
      // Early on, the sections after the visible window have no label.
      if (pos === 0.5) expect(labels.some((l) => l.i >= BEAT_KEYS.indexOf("bounce"))).toBe(false);
    }
    // A narrow band keeps only its number.
    const narrow = sectionLabels([10, 40, 200], [40, 200, 300], 300, false, 2);
    expect(narrow[0]!.show && narrow[0]!.full).toBe(false);
    // Phone presale: the split's band sits between two names and still shows its number.
    {
      const p = plotFor({ w: 358, h: 400 });
      const xMax = xMaxFor(storyFrame(m, 0.9), p);
      const X = (t: number) => p.l + (t / xMax) * (p.r - p.l);
      const early = sectionLabels(b.start.map(X), b.end.map(X), 358, true, 0);
      expect(early[BEAT_KEYS.indexOf("split")]!.show).toBe(true);
    }
  });

  it("the tags ride the head with the values, and the percents appear only after listing", () => {
    // Presale and split: values but no percent.
    for (const pos of [0.5, 1.5, 1.95]) {
      const c = stage(pos);
      expect(part(c, "tag-price")!.textContent).toContain(TILE_NOW);
      expect(part(c, "tile-now")!.textContent).toBe("$100.00");
      expect(part(c, "pct-price")).toBeNull();
      expect(part(c, "pct-floor")).toBeNull();
      expect(c.textContent).not.toContain(SINCE_LISTING);
      cleanup();
    }
    // The floor's tag shows once the floor exists.
    expect(part(stage(0.5), "tag-floor")).toBeNull();
    cleanup();
    expect(part(stage(1.95), "tag-floor")!.textContent).toContain(TILE_FLOOR);
    cleanup();
    // Pump: up (floor green); exits: down (coral), the floor in the floor colour; both from the shared helper.
    const pump = stage(2.9);
    expect(part(pump, "pct-price")!.textContent).toMatch(new RegExp(`^\\+\\d+(\\.\\d)?% ${SINCE_LISTING}$`));
    expect(part(pump, "pct-price")!.getAttribute("data-tone")).toBe("up");
    cleanup();
    const raw = storyFrame(m, 6.9);
    const frame = { ...raw, valueOf100: onArbLine(m, raw, raw.t, raw.valueOf100) };
    const want = sinceListing(m, frame);
    const exits = stage(6.9);
    expect(want.now!).toBeLessThan(0);
    expect(part(exits, "pct-price")!.textContent).toBe(`${formatPctChange(want.now!)} ${SINCE_LISTING}`);
    expect(part(exits, "pct-price")!.getAttribute("data-tone")).toBe("down");
    expect(part(exits, "pct-price")!.querySelector("tspan")!.getAttribute("class")).toMatch(/pctDown/);
    expect(part(exits, "pct-floor")!.textContent).toBe(`${formatPctChange(want.floor!)} ${SINCE_LISTING}`);
    expect(part(exits, "pct-floor")!.querySelector("tspan")!.getAttribute("class")).toMatch(/pctFloor/);
    expect(part(exits, "tile-floor")!.textContent).toBe(tileValues(frame).floor);
    cleanup();
    // Redeemed: the price tag says so and drops its percent; the floor keeps its own.
    const end = stage(8);
    expect(part(end, "tile-now")!.textContent).toBe(tileValues(storyFrame(m, 8)).now);
    expect(part(end, "pct-price")).toBeNull();
    expect(part(end, "pct-floor")!.textContent).toMatch(/^\+/);
    // The values appear only in the tags (no pinned tiles, no "Floor $x" or "Redeem $x" chips).
    expect(end.querySelectorAll('[data-part="tile-floor"]')).toHaveLength(1);
    expect(end.textContent).not.toMatch(/Redeem \$/);
  });

  it("the camera keeps the tags' room right of the head, inside the card", () => {
    for (const w of [358, 760, 900]) {
      const p = plotFor({ w, h: 600 });
      const tag = p.compact ? TAG.compact : TAG.wide;
      for (let pos = 1.99; pos <= 8; pos += 0.25) {
        const frame = storyFrame(m, pos);
        const xMax = xMaxFor(frame, p);
        const headX = p.l + (frame.t / xMax) * (p.r - p.l);
        expect(headX + p.ball + tag.gap + tag.w).toBeLessThanOrEqual(w - tag.margin + 1e-6);
      }
    }
    // The tags never overlap each other.
    const t = layoutTags(200, 190, 74, 0, 600, 6, true);
    expect(t.floor! - t.price).toBeGreaterThanOrEqual(80 - 1e-9);
  });

  it("keeps 26's mechanics: the raise column divides into labelled floor, market and fees, and the floor is blocks", () => {
    const pre = stage(0.5);
    expect(part(pre, "raise-label")!.textContent).toMatch(/^Raised \$[\d,]+of \$10,000$/);
    expect(part(pre, "raise-bar")).not.toBeNull();
    cleanup();
    const split = stage(1.4);
    const labels = part(split, "split-labels")!.textContent!;
    expect(labels).toContain("50%");
    expect(labels).toContain("40%");
    expect(labels).toMatch(/Fees \d+(\.\d)?% · \d+(\.\d)?%/);
    cleanup();
    const final = storyFrame(m, 8);
    const end = stage(8);
    expect(end.querySelectorAll('[data-block="harvest"], [data-block="harvestAlt"], [data-block="redeem"]').length).toBe(final.events.length);
    expect(new Set(final.floorSteps.map(([, v]) => v.toFixed(6))).size).toBeGreaterThan(2);
    cleanup();
    const bounce = stage(6);
    expect(part(bounce, "illustration")!.textContent).toBe("Illustration");
    expect(part(bounce, "scale")!.textContent).toBe("Close-up · real scale");
    expect(bounce.textContent).toContain("Arbitrage line");
    expect(bounce.textContent).toContain("Bounce");
    cleanup();
    // Presale and split get the long runways.
    const { container } = render(<Variant m={m} />);
    const runway = (i: number) => (container.querySelectorAll("[data-step]")[i] as HTMLElement).style.getPropertyValue("--runway");
    expect(runway(0)).toBe("120svh");
    expect(runway(1)).toBe("150svh");
  });

  it("reduced motion: eight static frames, each a chart card with sections and tags", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const figures = screen.getByTestId("story-stills").querySelectorAll("figure");
    expect(figures).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      expect(figures[i]!.textContent).toContain(beatCaption(m, key));
      expect(figures[i]!.querySelector('[data-brand-chart="still"]')).not.toBeNull();
      expect(figures[i]!.querySelector('[data-part="section-strip"] [data-current="true"]')?.getAttribute("data-section")).toBe(key);
      expect(figures[i]!.querySelector('[data-part="tag-price"]')).not.toBeNull();
    });
    expect(figures[1]!.querySelector('[data-part="split-labels"]')).not.toBeNull();
  });

  it("phones: the current steps section shows its full name, never a lone number", () => {
    const b = beatBounds(m);
    const STEPS = BEAT_KEYS.indexOf("steps");
    for (const pos of [4.2, 4.6, 4.95]) {
      const p = plotFor({ w: 358, h: 400 });
      const frame = storyFrame(m, pos);
      const xMax = xMaxFor(frame, p);
      const X = (t: number) => p.l + (t / xMax) * (p.r - p.l);
      const l = sectionLabels(b.start.map(X), b.end.map(X), 358, true, STEPS)[STEPS]!;
      expect(l.show && l.full).toBe(true);
    }
  });

  it("the token supply lane: nothing before listing, 100% from listing, steps exactly at the burns", () => {
    const burns = supplyBurns(m);
    expect(burns.map((b) => b.t)).toEqual([6.8, 8.2]);
    expect(supplyLane(m, storyFrame(m, 1.5))).toBeNull();
    // Listed, before any burn: flat at 100% up to the head.
    const early = supplyLane(m, storyFrame(m, 3))!;
    expect(early.every(([, v]) => v === 1)).toBe(true);
    // The finished frame: risers at 6.8 and 8.2, 69.7% at the head (as supplyAt says).
    const end = storyFrame(m, 8);
    const lane = supplyLane(m, end)!;
    expect(lane.map(([t]) => t)).toEqual([lane[0]![0], 6.8, 6.8, 8.2, 8.2, end.t]);
    expect(lane[2]![1]).toBeCloseTo(0.996, 9);
    expect(lane[4]![1]).toBeCloseTo(burns[1]!.supplyAfter, 9);
    expect(lane[5]![1]).toBeCloseTo(supplyAt(m, end)!.share, 9);
    expect(shareText(lane[5]![1])).toBe("69.7%");
    // Between the burns the lane has stepped only once.
    const mid = supplyLane(m, storyFrame(m, 6))!;
    expect(mid.filter(([t]) => t === 6.8)).toHaveLength(2);
    expect(mid.some(([t]) => t === 8.2)).toBe(false);
    // Drawn: no lane before listing, a lane (with its 100% tick and name) after.
    expect(part(stage(1.5), "supply-lane")).toBeNull();
    cleanup();
    const c = stage(8);
    expect(part(c, "lane-tick")!.textContent).toBe("100%");
    expect(part(c, "lane-name")!.textContent).toBe("Supply");
    expect(part(c, "supply-line")!.getAttribute("d")).toMatch(/^M.*L.*L.*L.*L.*L/);
  });

  it("the lane is thin and the plot gives it the room, inside the card", () => {
    for (const [w, h] of [[358, 420], [586, 498]] as const) {
      const p = plotFor({ w, h });
      const lane = p.compact ? LANE.compact : LANE.wide;
      expect(p.laneBot - p.laneTop).toBe(lane.h);
      expect(lane.h).toBeLessThanOrEqual(56);
      expect(p.b).toBeLessThan(p.laneTop);
      expect(p.laneBot).toBeLessThan(h);
    }
  });

  it("a burn marker appears on the floor line only once its burn has happened, and stays", () => {
    const markers = (pos: number) => {
      const c = stage(pos);
      const out = [...c.querySelectorAll('[data-part="burn-marker"]')].map((g) => g.hasAttribute("data-small"));
      cleanup();
      return out;
    };
    expect(markers(1.5)).toEqual([]);
    expect(markers(5)).toEqual([]); // t = 6.0, before the bounce's redeem
    expect(markers(6)).toEqual([true]); // t = 7.6: the small arbitrage burn only
    expect(markers(6.3)).toEqual([true]);
    expect(markers(6.6)).toEqual([true, false]); // t = 8.32: both
    expect(markers(8)).toEqual([true, false]);
    // Pure in the frame: going back hides the later burn again.
    expect(markers(5.6)).toEqual([true]);
    expect(burnsSoFar(m, storyFrame(m, 1.5))).toEqual([]);
  });

  it("each burn label pairs the supply drop with its small floor step; the small one shows on its own beat only", () => {
    const [arb, exits] = supplyBurns(m);
    expect(burnLabel(exits!)).toEqual({ supply: "−30% supply", floor: "floor +0.9%" });
    expect(burnLabel(arb!)).toEqual({ supply: "−0.4% supply", floor: "floor +0.01%" });
    // Honest: a 30% burn moves the floor by under 1%.
    expect(exits!.floorPct).toBeLessThan(1);
    const labels = (pos: number) => {
      const c = stage(pos);
      const out = [...c.querySelectorAll('[data-part="burn-label"]')].map((g) => g.textContent);
      cleanup();
      return out;
    };
    expect(labels(5)).toEqual([]);
    expect(labels(6)).toEqual(["−0.4% supply → floor +0.01%"]); // the bounce
    expect(labels(6.3)).toEqual([]); // exits, before the holders' burn: the small one has stepped back
    expect(labels(6.6)).toEqual(["−30% supply → floor +0.9%"]);
    expect(labels(8)).toEqual(["−30% supply → floor +0.9%"]);
  });

  it("burn labels never cover the tags, the bounce or the arbitrage label (default size)", () => {
    for (const pos of [5.8, 6, 6.6, 7, 8]) {
      const c = stage(pos);
      const box = (el: Element) => {
        const r = el.querySelector("rect")!;
        const x = Number(r.getAttribute("x"));
        const y = Number(r.getAttribute("y"));
        return { x0: x, x1: x + Number(r.getAttribute("width")), y0: y, y1: y + Number(r.getAttribute("height")) };
      };
      const tagBoxes = ["tag-price", "tag-floor", "tag-supply"].map((n) => part(c, n)).filter((e): e is Element => e !== null).map(box);
      for (const chip of c.querySelectorAll('[data-part="burn-label"]')) {
        const b = box(chip);
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.x1).toBeLessThanOrEqual(560);
        for (const t of tagBoxes) expect(b.x1 <= t.x0 || t.x1 <= b.x0 || b.y1 <= t.y0 || t.y1 <= b.y0).toBe(true);
      }
      cleanup();
    }
    // The placement itself slides clear of an obstacle.
    const spot = placeBox(100, 80, 20, [200], [{ x0: 90, x1: 150, y0: 190, y1: 230 }], 0, 400);
    expect(spot.x >= 150 || spot.x + 80 <= 90).toBe(true);
  });

  it("the third tag rides beside the lane's head: the supply and its change, from listing on", () => {
    expect(part(stage(1.5), "tag-supply")).toBeNull();
    cleanup();
    const listed = stage(2.5);
    expect(part(listed, "tag-supply")!.textContent).toContain(TILE_SUPPLY);
    expect(part(listed, "tile-supply")!.textContent).toBe("100%");
    expect(part(listed, "pct-supply")!.textContent).toBe(`0% ${SINCE_LISTING}`);
    cleanup();
    const end = stage(8);
    expect(part(end, "tile-supply")!.textContent).toBe("69.7%");
    expect(part(end, "pct-supply")!.textContent).toBe(`${formatPctChange(supplyAt(m, storyFrame(m, 8))!.pct)} ${SINCE_LISTING}`);
    expect(part(end, "pct-supply")!.textContent).toMatch(/^−30%/);
    expect(part(end, "pct-supply")!.getAttribute("data-tone")).toBe("supply");
    expect(supplyPctText(-0.4)).toBe("−0.4%");
    // Three tags, stacked without overlap, inside the card.
    const ys = stackTags([{ y: 200, h: 74 }, { y: 205, h: 74 }, { y: 480, h: 74 }], 44, 486, 6);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(80 - 1e-9);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(80 - 1e-9);
    expect(ys[2]! + 37).toBeLessThanOrEqual(486 + 1e-9);
    const squeezed = stackTags([{ y: 470, h: 52 }, { y: 470, h: 52 }, { y: 470, h: 52 }], 34, 350, 6);
    expect(squeezed[2]! + 26).toBeLessThanOrEqual(350 + 1e-9);
    expect(squeezed[1]! - squeezed[0]!).toBeGreaterThanOrEqual(58 - 1e-9);
  });

  it("the separate supply block is gone: the supply shows only on the chart", () => {
    const { container } = render(<Variant m={m} />);
    expect(part(container, "supply-slot")).toBeNull();
    expect(part(container, "supply")).toBeNull();
    // The live chart carries the supply once: its tag.
    expect(container.querySelectorAll('[data-part="tile-supply"]')).toHaveLength(1);
  });

  it("the redeem step keeps the price tag fully readable", () => {
    const c = stage(8);
    expect(part(c, "tag-price-group")!.getAttribute("opacity")).toBeNull();
  });

  it("uses site tokens only: no raw hex colours in the variant's sources", () => {
    for (const f of readdirSync(__dirname).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
