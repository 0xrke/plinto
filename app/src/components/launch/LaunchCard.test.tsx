import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MockDataSource } from "@/lib/data/mock";
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
    expect(screen.getByText("Graduated")).toBeTruthy();
    expect(screen.getByText("$0.00000633")).toBeTruthy();
    expect(screen.getByText("$0.000000528")).toBeTruthy();
    expect(screen.getByText(`${MINUS}91.7%`)).toBeTruthy();
    expect(within(screen.getByRole("article")).getByText("SPYx")).toBeTruthy();
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
