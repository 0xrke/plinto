import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = globals.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, selector).not.toBeNull();
  return match![1]!;
}

/** Height of a .btn variant: vertical padding + line height + the 1px border on each side, in px. */
function heightPx(decls: string, base: string): number {
  const pad = (decls.match(/padding:\s*([\d.]+)rem/) ?? base.match(/padding:\s*([\d.]+)rem/))![1]!;
  const line = (decls.match(/line-height:\s*([\d.]+)rem/) ?? base.match(/line-height:\s*([\d.]+)rem/))![1]!;
  return Math.round((2 * Number(pad) + Number(line)) * 16 + 2);
}

describe("buttons", () => {
  it("are pills with a border on every variant", () => {
    const btn = rule(".btn");
    expect(btn).toMatch(/border-radius:\s*9999px/);
    expect(btn).toMatch(/border:\s*1px solid transparent/);
    // No variant brings back a corner radius.
    expect(rule(".btn-sm")).not.toMatch(/border-radius/);
    expect(rule(".btn-lg")).not.toMatch(/border-radius/);
  });

  it("are 44px, 48px large and 36px small", () => {
    const btn = rule(".btn");
    expect(heightPx(btn, btn)).toBe(44);
    expect(heightPx(rule(".btn-lg"), btn)).toBe(48);
    expect(heightPx(rule(".btn-sm"), btn)).toBe(36);
  });

  it("round the segmented tabs as pills too", () => {
    expect(rule(".segmented")).toMatch(/border-radius:\s*9999px/);
    expect(rule(".segmented > button,\n  .segmented > a")).toMatch(/border-radius:\s*9999px/);
  });
});
