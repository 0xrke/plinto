import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StubLaunchActions } from "@/lib/data/actions";
import { DataProvider } from "@/lib/data/context";
import { MockDataSource } from "@/lib/data/mock";
import HomePage from "./page";

afterEach(cleanup);

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataProvider dataSource={new MockDataSource(0)} actions={new StubLaunchActions(0)}>
        {children}
      </DataProvider>
    </QueryClientProvider>
  );
  return render(<HomePage />, { wrapper: Wrapper });
}

describe("home page", () => {
  it("leads with the path the demo actually takes, not with Jupiter routing", () => {
    renderHome();
    const steps = screen.getByRole("list", { name: "How it works" });
    const first = within(steps).getAllByRole("listitem")[0]!;
    expect(first.textContent).toMatch(/pay in a tokenized stock such as SPYx, straight into the curve/);
    // Routing USDC or SOL through Jupiter is a mainnet-only convenience, so it is not the promise
    // the page opens with (it has never run against the live Ultra API).
    expect(first.textContent).toMatch(/On mainnet, USDC and SOL can be routed/);
    expect(first.textContent).not.toMatch(/^Buyers pay USDC or SOL/);
  });

  it("does not claim a fixed raise size now that the creator sets the threshold", () => {
    renderHome();
    const steps = screen.getByRole("list", { name: "How it works" });
    expect(steps.textContent).not.toMatch(/threshold of about \$1,000/);
    expect(steps.textContent).toMatch(/graduation threshold the creator set/);
  });

  it("features the graduated launch with the largest vault and counts launches by phase", async () => {
    renderHome();
    const featured = await screen.findByRole("region", { name: "Featured floor" });
    const launches = await new MockDataSource(0).listLaunches();
    const live = launches.filter((l) => l.phase === "graduated" && l.migrationFeeHarvested);
    const biggest = live.reduce((a, b) =>
      a.quote.priceUsd * Number(a.vaultRaw) / 10 ** a.quote.asset.decimals >=
      b.quote.priceUsd * Number(b.vaultRaw) / 10 ** b.quote.asset.decimals
        ? a
        : b,
    );
    expect(await within(featured).findByText(biggest.name)).toBeTruthy();
    expect(within(featured).getByText(`$${biggest.symbol} vault · Floor live`)).toBeTruthy();
    expect(within(featured).getByRole("link", { name: `Buy $${biggest.symbol} on its token page` }).getAttribute("href")).toBe(
      `/t/${biggest.mint}`,
    );
    const phases = screen.getByRole("region", { name: "Launches by phase" });
    expect(within(phases).getByText("Floor live").previousElementSibling?.textContent).toContain(String(live.length));
  });

  it("keeps the honest headline qualifier", () => {
    renderHome();
    expect(screen.getByText(/The floor protects from zero, not from loss/).textContent).toMatch(
      /fixed amount per token, so buying far above it can\s+lose most of the purchase/,
    );
  });

  it("orders the launch grid with live floors first", async () => {
    renderHome();
    const grid = await screen.findByRole("region", { name: "Launches" });
    const titles = (await within(grid).findAllByRole("heading", { level: 3 })).map((h) => h.textContent?.trim());
    const launches = await new MockDataSource(0).listLaunches();
    const live = launches.filter((l) => l.phase === "graduated" && l.migrationFeeHarvested).map((l) => l.name);
    expect(new Set(titles.slice(0, live.length))).toEqual(new Set(live));
  });
});
