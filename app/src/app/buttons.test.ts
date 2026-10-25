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
  it("have corners about 0.47 of their height and a border on every variant", () => {
    const btn = rule(".btn");
    expect(btn).toMatch(/border-radius:\s*20px/);
    expect(btn).toMatch(/border:\s*1px solid transparent/);
    expect(rule(".btn-sm")).toMatch(/border-radius:\s*16px/);
    expect(rule(".btn-lg")).toMatch(/border-radius:\s*23px/);
  });

  it("are 42px, 48px large and 34px small", () => {
    const btn = rule(".btn");
    expect(heightPx(btn, btn)).toBe(42);
    expect(heightPx(rule(".btn-lg"), btn)).toBe(48);
    expect(heightPx(rule(".btn-sm"), btn)).toBe(34);
  });

  it("round the segmented track and tabs to match", () => {
    expect(rule(".segmented")).toMatch(/border-radius:\s*16px/);
    expect(rule(".segmented > button,\n  .segmented > a")).toMatch(/border-radius:\s*12px/);
  });
});
