/**
 * README screenshots, captured headlessly from a running StockFloor app.
 *
 * The app must already be serving chain data from a local Surfpool mainnet fork that has at least
 * one graduated, cranked launch on it. Nothing here touches mainnet, and nothing is captured from a
 * loading state: every shot waits for the real numbers and throws when they do not arrive.
 *
 *   bash app/scripts/seed-fork.sh          # repo root: fork on RPC 28899, deploy, four launches
 *   cd app && export NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=http://127.0.0.1:28899 \
 *     STOCKFLOOR_RPC_URL=http://127.0.0.1:28899 STOCKFLOOR_NEXT_DIST_DIR=.next-screens
 *   pnpm build:local && pnpm exec next start -p 3288 -H 127.0.0.1 &
 *   pnpm screenshots
 *
 * The full command block, including the one-off `playwright install chromium`, is in app/README.md
 * under "Screenshots".
 *
 * Environment: STOCKFLOOR_SCREENSHOT_APP_URL (default http://127.0.0.1:3288),
 * STOCKFLOOR_SCREENSHOT_DIR (default ../docs/screenshots), STOCKFLOOR_SCREENSHOT_MINT (default: the
 * graduated launch with the largest vault).
 */
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const APP_URL = (process.env.STOCKFLOOR_SCREENSHOT_APP_URL ?? "http://127.0.0.1:3288").replace(/\/$/, "");
/** argv[1] is this file under both `tsx` (CommonJS output) and a plain `node scripts/screenshots.ts`. */
const OUT_DIR = process.env.STOCKFLOOR_SCREENSHOT_DIR
  ? resolve(process.env.STOCKFLOOR_SCREENSHOT_DIR)
  : resolve(dirname(process.argv[1] ?? "."), "..", "..", "docs", "screenshots");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 400, height: 900 };
const SCALE = 2;
const TIMEOUT = 45_000;

/** The exact sentence the graduated buy button must read. Anything else is a bug, not a screenshot. */
const BUY_LABEL = /^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: (−[\d.]+|0)%$/;
/** What the form fills in for the /create shot; nothing is submitted. */
const CREATE_FORM = {
  name: "Meridian Cycles",
  symbol: "MRDC",
  uri: "https://meridiancycles.example/token.json",
};
/** Amounts typed into the token page so both panels show real quotes instead of "—". */
const BUY_INPUT = "0.02";
const REDEEM_INPUT = "20000000";

interface LaunchJson {
  mint: string;
  name: string;
  symbol: string;
  phase: string;
  redeemable: boolean;
  vaultRaw: string;
  buyLabel: string;
}

function fail(message: string): never {
  throw new Error(message);
}

async function apiLaunches(): Promise<LaunchJson[]> {
  const res = await fetch(`${APP_URL}/api/launches`, { cache: "no-store" });
  if (!res.ok) fail(`${APP_URL}/api/launches answered ${res.status}. Is the app running against the fork?`);
  const body = (await res.json()) as { source: string; launches: LaunchJson[] };
  if (body.source !== "chain") fail(`the app serves "${body.source}" data, not chain data; rebuild with NEXT_PUBLIC_DATA_SOURCE=chain`);
  return body.launches;
}

/** The launch the token-page shots use: graduated, redeemable, biggest vault. */
function pickGraduated(launches: LaunchJson[]): LaunchJson {
  const wanted = process.env.STOCKFLOOR_SCREENSHOT_MINT;
  if (wanted) {
    const found = launches.find((l) => l.mint === wanted);
    if (!found) fail(`STOCKFLOOR_SCREENSHOT_MINT ${wanted} is not one of the ${launches.length} launches the app lists`);
    return found;
  }
  const graduated = launches
    .filter((l) => l.phase === "graduated" && l.redeemable)
    .sort((a, b) => (BigInt(b.vaultRaw) > BigInt(a.vaultRaw) ? 1 : -1));
  if (graduated.length === 0)
    fail("no graduated, redeemable launch on this fork. Seed one first (app/scripts/seed-fork.sh) — the floor meter and the redeem panel need a funded vault.");
  return graduated[0]!;
}

async function open(browser: Browser, viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: SCALE,
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  return page;
}

