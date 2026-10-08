import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { BEAT_KEYS, storyFrame } from "@/lib/landing/sim/story";
import type { StoryChartProps } from "./StoryChart";
import { LaunchStory, keepClearOfStage } from "./LaunchStory";
import { ILLUSTRATION, storyChartStrings } from "./storyChartCopy";
import {
  BEAT_LABELS,
  BEAT_RUNWAY_SVH,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  beatCaption,
  beatSrText,
  railLabel,
  storyProse,
} from "./storyCopy";
import { tileValues } from "./StoryTiles";

// The chart is drawn by StoryChart (tested on its own); here it only reports the frame it got.
vi.mock("./StoryChart", () => ({
  StoryChart: ({ frame, variant }: StoryChartProps) => (
    <div data-testid={`chart-${variant}`} data-pos={frame.pos} data-beat={frame.beat} aria-hidden />
  ),
}));

const k = simConstantsFromSdk();
const m50 = launchMath(k, 50);

/* ---------- Browser fakes: rAF, IntersectionObserver, matchMedia, layout ---------- */

const VH = 1000;
/** Wide layout: the reading line is at 0.5 × VH. */
const LINE = VH / 2;
/** Document y of the first step's top. */
const STEPS_TOP = 1000;
const stepH = BEAT_KEYS.map((key) => (BEAT_RUNWAY_SVH[key] * VH) / 100);
const stepTop = (i: number) => STEPS_TOP + stepH.slice(0, i).reduce((a, b) => a + b, 0);

let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
let ios: FakeIO[] = [];
let reduceMotion = false;
let scrollPos = 0;

class FakeIO {
  targets = new Set<Element>();
  constructor(public cb: IntersectionObserverCallback) {
    ios.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
    ios = ios.filter((o) => o !== this);
  }
  takeRecords() {
    return [];
  }
}

function rect(top: number, height: number, left = 0, width = 400): DOMRect {
  return { top, bottom: top + height, height, left, right: left + width, width, x: left, y: top, toJSON() {} } as DOMRect;
}

function flushRaf() {
  act(() => {
    const q = rafQueue;
    rafQueue = new Map();
    q.forEach((cb) => cb(0));
  });
}

/** Scroll the page to `y` (native scroll: the driver only sees the event and the rects). */
function scrollToY(y: number) {
  scrollPos = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  flushRaf();
}

/** Put step i's top at `line − q × height`, i.e. step i at progress q. */
const yFor = (i: number, q: number) => stepTop(i) - (LINE - q * stepH[i]!);

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  ios = [];
  reduceMotion = false;
  scrollPos = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => rafQueue.delete(id));
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("innerHeight", VH);
  vi.stubGlobal("matchMedia", (query: string) => ({
    // Reduced motion per test; every other query (the wide layout) matches.
    matches: query.includes("reduce") ? reduceMotion : true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollPos });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.dataset?.step !== undefined) {
      const i = Number(el.dataset.step);
      return rect(stepTop(i) - scrollPos, stepH[i]!);
    }
    return rect(0, 0);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Render, then let the observer report the section in view. */
function mount(m = launchMath(k, 50)) {
  const r = render(<LaunchStory m={m} floorShareHref="#floor-share-input" />);
  act(() => {
    for (const io of ios) io.cb([...io.targets].map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry), io as unknown as IntersectionObserver);
  });
  flushRaf();
  return r;
}

const pos = () => Number(screen.getByTestId("chart-stage").dataset.pos);
const beat = () => screen.getByTestId("chart-stage").dataset.beat;
const current = () => screen.getAllByRole("button").find((b) => b.getAttribute("aria-current") === "step")?.getAttribute("aria-label");
const steps = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("li[data-step]")];

/* ---------- Copy ---------- */

const BANNED = /guarantee|profit|\bsafe\b|risk-free|protected from loss/i;
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w));
const numbers = (s: string) => s.match(/\$?\d[\d,.]*%?/g) ?? [];

