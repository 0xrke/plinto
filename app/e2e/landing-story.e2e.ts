// @vitest-environment node
/**
 * Real-browser geometry of the scroll-driven "Follow your $100" story (jsdom cannot check sticky
 * layout). Needs a running app (any data source):
 *
 *   STOCKFLOOR_NEXT_DIST_DIR=.next-story NEXT_PUBLIC_DATA_SOURCE=mock pnpm exec next dev -p 3150 &
 *   STOCKFLOOR_E2E_APP_URL=http://127.0.0.1:3150 pnpm exec vitest run --config vitest.e2e.config.mts e2e/landing-story.e2e.ts
 *
 * At a phone (390×844), a landscape phone (844×390) and a desktop (1280×800) it scrolls every step
 * to q = 0.4 and q = 0.85 and checks that the active caption is inside the viewport and clear of
 * the sticky stage, that the stage is still pinned when the last beat finishes (q = 0.75), that the
 * last caption never slides under a pinned stage, and that Tab never lands under the stage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

const APP = (process.env.STOCKFLOOR_E2E_APP_URL ?? "http://127.0.0.1:3150").replace(/\/$/, "");
const WIDE_QUERY = "(min-width: 1024px), (orientation: landscape) and (max-height: 500px)";

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

async function open(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#follow-your-100 [data-stage]");
  return page;
}

/** Scroll so step i sits at progress q (instant), then wait two frames for the driver. */
async function scrollStep(page: Page, i: number, q: number): Promise<void> {
  await page.evaluate(
    ([i, q, wideQuery]) => {
      const root = document.getElementById("follow-your-100")!;
      const step = root.querySelectorAll<HTMLElement>("[data-step]")[i as number]!;
      const stage = root.querySelector<HTMLElement>("[data-stage]")!;
      const vh = window.innerHeight;
      const line = window.matchMedia(wideQuery as string).matches ? 0.5 * vh : stage.offsetHeight + 0.4 * (vh - stage.offsetHeight);
      const r = step.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top + (q as number) * r.height - line);
    },
    [i, q, WIDE_QUERY] as const,
  );
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
}

async function measure(page: Page, i: number) {
  return page.evaluate((i) => {
    const root = document.getElementById("follow-your-100")!;
    const stage = root.querySelector<HTMLElement>("[data-stage]")!;
    const step = root.querySelectorAll<HTMLElement>("[data-step]")[i]!;
    const card = step.firstElementChild as HTMLElement;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      vh: window.innerHeight,
      stage: box(stage),
      stickyTop: parseFloat(getComputedStyle(stage).top),
      card: box(card),
      active: step.dataset.active,
      current: root.querySelector('[aria-current="step"]')?.getAttribute("aria-label") ?? null,
    };
  }, i);
}

const overlapsX = (a: Box, b: Box) => a.left < b.right && a.right > b.left;

/** The caption is fully inside the viewport and not covered by the stage. */
function expectReadable(m: Awaited<ReturnType<typeof measure>>, label: string) {
  expect(m.card.top, `${label}: card top in view`).toBeGreaterThanOrEqual(-0.5);
  expect(m.card.bottom, `${label}: card bottom in view`).toBeLessThanOrEqual(m.vh + 0.5);
  if (overlapsX(m.card, m.stage)) expect(m.card.top, `${label}: card below the stage`).toBeGreaterThanOrEqual(m.stage.bottom - 0.5);
}

const VIEWPORTS: Array<[string, number, number]> = [
  ["phone 390×844", 390, 844],
  ["landscape phone 844×390", 844, 390],
  ["desktop 1280×800", 1280, 800],
];

describe.each(VIEWPORTS)("story at %s", (_name, width, height) => {
  it("keeps the active caption readable at every step and marks it active", async () => {
    const page = await open(width, height);
    try {
      for (let i = 0; i < 8; i++) {
        for (const q of [0.4, 0.85]) {
          await scrollStep(page, i, q);
          const m = await measure(page, i);
          expect(m.active, `step ${i} q ${q} active`).toBe("true");
          expect(m.current, `step ${i} q ${q} rail`).toMatch(new RegExp(`^Step ${i + 1} of 8`));
          expectReadable(m, `step ${i} q ${q}`);
        }
      }
    } finally {
      await page.close();
    }
  });

  it("finishes the last beat while the stage is pinned, and never hides the last caption under it", async () => {
    const page = await open(width, height);
    try {
      await scrollStep(page, 7, 0.75);
      const at75 = await measure(page, 7);
      expect(Math.abs(at75.stage.top - at75.stickyTop), "stage pinned at q = 0.75").toBeLessThan(1);
      // Walk past the end in 10px steps: while the stage is pinned, the last card stays readable.
      for (let k = 0; k < 120; k++) {
        await page.evaluate(() => window.scrollBy(0, 10));
        await page.evaluate(() => new Promise((res) => requestAnimationFrame(res)));
        const m = await measure(page, 7);
        if (Math.abs(m.stage.top - m.stickyTop) >= 1) break; // unpinned: the stage scrolls away
        expectReadable(m, `tail +${(k + 1) * 10}px`);
      }
    } finally {
      await page.close();
    }
  });

  it("never lands Tab focus under the sticky stage", async () => {
    const page = await open(width, height);
    try {
      await scrollStep(page, 3, 0.5);
      await page.focus("#follow-your-100 h2 + a");
      for (let k = 0; k < 12; k++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const root = document.getElementById("follow-your-100")!;
          const stage = root.querySelector<HTMLElement>("[data-stage]")!;
          if (!el || !root.contains(el) || stage.contains(el)) return null;
          const a = el.getBoundingClientRect();
          const s = stage.getBoundingClientRect();
          return { covered: a.left < s.right && a.right > s.left && a.top < s.bottom && a.bottom > s.top };
        });
        if (r) expect(r.covered).toBe(false);
      }
    } finally {
      await page.close();
    }
  });
});
