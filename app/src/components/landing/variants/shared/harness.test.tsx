import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { BEAT_RUNWAY_SVH, beatCaption } from "./copy";
import { BEAT_KEYS, useActiveBeat, useJumpToBeat, usePos, useStoryFrame, useStoryReducedMotion } from "./hooks";
import { StoryHarness, StoryRoot, StoryStage, StorySteps } from "./StoryHarness";

const m = launchMath(simConstantsFromSdk(), 50);

/* ---------- Browser fakes (as in lab/story.test.tsx) ---------- */

const VH = 1000;
const LINE = VH / 2; // wide layout reading line
const STEPS_TOP = 1000;
const stepH = BEAT_KEYS.map((key) => (BEAT_RUNWAY_SVH[key] * VH) / 100);
const stepTop = (i: number) => STEPS_TOP + stepH.slice(0, i).reduce((a, b) => a + b, 0);
const yFor = (i: number, q: number) => stepTop(i) - (LINE - q * stepH[i]!);

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

const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON() {} }) as DOMRect;

function flushRaf() {
  act(() => {
    const q = rafQueue;
    rafQueue = new Map();
    q.forEach((cb) => cb(0));
  });
}

function scrollToY(y: number) {
  scrollPos = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  flushRaf();
}

function inView() {
  act(() => {
    for (const io of ios) io.cb([...io.targets].map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry), io as unknown as IntersectionObserver);
  });
  flushRaf();
}

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

/* ---------- Probes ---------- */

let renders = 0;
function Probe() {
  renders++;
  const pos = usePos(0.05);
  const frame = useStoryFrame(0.05);
  const { index, key } = useActiveBeat();
  const reduced = useStoryReducedMotion();
  const jump = useJumpToBeat();
  return (
    <div>
      <output data-testid="pos">{pos}</output>
      <output data-testid="beat">{frame.beat}</output>
      <output data-testid="active">{`${index}:${key}`}</output>
      <output data-testid="reduced">{String(reduced)}</output>
      <button onClick={() => jump(4)}>jump</button>
    </div>
  );
}

function Custom() {
  return (
    <StoryRoot m={m}>
      <StoryStage>
        <Probe />
      </StoryStage>
      <StorySteps />
    </StoryRoot>
  );
}

const pos = () => Number(screen.getByTestId("pos").textContent);

describe("story harness", () => {
  it("shows the finished frame before the driver measures", () => {
    render(<Custom />);
    expect(pos()).toBe(8);
    expect(screen.getByTestId("beat").textContent).toBe("redeem");
  });

  it("maps scroll to pos and reverses exactly", () => {
    render(<Custom />);
    inView();
    scrollToY(0);
    expect(pos()).toBe(0);
    scrollToY(yFor(2, 0.4)); // beat 2 (pump), (0.4 - 0.05) / 0.7 = 0.5
    expect(pos()).toBeCloseTo(2.5, 9);
    expect(screen.getByTestId("beat").textContent).toBe("pump");
    expect(screen.getByTestId("active").textContent).toBe("2:pump");
    scrollToY(yFor(5, 0.95)); // past the window: bounce finished
    expect(pos()).toBe(6);
    scrollToY(yFor(2, 0.4));
    expect(pos()).toBeCloseTo(2.5, 9);
    scrollToY(0);
    expect(pos()).toBe(0);
  });

  it("re-renders only when the quantised pos changes", () => {
    render(<Custom />);
    inView();
    scrollToY(yFor(3, 0.3));
    const before = renders;
    scrollToY(yFor(3, 0.3) + 1); // well under one 0.05 grid cell
    expect(renders).toBe(before);
  });

  it("uses one passive scroll listener and removes it on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Custom />);
    inView();
    const scrolls = add.mock.calls.filter(([t]) => t === "scroll");
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0]![2]).toMatchObject({ passive: true });
    expect(add.mock.calls.some(([t]) => t === "wheel" || t === "touchmove")).toBe(false);
    unmount();
    expect(remove.mock.calls.some(([t]) => t === "scroll")).toBe(true);
    expect(ios).toHaveLength(0);
  });

  it("jumpToBeat scrolls natively to the beat's finished frame", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<Custom />);
    inView();
    act(() => screen.getByText("jump").click());
    expect(scrollTo).toHaveBeenCalledWith({ top: yFor(4, 0.85), behavior: "smooth" });
  });

  it("StoryHarness renders one step per beat with its caption and a function stage", () => {
    const stage = vi.fn((f: ReturnType<typeof storyFrame>) => <p data-testid="stage">{f.beat}</p>);
    const { container } = render(<StoryHarness m={m} stage={stage} heights={{ pump: 120 }} />);
    const steps = container.querySelectorAll<HTMLElement>("[data-step]");
    expect(steps).toHaveLength(8);
    expect(steps[2]!.style.getPropertyValue("--runway")).toBe("120svh");
    expect(steps[0]!.style.getPropertyValue("--runway")).toBe(`${BEAT_RUNWAY_SVH.presale}svh`);
    for (const key of BEAT_KEYS) expect(screen.getAllByText(beatCaption(m, key)).length).toBeGreaterThan(0);
    expect(container.querySelector("[data-stage]")).toBeTruthy();
    inView();
    scrollToY(yFor(1, 0.4));
    expect(screen.getByTestId("stage").textContent).toBe("split");
  });

  it("overlay layout does not mark the stage as stacked", () => {
    const { container } = render(<StoryHarness m={m} layout="overlay" stage={() => null} />);
    expect(container.querySelector("[data-stage]")).toBeNull();
    expect(container.querySelector("[data-variant-stage]")).toBeTruthy();
  });

  it("reduced motion: no listener, no track, one still per beat", () => {
    reduceMotion = true;
    const add = vi.spyOn(window, "addEventListener");
    const still = vi.fn(() => <span>still</span>);
    render(<StoryHarness m={m} stage={() => <span>stage</span>} still={still} />);
    expect(add.mock.calls.some(([t]) => t === "scroll")).toBe(false);
    expect(screen.queryByTestId("story-track")).toBeNull();
    expect(screen.getByTestId("story-stills")).toBeTruthy();
    expect(screen.getAllByText("still")).toHaveLength(8);
    const frames = still.mock.calls.map((c) => (c as unknown as [ReturnType<typeof storyFrame>])[0].pos);
    expect(frames.slice(-8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
