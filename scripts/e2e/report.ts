/**
 * Report of a C2 rehearsal run: per-step and per-transaction costs, account rent, wallet totals,
 * deploy cost options, the C2 funding requirement, the list of mainnet transactions C2 will send,
 * and read-only mainnet checks (no local signature and no created account exists on mainnet).
 *
 *   tsx scripts/e2e/report.ts --launch <addr> [--save]
 *
 * Needs the rehearsal surfnet still running (labels come from the launch state). Writes
 * $E2E_RUN_DIR/report.json and report.md; --save also copies them to scripts/e2e/reports/.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  ConnectionSender,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  dammV2TokenVaultPda,
  decodeDammV2Position,
  fetchLaunchState,
  metaplexMetadataPda,
} from "../../packages/sdk/src/index.ts";
import type { Ledger, Step, TxRecord } from "./ledger.ts";
import {
  REPO_ROOT,
  SPYX_MINT,
  USDC_MINT,
  WSOL_MINT,
  connectSurfnet,
  divCeil,
  flag,
  jupiterPrices,
  localRpcUrl,
  main,
  mainnetRead,
  parseFlags,
  rawToUnits,
  readJson,
  readRentSysvar,
  rentExempt,
  rpcCall,
  runDir,
  web3,
  writeJsonAtomic,
} from "./lib.ts";

const STOCKFLOOR = "98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA";
const BPF_LOADER = new web3.PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const SOL = 1_000_000_000n;

const fmtInt = (v: bigint | number | string) =>
  BigInt(v).toLocaleString("en-US");
const fmtSol = (lamports: bigint | number | string, digits = 6) =>
  (Number(BigInt(lamports)) / 1e9).toFixed(digits);
const usd = (x: number) => `$${x.toFixed(2)}`;
/** Markdown table; "r" columns are right-aligned. */
const mdTable = (
  head: Array<[string, "l" | "r"]>,
  rows: Array<Array<string | number>>,
) =>
  [
    `| ${head.map((h) => h[0]).join(" | ")} |`,
    `|${head.map((h) => (h[1] === "r" ? "---:" : "---")).join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^(?:export )?([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2]!;
    if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
    out[m[1]!] = v;
  }
  return out;
}

const roundUp = (lamports: bigint, step: bigint) =>
  divCeil(lamports, step) * step;

main(async () => {
  const { flags } = parseFlags(process.argv.slice(2), ["save"]);
  const dir = runDir();
  const rpc = localRpcUrl();
  const { connection } = await connectSurfnet(rpc);
  const ledger = readJson<Ledger>(join(dir, "ledger.json"));
  const params = parseEnv(join(dir, "params.env"));
  const plan = parseEnv(join(dir, "plan.env"));
  const launchFile = readJson<{
    addresses: Record<string, string | null>;
    signatures: unknown[];
  }>(join(dir, "launch.json"));
  const launchAddr = flag(flags, "launch") ?? launchFile.addresses.launch!;
  const reader = new ConnectionSender(connection, {
    publicKey: web3.PublicKey.default,
    signTransaction: async () => {
      throw new Error("read-only");
    },
  });

  // ------------------------------------------------------------ labels
  const labels = new Map<string, string>();
  const ctxLabel: Record<string, string> = {
    config: "DBC config",
    launch: "stockfloor Launch",
    vault: "floor vault (SPYx ATA of the vault authority)",
    baseMint: "base mint",
    pool: "DBC virtual pool",
    dbcBaseVault: "DBC base vault",
    dbcQuoteVault: "DBC quote vault (SPYx)",
    claimerBaseAccount: "claimer base ATA",
  };
  const addLaunchLabels = (
    addresses: Record<string, string | null>,
    prefix: string,
  ) => {
    for (const [k, v] of Object.entries(addresses))
      if (v && ctxLabel[k]) labels.set(v, prefix + ctxLabel[k]);
    if (addresses.baseMint)
      labels.set(
        metaplexMetadataPda(new web3.PublicKey(addresses.baseMint)).toBase58(),
        `${prefix}base token metadata (Metaplex)`,
      );
  };
  addLaunchLabels(launchFile.addresses, "");
  for (const f of readdirSync(dir).filter((f) =>
    /^launch-\d+usd\.json$/.test(f),
  )) {
    addLaunchLabels(
      readJson<{ addresses: Record<string, string | null> }>(join(dir, f))
        .addresses,
      `[$${/\d+/.exec(f)![0]} sweep] `,
    );
  }
  labels.set(STOCKFLOOR, "stockfloor program account");
  labels.set(
    web3.PublicKey.findProgramAddressSync(
      [new web3.PublicKey(STOCKFLOOR).toBuffer()],
      BPF_LOADER,
    )[0].toBase58(),
    "stockfloor programdata",
  );
  const state = await fetchLaunchState(reader, {
    launch: new web3.PublicKey(launchAddr),
  });
  if (!state) throw new Error("launch not found on the surfnet");
  if (state.migrated) {
    const pool = state.damm.pool;
    labels.set(pool.toBase58(), "DAMM v2 pool");
    labels.set(
      dammV2TokenVaultPda(pool, state.keys.baseMint).toBase58(),
      "DAMM v2 token A vault (base)",
    );
    labels.set(
      dammV2TokenVaultPda(pool, state.keys.quoteMint).toBase58(),
      "DAMM v2 token B vault (SPYx)",
    );
    for (const p of state.positions) {
      labels.set(
        p.position.toBase58(),
        "DAMM v2 position (permanently locked)",
      );
      labels.set(
        p.positionNftAccount.toBase58(),
        "position NFT account (owner = claimer PDA)",
      );
      const acc = await reader.getAccountInfo(p.position);
      if (acc)
        labels.set(
          decodeDammV2Position(acc).nftMint.toBase58(),
          "position NFT mint (Token-2022)",
        );
    }
  }
  for (const [role, pk] of Object.entries(ledger.roles)) {
    const o = new web3.PublicKey(pk);
    labels.set(
      associatedTokenAddress(
        o,
        new web3.PublicKey(SPYX_MINT),
        TOKEN_2022_PROGRAM_ID,
      ).toBase58(),
      `${role} SPYx ATA`,
    );
    labels.set(
      associatedTokenAddress(
        o,
        state.keys.baseMint,
        TOKEN_PROGRAM_ID,
      ).toBase58(),
      `${role} base ATA`,
    );
  }
  for (const s of ledger.steps) {
    for (const t of s.txs) {
      for (const a of t.newAccounts) a.label = labels.get(a.address) ?? a.label;
      if (s.name === "deploy-program")
        for (const c of t.closedAccounts)
          labels.set(c.address, "deploy buffer (closed, refunded)");
    }
  }
  for (const s of ledger.steps)
    for (const t of s.txs)
      for (const a of t.newAccounts)
        if (!a.space && labels.get(a.address)) a.label = labels.get(a.address)!;

  const roleByKey = new Map(
    Object.entries(ledger.roles).map(([r, pk]) => [pk, r]),
  );
  const spyxLabel = (t: TxRecord, account: string) => {
    const owner = t.spyxOwners?.[account];
    const role = owner ? roleByKey.get(owner) : undefined;
    if (role) return role;
    const l = labels.get(account);
    return l
      ? l.replace(/ \(SPYx[^)]*\)$/, "").replace(/^floor vault.*/, "vault")
      : `${account.slice(0, 8)}…`;
  };

  // ------------------------------------------------------------ prices and rent
  const rentLocal = await readRentSysvar((m, p) => rpcCall(rpc, m, p));
  const rentMainnet = await readRentSysvar((m, p) => mainnetRead(m, p));
  const prices = await jupiterPrices([WSOL_MINT, SPYX_MINT, USDC_MINT]);
  const solUsd = prices[WSOL_MINT]?.usdPrice ?? NaN;
  const spyxUsd = prices[SPYX_MINT]?.usdPrice ?? NaN;
  const multiplier = Number(plan.QUOTE_MULTIPLIER ?? state.quoteMultiplier);
  const spyxRawUsd = (raw: bigint) =>
    (Number(raw) / 1e8) * multiplier * spyxUsd;

  // ------------------------------------------------------------ steps
  const mainnetSteps = ledger.steps.filter((s) => s.category === "mainnet");
  const sum = (xs: Array<bigint>) => xs.reduce((a, b) => a + b, 0n);
  const rentOf = (t: TxRecord) =>
    sum(t.newAccounts.map((a) => BigInt(a.lamports))) -
    sum(t.closedAccounts.map((c) => BigInt(c.lamportsBefore)));
  const roles = Object.keys(ledger.roles);
  const deltaLamports = (s: Step, role: string) =>
    BigInt(s.balancesAfter[role]!.lamports) -
    BigInt(s.balancesBefore[role]!.lamports);
  const deltaSpyx = (s: Step, role: string) =>
    BigInt(s.balancesAfter[role]!.spyxRaw ?? "0") -
    BigInt(s.balancesBefore[role]!.spyxRaw ?? "0");

  const stepRows = ledger.steps
    .filter((s) => s.txs.length > 0)
    .map((s) => {
      const fees = sum(s.txs.map((t) => BigInt(t.mainnetFee)));
      const rent = sum(s.txs.map(rentOf));
      const sol = roles
        .filter((r) => deltaLamports(s, r) !== 0n)
        .map((r) => `${r} ${fmtSol(deltaLamports(s, r))}`)
        .join(", ");
      const spyx = roles
        .filter((r) => deltaSpyx(s, r) !== 0n)
        .map((r) => `${r} ${fmtInt(deltaSpyx(s, r))}`)
        .join(", ");
      return {
        name: s.name,
        category: s.category,
        txs: s.txs.length,
        cu: s.txs.reduce((a, t) => a + (t.cuConsumed ?? 0), 0),
        cuLimit: s.txs.reduce((a, t) => a + (t.cuLimit ?? 0), 0),
        fees,
        rent,
        sol,
        spyx,
      };
    });

  // ------------------------------------------------------------ per-wallet totals (mainnet steps only)
  const wallet = roles.map((role) => {
    let fees = 0n;
    let lamports = 0n;
    let spyxSpent = 0n;
    let spyxReceived = 0n;
    let txCount = 0;
    for (const s of mainnetSteps) {
      lamports += deltaLamports(s, role);
      const d = deltaSpyx(s, role);
      if (d < 0n) spyxSpent -= d;
      else spyxReceived += d;
      for (const t of s.txs) {
        if (t.feePayerRole === role) {
          fees += BigInt(t.mainnetFee);
          txCount++;
        }
      }
    }
    const spent = -lamports;
    return {
      role,
      pubkey: ledger.roles[role]!,
      keyFile: ledger.roleKeyFiles[role]!,
      txCount,
      fees,
      rentAndTransfers: spent - fees,
      spent,
      spyxSpent,
      spyxReceived,
    };
  });

  // ------------------------------------------------------------ deploy: measured + max-len options
  const deploy = ledger.steps.find((s) => s.name === "deploy-program")!;
  const writes = deploy.txs.filter(
    (t) => t.label === "BPF Upgradeable Loader:Write",
  );
  const deployFees = sum(deploy.txs.map((t) => BigInt(t.mainnetFee)));
  const elfBytes = Number(params.ELF_BYTES);
  const maxLen = Number(params.MAX_LEN);
  const programAccountRent = rentExempt(rentMainnet.params, 36);
  const programdataRent = (len: number) =>
    rentExempt(rentMainnet.params, 45 + len);
  const deployMeasured = {
    txs: deploy.txs.length,
    writeTxs: writes.length,
    writeCuLimit: writes[0]?.cuLimit ?? null,
    writeFeeEach: writes[0]?.mainnetFee ?? null,
    fees: deployFees,
    programAccountRent,
    programdataRent: programdataRent(maxLen),
    bufferPeak: sum(
      deploy.txs.flatMap((t) =>
        t.closedAccounts.map((c) => BigInt(c.lamportsBefore)),
      ),
    ),
    netCost: -deltaLamports(deploy, "deployer"),
  };
  const maxLenOptions = [
    { name: "exact ELF size (CLI default)", len: elfBytes },
    { name: "ELF + 10% (rehearsed)", len: maxLen },
    { name: "ELF + 25%", len: Math.ceil((elfBytes * 1.25) / 1024) * 1024 },
    { name: "2 x ELF", len: elfBytes * 2 },
  ].map((o) => ({
    ...o,
    programdataRent: programdataRent(o.len),
    total: programdataRent(o.len) + programAccountRent + deployFees,
  }));
  const upgrade = ledger.steps.find((s) => s.name === "validate-upgrade");
  const upgradeMeasured = upgrade
    ? {
        txs: upgrade.txs.length,
        fees: sum(upgrade.txs.map((t) => BigInt(t.mainnetFee))),
        bufferPeak: sum(
          upgrade.txs.flatMap((t) =>
            t.newAccounts.map((a) => BigInt(a.lamports)),
          ),
        ),
        netCost: -deltaLamports(upgrade, "deployer"),
      }
    : null;

  // ------------------------------------------------------------ per-launch accounts (C2 launch only)
  const launchSteps = mainnetSteps.filter(
    (s) => s.name !== "deploy-program" && s.name !== "idl-init",
  );
  const accountRows = launchSteps.flatMap((s) =>
    s.txs.flatMap((t) =>
      t.newAccounts.map((a) => ({
        step: s.name,
        label: labels.get(a.address) ?? a.label,
        owner: a.owner,
        space: a.space,
        lamports: BigInt(a.lamports),
        excess: BigInt(a.excess ?? "0"),
        payer: t.feePayerRole,
      })),
    ),
  );
  const perLaunchRent = sum(accountRows.map((r) => r.lamports));
  const perLaunchFees = sum(
    launchSteps.flatMap((s) => s.txs.map((t) => BigInt(t.mainnetFee))),
  );

  // ------------------------------------------------------------ funding recommendation
  const planned: Record<string, bigint> = {
    creator: BigInt(plan.CREATOR_SPYX_RAW ?? "0"),
    buyer1: BigInt(plan.BUYER1_SPYX_RAW ?? "0"),
    buyer2: BigInt(plan.BUYER2_SPYX_RAW ?? "0"),
  };
  const SOL_STEP = SOL / 100n; // 0.01 SOL
  const funding = wallet.map((w) => {
    const isDeployer = w.role === "deployer";
    // Deployer: measured deploy cost + 2% + 0.05 SOL for re-sent writes; app wallets: +25% + 0.01 SOL.
    const sol = isDeployer
      ? roundUp((w.spent * 102n) / 100n + SOL / 20n, SOL / 20n)
      : roundUp((w.spent * 125n) / 100n + SOL_STEP, SOL_STEP);
    const spyxPlanned = planned[w.role] ?? 0n;
    const spyx =
      spyxPlanned > 0n ? roundUp((spyxPlanned * 110n) / 100n, 10_000n) : 0n;
    return {
      ...w,
      recommendedLamports: sol,
      spyxPlanned,
      recommendedSpyxRaw: spyx,
    };
  });
  const totalSol = sum(funding.map((f) => f.recommendedLamports));
  const totalSpyx = sum(funding.map((f) => f.recommendedSpyxRaw));
  const spyxAtaRent = rentExempt(rentMainnet.params, 179);

  // ------------------------------------------------------------ SPYx flow of the demo launch
  const firstLaunchStep = ledger.steps.find((s) => s.name === "create-launch")!;
  const lastLaunchStep = ledger.steps.find(
    (s) => s.name === "buyer2-redeem-all",
  )!;
  const spyxFlow = ["creator", "buyer1", "buyer2"].map((role) => {
    const start = BigInt(firstLaunchStep.balancesBefore[role]!.spyxRaw ?? "0");
    const end = BigInt(lastLaunchStep.balancesAfter[role]!.spyxRaw ?? "0");
    return { role, start, end, net: end - start };
  });

  const spyxNet = -sum(spyxFlow.map((f) => f.net));
  // SPYx held by the DAMM v2 token B vault (reserves plus unclaimed protocol fees).
  const dammVaultAcc = state.migrated
    ? await reader.getAccountInfo(
        dammV2TokenVaultPda(state.damm.pool, state.keys.quoteMint),
      )
    : null;
  const dammQuote =
    dammVaultAcc && dammVaultAcc.data.length >= 72
      ? Buffer.from(dammVaultAcc.data).readBigUInt64LE(64)
      : 0n;

  // ------------------------------------------------------------ checks
  const cliExact = ledger.steps.flatMap((s) =>
    (s.cliJson as Array<Record<string, unknown>>)
      .filter((j) => "exact" in j)
      .map((j) => ({ step: s.name, exact: j.exact === true })),
  );
  const finalStatus = ledger.steps.find((s) => s.name === "status-final")
    ?.cliJson[0] as Record<string, unknown> | undefined;
  const crankSteps = ledger.steps
    .filter((s) => s.name.startsWith("crank-") && s.category === "mainnet")
    .flatMap((s) =>
      (
        s.cliJson as Array<{
          steps?: Array<{ status: string; action: { kind: string } }>;
        }>
      ).flatMap((j) =>
        (j.steps ?? []).map((x) => ({
          step: s.name,
          kind: x.action.kind,
          status: x.status,
        })),
      ),
    );
  const allSignatures = [
    ...new Set([...ledger.preexistingSignatures, ...ledger.seen]),
  ];
  const statuses: unknown[] = [];
  for (let i = 0; i < allSignatures.length; i += 100) {
    const r = await mainnetRead<{ value: unknown[] }>("getSignatureStatuses", [
      allSignatures.slice(i, i + 100),
      { searchTransactionHistory: true },
    ]);
    statuses.push(...r.value);
  }
  const foundOnMainnet = statuses.filter((s) => s !== null).length;
  const createdAddresses = [
    ...new Set(
      ledger.steps.flatMap((s) =>
        s.txs.flatMap((t) => t.newAccounts.map((a) => a.address)),
      ),
    ),
  ].filter((a) => !Object.values(ledger.roles).includes(a));
  const existing: string[] = [];
  for (let i = 0; i < createdAddresses.length; i += 100) {
    const chunk = createdAddresses.slice(i, i + 100);
    const r = await mainnetRead<{ value: Array<unknown | null> }>(
      "getMultipleAccounts",
      [chunk, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }],
    );
    r.value.forEach((v, j) => v !== null && existing.push(chunk[j]!));
  }
  const checks = {
    cliExact,
    allExact: cliExact.length > 0 && cliExact.every((c) => c.exact),
    crankSteps,
    allCrankExecuted:
      crankSteps.length > 0 && crankSteps.every((c) => c.status === "executed"),
    finalPhase: finalStatus?.phase ?? null,
    floorViewMatchesState: finalStatus?.floorViewMatchesState ?? null,
    rentSysvarEqualsMainnet: rentLocal.raw === rentMainnet.raw,
    feeFormulaMatchesSurfnetCharge: ledger.steps.every((s) =>
      s.txs.every((t) => t.chargedFee === t.mainnetFee),
    ),
    relay: { signaturesChecked: allSignatures.length, foundOnMainnet },
    createdAccountsChecked: createdAddresses.length,
    createdAccountsExistingOnMainnet: existing,
  };

  // ------------------------------------------------------------ mainnet transaction list (C2)
  const c2Txs: Array<{
    n: string;
    step: string;
    label: string;
    payer: string;
    signers: number;
    cuLimit: string;
    fee: bigint;
    rent: bigint;
    spyx: string;
  }> = [];
  let n = 0;
  for (const s of mainnetSteps) {
    const groups = new Map<string, TxRecord[]>();
    for (const t of s.txs) {
      const key =
        t.label === "BPF Upgradeable Loader:Write" ? t.label : t.signature;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    for (const g of groups.values()) {
      const t = g[0]!;
      const from = n + 1;
      n += g.length;
      c2Txs.push({
        n: g.length > 1 ? `${from}-${n}` : String(n),
        step: s.name,
        label: g.length > 1 ? `${g.length} x ${t.label}` : t.label,
        payer: t.feePayerRole ?? t.feePayer,
        signers: t.numSignatures,
        cuLimit: t.cuLimit === null ? "-" : fmtInt(t.cuLimit),
        fee: sum(g.map((x) => BigInt(x.mainnetFee))),
        rent: sum(g.map(rentOf)),
        spyx: Object.entries(t.spyxDeltas)
          .map(
            ([k, v]) =>
              `${spyxLabel(t, k)} ${BigInt(v) > 0n ? "+" : ""}${fmtInt(v)}`,
          )
          .join(", "),
      });
    }
  }

  const report = {
    runId: basename(dir),
    generatedAt: new Date().toISOString(),
    surfnetVersion: ledger.surfnetVersion,
    params,
    plan,
    prices: {
      solUsd,
      spyxUsd,
      spyxMultiplier: multiplier,
      source: "Jupiter Price V3 lite-api",
      at: new Date().toISOString(),
    },
    rent: { mainnet: rentMainnet.params, surfnet: rentLocal.params },
    launch: {
      addresses: launchFile.addresses,
      dammPool: state.migrated ? state.damm.pool.toBase58() : null,
      finalStatus,
    },
    steps: stepRows,
    wallets: funding,
    deploy: {
      measured: deployMeasured,
      maxLenOptions,
      upgrade: upgradeMeasured,
    },
    perLaunch: {
      accounts: accountRows,
      rent: perLaunchRent,
      fees: perLaunchFees,
    },
    spyxFlow,
    totals: {
      recommendedLamports: totalSol,
      recommendedSpyxRaw: totalSpyx,
      spyxAtaRentPerWallet: spyxAtaRent,
    },
    c2Transactions: c2Txs,
    checks,
    txs: ledger.steps.map((s) => ({
      step: s.name,
      category: s.category,
      command: s.command,
      txs: s.txs.filter((t) => t.label !== "BPF Upgradeable Loader:Write"),
      writeSignatures: s.txs
        .filter((t) => t.label === "BPF Upgradeable Loader:Write")
        .map((t) => t.signature),
    })),
  };
  writeJsonAtomic(join(dir, "report.json"), report);

  // ------------------------------------------------------------ markdown
  const md: string[] = [];
  md.push(`# C2 rehearsal report ${report.runId}`, "");
  md.push(
    `Surfpool ${ledger.surfnetVersion}, stockfloor.so ${fmtInt(elfBytes)} bytes (sha256 ${params.ELF_SHA256?.slice(0, 16)}…), threshold $${params.THRESHOLD_USD} = ${fmtInt(plan.THRESHOLD_RAW ?? "0")} raw SPYx at $${Number(plan.PRICE_USD).toFixed(4)} × multiplier ${multiplier}, priority fee ${fmtInt(params.PRIORITY_FEE ?? "0")} µlamports/CU, max-len ${fmtInt(maxLen)}. Prices at report time: SOL ${usd(solUsd)}, SPYx ${usd(spyxUsd)}. Mainnet rent: ${rentMainnet.params.lamportsPerByteYear} lamports/byte-year × ${rentMainnet.params.exemptionThreshold} (surfnet set to the same: ${checks.rentSysvarEqualsMainnet}).`,
    "",
  );
  md.push("## Checks", "");
  md.push(
    `- CLI quotes exact: ${checks.allExact} (${cliExact.map((c) => `${c.step} ${c.exact}`).join(", ")})`,
  );
  md.push(
    `- Crank actions executed: ${checks.allCrankExecuted} (${crankSteps.map((c) => `${c.kind} ${c.status}`).join(", ")})`,
  );
  md.push(
    `- Final phase ${checks.finalPhase}, floor view = state: ${checks.floorViewMatchesState}`,
  );
  md.push(
    `- Fee formula (5,000 × signatures + ceil(CU limit × price / 1e6)) = lamports the surfnet charged, every tx: ${checks.feeFormulaMatchesSurfnetCharge}`,
  );
  md.push(
    `- Mainnet relay check: ${foundOnMainnet} of ${allSignatures.length} local signatures exist on mainnet; ${existing.length} of ${createdAddresses.length} created accounts exist on mainnet${existing.length ? ` (${existing.join(", ")})` : ""}`,
    "",
  );

  md.push("## Steps", "");
  md.push(
    mdTable(
      [
        ["#", "r"],
        ["Step", "l"],
        ["Category", "l"],
        ["Txs", "r"],
        ["CU used", "r"],
        ["CU limit", "r"],
        ["Fees (lamports)", "r"],
        ["New-account lamports", "r"],
        ["SOL change by wallet", "l"],
        ["SPYx raw change", "l"],
      ],
      stepRows.map((r, i) => [
        i + 1,
        r.name,
        r.category,
        r.txs,
        fmtInt(r.cu),
        fmtInt(r.cuLimit),
        fmtInt(r.fees),
        fmtInt(r.rent),
        r.sol,
        r.spyx,
      ]),
    ),
    "",
  );

  md.push("## Transactions C2 will send on mainnet", "");
  md.push(
    mdTable(
      [
        ["#", "r"],
        ["Step", "l"],
        ["Instructions", "l"],
        ["Fee payer", "l"],
        ["Sigs", "r"],
        ["CU limit", "r"],
        ["Fee (lamports)", "r"],
        ["Net rent (lamports)", "r"],
        ["SPYx raw moved", "l"],
      ],
      c2Txs.map((t) => [
        t.n,
        t.step,
        t.label,
        t.payer,
        t.signers,
        t.cuLimit,
        fmtInt(t.fee),
        fmtInt(t.rent),
        t.spyx,
      ]),
    ),
    "",
  );

  md.push("## Per-transaction detail (signature, CU, fee)", "");
  md.push(
    mdTable(
      [
        ["Step", "l"],
        ["Signature", "l"],
        ["Instructions", "l"],
        ["Size (bytes)", "r"],
        ["CU used", "r"],
        ["CU limit", "r"],
        ["Priority fee", "r"],
        ["Fee", "r"],
      ],
      ledger.steps
        .filter((s) => s.category !== "setup")
        .flatMap((s) =>
          s.txs
            .filter((t) => t.label !== "BPF Upgradeable Loader:Write")
            .map((t) => [
              s.name,
              `\`${t.signature}\``,
              t.label,
              t.sizeBytes,
              fmtInt(t.cuConsumed ?? 0),
              t.cuLimit === null ? "-" : fmtInt(t.cuLimit),
              fmtInt(t.priorityFee),
              fmtInt(t.mainnetFee),
            ]),
        ),
    ),
    "",
    `Deploy writes: ${writes.length} × \`Write\`, CU used ${writes
      .map((w) => w.cuConsumed)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(
        "/",
      )} of limit ${writes[0]?.cuLimit}, ${fmtInt(writes[0]?.mainnetFee ?? 0)} lamports each, ${writes.map((w) => w.sizeBytes).reduce((a, b) => Math.max(a, b), 0)} bytes max.`,
    "",
  );

  md.push("## Accounts created by the demo launch", "");
  md.push(
    mdTable(
      [
        ["Step", "l"],
        ["Account", "l"],
        ["Owner", "l"],
        ["Bytes", "r"],
        ["Lamports", "r"],
        ["Above rent", "r"],
        ["Paid by", "l"],
      ],
      accountRows.map((r) => [
        r.step,
        r.label,
        r.owner
          ? r.owner === TOKEN_PROGRAM_ID.toBase58()
            ? "SPL Token"
            : r.owner === TOKEN_2022_PROGRAM_ID.toBase58()
              ? "Token-2022"
              : r.owner.slice(0, 8) + "…"
          : "-",
        r.space ?? "-",
        fmtInt(r.lamports),
        fmtInt(r.excess),
        r.payer ?? "-",
      ]),
    ),
    "",
    `Per launch: new-account lamports ${fmtInt(perLaunchRent)} (${fmtSol(perLaunchRent)} SOL), transaction fees ${fmtInt(perLaunchFees)} (${fmtSol(perLaunchFees)} SOL).`,
    "",
  );

  md.push("## Program deploy", "");
  md.push(
    `Measured: ${deployMeasured.txs} transactions (${deployMeasured.writeTxs} writes at CU limit ${deployMeasured.writeCuLimit}, ${deployMeasured.writeFeeEach} lamports each), fees ${fmtInt(deployFees)} lamports; program account ${fmtInt(programAccountRent)}; programdata (max-len ${fmtInt(maxLen)}) ${fmtInt(deployMeasured.programdataRent)}; buffer funded with ${fmtInt(deployMeasured.bufferPeak)} and refunded in the final transaction; deployer net cost ${fmtInt(deployMeasured.netCost)} lamports (${fmtSol(deployMeasured.netCost)} SOL).`,
    "",
  );
  md.push(
    mdTable(
      [
        ["max-len option", "l"],
        ["Bytes", "r"],
        ["Programdata rent (SOL)", "r"],
        ["Total with program account + fees (SOL)", "r"],
        ["USD", "r"],
      ],
      maxLenOptions.map((o) => [
        o.name,
        fmtInt(o.len),
        fmtSol(o.programdataRent, 4),
        fmtSol(o.total, 4),
        usd(lamportsUsd(o.total)),
      ]),
    ),
    "",
  );
  if (upgradeMeasured) {
    md.push(
      `Upgrade with the same ELF (validation): ${upgradeMeasured.txs} transactions, fees ${fmtInt(upgradeMeasured.fees)} lamports, buffer ${fmtInt(upgradeMeasured.bufferPeak)} lamports (refunded to the deployer by Upgrade), net cost ${fmtInt(upgradeMeasured.netCost)} lamports.`,
      "",
    );
  }

  md.push("## Wallet totals over the C2 steps", "");
  md.push(
    mdTable(
      [
        ["Wallet", "l"],
        ["Address", "l"],
        ["Txs paid", "r"],
        ["Fees (lamports)", "r"],
        ["Rent (lamports)", "r"],
        ["SOL spent", "r"],
        ["SPYx raw spent", "r"],
        ["SPYx raw received", "r"],
      ],
      funding.map((w) => [
        w.role,
        `\`${w.pubkey}\``,
        w.txCount,
        fmtInt(w.fees),
        fmtInt(w.rentAndTransfers),
        fmtSol(w.spent),
        fmtInt(w.spyxSpent),
        fmtInt(w.spyxReceived),
      ]),
    ),
    "",
  );
  md.push("## Funding recommendation", "");
  md.push(
    mdTable(
      [
        ["Wallet", "l"],
        ["Key file", "l"],
        ["Measured SOL", "r"],
        ["Recommended SOL", "r"],
        ["SPYx planned (raw)", "r"],
        ["Recommended SPYx (raw)", "r"],
        ["SPYx UI (wallet display)", "r"],
        ["USD", "r"],
      ],
      funding.map((f) => [
        f.role,
        f.keyFile,
        fmtSol(f.spent),
        fmtSol(f.recommendedLamports, 2),
        fmtInt(f.spyxPlanned),
        fmtInt(f.recommendedSpyxRaw),
        ((Number(f.recommendedSpyxRaw) / 1e8) * multiplier).toFixed(6),
        usd(
          lamportsUsd(f.recommendedLamports) + spyxRawUsd(f.recommendedSpyxRaw),
        ),
      ]),
    ),
    "",
    `Total: ${fmtSol(totalSol, 2)} SOL (${usd(lamportsUsd(totalSol))}) and ${fmtInt(totalSpyx)} raw SPYx (CLI units ${rawToUnits(totalSpyx, 8)}; ${((Number(totalSpyx) / 1e8) * multiplier).toFixed(6)} SPYx as wallets display it) (${usd(spyxRawUsd(totalSpyx))}, about ${usd(spyxRawUsd(totalSpyx) * 1.01)} of USDC through Jupiter).`,
    "",
    `SPYx flow of the demo launch (raw): ${spyxFlow.map((f) => `${f.role} ${fmtInt(f.start)} -> ${fmtInt(f.end)} (${f.net >= 0n ? "+" : ""}${fmtInt(f.net)})`).join("; ")}.`,
    "",
    `Where the net ${fmtInt(spyxNet)} raw SPYx (${usd(spyxRawUsd(spyxNet))}) of the demo ends up: floor vault ${fmtInt(state.vaultBalance)} raw (redeemable by the remaining holders, including the creator), DAMM v2 pool token B ${fmtInt(dammQuote)} raw (permanently locked liquidity that holders can still sell into), and ${fmtInt(spyxNet - state.vaultBalance - dammQuote)} raw of curve trading fees to the protocol and the creator plus the DBC protocol migration fee.`,
    "",
  );
  if (upgradeMeasured) {
    md.push(
      `Optional upgrade headroom for the deployer: an upgrade with an ELF of the current size needs ${fmtInt(upgradeMeasured.bufferPeak + upgradeMeasured.fees)} lamports (${fmtSol(upgradeMeasured.bufferPeak + upgradeMeasured.fees, 4)} SOL) available at once; Upgrade refunds the buffer, so the net cost is the fees (${fmtInt(upgradeMeasured.fees)} lamports). An ELF above max-len also pays rent for the extension.`,
      "",
    );
  }
  writeFileSync(join(dir, "report.md"), md.join("\n") + "\n");

  function lamportsUsd(l: bigint): number {
    return (Number(l) / 1e9) * solUsd;
  }

  if (flags.save) {
    const out = join(REPO_ROOT, "scripts", "e2e", "reports");
    mkdirSync(out, { recursive: true });
    copyFileSync(join(dir, "report.md"), join(out, `${report.runId}.md`));
    copyFileSync(join(dir, "report.json"), join(out, `${report.runId}.json`));
    console.log(`saved scripts/e2e/reports/${report.runId}.{md,json}`);
  }
  console.log(md.slice(0, 8).join("\n"));
  console.log(`report: ${join(dir, "report.md")}`);
  if (
    !checks.allExact ||
    !checks.allCrankExecuted ||
    foundOnMainnet !== 0 ||
    existing.length !== 0 ||
    !checks.rentSysvarEqualsMainnet ||
    !checks.feeFormulaMatchesSurfnetCharge
  ) {
    throw new Error("rehearsal checks failed (see report.md)");
  }
});
