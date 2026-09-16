/**
 * C2 funding step: spread the deployer's SOL to the four demo wallets and buy the SPYx the C2 demo
 * needs. One command, idempotent, resumable.
 *
 *   packages/sdk/node_modules/.bin/tsx scripts/c2/fund.ts [flags]
 *
 * Stages, each confirmed and recorded before the next one starts:
 *   1. plan      read every balance, the live SPYx requirement and the live prices; print the table
 *                (amounts, destinations, the SOL left on the deployer) and ask for confirmation
 *   2. sol:*     top the four demo wallets up to their target (a funded wallet is skipped)
 *   3. ata:deployer   the deployer's own SPYx token account
 *   4. swap:test a small test swap (about $5), verified against the expected range, then a SECOND
 *                confirmation
 *   5. swap:main the rest of the SPYx
 *   6. ata:*     the SPYx token accounts of creator, buyer1 and buyer2, paid by the deployer
 *   7. spyx:*    transfer each wallet its SPYx
 *   8. verify    re-read every balance from chain, print the end state, exit non-zero on a shortfall
 *   9. report    scripts/c2/reports/fund-<run id>.md and .json (every signature, amount and price)
 *
 * | Flag | Default | Meaning |
 * |---|---|---|
 * | `--rpc <url>` | `$MAINNET_RPC_URL` | Cluster. Mainnet needs a non-loopback URL |
 * | `--allow-mainnet` | off | Half of the SDK send guard's mainnet override |
 * | `--yes-i-am-spending-real-money` | off | Required on mainnet in addition to the two switches |
 * | `--plan-only` | off | Print the plan and stop (read-only; sends nothing) |
 * | `--yes` | off | Answer both confirmations automatically (unattended runs and the fork test) |
 * | `--swap-provider <jupiter\|cheat>` | jupiter on mainnet | `cheat` mints SPYx through a Surfpool cheatcode; local forks only |
 * | `--slippage-bps <n>` | 50 | Hard slippage cap on both swaps |
 * | `--max-deviation-bps <n>` | 200 | Refuse a route whose implied price is further than this from the Jupiter Price V3 mid |
 * | `--test-swap-usd <n>` | 5 | Size of the first, small swap |
 * | `--min-deployer-sol <n>` | 5.05 | SOL the deployer must still hold afterwards (the deploy needs it) |
 * | `--threshold-usd <n>` | 50 | Demo launch threshold, for the live SPYx requirement |
 * | `--quote <symbol>` | SPYx | Quote asset |
 * | `--plan-file <file>` | — | Reuse a `scripts/e2e/plan.ts pre-launch` output instead of running it |
 * | `--price-usd <n>` / `--sol-price-usd <n>` | Jupiter Price V3 | Override the live prices |
 * | `--state <file>` | `target/c2/fund/<mode>.json` | Run state (resume) |
 * | `--reports-dir <dir>` | `scripts/c2/reports` | Where the report is written |
 * | `--new-run` | off | Start a new run id instead of resuming the state file |
 *
 * SAFETY
 * - Sending on mainnet needs ALL of: `--allow-mainnet`, `STOCKFLOOR_ALLOW_MAINNET=1` (the SDK guard
 *   in packages/sdk/src/guard.ts, reused as is), a non-loopback `--rpc` that really is mainnet, and
 *   `--yes-i-am-spending-real-money`. It does NOT need `keys/c2-approved`: that marker authorises
 *   the C2 run itself (scripts/c2/run.sh), not this funding step.
 * - Only keypairs under `keys/` are ever loaded (`loadKeypair` refuses everything else, including
 *   `~/.config/solana/id.json`). Only the deployer's secret key is used; the demo wallets are
 *   addressed by their public keys.
 * - The RPC URL is never printed or written to the report in full (`rpcDisplay`).
 * - Idempotence is derived from chain, not from the state file: every stage recomputes what is
 *   still missing from the balances it just read, so a crash at any point is repaired by running
 *   the same command again.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type * as Web3 from "@solana/web3.js";
import {
  ConnectionSender,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  associatedTokenAddress,
  createAtaIdempotentIx,
  decodeMint,
  decodeTokenAccount,
  effectiveMintMultiplier,
  evaluateSendGuard,
  executeUltraOrder,
  findQuoteAsset,
  findTokenExtension,
  getJupiterPrices,
  getUltraOrder,
  isLoopbackRpcUrl,
  probeCluster,
  WSOL_MINT,
  type SendGuardDecision,
  type UltraOrder,
} from "../../packages/sdk/src/index.ts";
import { loadKeypair } from "../../packages/sdk/src/node/index.ts";
import {
  REPO_ROOT,
  ReadOnlyRpc,
  classifyCluster,
  flag,
  isLoopback,
  loadRehearsalBaseline,
  main,
  parseFlags,
  pubkeyOf,
  readClockUnixTimestamp,
  rpcDisplay,
  sleep,
  switchOn,
  web3,
} from "./lib.ts";
import {
  BPS,
  DEFAULT_FEE_BUFFER_LAMPORTS,
  DEFAULT_MAX_DEVIATION_BPS,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_SWAP_MARGIN_BPS,
  DEFAULT_TEST_SWAP_USD,
  DEPLOYER,
  MIN_DEPLOYER_LAMPORTS,
  PLANNED_FUNDING,
  SPYX_ATA_BYTES,
  buildFundPlan,
  checkSwapQuote,
  checkSwapReceipt,
  evaluateFundGuard,
  fmtInt,
  fmtRaw,
  fmtSol,
  fmtUsd,
  lamportsToUsd,
  maxBig,
  renderPlanTable,
  resolvePendingSwap,
  spyxRawToUsd,
  stageOf,
  table,
  usdToLamports,
  verifyEndState,
  type FundPlan,
  type RunState,
  type StageRecord,
  type SwapProviderName,
  type WalletBalances,
} from "./libfund.ts";

const requireFromSdk = createRequire(
  join(REPO_ROOT, "packages", "sdk", "package.json"),
);
const splToken = requireFromSdk("@solana/spl-token") as {
  createTransferCheckedInstruction(
    source: Web3.PublicKey,
    mint: Web3.PublicKey,
    destination: Web3.PublicKey,
    owner: Web3.PublicKey,
    amount: bigint,
    decimals: number,
    multiSigners?: unknown[],
    programId?: Web3.PublicKey,
  ): Web3.TransactionInstruction;
};

const SOLSCAN = "https://solscan.io";
/** Compute unit limits: a System transfer, an ATA CreateIdempotent, and create + transfer_checked. */
const CU_TRANSFER = 20_000;
const CU_CREATE_ATA = 45_000;
const CU_ATA_AND_TRANSFER = 90_000;

const utcRunId = (d = new Date()) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

/** `export K="V"` lines of scripts/e2e/plan.ts (same parser as scripts/c2/preflight.ts). */
function parsePlanExports(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^export ([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2]!.trim();
    if (value.startsWith('"') && value.endsWith('"'))
      value = JSON.parse(value) as string;
    out[m[1]!] = value;
  }
  return out;
}

/**
 * The live SPYx requirement, computed exactly the way the preflight computes it: the read-only
 * `scripts/e2e/plan.ts pre-launch` planner against this cluster and the live Jupiter price.
 */
