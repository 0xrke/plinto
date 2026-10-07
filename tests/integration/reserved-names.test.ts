/**
 * Reserved token names on the mainnet fork (real stockfloor, DBC 0.2.1, Metaplex Token Metadata).
 *
 * `register_pool` reads the base mint's Metaplex metadata (created by DBC in the same transaction as
 * the pool, immutable) and rejects a name or symbol that imitates the platform brand "Plinto"
 * (`ReservedTokenName`). The SDK refuses such names before tx1, so these tests build tx2 by hand,
 * the way a client that bypasses the SDK would:
 *
 * 1. In the product order (tx1 = create_config + create_launch, tx2 = DBC pool + register_pool) a
 *    reserved name reverts tx2 as a whole: no pool, base mint or metadata exist and the launch stays
 *    unregistered. The same launch then registers with an allowed name and the same base mint.
 * 2. Allowed look-alikes of the brand ("Planet", "PLAN", "Plink", ...) register normally.
 * 3. A DBC pool created without register_pool (DBC itself does not care about names) can never be
 *    registered by anyone, every harvest fails with PoolNotRegistered, and the SDK crank plans
 *    nothing for it.
 * 4. The metadata account is validated fail-closed (owner, key byte, mint, field lengths),
 *    and a client built before the check (5 accounts) fails with AccountNotEnoughKeys.
 */
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  authorityPda,
  buildDbcConfigParams,
  DEFAULT_QUOTE_ASSET,
  fetchLaunchState,
  isReservedTokenName,
  metaplexMetadataPda,
  planCrank,
  registerPoolIx as sdkRegisterPoolIx,
  type LaunchInput,
} from "@stockfloor/sdk";
import { describe, expect, it } from "vitest";
import {
  DBC_TOKEN_BADGE_SPYX,
  METAPLEX_PROGRAM_ID,
  SPYX_MINT,
} from "../src/constants.js";
import {
  createConfigIx,
  deriveMetaplexMetadata,
  initializeVirtualPoolWithSplTokenIx,
} from "../src/dbc.js";
import { expectFeeModelV3 } from "../src/fee-model.js";
import { anchorErrorFromLogs, Fork, TxFailure } from "../src/fork.js";
import { buyOnCurve, fundedWallet } from "../src/scenario.js";
import {
  createStockfloorLaunch,
  SPYX_USD_PRICE,
  spyxMultiplier,
} from "../src/stockfloor-scenario.js";
import {
  createLaunchIx,
  fetchLaunch,
  harvestCurveFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  registerPoolIx,
  syncMigrationIx,
} from "../src/stockfloor.js";
import { LiteSvmSender } from "../sdk/litesvm-sender.js";

const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;
const errCode = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.code;

/** Error numbers appended to StockfloorError (never renumbered). */
const RESERVED_TOKEN_NAME = 6066;
const INVALID_TOKEN_METADATA = 6067;

/** Reserved spellings, each with a symbol; the last ones hit through the symbol only. */
const RESERVED: Array<[string, string]> = [
  ["PLINTO", "PLNT"],
  ["Plіnto", "CYR"], // Cyrillic і
  ["ＰＬＩＮＴＯ", "FW"], // fullwidth, 18 bytes
  ["ΡLΙΝΤΟ", "GRK"], // Greek capitals
  ["𝐏𝐋𝐈𝐍𝐓𝐎", "BOLD"], // mathematical bold, 24 bytes
  ["Pl​into", "ZWSP"], // zero-width space inside
  ["P L I N T A", "PLA"],
  ["Moon Rocket", "PL1NT"], // symbol only
  ["Good Coin", "РLІNТ"], // symbol only, Cyrillic
];

/** Allowed names close to the brand. */
const ALLOWED: Array<[string, string]> = [
  ["Planet", "PLAN"],
  ["Plink", "PLINK"],
  ["Paint", "PINT"],
];

interface Tx1 {
  fork: Fork;
  partner: Keypair;
  creator: Keypair;
  config: PublicKey;
  baseMint: Keypair;
}

