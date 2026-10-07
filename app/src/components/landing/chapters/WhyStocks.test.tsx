import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { StoryStateProvider } from "../scroll/StoryState";
import { QUOTE_ASSETS } from "../scroll/quoteAssets";
import { WhyStocks } from "./WhyStocks";
import { VOLATILE_NOTE, WHY_STEPS } from "./whyStocks.copy";

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

function placeSteps(section: Element, top: number) {
  section.querySelectorAll<HTMLElement>("[data-step]").forEach((s, i) => {
    s.getBoundingClientRect = () =>
      ({ top: top + i * 500, bottom: top + i * 500 + 500, height: 500, left: 0, right: 10, width: 10, x: 0, y: 0, toJSON() {} }) as DOMRect;
  });
}

function renderChapter() {
  render(
    <StoryStateProvider k={k}>
      <WhyStocks />
    </StoryStateProvider>,
  );
  const section = document.getElementById("why-stocks")!;
  return { section, stage: section.querySelector<HTMLElement>("[data-stage]")! };
}

const radio = (sym: string) => screen.getByRole("radio", { name: new RegExp(`^${sym},`) }) as HTMLInputElement;
const checkedSymbol = () => (screen.getAllByRole("radio") as HTMLInputElement[]).find((r) => r.checked)?.value;

