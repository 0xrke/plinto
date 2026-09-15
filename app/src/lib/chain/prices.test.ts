import { describe, expect, it, vi } from "vitest";
import { USDC_MINT, WSOL_MINT } from "@stockfloor/sdk";
import { JupiterPriceProvider, PRICED_MINTS, REFERENCE_PRICES_USD } from "./prices";

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

function jupiterFetch(body: Record<string, unknown>, ok = true) {
  return vi.fn(async (_url: string) => ({ ok, status: ok ? 200 : 503, json: async () => body, text: async () => "" }));
}

describe("REFERENCE_PRICES_USD", () => {
  it("prices every mint the app prices, with plausible values", () => {
    for (const mint of PRICED_MINTS) expect(REFERENCE_PRICES_USD[mint]).toBeGreaterThan(0);
    // Spot checks against the dated Jupiter Price V3 read (2026-09-15 22:45 UTC).
    expect(REFERENCE_PRICES_USD[SPYX]).toBeCloseTo(758.0, 0);
    expect(REFERENCE_PRICES_USD[WSOL_MINT]).toBeCloseTo(96.87, 1);
  });
});

describe("JupiterPriceProvider", () => {
  it("requests every priced mint in one Price V3 call and caches the result", async () => {
    const fetch = jupiterFetch({ [SPYX]: { usdPrice: 760.5 }, [USDC_MINT]: { usdPrice: 0.9999 }, [WSOL_MINT]: { usdPrice: 215 } });
    let now = 1_000_000;
    const provider = new JupiterPriceProvider({ fetch, now: () => now, ttlMs: 30_000 });

    const a = await provider.getUsdPrices([SPYX, USDC_MINT]);
    expect(a[SPYX]).toEqual({ usd: 760.5, source: "jupiter", at: 1_000_000 });
    expect(a[USDC_MINT]!.usd).toBe(0.9999);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe("https://lite-api.jup.ag/price/v3");
    expect(decodeURIComponent(url.searchParams.get("ids")!).split(",")).toEqual(PRICED_MINTS);

    // Mints Jupiter did not price fall back to the dated reference table.
    const gldx = "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re";
    expect((await provider.getUsdPrices([gldx]))[gldx]).toMatchObject({ usd: REFERENCE_PRICES_USD[gldx], source: "reference" });
    expect(fetch).toHaveBeenCalledTimes(1);

    now += 31_000;
    await provider.getUsdPrices([SPYX]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves the last good prices, or reference prices, when Jupiter fails", async () => {
    let fail = false;
    const fetch = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return { ok: true, status: 200, json: async () => ({ [SPYX]: { usdPrice: 761 } }), text: async () => "" };
    });
    let now = 0;
    const provider = new JupiterPriceProvider({ fetch, now: () => now, ttlMs: 10 });
    expect((await provider.getUsdPrices([SPYX]))[SPYX]!.usd).toBe(761);
    fail = true;
    now = 100;
    expect((await provider.getUsdPrices([SPYX]))[SPYX]).toMatchObject({ usd: 761, source: "jupiter" });

    // Older than five minutes, the last good prices are labelled stale (the create form refuses them
    // outside local clusters); reference entries keep their label.
    now = 5 * 60_000 + 1;
    const gldx = "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re";
    const stale = await provider.getUsdPrices([SPYX, gldx]);
    expect(stale[SPYX]).toEqual({ usd: 761, source: "stale", at: 0 });
    expect(stale[gldx]).toMatchObject({ source: "reference" });
    // Jupiter recovers: live again.
    fail = false;
    expect((await provider.getUsdPrices([SPYX]))[SPYX]).toEqual({ usd: 761, source: "jupiter", at: now });

    const cold = new JupiterPriceProvider({ fetch: jupiterFetch({}, false) });
    expect((await cold.getUsdPrices([SPYX]))[SPYX]).toMatchObject({ usd: REFERENCE_PRICES_USD[SPYX], source: "reference" });
  });
});
