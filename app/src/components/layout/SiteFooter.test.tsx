import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { STOCKFLOOR_PROGRAM_ID } from "@stockfloor/sdk";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The footer reads the repository URL at module load, so each case imports it fresh. */
async function renderFooter(repoUrl?: string) {
  vi.resetModules();
  if (repoUrl === undefined) vi.stubEnv("NEXT_PUBLIC_REPO_URL", "");
  else vi.stubEnv("NEXT_PUBLIC_REPO_URL", repoUrl);
  const { SiteFooter } = await import("./SiteFooter");
  return render(<SiteFooter />);
}

describe("<SiteFooter />", () => {
  it("always links the deployed program on an explorer", async () => {
    await renderFooter();
    const program = screen.getByRole("link", { name: "stockfloor program" });
    expect(program.getAttribute("href")).toContain(STOCKFLOOR_PROGRAM_ID.toBase58());
    // Nothing invented: with no repository configured there are no dead source links.
    expect(screen.queryByRole("link", { name: "Source code" })).toBeNull();
  });

  it("links the code, the architecture and the security model when a repository is configured", async () => {
    await renderFooter("https://github.com/example/stockfloor");
    expect(screen.getByRole("link", { name: "Source code" }).getAttribute("href")).toBe("https://github.com/example/stockfloor");
    expect(screen.getByRole("link", { name: "Architecture" }).getAttribute("href")).toBe(
      "https://github.com/example/stockfloor/blob/main/docs/architecture.md",
    );
    expect(screen.getByRole("link", { name: "Security model" }).getAttribute("href")).toBe(
      "https://github.com/example/stockfloor/blob/main/README.md#security",
    );
  });

  it("ignores a repository URL that is not https", async () => {
    await renderFooter("javascript:alert(1)");
    expect(screen.queryByRole("link", { name: "Source code" })).toBeNull();
  });

  it("keeps the disclaimers", async () => {
    await renderFooter();
    expect(screen.getByText(/unaudited hackathon code/)).toBeTruthy();
    expect(screen.getByText(/Not available to US persons/)).toBeTruthy();
    expect(screen.getByText(/protects holders from a price of zero, not from loss/)).toBeTruthy();
  });
});
