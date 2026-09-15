/**
 * Smoke test of the StockFloor flow's first steps on a LOCAL Surfpool mainnet fork, replayed on the
 * LiteSVM fixture fork for comparison: SPYx-quoted DBC config (SDK params, fee_claimer = the
 * stockfloor claimer PDA) -> DBC pool -> one buy. Optionally create_launch + register_pool.
 *
 *   bash scripts/surfpool/run.sh smoke [--rpc http://127.0.0.1:8899] [--with-launch] [--live-price]
 *                                      [--no-litesvm] [--no-mainnet-check] [--report <path>]
 *
 * --with-launch      also send stockfloor create_launch + register_pool (needs deploy-local first;
 *                    uses tests/src/stockfloor.ts builders and target/idl/stockfloor.json)
 * --live-price       threshold from the Jupiter lite-api SPYx price (default: the C1 constant $757.02)
 * --no-litesvm       skip the LiteSVM replay
 * --no-mainnet-check skip the read-only mainnet getSignatureStatuses check of the local signatures
 * --report <path>    JSON report path (default .surfpool/<rpc-port>/smoke-report.json)
 *
 * Refuses any RPC URL that is not localhost/127.0.0.1. The only non-local requests are read-only:
 * the optional Jupiter price and the mainnet signature-status check (MAINNET_RPC_URL or the public RPC).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type * as Web3 from "../../tests/node_modules/@solana/web3.js";
import { QUOTE_ALLOWLIST } from "../../packages/sdk/src/allowlist.ts";
import { authorityPda, buildDbcConfigParams, effectiveScaledUiMultiplier, type LaunchInput } from "../../packages/sdk/src/index.ts";
import { dbcProgram } from "../../tests/src/anchor.ts";
import {
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  DBC_TOKEN_BADGE_SPYX,
  DAMM_V2_CONFIG_CUSTOMIZABLE,
  SPYX_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../../tests/src/constants.ts";
import { createConfigIx, initializeVirtualPoolWithSplTokenIx, swap2Ix, SwapMode, type DbcPoolKeys } from "../../tests/src/dbc.ts";
// Static imports on purpose: tsx runs this file as CommonJS, and a dynamic import() of the harness
// would go through the ESM loader, where @coral-xyz/anchor's CJS named exports (BN) do not resolve.
import { Fork } from "../../tests/src/fork.ts";
import { createLaunchIx, registerPoolIx } from "../../tests/src/stockfloor.ts";
import { fundSpyx } from "../../tests/src/token.ts";
import { fundToken, fundSol } from "./fund.ts";
import {
  BPF_LOADER_UPGRADEABLE_ID,
  connectSurfnet,
  createAtaIdempotentIx,
  flagString,
  getAta,
  loadRepoKeypair,
  parseArgs,
  REPO_ROOT,
  resolveRpcUrl,
  rpcCall,
  runMain,
  web3,
} from "./lib/surfnet.ts";

const C1_SPYX_USD_PRICE = 757.02;
const STOCKFLOOR_PROGRAM_ID = new web3.PublicKey("98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA");

interface Step {
  name: string;
  ixs: Web3.TransactionInstruction[];
  signers: Web3.Keypair[];
}

interface StepResult {
  name: string;
  surfnet?: { signature: string; computeUnits: number | null; feeLamports: number | null; ms: number; cuLimit: string; logs: number };
  litesvm?: { computeUnits: string; cuLimit: string } | { error: string };
}

function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function readManifest(): any {
  return JSON.parse(readFileSync(join(REPO_ROOT, "tests", "fixtures", "manifest.json"), "utf8"));
}

/** Token-2022 ScaledUiAmountConfig (extension type 25) from mint data. */
function scaledUi(data: Buffer): { multiplier: number; newMultiplier: number; effectiveTs: bigint } | null {
  let off = 166;
  while (off + 4 <= data.length) {
    const t = data.readUInt16LE(off);
    const l = data.readUInt16LE(off + 2);
    if (t === 25) {
      const v = off + 4;
      return { multiplier: data.readDoubleLE(v + 32), effectiveTs: data.readBigInt64LE(v + 40), newMultiplier: data.readDoubleLE(v + 48) };
    }
    if (t === 0 && l === 0) break;
    off += 4 + l;
  }
  return null;
}

