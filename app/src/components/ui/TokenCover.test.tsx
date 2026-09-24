import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenCover, coverToneFor } from "./TokenCover";

describe("TokenCover", () => {
  it("builds the cover from the token's own logo, blurred and hidden from assistive tech", () => {
    const { container } = render(<TokenCover symbol="HRBR" imageUrl="https://example.com/logo.png" />);
    const cover = container.firstElementChild as HTMLElement;
    expect(cover.getAttribute("aria-hidden")).toBe("true");
    const img = cover.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/logo.png");
    expect(img!.getAttribute("alt")).toBe("");
    expect(img!.className).toContain("blur");
  });

  it("falls back to a tone picked from the symbol when there is no logo", () => {
    const { container } = render(<TokenCover symbol="TIDE" imageUrl={null} />);
    const cover = container.firstElementChild as HTMLElement;
    expect(cover.querySelector("img")).toBeNull();
    expect(cover.getAttribute("data-cover")).toBe("fallback");
    expect(cover.style.backgroundImage).toContain("linear-gradient");
  });

  it("picks the same fallback tone for the same symbol", () => {
    expect(coverToneFor("TIDE")).toEqual(coverToneFor("TIDE"));
  });

  it("passes a className through to the cover box", () => {
    const { container } = render(<TokenCover symbol="HRBR" imageUrl={null} className="h-20" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("h-20");
  });
});
