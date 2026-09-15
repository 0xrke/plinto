/**
 * C2 preflight: everything that must be true before the mainnet run, as one go/no-go table.
 *
 * READ-ONLY. It never sends a transaction: every RPC call goes through `ReadOnlyRpc`, whose method
 * allowlist has no `sendTransaction`, no `requestAirdrop` and no `simulateTransaction`. The only
 * other network calls are the Jupiter Price V3 lite API (public, read-only) and, for the demo
 * amounts, `scripts/e2e/plan.ts` (read-only as well).
 *
 *   packages/sdk/node_modules/.bin/tsx scripts/c2/preflight.ts [flags]
 *
 * | Flag | Default | Meaning |
 * |---|---|---|
 * | `--rpc <url>` | `$MAINNET_RPC_URL` | Cluster to check (mainnet, or a local Surfpool fork for the dry run) |
 * | `--threshold-usd <n>` | 50 | Demo launch threshold (docs/DECISIONS.md) |
 * | `--priority-fee <n>` | 100000 | Planned micro-lamports per CU, compared with recent mainnet levels |
 * | `--quote <symbol>` | SPYx | Quote asset of the demo launch |
 * | `--so <path>` | target/deploy/stockfloor.so | Binary to be deployed |
 * | `--max-len <bytes>` | ELF + 10%, KiB-rounded | `solana program deploy --max-len` (drives the rent) |
 * | `--rehearsal <file>` | newest scripts/e2e/reports/*.json | Rehearsal baseline (binary hash, funding, deploy cost) |
 * | `--plan-file <file>` | — | Reuse an existing `plan.ts pre-launch` output instead of running it |
 * | `--plan-out <file>` | — | Write the plan exports (so the run uses the same price snapshot) |
 * | `--upgrade-headroom` | off | Require the deployer balance that also covers one program upgrade |
 * | `--skip-program-hashes` | off | Skip the DBC / DAMM v2 binary comparison (4.5 MB of reads) |
 * | `--accept-program-drift` | off | Downgrade a DBC / DAMM v2 binary mismatch from NO-GO to a warning |
 * | `--json` / `--out <file>` | — | Machine-readable result for `scripts/c2/run.sh` |
 *
 * Exit code: 0 when the verdict is GO (warnings included), 3 on NO-GO, 1 on an internal error.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  associatedTokenAddress,
  DAMM_V2_POOL_AUTHORITY,
  DBC_POOL_AUTHORITY,
  decodeMint,
  decodeTokenAccount,
  effectiveMintMultiplier,
  findQuoteAsset,
  getJupiterPrices,
  TOKEN_2022_PROGRAM_ID,
} from "../../packages/sdk/src/index.ts";
import {
  DAMM_V2_PROGRAM,
  DBC_PROGRAM,
  MAINNET_GENESIS,
  type ProgramElf,
  ReadOnlyRpc,
  REPO_ROOT,
  STOCKFLOOR_PROGRAM,
  classifyCluster,
  divCeil,
  elfMatches,
  flag,
  groupDigits,
  loadRehearsalBaseline,
  main,
  parseFlags,
  programElfSha256,
  pubkeyOf,
  rawToUnits,
  readRent,
  rentExempt,
  rpcDisplay,
  sha256File,
  sol,
  switchOn,
  web3,
} from "./lib.ts";

type Status = "GO" | "WARN" | "NO-GO";

interface Row {
  id: string;
  label: string;
  status: Status;
  detail: string;
  data?: Record<string, unknown>;
}

const WALLET_ROLES = [
  {
    role: "creator",
    keyFile: "keys/cli-creator.json",
    spyxKey: "CREATOR_SPYX_RAW",
  },
  {
    role: "buyer1",
    keyFile: "keys/cli-buyer1.json",
    spyxKey: "BUYER1_SPYX_RAW",
  },
  {
    role: "buyer2",
    keyFile: "keys/cli-buyer2.json",
    spyxKey: "BUYER2_SPYX_RAW",
  },
  { role: "cranker", keyFile: "keys/cli-cranker.json", spyxKey: null },
] as const;

/** Funding headroom of docs/research/surfpool-e2e.md §7: SPYx plan + 10% for price moves. */
const SPYX_HEADROOM_NUM = 110n;
const SPYX_HEADROOM_DEN = 100n;

