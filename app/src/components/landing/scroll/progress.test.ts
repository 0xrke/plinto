import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalProgress, getProgress, observeChapter, readingLine, subscribe } from "./progress";

/* ---------- Browser fakes: requestAnimationFrame, IntersectionObserver, rects ---------- */

let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
let ios: FakeIO[] = [];

class FakeIO {
  targets = new Set<Element>();
  constructor(
    public cb: IntersectionObserverCallback,
    public opts?: IntersectionObserverInit,
  ) {
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
  fire(el: Element, isIntersecting: boolean) {
    this.cb([{ target: el, isIntersecting } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function flushRaf() {
  const q = rafQueue;
  rafQueue = new Map();
  q.forEach((cb) => cb(0));
}

/** A chapter root with `n` steps, each `h` px tall, stacked from `top` (viewport px). */
function makeChapter(n: number, h = 500) {
  const root = document.createElement("section");
  const steps: HTMLElement[] = [];
  let top = 0;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("div");
    s.dataset.step = String(i);
    const idx = i;
    s.getBoundingClientRect = vi.fn(() => {
      const t = top + idx * h;
      return { top: t, bottom: t + h, height: h, left: 0, right: 100, width: 100, x: 0, y: t, toJSON() {} } as DOMRect;
    });
    root.append(s);
    steps.push(s);
  }
  const stage = document.createElement("div");
  stage.dataset.stage = "";
  root.append(stage);
  document.body.append(root);
  return {
    root,
    steps,
    /** Scroll so the first step's top sits at `y` (viewport px). */
    at(y: number) {
      top = y;
    },
  };
}

const VH = 1000; // reading line on the wide layout: 500

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  ios = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => rafQueue.delete(id));
  vi.stubGlobal("innerHeight", VH);
  vi.stubGlobal("IntersectionObserver", FakeIO);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("finalProgress", () => {
  it("puts every step at 1 with the last one active", () => {
    expect(finalProgress(3)).toEqual({ q: [1, 1, 1], active: 2 });
    expect(finalProgress(0).q).toHaveLength(1);
  });
});

describe("observeChapter", () => {
  it("measures live chapters, writes --qN and data-active, and notifies subscribers", () => {
    const c = makeChapter(3);
    const cb = vi.fn();
    const unsub = subscribe(c.root, cb);
    const stop = observeChapter(c.root);
    ios[0]!.fire(c.root, true);
    c.at(500 - 250); // step 0 half past the reading line, step 1 below it
    flushRaf();

    const s = getProgress(c.root);
    expect(s.q[0]).toBeCloseTo(0.5);
    expect(s.q[1]).toBe(0);
    expect(s.active).toBe(0);
    expect(c.root.style.getPropertyValue("--q0")).toBe("0.5");
    expect(c.root.style.getPropertyValue("--q2")).toBe("0");
    expect(c.root.dataset.active).toBe("0");
    expect(c.steps.map((x) => x.dataset.active)).toEqual(["true", "false", "false"]);
    expect(cb).toHaveBeenCalledTimes(1);

    // Scroll on: step 1 a fifth in.
    c.at(500 - 600);
    window.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(getProgress(c.root).active).toBe(1);
    expect(getProgress(c.root).q[0]).toBe(1);
    expect(getProgress(c.root).q[1]).toBeCloseTo(0.2);
    expect(c.steps.map((x) => x.dataset.active)).toEqual(["false", "true", "false"]);
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    stop();
  });

  it("coalesces many scroll events into one measurement per animation frame", () => {
    const c = makeChapter(2);
    const stop = observeChapter(c.root);
    ios[0]!.fire(c.root, true);
    flushRaf();
    const reads = vi.mocked(c.steps[0]!.getBoundingClientRect);
    reads.mockClear();

    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event("scroll"));
    expect(rafQueue.size).toBe(1);
    flushRaf();
    expect(reads).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not write or notify when nothing moved by more than 0.001", () => {
    const c = makeChapter(2, 10000);
    const cb = vi.fn();
    subscribe(c.root, cb);
    const stop = observeChapter(c.root);
    ios[0]!.fire(c.root, true);
    c.at(0);
    flushRaf();
    const before = getProgress(c.root);
    cb.mockClear();
    c.at(-5); // 5px of a 10000px step: 0.0005
    window.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(getProgress(c.root)).toBe(before);
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it("skips chapters that are not live and more than a viewport away", () => {
    const c = makeChapter(2);
    let rootTop = 5 * VH;
    c.root.getBoundingClientRect = () => ({ top: rootTop, bottom: rootTop + 1000, height: 1000, left: 0, right: 100, width: 100, x: 0, y: rootTop, toJSON() {} }) as DOMRect;
    const stop = observeChapter(c.root);
    expect(ios[0]!.opts?.rootMargin).toBe("100% 0px");
    ios[0]!.fire(c.root, false);
    flushRaf();
    expect(c.steps[0]!.getBoundingClientRect).not.toHaveBeenCalled();
    expect(c.root.style.getPropertyValue("--q0")).toBe("");

    // A jump lands on the chapter before the observer reports it: measured in that same frame.
    rootTop = -200;
    c.at(-250);
    window.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(getProgress(c.root).q).toEqual([1, 0.5]);
    stop();
  });

  it("writes --qN on the rail when there is one, and only the variables that changed", () => {
    const c = makeChapter(3);
    const rail = document.createElement("nav");
    rail.dataset.rail = "";
    c.root.append(rail);
    const stop = observeChapter(c.root);
    ios[0]!.fire(c.root, true);
    c.at(250); // step 0 at q = 0.5
    flushRaf();
    expect(rail.style.getPropertyValue("--q0")).toBe("0.5");
    expect(c.root.style.getPropertyValue("--q0")).toBe("");
    const set = vi.spyOn(rail.style, "setProperty");
    c.steps[1]!.dataset.active = "untouched"; // the driver only rewrites steps when the active one changes
    c.at(200); // q0 = 0.6; q1, q2 stay 0; the active step stays 0
    window.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(set.mock.calls.map((x) => x[0])).toEqual(["--q0"]);
    expect(c.steps[1]!.dataset.active).toBe("untouched");
    expect(c.steps[0]!.dataset.active).toBe("true");
    stop();
    expect(rail.style.getPropertyValue("--q0")).toBe("");
  });

  it("uses passive listeners and never listens to wheel or touch", () => {
    const add = vi.spyOn(window, "addEventListener");
    const c = makeChapter(1);
    const stop = observeChapter(c.root);
    const types = add.mock.calls.map((x) => x[0]);
    expect(types).toEqual(expect.arrayContaining(["scroll", "resize"]));
    expect(types.some((t) => /wheel|touch/.test(String(t)))).toBe(false);
    for (const call of add.mock.calls) expect(call[2]).toMatchObject({ passive: true });
    stop();
  });

  it("cleans up: clears writes, resets to the final frame, removes listeners after the last chapter", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const a = makeChapter(2);
    const b = makeChapter(3);
    const stopA = observeChapter(a.root);
    const stopB = observeChapter(b.root);
    expect(ios).toHaveLength(1); // one observer for the page
    ios[0]!.fire(a.root, true);
    ios[0]!.fire(b.root, true);
    a.at(400);
    b.at(400);
    flushRaf();
    expect(a.root.style.getPropertyValue("--q1")).toBe("0");
    const cb = vi.fn();
    subscribe(a.root, cb);

    stopA();
    expect(a.root.style.getPropertyValue("--q0")).toBe("");
    expect(a.root.style.getPropertyValue("--q1")).toBe("");
    expect(a.root.dataset.active).toBeUndefined();
    expect(a.steps.every((s) => s.dataset.active === undefined)).toBe(true);
    expect(getProgress(a.root)).toEqual(finalProgress(2));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalledWith("scroll", expect.anything());

    // A pending frame is cancelled with the last chapter.
    window.dispatchEvent(new Event("scroll"));
    expect(rafQueue.size).toBe(1);
    stopB();
    expect(rafQueue.size).toBe(0);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(ios).toHaveLength(0);

    // Later scrolls do nothing.
    window.dispatchEvent(new Event("scroll"));
    expect(rafQueue.size).toBe(0);
  });

  it("measures everything as live without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const c = makeChapter(2);
    const stop = observeChapter(c.root);
    c.at(0);
    flushRaf();
    expect(getProgress(c.root).q[0]).toBeCloseTo(1);
    stop();
  });

  it("uses the narrow reading line below the sticky stage", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }) as MediaQueryList);
    const c = makeChapter(1, 1000);
    const stage = c.root.querySelector<HTMLElement>("[data-stage]")!;
    Object.defineProperty(stage, "offsetHeight", { value: 500 });
    const stop = observeChapter(c.root);
    ios[0]!.fire(c.root, true);
    // line = 500 + 0.4 × (1000 − 500) = 700
    c.at(700);
    flushRaf();
    expect(getProgress(c.root).q[0]).toBe(0);
    c.at(200);
    window.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(getProgress(c.root).q[0]).toBeCloseTo(0.5);
    stop();
  });

  it("returns a stable final frame for roots it does not observe", () => {
    const c = makeChapter(4);
    const a = getProgress(c.root);
    expect(a).toBe(getProgress(c.root));
    expect(a).toEqual(finalProgress(4));
  });
});

describe("readingLine", () => {
  it("is mid-screen on wide layouts and 40% down the space under the stage on phones", () => {
    const c = makeChapter(1);
    const stage = c.root.querySelector<HTMLElement>("[data-stage]")!;
    Object.defineProperty(stage, "offsetHeight", { value: 500 });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q }) as MediaQueryList);
    expect(readingLine(c.root)).toBe(500);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }) as MediaQueryList);
    expect(readingLine(c.root)).toBe(700);
  });

  it("matches the line the driver measures against", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }) as MediaQueryList);
    const c = makeChapter(1, 1000);
    const stage = c.root.querySelector<HTMLElement>("[data-stage]")!;
    Object.defineProperty(stage, "offsetHeight", { value: 400 });
    const stop = observeChapter(c.root);
    ios[0]!.fire(c.root, true);
    c.at(readingLine(c.root) - 250); // a quarter of the step past the line
    flushRaf();
    expect(getProgress(c.root).q[0]).toBeCloseTo(0.25);
    stop();
  });
});
