import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useState } from "react";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { Chapter, keepClearOfStage } from "./Chapter";
import { useChapterSelect } from "./useChapter";
import { StoryStateProvider, useStoryState } from "./StoryState";

/* ---------- Browser fakes ---------- */

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

/** Stage probe: renders the selected progress so tests can read it. */
function Probe() {
  const active = useChapterSelect((s) => s.active);
  const q0 = useChapterSelect((s) => Math.round(s.q[0]! * 100));
  return <span data-testid="probe">{`${active}:${q0}`}</span>;
}

const STEPS = [
  { body: <p>Step one.</p>, still: <span>still one</span> },
  { body: <p>Step two.</p> },
  { body: <label>Pick<input type="radio" name="x" /></label>, still: <span>still three</span> },
];

function TestChapter() {
  return <Chapter id="how-it-works" numeral="01" eyebrow="How it works" steps={STEPS} stage={<Probe />} />;
}

/** Give each step a rect: 500px tall, stacked from `top`. */
function placeSteps(top: number) {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((s, i) => {
    s.getBoundingClientRect = () => ({ top: top + i * 500, bottom: top + i * 500 + 500, height: 500, left: 0, right: 10, width: 10, x: 0, y: 0, toJSON() {} }) as DOMRect;
  });
}

describe("Chapter markup (server render)", () => {
  const html = renderToString(<TestChapter />);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const section = doc.querySelector("section")!;

  it("is a labelled section with the anchor id", () => {
    expect(section.id).toBe("how-it-works");
    expect(section.getAttribute("aria-labelledby")).toBe("how-it-works-title");
    expect(doc.getElementById("how-it-works-title")?.textContent).toBe("How it works");
  });

  it("renders steps first in DOM order, then an aria-hidden, inert stage", () => {
    const steps = [...section.querySelectorAll("[data-step]")];
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(["0", "1", "2"]);
    const stage = section.querySelector("[data-stage]")!;
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    expect(stage.hasAttribute("inert")).toBe(true);
    expect(steps.every((s) => s.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("always renders the stills (CSS shows them only under reduced motion)", () => {
    expect([...section.querySelectorAll("[data-still]")].map((s) => s.textContent)).toEqual(["still one", "still three"]);
  });

  it("server-renders the final frame: last step active, every q = 1", () => {
    expect(section.querySelector("[data-stage]")!.textContent).toBe("2:100");
  });
});

describe("Chapter in the browser", () => {
  it("follows the scroll once motion is allowed", () => {
    render(<TestChapter />);
    placeSteps(500 - 250); // step 0 half in
    flushRaf();
    expect(screen.getByTestId("probe").textContent).toBe("0:50");
    const section = document.querySelector("section")!;
    expect(section.style.getPropertyValue("--q0")).toBe("0.5");

    placeSteps(500 - 1100); // step 2 a fifth in
    fireEvent.scroll(window);
    flushRaf();
    expect(screen.getByTestId("probe").textContent).toBe("2:100");
  });

  it("removes its listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<TestChapter />);
    flushRaf();
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("never attaches under reduced motion: final frame, no CSS variables, no dimming", () => {
    reduce = true;
    render(<TestChapter />);
    placeSteps(2000); // far below the reading line
    fireEvent.scroll(window);
    flushRaf();
    const section = document.querySelector("section")!;
    expect(section.style.getPropertyValue("--p")).toBe("");
    expect(document.querySelector("[data-step][data-active]")).toBeNull();
    expect(screen.getByTestId("probe").textContent).toBe("2:100");
    expect(document.querySelectorAll("[data-still]")).toHaveLength(2);
  });
});

describe("keepClearOfStage", () => {
  function rect(top: number, bottom: number): DOMRect {
    return { top, bottom, height: bottom - top, left: 0, right: 300, width: 300, x: 0, y: top, toJSON() {} } as DOMRect;
  }

  it("scrolls a focused control out from under the sticky stage, instantly", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<TestChapter />);
    const section = document.querySelector("section")!;
    const stage = section.querySelector<HTMLElement>("[data-stage]")!;
    stage.getBoundingClientRect = () => rect(0, 400);
    const input = section.querySelector("input")!;
    input.getBoundingClientRect = () => rect(300, 344);
    keepClearOfStage(section, input);
    expect(scrollBy).toHaveBeenCalledWith(0, 300 - 408);

    // Wired to focusin on the section.
    scrollBy.mockClear();
    fireEvent.focusIn(input);
    expect(scrollBy).toHaveBeenCalledWith(0, 300 - 408);

    scrollBy.mockClear();
    input.getBoundingClientRect = () => rect(500, 544);
    keepClearOfStage(section, input);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("brings a control that focus left below the viewport back up, never under the stage", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<TestChapter />);
    const section = document.querySelector("section")!;
    const stage = section.querySelector<HTMLElement>("[data-stage]")!;
    stage.getBoundingClientRect = () => rect(0, 400);
    const input = section.querySelector("input")!;
    // innerHeight is 1000: a control at 1036..1080 is off-screen.
    input.getBoundingClientRect = () => rect(1036, 1080);
    keepClearOfStage(section, input);
    expect(scrollBy).toHaveBeenCalledWith(0, 1080 - 992);
  });

  it("does nothing while the stage is hidden (reduced motion)", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<TestChapter />);
    const section = document.querySelector("section")!;
    section.querySelector<HTMLElement>("[data-stage]")!.getBoundingClientRect = () => rect(0, 0);
    const input = section.querySelector("input")!;
    input.getBoundingClientRect = () => rect(0, 44);
    fireEvent.focusIn(input);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe("StoryStateProvider", () => {
  const k = simConstantsFromSdk();

  function Read() {
    const s = useStoryState();
    const [, force] = useState(0);
    return (
      <div>
        <span data-testid="sym">{s.asset.symbol}</span>
        <span data-testid="share">{s.share}</span>
        <span data-testid="floor">{s.m.v}</span>
        <button onClick={() => s.setSymbol("NVDAx")}>nvda</button>
        <button onClick={() => s.setSymbol("DOGEx")}>doge</button>
        <button onClick={() => s.setShare(99)}>max</button>
        <button onClick={() => s.setShare(41.6)}>frac</button>
        <button onClick={() => force((n) => n + 1)}>rerender</button>
      </div>
    );
  }

  it("defaults to SPYx and the SDK default floor share passed from the server", () => {
    render(
      <StoryStateProvider k={k}>
        <Read />
      </StoryStateProvider>,
    );
    expect(screen.getByTestId("sym").textContent).toBe("SPYx");
    expect(screen.getByTestId("share").textContent).toBe(String(k.defaultVaultSharePct));
    expect(screen.getByTestId("floor").textContent).toBe(String(launchMath(k, k.defaultVaultSharePct).v));
  });

  it("takes picks from the allowlist only and clamps the share to the SDK range", () => {
    render(
      <StoryStateProvider k={k}>
        <Read />
      </StoryStateProvider>,
    );
    fireEvent.click(screen.getByText("nvda"));
    expect(screen.getByTestId("sym").textContent).toBe("NVDAx");
    fireEvent.click(screen.getByText("doge"));
    expect(screen.getByTestId("sym").textContent).toBe("NVDAx");
    fireEvent.click(screen.getByText("max"));
    expect(screen.getByTestId("share").textContent).toBe(String(k.vaultShareMaxPct));
    expect(screen.getByTestId("floor").textContent).toBe(String(launchMath(k, k.vaultShareMaxPct).v));
    fireEvent.click(screen.getByText("frac"));
    expect(screen.getByTestId("share").textContent).toBe("42");
  });

  it("throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Read />)).toThrow(/StoryStateProvider/);
  });
});
