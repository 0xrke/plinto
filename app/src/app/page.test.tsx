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

  it("keeps the honest headline qualifier", () => {
    renderHome();
    expect(screen.getByText(/The floor protects from zero, not from loss/)).toBeTruthy();
  });
});
