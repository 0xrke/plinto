/**
 * How many Meteora DBC configs on mainnet quote a tokenized stock, and what do they do with the
 * migration fee? This is the scan behind the market claim in README.md, "The problem".
 *
 * READ-ONLY. It sends no transaction: the only RPC methods it calls are `getProgramAccounts`,
 * `getMultipleAccounts` and `getSlot`.
 *
 *   packages/sdk/node_modules/.bin/tsx scripts/research/stock-quoted-dbc-configs.ts \
 *     [--rpc <url>] [--out docs/research/stock-quoted-dbc-configs.json] [--quiet]
 *
 * Method, so the numbers can be re-derived rather than believed:
 *
 *  1. **Which mints count as "a stock token".** Every xStocks mint is a Token-2022 mint whose
 *     `PermanentDelegate` extension names the same issuer authority as SPYx
 *     (`XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`, the quote asset StockFloor launches in).
 *     That is an on-chain property, not a curated list, so the population is reproducible.
 *  2. **Which of those can be a DBC quote mint.** DBC requires a `TokenBadge` PDA for a Token-2022
 *     quote mint with extensions, so every stock-quoted config has one. The badges are the DBC
 *     accounts of size 168 (8-byte discriminator + `TokenBadge::INIT_SPACE` 160); the mint is at
 *     offset 8. Scanning the badges instead of all 500k configs keeps this a small query.
 *  3. **The configs.** For each stock mint, `getProgramAccounts` on DBC with `dataSize` 1048
 *     (`PoolConfig`) and `memcmp` at offset 8 (`quote_mint` is the first field). From each account:
 *     `fee_claimer` at 40 and `migration_fee_percentage` at 247 (struct offsets 32 and 239, plus the
 *     8-byte discriminator), fetched as one `dataSlice` of 208 bytes from offset 40.
 *  4. **What they do with the fee.** A config gives its migration fee away only if the percentage
 *     is non-zero; where it goes is decided by `fee_claimer`, so the scan also counts how many name
 *     an address that is off the ed25519 curve (a PDA, i.e. a program rather than a person).
 *
 * What the scan cannot decide: whether a config with a PDA fee claimer routes the raise into
 * something a holder can redeem against. That needs reading each program, which is the manual
 * review in README.md, "Prior art and differentiation".
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Web3 from "@solana/web3.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// web3.js lives in the SDK workspace package, like the other repo scripts.
const { PublicKey } = createRequire(
  join(REPO_ROOT, "packages", "sdk", "package.json"),
)("@solana/web3.js") as typeof Web3;

const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SPYX_MINT = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const TOKEN_BADGE_SIZE = 168;
const POOL_CONFIG_SIZE = 1048;
/** Token-2022 extension type ids. */
const EXT_PERMANENT_DELEGATE = 12;
const EXT_TOKEN_METADATA = 19;

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const rpcUrl = argOf(
  "rpc",
  process.env.MAINNET_READ_RPC_URL ?? "https://api.mainnet-beta.solana.com",
);
const outPath = argOf("out", "docs/research/stock-quoted-dbc-configs.json");
const quiet = args.includes("--quiet");
const log = (s: string) => {
  if (!quiet) console.error(s);
};

let requestId = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const allowed = ["getProgramAccounts", "getMultipleAccounts", "getSlot"];
  if (!allowed.includes(method))
    throw new Error(`method not allowed in a read-only scan: ${method}`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    });
    const body = (await res.json()) as {
      result?: T;
      error?: { message: string; code: number };
    };
    if (body.error) {
      // The public endpoint rate-limits getProgramAccounts hard; back off and keep going.
      const retryable =
        res.status === 429 ||
        body.error.code === -32005 ||
        /too many requests|rate limit/i.test(body.error.message);
      if (retryable && attempt < 12) {
        await new Promise((r) =>
          setTimeout(r, Math.min(20_000, 1500 * 2 ** Math.min(attempt, 4))),
        );
        continue;
      }
      throw new Error(`${method}: ${body.error.message}`);
    }
    return body.result as T;
  }
}

