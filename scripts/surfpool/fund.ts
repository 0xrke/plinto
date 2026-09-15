/**
 * Local faucet for a Surfpool surfnet: SOL via the local requestAirdrop, and SPYx (or any
 * allowlisted quote asset / explicit mint) via cheatcodes. Refuses any RPC URL that is not
 * localhost/127.0.0.1.
 *
 *   bash scripts/surfpool/run.sh fund <wallet>                          # 10 SOL + 10 SPYx
 *   bash scripts/surfpool/run.sh fund <wallet> --sol 2 --token QQQx --amount 3.5
 *   bash scripts/surfpool/run.sh fund <wallet> --sol 0 --token <mint> --raw 131346320
 *
 * Options:
 *   --rpc <url>        local surfnet (default $SURFPOOL_RPC_URL or http://127.0.0.1:$RPC_PORT|8899)
 *   --sol <n>          SOL to airdrop (default 10; 0 skips)
 *   --token <sym|mint> allowlist symbol (SPYx, QQQx, …) or a mint address (default SPYx; "none" skips)
 *   --amount <ui>      token amount in whole tokens, i.e. raw / 10^decimals (default 10). The wallet's
 *                      displayed balance also applies the ScaledUiAmount multiplier (SPYx ≈ 1.0057).
 *   --raw <n>          token amount in raw units (overrides --amount)
 *   --payer <path>     pays for creating the token account, under keys/ (default keys/deployer.json)
 *
 * How the token balance is set: the wallet's associated token account is created through the real
 * ATA program in a local transaction (so Token-2022 account extensions such as ImmutableOwner,
 * PausableAccount and TransferHookAccount are sized correctly), then surfnet_setAccount adds the raw
 * amount to the account's balance and to the mint supply (supply stays equal to the sum of balances).
 * surfnet_setTokenAccount is not used: in Surfpool 1.5.0 it rewrites Token-2022 accounts as a bare
 * 165-byte account without extensions.
 */
import { QUOTE_ALLOWLIST } from "../../packages/sdk/src/allowlist.ts";
import type * as Web3 from "../../tests/node_modules/@solana/web3.js";
import {
  connectSurfnet,
  createAtaIdempotentIx,
  flagString,
  getAta,
  loadRepoKeypair,
  MINT_DECIMALS_OFFSET,
  MINT_SUPPLY_OFFSET,
  parseArgs,
  resolveRpcUrl,
  rpcCall,
  runMain,
  setAccount,
  sleep,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_ACCOUNT_AMOUNT_OFFSET,
  TOKEN_PROGRAM_ID,
  uiToRaw,
  web3,
} from "./lib/surfnet.ts";

const U64_MAX = (1n << 64n) - 1n;

export interface FundSolResult {
  wallet: string;
  lamportsBefore: number;
  lamportsAfter: number;
}

/** Local requestAirdrop, waiting until the balance reflects it. */
export async function fundSol(rpcUrl: string, wallet: Web3.PublicKey, sol: number): Promise<FundSolResult> {
  const { connection } = await connectSurfnet(rpcUrl);
  const lamports = Math.round(sol * web3.LAMPORTS_PER_SOL);
  const before = await connection.getBalance(wallet, "processed");
  await rpcCall(rpcUrl, "requestAirdrop", [wallet.toBase58(), lamports]);
  let after = before;
  for (let i = 0; i < 50 && after < before + lamports; i++) {
    await sleep(100);
    after = await connection.getBalance(wallet, "processed");
  }
  if (after < before + lamports) throw new Error(`airdrop to ${wallet.toBase58()} did not arrive`);
  return { wallet: wallet.toBase58(), lamportsBefore: before, lamportsAfter: after };
}

export interface FundTokenResult {
  wallet: string;
  mint: string;
  tokenProgram: string;
  tokenAccount: string;
  decimals: number;
  createdTokenAccount: boolean;
  tokenAccountBytes: number;
  rawBefore: string;
  rawAfter: string;
  mintSupplyBefore: string;
  mintSupplyAfter: string;
}

/** Resolve an allowlist symbol (case-insensitive) or a base58 mint. */
export function resolveMint(token: string): Web3.PublicKey {
  const hit = QUOTE_ALLOWLIST.find((a) => a.symbol.toLowerCase() === token.toLowerCase());
  return new web3.PublicKey(hit ? hit.mint : token);
}

/**
 * Add `rawAmount` of `mint` to the wallet's ATA (created through the ATA program if missing, paid by
 * `payer`) and to the mint supply. The mint is fetched from the datasource on first use.
 */
