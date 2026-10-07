import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { quantize, storyTimeAt } from "@/lib/landing/sim/scroll";
import { STAGES, storyFrame } from "@/lib/landing/sim/story";
import { formatUsdCents } from "@/lib/landing/sim/format";
import { ILLUSTRATION, stageCaption, storyFootnote } from "../lab/storyCopy";
import { StoryStateProvider, useStoryState } from "../scroll/StoryState";
import { finalProgress } from "../scroll/progress";
import { FOLLOW_ID, FollowStory, followTime } from "./FollowStory";

const k = simConstantsFromSdk();
const m50 = launchMath(k, 50);
const m60 = launchMath(k, 60);

/* ---------- Browser fakes (same shape as scroll/Chapter.test.tsx) ---------- */

let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
let reduce = false;

function flushRaf() {
  const q = rafQueue;
  rafQueue = new Map();
  act(() => q.forEach((cb) => cb(0)));
}

beforeEach(() => {
  rafQueue = new Map();
  reduce = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => rafQueue.delete(id));
  vi.stubGlobal("innerHeight", 1000); // wide layout: reading line at 500px
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({
        matches: q.includes("reduce") ? reduce : true,
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const STEP_H = 800;
const LINE = 500;

/** Put step `active` at progress `q` against the reading line; earlier steps done, later ones not started. */
function scrollTo(active: number, q: number) {
  const top0 = LINE - q * STEP_H - active * STEP_H;
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((s, i) => {
    const top = top0 + i * STEP_H;
    s.getBoundingClientRect = () => ({ top, bottom: top + STEP_H, height: STEP_H, left: 0, right: 10, width: 10, x: 0, y: top, toJSON() {} }) as DOMRect;
  });
  fireEvent.scroll(window);
  flushRaf();
}

/** Outside-the-chapter controls standing in for chapters 02 and 03. */
function Controls() {
  const { setSymbol, setShare } = useStoryState();
  return (
    <div>
      <button onClick={() => setSymbol("NVDAx")}>pick nvda</button>
      <button onClick={() => setShare(60)}>share 60</button>
    </div>
  );
}

function Harness() {
  return (
    <StoryStateProvider k={k}>
      <Controls />
      <FollowStory />
    </StoryStateProvider>
  );
}

const stage = () => document.querySelector<HTMLElement>("[data-stage]")!;
const stageT = () => Number(screen.getByTestId("follow-stage").getAttribute("data-t"));
const inStage = () => within(stage());

describe("followTime", () => {
  it("is the final frame (t = 15) when nothing is measured", () => {
    expect(followTime(finalProgress(5))).toBe(15);
  });

  it("maps the active step's progress through storyTimeAt on a 0.05 s grid", () => {
    expect(followTime({ p: 0.5, q: [1, 1, 0.5, 0, 0], active: 2 })).toBe(quantize(storyTimeAt(2, 0.5), 0.05));
    expect(followTime({ p: 0.5, q: [1, 1, 0.5, 0, 0], active: 2 })).toBeCloseTo(8.4, 9);
    expect(followTime({ p: 0, q: [0, 0, 0, 0, 0], active: 0 })).toBe(0);
    for (const [i, s] of STAGES.entries()) {
      const q = STAGES.map((_, j) => (j <= i ? 1 : 0));
      expect(followTime({ p: 0, q, active: i })).toBe(s.end);
    }
  });
});

describe("FollowStory server render", () => {
  const html = renderToString(<Harness />);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const section = doc.getElementById(FOLLOW_ID)!;

  it("is chapter 04 with five steps before an aria-hidden stage", () => {
    expect(section.getAttribute("aria-labelledby")).toBe(`${FOLLOW_ID}-title`);
    expect(doc.getElementById(`${FOLLOW_ID}-title`)?.textContent).toBe("Follow your $100");
    const steps = [...section.querySelectorAll("[data-step]")];
    expect(steps).toHaveLength(5);
    const st = section.querySelector("[data-stage]")!;
    expect(st.getAttribute("aria-hidden")).toBe("true");
    expect(steps.every((s) => s.compareDocumentPosition(st) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("server-renders the finished story: t = 15, redeem, the floor tile", () => {
    const st = section.querySelector("[data-stage]")!;
    expect(st.querySelector("[data-testid=follow-stage]")!.getAttribute("data-t")).toBe("15");
    expect(st.textContent).toContain(`${formatUsdCents(m50.floorPer100Usd)} back`);
    expect(st.querySelector("[data-testid=follow-floor]")!.textContent).toBe("$34.88");
    // One payback number at redeem: no pre-fee figure on the chart head or the paper tile.
    expect(st.querySelector("[data-testid=follow-paper]")!.textContent).toBe("Burned");
    expect(st.textContent).not.toContain(formatUsdCents(m50.floorPer100GrossUsd));
  });

  it("captions every stage in its step, with the SDK-math numbers for screen readers", () => {
    STAGES.forEach((s, i) => {
      expect(section.querySelector(`[data-testid=follow-caption-${i}]`)!.textContent).toBe(stageCaption(m50, s.key, "SPYx"));
    });
    expect(section.querySelector("[data-testid=follow-caption-4]")!.textContent).toBe("Burn tokens for your share of the floor, less 2%.");
  });

  it("keeps the stage free of focusable content and transport controls", () => {
    expect(section.querySelectorAll("button, input, a, select, [tabindex]")).toHaveLength(0);
  });

  it("labels the made-up part and never overclaims", () => {
    expect(section.textContent).toContain(ILLUSTRATION);
    expect(section.textContent).toContain(storyFootnote("SPYx"));
    expect(storyFootnote("SPYx")).toBe("Made-up trades; SPYx price held flat. Fees simplified; the rest is SDK math.");
    const labels = [...section.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label")).join(" ");
    expect(`${section.textContent} ${labels}`).not.toMatch(
      /guarantee|risk-free|can.?t lose|cannot lose|profit|\bsafe\b|protect|uncorrelated|independent/i,
    );
  });

  it("keeps every caption at 12 words or fewer", () => {
    for (const s of STAGES) expect(stageCaption(m50, s.key, "GOOGLx").split(/\s+/).length).toBeLessThanOrEqual(12);
  });
});

describe("FollowStory: scroll is the clock", () => {
  it("drives the stage from the active step's progress, and plays backwards", () => {
    render(<Harness />);
    scrollTo(2, 0.5);
    expect(stageT()).toBeCloseTo(8.4, 9);
    const f = storyFrame(m50, stageT());
    expect(f.stage).toBe("trading");
    expect(inStage().getByTestId("follow-paper").textContent).toBe(formatUsdCents(f.valueOf100));
    expect(inStage().getByTestId("follow-widget").textContent).toMatch(/^Bought \$/);
    const steps = document.querySelectorAll("[data-step]");
    expect(steps[2]!.getAttribute("data-active")).toBe("true");
    expect(steps[3]!.getAttribute("data-active")).toBe("false");

    // Back up into the presale.
    scrollTo(0, 0.3);
    expect(stageT()).toBe(quantize(storyTimeAt(0, 0.3), 0.05));
    expect(inStage().getByTestId("follow-widget").textContent).toMatch(/^Raised \$/);

    // Hold: past 0.8 of a step the stage sits on that stage's end.
    scrollTo(3, 0.9);
    expect(stageT()).toBe(STAGES[3]!.end);
    expect(inStage().getByTestId("follow-paper").textContent).toBe(formatUsdCents(storyFrame(m50, STAGES[3]!.end).valueOf100));

    scrollTo(4, 1);
    expect(stageT()).toBe(15);
    expect(inStage().getByTestId("follow-widget").textContent).toContain("back");
  });

  it("does not re-render the stage for scroll moves inside one 0.05 s slot", () => {
    render(<Harness />);
    scrollTo(2, 0.5);
    const el = screen.getByTestId("follow-stage");
    const before = el.innerHTML;
    scrollTo(2, 0.5 + 0.004); // 0.004 × 4 s / 0.75 ≈ 0.02 s: same slot
    expect(stageT()).toBeCloseTo(8.4, 9);
    expect(el.innerHTML).toBe(before);
  });
});

describe("FollowStory follows the other chapters' inputs", () => {
  it("names the picked asset in the graduation caption, the chart floor label and the footnote", () => {
    render(<Harness />);
    expect(screen.getByTestId("follow-caption-1").textContent).toBe("Raise complete: 50% locks in SPYx as the floor.");
    fireEvent.click(screen.getByText("pick nvda"));
    expect(screen.getByTestId("follow-caption-1").textContent).toBe("Raise complete: 50% locks in NVDAx as the floor.");
    expect(stage().textContent).toContain("Floor · NVDAx");
    expect(stage().textContent).toContain(storyFootnote("NVDAx"));
    expect(document.body.textContent).not.toContain("SPYx");
    // Labels only: the numbers do not change with the pick.
    expect(inStage().getByTestId("follow-floor").textContent).toBe("$34.88");
  });

  it("moves the tiles and the caption with the floor share", () => {
    render(<Harness />);
    scrollTo(2, 1);
    const paper50 = inStage().getByTestId("follow-paper").textContent;
    fireEvent.click(screen.getByText("share 60"));
    expect(inStage().getByTestId("follow-floor").textContent).toBe(formatUsdCents(m60.floorPer100Usd));
    expect(inStage().getByTestId("follow-floor").textContent).toBe("$45.06");
    expect(inStage().getByTestId("follow-paper").textContent).toBe(formatUsdCents(storyFrame(m60, STAGES[2]!.end).valueOf100));
    expect(inStage().getByTestId("follow-paper").textContent).not.toBe(paper50);
    expect(screen.getByTestId("follow-caption-1").textContent).toBe("Raise complete: 60% locks in SPYx as the floor.");
  });
});

describe("FollowStory under prefers-reduced-motion", () => {
  it("never attaches the driver and renders five stills at each stage's end", () => {
    reduce = true;
    render(<Harness />);
    scrollTo(0, 0); // ignored: no driver
    expect(document.getElementById(FOLLOW_ID)!.style.getPropertyValue("--p")).toBe("");
    expect(stageT()).toBe(15);
    const stills = [...document.querySelectorAll<HTMLElement>("[data-still]")];
    expect(stills).toHaveLength(5);
    stills.forEach((still, i) => {
      expect(within(still).getByRole("img", { name: /^Illustration:/ })).toBeTruthy();
      expect(still.querySelectorAll("button, input, a, select, [tabindex]")).toHaveLength(0);
      expect(within(still).queryByTestId("follow-paper") !== null).toBe(i === 4);
    });
    expect(within(stills[0]!).getByText(/^Raised \$10,000 of \$10,000$/)).toBeTruthy();
    expect(within(stills[1]!).getByRole("img", { name: /Floor/ })).toBeTruthy();
    expect(stills[4]!.textContent).toContain(storyFootnote("SPYx"));
    expect(within(stills[4]!).getByTestId("follow-floor").textContent).toBe("$34.88");
  });

  it("stills follow the picked asset", () => {
    reduce = true;
    render(<Harness />);
    fireEvent.click(screen.getByText("pick nvda"));
    const stills = [...document.querySelectorAll<HTMLElement>("[data-still]")];
    expect(stills[1]!.textContent).toContain("Floor · NVDAx");
    expect(stills[4]!.textContent).toContain(storyFootnote("NVDAx"));
  });
});
