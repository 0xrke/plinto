import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { FLOW_STOP_COUNT, flowUsdAt, paperValueOf100 } from "@/lib/landing/sim/market";
import { formatUsdCents } from "@/lib/landing/sim/format";
import { FLOOR_SHARE_INPUT_ID, SplitSandbox, flowLabel, sandboxReadout } from "./SplitSandbox";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const k = simConstantsFromSdk();

function setup() {
  render(<SplitSandbox k={k} />);
  const share = screen.getByLabelText("Floor share") as HTMLInputElement;
  const flow = screen.getByLabelText("Trading after listing") as HTMLInputElement;
  const paper = () => screen.getByTestId("sandbox-paper");
  const back = () => screen.getByText("Floor pays back").nextElementSibling as HTMLElement;
  return { share, flow, paper, back };
}

describe("SplitSandbox", () => {
  it("renders the SDK defaults: $156.25 on paper, $34.88 back, 2.8x, $1,614 to the floor", () => {
    const { share, flow, paper, back } = setup();
    expect(share.id).toBe(FLOOR_SHARE_INPUT_ID);
    expect(share.value).toBe("50");
    expect(flow.value).toBe("6");
    expect(paper().textContent).toBe("$156.25");
    expect(back().textContent).toBe("$34.88");
    expect(screen.getByText("2.8×")).toBeTruthy();
    expect(screen.getByText("$1,614")).toBeTruthy();
    expect(screen.getByText("Bought $1,000")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Floor 50%, market 40%, creator 5%, platform 5%" })).toBeTruthy();
    expect(screen.getByText("$5,000")).toBeTruthy();
    expect(screen.getByText("$4,000")).toBeTruthy();
    expect(screen.getByText("$1,000")).toBeTruthy();
    expect(screen.getByText("Floor held in SPYx; its dollar value moves with the S&P 500.")).toBeTruthy();
    expect(screen.getByText("after 2% exit fee")).toBeTruthy();
  });

  it("server-renders the default state with the same numbers", () => {
    const html = renderToString(<SplitSandbox k={k} />);
    for (const s of ["$156.25", "$34.88", "2.8×", "$1,614", "Bought $1,000"]) expect(html).toContain(s);
  });

  it("follows the floor-share slider to the engine's values", () => {
    const { share, paper, back } = setup();
    fireEvent.change(share, { target: { value: "60" } });
    const m60 = launchMath(k, 60);
    expect(back().textContent).toBe("$45.06");
    expect(back().textContent).toBe(formatUsdCents(m60.floorPer100Usd));
    expect(screen.getByText("$966")).toBeTruthy();
    expect(screen.getByText("2.2×")).toBeTruthy();
    expect(paper().textContent).toBe("$177.78");
    expect(share.getAttribute("aria-valuetext")).toBe(
      "60% to the floor, 30% to the market, 10% to fees. Your $100: $177.78 on paper; the floor pays back $45.06.",
    );

    fireEvent.change(share, { target: { value: "30" } });
    expect(back().textContent).toBe("$18.32");
    expect(screen.getByText("5.3×")).toBeTruthy();
    expect(screen.getByText("$3,406")).toBeTruthy();
  });

  it("stops selling at the floor: the leftmost stop lands on it, never under it", () => {
    const { flow, paper, back } = setup();
    fireEvent.change(flow, { target: { value: "0" } });
    expect(paper().textContent).toBe("$35.59");
    expect(paper().className).toContain("text-floor");
    expect(screen.getByText("At the floor")).toBeTruthy();
    expect(back().textContent).toBe("$34.88");
    expect(screen.getByText("Sold $1,614")).toBeTruthy();
    expect(flow.getAttribute("aria-valuetext")).toBe("Sold $1,614, down to the floor: $35.59 on paper; the floor pays back $34.88.");

    fireEvent.change(flow, { target: { value: "3" } });
    expect(paper().className).not.toContain("text-floor");
    expect(screen.queryByText("At the floor")).toBeNull();
    expect(flow.getAttribute("aria-valuetext")).toBe("Sold $403: your $100 is $80.84 on paper.");
  });

  it("shows the floor point on the chart at every floor share", () => {
    const { share } = setup();
    for (const v of [30, 35, 39, 40, 50, 60]) {
      fireEvent.change(share, { target: { value: String(v) } });
      const left = parseFloat(screen.getByTestId("depth-floor-dot").style.left);
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThan(100);
    }
  });

  it("steps both sliders with the keyboard", () => {
    const { share, flow, paper } = setup();
    fireEvent.keyDown(share, { key: "ArrowRight" });
    expect(share.value).toBe("51");
    fireEvent.keyDown(share, { key: "ArrowDown" });
    fireEvent.keyDown(share, { key: "ArrowLeft" });
    expect(share.value).toBe("49");
    fireEvent.keyDown(share, { key: "PageUp" });
    expect(share.value).toBe("59");
    fireEvent.keyDown(share, { key: "End" });
    expect(share.value).toBe("60");
    fireEvent.keyDown(share, { key: "ArrowRight" });
    expect(share.value).toBe("60");
    fireEvent.keyDown(share, { key: "Home" });
    expect(share.value).toBe("30");
    fireEvent.keyDown(share, { key: "PageDown" });
    expect(share.value).toBe("30");
    fireEvent.keyDown(share, { key: "PageUp" });
    fireEvent.keyDown(share, { key: "PageUp" });
    expect(share.value).toBe("50");

    fireEvent.keyDown(flow, { key: "ArrowRight" });
    expect(flow.value).toBe("7");
    expect(screen.getByText("Bought $2,000")).toBeTruthy();
    const m = launchMath(k, 50);
    expect(paper().textContent).toBe(formatUsdCents(paperValueOf100(m, 2000)));
    fireEvent.keyDown(flow, { key: "Home" });
    expect(flow.value).toBe("0");
    expect(paper().textContent).toBe("$35.59");
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    expect(flow.value).toBe("4");
    expect(screen.getByText("No trades")).toBeTruthy();
    expect(flow.getAttribute("aria-valuetext")).toBe("No trades: $100.00.");
    expect(paper().textContent).toBe("$100.00");
  });

  it("reads well to screen readers", () => {
    const { share, flow } = setup();
    expect(share.getAttribute("aria-valuetext")).toBe(
      "50% to the floor, 40% to the market, 10% to fees. Your $100: $156.25 on paper; the floor pays back $34.88.",
    );
    expect(flow.getAttribute("aria-valuetext")).toBe("Bought $1,000: your $100 is $156.25 on paper.");
    expect(
      screen.getByRole("img", {
        name: "Your $100 is $156.25 on paper after $1,000 of buying; $1,614 of selling takes it to the floor, which pays back $34.88.",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Set the split" })).toBeTruthy();
  });

  it("announces once, 600 ms after a drag ends, never mid-drag and never for keys", () => {
    vi.useFakeTimers();
    const { share, flow } = setup();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");

    // A drag: pointer down, several changes, nothing is said until the pointer is released.
    fireEvent.pointerDown(share);
    fireEvent.change(share, { target: { value: "55" } });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.change(share, { target: { value: "60" } });
    act(() => vi.advanceTimersByTime(1000));
    expect(status.textContent).toBe("");
    fireEvent.pointerUp(share);
    act(() => vi.advanceTimersByTime(599));
    expect(status.textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(status.textContent).toBe("Floor 60%. $1,000 of buying: $177.78 on paper. Floor pays back $45.06.");

    // Keyboard steps: the focused slider's aria-valuetext speaks them; the status line stays put.
    fireEvent.keyDown(flow, { key: "Home" });
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    act(() => vi.advanceTimersByTime(2000));
    expect(status.textContent).toBe("Floor 60%. $1,000 of buying: $177.78 on paper. Floor pays back $45.06.");
    expect(flow.getAttribute("aria-valuetext")).toBe("Sold $724: your $100 is $57.54 on paper.");

    // A tap on the flow track is a pointer change too.
    fireEvent.pointerDown(flow);
    fireEvent.change(flow, { target: { value: "4" } });
    fireEvent.pointerUp(flow);
    act(() => vi.advanceTimersByTime(600));
    expect(status.textContent).toBe("Floor 60%. No trades: $100.00 on paper. Floor pays back $45.06.");
  });

  it("clears a pending announcement on unmount", () => {
    vi.useFakeTimers();
    const { share } = setup();
    fireEvent.pointerDown(share);
    fireEvent.change(share, { target: { value: "40" } });
    fireEvent.pointerUp(share);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("works controlled, as FloorLab drives it", () => {
    const onShare = vi.fn();
    const onFlow = vi.fn();
    render(<SplitSandbox k={k} vaultSharePct={40} onVaultSharePctChange={onShare} flowIndex={4} onFlowIndexChange={onFlow} />);
    expect(screen.getByText("Floor pays back").nextElementSibling!.textContent).toBe("$26.05");
    fireEvent.keyDown(screen.getByLabelText("Floor share"), { key: "ArrowRight" });
    expect(onShare).toHaveBeenCalledWith(41);
    fireEvent.change(screen.getByLabelText("Trading after listing"), { target: { value: "5" } });
    expect(onFlow).toHaveBeenCalledWith(5);
  });

  it("keeps copy honest and short", () => {
    const { container } = render(<SplitSandbox k={k} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/guarantee|risk-free|can't lose|can’t lose|profit|\bsafe\b|protect/i);
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(70);
  });
});

describe("sandbox helpers", () => {
  it("labels flows", () => {
    expect(flowLabel(1000)).toBe("Bought $1,000");
    expect(flowLabel(-500)).toBe("Sold $500");
    expect(flowLabel(0)).toBe("No trades");
  });

  it("matches the engine at every floor share and flow stop", () => {
    for (let v = k.vaultShareMinPct; v <= k.vaultShareMaxPct; v++) {
      const m = launchMath(k, v);
      for (let i = 0; i < FLOW_STOP_COUNT; i++) {
        const x = flowUsdAt(m, i);
        const r = sandboxReadout(m, x);
        expect(r.paper).toBe(paperValueOf100(m, x));
        expect(r.atFloor).toBe(i === 0);
      }
    }
  });
});
