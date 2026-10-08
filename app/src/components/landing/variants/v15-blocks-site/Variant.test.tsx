import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { BEAT_KEYS, storyFrame } from "@/lib/landing/sim/story";
import { beatCaption } from "../shared";
import Variant from "./Variant";
import { BlocksStage } from "./BlocksStage";

const m = launchMath(simConstantsFromSdk(), 50);
let reduceMotion = false;

class FakeIO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduceMotion : true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("v15 Blocks · site style", () => {
  it("renders every beat's caption in its step, in order", () => {
    const { container } = render(<Variant m={m} />);
    const steps = container.querySelectorAll("[data-step]");
    expect(steps).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key, i) => expect(steps[i]!.textContent).toContain(beatCaption(m, key)));
    expect(screen.getByTestId("story-track")).toBeTruthy();
  });

  it("reduced motion renders eight static frames, each in the midnight chart card", () => {
    reduceMotion = true;
    render(<Variant m={m} />);
    expect(screen.queryByTestId("story-track")).toBeNull();
    const stills = screen.getByTestId("story-stills");
    expect(stills.querySelectorAll("figure")).toHaveLength(BEAT_KEYS.length);
    expect(stills.querySelectorAll('[data-brand-chart="still"]')).toHaveLength(BEAT_KEYS.length);
    BEAT_KEYS.forEach((key) => expect(stills.textContent).toContain(beatCaption(m, key)));
  });

  it("stacks one block per floor event on the foundation and labels the bounce frame", () => {
    const end = storyFrame(m, 8);
    const { container } = render(<BlocksStage m={m} frame={end} />);
    // foundation + every event: three faces each
    expect(container.querySelectorAll("polygon").length).toBeGreaterThanOrEqual((1 + end.events.length) * 3);
    expect(container.querySelector('[data-part="tile-floor"]')?.textContent).toMatch(/^\$\d+\.\d{2}$/);
    const bounce = render(<BlocksStage m={m} frame={storyFrame(m, 6)} />).container;
    expect(bounce.querySelector('[data-part="illustration"]')?.textContent).toBe("Illustration");
    expect(bounce.querySelector('[data-part="scale"]')?.textContent).toBe("Close-up · real scale");
    expect(bounce.textContent).toContain("Arbitrage line");
    expect(bounce.textContent).toContain("Bounce");
  });

  it("uses site tokens only: no raw hex colours in the stage markup", () => {
    const { container } = render(<BlocksStage m={m} frame={storyFrame(m, 6)} />);
    const html = container.innerHTML.replace(/url\(#[^)]*\)/g, "");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).toContain("var(--color-mint)");
  });
});
