/**
 * Redeem base tokens for the quote asset from the launch vault (burn N, receive N / supply x vault
 * minus the exit fee). Opens after migration and the migration-fee harvest.
 *
 *   tsx scripts/redeem.ts --keypair keys/cli-buyer.json (--mint ... | --launch ... | --config ...) \
 *     (--amount <base units> | --raw <raw> | --all) [--rpc ...]
 */
import { TOKEN_PROGRAM_ID, buildRedeem, fetchLaunchState, getAtaBalance, previewRedeem } from "../src";
import { amountArg, bool, CliError, json, log, parseArgs, requireLaunchState, runCli, sendingContext } from "./lib/cli";

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "allow-mainnet", "all"]);
  const ctx = await sendingContext(args);
  const state = await requireLaunchState(ctx.sender, args);
  const balance = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.baseMint, TOKEN_PROGRAM_ID);
  const amount = bool(args, "all") ? balance : amountArg(args, 6);
  if (!amount) throw new CliError("--amount, --raw or --all is required (and the balance must be positive)");
  if (amount > balance) throw new CliError(`amount ${amount} exceeds the base balance ${balance}`);
  const preview = previewRedeem(state, amount);
  log(`redeem ${amount} raw base: gross ${preview.gross}, exit fee ${preview.fee}, net ${preview.net} raw quote${preview.blockedReason ? ` (blocked: ${preview.blockedReason})` : ""}`);
  const built = buildRedeem(state, ctx.sender.payer, amount);
  const quote0 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.quoteMint, state.keys.quoteTokenProgram);
  const res = await ctx.sender.send(built.instructions, { computeUnitLimit: built.computeUnitLimit, label: "redeem" });
  const quote1 = await getAtaBalance(ctx.sender, ctx.sender.payer, state.keys.quoteMint, state.keys.quoteTokenProgram);
  const after = (await fetchLaunchState(ctx.sender, { launch: state.address }))!;
  log(
    json({
      signature: res.signature,
      unitsConsumed: res.unitsConsumed,
      preview,
      receivedQuote: quote1 - quote0,
      exact: quote1 - quote0 === preview.net,
      vaultBefore: state.vaultBalance,
      vaultAfter: after.vaultBalance,
      supplyBefore: state.baseSupply,
      supplyAfter: after.baseSupply,
      floorQ64Before: state.floor.floorQ64,
      floorQ64After: after.floor.floorQ64,
    }),
  );
});
