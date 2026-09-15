/**
 * Deploy a program build (default target/deploy/stockfloor.so at 98NLryxe…) to a LOCAL Surfpool
 * surfnet. Refuses any RPC URL that is not localhost/127.0.0.1.
 *
 *   bash scripts/surfpool/run.sh deploy-local
 *   bash scripts/surfpool/run.sh deploy-local --rpc http://127.0.0.1:9899 --mode loader
 *
 * Options:
 *   --rpc <url>                 local surfnet (default $SURFPOOL_RPC_URL or http://127.0.0.1:$RPC_PORT|8899)
 *   --program <name>            stockfloor (default) | spike; picks the .so, program keypair and IDL
 *   --so <path>                 program ELF (default target/deploy/<name>.so)
 *   --program-keypair <path>    keys/<name>-program.json (its pubkey is the program id)
 *   --authority <path>          upgrade authority and fee payer, under keys/ (default keys/deployer.json)
 *   --sol <n>                   local airdrop to the authority before deploying (default 100)
 *   --mode cheatcode|loader     cheatcode (default): surfnet_writeProgram writes the program and
 *                               programdata accounts directly. loader: real BPF upgradeable loader
 *                               transactions via `solana program deploy --use-rpc` against the surfnet.
 *   --no-idl                    do not register target/idl/<name>.json with surfnet_registerIdl
 *   --mainnet-token-programs    first replace Surfpool's bundled Token-2022 / SPL Token programs with
 *                               the mainnet ELFs from tests/fixtures (recommended; see docs/research/surfpool.md)
 *
 * Checks after deploying: program account (owner = upgradeable loader, executable, points at the
 * programdata PDA), programdata (upgrade authority, ELF bytes identical to the file), and a
 * simulated call with an unknown discriminator that must reach the program (Anchor
 * InstructionFallbackNotFound), which proves the ELF loads and executes on the surfnet.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BPF_LOADER_UPGRADEABLE_ID,
  connectSurfnet,
  flagString,
  loadRepoKeypair,
  parseArgs,
  REPO_ROOT,
  resolveRpcUrl,
  rpcCall,
  runMain,
  sleep,
  web3,
  writeProgram,
} from "./lib/surfnet.ts";

/** UpgradeableLoaderState::ProgramData metadata: tag u32 (3) + slot u64 + Option<Pubkey> (1 + 32). */
const PROGRAMDATA_METADATA_LEN = 45;

export interface DeployResult {
  programId: string;
  programData: string;
  authority: string;
  mode: "cheatcode" | "loader";
  elfBytes: number;
  elfSha256: string;
  programDataLen: number;
  deploySlot: number;
  simulatedUnknownIxLogs: string[];
}