const decode = (b64: string): Buffer => Buffer.from(b64, "base64");
const isPda = (address: string): boolean =>
  !PublicKey.isOnCurve(new PublicKey(address).toBytes());

/** Token-2022 TLV walk from offset 166 (165 is the account type byte). */
function extension(data: Buffer, type: number): Buffer | null {
  let o = 166;
  while (o + 4 <= data.length) {
    const t = data.readUInt16LE(o);
    const len = data.readUInt16LE(o + 2);
    if (o + 4 + len > data.length) return null;
    if (t === type) return data.subarray(o + 4, o + 4 + len);
    o += 4 + len;
  }
  return null;
}

/** `TokenMetadata` is a borsh struct: update authority, mint, then length-prefixed name, symbol. */
function metadataSymbol(data: Buffer): string | null {
  const ext = extension(data, EXT_TOKEN_METADATA);
  if (!ext || ext.length < 68) return null;
  let o = 64;
  const nameLen = ext.readUInt32LE(o);
  o += 4 + nameLen;
  if (o + 4 > ext.length) return null;
  const symLen = ext.readUInt32LE(o);
  o += 4;
  if (o + symLen > ext.length) return null;
  return ext.subarray(o, o + symLen).toString("utf8");
}

function permanentDelegate(data: Buffer): string | null {
  const ext = extension(data, EXT_PERMANENT_DELEGATE);
  return ext && ext.length >= 32
    ? new PublicKey(ext.subarray(0, 32)).toBase58()
    : null;
}

interface RpcAccount {
  pubkey: string;
  account: { data: [string, string]; owner: string };
}

