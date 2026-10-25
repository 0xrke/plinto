import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VARIANT_LOADERS } from "./loaders";
import { VARIANTS, findVariant, neighbours, originalOf, restyleOf, variantDir, variantGroup } from "./registry";

// Vitest runs from app/ (jsdom gives import.meta.url a non-file scheme).
const dir = `${resolve(process.cwd(), "src/components/landing/variants")}/`;

const ORIGINALS = VARIANTS.filter((v) => variantGroup(v) === "original");
const SITE = VARIANTS.filter((v) => variantGroup(v) === "site");
const COMBOS = VARIANTS.filter((v) => variantGroup(v) === "combo");

/** Every .ts/.tsx source file under a variant folder (recursively). */
function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => resolve(e.parentPath, e.name));
}

describe("variant registry", () => {
  it("has variants 1..36 without the dropped 22, with unique slugs", () => {
    const expected = Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => n !== 22);
    expect(VARIANTS.map((v) => v.n)).toEqual(expected);
    expect(new Set(VARIANTS.map((v) => v.slug)).size).toBe(expected.length);
    for (const v of VARIANTS) {
      expect(v.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(0);
    }
  });

  it("groups 1..10 as originals and 11..20 as site-style restyles of 1..10", () => {
    expect(ORIGINALS.map((v) => v.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(SITE.map((v) => v.n)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    for (const v of ORIGINALS) {
      expect(v.basedOn).toBeUndefined();
      expect(restyleOf(v)?.n).toBe(v.n + 10);
    }
    for (const v of SITE) {
      const o = originalOf(v);
      expect(o?.n).toBe(v.n - 10);
      expect(variantGroup(o!)).toBe("original");
      expect(v.slug).toBe(`${o!.slug}-site`);
      expect(variantDir(v)).toBe(`v${v.n}-${o!.slug}-site`);
    }
  });

  it("groups 21..36 (no 22) as combos that mix earlier variants", () => {
    expect(COMBOS.map((v) => v.n)).toEqual([21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    for (const v of COMBOS) {
      expect(v.basedOn).toBeUndefined();
      expect(v.mixes?.length).toBeGreaterThan(0);
      for (const n of v.mixes!) expect(n).toBeLessThan(v.n);
      expect(variantDir(v)).toBe(`v${v.n}-${v.slug}`);
    }
  });

  it("has a Variant.tsx with a default export for every slug, and one loader per slug", () => {
    expect(Object.keys(VARIANT_LOADERS).sort()).toEqual(VARIANTS.map((v) => v.slug).sort());
    for (const v of VARIANTS) {
      const file = `${dir}${variantDir(v)}/Variant.tsx`;
      expect(existsSync(file), file).toBe(true);
      // A site or combo variant may still be the placeholder that re-exports its original.
      const exportsDefault = variantGroup(v) === "original" ? /export default function/ : /export default function|export \{ default \} from "\.\.\/v\d{2}-[a-z-]+\/Variant"/;
      expect(readFileSync(file, "utf8"), file).toMatch(exportsDefault);
      expect(VARIANT_LOADERS[v.slug]!.toString()).toContain(`${variantDir(v)}/Variant`);
    }
  });

  it("resolves route params by number or slug and wraps prev/next", () => {
    expect(findVariant("1")?.slug).toBe("editorial");
    expect(findVariant("Cinematic")?.n).toBe(3);
    expect(findVariant("11")?.slug).toBe("editorial-site");
    expect(findVariant("playful-site")?.n).toBe(20);
    expect(findVariant("0")).toBeNull();
    expect(findVariant("21")?.slug).toBe("editorial-plus");
    expect(findVariant("22")).toBeNull();
    expect(findVariant("32")?.slug).toBe("film-sections");
    expect(findVariant("36")?.slug).toBe("film-compact");
    expect(findVariant("37")).toBeNull();
    expect(findVariant("x")).toBeNull();
    expect(neighbours(VARIANTS[0]!).prev.n).toBe(36);
    expect(neighbours(VARIANTS.at(-1)!).next.n).toBe(1);
    expect(neighbours(findVariant("21")!).next.n).toBe(23);
  });

  it("variant client code never imports the SDK barrel or lib/format", () => {
    const folders = [...VARIANTS.map((v) => `${dir}${variantDir(v)}`), `${dir}shared`];
    for (const folder of folders) {
      for (const file of sources(folder)) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(/from "@stockfloor\/sdk"|from "@\/lib\/format"/);
      }
    }
  });
});
