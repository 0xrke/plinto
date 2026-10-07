import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { STAGES, STORY_END, storyFrame } from "@/lib/landing/sim/story";
import { formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";
import { LaunchStory } from "./LaunchStory";
import { AUTOPLAY_DELAY_MS, REDUCED_HOLD_MS } from "./storyHooks";
import { ILLUSTRATION, STORY_FOOTNOTE, STORY_TITLE, scrubberValueText, stageCaption, storyChartLabel } from "./storyCopy";

const k = simConstantsFromSdk();
const m50 = launchMath(k, 50);
const m60 = launchMath(k, 60);

/* ---------- Browser fakes: IntersectionObserver, matchMedia, requestAnimationFrame ---------- */

let observers: Array<{ cb: IntersectionObserverCallback; el: Element | null }> = [];
let reduceMotion = false;
let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
let now = 0;

class FakeIO {
  private rec: { cb: IntersectionObserverCallback; el: Element | null };
  constructor(cb: IntersectionObserverCallback) {
    this.rec = { cb, el: null };
    observers.push(this.rec);
  }
  observe(el: Element) {
    this.rec.el = el;
  }
  disconnect() {
    observers = observers.filter((o) => o !== this.rec);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

/** Card and viewport heights the fake observer reports (a phone: the card is most of a screen). */
const CARD_H = 750;
const VIEWPORT_H = 800;

/** Report the story card as in view (ratio 0.6 by default), partly in view (`ratio`) or out of view. */
function setInView(visible: boolean, ratio = 0.6) {
  const r = visible ? ratio : 0;
  act(() => {
    for (const o of observers) {
      o.cb(
        [
          {
            isIntersecting: visible,
            intersectionRatio: r,
            intersectionRect: { height: r * CARD_H },
            rootBounds: { height: VIEWPORT_H },
            target: o.el,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    }
  });
}

/** Run `n` animation frames of `ms` each. */
function frames(n: number, ms = 50) {
  for (let i = 0; i < n; i++) {
    act(() => {
      now += ms;
      const due = [...rafQueue.values()];
      rafQueue = new Map();
      for (const cb of due) cb(now);
    });
  }
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  observers = [];
  reduceMotion = false;
  rafQueue = new Map();
  now = 0;
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduceMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

/** Fake only the timers; requestAnimationFrame stays on the manual queue above. */
const useTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

const caption = () => screen.getByTestId("story-caption").textContent;
const paper = () => screen.getByTestId("story-paper").textContent;
const floor = () => screen.getByTestId("story-floor").textContent;
const live = () => screen.getByTestId("story-live").textContent;
const scrubber = () => screen.getByLabelText("Story time") as HTMLInputElement;
const playButton = () => screen.getByRole("button", { name: /^(Play|Pause|Replay)$/ });
const stageButton = (label: string) => screen.getByRole("button", { name: label });

/** Mount with the card out of view, so the clock rewinds to 0 and arms autoplay. */
function mountOffscreen(m = m50) {
  const r = render(<LaunchStory m={m} />);
  setInView(false);
  return r;
}

describe("LaunchStory server render", () => {
  it("renders the finished frame: redeem caption, the worst-case bar and the chart label", () => {
    const html = renderToString(<LaunchStory m={m50} />);
    expect(html).toContain(STORY_TITLE);
    expect(html).toContain(stageCaption(m50, "redeem"));
    expect(html).toContain("$34.88 back");
    expect(html).toContain("$65.12 lost");
    expect(html).toContain(STORY_FOOTNOTE);
    expect(html).toContain(storyChartLabel(m50));
    expect(storyChartLabel(m50)).toBe(
      "Illustration: your $100 rises to $400 on paper, then falls to the floor, which pays back $34.88.",
    );
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/button>).)*Redeem/);
    expect(html).toContain('aria-label="Replay"');
    expect(html).toContain('href="#floor-share"');
  });
});

describe("LaunchStory stepping and scrubbing", () => {
  it("shows each stage's caption and the engine's numbers from the stepper", () => {
    render(<LaunchStory m={m50} />);
    const expected: Record<string, { paper: string; extra?: string }> = {
      Presale: { paper: "$100.00", extra: "Raised $10,000 of $10,000" },
      Graduation: { paper: "$100.00", extra: "Floor $5,000" },
      Trading: { paper: "$400.00", extra: "Bought $4,000" },
      Selloff: { paper: "$35.59", extra: "Sold $5,614" },
      Redeem: { paper: "$35.59", extra: "$65.12 lost" },
    };
    for (const s of STAGES) {
      fireEvent.click(stageButton(s.label));
      expect(caption()).toBe(stageCaption(m50, s.key));
      expect(stageButton(s.label).getAttribute("aria-current")).toBe("step");
      for (const other of STAGES.filter((o) => o.key !== s.key)) expect(stageButton(other.label).getAttribute("aria-current")).toBeNull();
      expect(paper()).toBe(expected[s.label]!.paper);
      expect(paper()).toBe(formatUsdCents(storyFrame(m50, s.end).valueOf100));
      expect(floor()).toBe("$34.88");
      expect(document.body.textContent).toContain(expected[s.label]!.extra);
    }
    expect(caption()).toBe("Burn your tokens for your share of the floor, less a 2% fee.");
  });

  it("puts the floor share into the graduation caption and follows the floor share", () => {
    const { rerender } = render(<LaunchStory m={m50} />);
    fireEvent.click(stageButton("Graduation"));
    expect(caption()).toBe("Raise complete: 50% locks in SPYx as the floor.");
    rerender(<LaunchStory m={m60} />);
    expect(caption()).toBe("Raise complete: 60% locks in SPYx as the floor.");
    expect(floor()).toBe("$45.06");
    fireEvent.click(stageButton("Trading"));
    expect(paper()).toBe("$544.44");
    expect(screen.getByRole("img", { name: /^Illustration:/ }).getAttribute("aria-label")).toContain("$544");
  });

  it("scrubs to any time with a matching aria-valuetext", () => {
    render(<LaunchStory m={m50} />);
    fireEvent.change(scrubber(), { target: { value: "80" } });
    const f = storyFrame(m50, 8);
    expect(caption()).toBe(stageCaption(m50, "trading"));
    expect(paper()).toBe(formatUsdCents(f.valueOf100));
    expect(scrubber().getAttribute("aria-valuetext")).toBe(scrubberValueText(m50, f));
    expect(scrubber().getAttribute("aria-valuetext")).toBe(
      `Stage 3 of 5, Trading: your $100 is ${formatUsdCents(f.valueOf100)} on paper (illustration).`,
    );
    fireEvent.change(scrubber(), { target: { value: "130" } });
    expect(scrubber().getAttribute("aria-valuetext")).toBe("Stage 4 of 5, Selloff: your $100 is $35.59 on paper (illustration).");
    fireEvent.change(scrubber(), { target: { value: "150" } });
    expect(scrubber().getAttribute("aria-valuetext")).toBe("Stage 5 of 5, Redeem: the floor pays back $34.88.");
  });

  it("PageUp and PageDown on the scrubber jump a stage", () => {
    render(<LaunchStory m={m50} />);
    fireEvent.change(scrubber(), { target: { value: "20" } });
    expect(caption()).toBe(stageCaption(m50, "presale"));
    fireEvent.keyDown(scrubber(), { key: "PageUp" });
    expect(caption()).toBe(stageCaption(m50, "graduation"));
    expect(scrubber().value).toBe("60");
    fireEvent.keyDown(scrubber(), { key: "PageUp" });
    expect(caption()).toBe(stageCaption(m50, "trading"));
    fireEvent.keyDown(scrubber(), { key: "PageDown" });
    expect(caption()).toBe(stageCaption(m50, "graduation"));
  });

  it("Back and Next jump between stage ends and are aria-disabled (still focusable) at the edges", () => {
    render(<LaunchStory m={m50} />);
    const back = screen.getByRole("button", { name: "Previous stage" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next stage" }) as HTMLButtonElement;
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(caption()).toBe(stageCaption(m50, "redeem"));
    fireEvent.click(back);
    expect(caption()).toBe(stageCaption(m50, "selloff"));
    fireEvent.click(back);
    fireEvent.click(back);
    back.focus();
    fireEvent.click(back);
    expect(caption()).toBe(stageCaption(m50, "presale"));
    expect(back.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(caption()).toBe(stageCaption(m50, "presale"));
    fireEvent.click(next);
    expect(caption()).toBe(stageCaption(m50, "graduation"));
    expect(next.getAttribute("aria-disabled")).toBeNull();
  });

  it("orders the transport Back, Play, Next, scrubber in the DOM (the visual order at every width)", () => {
    render(<LaunchStory m={m50} />);
    const order = [
      screen.getByRole("button", { name: "Previous stage" }),
      playButton(),
      screen.getByRole("button", { name: "Next stage" }),
      scrubber(),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("announces stage changes from the stage buttons only, not from the scrubber", () => {
    render(<LaunchStory m={m50} />);
    expect(live()).toBe("");
    fireEvent.click(stageButton("Trading"));
    expect(live()).toBe(`Trading. ${stageCaption(m50, "trading")}`);
    // The focused scrubber speaks its own aria-valuetext; the caption region stays put.
    fireEvent.change(scrubber(), { target: { value: "20" } });
    fireEvent.keyDown(scrubber(), { key: "PageUp" });
    expect(caption()).toBe(stageCaption(m50, "graduation"));
    expect(live()).toBe(`Trading. ${stageCaption(m50, "trading")}`);
    fireEvent.click(screen.getByRole("button", { name: "Next stage" }));
    expect(live()).toBe(`Trading. ${stageCaption(m50, "trading")}`); // same text: graduation → trading
    fireEvent.click(screen.getByRole("button", { name: "Next stage" }));
    expect(live()).toBe(`Selloff. ${stageCaption(m50, "selloff")}`);
  });

  it("labels the made-up path as an illustration", () => {
    render(<LaunchStory m={m50} />);
    expect(screen.getAllByText(ILLUSTRATION).length).toBeGreaterThan(0);
    fireEvent.click(stageButton("Selloff"));
    expect(document.body.textContent).toContain(ILLUSTRATION);
    expect(screen.getByText(STORY_FOOTNOTE)).toBeTruthy();
  });

  it("gives every button an accessible name", () => {
    render(<LaunchStory m={m50} />);
    for (const b of screen.getAllByRole("button")) expect(b.getAttribute("aria-label") ?? b.textContent?.trim()).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(STAGES.length + 3);
  });

  it("never claims more than the floor does", () => {
    const { container } = render(<LaunchStory m={m50} />);
    const labels = [...container.querySelectorAll("[aria-label],[aria-valuetext]")].map(
      (el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("aria-valuetext") ?? ""}`,
    );
    const copy = [container.textContent, ...labels, ...STAGES.map((s) => stageCaption(m50, s.key)), storyChartLabel(m50)].join(" ");
    expect(copy).not.toMatch(/guarantee|risk-free|can.t lose|profit|\bsafe\b|protect/i);
  });
});

describe("LaunchStory playback", () => {
  it("stays on the finished frame when the card is already in view at mount", () => {
    useTimers();
    render(<LaunchStory m={m50} />);
    setInView(true);
    act(() => vi.advanceTimersByTime(AUTOPLAY_DELAY_MS * 3));
    expect(caption()).toBe(stageCaption(m50, "redeem"));
    expect(playButton().getAttribute("aria-label")).toBe("Replay");
  });

  it("rewinds off-screen, autoplays once in view and advances on animation frames", () => {
    useTimers();
    mountOffscreen();
    expect(caption()).toBe(stageCaption(m50, "presale"));
    expect(scrubber().value).toBe("0");
    setInView(true);
    act(() => vi.advanceTimersByTime(AUTOPLAY_DELAY_MS - 1));
    expect(playButton().getAttribute("aria-label")).toBe("Play");
    act(() => vi.advanceTimersByTime(1));
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
    frames(1 + 40); // 2 s
    expect(Number(scrubber().value)).toBe(20);
    frames(40); // 4 s: graduation
    expect(caption()).toBe(stageCaption(m50, "graduation"));
    expect(live()).toBe("");
    frames(250); // well past the end
    expect(caption()).toBe(stageCaption(m50, "redeem"));
    expect(scrubber().value).toBe(String(STORY_END * 10));
    expect(playButton().getAttribute("aria-label")).toBe("Replay");
    expect(live()).toBe("");
    expect(rafQueue.size).toBe(0);
  });

  it("pauses off-screen and on a hidden tab, and resumes on return", () => {
    useTimers();
    mountOffscreen();
    setInView(true);
    act(() => vi.advanceTimersByTime(AUTOPLAY_DELAY_MS));
    frames(21);
    expect(scrubber().value).toBe("10");
    setInView(false);
    expect(rafQueue.size).toBe(0);
    frames(20);
    expect(scrubber().value).toBe("10");
    setInView(true);
    frames(21);
    expect(scrubber().value).toBe("20");
    setHidden(true);
    expect(rafQueue.size).toBe(0);
    setHidden(false);
    frames(21);
    expect(scrubber().value).toBe("30");
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
  });

  it("a manual control cancels autoplay for good", () => {
    useTimers();
    mountOffscreen();
    fireEvent.click(stageButton("Graduation"));
    setInView(true);
    act(() => vi.advanceTimersByTime(AUTOPLAY_DELAY_MS * 3));
    expect(playButton().getAttribute("aria-label")).toBe("Play");
    expect(caption()).toBe(stageCaption(m50, "graduation"));
  });

  it("Play continues, Pause stops, Replay rewinds to 0", () => {
    render(<LaunchStory m={m50} />);
    setInView(true);
    fireEvent.click(stageButton("Presale"));
    fireEvent.click(playButton());
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
    frames(11);
    expect(scrubber().value).toBe("40");
    fireEvent.click(playButton());
    frames(10);
    expect(scrubber().value).toBe("40");
    fireEvent.click(stageButton("Redeem"));
    fireEvent.click(playButton());
    expect(scrubber().value).toBe("0");
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
  });

  it("an explicit Play runs while only part of the card is in view (landscape phone, 200% zoom)", () => {
    useTimers();
    mountOffscreen();
    setInView(true, 0.3);
    act(() => vi.advanceTimersByTime(AUTOPLAY_DELAY_MS * 3));
    // Autoplay still waits for half the card (or half the viewport) ...
    expect(playButton().getAttribute("aria-label")).toBe("Play");
    expect(scrubber().value).toBe("0");
    // ... but the user's Play does not.
    fireEvent.click(playButton());
    frames(21);
    expect(scrubber().value).toBe("10");
    setInView(false);
    frames(20);
    expect(scrubber().value).toBe("10");
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
  });

  it("autoplays a card taller than twice the viewport once it fills half the screen", () => {
    useTimers();
    mountOffscreen();
    act(() => {
      for (const o of observers) {
        o.cb(
          [
            {
              isIntersecting: true,
              intersectionRatio: 0.4,
              intersectionRect: { height: 500 },
              rootBounds: { height: 600 },
              target: o.el,
            } as unknown as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
      }
    });
    act(() => vi.advanceTimersByTime(AUTOPLAY_DELAY_MS));
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
  });

  it("cleans up its animation frame and observer on unmount", () => {
    const { unmount } = render(<LaunchStory m={m50} />);
    setInView(true);
    fireEvent.click(playButton());
    frames(2);
    expect(rafQueue.size).toBe(1);
    unmount();
    expect(rafQueue.size).toBe(0);
    expect(observers).toHaveLength(0);
  });
});

describe("LaunchStory under prefers-reduced-motion", () => {
  beforeEach(() => {
    reduceMotion = true;
  });

  it("never autoplays and stays on the finished frame", () => {
    useTimers();
    mountOffscreen();
    setInView(true);
    act(() => vi.advanceTimersByTime(10_000));
    expect(caption()).toBe(stageCaption(m50, "redeem"));
    expect(playButton().getAttribute("aria-label")).toBe("Replay");
    expect(rafQueue.size).toBe(0);
  });

  it("Play steps through whole stages, holding each, with no animation frames", () => {
    useTimers();
    render(<LaunchStory m={m50} />);
    setInView(true);
    fireEvent.click(playButton());
    expect(caption()).toBe(stageCaption(m50, "presale"));
    expect(scrubber().value).toBe("35");
    expect(within(screen.getByTestId("story-paper")).getByText("$100.00")).toBeTruthy();
    act(() => vi.advanceTimersByTime(REDUCED_HOLD_MS - 1));
    expect(caption()).toBe(stageCaption(m50, "presale"));
    act(() => vi.advanceTimersByTime(1));
    expect(caption()).toBe(stageCaption(m50, "graduation"));
    expect(scrubber().value).toBe("60");
    act(() => vi.advanceTimersByTime(REDUCED_HOLD_MS));
    expect(caption()).toBe(stageCaption(m50, "trading"));
    expect(paper()).toBe("$400.00");
    expect(rafQueue.size).toBe(0);
    act(() => vi.advanceTimersByTime(REDUCED_HOLD_MS));
    expect(caption()).toBe(stageCaption(m50, "selloff"));
    act(() => vi.advanceTimersByTime(REDUCED_HOLD_MS));
    expect(caption()).toBe(stageCaption(m50, "redeem"));
    expect(playButton().getAttribute("aria-label")).toBe("Replay");
    expect(live()).toBe("");
  });

  it("keeps the stepper and scrubber usable", () => {
    render(<LaunchStory m={m50} />);
    setInView(true);
    fireEvent.click(stageButton("Trading"));
    expect(caption()).toBe(stageCaption(m50, "trading"));
    fireEvent.change(scrubber(), { target: { value: "20" } });
    expect(caption()).toBe(stageCaption(m50, "presale"));
  });
});