async function main(): Promise<number> {
  const slot = await rpc<number>("getSlot", []);
  log(`rpc ${new URL(rpcUrl).origin} · slot ${slot}`);

  // 1. DBC token badges -> candidate quote mints.
  const badges = await rpc<RpcAccount[]>("getProgramAccounts", [
    DBC_PROGRAM,
    {
      encoding: "base64",
      filters: [{ dataSize: TOKEN_BADGE_SIZE }],
      dataSlice: { offset: 8, length: 32 },
    },
  ]);
  const badgeMints = badges.map((b) =>
    new PublicKey(decode(b.account.data[0])).toBase58(),
  );
  log(`${badgeMints.length} DBC token badges`);

  // 2. Which badge mints are xStocks: same Token-2022 permanent delegate as SPYx.
  const mintAccounts = new Map<string, Buffer>();
  const wanted = [...new Set([...badgeMints, SPYX_MINT])];
  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100);
    const res = await rpc<{
      value: Array<{ data: [string, string]; owner: string } | null>;
    }>("getMultipleAccounts", [batch, { encoding: "base64" }]);
    res.value.forEach((a, j) => {
      if (a && a.owner === TOKEN_2022)
        mintAccounts.set(batch[j]!, decode(a.data[0]));
    });
  }
  const spyx = mintAccounts.get(SPYX_MINT);
  if (!spyx) throw new Error("SPYx mint not found or not a Token-2022 mint");
  const issuer = permanentDelegate(spyx);
  if (!issuer)
    throw new Error(
      "SPYx has no PermanentDelegate extension: the scan's definition no longer holds",
    );
  log(`xStocks issuer permanent delegate: ${issuer}`);

  const stockMints = [...mintAccounts.entries()]
    .filter(([, data]) => permanentDelegate(data) === issuer)
    .map(([mint, data]) => ({ mint, symbol: metadataSymbol(data) }))
    .sort((a, b) => (a.symbol ?? a.mint).localeCompare(b.symbol ?? b.mint));
  log(
    `${stockMints.length} of them are xStocks (badged and issued by ${issuer.slice(0, 8)}…)`,
  );

  // 3-4. Configs per stock mint (a few at a time: 740 sequential getProgramAccounts on a public
  // RPC takes too long, and more than a handful in flight gets rate limited).
  type MintRow = {
    symbol: string | null;
    mint: string;
    configs: number;
    zeroMigrationFee: number;
    pdaFeeClaimer: number;
    pdaFeeClaimerWithMigrationFee: number;
  };
  // Sequential with a pause: the public endpoint rejects concurrent getProgramAccounts calls.
  const PAUSE_MS = Number(argOf("pause-ms", "700"));
  const scanMint = async ({
    mint,
    symbol,
  }: {
    mint: string;
    symbol: string | null;
  }): Promise<MintRow> => {
    const accounts = await rpc<RpcAccount[]>("getProgramAccounts", [
      DBC_PROGRAM,
      {
        encoding: "base64",
        filters: [
          { dataSize: POOL_CONFIG_SIZE },
          { memcmp: { offset: 8, bytes: mint } },
        ],
        // fee_claimer (40..72) through migration_fee_percentage (247) in one slice.
        dataSlice: { offset: 40, length: 208 },
      },
    ]);
    let zero = 0;
    let pda = 0;
    let pdaWithFee = 0;
    for (const a of accounts) {
      const data = decode(a.account.data[0]);
      const pct = data.readUInt8(207);
      const claimerIsPda = isPda(
        new PublicKey(data.subarray(0, 32)).toBase58(),
      );
      if (pct === 0) zero++;
      if (claimerIsPda) pda++;
      if (claimerIsPda && pct > 0) pdaWithFee++;
    }
    if (accounts.length > 0)
      log(
        `  ${(symbol ?? mint).padEnd(10)} ${String(accounts.length).padStart(5)} configs, ${zero} with a 0% migration fee, ${pdaWithFee} with a PDA fee claimer and a non-zero fee`,
      );
    return {
      symbol,
      mint,
      configs: accounts.length,
      zeroMigrationFee: zero,
      pdaFeeClaimer: pda,
      pdaFeeClaimerWithMigrationFee: pdaWithFee,
    };
  };
  const perMint: MintRow[] = [];
  for (const [i, m] of stockMints.entries()) {
    perMint.push(await scanMint(m));
    if ((i + 1) % 50 === 0)
      log(`  ... ${i + 1}/${stockMints.length} mints scanned`);
    if (PAUSE_MS > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  const totals = perMint.reduce(
    (t, r) => ({
      configs: t.configs + r.configs,
      zeroMigrationFee: t.zeroMigrationFee + r.zeroMigrationFee,
      pdaFeeClaimer: t.pdaFeeClaimer + r.pdaFeeClaimer,
      pdaFeeClaimerWithFee:
        t.pdaFeeClaimerWithFee + r.pdaFeeClaimerWithMigrationFee,
    }),
    {
      configs: 0,
      zeroMigrationFee: 0,
      pdaFeeClaimer: 0,
      pdaFeeClaimerWithFee: 0,
    },
  );

  const result = {
    scannedAt: new Date().toISOString(),
    rpc: new URL(rpcUrl).origin,
    slot,
    method: {
      stockMint: `Token-2022 mint whose PermanentDelegate is the SPYx issuer authority ${issuer}`,
      population: `DBC TokenBadge accounts (dataSize ${TOKEN_BADGE_SIZE}), mint at offset 8`,
      configs: `getProgramAccounts(${DBC_PROGRAM}, dataSize ${POOL_CONFIG_SIZE}, memcmp@8 = quote mint)`,
      fields:
        "fee_claimer@40, migration_fee_percentage@247, migration_quote_threshold@264",
    },
    issuerPermanentDelegate: issuer,
    tokenBadges: badgeMints.length,
    stockQuoteMints: stockMints.length,
    totals,
    perMint: perMint.filter((r) => r.configs > 0),
    mintsWithNoConfigs: perMint.filter((r) => r.configs === 0).length,
  };
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");

  console.log(
    [
      `slot ${slot}: ${totals.configs} DBC configs quote one of ${stockMints.length} xStocks mints.`,
      `${totals.zeroMigrationFee} of them (${((100 * totals.zeroMigrationFee) / Math.max(1, totals.configs)).toFixed(1)}%) set the migration fee to 0%, so the whole raise goes to the AMM.`,
      `${totals.pdaFeeClaimerWithFee} take a migration fee and pay it to a program (an off-curve fee_claimer).`,
      `wrote ${outPath}`,
    ].join("\n"),
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
