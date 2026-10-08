import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { floorEvents } from "@/lib/landing/sim/floorPath";
import { formatUsdCents } from "@/lib/landing/sim/format";
import { BEAT_KEYS, storyBand, storyFrame, storyNetFinal, STORY_POS_END } from "@/lib/landing/sim/story";
import { StoryChart } from "./StoryChart";
import { CHART_COPY, ILLUSTRATION, storyChartStrings } from "./storyChartCopy";
import { makeScales, monotonePathD, niceTicks, pathVertices, stepPathD } from "./storyChartGeometry";

const k = simConstantsFromSdk();
const m50 = launchMath(k, 50);
const beatPos = (key: (typeof BEAT_KEYS)[number], p = 0.999) => BEAT_KEYS.indexOf(key) + p;

afterEach(cleanup);

function chart(pos: number, m = m50, variant: "stage" | "still" = "stage") {
  const { container } = render(<StoryChart m={m} frame={storyFrame(m, pos)} variant={variant} />);
  const root = container.firstElementChild as HTMLElement;
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-part="${name}"]`);
  const parts = (name: string) => [...root.querySelectorAll<HTMLElement>(`[data-part="${name}"]`)];
  return { root, part, parts };
}

describe("storyChartGeometry", () => {
  it("draws a staircase with exactly vertical risers and straight treads", () => {
    const f = storyFrame(m50, STORY_POS_END);
    const d = stepPathD(f.floorSteps, makeScales(f.y));
    expect(/[CQSA]/.test(d)).toBe(false);
    const v = pathVertices(d);
    expect(v).toHaveLength(f.floorSteps.length);
    for (let i = 0; i < f.floorSteps.length - 1; i++) {
      const [ta] = f.floorSteps[i]!;
      const [tb] = f.floorSteps[i + 1]!;
      if (ta === tb) expect(v[i]![0]).toBe(v[i + 1]![0]); // riser: identical x
      else expect(v[i]![1]).toBe(v[i + 1]![1]); // tread: identical y
    }
  });

  it("monotone smoothing passes through every sample and never overshoots between samples", () => {
    const pts: Array<[number, number]> = [
      [0, 10],
      [1, 10],
      [2, 30],
      [3, 25],
      [4, 25],
    ];
    const s = makeScales({ min: 0, max: 40 });
    const d = monotonePathD(pts, s);
    const nums = [...d.matchAll(/-?[\d.]+/g)].map((x) => Number(x[0]));
    // Every C segment's control points stay inside its endpoints' y range.
    const segs = d.split("C").slice(1).map((c) => [...c.matchAll(/-?[\d.]+/g)].map((x) => Number(x[0])));
    segs.forEach((c, i) => {
      const y0 = s.yOf(pts[i]![1]);
      const y1 = s.yOf(pts[i + 1]![1]);
      const [lo, hi] = [Math.min(y0, y1) - 0.01, Math.max(y0, y1) + 0.01];
      for (const y of [c[1]!, c[3]!, c[5]!]) expect(y >= lo && y <= hi).toBe(true);
    });
    expect(nums.length).toBeGreaterThan(0);
  });

  it("niceTicks gives up to three round ticks inside the band", () => {
    const b = storyBand(m50);
    const t = niceTicks(b.min, b.max, 3);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.length).toBeLessThanOrEqual(3);
    for (const v of t) expect(v > b.min && v < b.max).toBe(true);
    expect(niceTicks(0, 1, 3)).toEqual([0.25, 0.5, 0.75]);
  });
});

describe("StoryChart", () => {
  it("is aria-hidden with no focusables and no CSS transitions", () => {
    for (let pos = 0; pos <= STORY_POS_END; pos += 0.5) {
      const { root } = chart(pos);
      expect(root.getAttribute("aria-hidden")).toBe("true");
      expect(root.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
      expect(root.outerHTML).not.toMatch(/transition/);
      cleanup();
    }
  });

  it("draws one staircase vertex pair per floor event that has happened", () => {
    const events = floorEvents(m50);
    for (let pos = 1.01; pos <= STORY_POS_END; pos += 0.25) {
      const f = storyFrame(m50, pos);
      const { part } = chart(pos);
      const happened = events.filter((e) => e.t <= f.t).length;
      const d = part("floor-steps")!.getAttribute("d")!;
      expect(pathVertices(d)).toHaveLength(2 + 2 * happened);
      cleanup();
    }
    const { part } = chart(STORY_POS_END);
    expect(pathVertices(part("floor-steps")!.getAttribute("d")!)).toHaveLength(2 + 2 * events.length);
  });

  it("has no floor before graduation", () => {
    const { part } = chart(0.5);
    expect(part("floor-steps")).toBeNull();
    expect(part("raise-fill")).not.toBeNull();
    expect(chart(0.5).root.textContent).toContain("Raised $");
  });

  it("shows the split column only in the split beat", () => {
    expect(chart(1.3).part("split-column")).not.toBeNull();
    cleanup();
    expect(chart(1.3).root.textContent).toContain(CHART_COPY.floorShare(50));
    cleanup();
    expect(chart(2.2).part("split-column")).toBeNull();
  });

  it("renders ticks and the real-scale chip only once the camera zooms", () => {
    for (const pos of [0, 1.5, 2.5, 3.5, 4]) {
      const { parts, part } = chart(pos);
      expect(storyFrame(m50, pos).zoom).toBe(0);
      expect(parts("tick")).toHaveLength(0);
      expect(parts("tick-label")).toHaveLength(0);
      expect(part("closeup")).toBeNull();
      cleanup();
    }
    for (const pos of [4.5, 5.5, 8]) {
      const { parts, part } = chart(pos);
      expect(storyFrame(m50, pos).zoom).toBeGreaterThan(0);
      expect(parts("tick").length).toBeGreaterThanOrEqual(2);
      expect(parts("tick-label").length).toBe(parts("tick").length);
      const chip = part("closeup")!.textContent!;
      expect(chip).toContain("real scale");
      expect(chip).not.toContain("×");
      cleanup();
    }
  });

  it("never states a magnification anywhere", () => {
    for (let pos = 0; pos <= STORY_POS_END; pos += 0.25) {
      expect(chart(pos).root.textContent).not.toMatch(/×|x\d|\d+x\b/);
      cleanup();
    }
  });

  it("shows harvest risers, the fees bracket and the peak pill in the steps beat", () => {
    const { parts, part, root } = chart(beatPos("steps"));
    expect(parts("harvest")).toHaveLength(5);
    expect(part("fees-label")!.textContent).toBe(CHART_COPY.fromFees(storyFrame(m50, beatPos("steps")).feesPct!));
    expect(part("fees-label")!.textContent).toMatch(/^\+4\.8% from fees$/);
    expect(part("peak")!.textContent).toBe("Peak $400 ↑");
    expect(root.textContent).not.toContain(CHART_COPY.arbLine);
  });

  it("draws the arbitrage line only from the bounce beat on", () => {
    for (const key of BEAT_KEYS) {
      const { part } = chart(beatPos(key, 0.5));
      const fromBounce = BEAT_KEYS.indexOf(key) >= BEAT_KEYS.indexOf("bounce");
      expect(part("arb-line") !== null).toBe(fromBounce);
      expect(part("arb-label") !== null).toBe(fromBounce);
      cleanup();
    }
    const { part } = chart(beatPos("bounce", 0.5));
    expect(part("arb-label")!.textContent).toBe("Arbitrage line");
    // Same staircase, scaled by (1 − f)(1 − φ).
    expect(pathVertices(part("arb-line")!.getAttribute("d")!)).toHaveLength(pathVertices(part("floor-steps")!.getAttribute("d")!).length);
  });

  it("marks the bounce at the dip, once it is reached, and keeps it after", () => {
    expect(chart(beatPos("bounce", 0.1)).part("bounce")).toBeNull();
    cleanup();
    for (const pos of [beatPos("bounce", 0.5), beatPos("exits", 0.5), STORY_POS_END]) {
      const { part } = chart(pos);
      expect(part("bounce")).not.toBeNull();
      expect(part("bounce-label")!.textContent).toBe("Bounce");
      cleanup();
    }
    // The label is fully visible in the bounce beat and yields to the exits marker later.
    expect(chart(beatPos("bounce", 0.6)).part("bounce-label")!.parentElement!.style.opacity).toBe("1");
    cleanup();
    expect(chart(beatPos("exits", 0.9)).part("bounce-label")!.parentElement!.style.opacity).toBe("0");
  });

  it("marks the exit step after the holders redeem", () => {
    expect(chart(beatPos("exits", 0.3)).part("exits-label")).toBeNull();
    cleanup();
    const { part } = chart(beatPos("exits", 0.9));
    expect(part("exits-label")!.textContent).toBe("+0.9% from exits");
  });

  it("drops to the redeem chip at the net floor in the redeem beat", () => {
    const { part } = chart(STORY_POS_END);
    expect(part("redeem-chip")!.textContent).toBe(`Redeem ${formatUsdCents(storyNetFinal(m50))}`);
    expect(part("redeem-chip")!.textContent).toBe("Redeem $36.87");
    // Phones show just the amount.
    expect(part("redeem-chip")!.querySelector(".max-sm\\:hidden")!.textContent).toBe("Redeem ");
    expect(part("redeem-bar")).toBeNull();
    expect(Number(part("price")!.getAttribute("opacity"))).toBeCloseTo(0.4, 6);
    cleanup();
    expect(chart(beatPos("exits")).part("redeem-chip")).toBeNull();
  });

  it("keeps the Illustration pill butter during the made-up trading beats", () => {
    for (const key of BEAT_KEYS) {
      const { part } = chart(beatPos(key, 0.5));
      const pill = part("pill")!;
      expect(pill.textContent).toContain(ILLUSTRATION);
      const live = ["pump", "selloff", "bounce", "exits"].includes(key);
      expect(pill.className.includes("bg-butter")).toBe(live);
      cleanup();
    }
    expect(chart(beatPos("pump", 0.5)).part("pill")!.textContent).toBe("Illustration · $100k traded");
    cleanup();
    // The volume behind the staircase stays named through the close-up.
    expect(chart(beatPos("steps", 0.5)).part("pill")!.textContent).toBe("Illustration · $100k traded");
    cleanup();
    expect(chart(beatPos("bounce", 0.5)).part("pill")!.textContent).toBe("Illustration");
  });

  it("a step's hold shows its own beat: the pill at pos i + 1 matches beat i", () => {
    for (let i = 0; i < BEAT_KEYS.length; i++) {
      const { part } = chart(i + 1);
      const live = ["pump", "selloff", "bounce", "exits"].includes(BEAT_KEYS[i]!);
      expect(part("pill")!.className.includes("bg-butter")).toBe(live);
      if (BEAT_KEYS[i] === "split") expect(part("pill")!.textContent).toBe(ILLUSTRATION);
      cleanup();
    }
  });

  it("moves overlays with transforms only, never left/top", () => {
    for (const pos of [2.5, 4.5, 5.5, 6.7, 8]) {
      const { root } = chart(pos);
      const plot = root.querySelector("svg")!.parentElement!;
      for (const el of plot.querySelectorAll<HTMLElement>("[style]")) {
        if (el.closest('[data-part^="split-"]')) continue; // split labels sit still (fixed y domain)
        expect(el.style.left).toBe("");
        expect(el.style.top).toBe("");
      }
      cleanup();
    }
  });

  it("renders a still at 180px and a stage at full height", () => {
    expect(chart(4, m50, "still").root.style.height).toBe("180px");
    cleanup();
    expect(chart(4).root.className).toContain("h-full");
  });

  it("keeps every chart string short and free of overclaims", () => {
    const banned = /guarantee|profit|\bsafe|risk-free|protected from loss/i;
    for (const v of [30, 50, 60]) for (const s of storyChartStrings(launchMath(k, v))) {
      expect(s).not.toMatch(banned);
      expect(s.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });

  it("renders deterministically at every whole pos (server and client)", () => {
    for (let pos = 0; pos <= STORY_POS_END; pos++) {
      const a = renderToString(<StoryChart m={m50} frame={storyFrame(m50, pos)} variant="stage" />);
      const b = renderToString(<StoryChart m={m50} frame={storyFrame(m50, pos)} variant="stage" />);
      expect(a).toBe(b);
      expect(a).toMatchSnapshot(`pos ${pos}`);
    }
  });
});
