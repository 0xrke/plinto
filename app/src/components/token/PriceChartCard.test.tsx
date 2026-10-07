import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createChartService, type ChartResponse } from "@/lib/chart/history";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchSummary } from "@/lib/data/types";
import type { PriceChartProps } from "./PriceChart";
import { PriceChartCard, localOffsetSec } from "./PriceChartCard";

// jsdom has no canvas: record what the chart was given.
const seen: PriceChartProps[] = [];
vi.mock("./PriceChart", () => ({
  PriceChart: (props: PriceChartProps) => {
    seen.push(props);
    return <div data-testid="price-chart" data-mode={props.mode} />;
  },
}));

afterEach(() => {
  cleanup();
  seen.length = 0;
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function mockLaunch(phase: LaunchSummary["phase"]): Promise<LaunchSummary> {
  return (await new MockDataSource(0).listLaunches()).find((l) => l.phase === phase)!;
}

/** Serves the chart route from the mock data source, as the real route does in mock mode. */
function serveMockRoute() {
  const service = createChartService({ source: () => new MockDataSource(0), conn: () => { throw new Error("unused"); } });
  vi.stubGlobal("fetch", async (url: string) => {
    const body = await service.getChart(url.split("/").pop()!);
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  });
}

describe("<PriceChartCard />", () => {
  it("presale: a line in USD that ends at the current price, no interval toggle", async () => {
    serveMockRoute();
    const launch = await mockLaunch("presale");
    render(<PriceChartCard launch={launch} />, { wrapper });
    const chart = await screen.findByTestId("price-chart");
    expect(chart.dataset.mode).toBe("line");
    expect(screen.queryByRole("group", { name: "Candle interval" })).toBeNull();
    const last = seen.at(-1)!;
    expect(last.line.at(-1)!.value).toBeCloseTo(launch.priceUsd, 15);
    expect(last.floorUsd).toBeNull();
    expect(screen.getByText(/since launch/)).toBeTruthy();
  });

  it("graduated with many trades: candles, a three-option interval toggle, and the floor line", async () => {
    serveMockRoute();
    const launch = await mockLaunch("graduated");
    render(<PriceChartCard launch={launch} />, { wrapper });
    expect((await screen.findByTestId("price-chart")).dataset.mode).toBe("candles");
    const group = screen.getByRole("group", { name: "Candle interval" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["15m", "1h", "1D"]);
    fireEvent.click(screen.getByRole("button", { name: "1h" }));
    const candles = seen.at(-1)!.candles;
    expect(candles[1]!.time - candles[0]!.time).toBe(3600);
    expect(screen.getByRole("button", { name: "1h" }).getAttribute("aria-pressed")).toBe("true");
    expect(seen.at(-1)!.floorUsd).toBeGreaterThan(0);
    expect(seen.at(-1)!.label).toMatch(/^Price chart: .+ now, .+ since launch, floor \$/);
    expect(screen.getByRole("link", { name: "Charts by TradingView" }).getAttribute("href")).toBe("https://www.tradingview.com/");
  });

  it("when the route fails, still draws a flat line at the current price and says history is unavailable", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 502 }));
    const launch = await mockLaunch("presale");
    render(<PriceChartCard launch={launch} />, { wrapper });
    await screen.findByTestId("price-chart", undefined, { timeout: 3000 });
    const line = seen.at(-1)!.line;
    expect(line).toHaveLength(2);
    expect(line.every((p) => p.value === launch.priceUsd)).toBe(true);
    expect(await screen.findByText("History unavailable", undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("No trades yet")).toBeNull();
  });

  it("a server body with an RPC error says history is unavailable, not 'No trades yet'", async () => {
    const launch = await mockLaunch("graduated");
    const unit = launch.quote.multiplier * launch.quote.priceUsd;
    const body: ChartResponse = {
      source: "chain",
      mint: launch.mint,
      points: [
        { t: 1_000, price: launch.priceUsd / unit, volumeQuote: 0, venue: "dbc", anchor: true },
        { t: 2_000, price: launch.priceUsd / unit, volumeQuote: 0, venue: "damm", anchor: true },
      ],
      current: { t: 2_000, price: launch.priceUsd / unit },
      partial: true,
      error: "429 Too Many Requests",
    };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
    render(<PriceChartCard launch={launch} />, { wrapper });
    await screen.findByTestId("price-chart");
    expect(screen.getByText("History unavailable")).toBeTruthy();
    expect(screen.queryByText("No trades yet")).toBeNull();
  });

  it("a chain response with no trades shows 'No trades yet' over a line at the current price", async () => {
    const launch = await mockLaunch("presale");
    const unit = launch.quote.multiplier * launch.quote.priceUsd;
    const body: ChartResponse = {
      source: "chain",
      mint: launch.mint,
      points: [
        { t: 1_000, price: launch.priceUsd / unit, volumeQuote: 0, venue: "dbc", anchor: true },
        { t: 2_000, price: launch.priceUsd / unit, volumeQuote: 0, venue: "dbc", anchor: true },
      ],
      current: { t: 2_000, price: launch.priceUsd / unit },
      partial: false,
    };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
    render(<PriceChartCard launch={launch} />, { wrapper });
    await screen.findByTestId("price-chart");
    expect(screen.getByText("No trades yet")).toBeTruthy();
    // Shifted to the viewer's wall clock.
    expect(seen.at(-1)!.line.map((p) => p.time)).toEqual([1_000 + localOffsetSec(), 2_000 + localOffsetSec()]);
    expect(seen.at(-1)!.label).toMatch(/^Price chart: \$/);
  });
});
