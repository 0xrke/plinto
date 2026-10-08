import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VARIANT_LOADERS } from "./loaders";
import { VARIANTS, findVariant, neighbours, variantDir } from "./registry";

// Vitest runs from app/ (jsdom gives import.meta.url a non-file scheme).
const dir = `${resolve(process.cwd(), "src/components/landing/variants")}/`;

describe("variant registry", () => {
  it("has ten variants numbered 1..10 with unique slugs", () => {
    expect(VARIANTS).toHaveLength(10);
    expect(VARIANTS.map((v) => v.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(VARIANTS.map((v) => v.slug)).size).toBe(10);
    for (const v of VARIANTS) {
      expect(v.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(0);
    }
  });

  it("has a Variant.tsx with a default export for every slug, and one loader per slug", () => {
    expect(Object.keys(VARIANT_LOADERS).sort()).toEqual(VARIANTS.map((v) => v.slug).sort());
    for (const v of VARIANTS) {
      const file = `${dir}${variantDir(v)}/Variant.tsx`;
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toMatch(/export default function/);
      expect(VARIANT_LOADERS[v.slug]!.toString()).toContain(`${variantDir(v)}/Variant`);
    }
  });

  it("resolves route params by number or slug and wraps prev/next", () => {
    expect(findVariant("1")?.slug).toBe("editorial");
    expect(findVariant("Cinematic")?.n).toBe(3);
    expect(findVariant("0")).toBeNull();
    expect(findVariant("x")).toBeNull();
    expect(neighbours(VARIANTS[0]!).prev.n).toBe(10);
    expect(neighbours(VARIANTS[9]!).next.n).toBe(1);
  });

  it("variant client code never imports the SDK barrel or lib/format", () => {
    for (const v of VARIANTS) {
      const src = readFileSync(`${dir}${variantDir(v)}/Variant.tsx`, "utf8");
      expect(src).not.toMatch(/from "@stockfloor\/sdk"|from "@\/lib\/format"/);
    }
  });
});
