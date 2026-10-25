import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, BEAT_LABELS, ILLUSTRATION, floorSharePct, REAL_SCALE_LABEL, SINCE_LISTING, TILE_FLOOR, TILE_NOW, TILE_SUPPLY, beatCaption, beatSrText, formatPctChange, sinceListing, storyFrame, supplyAt, supplyBurns } from "../shared";
import { LANE_H, SPLIT_DIVIDE, SPLIT_SETTLE, CompactTape, burnedText, splitPhase } from "./CompactTape";
import Variant, { SUPPLY_EQUATION, SUPPLY_NOTE, bubbleDetail } from "./Variant";
import { burnFloorText, stackTags } from "./tapeGeometry";

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

const vertices = (d: string) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((v) => [Number(v[1]), Number(v[2])] as const);
const css = readFileSync(join(__dirname, "tapeCompact.module.css"), "utf8");
/** Drawing sizes: the tape inside the card at 1440 (586 x 596, less the 40px chip row) and the phone card. */
const SIZES = [
  [586, 556],
  [350, 418],
] as const;

describe("v34 tape compact", () => {
  it("renders 33's layout: the title row pinned in the stage over the step rail and the tape card, the 8 captions as speech bubbles", () => {
    const { container } = render(<Variant m={m} />);
    const heading = screen.getByRole("heading", { name: "Follow your $100" });
    expect(container.querySelectorAll("h2")).toHaveLength(1);
    // The title row is pinned: in the sticky stage, first, above the rail; nothing sits above the track.
    const stage = container.querySelector("[data-stage]")!;
    const title = stage.querySelector('[data-part="title"]')!;
    expect(title.contains(heading)).toBe(true);
    expect(title.textContent).toContain(`Floor share ${floorSharePct(m)}%`);
    expect(stage.querySelector('[data-part="stage-col"]')!.firstElementChild).toBe(title);
    // The bubble drift reads the driver's --qN on the root: no [data-rail] may take them away.
    expect(container.querySelector("[data-rail]")).toBeNull();
    const track = screen.getByTestId("story-track");
    expect(track.previousElementSibling).toBeNull();
    expect(container.querySelector('[data-part="header"]')).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Story steps" });
    expect(stage.contains(rail)).toBe(true);
    expect(title.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(rail).getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: /Step 8 of 8/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByTestId("v34-level").textContent).toMatch(/^8\/8/);
    // The rail sits above the chart card, both in the stage.
    const card = stage.querySelector('[data-brand-chart="stage"]')!;
    expect(card).toBeTruthy();
    expect(rail.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[data-brand-chart]")).toHaveLength(1);
    const steps = container.querySelectorAll("li[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => {
      const bubble = steps[i]!.querySelector('[data-part="bubble"]') as HTMLElement;
      expect(bubble).toBeTruthy();
      // The sticky drift wrapper reads its own step's progress from the driver's --qN.
      const drift = steps[i]!.firstElementChild as HTMLElement;
      expect(drift.dataset.part).toBe("bubble-drift");
      expect(drift.firstElementChild).toBe(bubble);
      expect(drift.style.getPropertyValue("--bq")).toBe(`var(--q${i}, 1)`);
      // Badge with the step number, caps label, caption, one muted detail.
      expect(bubble.firstElementChild!.textContent).toBe(String(i + 1));
      expect(within(bubble).getByText(BEAT_LABELS[key]).className).toMatch(/caps/);
      expect(within(bubble).getByText(beatCaption(m, key))).toBeTruthy();
      const details = bubble.querySelectorAll('[data-part="detail"], [data-part="supply-note"]');
      expect(details).toHaveLength(1);
      if (key === "exits") {
        // The long exits sentence gives way to why the burn matters (sr-only keeps it), said once.
        expect(details[0]!.textContent).toBe(`${SUPPLY_NOTE} ${SUPPLY_EQUATION}`);
        expect(bubble.querySelector(".sr-only")!.textContent).toBe(beatSrText(m, key));
      } else if (bubbleDetail(m, key)) {
        // A shorter detail where the full sentence would run past two lines; sr-only keeps the sentence.
        expect(details[0]!.textContent).toBe(bubbleDetail(m, key));
        expect(details[0]!.textContent!.length).toBeLessThan(beatSrText(m, key).length);
        expect(details[0]!.textContent!.length).toBeLessThanOrEqual(80);
        expect(bubble.querySelector(".sr-only")!.textContent).toBe(beatSrText(m, key));
      } else {
        expect(details[0]!.textContent).toBe(beatSrText(m, key));
      }
      expect(bubble.textContent!.split(SUPPLY_EQUATION).length - 1).toBe(key === "exits" ? 1 : 0);
    });
    // No caption ribbon any more, and no metric tiles: the values live only in the riding tags.
    expect(container.querySelector('[data-part="caption"]')).toBeNull();
    expect(container.querySelector('[data-part="tile-now"]')).toBeNull();
    expect(container.querySelector('[data-part="metrics"]')).toBeNull();
    expect(card.textContent).toContain(TILE_NOW);
    expect(card.textContent).toContain(TILE_FLOOR);
  });

  it("styles the bubbles as 33's sticky speech bubbles, the ribbon's CSS is gone, no scroll-snap", () => {
    expect(css).toMatch(/\.drift \{[^}]*position: sticky/);
    expect(css).not.toMatch(/\.bubble \{[^}]*position: sticky/);
    expect(css).toMatch(/\.bubble::before \{[^}]*rotate\(45deg\)/);
    expect(css).toMatch(/\.step\[data-active="false"\] \.badge \{/);
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const gone of ["cap", "capCover", "kicker", "deck", "rule", "side", "sentence"]) expect(code, gone).not.toMatch(new RegExp(`\\.${gone}\\b`));
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/scroll-snap|scroll-behavior/);
  });

  it("the current bubble drifts: up by --drift over its step, eased on its own progress, rising in when it becomes current", () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const drift = /\.drift \{([^}]*)\}/.exec(code)![1]!;
    // Smoothstep of the step's progress (var(--qN, 1)): 0 before the step, all of it after, so it reverses.
    expect(drift).toMatch(/--e: calc\(var\(--bq, 1\) \* var\(--bq, 1\) \* \(3 - 2 \* var\(--bq, 1\)\)\)/);
    expect(drift).toMatch(/transform: translateY\(calc\(var\(--drift-lead\) - var\(--e\) \* var\(--drift\)\)\)/);
    // It sits --drift-lead lower via the transform, so on phones (lead = drift) it never rises under the
    // stage, and `top` stays the plain stick line, so the next step's push starts where it always did.
    expect(drift).toMatch(/top: calc\(var\(--stage-h\) \+ var\(--gap\)\);/);
    expect(code).not.toMatch(/top:[^;]*--drift-lead/);
    expect(code).toMatch(/\.root \{[^}]*--drift: 22px;[^}]*--drift-lead: 22px;/);
    expect(code).toMatch(/--drift: 40px;\s*--drift-lead: 20px;/);
    // Scrubbed, never transitioned (only the bubble inside rises in with MOTION.settle).
    expect(drift).not.toMatch(/transition/);
    expect(code).toMatch(/\.bubble \{[^}]*transition:[^}]*transform 240ms cubic-bezier\(0\.2, 0\.7, 0\.2, 1\)/);
    // Phones: the incoming bubble waits 12px low (within MOTION.maxTravel). Desktop, as in 33: the
    // other bubbles drop their cloud and sit 8px low, scrolling past natively.
    expect(code).toMatch(/\.step\[data-active="true"\] ~ \.step \.bubble \{[^}]*translateY\(12px\)/);
    expect(code).toMatch(/\.step\[data-active="false"\] \.bubble \{\s*background: transparent;\s*transform: translateY\(8px\);/);
    expect(code).not.toMatch(/opacity: 0\.6/);
    // Reduced motion: no drift.
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(code)![1]!;
    expect(reduce).toMatch(/--drift: 0px;/);
    expect(reduce).toMatch(/\.drift \{\s*transform: none;/);
  });

  it("the section strip names every beat over the story, and marks the current one in full", () => {
    for (const [w, h] of SIZES) {
      const seen = new Set<string>();
      for (let pos = 0.1; pos <= 8; pos += 0.1) {
        const frame = storyFrame(m, pos);
        const { container } = render(<CompactTape m={m} frame={frame} w={w} h={h} />);
        const current = container.querySelectorAll('[data-current="true"]');
        expect(current).toHaveLength(1);
        const key = BEAT_KEYS[frame.beatIndex]!;
        expect(current[0]!.getAttribute("data-section")).toBe(key);
        // The current section is named in full (number and name).
        expect(current[0]!.querySelector('[data-part="section-name"]')!.textContent).toContain(BEAT_LABELS[key]);
        for (const g of container.querySelectorAll("[data-section]")) {
          if (g.querySelector('[data-part="section-name"]')?.textContent?.includes(BEAT_LABELS[g.getAttribute("data-section") as (typeof BEAT_KEYS)[number]])) seen.add(g.getAttribute("data-section")!);
        }
        cleanup();
      }
      expect([...seen].sort()).toEqual([...BEAT_KEYS].sort());
    }
    // The current section is lit.
    const { container } = render(<CompactTape m={m} frame={storyFrame(m, 3.5)} w={586} h={556} />);
    expect(container.querySelector('[data-part="section-current"]')).toBeTruthy();
  });

  it("the riding tags show the values, and the change since listing only once trading opens", () => {
    const pct = (c: HTMLElement, part: string) => c.querySelector(`[data-part="pct-${part}"]`);
    for (const pos of [0.6, 1.9]) {
      const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={586} h={556} />);
      expect(container.textContent).toContain(TILE_NOW);
      expect(container.textContent).not.toContain(SINCE_LISTING);
      expect(pct(container, "price")).toBeNull();
      cleanup();
    }
    for (const [pos, sign] of [
      [2.7, "+"],
      [3.8, "−"],
    ] as const) {
      const frame = storyFrame(m, pos);
      const want = sinceListing(m, frame);
      const { container } = render(<CompactTape m={m} frame={frame} w={586} h={556} />);
      const price = pct(container, "price")!;
      expect(price.textContent).toBe(`${formatPctChange(want.now!)} ${SINCE_LISTING}`);
      expect(price.textContent!.startsWith(sign)).toBe(true);
      expect(price.querySelector("tspan")!.getAttribute("class")).toMatch(sign === "+" ? /pctUp/ : /pctDown/);
      const floor = pct(container, "floor")!;
      expect(floor.textContent).toBe(`${formatPctChange(want.floor!)} ${SINCE_LISTING}`);
      expect(floor.querySelector("tspan")!.getAttribute("class")).toMatch(/pctFloor/);
      cleanup();
    }
  });

  it("the playhead stays centred and the tags stay inside the card (flipping left when there is no room)", () => {
    for (const [w, h] of [...SIZES, [270, 400] as const]) {
      for (const pos of [0.5, 2.6, 5.5, 7.9]) {
        const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={w} h={h} />);
        const head = container.querySelector('[data-part="playhead"]')!;
        expect(Math.abs(Number(head.getAttribute("x1")) - w / 2)).toBeLessThanOrEqual(1);
        for (const r of container.querySelectorAll('[data-part^="tag-"] > rect')) {
          const x = Number(r.getAttribute("x"));
          const y = Number(r.getAttribute("y"));
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x + Number(r.getAttribute("width"))).toBeLessThanOrEqual(w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y + Number(r.getAttribute("height"))).toBeLessThanOrEqual(h);
        }
        cleanup();
      }
    }
    // 270px: a 124px tag cannot fit right of the centre (135 + 12 + 124 > 264), so it sits left.
    const { container } = render(<CompactTape m={m} frame={storyFrame(m, 3.5)} w={270} h={400} />);
    const tag = container.querySelector('[data-part="tag-price"] > rect')!;
    expect(Number(tag.getAttribute("x")) + Number(tag.getAttribute("width"))).toBeLessThan(135);
  });

  it("split: the raise bar divides into the labelled column, holds, then the floor part settles on the slab", () => {
    expect(SPLIT_DIVIDE[1]).toBeLessThan(SPLIT_SETTLE[0]);
    expect(splitPhase(storyFrame(m, 1 + (SPLIT_DIVIDE[1] + SPLIT_SETTLE[0]) / 2))).toEqual({ grow: 1, reveal: 0 });
    const held = render(<CompactTape m={m} frame={storyFrame(m, 1.45)} w={586} h={556} />).container;
    const label = (key: string) => held.querySelector(`[data-part="split-label-${key}"]`)!.textContent;
    expect(label("floor")).toBe("Floor 50%");
    expect(label("market")).toBe("Market 40%");
    expect(label("fees")).toBe("Fees 5% · 5%");
    const box = (c: HTMLElement, part: string) => {
      const r = c.querySelector(`[data-part="${part}"]`)!;
      const y = Number(r.getAttribute("y"));
      return { x: Number(r.getAttribute("x")), w: Number(r.getAttribute("width")), top: y, bottom: y + Number(r.getAttribute("height")) };
    };
    const f = box(held, "split-floor");
    const mk = box(held, "split-market");
    expect(f.top).toBeGreaterThan(mk.bottom);
    expect(mk.x).toBe(f.x);
    cleanup();
    // Same bar across the presale/split boundary.
    const end = box(render(<CompactTape m={m} frame={storyFrame(m, 0.999)} w={586} h={556} />).container, "raise-fill");
    cleanup();
    const start = box(render(<CompactTape m={m} frame={storyFrame(m, 1.001)} w={586} h={556} />).container, "split-market");
    cleanup();
    expect(Math.abs(start.x - end.x)).toBeLessThan(1);
    expect(start.w).toBe(end.w);
    // Settled: the floor part's top is where the staircase starts.
    const done = render(<CompactTape m={m} frame={storyFrame(m, 2)} w={586} h={556} />).container;
    const first = vertices(done.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!)[0]!;
    expect(Math.abs(box(done, "split-floor").top - first[1])).toBeLessThan(1);
  });

  it("every beat gets an even 130 svh runway, the split 160, and the presale starts at the reading line", () => {
    const { container } = render(<Variant m={m} />);
    const runway = (i: number) => (container.querySelectorAll("[data-step]")[i] as HTMLElement).style.getPropertyValue("--runway");
    BEAT_KEYS.forEach((key, i) => expect(runway(i), key).toBe(key === "split" ? "160svh" : "130svh"));
    // A lead-in before the first step, so the presale starts from $0 even at the top of the page.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/\.leadIn \.step:first-child \{\s*margin-top: calc\(0\.4 \* \(100svh - var\(--stage-h\)\)\);/);
    expect(code).toMatch(/\.leadIn \.step:first-child \{\s*margin-top: 50svh;/);
  });

  it("the floor is a staircase, never flat, with the arbitrage line and the bounce", () => {
    const { container } = render(<CompactTape m={m} frame={storyFrame(m, 6)} w={586} h={556} />);
    const pts = vertices(container.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!);
    let risers = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      expect(Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6).toBe(true);
      if (Math.abs(x1 - x0) < 1e-6 && y1 < y0) risers++;
    }
    expect(risers).toBeGreaterThan(1);
    expect(container.querySelector('[data-part="arb-line"]')).toBeTruthy();
    expect(container.querySelector('[data-part="bounce"]')).toBeTruthy();
  });

  it("reduced motion: no track, eight static tape frames with captions, pills and the scale chip", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    // No stage, so the title heads the stills; still a single h2.
    const heading = screen.getByRole("heading", { name: "Follow your $100" });
    expect(document.querySelectorAll("h2")).toHaveLength(1);
    // Before the preference is known it renders too, but CSS hides it unless the reader asks for reduce.
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.titleStill \{\s*display: none;/);
    expect(heading.compareDocumentPosition(screen.getByTestId("story-stills")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const figures = screen.getByTestId("story-stills").querySelectorAll("figure");
    expect(figures).toHaveLength(8);
    BEAT_KEYS.forEach((key, i) => {
      expect(figures[i]!.textContent).toContain(beatCaption(m, key));
      expect(figures[i]!.querySelector('[data-brand-chart="still"] svg')).toBeTruthy();
    });
    const pill = (i: number) => figures[i]!.querySelector('[data-part="illustration"]')?.textContent ?? null;
    expect(pill(0)).toBeNull();
    expect(pill(BEAT_KEYS.indexOf("pump"))).toBe(ILLUSTRATION);
    expect(figures[BEAT_KEYS.indexOf("bounce")]!.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(figures[1]!.textContent).toContain("Market 40%");
  });

  it("uses site tokens only: no raw hex colours", () => {
    for (const f of readdirSync(__dirname).filter((n) => /\.(tsx?|css)$/.test(n) && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
  it("brings the stage to 20's size: brand container, min(640px, 82svh), the harness's 6fr / 4fr split", () => {
    expect(css).toMatch(/--stage-h: min\(640px, 82svh\)/);
    const { container } = render(<Variant m={m} />);
    const root = container.querySelector("section")!;
    expect(root.className).toContain("max-w-[1120px]");
    // The harness's split layout (6fr / 4fr, 48px gap on wide screens): stage first, steps beside it.
    const track = screen.getByTestId("story-track");
    expect(track.firstElementChild!.hasAttribute("data-stage")).toBe(true);
    expect(track.children[1]!.tagName).toBe("OL");
  });

  /** Story pos at which the tape's time reaches t (the frame's t is monotone in pos). */
  const posAt = (t: number) => {
    let lo = 0;
    let hi = 8;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (storyFrame(m, mid).t < t) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const burns = supplyBurns(m);

  it("burn markers: one flame per burn, appearing only once the tape passes it, labelled with the supply drop and its small floor step", () => {
    expect(burns.map((b) => b.t)).toEqual([6.8, 8.2]);
    for (const [w, h] of SIZES) {
      for (const pos of [0.5, 1.5, 2.5, 4.5, 5.2]) {
        const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={w} h={h} />);
        expect(container.querySelectorAll('[data-part="burn"]'), `pos ${pos}`).toHaveLength(0);
        cleanup();
      }
      // Just before and just after each burn.
      burns.forEach((b, i) => {
        const p = posAt(b.t);
        const before = render(<CompactTape m={m} frame={storyFrame(m, p - 0.01)} w={w} h={h} />).container;
        expect(before.querySelectorAll('[data-part="burn"]')).toHaveLength(i);
        cleanup();
        const after = render(<CompactTape m={m} frame={storyFrame(m, p + 0.01)} w={w} h={h} />).container;
        expect(after.querySelectorAll('[data-part="burn"]')).toHaveLength(i + 1);
        cleanup();
      });
      // The end: both flames stay; the big one is labelled, pairing the supply drop with the floor step.
      const end = render(<CompactTape m={m} frame={storyFrame(m, 8)} w={w} h={h} />).container;
      expect(end.querySelectorAll('[data-part="burn"]')).toHaveLength(2);
      const big = end.querySelector('[data-burn="big"] [data-part="burn-label"]')!;
      // It names the hatched band: "30% burned" on the lane's scale, then the floor step it causes.
      expect(big.textContent).toBe("30% burned→ floor +0.9%");
      // It hangs at the foot of its leader, just over the lane: left of the leader, under the
      // "Bounce" label by a clear gap (so it never reads as the bounce's burn).
      const leader = end.querySelector('[data-burn="big"] [data-part="burn-leader"]')!;
      const lx = Number(leader.getAttribute("x1"));
      const lane = Number(end.querySelector('[data-part="supply-lane"] > line')!.getAttribute("y1"));
      const lastLine = big.querySelectorAll("tspan")[1]!;
      expect(Number(big.getAttribute("x"))).toBeLessThan(lx);
      expect(lx - Number(big.getAttribute("x"))).toBeLessThan(10);
      expect(Number(big.getAttribute("y")) + Number(lastLine.getAttribute("dy"))).toBeLessThan(lane - 4);
      expect(Number(big.getAttribute("y")) + Number(lastLine.getAttribute("dy"))).toBeGreaterThan(lane - 30);
      const bounceY = Number([...end.querySelectorAll("text")].find((t) => t.textContent === "Bounce")!.getAttribute("y"));
      expect(Number(big.getAttribute("y")) - bounceY).toBeGreaterThan(24);
      // The old "+x% from exits" label is gone: the burn label says it.
      expect(end.textContent).not.toContain("from exits");
      expect(end.querySelector('[data-burn="big"] [data-part="burn-leader"]')).toBeTruthy();
      // The tiny burn stays a marker only: no leader.
      expect(end.querySelector('[data-burn="small"] [data-part="burn-leader"]')).toBeNull();
      // The tiny burn names itself only during its own beat.
      expect(end.querySelector('[data-burn="small"] [data-part="burn-label"]')).toBeNull();
      cleanup();
      const bounce = render(<CompactTape m={m} frame={storyFrame(m, 5.75)} w={w} h={h} />).container;
      expect(bounce.querySelector('[data-burn="small"] [data-part="burn-label"]')!.textContent).toBe("0.4% burned→ floor +0.01%");
      cleanup();
    }
    expect(burnFloorText(burns[0]!.floorPct)).toBe("+0.01%");
    expect(burnFloorText(burns[1]!.floorPct)).toBe("+0.9%");
    // Honesty: a 30% burn lifts the floor by under 1%.
    expect(burns[1]!.floorPct).toBeLessThan(1);
  });

  it("the supply lane: nothing before listing, then 100% stepping down at the burn times, under the flames", () => {
    for (const pos of [0.5, 1.5, 1.99]) {
      const { container } = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={586} h={556} />);
      expect(container.querySelector('[data-part="supply-lane"]')).toBeNull();
      expect(container.querySelector('[data-part="supply-scale"]')).toBeNull();
      expect(container.querySelector('[data-part="tag-supply"]')).toBeNull();
      cleanup();
    }
    const listed = render(<CompactTape m={m} frame={storyFrame(m, 2.5)} w={586} h={556} />).container;
    expect(listed.querySelector('[data-part="supply-scale"]')!.textContent).toBe(`${TILE_SUPPLY}100%0%`);
    const flat = vertices(listed.querySelector('[data-part="supply-line"]')!.getAttribute("d")!);
    expect(new Set(flat.map(([, y]) => y)).size).toBe(1);
    cleanup();
    const end = render(<CompactTape m={m} frame={storyFrame(m, 8)} w={586} h={556} />).container;
    const pts = vertices(end.querySelector('[data-part="supply-line"]')!.getAttribute("d")!);
    // Listing, then a vertical drop at each burn, then on to the playhead.
    expect(pts).toHaveLength(6);
    const drops = pts.filter((p, i) => i > 0 && Math.abs(p[0] - pts[i - 1]![0]) < 1e-6);
    expect(drops).toHaveLength(2);
    const flames = [...end.querySelectorAll('[data-part="burn"] path')].map((p) => vertices(p.getAttribute("d")!)[0]![0]);
    drops.forEach(([x], i) => expect(Math.abs(x - flames[i]!)).toBeLessThan(0.2));
    // Each drop is the burn's share: 100 → 99.6 → 69.7 on the lane's own scale.
    const [y100, yA, yB] = [pts[0]![1], pts[2]![1], pts[4]![1]];
    // (the 0.4% drop is a fraction of a pixel; the 30% one is a step of about 20px on the 67px scale).
    expect(yA).toBeGreaterThanOrEqual(y100);
    expect(yA - y100).toBeLessThan(0.5);
    expect(yB - y100).toBeGreaterThan(18);
    // The playhead ends the line.
    expect(Math.abs(pts[5]![0] - 293)).toBeLessThan(0.2);
    // The lane lies under the main plot: below every floor vertex.
    const floorYs = vertices(end.querySelector('[data-part="floor-steps"]')!.getAttribute("d")!).map(([, y]) => y);
    expect(Math.min(...pts.map(([, y]) => y))).toBeGreaterThan(Math.max(...floorYs));
  });

  it("the third riding tag shows the token supply and its change since listing, from listing on", () => {
    for (const [w, h] of SIZES) {
      for (const pos of [2.5, 6.5, 7.5, 8]) {
        const frame = storyFrame(m, pos);
        const want = supplyAt(m, frame)!;
        const { container } = render(<CompactTape m={m} frame={frame} w={w} h={h} />);
        const tag = container.querySelector('[data-part="tag-supply"]')!;
        expect(tag.textContent).toContain(TILE_SUPPLY);
        expect(tag.querySelector('[data-part="supply-value"]')!.textContent).toBe(`${(want.share * 100).toFixed(1)}%`);
        expect(tag.querySelector('[data-part="pct-supply"]')!.textContent).toBe(`${formatPctChange(want.pct)} ${SINCE_LISTING}`);
        // Three tags, none overlapping, none on the head dot.
        const boxes = [...container.querySelectorAll('[data-part^="tag-"] > rect, [data-part="tag-price"] > rect')].map((r) => {
          const y = Number(r.getAttribute("y"));
          const x = Number(r.getAttribute("x"));
          return { x, y, r: x + Number(r.getAttribute("width")), b: y + Number(r.getAttribute("height")) };
        });
        expect(boxes.length).toBe(3);
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) expect(boxes[i]!.b <= boxes[j]!.y || boxes[j]!.b <= boxes[i]!.y).toBe(true);
        for (const bx of boxes) expect(bx.x).toBeGreaterThan(w / 2 + 6);
        cleanup();
      }
    }
    const end = render(<CompactTape m={m} frame={storyFrame(m, 8)} w={586} h={556} />).container;
    expect(end.querySelector('[data-part="tag-supply"]')!.textContent).toContain("69.7%");
    expect(end.querySelector('[data-part="pct-supply"]')!.textContent).toBe(`−30% ${SINCE_LISTING}`);
  });

  it("stackTags keeps a column of tags in order, apart and inside its bounds", () => {
    const at = stackTags(
      [
        { want: 100, h: 40 },
        { want: 105, h: 40 },
        { want: 300, h: 30 },
      ],
      0,
      290,
      6,
    );
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(46 - 1e-9);
    expect(at[2]! + 15).toBeLessThanOrEqual(290);
    expect(at[0]).toBe(100);
  });

  it("the separate supply block is gone: no supply row in the stage or the stills, no repeated numbers", () => {
    const { container } = render(<Variant m={m} />);
    expect(container.querySelector('[data-part="supply-slot"]')).toBeNull();
    expect(container.querySelector('[data-part="supply"]')).toBeNull();
    expect(container.querySelectorAll('[data-part="tag-supply"]')).toHaveLength(1);
    cleanup();
    reduceMotion = true;
    render(<Variant m={m} />);
    const figures = screen.getByTestId("story-stills").querySelectorAll("figure");
    expect(figures).toHaveLength(8);
    figures.forEach((f, i) => {
      expect(f.querySelector('[data-part="supply"]')).toBeNull();
      expect(!!f.querySelector('[data-part="tag-supply"]'), `still ${i}`).toBe(i >= 2);
    });
  });

  it("redeem: the price tag stays at full strength (only its dot dims with the price line)", () => {
    const frame = storyFrame(m, 7.9);
    expect(frame.priceOpacity).toBeLessThan(1);
    const { container } = render(<CompactTape m={m} frame={frame} w={586} h={556} />);
    expect(container.querySelector('[data-part="tag-price"]')!.getAttribute("opacity")).toBeNull();
    expect(Number(container.querySelector('[data-part="price-head"]')!.getAttribute("opacity"))).toBeLessThan(1);
  });

  it("the supply lane is tall on its honest 0–100% scale: 88px wide (30% ≈ 20px), 56px on phones", () => {
    for (const [w, h] of SIZES) {
      const compact = w < 520;
      const c = render(<CompactTape m={m} frame={storyFrame(m, 8)} w={w} h={h} />).container;
      expect(Number(c.querySelector('[data-part="supply-lane"]')!.getAttribute("data-lane-h"))).toBe(LANE_H(compact));
      // The dashed 100% line and the 0% base: the full span, no magnification.
      const lines = [...c.querySelectorAll('[data-part="supply-lane"] > line')].map((l) => Number(l.getAttribute("y1")));
      const span = lines[2]! - lines[1]!;
      expect(span).toBeGreaterThanOrEqual(compact ? 36 : 60);
      // The lane's name sits over its 100% line, clear of it (descenders included).
      const name = c.querySelector('[data-part="supply-scale"] text')!;
      expect(lines[1]! - Number(name.getAttribute("y"))).toBeGreaterThanOrEqual(5);
      const pts = vertices(c.querySelector('[data-part="supply-line"]')!.getAttribute("d")!);
      // The supply line ends at 69.7% of the span below the 100% line.
      expect(Math.abs(pts[5]![1] - lines[1]! - (1 - supplyAt(m, storyFrame(m, 8))!.share) * (span - 0.5))).toBeLessThan(1);
      cleanup();
    }
    expect(LANE_H(false)).toBe(88);
    expect(LANE_H(true)).toBe(56);
  });

  it("after the 30% burn the burned part is hatched over a tint, its riser bold; not before it, and not for the 0.4% burn", () => {
    const big = burns[1]!;
    const p = posAt(big.t);
    for (const [w, h] of SIZES) {
      for (const pos of [2.5, 5.75, p - 0.01]) {
        const c = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={w} h={h} />).container;
        expect(c.querySelector('[data-part="burned-band"]'), `pos ${pos}`).toBeNull();
        expect(c.querySelector('[data-part="burn-riser"]'), `pos ${pos}`).toBeNull();
        cleanup();
      }
      for (const pos of [p + 0.05, 7.5, 8]) {
        const frame = storyFrame(m, pos);
        const c = render(<CompactTape m={m} frame={frame} w={w} h={h} />).container;
        const band = c.querySelector('[data-part="burned-band"] rect[fill]')!;
        expect(band.getAttribute("fill")).toMatch(/^url\(#burnHatch/);
        // It spans from the riser to the playhead, from the 100% line down to the supply line.
        expect(Math.abs(Number(band.getAttribute("x")) + Number(band.getAttribute("width")) - w / 2)).toBeLessThan(1);
        expect(Number(band.getAttribute("height"))).toBeGreaterThan(w < 520 ? 9 : 18);
        // The riser runs from the 100% line down to the supply line; it glows only while the burn is fresh.
        const riser = [...c.querySelectorAll('[data-part="burn-riser"] line')];
        const bold = riser[riser.length - 1]!;
        expect(Number(bold.getAttribute("y2")) - Number(bold.getAttribute("y1"))).toBeCloseTo(Number(band.getAttribute("height")), 3);
        expect(riser.length).toBe(pos === 8 ? 1 : 2);
        // The flame's label names the band.
        expect(c.querySelector('[data-burn="big"] [data-part="burn-label"] tspan')!.textContent).toBe("30% burned");
        cleanup();
      }
    }
    expect(burnedText(0.697)).toBe("30% burned");
  });

  it("redeem: the tags stack in the order of their dots, so the connectors never cross", () => {
    for (const [w, h] of SIZES) {
      for (const pos of [2.6, 3.9, 5.5, 6.9, 7.5, 7.9, 8]) {
        const c = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={w} h={h} />).container;
        const conns = [...c.querySelectorAll('[data-part^="tag-"] path, [data-part="price-head"] path')].map((pth) => vertices(pth.getAttribute("d")!));
        for (let i = 0; i < conns.length; i++)
          for (let j = i + 1; j < conns.length; j++) {
            const [a0, a1] = [conns[i]![0]![1], conns[i]![1]![1]];
            const [b0, b1] = [conns[j]![0]![1], conns[j]![1]![1]];
            // Same direction of order at both ends: no X.
            expect(Math.sign(a0 - b0) * Math.sign(a1 - b1), `pos ${pos}`).toBeGreaterThanOrEqual(0);
          }
        cleanup();
      }
    }
  });

  it("the floor tag's dot sits at what redeem pays (net), hanging from the step, so dots follow the values", () => {
    for (const [w, h] of SIZES) {
      for (const pos of [5.5, 6.6, 7.5, 8]) {
        const frame = storyFrame(m, pos);
        const c = render(<CompactTape m={m} frame={frame} w={w} h={h} />).container;
        const dot = Number(c.querySelector('[data-part="floor-dot"]')!.getAttribute("cy"));
        const priceDot = Number(c.querySelector('[data-part="price-head"] circle')!.getAttribute("cy"));
        // Higher value, higher on screen.
        if (Math.abs(frame.valueOf100 - frame.floorNet100!) > 0.02) expect(Math.sign(dot - priceDot), `pos ${pos}`).toBe(Math.sign(frame.valueOf100 - frame.floorNet100!));
        const tick = c.querySelector('[data-part="floor-net-tick"]')!;
        expect(Number(tick.getAttribute("y2"))).toBeCloseTo(dot, 6);
        expect(Number(tick.getAttribute("y1"))).toBeLessThan(dot);
        cleanup();
      }
    }
    // Redeem: the price ($36.92) is drawn above the payout ($36.87), and its tag sits above too.
    const c = render(<CompactTape m={m} frame={storyFrame(m, 7.95)} w={586} h={556} />).container;
    const rectY = (part: string) => Number(c.querySelector(`[data-part="${part}"] > rect`)!.getAttribute("y"));
    expect(rectY("tag-price")).toBeLessThan(rectY("tag-floor"));
  });

  it("before listing the price plot keeps the lane's room; the lane takes it over early in the pump", () => {
    const zeroY = (pos: number) => {
      const c = render(<CompactTape m={m} frame={storyFrame(m, pos)} w={586} h={556} />).container;
      const y = Number([...c.querySelectorAll("text")].find((t) => t.textContent === "$0")!.getAttribute("y"));
      cleanup();
      return y;
    };
    // The $0 line sits lower before listing, down into where the lane goes (the card does not change).
    expect(zeroY(0.5) - zeroY(2.5)).toBeGreaterThan(LANE_H(false) - 10);
    expect(zeroY(1.5)).toBe(zeroY(0.5));
  });
});
