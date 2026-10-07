import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { splitAriaLabel } from "@/lib/landing/sim/format";
import { StoryStateProvider, useStoryState } from "../scroll/StoryState";
import { FloorShare, frameCurves, pairBallUsd } from "./FloorShare";
import { flightScales } from "./PriceFlightChart";
import { FLOOR_SHARE_STEPS, SLIDER_ENDS } from "./floorShare.copy";

const k = simConstantsFromSdk();

/* ---------- Browser fakes (same as scroll/Chapter.test.tsx) ---------- */

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

/** Put the reading line (500px) at progress `q` of step `i`; earlier steps done, later not started. */
function scrollTo(i: number, q: number) {
  const H = 500;
  const top0 = 500 - (i * H + q * H);
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((s, j) => {
    const top = top0 + j * H;
    s.getBoundingClientRect = () => ({ top, bottom: top + H, height: H, left: 0, right: 10, width: 10, x: 0, y: top, toJSON() {} }) as DOMRect;
  });
  fireEvent.scroll(window);
  flushRaf();
}

function PickNvda() {
  const { setSymbol } = useStoryState();
  return <button onClick={() => setSymbol("NVDAx")}>nvda</button>;
}

function ShareProbe() {
  return <span data-testid="ctx-share">{useStoryState().share}</span>;
}

function renderChapter() {
  return render(
    <StoryStateProvider k={k}>
      <FloorShare />
      <PickNvda />
      <ShareProbe />
    </StoryStateProvider>,
  );
}

const stage = () => document.querySelector<HTMLElement>('[data-testid="floor-share-stage"]')!;
const stageBar = () => stage().querySelector('[role="img"]')!;
const stageMoves = () => [...stage().querySelectorAll('[data-testid="flight-move"]')].map((e) => e.textContent);
const slider = () => screen.getByRole("slider", { name: "Floor share" });

