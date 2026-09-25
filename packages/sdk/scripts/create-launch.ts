/**
 * Create a StockFloor launch: DBC config + create_launch, then the DBC pool + register_pool (+ an
 * optional creator first buy). Local clusters only unless the C2 mainnet override is set.
 *
 *   tsx scripts/create-launch.ts --keypair keys/cli-creator.json --name "Floor Demo" --symbol FLOOR \
 *     --uri https://example.com/floor.json [--quote SPYx] [--preset gentle|flat] [--vault-share 50] \
 *     [--threshold-usd 1000] [--exit-fee-bps 200] [--price-usd 757.02 | live Jupiter price] \
 *     [--first-buy <quote units>] [--slippage-bps 100] [--priority-fee <micro-lamports>] \
 *     [--session keys/launches/<config>.json] [--out launch.json] [--rpc http://127.0.0.1:8899] [--json]
 *
 *   tsx scripts/create-launch.ts --keypair keys/cli-creator.json --resume keys/launches/<config>.json \
 *     [--priority-fee ...] [--out launch.json] [--rpc ...] [--json]
 *
 * Before the first transaction the script writes a session file (default
 * `keys/launches/<config>.json`, gitignored, mode 0600) with the launch input and the DBC config and
 * base-mint keypairs, and the `--out` file with the addresses. If a transaction fails or the process
 * dies, `--resume <session>` rebuilds the same transactions and sends only what is not on chain yet.
 * It also refuses to start when the quote mint is paused or the creator cannot pay the first buy.
 */
import { writeFileSync } from "node:fs";
import { PublicKey, type Keypair } from "@solana/web3.js";
import {
  associatedTokenAddress,
  buildLaunchTransactions,
  DBC_PROGRAM_ID,
  effectiveMintMultiplier,
  fetchLaunchState,
  getAtaBalance,
  getClock,
  getJupiterPrices,
  getMintInfo,
  isLaunchAccountData,
  decodeLaunch,
  STOCKFLOOR_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type LaunchInput,
} from "../src";
import { bool, CliError, int, json, log, need, parseArgs, quoteAssetArg, rawToUnits, runCli, sendingContext, stateSummary, str, unitsToRaw } from "./lib/cli";
import { defaultSessionPath, newLaunchSession, pendingLaunchSteps, readLaunchSession, writeLaunchSession, type LaunchChainProgress } from "./lib/launchSession";