export async function fundToken(
  rpcUrl: string,
  wallet: Web3.PublicKey,
  mint: Web3.PublicKey,
  rawAmount: bigint,
  payer: Web3.Keypair,
): Promise<FundTokenResult> {
  const { connection } = await connectSurfnet(rpcUrl);
  const mintAcc = await connection.getAccountInfo(mint, "processed");
  if (!mintAcc) throw new Error(`mint ${mint.toBase58()} not found (locally or on the datasource)`);
  const tokenProgram = mintAcc.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(`${mint.toBase58()} is not a token mint (owner ${tokenProgram.toBase58()})`);
  }
  const decimals = mintAcc.data[MINT_DECIMALS_OFFSET];
  const ata = getAta(wallet, mint, tokenProgram);

  let created = false;
  let acc = await connection.getAccountInfo(ata, "processed");
  if (!acc) {
    if ((await connection.getBalance(payer.publicKey, "processed")) < 0.01 * web3.LAMPORTS_PER_SOL) {
      await fundSol(rpcUrl, payer.publicKey, 1);
    }
    const tx = new web3.Transaction().add(createAtaIdempotentIx(payer.publicKey, wallet, mint, tokenProgram));
    tx.feePayer = payer.publicKey;
    const sig = await web3.sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    created = true;
    acc = await connection.getAccountInfo(ata, "confirmed");
    if (!acc) throw new Error(`token account ${ata.toBase58()} missing after create (tx ${sig})`);
  }
  if (!acc.owner.equals(tokenProgram)) throw new Error(`${ata.toBase58()} is not owned by the token program`);

  const data = Buffer.from(acc.data);
  const rawBefore = data.readBigUInt64LE(TOKEN_ACCOUNT_AMOUNT_OFFSET);
  const rawAfter = rawBefore + rawAmount;
  const mintData = Buffer.from(mintAcc.data);
  const supplyBefore = mintData.readBigUInt64LE(MINT_SUPPLY_OFFSET);
  const supplyAfter = supplyBefore + rawAmount;
  if (rawAfter > U64_MAX || supplyAfter > U64_MAX) throw new Error("amount overflows u64");

  data.writeBigUInt64LE(rawAfter, TOKEN_ACCOUNT_AMOUNT_OFFSET);
  mintData.writeBigUInt64LE(supplyAfter, MINT_SUPPLY_OFFSET);
  // Partial updates keep lamports, owner and executable; data is replaced as a whole (extensions kept).
  await setAccount(rpcUrl, ata, { data });
  await setAccount(rpcUrl, mint, { data: mintData });

  const check = await connection.getAccountInfo(ata, "processed");
  if (!check || check.data.readBigUInt64LE(TOKEN_ACCOUNT_AMOUNT_OFFSET) !== rawAfter) {
    throw new Error("token balance cheatcode did not apply");
  }
  return {
    wallet: wallet.toBase58(),
    mint: mint.toBase58(),
    tokenProgram: tokenProgram.toBase58(),
    tokenAccount: ata.toBase58(),
    decimals,
    createdTokenAccount: created,
    tokenAccountBytes: check.data.length,
    rawBefore: rawBefore.toString(),
    rawAfter: rawAfter.toString(),
    mintSupplyBefore: supplyBefore.toString(),
    mintSupplyAfter: supplyAfter.toString(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = resolveRpcUrl(args);
  const walletStr = args.positional[0] ?? flagString(args, "wallet");
  if (!walletStr) throw new Error("usage: fund <wallet> [--sol 10] [--token SPYx] [--amount 10 | --raw N] [--rpc URL]");
  const wallet = new web3.PublicKey(walletStr);
  await connectSurfnet(rpcUrl);

  const sol = Number(flagString(args, "sol") ?? "10");
  if (!Number.isFinite(sol) || sol < 0) throw new Error(`invalid --sol ${sol}`);
  if (sol > 0) console.log(JSON.stringify({ sol: await fundSol(rpcUrl, wallet, sol) }, null, 2));

  const token = flagString(args, "token") ?? "SPYx";
  if (token.toLowerCase() === "none") return;
  const mint = resolveMint(token);
  const raw = flagString(args, "raw");
  let rawAmount: bigint;
  if (raw !== undefined) {
    if (!/^\d+$/.test(raw)) throw new Error(`invalid --raw ${raw}`);
    rawAmount = BigInt(raw);
  } else {
    const { connection } = await connectSurfnet(rpcUrl);
    const mintAcc = await connection.getAccountInfo(mint, "processed");
    if (!mintAcc) throw new Error(`mint ${mint.toBase58()} not found`);
    rawAmount = uiToRaw(flagString(args, "amount") ?? "10", mintAcc.data[MINT_DECIMALS_OFFSET]);
  }
  const payer = loadRepoKeypair(flagString(args, "payer") ?? "keys/deployer.json");
  console.log(JSON.stringify({ token: await fundToken(rpcUrl, wallet, mint, rawAmount, payer) }, null, 2));
}

runMain(import.meta.url, main);
