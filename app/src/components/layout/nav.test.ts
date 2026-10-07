import { describe, expect, it } from "vitest";
import { NAV, SECONDARY_NAV, activeNav } from "./nav";

describe("activeNav", () => {
  it("marks the launch list and token pages as Launches", () => {
    expect(activeNav("/app")).toBe("launches");
    expect(activeNav("/app/t/So11111111111111111111111111111111111111112")).toBe("launches");
  });

  it("marks the create page as Create", () => {
    expect(activeNav("/app/create")).toBe("create");
    expect(activeNav("/app/create/x")).toBe("create");
  });

  it("marks nothing on the landing page and other routes", () => {
    expect(activeNav("/")).toBeNull();
    expect(activeNav("/waitlist")).toBeNull();
    expect(activeNav("/application")).toBeNull();
    expect(activeNav("/t/x")).toBeNull();
    expect(activeNav(null)).toBeNull();
  });

  it("points every item under /app", () => {
    expect(NAV.map((item) => item.href)).toEqual(["/app", "/app/create"]);
    expect(SECONDARY_NAV.howItWorks.href).toBe("/app#how-it-works");
  });
});