async function goto(page: Page, path: string): Promise<void> {
  const res = await page.goto(`${APP_URL}${path}`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  if (!res || !res.ok()) fail(`${path}: HTTP ${res ? res.status() : "no response"}`);
}

/** Wait until nothing on the page is still loading: no skeletons, no aria-busy region. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main");
      if (!main) return false;
      if (main.querySelector(".animate-pulse")) return false;
      if (main.querySelector('[aria-busy="true"]')) return false;
      return main.textContent !== null && main.textContent.trim().length > 0;
    },
    undefined,
    { timeout: TIMEOUT },
  );
  // React Query keeps polling chain state, so "idle" only ever lasts between polls.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

/**
 * Refuse to capture a page that still shows the "—" placeholder anywhere in the main content: it
 * means a number has not arrived, and a screenshot of that is worse than no screenshot.
 */
async function assertNoPlaceholders(page: Page, label: string): Promise<void> {
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  if (text.includes("—")) {
    const around = text.slice(Math.max(0, text.indexOf("—") - 70), text.indexOf("—") + 70);
    fail(`${label}: a value is still a "—" placeholder: …${around}…`);
  }
  if (/Loading|Could not load|unavailable/i.test(text)) fail(`${label}: the page reports a loading or error state`);
}

/** The app must be pointed at a local fork; these images are captioned as such. */
async function assertLocalFork(page: Page, label: string): Promise<void> {
  const badge = await page.getByTestId("network-badge").innerText();
  if (!badge.includes("Local fork")) fail(`${label}: the header says "${badge.trim()}", not "Local fork" — refusing to caption a non-fork capture as one`);
}

async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

/**
 * Jump to an in-page anchor the way a link does, and check that what it names is actually visible:
 * the header is sticky, so the anchor's own `scroll-margin-top` has to clear it (`.below-header` in
 * globals.css, sized from the height SiteHeader publishes). No offset is applied here on purpose —
 * if the app's offset is wrong, this fails instead of hiding it.
 */
async function scrollToAnchor(page: Page, anchor: string, heading: string, label: string): Promise<void> {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView(), anchor);
  await page.waitForTimeout(250);
  const clearance = await page.evaluate(
    ([headingSel]) => {
      const head = document.querySelector("header");
      const target = document.querySelector(headingSel as string);
      if (!head || !target) return null;
      return target.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
    },
    [heading],
  );
  if (clearance === null) fail(`${label}: ${anchor} or ${heading} is missing`);
  if (clearance < 0) fail(`${label}: ${heading} sits ${Math.round(-clearance)} px under the sticky header after jumping to ${anchor}`);
}

async function shot(page: Page, name: string): Promise<void> {
  // A focus ring left on the last field typed into is an artefact of the capture, not of the app.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const path = resolve(OUT_DIR, name);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  const { size } = await stat(path);
  console.log(`  ${name}  ${(size / 1024).toFixed(0)} KB`);
}

async function tokenPage(page: Page, launch: LaunchJson, label: string): Promise<void> {
  await goto(page, `/t/${launch.mint}`);
  await page.getByRole("heading", { level: 1, name: launch.name }).waitFor();
  await settled(page);
  await page.locator('figure[aria-label="Floor meter"]').waitFor();

  // Type a buy and a redemption so both panels show exact on-chain quotes rather than placeholders.
  await page.getByLabel("You pay").fill(BUY_INPUT);
  await page.getByLabel("Amount to redeem").fill(REDEEM_INPUT);

  const buyButton = page.getByRole("button", { name: BUY_LABEL });
  await buyButton.waitFor();
  const buyText = (await buyButton.innerText()).replace(/\s+/g, " ").trim();
  if (!BUY_LABEL.test(buyText)) fail(`${label}: the buy button reads "${buyText}", not the price/floor/max-loss sentence`);
  await page.getByRole("button", { name: /^Redeem for [\d.,]+ \w+$/ }).waitFor();

  await settled(page);
  await assertNoPlaceholders(page, label);
  // Typing scrolls the panels into view; the shot is of the top of the page.
  await scrollToTop(page);
  console.log(`  buy button: ${buyText}`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const launches = await apiLaunches();
  const graduated = pickGraduated(launches);
  console.log(`app ${APP_URL} · ${launches.length} launches · token page: ${graduated.name} ($${graduated.symbol}, ${graduated.mint})`);
  console.log(`out ${OUT_DIR}`);

  const browser = await chromium.launch();
  try {
    // a. the graduated token page: floor meter, exact buy label, redeem panel.
    let page = await open(browser, DESKTOP);
    await tokenPage(page, graduated, "token page");
    await assertLocalFork(page, "token page");
    await shot(page, "token-graduated.png");
    await page.context().close();

    // b. /create with the live preview panel (floor at graduation).
    page = await open(browser, DESKTOP);
    await goto(page, "/create");
    await settled(page);
    await page.getByLabel("Name").fill(CREATE_FORM.name);
    await page.getByLabel("Symbol").fill(CREATE_FORM.symbol);
    await page.getByLabel(/Token metadata JSON URL/).fill(CREATE_FORM.uri);
    await page.getByRole("heading", { name: CREATE_FORM.name }).waitFor();
    const floorPreview = page.locator("section[aria-labelledby='preview-heading']");
    await floorPreview.getByText(/^\$[\d.,e−+-]+$/).first().waitFor();
    await settled(page);
    await assertNoPlaceholders(page, "/create");
    await assertLocalFork(page, "/create");
    await scrollToTop(page);
    await shot(page, "create-preview.png");
    await page.context().close();

    // c. the launches list.
    page = await open(browser, DESKTOP);
    await goto(page, "/");
    await settled(page);
    const cards = page.locator('#launches a[href^="/t/"]');
    await cards.first().waitFor();
    if ((await cards.count()) < launches.length)
      fail(`the list shows ${await cards.count()} of ${launches.length} launches`);
    await scrollToAnchor(page, "#launches", "#launches-heading", "launches list");
    await assertNoPlaceholders(page, "launches list");
    await assertLocalFork(page, "launches list");
    await shot(page, "launches.png");
    await page.context().close();

    // d. the same token page at phone width.
    page = await open(browser, MOBILE);
    await tokenPage(page, graduated, "token page (mobile)");
    await shot(page, "token-mobile.png");
    await page.context().close();
  } finally {
    await browser.close();
  }
  console.log(`done: 4 screenshots in ${OUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(`screenshots failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