describe("story copy", () => {
  const ms = Array.from({ length: k.vaultShareMaxPct - k.vaultShareMinPct + 1 }, (_, i) => launchMath(k, k.vaultShareMinPct + i));

  it("keeps each caption to 7 words and at most one number, at every floor share", () => {
    for (const m of ms) {
      for (const key of BEAT_KEYS) {
        const c = beatCaption(m, key);
        expect(words(c).length, c).toBeLessThanOrEqual(7);
        expect(numbers(c).length, c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("matches the spec's captions at the defaults", () => {
    expect(BEAT_KEYS.map((key) => beatCaption(m50, key))).toEqual([
      "You buy $100 in the presale.",
      "50% of the raise becomes the floor.",
      "Trading opens. Your $100 runs up.",
      "Hype fades. Price falls to the floor.",
      "Zoom in: the floor climbs in steps.",
      "Below the arbitrage line, buy-and-redeem pays.",
      "Every redemption leaves 2% in the vault.",
      "Redeem now: $36.87 back, not zero.",
    ]);
  });

  it("keeps the visible prose to about 70 words", () => {
    for (const m of ms) expect(storyProse(m).flatMap(words).length).toBeLessThanOrEqual(70);
  });

  it("states the honesty line and labels the illustration; no banned words anywhere", () => {
    expect(STORY_HONESTY).toBe("The floor protects from zero, not from loss.");
    expect(ILLUSTRATION).toBe("Illustration");
    for (const m of ms) {
      const texts = [...storyProse(m), ...BEAT_KEYS.map((key) => beatSrText(m, key)), ...storyChartStrings(m)];
      for (const t of texts) expect(t, t).not.toMatch(BANNED);
      expect(beatSrText(m, "pump")).toMatch(/^Illustration/);
    }
  });

  it("gives the screen-reader lines the real numbers at the defaults", () => {
    expect(beatSrText(m50, "steps")).toBe("0.24% of every trade reaches the vault at each fee harvest: +4.8% after $100k traded.");
    expect(beatSrText(m50, "bounce")).toBe("Below about 97% of the floor, buying in the pool and redeeming pays, before price impact and costs.");
    expect(beatSrText(m50, "exits")).toBe(
      "Under about 99% of the floor, redeeming pays more than selling: 30% of supply redeems, and the 2% exit fee kept in the vault lifts the floor 0.9%.",
    );
    expect(beatSrText(m50, "redeem")).toBe("Redeem pays $36.87 per $100; the price can stay below what you paid.");
  });

  it("tiles: the floor steps up from $34.88 to $36.87, and the end reads Redeemed", () => {
    expect(tileValues(storyFrame(m50, 0)).floor).toBe("—");
    expect(tileValues(storyFrame(m50, 2)).floor).toBe("$34.88");
    expect(tileValues(storyFrame(m50, 8))).toEqual({ now: "Redeemed", floor: "$36.87" });
    const seen = new Set<string>();
    for (let p = 2; p <= 8; p += 0.05) seen.add(tileValues(storyFrame(m50, p)).floor);
    const vals = [...seen].map((s) => Number(s.replace("$", "")));
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
    expect(vals.length).toBeGreaterThanOrEqual(7);
  });
});

/* ---------- Server render ---------- */

describe("LaunchStory server render", () => {
  it("renders the finished frame: every caption, the final chart, the tiles and the stills", () => {
    const html = renderToString(<LaunchStory m={m50} />);
    expect(html).toContain(STORY_TITLE);
    for (const key of BEAT_KEYS) expect(html).toContain(beatCaption(m50, key));
    expect(html).toContain(STORY_HONESTY);
    expect(html).toContain(STORY_FOOTNOTE);
    expect(html).toMatch(/data-testid="chart-stage" data-pos="8" data-beat="redeem"/);
    expect(html).toContain("Redeemed");
    expect(html).toContain("$36.87");
    // Stills render on the server too (CSS shows them only under prefers-reduced-motion).
    expect(html.match(/data-testid="chart-still"/g)).toHaveLength(8);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(`aria-label="${railLabel(7)}"`);
  });
});

/* ---------- Scroll ---------- */

describe("LaunchStory scrolling", () => {
  it("unmounts the stills once motion is known to be fine and attaches one passive listener", () => {
    const add = vi.spyOn(window, "addEventListener");
    const { container } = mount();
    expect(container.querySelector("[data-testid='story-stills']")).toBeNull();
    expect(container.querySelectorAll("[data-stage]")).toHaveLength(1);
    const scrollCalls = add.mock.calls.filter((c) => c[0] === "scroll");
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]![2]).toMatchObject({ passive: true });
    expect(add.mock.calls.some((c) => /wheel|touch/.test(String(c[0])))).toBe(false);
  });

  it("maps step progress to the beat: a beat plays over q 0.05..0.75 of its step", () => {
    const { container } = mount();
    scrollToY(0); // above the story: the first beat, not started
    expect(pos()).toBe(0);
    expect(beat()).toBe("presale");
    expect(current()).toBe(railLabel(0));

    scrollToY(yFor(2, 0.4));
    expect(pos()).toBeCloseTo(2.5, 9);
    expect(beat()).toBe("pump");
    expect(current()).toBe(railLabel(2));
    expect(steps(container).map((s) => s.dataset.active)).toEqual(BEAT_KEYS.map((_, i) => String(i === 2)));
    const rail = container.querySelector<HTMLElement>("[data-rail]")!;
    expect(rail.style.getPropertyValue("--q2")).toBe("0.4");
    expect(rail.style.getPropertyValue("--q1")).toBe("1");
    expect(container.querySelector("section")!.style.getPropertyValue("--q2")).toBe("");
    expect(screen.getByTestId("rail-status").textContent).toBe("3/8 · Pump");

    scrollToY(yFor(2, 0.75));
    expect(pos()).toBe(3);
    scrollToY(yFor(2, 0.95)); // past the window: the beat holds its finished frame
    expect(pos()).toBe(3);
    expect(current()).toBe(railLabel(2));
  });

  it("scrolling back up reverses to exactly the same frames", () => {
    mount();
    const probes: Array<[number, number]> = [
      [0, 0.3],
      [1, 0.5],
      [3, 0.2],
      [4, 0.6],
      [5, 0.45],
      [6, 0.7],
    ];
    const down = probes.map(([i, q]) => {
      scrollToY(yFor(i, q));
      return pos();
    });
    scrollToY(yFor(7, 0.9));
    const up = [...probes].reverse().map(([i, q]) => {
      scrollToY(yFor(i, q));
      return pos();
    });
    expect(up.reverse()).toEqual(down);
  });

  it("a fast fling lands on exact frames: the end, then the start", () => {
    const { container } = mount();
    scrollToY(0);
    scrollToY(stepTop(8) + 5000); // far past the story in one frame
    expect(pos()).toBe(8);
    expect(beat()).toBe("redeem");
    expect(screen.getByTestId("tile-now").textContent).toBe("Redeemed");
    expect(current()).toBe(railLabel(7));
    scrollToY(0); // back above it in one frame
    expect(pos()).toBe(0);
    expect(current()).toBe(railLabel(0));
    expect(container.querySelector<HTMLElement>("[data-rail]")!.style.getPropertyValue("--q7")).toBe("0");
  });

  it("finishes the last beat at q = 0.75, before the step (and the pinned stage) runs out", () => {
    mount();
    scrollToY(yFor(7, 0.74));
    expect(pos()).toBeLessThan(8);
    scrollToY(yFor(7, 0.75));
    expect(pos()).toBe(8);
  });

  it("a rail click scrolls to that step, past its beat, and keeps focus on the button", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    mount();
    scrollToY(yFor(1, 0.5));
    const btn = screen.getByRole("button", { name: railLabel(4) });
    btn.focus();
    fireEvent.click(btn);
    // top = scrollY + rect.top + 0.85 × height − reading line, i.e. the step at q = 0.85.
    expect(scrollTo).toHaveBeenCalledWith({ top: yFor(4, 0.85), behavior: "smooth" });
    expect(document.activeElement).toBe(btn);
    scrollToY(yFor(4, 0.85));
    expect(pos()).toBe(5);
    expect(current()).toBe(railLabel(4));
  });

  it("a scroll frame that does not move pos by a quantum commits nothing", () => {
    const commits: string[] = [];
    const tree = (
      <Profiler id="story" onRender={(_id, phase) => commits.push(phase)}>
        <LaunchStory m={m50} floorShareHref="#floor-share-input" />
      </Profiler>
    );
    render(tree);
    act(() => {
      for (const io of ios) io.cb([...io.targets].map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry), io as unknown as IntersectionObserver);
    });
    flushRaf();
    scrollToY(yFor(2, 0.4));
    expect(pos()).toBeCloseTo(2.5, 9);
    commits.length = 0;
    // q 0.4 → 0.4015: past the driver's 0.001 threshold (it notifies), under the 0.005 pos quantum.
    scrollToY(yFor(2, 0.4015));
    expect(commits).toEqual([]);
    scrollToY(yFor(2, 0.41));
    expect(commits.length).toBeGreaterThan(0);
  });

  it("the floor-share link scrolls the slider into view below the top, with its label, and focuses it", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const target = document.createElement("input");
    target.id = "floor-share-input";
    document.body.append(target);
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      return this === target ? rect(3000, 20) : rect(0, 0);
    });
    mount();
    scrollPos = 5000;
    fireEvent.click(screen.getByRole("link", { name: /Floor share/ }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 5000 + 3000 - 72, behavior: "smooth" });
    expect(document.activeElement).toBe(target);
    target.remove();
  });

  it("keeps focusables out of the steps and the chart", () => {
    const { container } = mount();
    for (const s of steps(container)) expect(s.querySelector("a, button, input, select, textarea, [tabindex]")).toBeNull();
    const chart = container.querySelector("[data-stage] [inert]");
    expect(chart?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("#follow-your-100 a")?.getAttribute("href")).toBe("#floor-share-input");
  });

  it("cleans up: removes the listeners, cancels the pending frame, clears the CSS variables", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { container, unmount } = mount();
    scrollToY(yFor(3, 0.5));
    const section = container.querySelector<HTMLElement>("[data-rail]")!;
    expect(section.style.getPropertyValue("--q3")).not.toBe("");
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(rafQueue.size).toBe(1);
    unmount();
    expect(rafQueue.size).toBe(0);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(ios).toHaveLength(0);
    expect(section.style.getPropertyValue("--q3")).toBe("");
    window.dispatchEvent(new Event("scroll"));
    expect(rafQueue.size).toBe(0);
  });
});