runCli(async () => {
  const args = parseArgs(process.argv.slice(2), ["json", "allow-mainnet"]);
  const ctx = await sendingContext(args);
  const payer = ctx.sender.payer;
  const resumePath = str(args, "resume");
  const clock = await getClock(ctx.sender);

  let input: LaunchInput;
  let firstBuy: { quoteAmount: bigint; slippageBps: number } | null;
  let keypairs: { configKeypair?: Keypair; baseMintKeypair?: Keypair } = {};
  let priceSource: string;
  if (resumePath) {
    const loaded = readLaunchSession(resumePath);
    if (!loaded.creator.equals(payer)) {
      throw new CliError(`the session was created by ${loaded.creator.toBase58()}; pass that --keypair to resume`);
    }
    input = loaded.input;
    firstBuy = loaded.firstBuy;
    keypairs = { configKeypair: loaded.configKeypair, baseMintKeypair: loaded.baseMintKeypair };
    priceSource = `session ${resumePath}`;
    log(`resuming launch ${loaded.session.addresses.launch} from ${resumePath}`);
  } else {
    const quote = quoteAssetArg(args);
    const { mint } = await getMintInfo(ctx.sender, new PublicKey(quote.mint));
    const multiplier = effectiveMintMultiplier(mint, clock.unixTimestamp);
    let priceUsd = str(args, "price-usd") ? Number(str(args, "price-usd")) : undefined;
    priceSource = "--price-usd";
    if (priceUsd === undefined) {
      const prices = await getJupiterPrices([quote.mint]);
      priceUsd = prices[quote.mint]?.usdPrice;
      priceSource = "Jupiter Price V3 (lite-api)";
      if (!priceUsd) throw new CliError(`no Jupiter price for ${quote.symbol}; pass --price-usd`);
    }
    if (!(priceUsd > 0)) throw new CliError("--price-usd must be positive");
    input = {
      name: need(args, "name"),
      symbol: need(args, "symbol"),
      uri: str(args, "uri") ?? "",
      quote,
      quotePriceUsd: priceUsd,
      quoteMultiplier: multiplier,
      preset: (str(args, "preset") ?? "gentle") as LaunchInput["preset"],
      vaultSharePct: int(args, "vault-share", 50)!,
      thresholdUsd: str(args, "threshold-usd") ? Number(str(args, "threshold-usd")) : 1000,
      exitFeeBps: int(args, "exit-fee-bps", 200),
    };
    const firstBuyUnits = str(args, "first-buy");
    const amount = firstBuyUnits !== undefined ? unitsToRaw(firstBuyUnits, quote.decimals) : 0n;
    firstBuy = amount > 0n ? { quoteAmount: amount, slippageBps: int(args, "slippage-bps", 100)! } : null;
  }

  const quote = input.quote;
  const quoteMint = new PublicKey(quote.mint);
  const { mint: quoteMintInfo, tokenProgram } = await getMintInfo(ctx.sender, quoteMint);
  const built = buildLaunchTransactions(input, payer, {
    ...keypairs,
    quoteTokenProgram: tokenProgram,
    firstBuy: firstBuy ? { quoteAmount: firstBuy.quoteAmount, slippageBps: firstBuy.slippageBps } : undefined,
    computeUnitPriceMicroLamports: int(args, "priority-fee"),
    nowUnixSeconds: clock.unixTimestamp,
  });
  const a = built.addresses;

  log(`quote ${quote.symbol} ${quote.mint}: $${input.quotePriceUsd} per UI token (${priceSource}), multiplier ${input.quoteMultiplier}`);
  log(`threshold ${rawToUnits(built.curve.thresholdQuoteRaw, quote.decimals)} ${quote.symbol} (${built.curve.thresholdQuoteRaw} raw)`);
  log(`preview: start $${built.preview.startPriceUsd.toExponential(4)}, graduation $${built.preview.graduationPriceUsd.toExponential(4)}, floor at graduation $${built.preview.floorAtGraduationUsd.toExponential(4)}, floor per $100 at listing $${built.preview.floorPer100AtListingUsd.toFixed(2)}`);
  log(`graduation split of ${built.curve.thresholdQuoteRaw} raw: vault ${built.preview.vaultAtGraduationQuoteRaw} (${built.preview.vaultSharePct}%), pool ${built.preview.poolQuoteAtGraduationRaw} (${built.preview.poolSharePct}%), platform ${built.preview.platformGraduationFeeQuoteRaw}, creator ${built.preview.creatorGraduationBonusQuoteRaw}`);
  if (built.firstBuyQuote) log(`first buy: ${built.firstBuyQuote.includedFeeInputAmount} raw quote -> ${built.firstBuyQuote.outputAmount} raw base`);

  // What is already on chain (everything is missing on a fresh run).
  const [launchAcc, poolAcc] = await ctx.sender.getMultipleAccountsInfo([a.launch, a.pool]);
  const launchExists = !!launchAcc && launchAcc.owner.equals(STOCKFLOOR_PROGRAM_ID) && isLaunchAccountData(launchAcc.data);
  if (!resumePath && (launchAcc || poolAcc)) throw new CliError(`launch ${a.launch.toBase58()} already has accounts on chain; use --resume`);
  const progress: LaunchChainProgress = {
    launchExists,
    poolExists: !!poolAcc && poolAcc.owner.equals(DBC_PROGRAM_ID),
    poolRegistered: launchExists ? decodeLaunch(launchAcc!.data).poolRegistered : false,
    creatorBaseBalance: await getAtaBalance(ctx.sender, payer, a.baseMint, TOKEN_PROGRAM_ID).catch(() => 0n),
  };
  let decisions: ReturnType<typeof pendingLaunchSteps>;
  try {
    decisions = pendingLaunchSteps(built.transactions.map((t) => t.label), progress);
  } catch (e) {
    throw new CliError(e instanceof Error ? e.message : String(e));
  }
  const toSend = built.transactions.filter((_t, i) => decisions[i]!.send);

  // Pre-flight: a paused quote mint fails every transaction; an unfunded first buy fails tx2 after tx1 landed.
  if (quoteMintInfo.paused) throw new CliError(`${quote.symbol} is paused by its issuer; nothing was sent`);
  const buyTx = toSend.find((t) => t.label.endsWith("first_buy"));
  if (buyTx && firstBuy) {
    const balance = await getAtaBalance(ctx.sender, payer, quoteMint, tokenProgram).catch(() => 0n);
    if (balance < firstBuy.quoteAmount) {
      throw new CliError(
        `the first buy needs ${firstBuy.quoteAmount} raw ${quote.symbol} but ${associatedTokenAddress(payer, quoteMint, tokenProgram).toBase58()} holds ${balance}; nothing was sent`,
      );
    }
  }

  // Persist the keypairs and addresses before anything is sent.
  const sessionPath = resumePath ?? str(args, "session") ?? defaultSessionPath(a.config);
  if (!resumePath) {
    const written = writeLaunchSession(sessionPath, newLaunchSession({ creator: payer, input, firstBuy, configKeypair: built.configKeypair, baseMintKeypair: built.baseMintKeypair, addresses: a }));
    log(`session ${written} (DBC config and base mint keypairs; resume with --resume ${written})`);
  }
  const outFile = str(args, "out");
  const signatures: Array<{ label: string; signature: string; size: number; unitsConsumed?: number }> = [];
  const steps = built.transactions.map((t, i) => ({ label: t.label, status: decisions[i]!.send ? "pending" : "skipped", reason: decisions[i]!.reason, signature: null as string | null }));
  const writeOut = (extra: Record<string, unknown> = {}) => {
    if (outFile) writeFileSync(outFile, json({ addresses: a, session: sessionPath, steps, signatures, preview: built.preview, ...extra }) + "\n");
  };
  writeOut({ state: null });
  for (const s of steps) if (s.status === "skipped") log(`skip ${s.label}: ${s.reason}`);

  for (const tx of toSend) {
    const step = steps.find((s) => s.label === tx.label)!;
    const res = await ctx.sender.send(tx.instructions, { signers: tx.signers, computeUnitLimit: tx.computeUnitLimit, label: tx.label });
    signatures.push({ label: tx.label, signature: res.signature, size: tx.size, unitsConsumed: res.unitsConsumed });
    step.status = "confirmed";
    step.signature = res.signature;
    writeOut({ state: null });
    log(`sent ${tx.label}: ${res.signature} (${tx.size} bytes, ${res.unitsConsumed ?? "?"} CU)`);
  }
  const state = await fetchLaunchState(ctx.sender, { launch: a.launch });
  const summary = state ? stateSummary(state) : null;
  writeOut({ state: summary });
  if (bool(args, "json")) log(json({ addresses: a, session: sessionPath, steps, signatures, preview: built.preview, state: summary }));
  else log(json({ addresses: a, state: summary }));
});