/** tx1 of the product flow: DBC config and create_launch (the base mint does not exist yet). */
async function tx1(fork: Fork): Promise<Tx1> {
  const partner = fork.newWallet();
  const creator = fork.newWallet();
  const configKeypair = Keypair.generate();
  const config = configKeypair.publicKey;
  const input: LaunchInput = {
    name: "unused",
    symbol: "UNUSED",
    uri: "https://example.com/x.json",
    quote: DEFAULT_QUOTE_ASSET,
    quotePriceUsd: SPYX_USD_PRICE,
    quoteMultiplier: spyxMultiplier(fork),
    preset: "gentle",
    vaultSharePct: 50,
    thresholdUsd: 1000,
    exitFeeBps: 200,
  };
  const claimer = authorityPda(config)[0];
  const { feeClaimer, leftoverReceiver, quoteMint, ...params } =
    buildDbcConfigParams(input, claimer, claimer);
  expectFeeModelV3(params, input.vaultSharePct);
  const baseMint = Keypair.generate();
  fork.send(
    [
      await createConfigIx({
        config,
        feeClaimer,
        leftoverReceiver,
        quoteMint,
        payer: partner.publicKey,
        params: params as never,
        tokenBadge: DBC_TOKEN_BADGE_SPYX,
      }),
      await createLaunchIx({
        payer: partner.publicKey,
        creator: creator.publicKey,
        config,
        baseMint: baseMint.publicKey,
        exitFeeBps: 200,
      }),
    ],
    [partner, configKeypair, creator],
  );
  return { fork, partner, creator, config, baseMint };
}

/** tx2 of the product flow: DBC pool + register_pool, atomically. */
async function tx2(t: Tx1, name: string, symbol: string) {
  const init = await initializeVirtualPoolWithSplTokenIx({
    config: t.config,
    creator: t.creator.publicKey,
    baseMint: t.baseMint.publicKey,
    quoteMint: SPYX_MINT,
    payer: t.creator.publicKey,
    name,
    symbol,
    uri: "https://example.com/x.json",
    tokenBadge: DBC_TOKEN_BADGE_SPYX,
  });
  const register = await registerPoolIx({
    config: t.config,
    pool: init.pool,
    baseMint: t.baseMint.publicKey,
  });
  return {
    ixs: [init.ix, register],
    pool: init.pool,
    signers: [t.creator, t.baseMint],
  };
}

function expectNothingCreated(t: Tx1, pool: PublicKey) {
  expect(t.fork.getAccount(pool)).toBeNull();
  expect(t.fork.getAccount(t.baseMint.publicKey)).toBeNull();
  expect(
    t.fork.getAccount(deriveMetaplexMetadata(t.baseMint.publicKey)),
  ).toBeNull();
  expect(fetchLaunch(t.fork, t.config).pool.equals(PublicKey.default)).toBe(
    true,
  );
}