function runLivePlan(
  rpc: string,
  thresholdUsd: string,
  quote: string,
  priceUsd?: string,
): Record<string, string> {
  const tsx = join(REPO_ROOT, "packages", "sdk", "node_modules", ".bin", "tsx");
  const args = [
    join(REPO_ROOT, "scripts", "e2e", "plan.ts"),
    "pre-launch",
    "--threshold-usd",
    thresholdUsd,
    "--quote",
    quote,
    "--rpc",
    rpc,
  ];
  if (priceUsd) args.push("--price-usd", priceUsd);
  const res = spawnSync(tsx, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, E2E_RPC_URL: rpc },
  });
  if (res.status !== 0) {
    throw new Error(
      `scripts/e2e/plan.ts failed (exit ${res.status}): ${(res.stderr || res.stdout || "").trim().split("\n").slice(-3).join(" ")}`,
    );
  }
  const plan = parsePlanExports(res.stdout);
  if (!plan.THRESHOLD_RAW || !plan.PRICE_USD)
    throw new Error("scripts/e2e/plan.ts produced no amounts");
  return plan;
}

// ------------------------------------------------------------------ confirmations

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase();
  } finally {
    rl.close();
  }
}

/** Ask until the answer is yes/no; anything else is asked again (never treated as an answer). */
async function confirm(question: string, auto: boolean): Promise<boolean> {
  if (auto) {
    console.log(`${question} yes (--yes)`);
    return true;
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      "stdin is not a terminal and --yes was not given: refusing to continue without an answer",
    );
  }
  for (let i = 0; i < 3; i++) {
    const a = await ask(`${question} `);
    if (a === "yes" || a === "y") return true;
    if (a === "no" || a === "n" || a === "abort") return false;
    console.log("answer 'yes' or 'no'.");
  }
  return false;
}

// ------------------------------------------------------------------ swap providers

interface SwapQuoteInfo {
  lamportsIn: bigint;
  outAmount: bigint;
  routeMinOut: bigint;
  slippageBps: number;
  router: string;
  requestId: string | null;
  /** Base64 unsigned transaction (Jupiter), null for the cheatcode provider. */
  transaction: string | null;
}

interface SwapExecution {
  signature: string | null;
  status: string;
  note: string;
}

interface SwapProvider {
  readonly name: SwapProviderName;
  readonly live: boolean;
  quote(lamportsIn: bigint): Promise<SwapQuoteInfo>;
  execute(q: SwapQuoteInfo): Promise<SwapExecution>;
}

/** Mainnet: Jupiter Ultra. Nothing else in this file can move SPYx onto the deployer. */
function jupiterProvider(opts: {
  quoteMint: string;
  taker: Web3.PublicKey;
  keypair: Web3.Keypair;
  slippageBps: number;
  assertGuard: () => Promise<void>;
}): SwapProvider {
  return {
    name: "jupiter",
    live: true,
    async quote(lamportsIn: bigint): Promise<SwapQuoteInfo> {
      const order: UltraOrder = await getUltraOrder({
        inputMint: WSOL_MINT,
        outputMint: opts.quoteMint,
        amount: lamportsIn,
        taker: opts.taker.toBase58(),
        slippageBps: opts.slippageBps,
      });
      // The route must be the one that was asked for: everything downstream (the deviation check,
      // the minimum received, the balance read) assumes SOL in and this quote asset out.
      if (
        order.inputMint !== WSOL_MINT ||
        order.outputMint !== opts.quoteMint
      ) {
        throw new Error(
          `Jupiter answered with ${order.inputMint} -> ${order.outputMint}, expected ${WSOL_MINT} -> ${opts.quoteMint}`,
        );
      }
      return {
        lamportsIn: order.inAmount,
        outAmount: order.outAmount,
        routeMinOut: order.otherAmountThreshold,
        slippageBps: order.slippageBps,
        router: order.router ?? "jupiter",
        requestId: order.requestId,
        transaction: order.transaction,
      };
    },
    async execute(q: SwapQuoteInfo): Promise<SwapExecution> {
      if (!q.transaction || !q.requestId)
        throw new Error("the Jupiter order carries no transaction to sign");
      // The last gate before a signature exists at all.
      await opts.assertGuard();
      const tx = web3.VersionedTransaction.deserialize(
        Buffer.from(q.transaction, "base64"),
      );
      tx.sign([opts.keypair]);
      const res = await executeUltraOrder(
        Buffer.from(tx.serialize()).toString("base64"),
        q.requestId,
      );
      if (res.error)
        throw new Error(`Jupiter execute failed: ${res.status} ${res.error}`);
      return {
        signature: res.signature,
        status: res.status,
        note: `Jupiter Ultra (${q.router}), in ${res.inputAmountResult ?? q.lamportsIn} lamports, out ${res.outputAmountResult ?? "?"} raw`,
      };
    },
  };
}

/**
 * Local fork only: a stand-in for the swap that mints SPYx into the deployer's token account with
 * Surfpool cheatcodes and deducts the SOL it would have cost. Jupiter has no local fork, so on the
 * fork the swap PATH is not exercised — only everything around it. The report says so.
 */
