import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { Profiler, type ReactNode } from "react";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { StoryStateProvider } from "../scroll/StoryState";
import { GET_STARTED_ID, RULES_ID } from "../scroll/anchors";
import { Hero } from "../Hero";
import { ClosingCta } from "../ClosingCta";
import { HowItWorks } from "./HowItWorks";
import { WhyStocks } from "./WhyStocks";
import { HOW_LABELS, HOW_STEPS } from "./howItWorks.copy";

const k = simConstantsFromSdk();
const OVERCLAIM = /guarantee|risk-free|can.?t lose|cannot lose|profit|\bsafe\b|protected|uncorrelated|independent/i;

/* ---------- Browser fakes (as in scroll/Chapter.test.tsx) ---------- */

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
  vi.stubGlobal("innerHeight", 1000);
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

/** Give each step of `section` a 500px rect, stacked from `top`. */
function placeSteps(section: Element, top: number) {
  section.querySelectorAll<HTMLElement>("[data-step]").forEach((s, i) => {
    s.getBoundingClientRect = () =>
      ({ top: top + i * 500, bottom: top + i * 500 + 500, height: 500, left: 0, right: 10, width: 10, x: 0, y: 0, toJSON() {} }) as DOMRect;
  });
}

const withState = (node: ReactNode) => <StoryStateProvider k={k}>{node}</StoryStateProvider>;

describe("Hero and closing CTA", () => {
  it("hero: new sub line and a visible skip link to the Rules section (never past the risk box)", () => {
    render(<Hero />);
    expect(screen.getByText("Part of every raise locks in a tokenized stock.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip the story" }).getAttribute("href")).toBe(`#${RULES_ID}`);
    expect(screen.getByText("The floor protects from zero, not from loss.")).toBeTruthy();
  });

  it("closing CTA keeps its anchor, and its heading can take focus", () => {
    render(<ClosingCta />);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.closest("section")!.id).toBe(GET_STARTED_ID);
    expect(h2.getAttribute("tabindex")).toBe("-1");
  });
});

describe("01 How it works (server render)", () => {
  const html = renderToString(withState(<HowItWorks />));
  const doc = new DOMParser().parseFromString(html, "text/html");
  const section = doc.querySelector("section")!;
  const stage = section.querySelector("[data-stage]")!;

  it("is the how-it-works anchor with three steps in order, before the stage", () => {
    expect(section.id).toBe("how-it-works");
    expect([...section.querySelectorAll("[data-step] > :first-child > p")].map((p) => p.textContent)).toEqual([...HOW_STEPS]);
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    expect(stage.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("stage: labels only, no numbers, the floor named after the default asset", () => {
    const text = stage.textContent!;
    for (const l of [HOW_LABELS.raise, HOW_LABELS.floor("SPYx"), HOW_LABELS.market, HOW_LABELS.redeem]) expect(text).toContain(l);
    expect(text).not.toMatch(/\d|\$|%/);
  });

  it("stage is driven by the chapter's CSS variables, final frame by default", () => {
    const style = (part: string) => stage.querySelector(`[data-part="${part}"]`)!.getAttribute("style") ?? "";
    expect(style("raise")).toContain("scaleX(var(--q0, 1))");
    expect(style("split-floor")).toContain("var(--q1, 1) - 0");
    expect(style("split-fees")).toContain("var(--q1, 1) - 0.2");
    expect(style("vault")).toContain("var(--q1, 1)");
    expect(style("redeem-arrow")).toContain("var(--q2, 1)");
    expect(style("token")).toContain("(var(--q2, 1) - 0.4) / 0.4");
  });

  it("split widths come from the default share's math (50 / 40 / 10)", () => {
    const basis = (key: string) => stage.querySelector(`[data-part="split-${key}"]`)!.getAttribute("style")!.match(/flex-basis:\s*([\d.]+)%/)![1];
    expect(Number(basis("floor"))).toBeCloseTo(50);
    expect(Number(basis("market"))).toBeCloseTo(40);
    expect(Number(basis("fees"))).toBeCloseTo(10);
  });

  it("one still, on the last step, pinned to the final frame", () => {
    const stills = section.querySelectorAll("[data-still]");
    expect([...stills].map((s) => s.getAttribute("data-still"))).toEqual(["2"]);
    expect(stills[0]!.innerHTML).toContain("--q2:1");
  });

  it("copy: short steps, no overclaims", () => {
    for (const s of HOW_STEPS) expect(s.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(section.textContent).not.toMatch(OVERCLAIM);
  });
});

describe("01 How it works in the browser", () => {
  it("scroll writes progress to CSS variables and never re-renders the chapter", () => {
    let commits = 0;
    render(
      <Profiler id="how" onRender={() => commits++}>
        {withState(<HowItWorks />)}
      </Profiler>,
    );
    flushRaf();
    const section = document.getElementById("how-it-works")!;
    const before = commits;

    placeSteps(section, 500 - 250); // step 0 half past the reading line
    fireEvent.scroll(window);
    flushRaf();
    expect(section.style.getPropertyValue("--q0")).toBe("0.5");
    expect(section.style.getPropertyValue("--q1")).toBe("0");
    expect(section.querySelector('[data-step="0"]')!.getAttribute("data-active")).toBe("true");
    expect(section.querySelector('[data-step="1"]')!.getAttribute("data-active")).toBe("false");

    placeSteps(section, 500 - 1250); // step 2 half in
    fireEvent.scroll(window);
    flushRaf();
    expect(section.style.getPropertyValue("--q1")).toBe("1");
    expect(section.style.getPropertyValue("--q2")).toBe("0.5");
    expect(section.querySelector('[data-step="2"]')!.getAttribute("data-active")).toBe("true");
    expect(commits).toBe(before);
  });

  it("reduced motion: no driver, final frame, still rendered", () => {
    reduce = true;
    render(withState(<HowItWorks />));
    const section = document.getElementById("how-it-works")!;
    placeSteps(section, 3000);
    fireEvent.scroll(window);
    flushRaf();
    expect(section.style.getPropertyValue("--q0")).toBe("");
    expect(section.querySelector("[data-still]")!.textContent).toContain(HOW_LABELS.floor("SPYx"));
  });

  it("the vault label follows the stock picked in chapter 02", () => {
    render(withState(<><HowItWorks /><WhyStocks /></>));
    const stage = document.getElementById("how-it-works")!.querySelector("[data-stage]")!;
    expect(stage.textContent).toContain("Floor · SPYx");
    fireEvent.click(screen.getByRole("radio", { name: /^NVDAx/ }));
    expect(stage.textContent).toContain("Floor · NVDAx");
    expect(stage.textContent).not.toContain("SPYx");
  });
});
