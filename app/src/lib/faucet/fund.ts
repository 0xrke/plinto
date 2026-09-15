import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { associatedTokenAddress, bytesToHex, createAtaIdempotentIx, isLoopbackRpcUrl, type QuoteAsset } from "@stockfloor/sdk";

/** Token account `amount` (u64 LE) and mint `supply` (u64 LE) offsets, identical for SPL Token and Token-2022. */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const MINT_SUPPLY_OFFSET = 36;
const MINT_DECIMALS_OFFSET = 44;
const U64_MAX = (1n << 64n) - 1n;

export interface FundResult {
  wallet: string;
  solLamportsAdded: string;
  solLamports: string;
  token: string;
  mint: string;
  tokenAccount: string;
  rawAdded: string;
  tokenRaw: string;
  createdTokenAccount: boolean;
}

export interface FundParams {
  rpcUrl: string;
  wallet: PublicKey;
  asset: QuoteAsset;
  solLamports: bigint;
  /** Whole tokens (raw / 10^decimals), without the ScaledUiAmount multiplier. */
  tokenWhole: bigint;
  fetch?: typeof fetch;
}

async function rpc(fetchFn: typeof fetch, url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function withU64(data: Uint8Array, offset: number, value: bigint): Uint8Array {
  if (value < 0n || value > U64_MAX) throw new RangeError("amount overflows u64");
  const copy = Uint8Array.from(data);
  new DataView(copy.buffer).setBigUint64(offset, value, true);
  return copy;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function airdrop(connection: Connection, fetchFn: typeof fetch, rpcUrl: string, to: PublicKey, lamports: bigint): Promise<bigint> {
  const before = BigInt(await connection.getBalance(to, "processed"));
  await rpc(fetchFn, rpcUrl, "requestAirdrop", [to.toBase58(), Number(lamports)]);
  for (let i = 0; i < 60; i++) {
    const now = BigInt(await connection.getBalance(to, "processed"));
    if (now >= before + lamports) return now;
    await sleep(100);
  }
  throw new Error(`airdrop to ${to.toBase58()} did not arrive`);
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialize faucet runs: token balances and the mint supply are patched read-modify-write. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Fund a wallet on a local Surfpool surfnet (the caller has run the guard):
 * 1. SOL through the surfnet's requestAirdrop.
 * 2. The wallet's associated token account for the quote asset, created through the real ATA program
 *    (so Token-2022 account extensions are sized correctly), paid by an in-memory keypair that is
 *    funded by airdrop and discarded.
 * 3. `surfnet_setAccount` adds the raw amount to the token account and to the mint supply (data is hex).
 */
export function fundWallet(p: FundParams): Promise<FundResult> {
  if (!isLoopbackRpcUrl(p.rpcUrl)) return Promise.reject(new Error("refusing: faucet RPC is not loopback"));
  return exclusive(async () => {
    const fetchFn = p.fetch ?? fetch;
    const connection = new Connection(p.rpcUrl, "confirmed");
    const solLamports = p.solLamports > 0n ? await airdrop(connection, fetchFn, p.rpcUrl, p.wallet, p.solLamports) : BigInt(await connection.getBalance(p.wallet));

    const mint = new PublicKey(p.asset.mint);
    const mintAcc = await connection.getAccountInfo(mint, "processed");
    if (!mintAcc) throw new Error(`mint ${p.asset.symbol} not found on the surfnet`);
    const tokenProgram = mintAcc.owner;
    const decimals = mintAcc.data[MINT_DECIMALS_OFFSET]!;
    const ata = associatedTokenAddress(p.wallet, mint, tokenProgram);

    let created = false;
    let acc = await connection.getAccountInfo(ata, "processed");
    if (!acc) {
      const payer = Keypair.generate();
      await airdrop(connection, fetchFn, p.rpcUrl, payer.publicKey, BigInt(LAMPORTS_PER_SOL / 20));
      const tx = new Transaction().add(createAtaIdempotentIx(payer.publicKey, p.wallet, mint, tokenProgram));
      await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
      created = true;
      acc = await connection.getAccountInfo(ata, "confirmed");
      if (!acc) throw new Error("token account missing after creation");
    }
    if (!acc.owner.equals(tokenProgram)) throw new Error("token account is not owned by the token program");

    const raw = p.tokenWhole * 10n ** BigInt(decimals);
    const tokenRaw = readU64(acc.data, TOKEN_ACCOUNT_AMOUNT_OFFSET) + raw;
    const supply = readU64(mintAcc.data, MINT_SUPPLY_OFFSET) + raw;
    if (raw > 0n) {
      await rpc(fetchFn, p.rpcUrl, "surfnet_setAccount", [ata.toBase58(), { data: bytesToHex(withU64(acc.data, TOKEN_ACCOUNT_AMOUNT_OFFSET, tokenRaw)) }]);
      await rpc(fetchFn, p.rpcUrl, "surfnet_setAccount", [mint.toBase58(), { data: bytesToHex(withU64(mintAcc.data, MINT_SUPPLY_OFFSET, supply)) }]);
      const check = await connection.getAccountInfo(ata, "processed");
      if (!check || readU64(check.data, TOKEN_ACCOUNT_AMOUNT_OFFSET) !== tokenRaw) throw new Error("token balance cheatcode did not apply");
    }
    return {
      wallet: p.wallet.toBase58(),
      solLamportsAdded: p.solLamports.toString(),
      solLamports: solLamports.toString(),
      token: p.asset.symbol,
      mint: mint.toBase58(),
      tokenAccount: ata.toBase58(),
      rawAdded: raw.toString(),
      tokenRaw: tokenRaw.toString(),
      createdTokenAccount: created,
    };
  });
}
