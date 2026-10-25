import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { CHART, LIGHT, alpha } from "./brand";
import { BrandChartFrame, BrandTiles, scaleLabel } from "./BrandChartFrame";
import { ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW } from "./copy";

const m = launchMath(simConstantsFromSdk(), 50);
const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
// --color-white comes from Tailwind's default palette, not globals.css.
const TAILWIND_DEFAULTS = new Set(["--color-white"]);

afterEach(cleanup);

describe("brand palette", () => {
  it("references only colour tokens that exist (and never a raw hex)", () => {
    for (const value of [...Object.values(CHART), ...Object.values(LIGHT)]) {
      expect(value).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      const names = [...value.matchAll(/var\((--color-[a-z0-9-]+)\)/g)].map((x) => x[1]!);
      expect(names.length, value).toBeGreaterThan(0);
      for (const name of names) {
        if (!TAILWIND_DEFAULTS.has(name)) expect(globals, name).toContain(`${name}:`);
      }
    }
  });

  it("mixes alpha tints with color-mix and clamps the amount", () => {
    expect(alpha(CHART.floor, 0.14)).toBe("color-mix(in srgb, var(--color-mint) 14%, transparent)");
    expect(alpha(CHART.floor, 2)).toContain(" 100%,");
    expect(alpha(CHART.floor, -1)).toContain(" 0%,");
  });
});

describe("BrandChartFrame", () => {
  it("labels illustration and scale, and hides itself from screen readers", () => {
    const { container } = render(
      <BrandChartFrame illustration scale="real">
        <svg data-testid="plot" />
      </BrandChartFrame>,
    );
    const card = container.firstElementChild!;
    expect(card.getAttribute("aria-hidden")).toBe("true");
    expect(card.className).toContain("bg-midnight");
    expect(card.querySelector('[data-part="illustration"]')?.textContent).toBe(ILLUSTRATION);
    expect(card.querySelector('[data-part="illustration"]')?.className).toContain("bg-butter");
    expect(card.querySelector('[data-part="scale"]')?.textContent).toBe(REAL_SCALE_LABEL);
    expect(card.querySelector('[data-testid="plot"]')).not.toBeNull();
  });

  it("names magnification, and shows no chip without a scale or illustration", () => {
    expect(scaleLabel(20)).toBe("Steps magnified 20×");
    expect(scaleLabel(1)).toBeNull();
    expect(scaleLabel(null)).toBeNull();
    const { container } = render(<BrandChartFrame illustration="Illustration · $1.5M traded" illustrationLive={false} scale={12} size="still" />);
    expect(container.querySelector('[data-part="illustration"]')?.className).toContain("bg-midnight-chip");
    expect(container.querySelector('[data-part="scale"]')?.textContent).toBe("Steps magnified 12×");
    cleanup();
    const bare = render(<BrandChartFrame />);
    expect(bare.container.querySelector('[data-part="illustration"], [data-part="scale"]')).toBeNull();
  });

  it("tiles show your $100 and the floor pay-back", () => {
    const { container } = render(<BrandTiles frame={storyFrame(m, 6)} />);
    expect(container.textContent).toContain(TILE_NOW);
    expect(container.textContent).toContain(TILE_FLOOR);
    expect(container.querySelector('[data-part="tile-floor"]')?.textContent).toMatch(/^\$\d/);
  });
});
