/**
 * Create a StockFloor launch: DBC config + create_launch, then the DBC pool + register_pool (+ an
 * optional creator first buy). Local clusters only unless the C2 mainnet override is set.
 *
 *   tsx scripts/create-launch.ts --keypair keys/cli-creator.json --name "Floor Demo" --symbol FLOOR \
 *     --uri https://example.com/floor.json [--quote SPYx] [--preset gentle|flat] [--vault-share 50] \
 *     [--threshold-usd 1000] [--exit-fee-bps 200] [--price-usd 757.02 | live Jupiter price] \
 *     [--first-buy <quote units>] [--slippage-bps 100] [--priority-fee <micro-lamports>] \
 *     [--out launch.json] [--rpc http://127.0.0.1:8899] [--json]
 */
import { writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import {
  buildLaunchTransactions,
  effectiveMintMultiplier,
  fetchLaunchState,
  getClock,
  getJupiterPrices,
  getMintInfo,
  type LaunchInput,
} from "../src";
import { bool, CliError, int, json, log, need, parseArgs, quoteAssetArg, rawToUnits, runCli, sendingContext, stateSummary, str, unitsToRaw } from "./lib/cli";

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "allow-mainnet"]);
  const ctx = await sendingContext(args);
  const quote = quoteAssetArg(args);
  const quoteMint = new PublicKey(quote.mint);
  const [{ mint, tokenProgram }, clock] = await Promise.all([getMintInfo(ctx.sender, quoteMint), getClock(ctx.sender)]);
  const multiplier = effectiveMintMultiplier(mint, clock.unixTimestamp);

  let priceUsd = str(args, "price-usd") ? Number(str(args, "price-usd")) : undefined;
  let priceSource = "--price-usd";
  if (priceUsd === undefined) {
    const prices = await getJupiterPrices([quote.mint]);
    priceUsd = prices[quote.mint]?.usdPrice;
    priceSource = "Jupiter Price V3 (lite-api)";
    if (!priceUsd) throw new CliError(`no Jupiter price for ${quote.symbol}; pass --price-usd`);
  }
  if (!(priceUsd > 0)) throw new CliError("--price-usd must be positive");

  const preset = (str(args, "preset") ?? "gentle") as LaunchInput["preset"];
  const input: LaunchInput = {
    name: need(args, "name"),
    symbol: need(args, "symbol"),
    uri: str(args, "uri") ?? "",
    quote,
    quotePriceUsd: priceUsd,
    quoteMultiplier: multiplier,
    preset,
    vaultSharePct: int(args, "vault-share", 50)!,
    thresholdUsd: str(args, "threshold-usd") ? Number(str(args, "threshold-usd")) : 1000,
    exitFeeBps: int(args, "exit-fee-bps", 200),
  };
  const firstBuyUnits = str(args, "first-buy");
  const firstBuy = firstBuyUnits !== undefined ? unitsToRaw(firstBuyUnits, quote.decimals) : undefined;
  const built = buildLaunchTransactions(input, ctx.sender.payer, {
    quoteTokenProgram: tokenProgram,
    firstBuy: firstBuy ? { quoteAmount: firstBuy, slippageBps: int(args, "slippage-bps", 100) } : undefined,
    computeUnitPriceMicroLamports: int(args, "priority-fee"),
    nowUnixSeconds: clock.unixTimestamp,
  });

  log(`quote ${quote.symbol} ${quote.mint}: $${priceUsd} per UI token (${priceSource}), multiplier ${multiplier}`);
  log(`threshold ${rawToUnits(built.curve.thresholdQuoteRaw, quote.decimals)} ${quote.symbol} (${built.curve.thresholdQuoteRaw} raw)`);
  log(`preview: start $${built.preview.startPriceUsd.toExponential(4)}, graduation $${built.preview.graduationPriceUsd.toExponential(4)}, floor at graduation $${built.preview.floorAtGraduationUsd.toExponential(4)}, vault at graduation ${built.preview.vaultAtGraduationQuoteRaw} raw`);
  if (built.firstBuyQuote) log(`first buy: ${built.firstBuyQuote.includedFeeInputAmount} raw quote -> ${built.firstBuyQuote.outputAmount} raw base`);

  const signatures: Array<{ label: string; signature: string; size: number; unitsConsumed?: number }> = [];
  for (const tx of built.transactions) {
    const res = await ctx.sender.send(tx.instructions, { signers: tx.signers, computeUnitLimit: tx.computeUnitLimit, label: tx.label });
    signatures.push({ label: tx.label, signature: res.signature, size: tx.size, unitsConsumed: res.unitsConsumed });
    log(`sent ${tx.label}: ${res.signature} (${tx.size} bytes, ${res.unitsConsumed ?? "?"} CU)`);
  }
  const state = await fetchLaunchState(ctx.sender, { launch: built.addresses.launch });
  const out = { addresses: built.addresses, signatures, preview: built.preview, state: state ? stateSummary(state) : null };
  const outFile = str(args, "out");
  if (outFile) writeFileSync(outFile, json(out) + "\n");
  if (bool(args, "json")) log(json(out));
  else log(json({ addresses: built.addresses, state: out.state }));
});