function cheatProvider(opts: {
  rpcUrl: string;
  deployer: Web3.PublicKey;
  deployerAta: Web3.PublicKey;
  mint: Web3.PublicKey;
  decimals: number;
  multiplier: number;
  spyxUsd: number;
  solUsd: number;
  slippageBps: number;
}): SwapProvider {
  const cheat = async (method: string, params: unknown[]): Promise<unknown> => {
    if (!isLoopback(opts.rpcUrl))
      throw new Error("cheatcodes are refused on a non-loopback RPC");
    const res = await fetch(opts.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as {
      result?: unknown;
      error?: { message: string };
    };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
  const account = async (pubkey: Web3.PublicKey) => {
    const res = (await cheat("getAccountInfo", [
      pubkey.toBase58(),
      { encoding: "base64" },
    ])) as { value: { data: [string, string]; lamports: number } | null };
    if (!res?.value)
      throw new Error(`account ${pubkey.toBase58()} not found on the fork`);
    return {
      data: Buffer.from(res.value.data[0], "base64"),
      lamports: BigInt(res.value.lamports),
    };
  };
  const setAccount = async (
    pubkey: Web3.PublicKey,
    update: Record<string, unknown>,
  ) => {
    await cheat("surfnet_setAccount", [pubkey.toBase58(), update]);
  };
  return {
    name: "cheat",
    live: false,
    async quote(lamportsIn: bigint): Promise<SwapQuoteInfo> {
      // Price the "route" at the Jupiter mid minus 10 bps, the platform fee a real route charges.
      const usd = lamportsToUsd(lamportsIn, opts.solUsd);
      const ui = usd / opts.spyxUsd;
      const raw = BigInt(
        Math.floor(
          ((ui / opts.multiplier) * 10 ** opts.decimals * 9_990) / 10_000,
        ),
      );
      return {
        lamportsIn,
        outAmount: raw,
        routeMinOut: (raw * (BPS - BigInt(opts.slippageBps))) / BPS,
        slippageBps: opts.slippageBps,
        router: "surfpool-cheatcode",
        requestId: null,
        transaction: null,
      };
    },
    async execute(q: SwapQuoteInfo): Promise<SwapExecution> {
      const ata = await account(opts.deployerAta);
      const mint = await account(opts.mint);
      const amountOffset = 64;
      const supplyOffset = 36;
      ata.data.writeBigUInt64LE(
        ata.data.readBigUInt64LE(amountOffset) + q.outAmount,
        amountOffset,
      );
      mint.data.writeBigUInt64LE(
        mint.data.readBigUInt64LE(supplyOffset) + q.outAmount,
        supplyOffset,
      );
      await setAccount(opts.deployerAta, { data: ata.data.toString("hex") });
      await setAccount(opts.mint, { data: mint.data.toString("hex") });
      const payer = await account(opts.deployer);
      if (payer.lamports < q.lamportsIn)
        throw new Error("the deployer cannot pay for the stubbed swap");
      await setAccount(opts.deployer, {
        lamports: Number(payer.lamports - q.lamportsIn),
      });
      return {
        signature: null,
        status: "CheatcodeSuccess",
        note: `Surfpool cheatcode: minted ${fmtInt(q.outAmount)} raw SPYx and charged ${fmtSol(q.lamportsIn)} (NO Jupiter swap was executed)`,
      };
    },
  };
}

// ------------------------------------------------------------------ the run

main(async () => {
  const { flags } = parseFlags(process.argv.slice(2), [
    "allow-mainnet",
    "yes-i-am-spending-real-money",
    "yes",
    "plan-only",
    "new-run",
    "json",
  ]);
  const rpcUrl = flag(flags, "rpc") ?? process.env.MAINNET_RPC_URL;
  if (!rpcUrl) throw new Error("pass --rpc <url> or set MAINNET_RPC_URL");
  const thresholdUsd = flag(flags, "threshold-usd") ?? "50";
  const quoteSymbol = flag(flags, "quote") ?? "SPYx";
  const quote = findQuoteAsset(quoteSymbol);
  if (!quote)
    throw new Error(`${quoteSymbol} is not on the StockFloor quote allowlist`);
  const slippageBps = Number(
    flag(flags, "slippage-bps") ?? DEFAULT_SLIPPAGE_BPS,
  );
  const maxDeviationBps = Number(
    flag(flags, "max-deviation-bps") ?? DEFAULT_MAX_DEVIATION_BPS,
  );
  const testSwapUsd = Number(
    flag(flags, "test-swap-usd") ?? DEFAULT_TEST_SWAP_USD,
  );
  const swapMarginBps = Number(
    flag(flags, "swap-margin-bps") ?? DEFAULT_SWAP_MARGIN_BPS,
  );
  const minDeployerSol = flag(flags, "min-deployer-sol");
  if (
    minDeployerSol !== undefined &&
    (!Number.isFinite(Number(minDeployerSol)) || Number(minDeployerSol) < 0)
  ) {
    throw new Error("--min-deployer-sol must be a non-negative number of SOL");
  }
  const minDeployerLamports =
    minDeployerSol !== undefined
      ? BigInt(Math.round(Number(minDeployerSol) * 1e9))
      : MIN_DEPLOYER_LAMPORTS;
  const priorityFee = Number(flag(flags, "priority-fee") ?? "100000");
  const autoYes = switchOn(flags, "yes");
  const planOnly = switchOn(flags, "plan-only");
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps <= 0 ||
    slippageBps > 1000
  ) {
    throw new Error("--slippage-bps must be an integer in 1..1000");
  }
  if (
    !Number.isInteger(maxDeviationBps) ||
    maxDeviationBps <= 0 ||
    maxDeviationBps > 2000
  ) {
    throw new Error("--max-deviation-bps must be an integer in 1..2000");
  }
  if (!(testSwapUsd > 0)) throw new Error("--test-swap-usd must be positive");

  // ---------------------------------------------------------------- guard
  const rpc = new ReadOnlyRpc(rpcUrl);
  const cluster = await classifyCluster(rpc);
  const guardArgs = {
    rpcUrl,
    allowMainnetFlag: switchOn(flags, "allow-mainnet"),
    allowMainnetEnv: process.env.STOCKFLOOR_ALLOW_MAINNET,
  };
  const sdkGuard = async (): Promise<SendGuardDecision> => {
    const overridden =
      guardArgs.allowMainnetFlag && guardArgs.allowMainnetEnv === "1";
    const probe =
      overridden || isLoopbackRpcUrl(rpcUrl)
        ? await probeCluster(rpcUrl)
        : { genesisHash: null, surfnetVersion: null, surfnetMethodOk: false };
    return evaluateSendGuard({ ...guardArgs, probe });
  };
  const sdkDecision = await sdkGuard();
  const swapProviderName = (flag(flags, "swap-provider") ??
    (cluster.kind === "mainnet" ? "jupiter" : "cheat")) as SwapProviderName;
  if (swapProviderName !== "jupiter" && swapProviderName !== "cheat") {
    throw new Error("--swap-provider takes 'jupiter' or 'cheat'");
  }
  const decision = evaluateFundGuard({
    sdkDecision: {
      allowed: sdkDecision.allowed,
      mode: sdkDecision.allowed ? sdkDecision.mode : undefined,
      reason: sdkDecision.reason,
    },
    loopback: isLoopbackRpcUrl(rpcUrl),
    clusterKind: cluster.kind,
    realMoneyFlag: switchOn(flags, "yes-i-am-spending-real-money"),
    swapProvider: swapProviderName,
  });
  const mode = decision.allowed
    ? decision.mode
    : cluster.kind === "mainnet"
      ? "mainnet"
      : "fork";

  console.log(`StockFloor C2 funding — ${decision.allowed ? mode : "refused"}`);
  console.log(
    `${new Date().toISOString()} · rpc ${rpcDisplay(rpcUrl)} · cluster ${cluster.kind}${cluster.surfnetVersion ? ` (surfnet ${cluster.surfnetVersion})` : ""}`,
  );
  if (!decision.allowed) {
    console.error(decision.reason);
    // `--plan-only` is read-only (it returns before a keypair or a sender exists), so the plan is
    // still worth printing: it is how the user checks the numbers before approving anything.
    if (!planOnly) return 2;
    console.error(
      "(--plan-only: printing the plan anyway; this mode cannot send)",
    );
  } else {
    console.log(`guard: ${decision.reason}`);
  }
  console.log("");

  // ---------------------------------------------------------------- inputs
  const baseline = loadRehearsalBaseline(flag(flags, "rehearsal"));
  const quoteMint = new web3.PublicKey(quote.mint);
  const mintAcc = await rpc.accountInfo(quote.mint);
  if (!mintAcc)
    throw new Error(
      `${quote.symbol} mint ${quote.mint} not found on this cluster`,
    );
  const mintInfo = decodeMint(mintAcc.data);
  const tokenProgram = new web3.PublicKey(mintAcc.owner);
  if (!tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `${quote.symbol} is not a Token-2022 mint (owner ${mintAcc.owner})`,
    );
  }
  if (mintInfo.paused)
    throw new Error(
      `${quote.symbol} transfers are paused right now: try again later`,
    );
  if (mintInfo.transferHookProgramId) {
    throw new Error(
      `${quote.symbol} grew a transfer hook (${mintInfo.transferHookProgramId.toBase58()}): unsupported`,
    );
  }
  if (findTokenExtension(mintAcc.data, ExtensionType.TransferFeeConfig)) {
    throw new Error(
      `${quote.symbol} grew a transfer fee: the amounts in this plan would arrive short`,
    );
  }
  const clockTs = await readClockUnixTimestamp(rpc);
  const multiplier = effectiveMintMultiplier(mintInfo, clockTs);

  // Prices. Jupiter Price V3 is the mid every route is compared against.
  const priceOverride = flag(flags, "price-usd");
  const solPriceOverride = flag(flags, "sol-price-usd");
  let spyxUsd = priceOverride ? Number(priceOverride) : 0;
  let solUsd = solPriceOverride ? Number(solPriceOverride) : 0;
  if (!spyxUsd || !solUsd) {
    const prices = await getJupiterPrices([quote.mint, WSOL_MINT]);
    if (!spyxUsd) spyxUsd = prices[quote.mint]?.usdPrice ?? 0;
    if (!solUsd) solUsd = prices[WSOL_MINT]?.usdPrice ?? 0;
  }
  if (!(spyxUsd > 0) || !(solUsd > 0))
    throw new Error("no live SPYx/SOL price from Jupiter Price V3");

  const livePlan = flag(flags, "plan-file")
    ? parsePlanExports(readFileSync(flag(flags, "plan-file")!, "utf8"))
    : runLivePlan(rpcUrl, thresholdUsd, quoteSymbol, priceOverride);

  // Balances. Every wallet is addressed by the public key of its keys/ file, and the file must
  // still derive the address the runbook names (buildFundPlan enforces that).
  const ataOf = (owner: string) =>
    associatedTokenAddress(new web3.PublicKey(owner), quoteMint, tokenProgram);
  const readWallet = async (
    role: string,
    pubkey: string,
    keyFile: string,
  ): Promise<WalletBalances> => {
    const ata = ataOf(pubkey);
    const acc = await rpc.accountInfo(ata.toBase58());
    return {
      role,
      pubkey,
      keyFile,
      lamports: await rpc.balance(pubkey),
      spyxRaw: acc ? decodeTokenAccount(acc.data).amount : 0n,
      hasSpyxAta: acc !== null,
    };
  };
  const deployerPubkey = pubkeyOf(DEPLOYER.keyFile);
  if (deployerPubkey !== DEPLOYER.pubkey) {
    throw new Error(
      `${DEPLOYER.keyFile} derives ${deployerPubkey}, but the runbook names ${DEPLOYER.pubkey}`,
    );
  }
  const readAll = async () => {
    const wallets: WalletBalances[] = [];
    for (const p of PLANNED_FUNDING)
      wallets.push(await readWallet(p.role, pubkeyOf(p.keyFile), p.keyFile));
    const d = await readWallet(DEPLOYER.role, deployerPubkey, DEPLOYER.keyFile);
    return { wallets, deployer: d };
  };
  let { wallets, deployer } = await readAll();

  // ATA rent: the live figure, never below the rehearsed one.
  const ataRentLive = BigInt(
    await rpc.call<number>("getMinimumBalanceForRentExemption", [
      SPYX_ATA_BYTES,
    ]),
  );
  const ataRentLamports = maxBig(
    ataRentLive,
    BigInt(baseline.totals.spyxAtaRentPerWallet ?? "0"),
  );

  const makePlan = (): FundPlan =>
    buildFundPlan({
      wallets,
      deployer: {
        pubkey: deployer.pubkey,
        lamports: deployer.lamports,
        spyxRaw: deployer.spyxRaw,
        hasSpyxAta: deployer.hasSpyxAta,
      },
      livePlan,
      spyxDecimals: mintInfo.decimals,
      spyxMultiplier: multiplier,
      spyxUsd,
      solUsd,
      ataRentLamports,
      minDeployerLamports,
      feeBufferLamports: DEFAULT_FEE_BUFFER_LAMPORTS,
      swapMarginBps,
    });
  let plan = makePlan();

  // ---------------------------------------------------------------- the plan table
  console.log(renderPlanTable(plan, mintInfo.decimals));
  console.log("");
  console.log(
    table(
      ["", ""],
      [
        [
          "SPYx price (Jupiter Price V3)",
          `$${spyxUsd.toFixed(4)} per SPYx, multiplier ${multiplier}`,
        ],
        ["SOL price", `$${solUsd.toFixed(4)}`],
        [
          "live requirement source",
          `scripts/e2e/plan.ts pre-launch --threshold-usd ${thresholdUsd} (+10% headroom), threshold ${fmtInt(livePlan.THRESHOLD_RAW ?? "0")} raw`,
        ],
        ["SOL to send", `${fmtSol(plan.solToSend)} (${fmtUsd(plan.usd.sol)})`],
        [
          "SPYx to transfer",
          `${fmtInt(plan.spyxToTransfer)} raw (${fmtRaw(plan.spyxToTransfer, mintInfo.decimals)} SPYx)`,
        ],
        [
          "SPYx to buy",
          `${fmtInt(plan.spyxToBuy)} raw ≈ ${fmtUsd(spyxRawToUsd(plan.spyxToBuy, mintInfo.decimals, multiplier, spyxUsd))} through ${swapProviderName}`,
        ],
        [
          "swap input estimate",
          `${fmtSol(plan.swapLamportsEstimate)} (mid price + ${swapMarginBps} bps)`,
        ],
        [
          "token accounts to create",
          `${plan.atasToCreate} x ${fmtSol(ataRentLamports)} = ${fmtSol(plan.ataRentTotal)}`,
        ],
        ["fee buffer", fmtSol(plan.feeBuffer)],
        [
          "TOTAL ABOUT TO MOVE",
          `${fmtSol(plan.deployerSpend)} ≈ ${fmtUsd(plan.usd.total)}`,
        ],
        [
          "deployer now",
          `${fmtSol(plan.deployerBalance)} (${fmtUsd(lamportsToUsd(plan.deployerBalance, solUsd))})`,
        ],
        [
          "deployer afterwards",
          `${fmtSol(plan.deployerLeft)} vs the ${fmtSol(plan.minDeployerLamports)} the deploy needs — ${plan.deployerOk ? "OK" : "TOO LOW"}`,
        ],
      ],
    ),
  );
  console.log("");
  if (plan.abort) {
    console.error(`abort: ${plan.abort}`);
    return 3;
  }
  if (plan.complete) {
    console.log("every wallet already holds its target: nothing to send.");
  }
  if (planOnly) {
    console.log("--plan-only: nothing was sent.");
    return 0;
  }

  // ---------------------------------------------------------------- run state
  const stateFile =
    flag(flags, "state") ??
    join(REPO_ROOT, "target", "c2", "fund", `${mode}.json`);
  let state: RunState | null = null;
  if (!switchOn(flags, "new-run") && existsSync(stateFile)) {
    const loaded = JSON.parse(readFileSync(stateFile, "utf8")) as RunState;
    if (loaded.mode !== mode) {
      throw new Error(
        `${stateFile} belongs to a ${loaded.mode} run; refusing to continue it as a ${mode} run`,
      );
    }
    if (loaded.deployer !== deployer.pubkey) {
      throw new Error(`${stateFile} belongs to deployer ${loaded.deployer}`);
    }
    state = loaded;
    console.log(
      `resuming run ${state.runId} (${state.stages.filter((s) => s.status === "done").length} stages done)`,
    );
  }
  if (!state) {
    state = {
      version: 1,
      runId: utcRunId(),
      mode,
      cluster: cluster.kind,
      deployer: deployer.pubkey,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stages: [],
    };
  }
  const runState = state;
  runState.prices = {
    spyxUsd,
    solUsd,
    spyxMultiplier: multiplier,
    source:
      priceOverride || solPriceOverride
        ? "command line override"
        : "Jupiter Price V3 lite-api",
    at: new Date().toISOString(),
  };

  const reportsDir =
    flag(flags, "reports-dir") ?? join(REPO_ROOT, "scripts", "c2", "reports");
  const reportBase = `fund-${mode === "mainnet" ? "" : "dry-"}${runState.runId}`;

  const writeState = () => {
    runState.updatedAt = new Date().toISOString();
    mkdirSync(dirname(stateFile), { recursive: true });
    const tmp = `${stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(runState, null, 2) + "\n");
    renameSync(tmp, stateFile);
  };
  const record = (r: StageRecord) => {
    runState.stages.push(r);
    writeState();
    writeReport();
  };

  // ---------------------------------------------------------------- sender
  const keypair = loadKeypair(join(REPO_ROOT, DEPLOYER.keyFile));
  const connection = new web3.Connection(rpcUrl, { commitment: "confirmed" });
  let lastGuardCheck = Date.now();
  const assertGuard = async () => {
    const again = await sdkGuard();
    if (!again.allowed) throw new Error(again.reason);
    lastGuardCheck = Date.now();
  };
  const sender = new ConnectionSender(connection, keypair, {
    computeUnitPriceMicroLamports: priorityFee,
    beforeSend: async ({ label }) => {
      if (Date.now() - lastGuardCheck < 30_000) return;
      const again = await sdkGuard();
      if (!again.allowed)
        throw new Error(`${label ?? "transaction"}: ${again.reason}`);
      lastGuardCheck = Date.now();
    },
  });

  const planSnapshot = plan;
  let endState: ReturnType<typeof verifyEndState> | null = null;
  function writeReport(): void {
    mkdirSync(reportsDir, { recursive: true });
    const md = renderReport(runState, planSnapshot, endState, {
      rpc: rpcDisplay(rpcUrl),
      cluster: cluster.kind,
      surfnetVersion: cluster.surfnetVersion,
      swapProvider: swapProviderName,
      slippageBps,
      maxDeviationBps,
      decimals: mintInfo.decimals,
      multiplier,
      spyxUsd,
      solUsd,
      quoteSymbol: quote.symbol,
      quoteMint: quote.mint,
      thresholdUsd,
    });
    writeFileSync(join(reportsDir, `${reportBase}.md`), md);
    writeFileSync(
      join(reportsDir, `${reportBase}.json`),
      JSON.stringify(
        {
          runId: runState.runId,
          mode: runState.mode,
          cluster: cluster.kind,
          rpc: rpcDisplay(rpcUrl),
          swapProvider: swapProviderName,
          prices: runState.prices,
          plan: planJson(planSnapshot),
          stages: runState.stages,
          endState: endState
            ? {
                ok: endState.ok,
                shortfalls: endState.shortfalls,
                rows: endState.rows,
              }
            : null,
        },
        null,
        2,
      ) + "\n",
    );
  }
  writeReport();

  // ---------------------------------------------------------------- confirmation 1
  if (!plan.complete) {
    const ok = await confirm(
      `Send ${fmtSol(plan.solToSend)} to ${plan.wallets.filter((w) => w.solToSend > 0n).length} wallet(s), buy ${fmtInt(plan.spyxToBuy)} raw ${quote.symbol} and move ${fmtUsd(plan.usd.total)} in total on ${mode === "mainnet" ? "MAINNET (real money)" : "the local fork"}? [yes/no]`,
      autoYes,
    );
    if (!ok) {
      console.log("aborted at the plan confirmation; nothing was sent.");
      record({
        id: "confirm:plan",
        status: "failed",
        at: new Date().toISOString(),
        note: "declined",
      });
      return 4;
    }
    record({
      id: "confirm:plan",
      status: "done",
      at: new Date().toISOString(),
      note: autoYes ? "--yes" : "confirmed",
    });
  }

  // ---------------------------------------------------------------- 1. SOL transfers
  for (const w of plan.wallets) {
    const id = `sol:${w.role}`;
    const balance = await rpc.balance(w.pubkey);
    if (balance >= w.solTarget) {
      console.log(
        `${id}: skip, ${w.role} already holds ${fmtSol(balance)} (target ${fmtSol(w.solTarget)})`,
      );
      if (!stageOf(runState, id)) {
        record({
          id,
          status: "skipped",
          at: new Date().toISOString(),
          note: `already holds ${fmtSol(balance)}`,
        });
      }
      continue;
    }
    const lamports = w.solTarget - balance;
    console.log(`${id}: sending ${fmtSol(lamports)} to ${w.pubkey}`);
    const ix = web3.SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new web3.PublicKey(w.pubkey),
      lamports,
    });
    const res = await sender.send([ix], {
      computeUnitLimit: CU_TRANSFER,
      label: id,
    });
    const after = await rpc.balance(w.pubkey);
    if (after < w.solTarget)
      throw new Error(
        `${id}: ${w.role} still holds ${fmtSol(after)} after ${res.signature}`,
      );
    console.log(
      `${id}: done ${res.signature} (${w.role} now ${fmtSol(after)})`,
    );
    record({
      id,
      status: "done",
      at: new Date().toISOString(),
      signature: res.signature,
      note: `${fmtSol(lamports)} to ${w.role}`,
      detail: {
        to: w.pubkey,
        lamports: lamports.toString(),
        balanceAfter: after.toString(),
      },
    });
  }

  // ---------------------------------------------------------------- 2. the deployer's SPYx account
  const deployerAta = ataOf(deployer.pubkey);
  {
    const id = "ata:deployer";
    const acc = await rpc.accountInfo(deployerAta.toBase58());
    if (acc) {
      console.log(`${id}: skip, ${deployerAta.toBase58()} exists`);
      if (!stageOf(runState, id)) {
        record({
          id,
          status: "skipped",
          at: new Date().toISOString(),
          note: "already exists",
        });
      }
    } else {
      const ix = createAtaIdempotentIx(
        keypair.publicKey,
        keypair.publicKey,
        quoteMint,
        tokenProgram,
      );
      const res = await sender.send([ix], {
        computeUnitLimit: CU_CREATE_ATA,
        label: id,
      });
      console.log(`${id}: created ${deployerAta.toBase58()} ${res.signature}`);
      record({
        id,
        status: "done",
        at: new Date().toISOString(),
        signature: res.signature,
        note: `SPYx token account for the deployer`,
        detail: { ata: deployerAta.toBase58() },
      });
    }
  }

  const deployerSpyx = async (): Promise<bigint> => {
    const acc = await rpc.accountInfo(deployerAta.toBase58());
    return acc ? decodeTokenAccount(acc.data).amount : 0n;
  };

  // ---------------------------------------------------------------- 3 + 4. the swaps
  const provider: SwapProvider =
    swapProviderName === "jupiter"
      ? jupiterProvider({
          quoteMint: quote.mint,
          taker: keypair.publicKey,
          keypair,
          slippageBps,
          assertGuard,
        })
      : cheatProvider({
          rpcUrl,
          deployer: keypair.publicKey,
          deployerAta,
          mint: quoteMint,
          decimals: mintInfo.decimals,
          multiplier,
          spyxUsd,
          solUsd,
          slippageBps,
        });

  /** One swap stage: quote, check, record pending, execute, verify what arrived, record done. */
  const runSwap = async (
    id: string,
    lamportsIn: bigint,
    requiredOut: bigint,
  ): Promise<bigint> => {
    const before = await deployerSpyx();
    const pending = resolvePendingSwap(stageOf(runState, id), before);
    if (pending?.landed) {
      console.log(`${id}: ${pending.reason}`);
      record({
        id,
        status: "done",
        at: new Date().toISOString(),
        note: pending.reason,
        detail: { spyxAfter: before.toString() },
      });
      return 0n;
    }
    if (pending) console.log(`${id}: ${pending.reason}; quoting again`);

    let q = await provider.quote(lamportsIn);
    // Every route is ExactIn, so the input is sized against the quote until the output lands in
    // [required, required + 2%]: short of that the stage cannot deliver, far above it the deployer
    // is left holding SPYx dust it did not need.
    for (let i = 0; i < 3 && requiredOut > 0n; i++) {
      if (
        q.outAmount >= requiredOut &&
        q.outAmount <= (requiredOut * 102n) / 100n
      )
        break;
      if (q.outAmount <= 0n) break;
      const scaled =
        (q.lamportsIn * ((requiredOut * 101n) / 100n)) / q.outAmount;
      if (scaled === q.lamportsIn) break;
      console.log(
        `${id}: route returns ${fmtInt(q.outAmount)} raw for ${fmtSol(q.lamportsIn)}, target ${fmtInt(requiredOut)}; re-quoting with ${fmtSol(scaled)}`,
      );
      q = await provider.quote(scaled);
    }
    const check = checkSwapQuote({
      inAmount: q.lamportsIn,
      outAmount: q.outAmount,
      routeMinOut: q.routeMinOut,
      routeSlippageBps: q.slippageBps,
      slippageBps,
      maxDeviationBps,
      requiredOut,
      solUsd,
      spyxUsd,
      spyxDecimals: mintInfo.decimals,
      spyxMultiplier: multiplier,
    });
    console.log(
      `${id}: ${fmtSol(q.lamportsIn)} -> ${fmtInt(q.outAmount)} raw ${quote.symbol} via ${q.router}; ` +
        `implied $${check.impliedUsd.toFixed(4)} vs mid $${check.midUsd.toFixed(4)} (${check.deviationBps > 0 ? "+" : ""}${check.deviationBps} bps), ` +
        `minimum accepted ${fmtInt(check.minOut)}`,
    );
    if (!check.ok) {
      record({
        id,
        status: "failed",
        at: new Date().toISOString(),
        note: check.reasons.join("; "),
      });
      throw new Error(`${id} refused: ${check.reasons.join("; ")}`);
    }
    // The swap must not eat the deploy money either.
    const lamportsNow = await rpc.balance(deployer.pubkey);
    if (lamportsNow - q.lamportsIn < minDeployerLamports) {
      throw new Error(
        `${id} refused: paying ${fmtSol(q.lamportsIn)} would leave the deployer with ${fmtSol(lamportsNow - q.lamportsIn)}, below ${fmtSol(minDeployerLamports)}`,
      );
    }
    record({
      id,
      status: "pending",
      at: new Date().toISOString(),
      note: `about to swap ${fmtSol(q.lamportsIn)}`,
      detail: {
        spyxBefore: before.toString(),
        minOut: check.minOut.toString(),
        quotedOut: q.outAmount.toString(),
        lamportsIn: q.lamportsIn.toString(),
        requestId: q.requestId,
        router: q.router,
      },
    });
    const exec = await provider.execute(q);
    // What arrived, read from chain (the only number that counts).
    let received = 0n;
    for (let i = 0; i < 30; i++) {
      received = (await deployerSpyx()) - before;
      if (received > 0n) break;
      await sleep(1000);
    }
    const receipt = checkSwapReceipt(received, q.outAmount, check.minOut);
    console.log(
      `${id}: received ${fmtInt(received)} raw ${quote.symbol} (${fmtRaw(received, mintInfo.decimals)}), ` +
        `quoted ${fmtInt(q.outAmount)}, accepted range ${fmtInt(receipt.minOut)}..${fmtInt(receipt.maxOut)}${exec.signature ? `, signature ${exec.signature}` : ""}`,
    );
    if (!receipt.ok) {
      record({
        id,
        status: "failed",
        at: new Date().toISOString(),
        signature: exec.signature ?? undefined,
        note: receipt.reasons.join("; "),
        detail: { received: received.toString() },
      });
      throw new Error(`${id} failed: ${receipt.reasons.join("; ")}`);
    }
    record({
      id,
      status: "done",
      at: new Date().toISOString(),
      signature: exec.signature ?? undefined,
      note: exec.note,
      detail: {
        lamportsIn: q.lamportsIn.toString(),
        quotedOut: q.outAmount.toString(),
        minOut: check.minOut.toString(),
        received: received.toString(),
        impliedUsdPerSpyx: check.impliedUsd,
        midUsdPerSpyx: check.midUsd,
        deviationBps: check.deviationBps,
        router: q.router,
        status: exec.status,
      },
    });
    return received;
  };

  const spyxNeededTotal = plan.spyxToTransfer;
  if (spyxNeededTotal > (await deployerSpyx())) {
    // 3. the small test swap
    const testLamports = usdToLamports(testSwapUsd, solUsd);
    if (stageOf(runState, "swap:test")?.status !== "done") {
      console.log("");
      console.log(
        `swap:test: a ${fmtUsd(testSwapUsd)} test swap first (${fmtSol(testLamports)}), to prove the route and the token account`,
      );
      await runSwap("swap:test", testLamports, 0n);
    } else {
      console.log("swap:test: already done in an earlier run");
    }

    // 4. the rest, behind a second confirmation
    const have = await deployerSpyx();
    const remaining = spyxNeededTotal > have ? spyxNeededTotal - have : 0n;
    if (remaining > 0n) {
      const remainingUsd = spyxRawToUsd(
        remaining,
        mintInfo.decimals,
        multiplier,
        spyxUsd,
      );
      console.log("");
      const ok = await confirm(
        `The test swap arrived. Buy the remaining ${fmtInt(remaining)} raw ${quote.symbol} (≈ ${fmtUsd(remainingUsd)}, about ${fmtSol(usdToLamports(remainingUsd, solUsd))})? [yes/no]`,
        autoYes,
      );
      if (!ok) {
        console.log(
          "aborted before the main swap; the SOL transfers and the test swap stand.",
        );
        record({
          id: "confirm:swap",
          status: "failed",
          at: new Date().toISOString(),
          note: "declined",
        });
        return 4;
      }
      record({
        id: "confirm:swap",
        status: "done",
        at: new Date().toISOString(),
        note: autoYes ? "--yes" : "confirmed",
      });
      const lamports =
        (usdToLamports(remainingUsd, solUsd) * (BPS + BigInt(swapMarginBps))) /
        BPS;
      await runSwap("swap:main", lamports, remaining);
    } else {
      console.log(
        "swap:main: the test swap already covered everything that was missing",
      );
    }
  } else {
    console.log("swap: skip, the deployer already holds enough SPYx");
  }

  // ---------------------------------------------------------------- 5 + 6. accounts and transfers
  for (const w of plan.wallets) {
    if (w.spyxTarget === 0n) continue;
    const ata = ataOf(w.pubkey);
    const acc = await rpc.accountInfo(ata.toBase58());
    const balance = acc ? decodeTokenAccount(acc.data).amount : 0n;
    const ataId = `ata:${w.role}`;
    if (acc) {
      if (!stageOf(runState, ataId)) {
        record({
          id: ataId,
          status: "skipped",
          at: new Date().toISOString(),
          note: `${ata.toBase58()} exists`,
        });
      }
      console.log(`${ataId}: skip, ${ata.toBase58()} exists`);
    } else {
      const ix = createAtaIdempotentIx(
        keypair.publicKey,
        new web3.PublicKey(w.pubkey),
        quoteMint,
        tokenProgram,
      );
      const res = await sender.send([ix], {
        computeUnitLimit: CU_CREATE_ATA,
        label: ataId,
      });
      console.log(
        `${ataId}: created ${ata.toBase58()} ${res.signature} (rent paid by the deployer)`,
      );
      record({
        id: ataId,
        status: "done",
        at: new Date().toISOString(),
        signature: res.signature,
        note: `SPYx token account for ${w.role}`,
        detail: { ata: ata.toBase58(), owner: w.pubkey },
      });
    }

    const id = `spyx:${w.role}`;
    if (balance >= w.spyxTarget) {
      console.log(
        `${id}: skip, ${w.role} already holds ${fmtInt(balance)} raw (target ${fmtInt(w.spyxTarget)})`,
      );
      if (!stageOf(runState, id)) {
        record({
          id,
          status: "skipped",
          at: new Date().toISOString(),
          note: `already holds ${fmtInt(balance)} raw`,
        });
      }
      continue;
    }
    const amount = w.spyxTarget - balance;
    const have = await deployerSpyx();
    if (have < amount) {
      throw new Error(
        `${id}: the deployer holds ${fmtInt(have)} raw ${quote.symbol}, ${fmtInt(amount - have)} short`,
      );
    }
    const ix = splToken.createTransferCheckedInstruction(
      deployerAta,
      quoteMint,
      ata,
      keypair.publicKey,
      amount,
      mintInfo.decimals,
      [],
      tokenProgram,
    );
    console.log(
      `${id}: transferring ${fmtInt(amount)} raw ${quote.symbol} to ${w.role}`,
    );
    const res = await sender.send([ix], {
      computeUnitLimit: CU_ATA_AND_TRANSFER,
      label: id,
    });
    const accAfter = await rpc.accountInfo(ata.toBase58());
    const after = accAfter ? decodeTokenAccount(accAfter.data).amount : 0n;
    if (after < w.spyxTarget) {
      throw new Error(
        `${id}: ${w.role} holds ${fmtInt(after)} raw after ${res.signature}, target ${fmtInt(w.spyxTarget)}`,
      );
    }
    console.log(
      `${id}: done ${res.signature} (${w.role} now ${fmtInt(after)} raw)`,
    );
    record({
      id,
      status: "done",
      at: new Date().toISOString(),
      signature: res.signature,
      note: `${fmtInt(amount)} raw ${quote.symbol} to ${w.role}`,
      detail: {
        to: w.pubkey,
        ata: ata.toBase58(),
        raw: amount.toString(),
        balanceAfter: after.toString(),
      },
    });
  }

  // ---------------------------------------------------------------- 7. verify the end state
  console.log("");
  // The report keeps the plan that was executed (`planSnapshot` stays the one printed at the
  // start); the end state is recomputed from freshly read balances.
  ({ wallets, deployer } = await readAll());
  endState = verifyEndState({
    deployer: {
      pubkey: deployer.pubkey,
      lamports: deployer.lamports,
      spyxRaw: deployer.spyxRaw,
    },
    minDeployerLamports,
    wallets: plan.wallets.map((w) => {
      const b = wallets.find((x) => x.role === w.role)!;
      return {
        role: w.role,
        pubkey: w.pubkey,
        solTarget: w.solTarget,
        solBalance: b.lamports,
        spyxTarget: w.spyxTarget,
        spyxBalance: b.spyxRaw,
      };
    }),
    spyxDecimals: mintInfo.decimals,
  });
  console.log(endState.text);
  console.log("");
  record({
    id: "verify",
    status: endState.ok ? "done" : "failed",
    at: new Date().toISOString(),
    note: endState.ok
      ? "every wallet matches the plan"
      : endState.shortfalls.join("; "),
  });
  console.log(
    `report: ${join(reportsDir, `${reportBase}.md`).replace(`${REPO_ROOT}/`, "")}`,
  );
  console.log(`state:  ${stateFile.replace(`${REPO_ROOT}/`, "")}`);
  if (!endState.ok) {
    for (const s of endState.shortfalls) console.error(`shortfall: ${s}`);
    return 5;
  }
  console.log(
    mode === "mainnet"
      ? "funding complete. Next: scripts/c2/preflight.ts should now show every funding row GO."
      : "funding complete on the local fork (the swap stage was a cheatcode, not a real Jupiter swap).",
  );
  return 0;
});

// ------------------------------------------------------------------ report

function planJson(plan: FundPlan): Record<string, unknown> {
  return {
    wallets: plan.wallets.map((w) => ({
      role: w.role,
      pubkey: w.pubkey,
      solTarget: w.solTarget.toString(),
      solBalance: w.solBalance.toString(),
      solToSend: w.solToSend.toString(),
      spyxPlanned: w.spyxPlanned.toString(),
      spyxLive: w.spyxLive.toString(),
      spyxLiveWithHeadroom: w.spyxLiveWithHeadroom.toString(),
      spyxTarget: w.spyxTarget.toString(),
      spyxBalance: w.spyxBalance.toString(),
      spyxToSend: w.spyxToSend.toString(),
    })),
    solToSend: plan.solToSend.toString(),
    spyxToTransfer: plan.spyxToTransfer.toString(),
    spyxToBuy: plan.spyxToBuy.toString(),
    atasToCreate: plan.atasToCreate,
    ataRentLamports: plan.ataRentLamports.toString(),
    swapLamportsEstimate: plan.swapLamportsEstimate.toString(),
    deployerBalance: plan.deployerBalance.toString(),
    deployerSpend: plan.deployerSpend.toString(),
    deployerLeft: plan.deployerLeft.toString(),
    minDeployerLamports: plan.minDeployerLamports.toString(),
    usd: plan.usd,
  };
}

function renderReport(
  state: RunState,
  plan: FundPlan,
  endState: ReturnType<typeof verifyEndState> | null,
  meta: {
    rpc: string;
    cluster: string;
    surfnetVersion: string | null;
    swapProvider: string;
    slippageBps: number;
    maxDeviationBps: number;
    decimals: number;
    multiplier: number;
    spyxUsd: number;
    solUsd: number;
    quoteSymbol: string;
    quoteMint: string;
    thresholdUsd: string;
  },
): string {
  const mainnet = state.mode === "mainnet";
  const md: string[] = [];
  md.push(
    `# StockFloor C2 funding ${mainnet ? "run" : "dry run"} ${state.runId}${mainnet ? "" : " (local Surfpool mainnet fork)"}`,
    "",
  );
  md.push(
    mainnet
      ? "Every signature below is a **mainnet** transaction: the user's own SOL spread to the demo wallets, and SPYx bought through Jupiter."
      : "**Dry run.** Every transaction below was executed by a local Surfpool surfnet and exists only there; the Solscan links will not resolve. The swap stage was a **Surfpool cheatcode**, not a Jupiter swap — the swap path itself is only exercised on mainnet.",
    "",
  );
  md.push("| | |", "|---|---|");
  const rows: Array<[string, string]> = [
    ["Mode", mainnet ? "mainnet" : "dry run (local fork)"],
    [
      "Cluster",
      `${meta.cluster}${meta.surfnetVersion ? ` (surfnet ${meta.surfnetVersion})` : ""}`,
    ],
    ["RPC", meta.rpc],
    ["Deployer", `\`${state.deployer}\``],
    ["Started", state.startedAt],
    ["Updated", state.updatedAt],
    [
      "Swap provider",
      meta.swapProvider === "jupiter"
        ? "Jupiter Ultra (mainnet)"
        : "Surfpool cheatcode (no real swap)",
    ],
    ["Slippage cap", `${meta.slippageBps} bps`],
    [
      "Max price deviation",
      `${meta.maxDeviationBps} bps from the Jupiter Price V3 mid`,
    ],
    [
      "Quote asset",
      `${meta.quoteSymbol} \`${meta.quoteMint}\` (${meta.decimals} decimals, multiplier ${meta.multiplier})`,
    ],
    [
      "Prices used",
      `$${meta.spyxUsd.toFixed(4)} per ${meta.quoteSymbol}, $${meta.solUsd.toFixed(4)} per SOL`,
    ],
    ["Threshold", `$${meta.thresholdUsd}`],
    [
      "Total moved (planned)",
      `${fmtSol(plan.deployerSpend)} ≈ ${fmtUsd(plan.usd.total)}`,
    ],
    [
      "Deployer floor",
      `${fmtSol(plan.minDeployerLamports)} (the deploy needs it)`,
    ],
    [
      "Outcome",
      endState
        ? endState.ok
          ? "every wallet matches the plan"
          : `SHORTFALL: ${endState.shortfalls.join("; ")}`
        : "in progress",
    ],
  ];
  for (const [k, v] of rows) md.push(`| ${k} | ${v} |`);
  md.push("");

  md.push("## Plan", "");
  md.push(
    "| Wallet | Address | SOL target | SOL to send | SPYx planned (§7) | SPYx live +10% | SPYx target | SPYx to send |",
  );
  md.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const w of plan.wallets) {
    md.push(
      `| ${w.role} | \`${w.pubkey}\` | ${fmtSol(w.solTarget)} | ${fmtSol(w.solToSend)} | ${fmtInt(w.spyxPlanned)} | ${fmtInt(w.spyxLiveWithHeadroom)} | ${fmtInt(w.spyxTarget)} | ${fmtInt(w.spyxToSend)} |`,
    );
  }
  md.push("");
  md.push(
    `Totals: **${fmtSol(plan.solToSend)}** of SOL, **${fmtInt(plan.spyxToTransfer)} raw ${meta.quoteSymbol}** ` +
      `(${fmtRaw(plan.spyxToTransfer, meta.decimals)}), of which **${fmtInt(plan.spyxToBuy)} raw** had to be bought; ` +
      `${plan.atasToCreate} token account(s) at ${fmtSol(plan.ataRentLamports)}. ` +
      `Deployer ${fmtSol(plan.deployerBalance)} → **${fmtSol(plan.deployerLeft)}** (floor ${fmtSol(plan.minDeployerLamports)}).`,
    "",
  );

  md.push("## Stages", "");
  md.push("| # | Stage | Status | When | Signature | Note |");
  md.push("|---:|---|---|---|---|---|");
  state.stages.forEach((s, i) => {
    const sig = s.signature
      ? `[\`${s.signature.slice(0, 16)}…\`](${SOLSCAN}/tx/${s.signature})`
      : "—";
    md.push(
      `| ${i + 1} | ${s.id} | ${s.status} | ${s.at} | ${sig} | ${s.note ?? ""} |`,
    );
  });
  md.push("");

  const swaps = state.stages.filter(
    (s) => s.id.startsWith("swap:") && s.status === "done" && s.detail,
  );
  if (swaps.length) {
    md.push("## Swaps", "");
    md.push(
      "| Stage | SOL in | Quoted out | Minimum accepted | Received | Implied $/SPYx | Mid $/SPYx | Deviation | Router |",
    );
    md.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const s of swaps) {
      const d = s.detail!;
      md.push(
        `| ${s.id} | ${fmtSol(BigInt(String(d.lamportsIn ?? "0")))} | ${fmtInt(String(d.quotedOut ?? "0"))} | ${fmtInt(String(d.minOut ?? "0"))} | ${fmtInt(String(d.received ?? "0"))} | ${Number(d.impliedUsdPerSpyx ?? 0).toFixed(4)} | ${Number(d.midUsdPerSpyx ?? 0).toFixed(4)} | ${d.deviationBps ?? "?"} bps | ${d.router ?? "?"} |`,
      );
    }
    md.push("");
  }

  if (endState) {
    md.push("## End state (re-read from chain)", "");
    md.push(
      "| | Wallet | Address | SOL | SOL target | SPYx raw | SPYx target |",
    );
    md.push("|---|---|---|---:|---:|---:|---:|");
    for (const r of endState.rows) md.push(`| ${r.join(" | ")} |`);
    md.push("");
  }

  md.push("## Notes", "");
  md.push(
    `- The SPYx target of each wallet is the larger of the rehearsed plan (docs/research/surfpool-e2e.md §7) and the live requirement recomputed from the Jupiter price, plus the same 10% headroom the preflight applies.`,
    `- Idempotence comes from the balances, not from this file: re-running the command sends only what is still missing.`,
    `- The deployer keeps ${fmtSol(plan.minDeployerLamports)} for the program deploy; the funding aborts rather than dip below it.`,
    mainnet
      ? "- The swap was executed on Jupiter Ultra with a hard slippage cap and a minimum-received assertion read back from chain."
      : "- **The swap path is not exercised here.** On the fork the SPYx is minted by a Surfpool cheatcode; only mainnet runs the Jupiter quote, signature and execute path.",
    "",
  );
  return md.join("\n");
}
