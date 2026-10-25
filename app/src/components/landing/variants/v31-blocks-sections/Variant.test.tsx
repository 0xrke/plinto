import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, BEAT_LABELS, SINCE_LISTING, TILE_FLOOR, TILE_NOW, beatCaption, beatSrText, formatPctChange, sinceListing, storyFrame, tileValues } from "../shared";
import { SectionsStage, onArbLine, sectionLabels, xMaxFor, TAG } from "./SectionsStage";
import { beatBounds, layoutTags, plotFor } from "./geometry";
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

const stage = (pos: number) => render(<SectionsStage m={m} frame={storyFrame(m, pos)} />).container;
const part = (c: Element, name: string) => c.querySelector(`[data-part="${name}"]`);

describe("v31 Blocks · sections", () => {
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

  it("uses site tokens only: no raw hex colours in the variant's sources", () => {
    for (const f of readdirSync(__dirname).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
