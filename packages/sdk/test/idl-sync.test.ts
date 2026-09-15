/**
 * The IDL copies in src/idl are exactly what `pnpm --filter @stockfloor/sdk run sync-idl` produces
 * from the build output (target/idl, target/types) and the vendored DBC / DAMM v2 IDLs.
 * Fails after a program rebuild until the sync is run.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syncItems } from "../scripts/sync-idl";
import { dammV2Program, dbcProgram, stockfloorProgram } from "../src";
import { trimIdl } from "../src/idl/trim";

describe("IDL sync", () => {
  for (const item of syncItems()) {
    const name = item.to.split("/").slice(-1)[0];
    it(`${name} is in sync with its source`, () => {
      expect(existsSync(item.to), `${item.to} missing`).toBe(true);
      if (!existsSync(item.from)) {
        // Build output absent (fresh checkout): nothing to compare against.
        return;
      }
      expect(readFileSync(item.to, "utf8"), `${item.to} differs from ${item.from}; run pnpm --filter @stockfloor/sdk run sync-idl`).toBe(item.content());
    });
  }

  it("the trimmed IDLs build complete coders", () => {
    expect(() => dbcProgram().coder.accounts.size("poolConfig" as never)).not.toThrow();
    expect(dbcProgram().coder.accounts.size("poolConfig" as never)).toBe(1048);
    expect(dbcProgram().coder.accounts.size("virtualPool" as never)).toBe(424);
    expect(dammV2Program().coder.accounts.size("pool" as never)).toBe(1112);
    expect(dammV2Program().coder.accounts.size("position" as never)).toBe(408);
    expect(stockfloorProgram().coder.accounts.size("launch")).toBe(351);
  });

  it("trimIdl keeps referenced types and rejects unknown names", () => {
    const idl = {
      address: "x",
      metadata: {},
      instructions: [{ name: "a", args: [{ name: "p", type: { defined: { name: "P" } } }], accounts: [] }, { name: "b", args: [], accounts: [] }],
      accounts: [{ name: "Acc" }],
      events: [],
      types: [
        { name: "Acc", type: { kind: "struct", fields: [{ name: "q", type: { vec: { defined: { name: "Q" } } } }] } },
        { name: "P", type: { kind: "struct", fields: [] } },
        { name: "Q", type: { kind: "struct", fields: [] } },
        { name: "Unused", type: { kind: "struct", fields: [] } },
      ],
    };
    const t = trimIdl(idl, { instructions: ["a"], accounts: ["Acc"] });
    expect(t.instructions.map((i) => i.name)).toEqual(["a"]);
    expect(t.types!.map((x) => x.name)).toEqual(["Acc", "P", "Q"]);
    expect(() => trimIdl(idl, { instructions: ["nope"] })).toThrow(/no instruction named nope/);
  });
});