export async function deployLocal(opts: {
  rpcUrl: string;
  soPath: string;
  programKeypairPath: string;
  authorityPath: string;
  airdropSol: number;
  mode: "cheatcode" | "loader";
  idlPath?: string;
}): Promise<DeployResult> {
  const { connection, version } = await connectSurfnet(opts.rpcUrl);
  console.log(`surfnet ${version["surfnet-version"]} (solana-core ${version["solana-core"]}) at ${opts.rpcUrl}`);

  if (!existsSync(opts.soPath)) throw new Error(`program ELF not found: ${opts.soPath}`);
  // Read once so a concurrent rebuild cannot change the bytes between deploy and verification.
  const elf = readFileSync(opts.soPath);
  const elfSha256 = createHash("sha256").update(elf).digest("hex");
  const programId = loadRepoKeypair(opts.programKeypairPath).publicKey;
  const authority = loadRepoKeypair(opts.authorityPath);
  const [programData] = web3.PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_ID);
  console.log(`program ${programId.toBase58()} <- ${opts.soPath} (${elf.length} bytes, sha256 ${elfSha256})`);
  console.log(`authority ${authority.publicKey.toBase58()}, mode ${opts.mode}`);

  if (opts.airdropSol > 0) {
    const before = await connection.getBalance(authority.publicKey);
    await rpcCall(opts.rpcUrl, "requestAirdrop", [authority.publicKey.toBase58(), opts.airdropSol * web3.LAMPORTS_PER_SOL]);
    let after = before;
    for (let i = 0; i < 50 && after <= before; i++) {
      await sleep(100);
      after = await connection.getBalance(authority.publicKey);
    }
    if (after <= before) throw new Error("local airdrop did not arrive");
    console.log(`airdrop: authority balance ${before / web3.LAMPORTS_PER_SOL} -> ${after / web3.LAMPORTS_PER_SOL} SOL`);
  }

  if (opts.mode === "cheatcode") {
    // surfnet_writeProgram never shrinks programdata; pad with zeros so a smaller rebuild leaves no
    // stale tail from the previous ELF.
    const existing = await connection.getAccountInfo(programData);
    const existingElfLen = existing ? Math.max(0, existing.data.length - PROGRAMDATA_METADATA_LEN) : 0;
    const payload = existingElfLen > elf.length ? Buffer.concat([elf, Buffer.alloc(existingElfLen - elf.length)]) : elf;
    const chunks = await writeProgram(opts.rpcUrl, programId, payload, authority.publicKey);
    console.log(`surfnet_writeProgram: ${payload.length} bytes in ${chunks} chunk(s)`);
  } else {
    deployWithLoader(opts.rpcUrl, opts.soPath, opts.programKeypairPath, opts.authorityPath);
  }

  // ---- verify accounts
  const program = await connection.getAccountInfo(programId, "processed");
  if (!program) throw new Error("program account missing after deploy");
  if (!program.owner.equals(BPF_LOADER_UPGRADEABLE_ID)) throw new Error(`program owner ${program.owner.toBase58()}`);
  if (!program.executable) throw new Error("program account is not executable");
  if (program.data.readUInt32LE(0) !== 2 || !new web3.PublicKey(program.data.subarray(4, 36)).equals(programData)) {
    throw new Error("program account does not point at its programdata PDA");
  }
  const pd = await connection.getAccountInfo(programData, "processed");
  if (!pd) throw new Error("programdata account missing after deploy");
  if (pd.data.readUInt32LE(0) !== 3) throw new Error("programdata has the wrong loader state tag");
  const deploySlot = Number(pd.data.readBigUInt64LE(4));
  if (pd.data[12] !== 1 || !new web3.PublicKey(pd.data.subarray(13, 45)).equals(authority.publicKey)) {
    throw new Error("programdata upgrade authority is not the deployer");
  }
  const onchainElf = pd.data.subarray(PROGRAMDATA_METADATA_LEN, PROGRAMDATA_METADATA_LEN + elf.length);
  if (!onchainElf.equals(elf)) throw new Error("programdata ELF bytes differ from the file");
  const tail = pd.data.subarray(PROGRAMDATA_METADATA_LEN + elf.length);
  if (tail.some((b) => b !== 0)) throw new Error("programdata has a non-zero tail after the ELF");
  console.log(`verified: program + programdata (${pd.data.length} bytes, slot ${deploySlot}, ELF identical)`);

  // ---- the program must load and execute: an unknown 8-byte discriminator reaches Anchor's fallback
  const tx = new web3.Transaction().add(
    new web3.TransactionInstruction({ programId, keys: [], data: Buffer.alloc(8, 0xff) }),
  );
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("processed")).blockhash;
  const sim = await connection.simulateTransaction(tx, [authority]);
  const logs = sim.value.logs ?? [];
  const invoked = logs.some((l) => l.startsWith(`Program ${programId.toBase58()} invoke`));
  const reachedProgram = logs.some((l) => /InstructionFallbackNotFound|Fallback functions are not supported/.test(l));
  if (!invoked || !reachedProgram) {
    throw new Error(`simulated call did not execute the program:\n${JSON.stringify(sim.value, null, 2)}`);
  }
  console.log(`executes: simulated unknown instruction -> ${logs.find((l) => /Error Code|Fallback/.test(l))}`);

  if (opts.idlPath && existsSync(opts.idlPath)) {
    try {
      const idl = JSON.parse(readFileSync(opts.idlPath, "utf8"));
      idl.address = programId.toBase58();
      await rpcCall(opts.rpcUrl, "surfnet_registerIdl", [idl]);
      console.log(`registered IDL ${opts.idlPath} (Studio / surfnet_getActiveIdl)`);
    } catch (e) {
      console.warn(`IDL registration skipped: ${(e as Error).message}`);
    }
  }

  return {
    programId: programId.toBase58(),
    programData: programData.toBase58(),
    authority: authority.publicKey.toBase58(),
    mode: opts.mode,
    elfBytes: elf.length,
    elfSha256,
    programDataLen: pd.data.length,
    deploySlot,
    simulatedUnknownIxLogs: logs,
  };
}