/** `export K="V"` lines of scripts/e2e/plan.ts. */
function parsePlan(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^export ([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2]!.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    out[m[1]!] = value;
  }
  return out;
}

function runPlan(
  rpc: string,
  thresholdUsd: string,
  quote: string,
): Record<string, string> {
  const tsx = join(REPO_ROOT, "packages", "sdk", "node_modules", ".bin", "tsx");
  const res = spawnSync(
    tsx,
    [
      join(REPO_ROOT, "scripts", "e2e", "plan.ts"),
      "pre-launch",
      "--threshold-usd",
      thresholdUsd,
      "--quote",
      quote,
      "--rpc",
      rpc,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, E2E_RPC_URL: rpc },
    },
  );
  if (res.status !== 0)
    throw new Error(
      `scripts/e2e/plan.ts failed (exit ${res.status}): ${(res.stderr || res.stdout || "").trim().split("\n").slice(-3).join(" ")}`,
    );
  const plan = parsePlan(res.stdout);
  if (!plan.THRESHOLD_RAW || !plan.PRICE_USD)
    throw new Error("scripts/e2e/plan.ts produced no amounts");
  return plan;
}

main(async () => {
  const { flags } = parseFlags(process.argv.slice(2), [
    "json",
    "upgrade-headroom",
    "skip-program-hashes",
    "accept-program-drift",
  ]);
  const rpcUrl = flag(flags, "rpc") ?? process.env.MAINNET_RPC_URL;
  if (!rpcUrl)
    throw new Error(
      "pass --rpc <url> or set MAINNET_RPC_URL (the cluster to check)",
    );
  const thresholdUsd = flag(flags, "threshold-usd") ?? "50";
  const priorityFee = Number(flag(flags, "priority-fee") ?? "100000");
  const quoteSymbol = flag(flags, "quote") ?? "SPYx";
  const quote = findQuoteAsset(quoteSymbol);
  if (!quote)
    throw new Error(`${quoteSymbol} is not on the StockFloor quote allowlist`);
  const soPath = flag(flags, "so") ?? "target/deploy/stockfloor.so";
  const so = soPath.startsWith("/") ? soPath : join(REPO_ROOT, soPath);
  const baseline = loadRehearsalBaseline(flag(flags, "rehearsal"));
  const acceptDrift = switchOn(flags, "accept-program-drift");

  const rpc = new ReadOnlyRpc(rpcUrl);
  const rows: Row[] = [];
  const add = (row: Row) => {
    rows.push(row);
    return row;
  };
  const rowStatus = (ok: boolean, warn = false): Status =>
    ok ? (warn ? "WARN" : "GO") : "NO-GO";

  // ---------------------------------------------------------------- 1. cluster
  const cluster = await classifyCluster(rpc);
  add({
    id: "rpc",
    label: "mainnet RPC",
    status:
      cluster.kind === "mainnet"
        ? "GO"
        : cluster.kind === "surfnet"
          ? "WARN"
          : "NO-GO",
    detail:
      cluster.kind === "mainnet"
        ? `${rpcDisplay(rpcUrl)} healthy, solana-core ${cluster.solanaCore}, slot ${groupDigits(cluster.slot ?? 0)}, genesis mainnet`
        : cluster.kind === "surfnet"
          ? `${rpcDisplay(rpcUrl)} is a LOCAL Surfpool surfnet ${cluster.surfnetVersion} (dry run, not mainnet)`
          : `${rpcDisplay(rpcUrl)}: ${cluster.error ?? `genesis ${cluster.genesis} is not mainnet (${MAINNET_GENESIS})`}`,
    data: { ...cluster, url: rpcDisplay(rpcUrl) },
  });
  if (cluster.kind === "unknown") {
    // Nothing else can be checked without a working endpoint.
    return finish(rows, flags, {
      rpc: rpcDisplay(rpcUrl),
      thresholdUsd,
      priorityFee,
    });
  }

  // ---------------------------------------------------------------- 2. the binary to deploy
  const expectedSha = flag(flags, "expect-sha") ?? baseline.params.ELF_SHA256;
  let elfBytes = 0;
  let elfSha = "";
  if (!existsSync(so)) {
    add({
      id: "binary",
      label: "stockfloor.so",
      status: "NO-GO",
      detail: `${soPath} not found (bash scripts/build-programs.sh -p stockfloor)`,
    });
  } else {
    elfBytes = statSync(so).size;
    elfSha = sha256File(so);
    const same = elfSha === expectedSha;
    add({
      id: "binary",
      label: "stockfloor.so",
      status: rowStatus(same),
      detail: same
        ? `${groupDigits(elfBytes)} bytes, sha256 ${elfSha.slice(0, 16)}… = the rehearsed binary (${baseline.runId})`
        : `sha256 ${elfSha.slice(0, 16)}… != rehearsed ${String(expectedSha).slice(0, 16)}… (${baseline.file}): rebuild or re-run the rehearsal`,
      data: { bytes: elfBytes, sha256: elfSha, expected: expectedSha },
    });
  }

  const maxLen = Number(
    flag(flags, "max-len") ??
      (elfBytes > 0
        ? Math.ceil((elfBytes * 1.1) / 1024) * 1024
        : Number(baseline.params.MAX_LEN)),
  );

  // ---------------------------------------------------------------- 3. program id still free
  const programAccount = await rpc.accountInfo(STOCKFLOOR_PROGRAM);
  if (!programAccount) {
    add({
      id: "program-id",
      label: "program id free",
      status: "GO",
      detail: `${STOCKFLOOR_PROGRAM} does not exist yet`,
      data: { deployed: false },
    });
  } else {
    let deployed: ProgramElf | null = null;
    let readError = "";
    try {
      deployed = await programElfSha256(rpc, STOCKFLOOR_PROGRAM, elfBytes);
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e);
    }
    // A redeploy of the identical ELF is the resume case: the run then skips the deploy step.
    const identical = elfMatches(deployed, elfSha, elfBytes);
    add({
      id: "program-id",
      label: "program id free",
      status: identical ? "WARN" : "NO-GO",
      detail: identical
        ? `${STOCKFLOOR_PROGRAM} is ALREADY deployed with this exact binary: the run skips the deploy step (resume)`
        : `${STOCKFLOOR_PROGRAM} is occupied: ${readError || `the deployed binary (${groupDigits(deployed?.size ?? 0)} bytes, sha ${(deployed?.prefixSha256 ?? deployed?.sha256 ?? "").slice(0, 16)}…) differs from the local one`} — stop and investigate`,
      data: { deployed: true, identical, ...deployed },
    });
  }

  // ---------------------------------------------------------------- 4. rent and deploy cost
  const rent = await readRent(rpc);
  const programdataRent = rentExempt(rent, maxLen + 45);
  const programRent = rentExempt(rent, 36);
  const writeChunk = Math.ceil(
    Number(baseline.params.ELF_BYTES) /
      Number(baseline.deploy.measured.writeTxs ?? 478),
  );
  const writeTxs =
    elfBytes > 0
      ? Math.ceil(elfBytes / writeChunk)
      : Number(baseline.deploy.measured.writeTxs);
  const deployFees =
    10_282n +
    10_297n +
    BigInt(writeTxs) * BigInt(baseline.deploy.measured.writeFeeEach ?? 5267);
  const deployCost = programdataRent + programRent + deployFees;
  const baselineCost = BigInt(baseline.deploy.measured.netCost ?? 0);
  const rentChanged = deployCost > baselineCost;
  add({
    id: "rent",
    label: "deploy cost",
    status: rentChanged ? "WARN" : "GO",
    detail: `${sol(deployCost)} = programdata rent ${sol(programdataRent)} (max-len ${groupDigits(maxLen)} + 45 B at ${groupDigits(rent.lamportsPerByteYear)} lamports/byte) + program account ${sol(programRent)} + ${2 + writeTxs} tx fees ${groupDigits(deployFees)} lamports${rentChanged ? ` — above the rehearsed ${sol(baselineCost)}` : ""}`,
    data: {
      maxLen,
      writeTxs,
      programdataRent: programdataRent.toString(),
      deployCost: deployCost.toString(),
      rehearsedCost: baselineCost.toString(),
      lamportsPerByteYear: rent.lamportsPerByteYear.toString(),
    },
  });

  // ---------------------------------------------------------------- 5. demo amounts (live price)
  const planFile = flag(flags, "plan-file");
  const plan = planFile
    ? parsePlan(
        readFileSync(
          planFile.startsWith("/") ? planFile : join(REPO_ROOT, planFile),
          "utf8",
        ),
      )
    : runPlan(rpcUrl, thresholdUsd, quoteSymbol);
  const planOut = flag(flags, "plan-out");
  if (planOut)
    writeFileSync(
      planOut.startsWith("/") ? planOut : join(REPO_ROOT, planOut),
      Object.entries(plan)
        .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
        .join("\n") + "\n",
    );

  // ---------------------------------------------------------------- 6. quote mint state
  const quoteMint = new web3.PublicKey(quote.mint);
  const mintAccount = await rpc.accountInfo(quote.mint);
  if (!mintAccount) {
    add({
      id: "quote-mint",
      label: `${quote.symbol} mint`,
      status: "NO-GO",
      detail: `${quote.mint} not found on this cluster`,
    });
  } else {
    const mint = decodeMint(mintAccount.data);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const multiplier = effectiveMintMultiplier(mint, nowSeconds);
    const blocked = mint.paused || mint.transferHookProgramId !== null;
    add({
      id: "quote-mint",
      label: `${quote.symbol} mint`,
      status: rowStatus(!blocked),
      detail: mint.paused
        ? `PAUSED by the issuer: every swap, harvest and redeem would fail — do not start`
        : mint.transferHookProgramId
          ? `transfer hook ${mint.transferHookProgramId.toBase58()} is set: unsupported by this program version (documented limitation) — do not start`
          : `not paused, no transfer hook, multiplier ${multiplier}, ${mint.decimals} decimals, supply ${groupDigits(mint.supply)}`,
      data: {
        paused: mint.paused,
        transferHook: mint.transferHookProgramId?.toBase58() ?? null,
        multiplier,
        decimals: mint.decimals,
      },
    });
  }

  // ---------------------------------------------------------------- 7. live price and threshold
  let jupPrice: number | null = null;
  try {
    const prices = await getJupiterPrices([quote.mint]);
    jupPrice = prices[quote.mint]?.usdPrice ?? null;
  } catch {
    jupPrice = null;
  }
  const thresholdRaw = BigInt(plan.THRESHOLD_RAW!);
  const planPrice = Number(plan.PRICE_USD);
  const drift = jupPrice ? Math.abs(jupPrice - planPrice) / planPrice : 0;
  add({
    id: "price",
    label: `${quote.symbol} price`,
    status: jupPrice === null ? "WARN" : drift > 0.02 ? "WARN" : "GO",
    detail:
      jupPrice === null
        ? `Jupiter Price V3 unreachable; the run would have no price baseline (plan price $${planPrice})`
        : `$${jupPrice.toFixed(4)} per ${quote.symbol} (Jupiter Price V3), multiplier ${plan.QUOTE_MULTIPLIER} → threshold $${thresholdUsd} = ${groupDigits(thresholdRaw)} raw (${rawToUnits(thresholdRaw, quote.decimals)} ${quote.symbol})${drift > 0.02 ? `, ${(drift * 100).toFixed(2)}% off the planned amounts — re-run the plan` : ""}`,
    data: {
      priceUsd: jupPrice,
      planPriceUsd: planPrice,
      thresholdRaw: thresholdRaw.toString(),
      thresholdUsd,
      multiplier: plan.QUOTE_MULTIPLIER,
      firstBuyRaw: plan.FIRST_BUY_RAW,
      buyer1BuyRaw: plan.BUYER1_BUY_RAW,
      buyer2OfferRaw: plan.BUYER2_OFFER_RAW,
    },
  });

  // ---------------------------------------------------------------- 8. funding
  const deployer = pubkeyOf("keys/deployer.json");
  const deployerBalance = await rpc.balance(deployer);
  const upgradeHeadroom = switchOn(flags, "upgrade-headroom");
  // One upgrade needs the programdata rent again at once (buffer), refunded by `Upgrade`.
  const upgradeNeed = upgradeHeadroom
    ? rentExempt(rent, Number(baseline.params.ELF_BYTES) + 45)
    : 0n;
  const deployerRecommended =
    (deployCost * 102n) / 100n + 50_000_000n + upgradeNeed;
  add({
    id: "fund-deployer",
    label: "deployer funded",
    status:
      deployerBalance >= deployerRecommended
        ? "GO"
        : deployerBalance >= deployCost
          ? "WARN"
          : "NO-GO",
    detail: `${deployer.slice(0, 8)}… has ${sol(deployerBalance)}; needs ${sol(deployCost)}${upgradeHeadroom ? ` + ${sol(upgradeNeed)} upgrade headroom` : ""}, recommended ${sol(deployerRecommended)}`,
    data: {
      pubkey: deployer,
      lamports: deployerBalance.toString(),
      needed: deployCost.toString(),
      recommended: deployerRecommended.toString(),
    },
  });

  for (const w of WALLET_ROLES) {
    const pubkey = pubkeyOf(w.keyFile);
    const base = baseline.wallets.find((b) => b.role === w.role);
    const solNeeded = BigInt(base?.spent ?? "0");
    const solRecommended = BigInt(base?.recommendedLamports ?? "0");
    const balance = await rpc.balance(pubkey);
    const spyxNeeded = w.spyxKey ? BigInt(plan[w.spyxKey] ?? "0") : 0n;
    const spyxRecommended = divCeil(
      spyxNeeded * SPYX_HEADROOM_NUM,
      SPYX_HEADROOM_DEN,
    );
    let spyxBalance = 0n;
    if (w.spyxKey) {
      const ata = associatedTokenAddress(
        new web3.PublicKey(pubkey),
        quoteMint,
        TOKEN_2022_PROGRAM_ID,
      );
      const acc = await rpc.accountInfo(ata.toBase58());
      spyxBalance = acc ? decodeTokenAccount(acc.data).amount : 0n;
    }
    const solOk = balance >= solNeeded;
    const spyxOk = spyxBalance >= spyxNeeded;
    const thin =
      balance < solRecommended ||
      (w.spyxKey !== null && spyxBalance < spyxRecommended);
    add({
      id: `fund-${w.role}`,
      label: `${w.role} funded`,
      status: solOk && spyxOk ? (thin ? "WARN" : "GO") : "NO-GO",
      detail: `${pubkey.slice(0, 8)}… ${sol(balance)} (need ${sol(solNeeded)}, rec. ${sol(solRecommended)})${
        w.spyxKey
          ? `, ${quote.symbol} ${groupDigits(spyxBalance)} raw (need ${groupDigits(spyxNeeded)}, rec. ${groupDigits(spyxRecommended)})`
          : ""
      }`,
      data: {
        pubkey,
        lamports: balance.toString(),
        lamportsNeeded: solNeeded.toString(),
        spyxRaw: spyxBalance.toString(),
        spyxNeeded: spyxNeeded.toString(),
        spyxRecommended: spyxRecommended.toString(),
      },
    });
  }

  // ---------------------------------------------------------------- 9. external program binaries
  if (switchOn(flags, "skip-program-hashes")) {
    add({
      id: "meteora-binaries",
      label: "DBC / DAMM v2",
      status: "WARN",
      detail:
        "skipped (--skip-program-hashes): the rehearsal evidence assumes the fixture binaries",
    });
  } else {
    const fixtures = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "tests", "fixtures", "manifest.json"),
        "utf8",
      ),
    ) as { programs: Array<{ name: string; address: string; sha256: string }> };
    for (const [label, address] of [
      ["DBC", DBC_PROGRAM],
      ["DAMM v2", DAMM_V2_PROGRAM],
    ] as const) {
      const fixture = fixtures.programs.find((p) => p.address === address);
      try {
        const live = await programElfSha256(rpc, address);
        const match = !!live && !!fixture && live.sha256 === fixture.sha256;
        add({
          id: `binary-${label === "DBC" ? "dbc" : "damm"}`,
          label: `${label} binary`,
          status: match ? "GO" : acceptDrift ? "WARN" : "NO-GO",
          detail: match
            ? `${address.slice(0, 8)}… sha256 ${live!.sha256.slice(0, 16)}… = tests/fixtures (${groupDigits(live!.size)} bytes)`
            : `${address.slice(0, 8)}… sha256 ${live?.sha256.slice(0, 16) ?? "missing"}… != fixture ${fixture?.sha256.slice(0, 16)}…: Meteora upgraded the program, the rehearsal evidence is stale`,
          data: {
            address,
            live: live?.sha256 ?? null,
            fixture: fixture?.sha256 ?? null,
          },
        });
      } catch (e) {
        add({
          id: `binary-${label === "DBC" ? "dbc" : "damm"}`,
          label: `${label} binary`,
          status: "WARN",
          detail: `could not read the program: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  // ---------------------------------------------------------------- 10. priority fees
  try {
    // getRecentPrioritizationFees reports, per recent slot, the *minimum* fee that landed, so the
    // percentiles are usually 0 and only the maximum is informative. Sampled twice: cluster-wide,
    // and restricted to transactions that lock the DBC / DAMM v2 pool authorities writable (the
    // accounts our launch, crank and trade transactions contend for).
    const sample = async (accounts: string[]) => {
      const raw = await rpc.call<
        Array<{ slot: number; prioritizationFee: number }>
      >("getRecentPrioritizationFees", [accounts]);
      const fees = raw.map((s) => s.prioritizationFee).sort((a, b) => a - b);
      const q = (p: number) =>
        fees.length
          ? fees[Math.min(fees.length - 1, Math.floor(fees.length * p))]!
          : 0;
      return {
        p50: q(0.5),
        p90: q(0.9),
        max: fees[fees.length - 1] ?? 0,
        slots: fees.length,
      };
    };
    const global = await sample([]);
    const meteora = await sample([
      DBC_POOL_AUTHORITY.toBase58(),
      DAMM_V2_POOL_AUTHORITY.toBase58(),
    ]);
    const ceiling = Math.max(global.max, meteora.max);
    add({
      id: "priority-fee",
      label: "priority fees",
      status: priorityFee >= ceiling ? "GO" : "WARN",
      detail: `planned ${groupDigits(priorityFee)} µlamports/CU vs the last ${meteora.slots} slots: cluster p50 ${groupDigits(global.p50)} / max ${groupDigits(global.max)}, DBC+DAMM accounts p50 ${groupDigits(meteora.p50)} / p90 ${groupDigits(meteora.p90)} / max ${groupDigits(meteora.max)}${priorityFee >= ceiling ? "" : " — raise --priority-fee"}`,
      data: { planned: priorityFee, global, meteora },
    });
  } catch (e) {
    add({
      id: "priority-fee",
      label: "priority fees",
      status: "WARN",
      detail: `getRecentPrioritizationFees unavailable (${e instanceof Error ? e.message : String(e)}); keeping the planned ${groupDigits(priorityFee)} µlamports/CU`,
    });
  }

  // ---------------------------------------------------------------- 11. xStocks pause window
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const inPauseWindow = utcMinutes >= 15 && utcMinutes <= 45;
  add({
    id: "timing",
    label: "timing window",
    status: inPauseWindow ? "WARN" : "GO",
    detail: inPauseWindow
      ? `${now.toISOString().slice(11, 16)} UTC is inside the 00:15–00:45 UTC window where xStocks may pause around a multiplier activation — wait`
      : `${now.toISOString().slice(11, 16)} UTC, outside the 00:15–00:45 UTC xStocks multiplier window`,
  });

  // ---------------------------------------------------------------- 12. approval and metadata URI
  const approved = existsSync(join(REPO_ROOT, "keys", "c2-approved"));
  add({
    id: "approval",
    label: "user approval",
    status: approved ? "GO" : "WARN",
    detail: approved
      ? "keys/c2-approved exists (run.sh --mainnet may start)"
      : "keys/c2-approved is missing: run.sh --mainnet refuses to start until the user creates it",
    data: { approved },
  });

  const uri = process.env.TOKEN_URI ?? "";
  const uriOk = /^https:\/\/\S+$/.test(uri) && uri.length <= 200;
  add({
    id: "token-uri",
    label: "token metadata URI",
    status: uriOk ? "GO" : "WARN",
    detail: uriOk
      ? `TOKEN_URI set (${uri.length} characters; the rehearsal measured a 607-byte metadata account at 88)`
      : "TOKEN_URI is unset or not an https URL: the user must choose and host the metadata JSON (publishing is a hard stop)",
    data: { length: uri.length },
  });

  return finish(rows, flags, {
    rpc: rpcDisplay(rpcUrl),
    thresholdUsd,
    priorityFee,
    plan,
    baseline: baseline.file,
    cluster: cluster.kind,
  });
});

function finish(
  rows: Row[],
  flags: Record<string, string | true>,
  meta: Record<string, unknown>,
): number {
  const noGo = rows.filter((r) => r.status === "NO-GO");
  const warn = rows.filter((r) => r.status === "WARN");
  const verdict = noGo.length > 0 ? "NO-GO" : "GO";
  const result = {
    verdict,
    generatedAt: new Date().toISOString(),
    ...meta,
    counts: {
      total: rows.length,
      warnings: warn.length,
      blockers: noGo.length,
    },
    rows,
  };
  const out = flag(flags, "out");
  if (out)
    writeFileSync(
      out.startsWith("/") ? out : join(REPO_ROOT, out),
      JSON.stringify(result, null, 2) + "\n",
    );
  if (switchOn(flags, "json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const width = Math.max(...rows.map((r) => r.label.length));
    console.log("");
    console.log("StockFloor C2 preflight — read-only, nothing is sent");
    console.log(
      `${result.generatedAt} · rpc ${meta.rpc} · threshold $${meta.thresholdUsd} · priority fee ${groupDigits(String(meta.priorityFee))} µlamports/CU`,
    );
    console.log("");
    console.log(`${"STATUS".padEnd(7)} ${"CHECK".padEnd(width)}  DETAIL`);
    console.log("-".repeat(7 + width + 60));
    for (const r of rows)
      console.log(
        `${r.status.padEnd(7)} ${r.label.padEnd(width)}  ${r.detail}`,
      );
    console.log("-".repeat(7 + width + 60));
    console.log(
      `VERDICT: ${verdict} — ${rows.length} checks, ${warn.length} warning(s), ${noGo.length} blocker(s)`,
    );
    if (noGo.length)
      console.log(`blockers: ${noGo.map((r) => r.id).join(", ")}`);
    console.log("");
  }
  return verdict === "GO" ? 0 : 3;
}
