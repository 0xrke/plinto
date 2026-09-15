/**
 * Cost ledger of the C2 rehearsal: attributes every local surfnet signature to a rehearsal step and
 * records, per transaction, the signers, instructions, compute units, the fee mainnet would charge
 * (5,000 lamports per signature + ceil(CU limit x CU price / 1e6)), the fee the surfnet actually
 * charged (lamport conservation over all accounts of the transaction), every account created or
 * closed with its size, owner and lamports, and SPYx movements. Balances of the role wallets are
 * snapshotted before and after each step.
 *
 *   tsx scripts/e2e/ledger.ts init --roles "deployer=keys/deployer.json,creator=keys/cli-creator.json,..."
 *   tsx scripts/e2e/ledger.ts begin <step> --category mainnet|setup|validation|readonly [--command "..."]
 *   tsx scripts/e2e/ledger.ts end <step> [--log <file>]
 *   tsx scripts/e2e/ledger.ts context --launch-file <create-launch --out json> [--key <name>]
 *
 * State: $E2E_RUN_DIR/ledger.json. LOCAL surfnet only ($E2E_RPC_URL, loopback + surfnet-version).
 */
import { existsSync, readFileSync } from "node:fs";
import type { VersionedMessage } from "@solana/web3.js";
import { join } from "node:path";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
} from "../../packages/sdk/src/index.ts";
import {
  PROGRAM_NAMES,
  SPYX_MINT,
  connectSurfnet,
  flag,
  loadRepoKeypair,
  localRpcUrl,
  main,
  parseFlags,
  readJson,
  readRentSysvar,
  rentExempt,
  rpcCall,
  runDir,
  web3,
  writeJsonAtomic,
} from "./lib.ts";

type PublicKey = InstanceType<typeof web3.PublicKey>;

export type Category = "mainnet" | "setup" | "validation" | "readonly";

export interface RoleBalance {
  lamports: string;
  spyxRaw: string | null;
  baseRaw: string | null;
}

export interface NewAccount {
  address: string;
  label: string;
  owner: string | null;
  space: number | null;
  lamports: string;
  rentExempt: string | null;
  /** lamports above the rent-exempt minimum (e.g. protocol fees stored in the account). */
  excess: string | null;
  payerRole: string | null;
}

export interface TxRecord {
  signature: string;
  slot: number;
  sizeBytes: number;
  numSignatures: number;
  feePayer: string;
  feePayerRole: string | null;
  signers: string[];
  instructions: string[];
  label: string;
  cuConsumed: number | null;
  cuLimit: number | null;
  cuPriceMicroLamports: number;
  baseFee: string;
  priorityFee: string;
  /** base + priority: what mainnet charges (meta.fee on mainnet includes the priority fee). */
  mainnetFee: string;
  /** -(sum of all lamport deltas): what the surfnet actually charged. */
  chargedFee: string;
  /** Surfpool's meta.fee (base fee only on Surfpool 1.5.0). */
  metaFee: number;
  newAccounts: NewAccount[];
  closedAccounts: Array<{ address: string; lamportsBefore: string }>;
  roleLamportDeltas: Record<string, string>;
  /** SPYx raw change per token account address. */
  spyxDeltas: Record<string, string>;
  spyxOwners: Record<string, string>;
}

export interface Step {
  index: number;
  name: string;
  category: Category;
  command: string | null;
  logFile: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  balancesBefore: Record<string, RoleBalance>;
  balancesAfter: Record<string, RoleBalance>;
  txs: TxRecord[];
  cliJson: unknown[];
}

export interface Ledger {
  version: 1;
  createdAt: string;
  rpcUrl: string;
  surfnetVersion: string;
  roles: Record<string, string>;
  roleKeyFiles: Record<string, string>;
  preexistingSignatures: string[];
  seen: string[];
  steps: Step[];
  open: {
    name: string;
    category: Category;
    command: string | null;
    startedAt: string;
    balances: Record<string, RoleBalance>;
  } | null;
  context: Record<string, string>;
}