/** `solana program deploy --use-rpc` with a throwaway CLI config, so no user config or wallet is read. */
function deployWithLoader(rpcUrl: string, soPath: string, programKeypairPath: string, authorityPath: string): void {
  const dir = join(REPO_ROOT, ".surfpool", "solana-cli");
  mkdirSync(dir, { recursive: true });
  const abs = (p: string) => (p.startsWith("/") ? p : join(REPO_ROOT, p));
  // loadRepoKeypair already enforced that both keypairs are under keys/.
  const config = join(dir, "config.yml");
  writeFileSync(
    config,
    [
      `json_rpc_url: "${rpcUrl}"`,
      `websocket_url: ""`,
      `keypair_path: "${abs(authorityPath)}"`,
      `address_labels: {}`,
      `commitment: confirmed`,
      "",
    ].join("\n"),
  );
  const args = [
    "program",
    "deploy",
    "--config",
    config,
    "--url",
    rpcUrl,
    "--keypair",
    abs(authorityPath),
    "--fee-payer",
    abs(authorityPath),
    "--upgrade-authority",
    abs(authorityPath),
    "--program-id",
    abs(programKeypairPath),
    "--use-rpc",
    "--commitment",
    "confirmed",
    abs(soPath),
  ];
  console.log(`$ solana ${args.join(" ")}`);
  const res = spawnSync("solana", args, { stdio: "inherit", env: { ...process.env, SOLANA_CONFIG: config } });
  if (res.status !== 0) throw new Error(`solana program deploy failed with exit code ${res.status}`);
}

/**
 * Replace the token programs that Surfpool 1.5.0 bundles (litesvm 0.14.0: Token-2022 11.0.0 and
 * p-token/SPL Token 3.5.0 builds, loaded locally and never fetched from the datasource) with the
 * mainnet ELFs from tests/fixtures (dumped from mainnet, sha256 in manifest.json), so token CPIs
 * run the same binaries as mainnet and the LiteSVM fixture fork.
 */
export async function syncMainnetTokenPrograms(rpcUrl: string): Promise<Array<{ name: string; programId: string; bytes: number; sha256: string }>> {
  const { connection } = await connectSurfnet(rpcUrl);
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "tests", "fixtures", "manifest.json"), "utf8"));
  const out: Array<{ name: string; programId: string; bytes: number; sha256: string }> = [];
  for (const name of ["spl_token_2022", "spl_token"]) {
    const entry = manifest.programs.find((p: { name: string }) => p.name === name);
    if (!entry || entry.loader !== BPF_LOADER_UPGRADEABLE_ID.toBase58()) {
      throw new Error(`fixture ${name} is missing or not an upgradeable-loader program`);
    }
    const elf = readFileSync(join(REPO_ROOT, "tests", "fixtures", entry.file));
    const sha = createHash("sha256").update(elf).digest("hex");
    if (sha !== entry.sha256) throw new Error(`fixture ${entry.file} sha256 ${sha} != manifest ${entry.sha256}`);
    const programId = new web3.PublicKey(entry.address);
    const [programData] = web3.PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_ID);
    const existing = await connection.getAccountInfo(programData, "processed");
    const existingElfLen = existing ? Math.max(0, existing.data.length - PROGRAMDATA_METADATA_LEN) : 0;
    const payload = existingElfLen > elf.length ? Buffer.concat([elf, Buffer.alloc(existingElfLen - elf.length)]) : elf;
    // Upgrade authority is irrelevant locally; keep the loader's system-program placeholder.
    await writeProgram(rpcUrl, programId, payload, web3.SystemProgram.programId);
    const pd = await connection.getAccountInfo(programData, "processed");
    if (!pd || !pd.data.subarray(PROGRAMDATA_METADATA_LEN, PROGRAMDATA_METADATA_LEN + elf.length).equals(elf)) {
      throw new Error(`${name}: programdata does not hold the fixture ELF after the write`);
    }
    out.push({ name, programId: programId.toBase58(), bytes: elf.length, sha256: sha });
    console.log(`token program ${name} (${programId.toBase58()}) <- tests/fixtures/${entry.file} (${elf.length} bytes, mainnet sha256 ${sha})`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ["no-idl", "mainnet-token-programs"]);
  const rpcUrl = resolveRpcUrl(args);
  if (args.flags["mainnet-token-programs"]) await syncMainnetTokenPrograms(rpcUrl);
  const name = flagString(args, "program") ?? "stockfloor";
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error(`invalid program name ${name}`);
  const mode = (flagString(args, "mode") ?? "cheatcode") as "cheatcode" | "loader";
  if (mode !== "cheatcode" && mode !== "loader") throw new Error(`--mode must be cheatcode or loader`);
  const res = await deployLocal({
    rpcUrl,
    soPath: flagString(args, "so") ?? join(REPO_ROOT, "target", "deploy", `${name}.so`),
    programKeypairPath: flagString(args, "program-keypair") ?? join("keys", `${name}-program.json`),
    authorityPath: flagString(args, "authority") ?? join("keys", "deployer.json"),
    airdropSol: Number(flagString(args, "sol") ?? "100"),
    mode,
    idlPath: args.flags["no-idl"] ? undefined : join(REPO_ROOT, "target", "idl", `${name}.json`),
  });
  const { simulatedUnknownIxLogs: _logs, ...summary } = res;
  console.log(JSON.stringify(summary, null, 2));
}

runMain(import.meta.url, main);
