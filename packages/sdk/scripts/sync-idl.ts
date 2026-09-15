/**
 * Sync the program IDLs into the SDK sources.
 *
 *   pnpm --filter @stockfloor/sdk run sync-idl          # write
 *   pnpm --filter @stockfloor/sdk run sync-idl --check  # exit 1 if anything is out of date
 *
 * - target/idl/stockfloor.json   -> src/idl/stockfloor.json     (verbatim, after an anchor build)
 * - target/types/stockfloor.ts   -> src/idl/stockfloor-types.ts (verbatim Anchor type helper)
 * - idls/dynamic_bonding_curve.json -> src/idl/dbc.json          (trimmed, see src/idl/trim.ts)
 * - idls/cp_amm.json                -> src/idl/damm_v2.json      (trimmed)
 *
 * Run it after every `bash scripts/build-programs.sh -p stockfloor`; test/idl-sync.test.ts fails
 * when the copies differ from the build output.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DAMM_V2_IDL_TRIM, DBC_IDL_TRIM, trimIdl, type IdlLike } from "../src/idl/trim";

const SDK_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(SDK_DIR, "..", "..");

export interface SyncItem {
  from: string;
  to: string;
  content: () => string;
}

export const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

export function syncItems(): SyncItem[] {
  const read = (p: string) => readFileSync(p, "utf8");
  const target = join(REPO_ROOT, "target");
  return [
    { from: join(target, "idl", "stockfloor.json"), to: join(SDK_DIR, "src", "idl", "stockfloor.json"), content: () => read(join(target, "idl", "stockfloor.json")) },
    { from: join(target, "types", "stockfloor.ts"), to: join(SDK_DIR, "src", "idl", "stockfloor-types.ts"), content: () => read(join(target, "types", "stockfloor.ts")) },
    {
      from: join(REPO_ROOT, "idls", "dynamic_bonding_curve.json"),
      to: join(SDK_DIR, "src", "idl", "dbc.json"),
      content: () => json(trimIdl(JSON.parse(read(join(REPO_ROOT, "idls", "dynamic_bonding_curve.json"))) as IdlLike, DBC_IDL_TRIM)),
    },
    {
      from: join(REPO_ROOT, "idls", "cp_amm.json"),
      to: join(SDK_DIR, "src", "idl", "damm_v2.json"),
      content: () => json(trimIdl(JSON.parse(read(join(REPO_ROOT, "idls", "cp_amm.json"))) as IdlLike, DAMM_V2_IDL_TRIM)),
    },
  ];
}

function main() {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const item of syncItems()) {
    const rel = (p: string) => relative(REPO_ROOT, p);
    if (!existsSync(item.from)) {
      console.log(`skip  ${rel(item.from)} (missing; build the program first)`);
      continue;
    }
    const next = item.content();
    const current = existsSync(item.to) ? readFileSync(item.to, "utf8") : null;
    if (current === next) {
      console.log(`ok    ${rel(item.to)}`);
      continue;
    }
    stale++;
    if (check) {
      console.log(`STALE ${rel(item.to)} (differs from ${rel(item.from)})`);
    } else {
      writeFileSync(item.to, next);
      console.log(`wrote ${rel(item.to)} <- ${rel(item.from)}`);
    }
  }
  if (check && stale > 0) {
    console.error(`${stale} file(s) out of date: run pnpm --filter @stockfloor/sdk run sync-idl`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
