/**
 * Sell a launch's base token for the quote asset (DBC curve in presale, DAMM v2 after migration).
 *
 *   tsx scripts/sell.ts --keypair keys/cli-buyer.json (--mint ... | --launch ... | --config ...) \
 *     (--amount <base units> | --raw <raw> | --all) [--slippage-bps 100] [--rpc ...]
 */
import { TOKEN_PROGRAM_ID, buildTrade, getAtaBalance } from "../src";
import { amountArg, bool, CliError, int, json, log, parseArgs, requireLaunchState, runCli, sendingContext } from "./lib/cli";

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "allow-mainnet", "all"]);
  const ctx = await sendingContext(args);
  const state = await requireLaunchState(ctx.sender, args);
  const balance = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.baseMint, TOKEN_PROGRAM_ID);
  const amount = bool(args, "all") ? balance : amountArg(args, 6);
  if (!amount) throw new CliError("--amount, --raw or --all is required (and the balance must be positive)");
  if (amount > balance) throw new CliError(`amount ${amount} exceeds the base balance ${balance}`);
  const trade = buildTrade(state, ctx.sender.payer, "sell", amount, { slippageBps: int(args, "slippage-bps", 100) });
  const venue = trade.quote.venue === "dbc" ? "DBC curve" : "DAMM v2";
  log(`sell on ${venue}: ${amount} raw base -> ${trade.quote.amountOut} raw quote (min ${trade.minAmountOut})`);
  const quote0 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.quoteMint, state.keys.quoteTokenProgram);
  const res = await ctx.sender.send(trade.instructions, { computeUnitLimit: trade.computeUnitLimit, label: "sell" });
  const quote1 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.quoteMint, state.keys.quoteTokenProgram);
  const base1 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.baseMint, TOKEN_PROGRAM_ID);
  log(json({ signature: res.signature, unitsConsumed: res.unitsConsumed, venue, soldBase: balance - base1, receivedQuote: quote1 - quote0, exact: quote1 - quote0 === trade.quote.amountOut }));
});
