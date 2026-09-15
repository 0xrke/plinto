/**
 * Read-only status of one launch or all launches: phase, progress, vault, supply, floor (on-chain
 * floor view by simulation), price and max loss (with a USD quote price), claimer positions and the
 * crank actions that are due. Sends nothing; no keypair needed.
 *
 *   tsx scripts/status.ts [--launch <addr> | --mint <base> | --config <cfg>] [--price-usd 757.02 | --live-price]
 *     [--rpc http://127.0.0.1:8899] [--json]
 */
import { fetchLaunchState, getFloor, getJupiterPrices, launchMetrics, listLaunches, planCrank, type LaunchState } from "../src";
import { bool, json, launchRef, log, parseArgs, readerFor, runCli, stateSummary, str } from "./lib/cli";

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "live-price"]);
  const reader = readerFor(args);
  const ref = launchRef(args);
  const states: LaunchState[] = [];
  if (ref) {
    const s = await fetchLaunchState(reader, ref);
    if (!s) throw new Error("launch not found");
    states.push(s);
  } else {
    for (const l of await listLaunches(reader)) {
      const s = await fetchLaunchState(reader, { launch: l.address });
      if (s) states.push(s);
    }
  }
  const out = [];
  for (const s of states) {
    let priceUsd = str(args, "price-usd") ? Number(str(args, "price-usd")) : undefined;
    if (priceUsd === undefined && bool(args, "live-price")) priceUsd = (await getJupiterPrices([s.launch.quoteMint.toBase58()]))[s.launch.quoteMint.toBase58()]?.usdPrice;
    const floorView = await getFloor(reader, s.launch).catch((e: Error) => ({ error: e.message }));
    out.push({
      ...stateSummary(s),
      floorView,
      floorViewMatchesState: "vaultRaw" in floorView ? floorView.vaultRaw === s.floor.vaultRaw && floorView.supply === s.floor.supply && floorView.floorQ64 === s.floor.floorQ64 : false,
      quoteMultiplier: s.quoteMultiplier,
      metrics: priceUsd ? launchMetrics(s, { quotePriceUsd: priceUsd }) : null,
      dueCrankActions: planCrank(s).map((a) => a.kind),
    });
  }
  log(json(ref ? out[0] : out));
});
