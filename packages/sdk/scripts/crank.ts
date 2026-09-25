/**
 * Permissionless crank: register_pool, harvest_curve_fees, harvest_migration_fee, harvest_surplus,
 * DBC migration_damm_v2, sync_migration, harvest_lp_fees and burn_claimer_base, whichever are due.
 *
 *   tsx scripts/crank.ts --keypair keys/cli-cranker.json [--launch <addr> | --mint <base> | --config <cfg>]
 *     (default: every launch) [--loop] [--interval 15] [--skip-migration] [--max-actions 16]
 *     [--min-lp-fee-raw <quote raw>] [--min-lp-base-raw <base raw>] [--max-lp-harvests 4]
 *     [--include-foreign-positions] [--priority-fee <micro-lamports>] [--rpc ...] [--json]
 *
 * LP fee harvests (see planCrank in src/crank.ts): by default only positions on the launch's own
 * DAMM v2 pool, only when at least 0.00001 quote token is pending, at most 4 per pass.
 *
 * Launch v3 fee split: presale fees go to the platform treasury (the crank re-creates its quote ATA
 * idempotently first), the migration fee is split platform 5% / creator 5% of the threshold / vault
 * the rest, LP fees creator 50% / platform 20% / vault the rest. v2 launches pay everything into the vault.
 */
import { fetchLaunchState, planCrank, runCrank, runCrankAll, type CrankRunResult } from "../src";
import { bool, CliError, int, json, launchRef, log, parseArgs, runCli, sendingContext, str } from "./lib/cli";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function printResult(r: CrankRunResult, asJson: boolean) {
  if (asJson) {
    log(json({ launch: r.launch, steps: r.steps, remaining: r.remaining, phase: r.finalState?.phase }));
    return;
  }
  if (r.steps.length === 0) log(`${r.launch.toBase58()}: nothing due (phase ${r.finalState?.phase})`);
  for (const s of r.steps) {
    const a = s.action;
    const amounts =
      a.kind === "harvest_migration_fee"
        ? ` [platform ${a.platform}, creator ${a.creator}, vault ${a.vault} raw]`
        : a.kind === "harvest_curve_fees"
          ? ` [partner fee ${a.partnerQuoteFee} raw${r.finalState?.launch.feeSplitEnabled ? " to the platform" : " to the vault"}]`
          : "";
    log(`${r.launch.toBase58()}: ${s.action.kind}${amounts} ${s.status}${s.signature ? ` ${s.signature}` : ""}${s.unitsConsumed ? ` (${s.unitsConsumed} CU)` : ""}${s.errorName ? ` [${s.errorName}]` : ""}${s.status !== "executed" && s.reason ? ` ${s.reason.split("\n")[0]}` : ""}`);
  }
  if (r.remaining.length > 0) log(`${r.launch.toBase58()}: still due ${r.remaining.map((a) => a.kind).join(", ")}`);
}

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "allow-mainnet", "loop", "skip-migration", "dry-run", "include-foreign-positions"]);
  const ctx = await sendingContext(args);
  const ref = launchRef(args);
  const rawFlag = (name: string): bigint | undefined => {
    const v = str(args, name);
    if (v === undefined) return undefined;
    if (!/^\d+$/.test(v)) throw new CliError(`--${name} must be a non-negative integer (raw units)`);
    return BigInt(v);
  };
  const opts = {
    maxActions: int(args, "max-actions", 16),
    skipMigration: bool(args, "skip-migration"),
    computeUnitPriceMicroLamports: int(args, "priority-fee"),
    minLpFeeQuote: rawFlag("min-lp-fee-raw"),
    minLpFeeBase: rawFlag("min-lp-base-raw"),
    maxLpHarvests: int(args, "max-lp-harvests"),
    includeForeignPositions: bool(args, "include-foreign-positions"),
  };
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
      log(json(s ? { launch: s.address, phase: s.phase, due: planCrank(s, opts) } : { error: "pass a launch for --dry-run" }));
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