const ledgerPath = () => join(runDir(), "ledger.json");
export const loadLedger = () => readJson<Ledger>(ledgerPath());
const saveLedger = (l: Ledger) => writeJsonAtomic(ledgerPath(), l);

async function localSignatures(rpc: string): Promise<string[]> {
  const res = await rpcCall<{ value: Array<{ signature: string }> }>(
    rpc,
    "surfnet_getLocalSignatures",
    [100_000],
  );
  // Newest first -> oldest first.
  return res.value.map((v) => v.signature).reverse();
}

async function snapshot(
  connection: InstanceType<typeof web3.Connection>,
  ledger: Ledger,
): Promise<Record<string, RoleBalance>> {
  const roles = Object.entries(ledger.roles);
  const spyx = new web3.PublicKey(SPYX_MINT);
  const base = ledger.context.baseMint
    ? new web3.PublicKey(ledger.context.baseMint)
    : null;
  const keys: PublicKey[] = [];
  for (const [, pk] of roles) {
    const owner = new web3.PublicKey(pk);
    keys.push(
      owner,
      associatedTokenAddress(owner, spyx, TOKEN_2022_PROGRAM_ID),
    );
    keys.push(
      base
        ? associatedTokenAddress(owner, base, TOKEN_PROGRAM_ID)
        : web3.PublicKey.default,
    );
  }
  const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
  const amount = (i: number) => {
    const a = infos[i];
    return a && a.data.length >= 72
      ? Buffer.from(a.data).readBigUInt64LE(64).toString()
      : null;
  };
  const out: Record<string, RoleBalance> = {};
  roles.forEach(([role], r) => {
    out[role] = {
      lamports: String(infos[3 * r]?.lamports ?? 0),
      spyxRaw: amount(3 * r + 1),
      baseRaw: base ? amount(3 * r + 2) : null,
    };
  });
  return out;
}

/** Decode the instructions of a transaction into "Program:Instruction" names. */
function instructionNames(
  message: VersionedMessage,
  keys: string[],
  logs: string[],
): { names: string[]; cuLimit: number | null; cuPrice: number } {
  // Anchor programs log "Program log: Instruction: <Name>" right after their top-level invoke.
  const anchorNames: string[] = [];
  for (let i = 0; i < logs.length; i++) {
    const m = /^Program (\w+) invoke \[1\]$/.exec(logs[i]!);
    if (!m) continue;
    const next = logs[i + 1] ?? "";
    const n = /^Program log: Instruction: (\w+)/.exec(next);
    anchorNames.push(n ? n[1]! : "");
  }
  let cuLimit: number | null = null;
  let cuPrice = 0;
  const names: string[] = [];
  let top = 0;
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex]!;
    const data = Buffer.from(ix.data);
    const anchorName = anchorNames[top++] ?? "";
    const pname = PROGRAM_NAMES[program] ?? program.slice(0, 8);
    if (pname === "ComputeBudget") {
      if (data[0] === 2) cuLimit = data.readUInt32LE(1);
      if (data[0] === 3) cuPrice = Number(data.readBigUInt64LE(1));
      continue;
    }
    let name = anchorName;
    if (!name && pname === "BPF Upgradeable Loader") {
      name =
        [
          "InitializeBuffer",
          "Write",
          "DeployWithMaxDataLen",
          "Upgrade",
          "SetAuthority",
          "Close",
          "ExtendProgram",
          "SetAuthorityChecked",
          "Migrate",
          "ExtendProgramChecked",
        ][data.readUInt32LE(0)] ?? `ix${data.readUInt32LE(0)}`;
    } else if (!name && pname === "System") {
      name =
        ["CreateAccount", "Assign", "Transfer", "CreateAccountWithSeed"][
          data.readUInt32LE(0)
        ] ?? `ix${data.readUInt32LE(0)}`;
    } else if (!name && pname === "ATA") {
      name =
        data.length === 0 || data[0] === 0
          ? "Create"
          : data[0] === 1
            ? "CreateIdempotent"
            : `ix${data[0]}`;
    }
    names.push(name ? `${pname}:${name}` : pname);
  }
  return { names, cuLimit, cuPrice };
}

