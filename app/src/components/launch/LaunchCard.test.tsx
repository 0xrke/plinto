import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MockDataSource } from "@/lib/data/mock";
import { formatUsd } from "@/lib/format";
import { LaunchCard } from "./LaunchCard";

afterEach(cleanup);

const MINUS = "−";

describe("<LaunchCard />", () => {
  it("renders a graduated launch with price, floor and max loss", async () => {
    const launches = await new MockDataSource(0).listLaunches();
    const harbor = launches.find((l) => l.symbol === "HRBR")!;
    render(<LaunchCard launch={harbor} />);

    const link = screen.getByRole("link", { name: "Harbor Coffee Co-op" });
    expect(link.getAttribute("href")).toBe(`/t/${harbor.mint}`);
    expect(screen.getByText("Floor live")).toBeTruthy();
    expect(screen.getByText("$0.00000633")).toBeTruthy();
    expect(screen.getByText("$0.000000528")).toBeTruthy();
    expect(screen.getByText(`${MINUS}91.7%`)).toBeTruthy();
    expect(within(screen.getByRole("article")).getByText("SPYx")).toBeTruthy();
  });

  it("keeps a graduated launch labelled Graduated until the migration fee reaches the vault", async () => {
    const launches = await new MockDataSource(0).listLaunches();
    const pending = { ...launches.find((l) => l.symbol === "HRBR")!, migrationFeeHarvested: false, vaultRaw: 0n };
    render(<LaunchCard launch={pending} />);
    expect(screen.getByText("Graduated")).toBeTruthy();
    expect(screen.queryByText("Floor live")).toBeNull();
    expect(screen.getByText(/No floor until the migration fee reaches the vault/)).toBeTruthy();
  });

  it("renders a presale launch with progress toward graduation", async () => {
    const launches = await new MockDataSource(0).listLaunches();
    const tide = launches.find((l) => l.symbol === "TIDE")!;
    render(<LaunchCard launch={tide} />);

    expect(screen.getByText("Presale")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
    expect(screen.getByText("62%")).toBeTruthy();
    expect(screen.getByText("Floor at graduation (est.)")).toBeTruthy();
    expect(screen.queryByText(/Max loss/)).toBeNull();
    // The floor per $100 at listing sits next to the vault share.
    expect(screen.getByRole("article").textContent).toContain(
      `Vault share 50% (floor ${formatUsd(tide.floorPer100AtListingUsd!)} per $100 at listing).`,
    );
  });

  it("never shows an incomplete curve as 100% complete", () => {
    const tide = { quoteReserveRaw: 996n, thresholdQuoteRaw: 1000n };
    return new MockDataSource(0).listLaunches().then((launches) => {
      const presale = { ...launches.find((l) => l.symbol === "TIDE")!, ...tide };
      render(<LaunchCard launch={presale} />);
      expect(screen.getByText("99%")).toBeTruthy();
      expect(screen.queryByText("100%")).toBeNull();
      expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("99");
    });
  });

  it("renders every mock launch without errors", async () => {
    const launches = await new MockDataSource(0).listLaunches();
    expect(launches).toHaveLength(4);
    for (const launch of launches) {
      const { unmount } = render(<LaunchCard launch={launch} />);
      expect(screen.getByRole("heading", { name: launch.name })).toBeTruthy();
      unmount();
    }
  });
});
