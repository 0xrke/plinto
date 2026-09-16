import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FloorMeter } from "./FloorMeter";

afterEach(cleanup);

const MINUS = "−";

describe("<FloorMeter />", () => {
  it("exposes price, floor and max loss in its accessible description", () => {
    render(<FloorMeter priceUsd={0.0000012} floorUsd={0.0000001} maxLoss={1 - 1 / 12} />);
    expect(
      screen.getByRole("img", {
        name: `Price $0.0000012, floor $0.0000001, max loss at the current price ${MINUS}91.7%`,
      }),
    ).toBeTruthy();
  });

  it("shows the floor, the loss band and the price multiple", () => {
    render(<FloorMeter priceUsd={12} floorUsd={1} maxLoss={11 / 12} />);
    expect(screen.getByText("$12.00")).toBeTruthy();
    expect(screen.getByText("$1.00")).toBeTruthy();
    expect(screen.getByText(`${MINUS}91.7%`)).toBeTruthy();
    expect(screen.getByText("Price is 12× the floor")).toBeTruthy();
  });

  it("explains when the price is below the floor", () => {
    render(<FloorMeter priceUsd={0.9} floorUsd={1} maxLoss={0} />);
    expect(screen.getByText(/Price is below the floor/)).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("renders a compact variant without labels", () => {
    const { container } = render(<FloorMeter priceUsd={2} floorUsd={1} maxLoss={0.5} compact />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("floor $1.00");
    expect(container.textContent).toBe("");
  });
});
