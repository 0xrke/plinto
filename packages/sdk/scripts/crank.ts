/**
 * Permissionless crank: register_pool, harvest_curve_fees, harvest_migration_fee, harvest_surplus,
 * DBC migration_damm_v2, harvest_lp_fees and burn_claimer_base, whichever are due.
 *
 *   tsx scripts/crank.ts --keypair keys/cli-cranker.json [--launch <addr> | --mint <base> | --config <cfg>]
 *     (default: every launch) [--loop] [--interval 15] [--skip-migration] [--max-actions 16]
 *     [--priority-fee <micro-lamports>] [--rpc ...] [--json]
 */
import { fetchLaunchState, planCrank, runCrank, runCrankAll, type CrankRunResult } from "../src";
import { bool, int, json, launchRef, log, parseArgs, runCli, sendingContext } from "./lib/cli";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function printResult(r: CrankRunResult, asJson: boolean) {
  if (asJson) {
    log(json({ launch: r.launch, steps: r.steps, remaining: r.remaining, phase: r.finalState?.phase }));
    return;
  }
  if (r.steps.length === 0) log(`${r.launch.toBase58()}: nothing due (phase ${r.finalState?.phase})`);
  for (const s of r.steps) {
    log(`${r.launch.toBase58()}: ${s.action.kind} ${s.status}${s.signature ? ` ${s.signature}` : ""}${s.unitsConsumed ? ` (${s.unitsConsumed} CU)` : ""}${s.errorName ? ` [${s.errorName}]` : ""}${s.status !== "executed" && s.reason ? ` ${s.reason.split("\n")[0]}` : ""}`);
  }
  if (r.remaining.length > 0) log(`${r.launch.toBase58()}: still due ${r.remaining.map((a) => a.kind).join(", ")}`);
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "allow-mainnet", "loop", "skip-migration", "dry-run"]);
  const ctx = await sendingContext(args);
  const ref = launchRef(args);
  const opts = { maxActions: int(args, "max-actions", 16), skipMigration: bool(args, "skip-migration"), computeUnitPriceMicroLamports: int(args, "priority-fee") };
  const asJson = bool(args, "json");
  const interval = (int(args, "interval", 15) ?? 15) * 1000;
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
    log("stopping after this pass");
  });
  do {
    if (bool(args, "dry-run")) {
      const s = ref ? await fetchLaunchState(ctx.sender, ref) : null;
      log(json(s ? { launch: s.address, phase: s.phase, due: planCrank(s) } : { error: "pass a launch for --dry-run" }));
    } else if (ref) {
      printResult(await runCrank(ctx.sender, ref, opts), asJson);
    } else {
      const all = await runCrankAll(ctx.sender, opts);
      for (const r of all.results) printResult(r, asJson);
      for (const e of all.errors) log(`${e.launch.toBase58()}: error ${e.error}`);
    }
    if (!bool(args, "loop") || stop) break;
    await sleep(interval);
  } while (!stop);
});
