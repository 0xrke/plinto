/**
 * Renders the C2 run log (`scripts/c2/run.sh`) into `scripts/c2/reports/<run id>.md` and `.json`:
 * the steps, every transaction signature with its Solscan link, the launch addresses and what is
 * irreversible. Called after every step, so a crashed run still leaves a complete log.
 *
 *   tsx scripts/c2/report.ts --run-dir <dir> [--reports-dir scripts/c2/reports]
 *
 * Inputs in the run directory (written by run.sh, kept out of git because the CLI config there
 * carries the RPC URL): meta.env, state.env, steps.tsv, txs.tsv, addresses.tsv. Nothing in the
 * rendered report contains the RPC URL, an API key or a secret key.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, flag, groupDigits, main, parseFlags } from "./lib.ts";

const SOLSCAN = "https://solscan.io";

interface StepRow {
  index: number;
  id: string;
  status: string;
  seconds: string;
  note: string;
}

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2]!;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

function readTsv(path: string): string[][] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t"));
}

main(async () => {
  const { flags } = parseFlags(process.argv.slice(2));
  const runDir = flag(flags, "run-dir");
  if (!runDir) throw new Error("--run-dir <dir> is required");
  const reportsDir =
    flag(flags, "reports-dir") ?? join(REPO_ROOT, "scripts", "c2", "reports");
  mkdirSync(reportsDir, { recursive: true });

  const meta = readEnv(join(runDir, "meta.env"));
  const state = readEnv(join(runDir, "state.env"));
  const steps: StepRow[] = readTsv(join(runDir, "steps.tsv")).map((r, i) => ({
    index: i + 1,
    id: r[0] ?? "",
    status: r[1] ?? "",
    seconds: r[2] ?? "",
    note: r[3] ?? "",
  }));
  const txs = readTsv(join(runDir, "txs.tsv")).map((r) => ({
    step: r[0] ?? "",
    signature: r[1] ?? "",
  }));
  const addresses = readTsv(join(runDir, "addresses.tsv")).map((r) => ({
    label: r[0] ?? "",
    address: r[1] ?? "",
  }));

  const runId = meta.RUN_ID ?? "unknown";
  const mode = meta.MODE === "mainnet" ? "mainnet" : "dry";
  const mainnet = mode === "mainnet";

  // A report is tied to the cluster it was produced on. Rewriting a dry run's committed report as a
  // "mainnet run" (or the other way round) would turn an evidence file into a false one: the Solscan
  // links would point at signatures that only ever existed on a local fork. The mode is part of the
  // run id, so this can only be reached by pointing a run of one mode at the other's run directory.
  const jsonPath = join(reportsDir, `${runId}.json`);
  if (existsSync(jsonPath)) {
    let previous = "";
    try {
      previous =
        (JSON.parse(readFileSync(jsonPath, "utf8")) as { mode?: string })
          .mode ?? "";
    } catch {
      previous = "";
    }
    if (previous && previous !== mode)
      throw new Error(
        `${jsonPath.replace(`${REPO_ROOT}/`, "")} is the report of a ${previous} run; refusing to overwrite it with a ${mode} run. Use a run directory of the matching mode (scripts/c2/run.sh keeps the two apart by run id).`,
      );
  }
  const title = mainnet
    ? `StockFloor C2 mainnet run ${runId}`
    : `StockFloor C2 dry run ${runId} (local Surfpool mainnet fork)`;

  const md: string[] = [];
  md.push(`# ${title}`, "");
  md.push(
    mainnet
      ? "Every signature below is a **mainnet** transaction."
      : "**Dry run.** Every transaction below was executed by a local Surfpool surfnet and exists only there: the Solscan links are shown so the report format matches a mainnet run, and they will not resolve.",
    "",
  );
  md.push("| | |", "|---|---|");
  const metaRows: Array<[string, string | undefined]> = [
    ["Mode", mainnet ? "mainnet" : "dry run (local fork)"],
    ["Cluster", meta.CLUSTER],
    ["RPC", meta.RPC_DISPLAY],
    ["Started", meta.STARTED_AT],
    ["Finished", state.FINISHED_AT ?? "(running)"],
    ["Program", meta.PROGRAM_ID],
    [
      "Binary",
      meta.ELF_SHA
        ? `${groupDigits(meta.ELF_BYTES ?? "0")} bytes, sha256 \`${meta.ELF_SHA}\``
        : undefined,
    ],
    ["Deploy max-len", meta.MAX_LEN ? groupDigits(meta.MAX_LEN) : undefined],
    ["Threshold", meta.THRESHOLD_USD ? `$${meta.THRESHOLD_USD}` : undefined],
    [
      "Quote price at plan",
      meta.PRICE_USD
        ? `$${meta.PRICE_USD} per ${meta.QUOTE ?? "SPYx"}`
        : undefined,
    ],
    [
      "Priority fee",
      meta.PRIORITY_FEE
        ? `${groupDigits(meta.PRIORITY_FEE)} µlamports/CU`
        : undefined,
    ],
    [
      "Token",
      meta.TOKEN_NAME ? `${meta.TOKEN_NAME} (${meta.TOKEN_SYMBOL})` : undefined,
    ],
    ["Metadata URI", meta.TOKEN_URI],
    ["Preflight", state.PREFLIGHT ?? "(not run)"],
    ["Outcome", state.OUTCOME ?? "in progress"],
  ];
  for (const [k, v] of metaRows) if (v) md.push(`| ${k} | ${v} |`);
  md.push("");

  md.push("## Steps", "");
  md.push("| # | Step | Status | Duration | Transactions | Note |");
  md.push("|---:|---|---|---:|---:|---|");
  for (const s of steps) {
    const count = txs.filter((t) => t.step === s.id).length;
    md.push(
      `| ${s.index} | ${s.id} | ${s.status} | ${s.seconds ? `${s.seconds}s` : ""} | ${count || ""} | ${s.note} |`,
    );
  }
  md.push("");

  md.push("## Transactions", "");
  if (txs.length === 0) {
    md.push("_No transaction has been sent yet._", "");
  } else {
    md.push("| # | Step | Signature | Explorer |");
    md.push("|---:|---|---|---|");
    txs.forEach((t, i) => {
      md.push(
        `| ${i + 1} | ${t.step} | \`${t.signature}\` | [solscan](${SOLSCAN}/tx/${t.signature}) |`,
      );
    });
    md.push("");
    // The run state survives a resume; meta.env is rewritten on every pass (older runs recorded the
    // count there).
    const deployTxCount = Number(
      state.DEPLOY_TX_COUNT ?? meta.DEPLOY_TX_COUNT ?? 0,
    );
    if (deployTxCount > 0)
      md.push(
        `The deploy is ${groupDigits(deployTxCount)} BPF loader transactions in total (1 InitializeBuffer + ${groupDigits(deployTxCount - 2)} Write + 1 DeployWithMaxDataLen); the Solana CLI prints only the final signature, which is the one listed above.`,
        "",
      );
  }

  if (addresses.length) {
    md.push("## Addresses", "");
    md.push("| What | Address | Explorer |");
    md.push("|---|---|---|");
    for (const a of addresses)
      md.push(
        `| ${a.label} | \`${a.address}\` | [solscan](${SOLSCAN}/account/${a.address}) |`,
      );
    md.push("");
  }

  md.push("## Irreversible parts of this run", "");
  md.push(
    "- The **program deploy** locks about 2.57 SOL of rent for as long as the program account exists (`solana program close` would return it and is not planned).",
    "- The **SPYx spent** on the curve: about half stays redeemable in the vault, the rest is permanently locked DAMM v2 liquidity plus fees.",
    "- The **token metadata** account is immutable (`TokenAuthorityOption::Immutable`), so name, symbol and URI cannot be changed afterwards.",
    "- The **migrated LP position** is permanently locked; only its fees can ever be claimed, into the vault.",
    "",
    "See `docs/c2-runbook.md` for the abort and recovery procedure of each step.",
    "",
  );

  const mdPath = join(reportsDir, `${runId}.md`);
  writeFileSync(mdPath, md.join("\n"));
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        runId,
        mode,
        meta,
        state,
        steps,
        transactions: txs.map((t) => ({
          ...t,
          explorer: `${SOLSCAN}/tx/${t.signature}`,
        })),
        addresses: addresses.map((a) => ({
          ...a,
          explorer: `${SOLSCAN}/account/${a.address}`,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`report: ${mdPath.replace(`${REPO_ROOT}/`, "")}`);
});
