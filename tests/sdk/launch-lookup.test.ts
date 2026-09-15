/**
 * Base-mint launch lookup against duplicate Launch accounts, on the LiteSVM mainnet fork.
 *
 * Review finding (post-M5): `create_launch` only checks that the base mint is not the default key or
 * the quote mint, so anyone can create a pool-less Launch (their own DBC config, about 0.01 SOL) that
 * commits the base mint of an existing launch as soon as tx1 reveals it. getProgramAccounts then
 * returns two Launch accounts for the mint in no guaranteed order, and the SDK took `found[0]`.
 *
 * A base mint has exactly one DBC pool, so at most one launch can own it: `resolveLaunchByBaseMint`
 * returns that launch (registered pool, or canonical pool that exists with the launch config) in
 * either RPC order, a single pool-less match as not canonical, and throws on several pool-less matches.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  AmbiguousLaunchError,
  authorityPda,
  buildDbcConfigParams,
  buildLaunchTransactions,
  computeThresholdQuoteRaw,
  createLaunchIx,
  dbcCreateConfigIx,
  dbcInitializePoolWithSplTokenIx,
  DEFAULT_QUOTE_ASSET,
  effectiveMintMultiplier,
  fetchLaunchState,
  getClock,
  getLaunch,
  getMintInfo,
  listLaunches,
  resolveLaunchAddress,
  resolveLaunchByBaseMint,
  resolveTokenBadge,
  TOKEN_2022_PROGRAM_ID,
  CU_LIMITS,
  type ChainReader,
  type LaunchInput,
} from "@stockfloor/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { SPYX_MINT } from "../src/constants.js";
import { Fork } from "../src/fork.js";
import { fundSpyx } from "../src/token.js";
import { LiteSvmSender } from "./litesvm-sender.js";

describe("base-mint launch lookup with duplicate pool-less Launch accounts", () => {
  let fork: Fork;
  let admin: LiteSvmSender;
  let input: LaunchInput;
  let n = 0;

  const walletSender = (spyx: bigint) => {
    const kp = fork.newWallet(20);
    if (spyx > 0n) fundSpyx(fork, kp, kp.publicKey, spyx);
    return admin.withSigner(kp);
  };

  /** The same reader with getProgramAccounts results reversed (RPC order is not guaranteed). */
  const reversed = (r: LiteSvmSender): ChainReader =>
    new Proxy(r, {
      get(target, prop, receiver) {
        if (prop === "getProgramAccounts") return async (...a: Parameters<LiteSvmSender["getProgramAccounts"]>) => (await target.getProgramAccounts(...a)).reverse();
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });

  /** A real launch, built by the SDK composer: returns the planned transactions without sending tx2. */
  async function realLaunch() {
    const creator = walletSender(computeThresholdQuoteRaw(input));
    const built = buildLaunchTransactions({ ...input, symbol: `REAL${++n}` }, creator.payer);
    const [tx1, tx2] = built.transactions;
    await creator.send(tx1!.instructions, { signers: tx1!.signers, computeUnitLimit: tx1!.computeUnitLimit, label: tx1!.label });
    return { creator, built, sendPool: () => creator.send(tx2!.instructions, { signers: tx2!.signers, computeUnitLimit: tx2!.computeUnitLimit, label: tx2!.label }) };
  }

  /** The attack: an own DBC config and a create_launch that commits someone else's base mint. */
  async function fakeLaunch(baseMint: PublicKey): Promise<PublicKey> {
    const attacker = walletSender(0n);
    const configKp = Keypair.generate();
    const config = configKp.publicKey;
    const claimer = authorityPda(config)[0];
    const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams({ ...input, symbol: "FAKE" }, claimer, claimer);
    await attacker.send(
      [
        dbcCreateConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer: attacker.payer, params, tokenBadge: resolveTokenBadge(quoteMint, TOKEN_2022_PROGRAM_ID) }),
        createLaunchIx({ payer: attacker.payer, creator: attacker.payer, config, baseMint, quoteMint, exitFeeBps: 200 }),
      ],
      { signers: [configKp], computeUnitLimit: CU_LIMITS.dbcCreateConfig + CU_LIMITS.createLaunch, label: "fake create_launch" },
    );
    return (await getLaunch(admin, { config }))!.address;
  }

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    admin = new LiteSvmSender(fork, fork.newWallet(100));
    const { mint } = await getMintInfo(admin, SPYX_MINT);
    const clock = await getClock(admin);
    input = {
      name: "Lookup",
      symbol: "LOOK",
      uri: "https://example.com/lookup.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: 757.02,
      quoteMultiplier: effectiveMintMultiplier(mint, clock.unixTimestamp),
      preset: "gentle",
      vaultSharePct: 50,
      thresholdUsd: 1000,
      exitFeeBps: 200,
    };
  });

  it("a fake pool-less Launch for a live launch's mint never wins, in either RPC order", async () => {
    const real = await realLaunch();
    const mint = real.built.addresses.baseMint;
    const launch = real.built.addresses.launch;

    // Between tx1 and tx2 the real launch is the only match: returned, but not canonical.
    expect(await resolveLaunchByBaseMint(admin, mint)).toMatchObject({ address: launch, canonical: false });

    // The attacker front-runs tx2: two pool-less matches are ambiguous (no guess).
    const fake1 = await fakeLaunch(mint);
    const raw = await admin.getProgramAccounts((await admin.getAccountInfo(launch))!.owner, {});
    expect(raw.some((a) => a.pubkey.equals(fake1))).toBe(true);
    for (const reader of [admin, reversed(admin)]) {
      await expect(resolveLaunchByBaseMint(reader, mint)).rejects.toBeInstanceOf(AmbiguousLaunchError);
      await expect(getLaunch(reader, { baseMint: mint })).rejects.toBeInstanceOf(AmbiguousLaunchError);
    }

    // tx2 creates and registers the pool: the real launch is the canonical one in both orders.
    await real.sendPool();
    const fake2 = await fakeLaunch(mint);
    const matches = await listLaunches(admin);
    expect(matches.filter((l) => l.launch.baseMint.equals(mint)).map((l) => l.address.toBase58()).sort()).toEqual([launch, fake1, fake2].map((k) => k.toBase58()).sort());
    const orders = [await admin.getProgramAccounts((await admin.getAccountInfo(launch))!.owner, {}), (await reversed(admin).getProgramAccounts((await admin.getAccountInfo(launch))!.owner, {}))];
    expect(orders[0]![0]!.pubkey.equals(orders[1]![0]!.pubkey)).toBe(false);
    for (const reader of [admin, reversed(admin)]) {
      expect(await resolveLaunchByBaseMint(reader, mint)).toMatchObject({ address: launch, canonical: true });
      expect((await resolveLaunchAddress(reader, { baseMint: mint })).equals(launch)).toBe(true);
      const s = await fetchLaunchState(reader, { baseMint: mint });
      expect(s!.address.equals(launch)).toBe(true);
      expect(s!.launch.poolRegistered).toBe(true);
      expect(s!.dbcPool).not.toBeNull();
    }
    // The fakes stay reachable by their own address; they are just never the launch of the mint.
    expect((await fetchLaunchState(admin, { launch: fake1 }))!.dbcPool).toBeNull();
  });

  it("an existing but unregistered canonical pool also identifies the real launch", async () => {
    const creator = walletSender(0n);
    const configKp = Keypair.generate();
    const baseMintKp = Keypair.generate();
    const built = buildLaunchTransactions({ ...input, symbol: `UNREG${++n}` }, creator.payer, { configKeypair: configKp, baseMintKeypair: baseMintKp });
    const tx1 = built.transactions[0]!;
    await creator.send(tx1.instructions, { signers: tx1.signers, computeUnitLimit: tx1.computeUnitLimit, label: tx1.label });
    const mint = baseMintKp.publicKey;
    const fake = await fakeLaunch(mint);
    // The pool without register_pool (the registration is permissionless and can come later).
    await creator.send(
      [dbcInitializePoolWithSplTokenIx({ config: configKp.publicKey, creator: creator.payer, baseMint: mint, quoteMint: SPYX_MINT, payer: creator.payer, name: input.name, symbol: "UNREG", uri: input.uri })],
      { signers: [baseMintKp], computeUnitLimit: CU_LIMITS.dbcInitializePool, label: "pool only" },
    );
    for (const reader of [admin, reversed(admin)]) {
      const m = await resolveLaunchByBaseMint(reader, mint);
      expect(m).toMatchObject({ address: built.addresses.launch, canonical: true });
      expect(m!.launch.poolRegistered).toBe(false);
    }
    expect(fake.equals(built.addresses.launch)).toBe(false);
    expect(await resolveLaunchByBaseMint(admin, Keypair.generate().publicKey)).toBeNull();
  });
});
