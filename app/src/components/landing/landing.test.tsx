import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchDataSource, LaunchSummary } from "@/lib/data/types";
import { launchFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { launchStatus } from "@/components/launch/status";
import { FIRST_VAULT_URL } from "@/lib/landing/routes";
import { ClosingCta } from "./ClosingCta";
import { Hero } from "./Hero";
import { Landing } from "./Landing";
import { LiveFloorsView } from "./LiveFloors";
import { loadLiveFloors, pickLiveFloors } from "./liveFloorsData";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { BEAT_KEYS } from "@/lib/landing/sim/story";
import { LabSection } from "./lab/LabSection";
import { ILLUSTRATION, storyChartStrings } from "./lab/storyChartCopy";
import { STORY_FOOTNOTE, STORY_HONESTY, beatCaption, beatSrText, railLabel } from "./lab/storyCopy";
import { TopBar } from "./TopBar";

const OVERCLAIM = /guarantee|risk-free|can.?t lose|cannot lose|profit|\bsafe\b|protected/i;

/** The story's scroll driver reads IntersectionObserver and matchMedia; jsdom has neither. Never in view here. */
class NeverInView {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NeverInView);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Words a sighted reader sees: text outside sr-only and aria-hidden nodes. */
function visibleWords(root: Element): number {
  const clone = root.cloneNode(true) as Element;
  for (const el of clone.querySelectorAll(".sr-only, [aria-hidden='true'], script, style")) el.remove();
  return (clone.textContent ?? "").split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w)).length;
}

const mockLaunches = () => new MockDataSource(0).listLaunches();

/** A data source stub that reports itself as the chain. */
function chainStub(listLaunches: () => Promise<LaunchSummary[]>): LaunchDataSource {
  return { kind: "chain", listLaunches } as unknown as LaunchDataSource;
}

async function liveLaunch(): Promise<LaunchSummary> {
  return (await mockLaunches()).find((l) => launchStatus(l) === "floor-live")!;
}

describe("pickLiveFloors", () => {
  it("keeps only live floors, largest vault first", async () => {
    const all = await mockLaunches();
    const picked = pickLiveFloors(all);
    expect(picked.length).toBeGreaterThan(0);
    for (const l of picked) expect(launchStatus(l)).toBe("floor-live");
    const vaults = picked.map((l) => quoteRawToUsd(l.vaultRaw, l.quote));
    expect(vaults).toEqual([...vaults].sort((a, b) => b - a));
  });

  it("caps the list at three", async () => {
    const base = await liveLaunch();
    const many = [1n, 2n, 3n, 4n, 5n].map((k, i) => ({ ...base, mint: `m${i}`, vaultRaw: base.vaultRaw * k }));
    const picked = pickLiveFloors(many);
    expect(picked.map((l) => l.mint)).toEqual(["m4", "m3", "m2"]);
  });

  it("drops zero and non-finite floors", async () => {
    const base = await liveLaunch();
    const zero = { ...base, mint: "zero", vaultRaw: 0n };
    const nan = { ...base, mint: "nan", quote: { ...base.quote, priceUsd: Number.NaN } };
    expect(Number.isNaN(launchFloorUsd(nan))).toBe(true);
    expect(pickLiveFloors([zero, nan, base]).map((l) => l.mint)).toEqual([base.mint]);
  });
});

describe("loadLiveFloors", () => {
  it("never shows mock data as live", async () => {
    expect(await loadLiveFloors(new MockDataSource(0))).toBeNull();
  });

  it("falls back on an RPC error", async () => {
    expect(await loadLiveFloors(chainStub(() => Promise.reject(new Error("rpc down"))))).toBeNull();
  });

  it("falls back when the RPC never answers", async () => {
    expect(await loadLiveFloors(chainStub(() => new Promise(() => {})), 10)).toBeNull();
  });

  it("picks the live floors from the chain", async () => {
    const all = await mockLaunches();
    expect(await loadLiveFloors(chainStub(async () => all))).toEqual(pickLiveFloors(all));
  });
});

