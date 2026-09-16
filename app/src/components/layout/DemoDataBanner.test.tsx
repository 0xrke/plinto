import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StubLaunchActions } from "@/lib/data/actions";
import { DataProvider } from "@/lib/data/context";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchDataSource } from "@/lib/data/types";
import { LaunchList } from "@/components/launch/LaunchList";

afterEach(cleanup);

function renderList(dataSource: LaunchDataSource) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataProvider dataSource={dataSource} actions={new StubLaunchActions(0)}>
        {children}
      </DataProvider>
    </QueryClientProvider>
  );
  return render(<LaunchList />, { wrapper: Wrapper });
}

const chainSource: LaunchDataSource = {
  ...new MockDataSource(0),
  kind: "chain",
  listLaunches: async () => [],
} as unknown as LaunchDataSource;

describe("demo-data banner above the launch list", () => {
  it("says the launches are made up when the app runs on demo data", async () => {
    renderList(new MockDataSource(0));
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("Preview with example launches.");
    expect(banner.textContent).toMatch(/made up/);
    expect(banner.textContent).toMatch(/buying, redeeming and the crank are switched off/);
  });

  it("can be dismissed", async () => {
    renderList(new MockDataSource(0));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never appears on chain data", async () => {
    renderList(chainSource);
    await screen.findByRole("heading", { name: "Launches" });
    expect(screen.queryByText(/Preview with example launches/)).toBeNull();
  });
});