/* ---------- Reduced motion ---------- */

describe("LaunchStory under prefers-reduced-motion", () => {
  beforeEach(() => {
    reduceMotion = true;
  });

  it("renders eight static frames with their captions, beat links, and no scroll listener", () => {
    const add = vi.spyOn(window, "addEventListener");
    const { container } = render(<LaunchStory m={m50} />);
    expect(container.querySelector("[data-stage]")).toBeNull();
    expect(container.querySelector("[data-step]")).toBeNull();
    const figures = [...container.querySelectorAll("figure")];
    expect(figures.map((f) => f.id)).toEqual(BEAT_KEYS.map((key) => `beat-${key}`));
    const stills = screen.getAllByTestId("chart-still");
    expect(stills.map((s) => Number(s.dataset.pos))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    BEAT_KEYS.forEach((key, i) => expect(figures[i]!.textContent).toContain(beatCaption(m50, key)));
    const links = screen.getByRole("navigation", { name: "Story steps" }).querySelectorAll("a");
    expect([...links].map((a) => [a.textContent, a.getAttribute("href")])).toEqual(BEAT_KEYS.map((key) => [BEAT_LABELS[key], `#beat-${key}`]));
    expect(screen.getByText(STORY_HONESTY)).toBeTruthy();
    expect(screen.getAllByTestId("tile-floor").map((t) => t.textContent)).toEqual(["$36.87"]);
    expect(add.mock.calls.some((c) => c[0] === "scroll")).toBe(false);
    expect(rafQueue.size).toBe(0);
  });
});

/* ---------- Focus guard ---------- */

describe("keepClearOfStage", () => {
  function setup(targetTop: number) {
    const root = document.createElement("section");
    const stage = document.createElement("div");
    stage.setAttribute("data-stage", "");
    const target = document.createElement("a");
    root.append(stage, target);
    document.body.append(root);
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      if (this === stage) return rect(0, 450);
      if (this === target) return rect(targetTop, 30);
      return rect(0, 0);
    });
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    return { root, stage, target, scrollBy };
  }

  it("scrolls a focused element out from under the sticky stage", () => {
    const { root, target, scrollBy } = setup(200);
    keepClearOfStage(root, target);
    expect(scrollBy).toHaveBeenCalledWith(0, 200 - 458);
  });

  it("leaves elements in the clear, and elements inside the stage, alone", () => {
    const { root, stage, target, scrollBy } = setup(600);
    keepClearOfStage(root, target);
    const inner = document.createElement("button");
    stage.append(inner);
    keepClearOfStage(root, inner);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
