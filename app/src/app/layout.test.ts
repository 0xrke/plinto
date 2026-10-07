import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(APP, file), "utf8");

// The wallet, React Query and web3 client code loads only under /app: the landing and /waitlist stay light.
describe("layouts", () => {
  it("keeps the providers and the app shell out of the root layout", () => {
    const root = read("layout.tsx");
    expect(root).not.toMatch(/AppProviders|AppShell/);
  });

  it("wraps /app in the providers and the app shell", () => {
    const app = read("app/layout.tsx");
    expect(app).toMatch(/<AppProviders>/);
    expect(app).toMatch(/<AppShell /);
  });
});