describe("reserved token names (register_pool)", () => {
  it("the SDK and fork constants agree on the Metaplex metadata PDA", () => {
    const mint = Keypair.generate().publicKey;
    expect(metaplexMetadataPda(mint).equals(deriveMetaplexMetadata(mint))).toBe(
      true,
    );
    expect(METAPLEX_PROGRAM_ID.toBase58()).toBe(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    );
  });

  it("a reserved name or symbol reverts tx2 as a whole; the same launch then registers an allowed name", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    for (const [name, symbol] of RESERVED) {
      expect(isReservedTokenName(name, symbol), `${name}/${symbol}`).toBe(true);
      const t = await tx1(fork);
      const { ixs, pool, signers } = await tx2(t, name, symbol);
      const fail = fork.sendExpectFail(ixs, signers);
      expect(errName(fail), `${name}/${symbol}`).toBe("ReservedTokenName");
      expect(errCode(fail)).toBe(RESERVED_TOKEN_NAME);
      expectNothingCreated(t, pool);

      // Recoverable: the creator retries tx2 with an allowed name and the same base mint keypair.
      const retry = await tx2(t, "Floor Coin", "FLC");
      fork.send(retry.ixs, retry.signers);
      expect(fetchLaunch(fork, t.config).pool.equals(retry.pool)).toBe(true);
    }
  });

  it("allowed names close to the brand register normally", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    for (const [name, symbol] of ALLOWED) {
      expect(isReservedTokenName(name, symbol)).toBe(false);
      const t = await tx1(fork);
      const { ixs, pool, signers } = await tx2(t, name, symbol);
      fork.send(ixs, signers);
      expect(fetchLaunch(fork, t.config).pool.equals(pool)).toBe(true);
    }
    // Maximum-length fields (32-byte name, 10-byte symbol) are read whole.
    const t = await tx1(fork);
    const { ixs, signers } = await tx2(t, "A".repeat(31) + "B", "C".repeat(10));
    fork.send(ixs, signers);
    const t2 = await tx1(fork);
    const maxHit = await tx2(t2, "A".repeat(27) + "PLINT", "C".repeat(10));
    expect(errName(fork.sendExpectFail(maxHit.ixs, maxHit.signers))).toBe(
      "ReservedTokenName",
    );
    const t3 = await tx1(fork);
    const symbolMax = await tx2(t3, "Fine", "XXXXXPLINT");
    expect(errName(fork.sendExpectFail(symbolMax.ixs, symbolMax.signers))).toBe(
      "ReservedTokenName",
    );
  });

  it("a pool created without register_pool can never be registered, harvested or cranked", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    // DBC does not check names: the pool exists and trades, but the launch is never registered.
    const L = await createStockfloorLaunch(fork, {
      name: "PLINTO",
      symbol: "PLNT",
      skipRegister: true,
    });
    expect(fork.getAccount(L.keys.pool)).not.toBeNull();
    const buyer = fundedWallet(fork, 1_000_000_000n);
    await buyOnCurve(fork, L.keys, buyer, 100_000_000n);

    const stranger = fork.newWallet(1);
    const reg = fork.sendExpectFail(
      [
        await registerPoolIx({
          config: L.config,
          pool: L.keys.pool,
          baseMint: L.keys.baseMint,
        }),
      ],
      [stranger],
    );
    expect(errName(reg)).toBe("ReservedTokenName");
    expect(fetchLaunch(fork, L.config).pool.equals(PublicKey.default)).toBe(
      true,
    );

    for (const [label, ix] of [
      [
        "harvest_curve_fees",
        harvestCurveFeesIx({ payer: stranger.publicKey, keys: L.keys }),
      ],
      ["harvest_migration_fee", harvestMigrationFeeIx({ keys: L.keys })],
      ["harvest_surplus", harvestSurplusIx({ keys: L.keys })],
      [
        "sync_migration",
        syncMigrationIx({ config: L.config, pool: L.keys.pool }),
      ],
    ] as const) {
      expect(errName(fork.sendExpectFail([await ix], [stranger])), label).toBe(
        "PoolNotRegistered",
      );
    }

    // The SDK reads the name of an unregistered launch and plans no register_pool or harvest.
    const reader = new LiteSvmSender(fork, stranger);
    const state = (await fetchLaunchState(reader, { config: L.config }))!;
    expect(state.dbcPool).not.toBeNull();
    expect(state.dbcPool!.partnerQuoteFee).toBeGreaterThan(0n);
    expect(state.reservedName).toBe(true);
    expect(planCrank(state)).toEqual([]);

    // An allowed unregistered launch is still planned for registration.
    const ok = await createStockfloorLaunch(fork, {
      name: "Planet",
      symbol: "PLAN",
      skipRegister: true,
    });
    const okState = (await fetchLaunchState(reader, { config: ok.config }))!;
    expect(okState.reservedName).toBe(false);
    expect(planCrank(okState).map((a) => a.kind)).toEqual(["register_pool"]);
  });

  it("the metadata account is validated fail-closed", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const L = await createStockfloorLaunch(fork, {
      name: "Planet",
      symbol: "PLAN",
      skipRegister: true,
    });
    const other = await createStockfloorLaunch(fork, {
      name: "Other",
      symbol: "OTH",
      skipRegister: true,
    });
    const metadata = deriveMetaplexMetadata(L.keys.baseMint);
    const original = fork.mustGetAccount(metadata);
    const registrar = fork.newWallet(1);
    const send = async (overrides?: Record<string, PublicKey>) =>
      fork.sendTx(
        [
          await registerPoolIx({
            config: L.config,
            pool: L.keys.pool,
            baseMint: L.keys.baseMint,
            overrides,
          }),
        ],
        [registrar],
      );
    const expectInvalid = async (
      label: string,
      overrides?: Record<string, PublicKey>,
    ) => {
      const res = await send(overrides);
      expect(res.ok, label).toBe(false);
      expect(errName(res as TxFailure), label).toBe("InvalidTokenMetadata");
      expect(errCode(res as TxFailure), label).toBe(INVALID_TOKEN_METADATA);
      expect(
        fetchLaunch(fork, L.config).pool.equals(PublicKey.default),
        label,
      ).toBe(true);
    };
    const patched = async (
      label: string,
      mutate: (d: Buffer) => void,
      owner = original.owner,
    ) => {
      const data = Buffer.from(original.data);
      mutate(data);
      fork.setAccount(metadata, { ...original, data, owner });
      const res = await send();
      fork.setAccount(metadata, original);
      return res;
    };

    // Another account in the metadata slot.
    await expectInvalid("another mint's metadata", {
      baseMintMetadata: deriveMetaplexMetadata(other.keys.baseMint),
    });
    await expectInvalid("a wallet", { baseMintMetadata: registrar.publicKey });
    await expectInvalid("the system program", {
      baseMintMetadata: SystemProgram.programId,
    });

    // The right address with tampered contents.
    for (const [label, mutate, owner] of [
      ["wrong owner", () => {}, SystemProgram.programId],
      ["key byte is not MetadataV1", (d: Buffer) => (d[0] = 6), undefined],
      [
        "mint field is another mint",
        (d: Buffer) => other.keys.baseMint.toBuffer().copy(d, 33),
        undefined,
      ],
      ["name length 33", (d: Buffer) => d.writeUInt32LE(33, 65), undefined],
      [
        "name length beyond the data",
        (d: Buffer) => d.writeUInt32LE(0xffffffff, 65),
        undefined,
      ],
      ["symbol length 11", (d: Buffer) => d.writeUInt32LE(11, 101), undefined],
    ] as const) {
      const res = await patched(
        label,
        mutate as (d: Buffer) => void,
        owner ?? original.owner,
      );
      expect(res.ok, label).toBe(false);
      expect(errName(res as TxFailure), label).toBe("InvalidTokenMetadata");
    }
    const truncated = await (async () => {
      fork.setAccount(metadata, {
        ...original,
        data: original.data.subarray(0, 100),
      });
      const res = await send();
      fork.setAccount(metadata, original);
      return res;
    })();
    expect(errName(truncated as TxFailure)).toBe("InvalidTokenMetadata");

    // Name bytes rewritten in place: the reserved check reads what is stored.
    const renamed = await patched("renamed", (d) =>
      d.write("PLINTO\0\0", 69, "utf8"),
    );
    expect(errName(renamed as TxFailure)).toBe("ReservedTokenName");
    const resymboled = await patched("symbol", (d) =>
      d.write("PL1NT", 105, "utf8"),
    );
    expect(errName(resymboled as TxFailure)).toBe("ReservedTokenName");

    // A client built before the check (5 accounts) fails; the restored account registers.
    const legacy = sdkRegisterPoolIx({
      config: L.config,
      pool: L.keys.pool,
      baseMint: L.keys.baseMint,
    });
    expect(legacy.keys).toHaveLength(6);
    legacy.keys = legacy.keys.slice(0, 5);
    const old = fork.sendExpectFail([legacy], [registrar]);
    expect(errName(old)).toBe("AccountNotEnoughKeys");

    const ok = await send();
    expect(ok.ok).toBe(true);
    expect(fetchLaunch(fork, L.config).pool.equals(L.keys.pool)).toBe(true);
  });
});