function labelFor(
  address: string,
  owner: string | null,
  space: number | null,
  ledger: Ledger,
): string {
  const ctx = ledger.context;
  for (const [k, v] of Object.entries(ctx))
    if (v === address && !k.startsWith("_")) return k;
  for (const [role, pk] of Object.entries(ledger.roles)) {
    const o = new web3.PublicKey(pk);
    if (
      associatedTokenAddress(
        o,
        new web3.PublicKey(SPYX_MINT),
        TOKEN_2022_PROGRAM_ID,
      ).toBase58() === address
    )
      return `${role} SPYx ATA`;
    if (
      ctx.baseMint &&
      associatedTokenAddress(
        o,
        new web3.PublicKey(ctx.baseMint),
        TOKEN_PROGRAM_ID,
      ).toBase58() === address
    )
      return `${role} base ATA`;
  }
  return `${owner ? (PROGRAM_NAMES[owner] ?? owner.slice(0, 8)) : "?"} account (${space ?? "?"} bytes)`;
}

main(async () => {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const cmd = positional[0];
  const rpc = localRpcUrl();
  const { connection, version } = await connectSurfnet(rpc);

  if (cmd === "init") {
    const rolesArg = flag(flags, "roles");
    if (!rolesArg) throw new Error("--roles is required");
    const roles: Record<string, string> = {};
    const roleKeyFiles: Record<string, string> = {};
    for (const part of rolesArg.split(",")) {
      const [role, file] = part.split("=");
      if (!role || !file) throw new Error(`bad role ${part}`);
      roles[role] = loadRepoKeypair(file).publicKey.toBase58();
      roleKeyFiles[role] = file;
    }
    const existing = await localSignatures(rpc);
    const ledger: Ledger = {
      version: 1,
      createdAt: new Date().toISOString(),
      rpcUrl: rpc,
      surfnetVersion: version["surfnet-version"],
      roles,
      roleKeyFiles,
      preexistingSignatures: existing,
      seen: existing,
      steps: [],
      open: null,
      context: {},
    };
    saveLedger(ledger);
    console.log(
      `ledger ${ledgerPath()}: roles ${Object.entries(roles)
        .map(([r, pk]) => `${r}=${pk}`)
        .join(" ")}; ${existing.length} pre-existing local signatures`,
    );
    return;
  }

  const ledger = loadLedger();

  if (cmd === "context") {
    const file = flag(flags, "launch-file");
    if (file) {
      const launch = readJson<{ addresses: Record<string, string | null> }>(
        file,
      );
      for (const [k, v] of Object.entries(launch.addresses))
        if (v) ledger.context[k] = v;
    }
    for (const kv of (flag(flags, "set") ?? "").split(",").filter(Boolean)) {
      const [k, v] = kv.split("=");
      if (k && v) ledger.context[k] = v;
    }
    saveLedger(ledger);
    console.log(`context: ${Object.keys(ledger.context).join(", ")}`);
    return;
  }

  if (cmd === "begin") {
    const name = positional[1];
    if (!name) throw new Error("step name required");
    if (ledger.open) throw new Error(`step ${ledger.open.name} is still open`);
    const category = (flag(flags, "category") ?? "mainnet") as Category;
    if (!["mainnet", "setup", "validation", "readonly"].includes(category))
      throw new Error(`bad category ${category}`);
    ledger.open = {
      name,
      category,
      command: flag(flags, "command") ?? null,
      startedAt: new Date().toISOString(),
      balances: await snapshot(connection, ledger),
    };
    saveLedger(ledger);
    return;
  }

  if (cmd === "end") {
    const name = positional[1];
    const open = ledger.open;
    if (!open || open.name !== name)
      throw new Error(`step ${name} is not open`);
    const launchFile = flag(flags, "launch-file");
    if (launchFile && existsSync(launchFile)) {
      const launch = readJson<{ addresses: Record<string, string | null> }>(
        launchFile,
      );
      for (const [k, v] of Object.entries(launch.addresses))
        if (v && !ledger.context[k]) ledger.context[k] = v;
    }
    const rent = (await readRentSysvar((m, p) => rpcCall(rpc, m, p))).params;
    const seen = new Set(ledger.seen);
    const fresh = (await localSignatures(rpc)).filter((s) => !seen.has(s));
    const roleByKey = new Map(
      Object.entries(ledger.roles).map(([r, pk]) => [pk, r]),
    );
    const txs: TxRecord[] = [];
    const created: Array<{ tx: TxRecord; address: string; lamports: bigint }> =
      [];

    for (const signature of fresh) {
      const res = await rpcCall<{
        slot: number;
        transaction: [string, string];
        meta: {
          err: unknown;
          fee: number;
          preBalances: number[];
          postBalances: number[];
          computeUnitsConsumed?: number;
          logMessages?: string[];
          preTokenBalances?: Array<{
            accountIndex: number;
            mint: string;
            owner?: string;
            uiTokenAmount: { amount: string };
          }>;
          postTokenBalances?: Array<{
            accountIndex: number;
            mint: string;
            owner?: string;
            uiTokenAmount: { amount: string };
          }>;
          loadedAddresses?: { writable: string[]; readonly: string[] };
        };
      } | null>(rpc, "getTransaction", [
        signature,
        {
          encoding: "base64",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!res) throw new Error(`getTransaction ${signature} returned null`);
      if (res.meta.err)
        throw new Error(
          `local transaction ${signature} failed: ${JSON.stringify(res.meta.err)}`,
        );
      const raw = Buffer.from(res.transaction[0], "base64");
      const vtx = web3.VersionedTransaction.deserialize(raw);
      const msg = vtx.message;
      const keys = [
        ...msg.staticAccountKeys.map((k) => k.toBase58()),
        ...(res.meta.loadedAddresses?.writable ?? []),
        ...(res.meta.loadedAddresses?.readonly ?? []),
      ];
      const numSignatures = msg.header.numRequiredSignatures;
      const { names, cuLimit, cuPrice } = instructionNames(
        msg,
        keys,
        res.meta.logMessages ?? [],
      );
      const nonBudget = names.length;
      // Agave default limit when no SetComputeUnitLimit is present: 200k per non-budget instruction.
      const effectiveLimit =
        cuLimit ?? Math.min(1_400_000, 200_000 * nonBudget);
      const baseFee = 5000n * BigInt(numSignatures);
      const priorityFee =
        (BigInt(cuPrice) * BigInt(effectiveLimit) + 999_999n) / 1_000_000n;
      const pre = res.meta.preBalances.map(BigInt);
      const post = res.meta.postBalances.map(BigInt);
      const charged =
        pre.reduce((a, b) => a + b, 0n) - post.reduce((a, b) => a + b, 0n);
      const roleLamportDeltas: Record<string, string> = {};
      const newAccounts: NewAccount[] = [];
      const closedAccounts: TxRecord["closedAccounts"] = [];
      keys.forEach((k, i) => {
        const role = roleByKey.get(k);
        if (role && pre[i] !== post[i])
          roleLamportDeltas[role] = (post[i]! - pre[i]!).toString();
        if (pre[i] === 0n && post[i]! > 0n)
          newAccounts.push({
            address: k,
            label: "",
            owner: null,
            space: null,
            lamports: post[i]!.toString(),
            rentExempt: null,
            excess: null,
            payerRole: roleByKey.get(keys[0]!) ?? null,
          });
        if (pre[i]! > 0n && post[i] === 0n)
          closedAccounts.push({
            address: k,
            lamportsBefore: pre[i]!.toString(),
          });
      });
      // SPYx movements keyed by token account (owner kept for labelling in the report).
      const spyxDeltas: Record<string, bigint> = {};
      const spyxOwners: Record<string, string> = {};
      for (const [sign, list] of [
        [-1n, res.meta.preTokenBalances ?? []],
        [1n, res.meta.postTokenBalances ?? []],
      ] as const) {
        for (const b of list) {
          if (b.mint !== SPYX_MINT) continue;
          const account = keys[b.accountIndex]!;
          if (b.owner) spyxOwners[account] = b.owner;
          spyxDeltas[account] =
            (spyxDeltas[account] ?? 0n) + sign * BigInt(b.uiTokenAmount.amount);
        }
      }
      const programs = [...new Set(names.map((n) => n.split(":")[0]))];
      const tx: TxRecord = {
        signature,
        slot: res.slot,
        sizeBytes: raw.length,
        numSignatures,
        feePayer: keys[0]!,
        feePayerRole: roleByKey.get(keys[0]!) ?? null,
        signers: keys.slice(0, numSignatures),
        instructions: names,
        label: names.length ? names.join(" + ") : programs.join(" + "),
        cuConsumed: res.meta.computeUnitsConsumed ?? null,
        cuLimit,
        cuPriceMicroLamports: cuPrice,
        baseFee: baseFee.toString(),
        priorityFee: priorityFee.toString(),
        mainnetFee: (baseFee + priorityFee).toString(),
        chargedFee: charged.toString(),
        metaFee: res.meta.fee,
        newAccounts,
        closedAccounts,
        roleLamportDeltas,
        spyxDeltas: Object.fromEntries(
          Object.entries(spyxDeltas)
            .filter(([, v]) => v !== 0n)
            .map(([k, v]) => [k, v.toString()]),
        ),
        spyxOwners,
      };
      for (const a of newAccounts)
        created.push({ tx, address: a.address, lamports: BigInt(a.lamports) });
      txs.push(tx);
    }

    // Sizes and owners of the accounts created in this step (closed ones stay unknown).
    const infos = created.length
      ? await connection.getMultipleAccountsInfo(
          created.map((c) => new web3.PublicKey(c.address)),
          "confirmed",
        )
      : [];
    created.forEach((c, i) => {
      const info = infos[i];
      const a = c.tx.newAccounts.find((x) => x.address === c.address)!;
      if (info) {
        a.owner = info.owner.toBase58();
        a.space = info.data.length;
        const min = rentExempt(rent, info.data.length);
        a.rentExempt = min.toString();
        a.excess = (c.lamports - min).toString();
      }
      a.label = labelFor(c.address, a.owner, a.space, ledger);
    });

    const logFile = flag(flags, "log") ?? null;
    const cliJson: unknown[] = [];
    if (logFile && existsSync(logFile)) {
      // Pretty-printed JSON blocks in the CLI output start with a line that is exactly "{".
      const lines = readFileSync(logFile, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== "{") continue;
        for (let j = i; j < lines.length; j++) {
          if (lines[j] !== "}") continue;
          try {
            cliJson.push(JSON.parse(lines.slice(i, j + 1).join("\n")));
            i = j;
            break;
          } catch {
            /* keep scanning */
          }
        }
      }
    }

    const endedAt = new Date();
    const step: Step = {
      index: ledger.steps.length + 1,
      name: open.name,
      category: open.category,
      command: open.command,
      logFile,
      startedAt: open.startedAt,
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - new Date(open.startedAt).getTime(),
      balancesBefore: open.balances,
      balancesAfter: await snapshot(connection, ledger),
      txs,
      cliJson,
    };
    ledger.steps.push(step);
    ledger.seen.push(...fresh);
    ledger.open = null;
    saveLedger(ledger);
    const cu = txs.reduce((a, t) => a + (t.cuConsumed ?? 0), 0);
    const fee = txs.reduce((a, t) => a + BigInt(t.mainnetFee), 0n);
    const rentSum = txs.reduce(
      (a, t) => a + t.newAccounts.reduce((b, x) => b + BigInt(x.lamports), 0n),
      0n,
    );
    const mismatched = txs.filter((t) => t.chargedFee !== t.mainnetFee).length;
    console.log(
      `[ledger] ${open.name} (${open.category}): ${txs.length} tx, ${cu} CU, mainnet fees ${fee} lamports, new-account lamports ${rentSum}` +
        (mismatched
          ? `, ${mismatched} tx where surfnet-charged fee != mainnet formula`
          : ""),
    );
    return;
  }

  throw new Error(`unknown command ${cmd}`);
});