async function jupiterUsdPrice(mint: string): Promise<number> {
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, { usdPrice?: number }>;
  const p = body[mint]?.usdPrice;
  if (typeof p !== "number" || !(p > 0)) throw new Error("Jupiter returned no usdPrice");
  return p;
}

/** Send a legacy tx without a ComputeBudget instruction (wallet default limits); retry with 1.4M CU if the default is exceeded. */
async function sendOnSurfnet(connection: Web3.Connection, step: Step): Promise<NonNullable<StepResult["surfnet"]>> {
  for (const cu of [0, 1_400_000]) {
    const tx = new web3.Transaction();
    if (cu > 0) tx.add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: cu }));
    tx.add(...step.ixs);
    tx.feePayer = step.signers[0].publicKey;
    const bh = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.sign(...dedupe(step.signers));
    const t0 = performance.now();
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
    } catch (e) {
      const logs: string[] = (e as { logs?: string[] }).logs ?? [];
      if (cu === 0 && logs.some((l) => /exceeded CUs meter|computational budget exceeded/i.test(l))) {
        console.log(`  ${step.name}: default compute limit exceeded, retrying with 1.4M CU`);
        continue;
      }
      throw new Error(`${step.name} failed on the surfnet: ${(e as Error).message}\n${logs.join("\n")}`);
    }
    const conf = await connection.confirmTransaction({ signature, ...bh }, "confirmed");
    if (conf.value.err) throw new Error(`${step.name} failed: ${JSON.stringify(conf.value.err)}`);
    const ms = performance.now() - t0;
    const got = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    return {
      signature,
      computeUnits: got?.meta?.computeUnitsConsumed ?? null,
      feeLamports: got?.meta?.fee ?? null,
      ms: Math.round(ms),
      cuLimit: cu === 0 ? "default" : String(cu),
      logs: got?.meta?.logMessages?.length ?? 0,
    };
  }
  throw new Error("unreachable");
}

