import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

  it("describes the fee model: vault share 30 to 60%, the graduation cuts and the pool fee split", () => {
    renderHome();
    const steps = screen.getByRole("list", { name: "How it works" });
    expect(steps.textContent).toMatch(/vault share is 30 to 60% of the raise \(default 50%\)/);
    expect(steps.textContent).not.toMatch(/30 to 70%/);
    expect(steps.textContent).toMatch(/platform 5% and the creator 5%/);
    expect(steps.textContent).toMatch(/30% of the locked pool's trading fees/);
    expect(steps.textContent).not.toMatch(/Trading fees from the locked pool also go to the vault/);
  });

  it("lists only the live floors in the rail", async () => {
    renderHome();
    const rail = await screen.findByRole("region", { name: "Top floors" });
    const launches = await new MockDataSource(0).listLaunches();
    const live = launches.filter((l) => l.phase === "graduated" && l.migrationFeeHarvested);
    const tokenRows = () =>
      within(rail)
        .getAllByRole("link")
        .filter((r) => r.getAttribute("href")?.startsWith("/app/t/"));
    await waitFor(() => expect(tokenRows().length).toBeGreaterThanOrEqual(live.length));
    expect(new Set(tokenRows().map((r) => r.getAttribute("href")))).toEqual(new Set(live.map((l) => `/app/t/${l.mint}`)));
    // Only live floors: no presale estimates or "waiting for migration" rows.
    expect(rail.textContent).not.toMatch(/est\. at graduation|Waiting for/);
  });

  it("has one call to action and states the honest qualifier once in the hero", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: /Token launches with a stock-backed floor/ });
    const links = within(hero).getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual(["Launch a token"]);
    expect(links[0]!.getAttribute("href")).toBe("/app/create");
    expect(within(hero).getByText("The floor protects from zero, not from loss.")).toBeTruthy();
    // The cut blocks stay cut.
    expect(screen.queryByRole("region", { name: "Launches by phase" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Featured floor" })).toBeNull();
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
