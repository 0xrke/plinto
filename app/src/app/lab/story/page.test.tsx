import { afterEach, describe, expect, it, vi } from "vitest";
import { labEnabled } from "@/components/landing/variants/gate";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: StoryLabIndex } = await import("./page");
const { default: StoryVariantPage, generateMetadata } = await import("./[variant]/page");

const params = (variant: string) => ({ params: Promise.resolve({ variant }) });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("story lab gate", () => {
  it("is on outside production, and in production only with STOCKFLOOR_LAB=1", () => {
    expect(labEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(labEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(labEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(labEnabled({ NODE_ENV: "production", STOCKFLOOR_LAB: "0" })).toBe(false);
    expect(labEnabled({ NODE_ENV: "production", STOCKFLOOR_LAB: "1" })).toBe(true);
  });

  it("404s both routes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCKFLOOR_LAB", "");
    expect(() => StoryLabIndex()).toThrow("NEXT_NOT_FOUND");
    await expect(StoryVariantPage(params("1"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders in production with STOCKFLOOR_LAB=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCKFLOOR_LAB", "1");
    expect(StoryLabIndex()).toBeTruthy();
    expect(await StoryVariantPage(params("1"))).toBeTruthy();
  });

  it("renders in development by number or slug, and 404s an unknown variant", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await StoryVariantPage(params("3"))).toBeTruthy();
    expect(await StoryVariantPage(params("cinematic"))).toBeTruthy();
    expect(await StoryVariantPage(params("11"))).toBeTruthy();
    expect(await StoryVariantPage(params("playful-site"))).toBeTruthy();
    expect(await StoryVariantPage(params("21"))).toBeTruthy();
    await expect(StoryVariantPage(params("37"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(StoryVariantPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("asks robots not to index", async () => {
    const { metadata } = await import("./page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect((await generateMetadata(params("2"))).robots).toEqual({ index: false, follow: false });
  });
});
