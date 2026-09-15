/**
 * Buy a launch's base token with the quote asset: on the DBC curve during presale (PartialFill when
 * the buy would cross the migration price), on DAMM v2 after migration.
 *
 *   tsx scripts/buy.ts --keypair keys/cli-buyer.json (--mint <base mint> | --launch <addr> | --config <cfg>) \
 *     (--amount <quote units> | --raw <raw>) [--slippage-bps 100] [--no-partial-fill] [--rpc ...] [--json]
 */
import { TOKEN_PROGRAM_ID, buildTrade, fetchLaunchState, getAtaBalance } from "../src";
import { amountArg, bool, CliError, int, json, log, parseArgs, requireLaunchState, runCli, sendingContext, stateSummary } from "./lib/cli";

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "allow-mainnet", "no-partial-fill"]);
  const ctx = await sendingContext(args);
  const state = await requireLaunchState(ctx.sender, args);
  const amount = amountArg(args, state.quoteMint.decimals);
  if (!amount) throw new CliError("--amount or --raw is required");
  const trade = buildTrade(state, ctx.sender.payer, "buy", amount, { slippageBps: int(args, "slippage-bps", 100), allowPartialFill: !bool(args, "no-partial-fill") });
  const venue = trade.quote.venue === "dbc" ? `DBC curve (${["ExactIn", "PartialFill", "ExactOut"][trade.quote.mode]})` : "DAMM v2";
  log(`buy on ${venue}: pay ${trade.quote.amountIn} raw quote, receive ${trade.quote.amountOut} raw base (min ${trade.minAmountOut})`);
  const base0 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.baseMint, TOKEN_PROGRAM_ID);
  const quote0 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.quoteMint, state.keys.quoteTokenProgram);
  const res = await ctx.sender.send(trade.instructions, { computeUnitLimit: trade.computeUnitLimit, label: "buy" });
  const base1 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.baseMint, TOKEN_PROGRAM_ID);
  const quote1 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.quoteMint, state.keys.quoteTokenProgram);
  const after = await fetchLaunchState(ctx.sender, { launch: state.address });
  const result = {
    signature: res.signature,
    unitsConsumed: res.unitsConsumed,
    venue,
    quotedIn: trade.quote.amountIn,
    quotedOut: trade.quote.amountOut,
    spentQuote: quote0 - quote1,
    receivedBase: base1 - base0,
    exact: quote0 - quote1 === trade.quote.amountIn && base1 - base0 === trade.quote.amountOut,
    phaseAfter: after?.phase,
    progressAfter: after ? stateSummary(after).progress : null,
  };
  log(json(result));
});
