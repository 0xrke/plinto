/**
 * Local surfnet preparation for the C2 rehearsal (LOCAL Surfpool only; mainnet is only read).
 *
 *   tsx scripts/e2e/setup.ts check-fresh                      # surfnet forking mainnet, no stockfloor deployed yet
 *   tsx scripts/e2e/setup.ts mainnet-rent                     # copy mainnet's Rent sysvar into the surfnet
 *   tsx scripts/e2e/setup.ts token-programs                   # mainnet Token-2022 / SPL Token ELFs (tests/fixtures)
 *   tsx scripts/e2e/setup.ts fund <keys/x.json|pubkey> --sol 1 [--spyx-raw N]
 *   tsx scripts/e2e/setup.ts pubkey keys/x.json
 *   tsx scripts/e2e/setup.ts check-rent                       # local Rent sysvar still equals mainnet's
 *   tsx scripts/e2e/setup.ts relay-check                      # no local signature exists on mainnet
 *
 * Why the Rent sysvar is copied: Surfpool 1.5.0 (litesvm 0.14) ships lamports_per_byte_year 6960,
 * mainnet now uses 5080 (2026-09-16), so every rent-exempt balance created on the fork would be
 * 37% higher than on mainnet. After surfnet_setAccount on SysvarRent the runtime rent-state check
 * and Rent::get() in programs use the mainnet value (verified: a create_account below the new
 * minimum fails with InsufficientFundsForRent).
 */
import { syncMainnetTokenPrograms } from "../surfpool/deploy-local.ts";
import { fundSol, fundToken } from "../surfpool/fund.ts";
import {
  MAINNET_GENESIS,
  PROGRAM_NAMES,
  RENT_SYSVAR,
  SPYX_MINT,
  connectSurfnet,
  flag,
  loadRepoKeypair,
  localRpcUrl,
  main,
  mainnetRead,
  parseFlags,
  readRentSysvar,
  rentExempt,
  rpcCall,
  web3,
} from "./lib.ts";

const STOCKFLOOR = Object.keys(PROGRAM_NAMES).find(
  (k) => PROGRAM_NAMES[k] === "stockfloor",
)!;

function walletArg(v: string | undefined): InstanceType<typeof web3.PublicKey> {
  if (!v) throw new Error("wallet (keys/<name>.json or pubkey) is required");
  if (v.endsWith(".json")) return loadRepoKeypair(v).publicKey;
  return new web3.PublicKey(v);
}

main(async () => {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const cmd = positional[0];
  const rpc = localRpcUrl();

  switch (cmd) {
    case "pubkey": {
      console.log(walletArg(positional[1]).toBase58());
      return;
    }
    case "check-fresh": {
      const { connection, version } = await connectSurfnet(rpc);
      const genesis = await connection.getGenesisHash();
      if (genesis !== MAINNET_GENESIS)
        throw new Error(
          `surfnet genesis ${genesis} is not mainnet's: start it with a mainnet datasource`,
        );
      await rpcCall(rpc, "surfnet_getLocalSignatures", [1]);
      const program = await connection.getAccountInfo(
        new web3.PublicKey(STOCKFLOOR),
        "processed",
      );
      if (program)
        throw new Error(
          `stockfloor ${STOCKFLOOR} already exists on this surfnet: restart it for a fresh rehearsal`,
        );
      console.log(
        `fresh surfnet ${version["surfnet-version"]} forking mainnet (genesis ${genesis}); stockfloor not deployed`,
      );
      return;
    }
    case "mainnet-rent": {
      await connectSurfnet(rpc);
      const mainnet = await readRentSysvar((m, p) => mainnetRead(m, p));
      const local = await readRentSysvar((m, p) => rpcCall(rpc, m, p));
      console.log(
        `rent sysvar: mainnet ${JSON.stringify(mainnet.params, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}, surfnet before ${JSON.stringify(local.params, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
      );
      await rpcCall(rpc, "surfnet_setAccount", [
        RENT_SYSVAR,
        { data: Buffer.from(mainnet.raw, "base64").toString("hex") },
      ]);
      const after = await readRentSysvar((m, p) => rpcCall(rpc, m, p));
      if (after.raw !== mainnet.raw)
        throw new Error("surfnet rent sysvar did not take the mainnet value");
      for (const space of [0, 82, 165, 1048]) {
        const [m, l] = await Promise.all([
          mainnetRead<number>("getMinimumBalanceForRentExemption", [space]),
          rpcCall<number>(rpc, "getMinimumBalanceForRentExemption", [space]),
        ]);
        if (m !== l || BigInt(m) !== rentExempt(after.params, space))
          throw new Error(
            `rent for ${space} bytes: mainnet ${m}, surfnet ${l}`,
          );
      }
      console.log(
        "surfnet rent sysvar = mainnet (getMinimumBalanceForRentExemption equal for 0/82/165/1048 bytes)",
      );
      return;
    }
    case "check-rent": {
      const [mainnet, local] = await Promise.all([
        readRentSysvar((m, p) => mainnetRead(m, p)),
        readRentSysvar((m, p) => rpcCall(rpc, m, p)),
      ]);
      if (mainnet.raw !== local.raw)
        throw new Error(
          `surfnet rent sysvar drifted from mainnet (${local.raw} vs ${mainnet.raw})`,
        );
      console.log("surfnet rent sysvar still equals mainnet's");
      return;
    }
    case "relay-check": {
      // Every signature this surfnet executed must be unknown to mainnet (read-only lookup).
      const res = await rpcCall<{ value: Array<{ signature: string }> }>(
        rpc,
        "surfnet_getLocalSignatures",
        [100_000],
      );
      const sigs = res.value.map((v) => v.signature);
      let found = 0;
      for (let i = 0; i < sigs.length; i += 100) {
        const r = await mainnetRead<{ value: unknown[] }>(
          "getSignatureStatuses",
          [sigs.slice(i, i + 100), { searchTransactionHistory: true }],
        );
        found += r.value.filter((v) => v !== null).length;
      }
      console.log(
        `mainnet relay check: ${found} of ${sigs.length} local signatures exist on mainnet (expected 0)`,
      );
      if (found !== 0) throw new Error("a local signature exists on mainnet");
      return;
    }
    case "token-programs": {
      await syncMainnetTokenPrograms(rpc);
      return;
    }
    case "fund": {
      const wallet = walletArg(positional[1]);
      const sol = Number(flag(flags, "sol") ?? "0");
      if (sol > 0) {
        const r = await fundSol(rpc, wallet, sol);
        console.log(
          `fund ${wallet.toBase58()}: ${r.lamportsBefore} -> ${r.lamportsAfter} lamports`,
        );
      }
      const spyx = flag(flags, "spyx-raw");
      if (spyx && BigInt(spyx) > 0n) {
        const payer = loadRepoKeypair(
          flag(flags, "payer") ?? "keys/deployer.json",
        );
        const r = await fundToken(
          rpc,
          wallet,
          new web3.PublicKey(SPYX_MINT),
          BigInt(spyx),
          payer,
        );
        console.log(
          `fund ${wallet.toBase58()}: SPYx ${r.rawBefore} -> ${r.rawAfter} raw (ATA ${r.tokenAccount}, ${r.tokenAccountBytes} bytes)`,
        );
      }
      return;
    }
    default:
      throw new Error(`unknown command ${cmd}`);
  }
});
