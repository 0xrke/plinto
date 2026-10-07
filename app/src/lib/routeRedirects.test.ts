import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../next.config";
import { routeRedirects } from "./routeRedirects";

describe("routeRedirects", () => {
  it("sends the old create and token URLs under /app, permanently", () => {
    expect(routeRedirects()).toEqual([
      { source: "/create", destination: "/app/create", permanent: true },
      { source: "/t/:mint", destination: "/app/t/:mint", permanent: true },
    ]);
  });

  it("is wired into next.config", async () => {
    const redirects = config("phase-development-server").redirects;
    expect(redirects).toBeDefined();
    expect(await redirects!()).toEqual(routeRedirects());
  });
});

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("internal links", () => {
  it("no source file links to the pre-/app routes", () => {
    // A string or template literal that starts with /t/, /create or /# is a link to an old route.
    // Tests are skipped: they may name old paths on purpose (redirect sources, negative cases).
    const legacy = /["'`]\/(t\/|create\b|#)/;
    const redirectsFile = path.join(SRC, "lib", "routeRedirects.ts");
    const hits = sourceFiles(SRC)
      .filter((file) => file !== redirectsFile && !/\.test\.tsx?$/.test(file))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, i) => (legacy.test(line) ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