function dedupe(signers: Web3.Keypair[]): Web3.Keypair[] {
  const seen = new Set<string>();
  return signers.filter((s) => !seen.has(s.publicKey.toBase58()) && seen.add(s.publicKey.toBase58()));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ["with-launch", "live-price", "no-litesvm", "no-mainnet-check"]);
  const rpcUrl = resolveRpcUrl(args);
  const { connection, version } = await connectSurfnet(rpcUrl);
  const report: Record<string, unknown> = { at: new Date().toISOString(), rpcUrl, version };
  console.log(`surfnet ${version["surfnet-version"]} (solana-core ${version["solana-core"]}, feature-set ${version["feature-set"]})`);

  // ---------------------------------------------------------------- live state vs fixtures
  const manifest = readManifest();
  const fixtureSha = (address: string) =>
    [...manifest.programs, ...manifest.accounts].find((e: any) => e.address === address || e.programData === address)?.sha256;
  const probes: Array<{ name: string; address: Web3.PublicKey; programData?: boolean }> = [];
  for (const p of manifest.programs) {
    probes.push({ name: `${p.name} programdata`, address: new web3.PublicKey(p.programData ?? p.address), programData: !!p.programData });
  }
  probes.push(
    { name: "SPYx mint", address: SPYX_MINT },
    { name: "DBC token badge (SPYx)", address: DBC_TOKEN_BADGE_SPYX },
    { name: "DBC pool authority", address: DBC_POOL_AUTHORITY },
    { name: "DAMM v2 Customizable config", address: DAMM_V2_CONFIG_CUSTOMIZABLE },
  );
  const liveState: unknown[] = [];
  for (const p of probes) {
    const t0 = performance.now();
    const first = await connection.getAccountInfo(p.address, "confirmed");
    const t1 = performance.now();
    await connection.getAccountInfo(p.address, "confirmed");
    const t2 = performance.now();
    const body = first ? (p.programData ? first.data.subarray(45) : first.data) : null;
    const liveSha = body ? sha256(body) : null;
    const fx = fixtureSha(p.address.toBase58());
    liveState.push({
      name: p.name,
      address: p.address.toBase58(),
      exists: !!first,
      bytes: first?.data.length ?? 0,
      lamports: first?.lamports ?? 0,
      firstFetchMs: Math.round(t1 - t0),
      cachedFetchMs: Math.round(t2 - t1),
      sameAsFixture: fx ? liveSha === fx : null,
    });
  }
  const spyx = (await connection.getAccountInfo(SPYX_MINT, "confirmed"))!;
  const spyxFixture = JSON.parse(readFileSync(join(REPO_ROOT, "tests", "fixtures", "accounts", "spyx_mint.json"), "utf8"));
  const spyxFixtureData = Buffer.from(spyxFixture.account.data[0], "base64");
  const clockAcc = (await connection.getAccountInfo(web3.SYSVAR_CLOCK_PUBKEY, "confirmed"))!;
  const clock = { slot: Number(clockAcc.data.readBigUInt64LE(0)), unixTimestamp: Number(clockAcc.data.readBigInt64LE(32)) };
  const liveScaled = scaledUi(spyx.data)!;
  const multiplier = effectiveScaledUiMultiplier(
    { multiplier: liveScaled.multiplier, newMultiplier: liveScaled.newMultiplier, newMultiplierEffectiveTimestamp: liveScaled.effectiveTs },
    clock.unixTimestamp,
  );
  report.liveState = liveState;
  report.spyx = {
    live: { supply: spyx.data.readBigUInt64LE(36).toString(), bytes: spyx.data.length, scaledUi: { ...liveScaled, effectiveTs: liveScaled.effectiveTs.toString() } },
    fixture: {
      supply: spyxFixtureData.readBigUInt64LE(36).toString(),
      bytes: spyxFixtureData.length,
      scaledUi: (() => {
        const s = scaledUi(spyxFixtureData)!;
        return { ...s, effectiveTs: s.effectiveTs.toString() };
      })(),
    },
    effectiveMultiplierAtSurfnetClock: multiplier,
  };
  report.clock = { ...clock, wallClockUnix: Math.floor(Date.now() / 1000) };
  console.table(liveState);
  console.log("SPYx:", JSON.stringify(report.spyx));
  console.log("surfnet clock:", JSON.stringify(report.clock));

  // ---------------------------------------------------------------- wallets
  const partner = web3.Keypair.generate();
  const creator = web3.Keypair.generate();
  const buyer = web3.Keypair.generate();
  const registrar = web3.Keypair.generate();
  const funder = loadRepoKeypair("keys/deployer.json");
  for (const w of [partner, creator, buyer, registrar]) await fundSol(rpcUrl, w.publicKey, 5);

  // ---------------------------------------------------------------- launch params (SDK)
  let quotePriceUsd = C1_SPYX_USD_PRICE;
  let priceSource = "C1 constant";
  if (args.flags["live-price"]) {
    try {
      quotePriceUsd = await jupiterUsdPrice(SPYX_MINT.toBase58());
      priceSource = "Jupiter lite-api price v3";
    } catch (e) {
      console.warn(`live price unavailable (${(e as Error).message}); using $${C1_SPYX_USD_PRICE}`);
    }
  }
  const configKp = web3.Keypair.generate();
  const baseMintKp = web3.Keypair.generate();
  const config = configKp.publicKey;
  const claimer = authorityPda(config)[0];
  const input: LaunchInput = {
    name: "Surfpool Smoke",
    symbol: "SURF",
    uri: "https://example.com/surf.json",
    quote: QUOTE_ALLOWLIST.find((a) => a.symbol === "SPYx")!,
    quotePriceUsd,
    quoteMultiplier: multiplier,
    preset: "gentle",
    vaultSharePct: 50,
    thresholdUsd: 1000,
    exitFeeBps: 200,
  };
  const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams(input, claimer, claimer);
  const threshold = BigInt(params.migrationQuoteThreshold.toString());
  const buyIn = (threshold * 20n) / 100n;
  report.launch = { quotePriceUsd, priceSource, multiplier, thresholdRaw: threshold.toString(), buyInRaw: buyIn.toString(), config: config.toBase58(), claimer: claimer.toBase58() };
  console.log("launch:", JSON.stringify(report.launch));

  const spyxFunding = await fundToken(rpcUrl, buyer.publicKey, SPYX_MINT, buyIn, funder);

  const init = await initializeVirtualPoolWithSplTokenIx({
    config,
    creator: creator.publicKey,
    baseMint: baseMintKp.publicKey,
    quoteMint: SPYX_MINT,
    payer: creator.publicKey,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    tokenBadge: DBC_TOKEN_BADGE_SPYX,
  });
  const keys: DbcPoolKeys = {
    config,
    pool: init.pool,
    baseMint: baseMintKp.publicKey,
    quoteMint: SPYX_MINT,
    baseVault: init.baseVault,
    quoteVault: init.quoteVault,
    baseTokenProgram: TOKEN_PROGRAM_ID,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
  };
  const buyerBaseAta = getAta(buyer.publicKey, keys.baseMint, TOKEN_PROGRAM_ID);
  const buyerSpyxAta = getAta(buyer.publicKey, SPYX_MINT, TOKEN_2022_PROGRAM_ID);

  const steps: Step[] = [
    {
      name: "dbc create_config (SPYx, badge)",
      ixs: [
        await createConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer: partner.publicKey, params: params as never, tokenBadge: DBC_TOKEN_BADGE_SPYX }),
      ],
      signers: [partner, configKp],
    },
    { name: "dbc initialize_virtual_pool_with_spl_token", ixs: [init.ix], signers: [creator, baseMintKp] },
  ];
  const withLaunch = !!args.flags["with-launch"];
  if (withLaunch) {
    const deployed = await connection.getAccountInfo(STOCKFLOOR_PROGRAM_ID);
    if (!deployed) throw new Error("--with-launch: stockfloor is not deployed on this surfnet; run deploy-local first");
    steps.push(
      {
        name: "stockfloor create_launch",
        ixs: [await createLaunchIx({ payer: partner.publicKey, creator: creator.publicKey, config, baseMint: keys.baseMint, exitFeeBps: 200 })],
        signers: [partner, creator, configKp],
      },
      { name: "stockfloor register_pool", ixs: [await registerPoolIx({ config, pool: keys.pool, baseMint: keys.baseMint })], signers: [registrar] },
    );
    const [pd] = web3.PublicKey.findProgramAddressSync([STOCKFLOOR_PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_ID);
    const pdAcc = await connection.getAccountInfo(pd);
    const file = readFileSync(join(REPO_ROOT, "target", "deploy", "stockfloor.so"));
    report.stockfloorBinary = {
      deployedMatchesFile: !!pdAcc && pdAcc.data.subarray(45, 45 + file.length).equals(file),
      fileSha256: sha256(file),
    };
  }
  steps.push({
    name: "dbc swap2 buy (20% of threshold) + base ATA",
    ixs: [
      createAtaIdempotentIx(buyer.publicKey, buyer.publicKey, keys.baseMint, TOKEN_PROGRAM_ID),
      await swap2Ix({
        keys,
        payer: buyer.publicKey,
        inputTokenAccount: buyerSpyxAta,
        outputTokenAccount: buyerBaseAta,
        amount0: buyIn,
        amount1: 1n,
        swapMode: SwapMode.ExactIn,
      }),
    ],
    signers: [buyer],
  });

  // ---------------------------------------------------------------- run on the surfnet
  const results: StepResult[] = [];
  for (const step of steps) {
    const r = await sendOnSurfnet(connection, step);
    console.log(`surfnet  ${step.name}: ${r.computeUnits} CU, ${r.ms} ms, sig ${r.signature}`);
    results.push({ name: step.name, surfnet: r });
  }

  const poolAcc = (await connection.getAccountInfo(keys.pool, "confirmed"))!;
  const pool = (dbcProgram().coder.accounts as any).decode("virtualPool", poolAcc.data).poolState;
  const base = await connection.getTokenAccountBalance(buyerBaseAta, "confirmed");
  const quote = await connection.getAccountInfo(buyerSpyxAta, "confirmed");
  const quoteLeft = quote!.data.readBigUInt64LE(64);
  const checks = {
    poolQuoteReservePositive: BigInt(pool.quoteReserve.toString()) > 0n,
    buyerReceivedBase: BigInt(base.value.amount) > 0n,
    buyerSpentExactly: quoteLeft === BigInt(spyxFunding.rawAfter) - buyIn,
    configOwnerIsDbc: (await connection.getAccountInfo(config))!.owner.equals(DBC_PROGRAM_ID),
  };
  report.pool = {
    quoteReserve: pool.quoteReserve.toString(),
    sqrtPrice: pool.sqrtPrice.toString(),
    partnerQuoteFee: pool.partnerQuoteFee.toString(),
    buyerBaseRaw: base.value.amount,
    buyerSpyxLeftRaw: quoteLeft.toString(),
  };
  report.checks = checks;
  console.log("pool after buy:", JSON.stringify(report.pool), "checks:", JSON.stringify(checks));
  if (!Object.values(checks).every(Boolean)) throw new Error(`smoke checks failed: ${JSON.stringify(checks)}`);

  // ---------------------------------------------------------------- the same transactions on LiteSVM
  if (!args.flags["no-litesvm"]) {
    const fork = Fork.create({ spike: false, stockfloor: withLaunch });
    for (const w of [partner, creator, buyer, registrar]) fork.airdrop(w.publicKey, 5n * BigInt(web3.LAMPORTS_PER_SOL));
    const fundPayer = fork.newWallet(10);
    fundSpyx(fork, fundPayer, buyer.publicKey, buyIn);
    for (const [i, step] of steps.entries()) {
      let res = fork.sendTx(step.ixs, step.signers, { computeUnits: 0 });
      let cuLimit = "default";
      if (!res.ok && res.logs.some((l) => /exceeded CUs meter|computational budget exceeded/i.test(l))) {
        res = fork.sendTx(step.ixs, step.signers, { computeUnits: 1_400_000 });
        cuLimit = "1400000";
      }
      results[i].litesvm = res.ok ? { computeUnits: res.computeUnits.toString(), cuLimit } : { error: `${res.error} ${res.logs.slice(-3).join(" | ")}` };
      console.log(`litesvm  ${step.name}: ${res.ok ? `${res.computeUnits} CU` : `FAILED ${res.error}`}`);
    }
  }
  report.steps = results;
  console.table(
    results.map((r) => ({
      step: r.name,
      surfnetCU: r.surfnet?.computeUnits,
      litesvmCU: r.litesvm && "computeUnits" in r.litesvm ? Number(r.litesvm.computeUnits) : r.litesvm ? "error" : "-",
      surfnetMs: r.surfnet?.ms,
      feeLamports: r.surfnet?.feeLamports,
    })),
  );

  // ---------------------------------------------------------------- nothing reached mainnet
  const localSigs = results.map((r) => r.surfnet!.signature);
  const recent = await rpcCall<{ value: Array<{ signature: string }> }>(rpcUrl, "surfnet_getLocalSignatures", [1000]);
  const allLocal = [...new Set([...localSigs, ...recent.value.map((v) => v.signature)])];
  if (!args.flags["no-mainnet-check"]) {
    const mainnet = process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
    const statuses: unknown[] = [];
    for (let i = 0; i < allLocal.length; i += 100) {
      const res = await fetch(mainnet, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses", params: [allLocal.slice(i, i + 100), { searchTransactionHistory: true }] }),
      });
      const body = (await res.json()) as { result?: { value: unknown[] }; error?: unknown };
      if (!body.result) throw new Error(`mainnet getSignatureStatuses failed: ${JSON.stringify(body.error)}`);
      statuses.push(...body.result.value);
    }
    const found = statuses.filter((s) => s !== null).length;
    report.mainnetRelayCheck = { signaturesChecked: allLocal.length, foundOnMainnet: found };
    console.log(`mainnet check: ${found} of ${allLocal.length} local signatures exist on mainnet (expected 0)`);
    if (found !== 0) throw new Error("a local signature exists on mainnet");
  }

  const reportPath =
    flagString(args, "report") ?? join(REPO_ROOT, ".surfpool", `rpc-${new URL(rpcUrl).port || "8899"}`, "smoke-report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`report: ${reportPath}`);

}

runMain(import.meta.url, main);