describe("<LiveFloorsView />", () => {
  for (const launches of [null, []]) {
    it(`shows the first mainnet vault with ${launches === null ? "no data" : "no live floors"}`, () => {
      render(<LiveFloorsView launches={launches} />);
      // No live cards, so the heading does not promise them.
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Live on Solana mainnet");
      expect(screen.getByText("First launch ran on Sept 16, 2026.")).toBeTruthy();
      const link = screen.getByRole("link", { name: /See the first vault/ });
      expect(link.getAttribute("href")).toBe(
        "https://solscan.io/account/8Y6vZa3zJJNFjvADg3pEGeDAUg6WcufECWohvzmEDmZr",
      );
      expect(link.getAttribute("href")).toBe(FIRST_VAULT_URL);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
      expect(link.textContent).toMatch(/opens in new tab/);
    });
  }

  it("links each live launch to its token page", async () => {
    const picked = pickLiveFloors(await mockLaunches());
    render(<LiveFloorsView launches={picked} />);
    const section = screen.getByRole("region", { name: "Floors live now" });
    expect(within(section).getAllByRole("article")).toHaveLength(picked.length);
    for (const l of picked) {
      expect(within(section).getByRole("link", { name: l.name }).getAttribute("href")).toBe(`/app/t/${l.mint}`);
    }
    expect(within(section).getByRole("link", { name: /All launches/ }).getAttribute("href")).toBe("/app");
    expect(screen.queryByText(/See the first vault/)).toBeNull();
  });
});

describe("landing sections", () => {
  it("hero: one claim, links to the app and to create", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Token launches with a floor");
    expect(screen.getByRole("link", { name: "Open app" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: "Launch a token" }).getAttribute("href")).toBe("/app/create");
    expect(screen.getByText("The floor protects from zero, not from loss.")).toBeTruthy();
  });

  it("top bar: logo to the landing, button to the app", () => {
    render(<TopBar />);
    expect(screen.getByRole("link", { name: "Plinto" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Open app" }).getAttribute("href")).toBe("/app");
  });

  it("floor lab: the server renders the story's finished frame", () => {
    const html = renderToString(<LabSection />);
    expect(html).toContain("Redeem now: $36.87 back, not zero.");
    expect(html).toContain(STORY_HONESTY);
    // Text only: SVG path data is full of numbers.
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/64\.4|65%/);
    // No sandbox on the page any more: the floor-share chip is a plain label at the default share.
    const { container } = render(<LabSection />);
    expect(container.querySelector("#follow-your-100 a[href^='#']")).toBeNull();
    expect(container.querySelector("#follow-your-100")!.textContent).toContain("Floor share 50%");
  });

  it("closing call to action links to the app and to create", () => {
    render(<ClosingCta />);
    expect(screen.getByRole("link", { name: "Open app" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: "Launch a token" }).getAttribute("href")).toBe("/app/create");
  });

  it("never overclaims, in any caption or label", async () => {
    const { container } = render(await Landing({ source: new MockDataSource(0) }));
    const texts = [container.textContent ?? ""];
    for (const el of container.querySelectorAll("[aria-label], [aria-valuetext]")) {
      texts.push(el.getAttribute("aria-label") ?? "", el.getAttribute("aria-valuetext") ?? "");
    }
    const k = simConstantsFromSdk();
    for (let v = k.vaultShareMinPct; v <= k.vaultShareMaxPct; v++) {
      const m = launchMath(k, v);
      for (const key of BEAT_KEYS) texts.push(beatCaption(m, key), beatSrText(m, key));
      texts.push(...storyChartStrings(m));
    }
    texts.push(ILLUSTRATION, STORY_FOOTNOTE, ...BEAT_KEYS.map((_, i) => railLabel(i)));
    for (const t of texts) expect(t.replace("The floor protects from zero, not from loss.", "")).not.toMatch(OVERCLAIM);
  });

  it("keeps the copy short: at most 220 visible words with the lab rendered", async () => {
    const { container } = render(await Landing({ source: new MockDataSource(0) }));
    const words = visibleWords(container.querySelector("main")!);
    expect(words).toBeLessThanOrEqual(220);
  });
});

describe("<Landing />", () => {
  it("renders one h1, a labelled section per h2 and the skip-link target", async () => {
    const { container } = render(await Landing({ source: new MockDataSource(0) }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const main = container.querySelector("main#main");
    expect(main).not.toBeNull();
    const sections = main!.querySelectorAll("section");
    expect(sections).toHaveLength(4);
    expect([...main!.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "Follow your $100",
      "Live on Solana mainnet",
      "See your max loss before you buy.",
    ]);
    for (const s of sections) {
      const id = s.getAttribute("aria-labelledby");
      expect(id && container.querySelector(`#${id}`)).toBeTruthy();
    }
    // Mock data is never shown as live: the fallback card renders instead.
    expect(screen.getByText(/See the first vault/)).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    // No link points at a route from before the app moved under /app.
    for (const a of container.querySelectorAll("a[href^='/']")) {
      expect(a.getAttribute("href")).toMatch(/^\/($|app(\/|$|#))/);
    }
  });
});