describe("FloorShare copy", () => {
  it("keeps every step to 12 words or fewer", () => {
    for (const s of FLOOR_SHARE_STEPS) expect(s.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("shows no dollar figure, payout or overclaim anywhere in the chapter (text and attributes)", () => {
    const html = renderToString(
      <StoryStateProvider k={k}>
        <FloorShare />
      </StoryStateProvider>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const section = doc.querySelector("section")!;
    const attrs = [...section.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.value));
    const all = [section.textContent ?? "", ...attrs].join("\n");
    expect(all).not.toContain("$");
    expect(all).not.toMatch(/on paper|pays back|×|guarantee|risk-free|can.?t lose|cannot lose|profit|\bsafe\b|protect|uncorrelated|independent/i);
  });

  it("does not import the DepthChart, the SDK barrel or lib/format", () => {
    for (const f of ["FloorShare.tsx", "PriceFlightChart.tsx", "FloorShareSlider.tsx", "range.ts", "floorShare.copy.ts"]) {
      const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), f), "utf8");
      expect(src).not.toMatch(/from\s+["'][^"']*(DepthChart|@stockfloor\/sdk|@\/lib\/format|decimal\.js|@solana\/)/);
    }
  });
});

describe("FloorShare server render (no JS / final frame)", () => {
  const html = renderToString(
    <StoryStateProvider k={k}>
      <FloorShare />
    </StoryStateProvider>,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");

  it("renders the live frame on the stage at the default share", () => {
    const st = doc.querySelector('[data-testid="floor-share-stage"]')!;
    expect(st.getAttribute("data-frame")).toBe("live");
    expect(st.textContent).toContain(`Floor ${k.defaultVaultSharePct}%`);
    expect(st.querySelectorAll("[data-curve]")).toHaveLength(3);
  });

  it("puts the slider in step 3, in the reading flow, and keeps the stage free of controls", () => {
    const steps = doc.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(3);
    expect(steps[2]!.querySelector('input[type="range"]')).not.toBeNull();
    expect(doc.querySelector("[data-stage] input, [data-stage] button, [data-stage] a")).toBeNull();
    expect(doc.querySelector("[data-still] input, [data-still] button, [data-still] a")).toBeNull();
  });
});

describe("FloorShare scroll → stage", () => {
  it("step 1 sweeps the displayed share min → max without touching the slider", () => {
    renderChapter();
    scrollTo(0, 0);
    expect(stage().dataset.frame).toBe("sweep");
    expect(stage().textContent).toContain(`Floor ${k.vaultShareMinPct}%`);
    expect(stage().querySelector("[data-curve]")!.getAttribute("data-curve")).toBe(String(k.vaultShareMinPct));

    scrollTo(0, 0.5);
    const mid = Math.round((k.vaultShareMinPct + k.vaultShareMaxPct) / 2);
    expect(stage().textContent).toContain(`Floor ${mid}%`);
    expect(stageBar().getAttribute("aria-label")).toBe(splitAriaLabel(launchMath(k, mid)));

    scrollTo(0, 0.95);
    expect(stage().textContent).toContain(`Floor ${k.vaultShareMaxPct}%`);
    // The floor line rises with the share (smaller y = higher on the chart).
    const floorLine = stage().querySelector<SVGLineElement>("[data-floor-line]")!;
    expect(floorLine.getAttribute("data-floor-line")).toBe(String(k.vaultShareMaxPct));

    expect(slider()).toHaveProperty("value", String(k.defaultVaultSharePct));
    expect(screen.getByTestId("ctx-share").textContent).toBe(String(k.defaultVaultSharePct));
  });

  it("step 2 climbs both curves with the same buy (+36% vs +78%), then slides back to the floor points", () => {
    renderChapter();
    scrollTo(1, 0.002);
    expect(stage().dataset.frame).toBe("pair");
    expect(stageMoves()).toEqual([]); // nothing climbed yet

    scrollTo(1, 0.6);
    expect(stageMoves()).toEqual(["+36%", "+78%"]);

    // Balls end on each curve's floor point.
    scrollTo(1, 1);
    const balls = [...stage().querySelectorAll<HTMLElement>("[data-ball]")];
    expect(balls).toHaveLength(2);
    const { px, py } = flightScales(k);
    for (const b of balls) {
      const m = launchMath(k, Number(b.dataset.ball));
      expect(parseFloat(b.style.left)).toBeCloseTo(px(-m.sellToFloorUsd), 2);
      expect(parseFloat(b.style.top)).toBeCloseTo(py(m.floorToListing), 2);
    }
    expect(stageMoves()).toEqual(["+36%", "+78%"]);
  });

  it("step 3 shows the user's share with min and max ghosts and the live move", () => {
    renderChapter();
    scrollTo(2, 0.3);
    expect(stage().dataset.frame).toBe("live");
    expect([...stage().querySelectorAll("[data-curve]")].map((c) => c.getAttribute("data-curve"))).toEqual([
      String(k.vaultShareMinPct),
      String(k.vaultShareMaxPct),
      String(k.defaultVaultSharePct),
    ]);
    expect(stageMoves()).toEqual(["+56%"]);

    // Scrolling back reverses.
    scrollTo(0, 0.5);
    expect(stage().dataset.frame).toBe("sweep");
  });

  it("the step-2 ball timeline goes listing → same buy → floor point", () => {
    const { buyUsd } = flightScales(k);
    expect(pairBallUsd(0, buyUsd, 900)).toBe(0);
    expect(pairBallUsd(0.55, buyUsd, 900)).toBe(buyUsd);
    expect(pairBallUsd(1, buyUsd, 900)).toBe(-900);
    expect(frameCurves(k, { kind: "pair", t: 0.3 }, 50).every((c) => (c.arrow ?? 0) > 0 && (c.arrow ?? 0) < 1)).toBe(true);
  });
});

describe("FloorShareSlider", () => {
  it("keys change the split bar, the value text and the shared share", () => {
    renderChapter();
    scrollTo(2, 0.5);
    const s = slider();
    expect(s.getAttribute("aria-valuetext")).toBe("50% to the floor, 40% to the market, 10% to fees.");
    expect(stageBar().getAttribute("aria-label")).toBe(splitAriaLabel(launchMath(k, 50)));

    fireEvent.keyDown(s, { key: "PageUp" });
    expect(screen.getByTestId("ctx-share").textContent).toBe("60");
    expect(s.getAttribute("aria-valuetext")).toBe("60% to the floor, 30% to the market, 10% to fees.");
    expect(stageBar().getAttribute("aria-label")).toBe(splitAriaLabel(launchMath(k, 60)));
    expect(stageMoves()).toEqual(["+78%"]);

    fireEvent.keyDown(s, { key: "ArrowLeft" });
    expect(screen.getByTestId("ctx-share").textContent).toBe("59");
    fireEvent.keyDown(s, { key: "Home" });
    expect(screen.getByTestId("ctx-share").textContent).toBe(String(k.vaultShareMinPct));
    expect(stageMoves()).toEqual(["+36%"]);
    fireEvent.keyDown(s, { key: "End" });
    expect(screen.getByTestId("ctx-share").textContent).toBe(String(k.vaultShareMaxPct));
    fireEvent.keyDown(s, { key: "PageDown" });
    expect(screen.getByTestId("ctx-share").textContent).toBe("50");

    fireEvent.change(s, { target: { value: "42" } });
    expect(screen.getByTestId("ctx-share").textContent).toBe("42");
    expect(s.getAttribute("aria-valuetext")).toBe("42% to the floor, 48% to the market, 10% to fees.");
  });

  it("is a labelled native range with the SDK bounds, ends and no live region", () => {
    renderChapter();
    const s = slider();
    expect(s.getAttribute("min")).toBe(String(k.vaultShareMinPct));
    expect(s.getAttribute("max")).toBe(String(k.vaultShareMaxPct));
    expect(s.getAttribute("step")).toBe("1");
    const section = document.querySelector("section")!;
    expect(section.textContent).toContain(SLIDER_ENDS.low);
    expect(section.textContent).toContain(SLIDER_ENDS.high);
    expect(section.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});

describe("FloorShare labels follow the picked asset", () => {
  it("names the floor asset on the floor line and in the chart's accessible name", () => {
    reduce = true; // stills mount only under reduced motion
    renderChapter();
    expect(stage().querySelector('[data-testid="flight-floor-label"]')!.textContent).toBe("Floor · SPYx");
    fireEvent.click(screen.getByText("nvda"));
    expect(stage().querySelector('[data-testid="flight-floor-label"]')!.textContent).toBe("Floor · NVDAx");
    const stills = document.querySelectorAll('[data-still] [role="img"][aria-label*="NVDAx"]');
    expect(stills.length).toBe(2);
    // The pick changes labels only, never the math.
    expect(stageMoves()).toEqual(["+56%"]);
  });
});

describe("FloorShare stills", () => {
  it("unmount once the client knows motion is fine; the steps still carry the chart's numbers", () => {
    renderChapter();
    expect(document.querySelectorAll("[data-still]")).toHaveLength(0);
    const steps = [...document.querySelectorAll<HTMLElement>("[data-step]")];
    expect(steps[1]!.querySelector(".sr-only")!.textContent).toMatch(/at a 30% floor it moves the price \+36%; at a 60% floor it moves the price \+78%/);
    expect(steps[2]!.querySelector(".sr-only")!.textContent).toContain("+56%");
  });
});

describe("FloorShare under reduced motion", () => {
  it("never attaches: final frame, no CSS variables, a still per step, slider still usable", () => {
    reduce = true;
    renderChapter();
    scrollTo(0, 0.2);
    const section = document.querySelector("section")!;
    expect(section.style.getPropertyValue("--p")).toBe("");
    expect(stage().dataset.frame).toBe("live");
    const stills = document.querySelectorAll("[data-still]");
    expect(stills).toHaveLength(3);
    expect(stills[0]!.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe(splitAriaLabel(launchMath(k, 50)));
    expect([...stills[1]!.querySelectorAll('[data-testid="flight-move"]')].map((e) => e.textContent)).toEqual(["+36%", "+78%"]);
    expect(stills[1]!.querySelectorAll("[data-ball]")).toHaveLength(2);

    fireEvent.keyDown(slider(), { key: "End" });
    expect(stills[0]!.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe(splitAriaLabel(launchMath(k, 60)));
    expect([...stills[2]!.querySelectorAll('[data-testid="flight-move"]')].map((e) => e.textContent)).toEqual(["+78%"]);
  });
});