describe("02 Why stocks (server render)", () => {
  const html = renderToString(
    <StoryStateProvider k={k}>
      <WhyStocks />
    </StoryStateProvider>,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const section = doc.querySelector("section")!;
  const stage = section.querySelector("[data-stage]")!;

  it("three steps in order; the picker is in the steps, the stage has no controls", () => {
    expect(section.id).toBe("why-stocks");
    const cards = [...section.querySelectorAll("[data-step] > :first-child")];
    expect(cards.map((c) => c.querySelector("p")!.textContent)).toEqual([...WHY_STEPS]);
    expect(cards[2]!.querySelectorAll('input[type="radio"]')).toHaveLength(8);
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    expect(stage.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("stage: labelled illustration, crypto vs SPYx floor, no numbers", () => {
    const text = stage.textContent!;
    for (const l of ["Illustration", "Crypto floor", "SPYx floor", "Your token"]) expect(text).toContain(l);
    expect(text.replace("SPYx", "")).not.toMatch(/\d|\$|%/);
  });

  it("stage reads --q0..--q2 (final frame without the driver)", () => {
    const style = (part: string) => stage.querySelector(`[data-part="${part}"]`)!.getAttribute("style") ?? "";
    expect(style("crypto-panel")).toContain("var(--q1, 1)");
    expect(style("stock-floor")).toContain("var(--q1, 1)");
    expect(style("panels")).toContain("var(--q2, 1)");
  });

  it("stills: crypto panel only, then both panels with the pill, then the coin", () => {
    const stills = [...section.querySelectorAll("[data-still]")];
    expect(stills).toHaveLength(3);
    expect(stills[0]!.textContent).toContain("Crypto floor");
    expect(stills[0]!.textContent).not.toContain("SPYx floor");
    expect(stills[0]!.innerHTML).toContain("--q1:0");
    expect(stills[1]!.textContent).toContain("SPYx floor");
    expect(stills[1]!.textContent).toContain("Illustration");
    expect(stills[2]!.textContent).toContain("SPYx");
    for (const s of stills) expect(s.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("copy: short steps, careful claims, no overclaims", () => {
    for (const s of WHY_STEPS) expect(s.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(section.textContent).toContain("Stocks fall too.");
    expect(section.textContent).not.toMatch(OVERCLAIM);
  });
});

describe("StockPicker", () => {
  it("is a fieldset of 8 radios with full names, SPYx checked by default", () => {
    renderChapter();
    const group = screen.getByRole("group", { name: "Floor asset" });
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(QUOTE_ASSETS.map((a) => a.symbol));
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set(["floor-asset"]));
    expect(radio("SPYx").checked).toBe(true);
    expect(radio("SPYx").getAttribute("aria-label")).toBe("SPYx, S&P 500 index ETF (SPY)");
    expect(within(group).getByText("Calm")).toBeTruthy();
    expect(within(group).getByText("Volatile")).toBeTruthy();
    expect(screen.getByText("Tracks the S&P 500.")).toBeTruthy();
    expect(screen.queryByText(VOLATILE_NOTE)).toBeNull();
  });

  it("arrow keys move the selection and focus, wrapping across rows", () => {
    renderChapter();
    radio("SPYx").focus();
    fireEvent.keyDown(radio("SPYx"), { key: "ArrowRight" });
    expect(checkedSymbol()).toBe("QQQx");
    expect(document.activeElement).toBe(radio("QQQx"));
    fireEvent.keyDown(radio("QQQx"), { key: "ArrowDown" });
    fireEvent.keyDown(radio("GLDx"), { key: "ArrowDown" });
    expect(checkedSymbol()).toBe("NVDAx");
    fireEvent.keyDown(radio("NVDAx"), { key: "ArrowUp" });
    expect(checkedSymbol()).toBe("GLDx");
    radio("SPYx").focus();
    fireEvent.click(radio("SPYx"));
    fireEvent.keyDown(radio("SPYx"), { key: "ArrowLeft" });
    expect(checkedSymbol()).toBe("TSLAx");
    // Other keys pass through.
    fireEvent.keyDown(radio("TSLAx"), { key: "Tab" });
    expect(checkedSymbol()).toBe("TSLAx");
  });

  it("a volatile pick adds the swing note; a calm one removes it", () => {
    renderChapter();
    fireEvent.click(radio("TSLAx"));
    expect(screen.getByText("Tracks Tesla.")).toBeTruthy();
    expect(screen.getByText(VOLATILE_NOTE).className).toContain("text-risk");
    fireEvent.click(radio("GLDx"));
    expect(screen.getByText("Tracks gold.")).toBeTruthy();
    expect(screen.queryByText(VOLATILE_NOTE)).toBeNull();
  });

  it("picking a stock updates the band label, the coin and the dip depth", () => {
    reduce = true; // the coin still mounts only under reduced motion; the stage renders either way
    const { stage, section } = renderChapter();
    const floorPath = () => stage.querySelector('[data-part="stock-floor"]')!.getAttribute("d");
    const calmPath = floorPath();
    const coin = () => stage.querySelector('[data-part="big-coin"]')!.textContent;
    expect(stage.textContent).toContain("SPYx floor");
    expect(coin()).toContain("SPYx");

    fireEvent.click(radio("NVDAx"));
    expect(stage.textContent).toContain("NVDAx floor");
    expect(stage.textContent).not.toContain("SPYx floor");
    expect(coin()).toMatch(/NVDAx$/);
    expect(floorPath()).not.toBe(calmPath);
    // The coin still under reduced motion reacts too.
    expect(section.querySelector('[data-still="2"]')!.textContent).toContain("NVDAx");

    fireEvent.click(radio("QQQx"));
    expect(floorPath()).toBe(calmPath); // only the calm flag picks the path
  });
});

describe("02 Why stocks in the browser", () => {
  it("maps scroll progress to the stage's CSS variables and the active step", () => {
    const { section } = renderChapter();
    placeSteps(section, 500 - 1000 - 100); // step 2 a fifth in
    fireEvent.scroll(window);
    flushRaf();
    expect(section.style.getPropertyValue("--q0")).toBe("1");
    expect(section.style.getPropertyValue("--q1")).toBe("1");
    expect(section.style.getPropertyValue("--q2")).toBe("0.2");
    expect(section.getAttribute("data-active")).toBe("2");
    // Scrolling never changes the pick.
    expect(checkedSymbol()).toBe("SPYx");
  });

  it("reduced motion: no driver, the picker still works, stills show the pick", () => {
    reduce = true;
    const { section } = renderChapter();
    placeSteps(section, 3000);
    fireEvent.scroll(window);
    flushRaf();
    expect(section.style.getPropertyValue("--q0")).toBe("");
    fireEvent.click(radio("MSFTx"));
    expect(section.querySelector('[data-still="2"]')!.textContent).toContain("MSFTx");
    expect(section.querySelector('[data-still="1"]')!.textContent).toContain("MSFTx floor");
  });
});
