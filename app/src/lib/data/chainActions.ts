import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  DAMM_V2_PROGRAM_ID,
  DBC_PROGRAM_ID,
  DbcSwapMode,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  WSOL_MINT,
  buildLaunchTransactions,
  buildRedeem,
  buildTrade,
  crankActionKey,
  effectiveMintMultiplier,
  fetchLaunchState,
  getAtaBalance,
  getClock,
  getLaunch,
  getMintInfo,
  planCrank,
  runCrank,
  swapParams2,
  type BuiltLaunch,
  type BuiltTrade,
  type ChainReader,
  type CrankAction,
  type LaunchInput,
  type LaunchRef,
  type LaunchState,
  type SendOptions,
  type TxSender,
} from "@stockfloor/sdk";
import type { ClusterInfo } from "../chain/cluster";
import { UserFacingError, friendlyError } from "../chain/errors";
import { ultraSwap } from "../chain/jupiterRoute";
import { noopDispatch, runSteps, type FlowDispatch, type StepPhase, type StepRunner } from "../chain/txFlow";
import { requireSigningWallet, type SenderFactory, type SigningWallet } from "../chain/walletSender";
import { formatTokenAmount } from "../format";
import type {
  ActionOptions,
  ActionResult,
  CrankOutcome,
  CreateLaunchOptions,
  CreatedLaunch,
  LaunchActions,
  LaunchResume,
  LaunchSummary,
  RedeemOutcome,
  RedeemRequest,
  TradeOutcome,
  TradeRequest,
  WalletSigner,
} from "./types";

/** Rent and fees for the launch transactions (config, launch, vault, pool, vaults, mint, metadata). */
export const MIN_LAUNCH_LAMPORTS = 50_000_000n;
/** Fees plus a possible ATA rent for a trade or redemption. */
export const MIN_TRADE_LAMPORTS = 5_000_000n;
/** Migration also pays position NFT rent. */
export const MIN_CRANK_LAMPORTS = 20_000_000n;

export interface ChainActionsDeps {
  reader: ChainReader;
  createSender: SenderFactory;
  cluster: () => Promise<ClusterInfo>;
  fetchState?: (reader: ChainReader, ref: LaunchRef) => Promise<LaunchState | null>;
  runCrank?: typeof runCrank;
  ultraSwap?: typeof ultraSwap;
}

const LAUNCH_STEP_LABELS: Record<string, string> = {
  "create_config+create_launch": "Create the DBC config and the launch vault",
  "create_pool+register_pool+first_buy": "Create the token and its pool, register it, first buy",
  "create_pool+register_pool": "Create the token and its pool, register it",
  first_buy: "First buy on the bonding curve",
};

/**
 * Labels per crank action kind. A lookup with a readable fallback (not an exhaustive switch), so an SDK
 * that adds a crank action still type-checks and shows a sensible label.
 */
const CRANK_ACTION_LABELS: Record<string, string> = {
  register_pool: "Register the DBC pool",
  harvest_curve_fees: "Harvest curve trading fees into the vault",
  harvest_migration_fee: "Harvest the migration fee into the vault",
  harvest_surplus: "Harvest the curve surplus into the vault",
  migrate: "Migrate the pool to Meteora DAMM v2",
  sync_migration: "Record the migration on the launch",
  harvest_lp_fees: "Harvest DAMM v2 LP fees into the vault",
  burn_claimer_base: "Burn base tokens held by the claimer",
};

export function crankActionLabel(a: Pick<CrankAction, "kind">): string {
  const kind: string = a.kind;
  return CRANK_ACTION_LABELS[kind] ?? `Crank step: ${kind.replace(/_/g, " ")}`;
}

interface LaunchSession {
  handle: LaunchResume;
  built: BuiltLaunch;
  completed: Set<string>;
  signatures: string[];
  /** Priority fee the transactions were sized with (micro-lamports per CU). */
  priorityFeeMicroLamports: number;
}

function lamportsLabel(lamports: bigint): string {
  return `${formatTokenAmount(lamports, 9, { maxFractionDigits: 4 })} SOL`;
}

/**
 * Wallet-signed transactions through the SDK. Every action checks the cluster send guard first,
 * reads fresh chain state, checks balances with a clear message, and reports progress through the
 * transaction flow state machine (lib/chain/txFlow.ts).
 */
export class ChainLaunchActions implements LaunchActions {
  private readonly sessions = new Map<string, LaunchSession>();
  private readonly fetchState: NonNullable<ChainActionsDeps["fetchState"]>;
  private readonly crankRunner: typeof runCrank;
  private readonly swap: typeof ultraSwap;

  constructor(private readonly deps: ChainActionsDeps) {
    this.fetchState = deps.fetchState ?? ((reader, ref) => fetchLaunchState(reader, ref));
    this.crankRunner = deps.runCrank ?? runCrank;
    this.swap = deps.ultraSwap ?? ultraSwap;
  }

  private async sendableCluster(): Promise<ClusterInfo> {
    const info = await this.deps.cluster();
    if (!info.sendGuard.allowed) {
      throw new UserFacingError(`Sending is disabled for this RPC. ${capitalize(info.sendGuard.reason.replace(/^refusing: /, ""))}.`);
    }
    return info;
  }

  private sender(wallet: SigningWallet, dispatch: FlowDispatch, stepId: () => string | null): TxSender {
    return this.deps.createSender(wallet, (phase: StepPhase) => {
      const id = stepId();
      if (id) dispatch({ type: "step-phase", id, phase });
    });
  }

  private async requireLamports(wallet: SigningWallet, min: bigint, cluster: ClusterInfo, what: string): Promise<void> {
    const acc = await this.deps.reader.getAccountInfo(wallet.publicKey);
    const lamports = BigInt(acc?.lamports ?? 0);
    if (lamports < min) {
      throw new UserFacingError(
        `${what} needs at least ${lamportsLabel(min)} for fees and rent; your wallet has ${lamportsLabel(lamports)}.${cluster.faucet ? " Use the local faucet in the header." : ""}`,
      );
    }
  }

  private async freshState(launch: LaunchSummary): Promise<LaunchState> {
    const state = await this.fetchState(this.deps.reader, { launch: new PublicKey(launch.launchAddress) });
    if (!state) throw new UserFacingError("This launch was not found on the cluster.");
    return state;
  }

  // ---------------------------------------------------------------- create

  async createLaunch(input: LaunchInput, wallet: WalletSigner, opts: CreateLaunchOptions = {}): Promise<ActionResult<CreatedLaunch, LaunchResume>> {
    const dispatch = opts.dispatch ?? noopDispatch;
    let session: LaunchSession | undefined;
    try {
      const w = requireSigningWallet(wallet);
      const cluster = await this.sendableCluster();
      if (opts.resume) {
        session = this.sessions.get(opts.resume.config);
        if (!session) throw new UserFacingError("This retry is no longer available (the page was reloaded). Start the launch again.");
        if (!session.built.transactions.length || !session.handle.mint) throw new UserFacingError("Invalid retry handle.");
      } else {
        session = await this.prepareLaunch(input, w, cluster, opts.firstBuyQuoteRaw);
        this.sessions.set(session.handle.config, session);
      }
      const s = session;
      const reader = this.deps.reader;
      const addresses = s.built.addresses;
      dispatch({ type: "start", steps: s.built.transactions.map((t) => ({ id: t.label, label: LAUNCH_STEP_LABELS[t.label] ?? t.label })) });
      for (const id of s.completed) dispatch({ type: "step-succeeded", id, detail: "Confirmed in an earlier attempt" });

      let active: string | null = null;
      const runners: StepRunner[] = s.built.transactions.map((t) => ({
        id: t.label,
        label: t.label,
        alreadyDone: async () => {
          if (t.label === "create_config+create_launch") return (await reader.getAccountInfo(addresses.launch)) !== null;
          if (t.label.startsWith("create_pool")) return (await getLaunch(reader, { launch: addresses.launch }))?.launch.poolRegistered === true;
          return false;
        },
        run: async () => {
          active = t.label;
          const res = await this.sender(w, dispatch, () => active).send(t.instructions, {
            signers: t.signers,
            computeUnitLimit: t.computeUnitLimit,
            computeUnitPriceMicroLamports: s.priorityFeeMicroLamports,
            label: t.label,
          });
          s.signatures.push(res.signature);
          return { signature: res.signature };
        },
      }));
      await runSteps(runners, dispatch, s.completed, friendlyError);
      this.sessions.delete(s.handle.config);
      dispatch({ type: "finish", result: `Launch created. Mint ${addresses.baseMint.toBase58()}` });
      return {
        ok: true,
        value: { mint: addresses.baseMint.toBase58(), config: addresses.config.toBase58(), launch: addresses.launch.toBase58() },
        signatures: s.signatures,
      };
    } catch (e) {
      const error = friendlyError(e);
      dispatch({ type: "fail", error });
      return { ok: false, error, signatures: session?.signatures, resume: session && this.sessions.has(session.handle.config) ? session.handle : undefined };
    }
  }

  private async prepareLaunch(input: LaunchInput, w: SigningWallet, cluster: ClusterInfo, firstBuyQuoteRaw: bigint | undefined): Promise<LaunchSession> {
    const reader = this.deps.reader;
    const quoteMint = new PublicKey(input.quote.mint);
    const [{ mint, tokenProgram }, clock] = await Promise.all([getMintInfo(reader, quoteMint), getClock(reader)]);
    if (mint.paused) throw new UserFacingError(`${input.quote.symbol} is paused by its issuer; launches quoted in it cannot trade right now.`);
    // The on-chain multiplier at the cluster clock is authoritative for the threshold conversion.
    const multiplier = effectiveMintMultiplier(mint, clock.unixTimestamp);
    const firstBuy = firstBuyQuoteRaw && firstBuyQuoteRaw > 0n ? { quoteAmount: firstBuyQuoteRaw, slippageBps: 100 } : undefined;
    const priorityFeeMicroLamports = cluster.priorityFeeMicroLamports;
    const built = buildLaunchTransactions({ ...input, quoteMultiplier: multiplier }, w.publicKey, {
      quoteTokenProgram: tokenProgram,
      firstBuy,
      nowUnixSeconds: clock.unixTimestamp,
      // Size accounting includes the SetComputeUnitPrice instruction the sender adds.
      computeUnitPriceMicroLamports: priorityFeeMicroLamports,
    });
    await this.requireLamports(w, MIN_LAUNCH_LAMPORTS, cluster, "Launching");
    if (firstBuy) {
      const balance = await getAtaBalance(reader, w.publicKey, quoteMint, tokenProgram);
      if (balance < firstBuy.quoteAmount) {
        throw new UserFacingError(
          `Your first buy needs ${formatTokenAmount(firstBuy.quoteAmount, mint.decimals, { multiplier, maxFractionDigits: 8 })} ${input.quote.symbol}; your wallet holds ${formatTokenAmount(balance, mint.decimals, { multiplier, maxFractionDigits: 8 })} ${input.quote.symbol}.${cluster.faucet ? " Use the local faucet in the header." : ""}`,
        );
      }
    }
    return {
      handle: { kind: "launch-resume", mint: built.addresses.baseMint.toBase58(), config: built.addresses.config.toBase58() },
      built,
      completed: new Set(),
      signatures: [],
      priorityFeeMicroLamports,
    };
  }

  // ---------------------------------------------------------------- trade

  async trade(request: TradeRequest, wallet: WalletSigner, opts: ActionOptions = {}): Promise<ActionResult<TradeOutcome>> {
    const dispatch = opts.dispatch ?? noopDispatch;
    const signatures: string[] = [];
    try {
      const w = requireSigningWallet(wallet);
      if (request.amountRaw <= 0n) throw new UserFacingError("Enter an amount greater than zero.");
      const cluster = await this.sendableCluster();
      const { launch, side, payToken } = request;
      const quoteSymbol = launch.quote.asset.symbol;
      if (payToken !== "QUOTE" && !cluster.jupiterRouting) {
        throw new UserFacingError(
          `Routing ${payToken} through Jupiter works on mainnet only. On this ${cluster.kind === "local-fork" ? "local fork" : "cluster"}, ${side === "buy" ? "pay with" : "receive"} ${quoteSymbol} directly.`,
        );
      }
      const state = await this.freshState(launch);
      if (state.quoteMint.paused) throw new UserFacingError(`${quoteSymbol} is paused by its issuer; trading resumes when it is unpaused.`);
      if (state.phase === "graduating") throw new UserFacingError("The curve is complete. Trading resumes on DAMM v2 after migration; run the crank to migrate.");
      await this.requireLamports(w, MIN_TRADE_LAMPORTS, cluster, "Trading");

      if (payToken === "QUOTE") {
        const outcome = await this.directTrade(state, launch, w, side, request.amountRaw, request.slippageBps, dispatch, signatures, true, cluster.priorityFeeMicroLamports, request.expected);
        dispatch({ type: "finish", result: outcome.summary });
        return { ok: true, value: outcome.value, signatures };
      }
      return await this.routedTrade(state, launch, w, request, dispatch, signatures, cluster.priorityFeeMicroLamports);
    } catch (e) {
      const error = friendlyError(e);
      dispatch({ type: "fail", error });
      return { ok: false, error, signatures };
    }
  }

  /** Buy or sell against the launch's own pool (DBC curve in presale, DAMM v2 after migration). */
  private async directTrade(
    state: LaunchState,
    launch: LaunchSummary,
    w: SigningWallet,
    side: "buy" | "sell",
    amountRaw: bigint,
    slippageBps: number,
    dispatch: FlowDispatch,
    signatures: string[],
    startFlow: boolean,
    priorityFeeMicroLamports: number,
    expected?: TradeRequest["expected"],
    stepId = "swap",
  ): Promise<{ value: TradeOutcome; summary: string }> {
    const reader = this.deps.reader;
    const { baseMint, quoteMint, quoteTokenProgram } = state.keys;
    const q = launch.quote;
    const venue = state.phase === "presale" ? "dbc" : "damm";
    if (expected && expected.venue !== venue) {
      throw new UserFacingError(
        venue === "damm"
          ? "The curve completed and the pool migrated to Meteora DAMM v2 since your quote. Review the new quote and try again."
          : "The venue changed since your quote. Review the new quote and try again.",
      );
    }
    const venueLabel = venue === "dbc" ? "on the bonding curve" : "on the Meteora DAMM v2 pool";
    const label = side === "buy" ? `Buy $${launch.symbol} with ${q.asset.symbol} ${venueLabel}` : `Sell $${launch.symbol} for ${q.asset.symbol} ${venueLabel}`;
    if (startFlow) dispatch({ type: "start", steps: [{ id: stepId, label }] });

    const [base0, quote0] = await Promise.all([
      getAtaBalance(reader, w.publicKey, baseMint, TOKEN_PROGRAM_ID),
      getAtaBalance(reader, w.publicKey, quoteMint, quoteTokenProgram),
    ]);
    const have = side === "buy" ? quote0 : base0;
    if (have < amountRaw) {
      const fmt = (raw: bigint) =>
        side === "buy"
          ? `${formatTokenAmount(raw, q.asset.decimals, { multiplier: q.multiplier, maxFractionDigits: 8 })} ${q.asset.symbol}`
          : `${formatTokenAmount(raw, launch.baseDecimals)} $${launch.symbol}`;
      throw new UserFacingError(`You need ${fmt(amountRaw)} but your wallet holds ${fmt(have)}.`);
    }
    let trade = buildTrade(state, w.publicKey, side, amountRaw, { slippageBps });
    if (expected) {
      const outFmt = (raw: bigint) =>
        side === "buy"
          ? `${formatTokenAmount(raw, launch.baseDecimals)} $${launch.symbol}`
          : `${formatTokenAmount(raw, q.asset.decimals, { multiplier: q.multiplier, maxFractionDigits: 8 })} ${q.asset.symbol}`;
      // The exact fresh quote cannot meet what the user was shown: the swap would fail on chain.
      if (trade.quote.amountOut < expected.minOut) {
        throw new UserFacingError(
          `The price moved since your quote: you would now receive ${outFmt(trade.quote.amountOut)}, below the minimum of ${outFmt(expected.minOut)} you saw. Review the new quote and try again.`,
        );
      }
      // Slippage recomputed at fresh state would sign a lower minimum than the one shown; keep the shown one.
      if (trade.minAmountOut < expected.minOut) trade = withMinimumOut(trade, expected.minOut);
    }
    let active: string | null = stepId;
    await runSteps(
      [
        {
          id: stepId,
          label,
          run: async () => {
            const res = await this.sender(w, dispatch, () => active).send(trade.instructions, {
              computeUnitLimit: trade.computeUnitLimit,
              computeUnitPriceMicroLamports: priorityFeeMicroLamports,
              label: `${side} ${trade.quote.venue}`,
            });
            signatures.push(res.signature);
            return { signature: res.signature };
          },
        },
      ],
      dispatch,
      new Set(),
      friendlyError,
    );
    active = null;
    const [base1, quote1] = await Promise.all([
      getAtaBalance(reader, w.publicKey, baseMint, TOKEN_PROGRAM_ID),
      getAtaBalance(reader, w.publicKey, quoteMint, quoteTokenProgram),
    ]);
    const spent = side === "buy" ? quote0 - quote1 : base0 - base1;
    const received = side === "buy" ? base1 - base0 : quote1 - quote0;
    const partialFill = trade.quote.venue === "dbc" && trade.quote.mode === DbcSwapMode.PartialFill;
    // Amounts that moved are shown rounded to nearest (0.0999999976 SPYx paid reads as 0.1).
    const quoteFmt = (raw: bigint) => `${formatTokenAmount(raw, q.asset.decimals, { multiplier: q.multiplier, maxFractionDigits: 8, roundNearest: true })} ${q.asset.symbol}`;
    const baseFmt = (raw: bigint) => `${formatTokenAmount(raw, launch.baseDecimals, { roundNearest: true })} $${launch.symbol}`;
    const summary =
      side === "buy"
        ? `Paid ${quoteFmt(spent)}, received ${baseFmt(received)}.${partialFill ? " The curve completed with this buy; the unused input stayed in your wallet." : ""}`
        : `Sold ${baseFmt(spent)}, received ${quoteFmt(received)}.`;
    return { value: { venue: trade.quote.venue, amountIn: spent, amountOut: received, partialFill }, summary };
  }

  /** USDC / SOL legs through Jupiter Ultra (mainnet only; checked by the caller). */
  private async routedTrade(
    state: LaunchState,
    launch: LaunchSummary,
    w: SigningWallet,
    request: TradeRequest,
    dispatch: FlowDispatch,
    signatures: string[],
    priorityFeeMicroLamports: number,
  ): Promise<ActionResult<TradeOutcome>> {
    const payMint = request.payToken === "USDC" ? USDC_MINT : WSOL_MINT;
    const quoteMint = state.keys.quoteMint.toBase58();
    const baseMint = state.keys.baseMint.toBase58();
    const q = launch.quote.asset.symbol;
    const presale = state.phase === "presale";
    let active: string | null = null;
    const phase = (p: StepPhase) => {
      if (active) dispatch({ type: "step-phase", id: active, phase: p });
    };

    if (!presale) {
      // After migration Jupiter routes straight to the DAMM v2 pool.
      const [inputMint, outputMint] = request.side === "buy" ? [payMint, baseMint] : [baseMint, payMint];
      const label = request.side === "buy" ? `Buy $${launch.symbol} with ${request.payToken} via Jupiter` : `Sell $${launch.symbol} for ${request.payToken} via Jupiter`;
      dispatch({ type: "start", steps: [{ id: "jupiter", label }] });
      const swapped = { inAmount: 0n, outAmount: 0n };
      await runSteps(
        [
          {
            id: "jupiter",
            label,
            run: async () => {
              active = "jupiter";
              const r = await this.swap({ inputMint, outputMint, amount: request.amountRaw, slippageBps: request.slippageBps }, w, phase);
              swapped.inAmount = r.inAmount;
              swapped.outAmount = r.outAmount;
              signatures.push(r.signature);
              return { signature: r.signature };
            },
          },
        ],
        dispatch,
        new Set(),
        friendlyError,
      );
      dispatch({ type: "finish", result: "Swap confirmed." });
      return { ok: true, value: { venue: "jupiter", amountIn: swapped.inAmount, amountOut: swapped.outAmount, partialFill: false }, signatures };
    }

    if (request.side === "buy") {
      dispatch({
        type: "start",
        steps: [
          { id: "jupiter", label: `Swap ${request.payToken} to ${q} via Jupiter` },
          { id: "swap", label: `Buy $${launch.symbol} with ${q} on the bonding curve` },
        ],
      });
      let routed = 0n;
      await runSteps(
        [
          {
            id: "jupiter",
            label: "jupiter",
            run: async () => {
              active = "jupiter";
              const r = await this.swap({ inputMint: payMint, outputMint: quoteMint, amount: request.amountRaw, slippageBps: request.slippageBps }, w, phase);
              routed = r.outAmount;
              signatures.push(r.signature);
              return { signature: r.signature };
            },
          },
        ],
        dispatch,
        new Set(),
        friendlyError,
      );
      const fresh = await this.freshState(launch);
      const outcome = await this.directTrade(fresh, launch, w, "buy", routed, request.slippageBps, dispatch, signatures, false, priorityFeeMicroLamports);
      dispatch({ type: "finish", result: outcome.summary });
      return { ok: true, value: outcome.value, signatures };
    }

    dispatch({
      type: "start",
      steps: [
        { id: "swap", label: `Sell $${launch.symbol} for ${q} on the bonding curve` },
        { id: "jupiter", label: `Swap ${q} to ${request.payToken} via Jupiter` },
      ],
    });
    const sold = await this.directTrade(state, launch, w, "sell", request.amountRaw, request.slippageBps, dispatch, signatures, false, priorityFeeMicroLamports, request.expected);
    await runSteps(
      [
        {
          id: "jupiter",
          label: "jupiter",
          run: async () => {
            active = "jupiter";
            const r = await this.swap({ inputMint: quoteMint, outputMint: payMint, amount: sold.value.amountOut, slippageBps: request.slippageBps }, w, phase);
            signatures.push(r.signature);
            return { signature: r.signature };
          },
        },
      ],
      dispatch,
      new Set(),
      friendlyError,
    );
    dispatch({ type: "finish", result: `${sold.summary} Swapped to ${request.payToken}.` });
    return { ok: true, value: { ...sold.value, venue: "jupiter" }, signatures };
  }

  // ---------------------------------------------------------------- redeem

  async redeem(request: RedeemRequest, wallet: WalletSigner, opts: ActionOptions = {}): Promise<ActionResult<RedeemOutcome>> {
    const dispatch = opts.dispatch ?? noopDispatch;
    const signatures: string[] = [];
    try {
      const w = requireSigningWallet(wallet);
      if (request.amountRaw <= 0n) throw new UserFacingError("Enter an amount greater than zero.");
      const cluster = await this.sendableCluster();
      const { launch } = request;
      const state = await this.freshState(launch);
      const reader = this.deps.reader;
      const { baseMint, quoteMint, quoteTokenProgram } = state.keys;
      const balance = await getAtaBalance(reader, w.publicKey, baseMint, TOKEN_PROGRAM_ID);
      if (balance < request.amountRaw) {
        throw new UserFacingError(
          `You want to redeem ${formatTokenAmount(request.amountRaw, launch.baseDecimals)} $${launch.symbol} but hold ${formatTokenAmount(balance, launch.baseDecimals)} $${launch.symbol}.`,
        );
      }
      // Throws TradeUnavailableError with the reason when redeem is not open or pays nothing.
      const built = buildRedeem(state, w.publicKey, request.amountRaw);
      await this.requireLamports(w, MIN_TRADE_LAMPORTS, cluster, "Redeeming");
      const q = launch.quote;
      const quoteFmt = (raw: bigint) => `${formatTokenAmount(raw, q.asset.decimals, { multiplier: q.multiplier, maxFractionDigits: 8, roundNearest: true })} ${q.asset.symbol}`;
      const label = `Redeem ${formatTokenAmount(request.amountRaw, launch.baseDecimals)} $${launch.symbol} for ${quoteFmt(built.preview.net)}`;
      dispatch({ type: "start", steps: [{ id: "redeem", label }] });
      const quote0 = await getAtaBalance(reader, w.publicKey, quoteMint, quoteTokenProgram);
      let active: string | null = "redeem";
      await runSteps(
        [
          {
            id: "redeem",
            label,
            run: async () => {
              const res = await this.sender(w, dispatch, () => active).send(built.instructions, {
                computeUnitLimit: built.computeUnitLimit,
                computeUnitPriceMicroLamports: cluster.priorityFeeMicroLamports,
                label: "redeem",
              });
              signatures.push(res.signature);
              return { signature: res.signature };
            },
          },
        ],
        dispatch,
        new Set(),
        friendlyError,
      );
      active = null;
      const quote1 = await getAtaBalance(reader, w.publicKey, quoteMint, quoteTokenProgram);
      const received = quote1 - quote0;
      dispatch({ type: "finish", result: `Received ${quoteFmt(received)}. The exit fee of ${quoteFmt(built.preview.fee)} stayed in the vault.` });
      return { ok: true, value: { net: received, fee: built.preview.fee }, signatures };
    } catch (e) {
      const error = friendlyError(e);
      dispatch({ type: "fail", error });
      return { ok: false, error, signatures };
    }
  }

  // ---------------------------------------------------------------- crank

  async crank(launch: LaunchSummary, wallet: WalletSigner, opts: ActionOptions = {}): Promise<ActionResult<CrankOutcome>> {
    const dispatch = opts.dispatch ?? noopDispatch;
    const signatures: string[] = [];
    try {
      const w = requireSigningWallet(wallet);
      const cluster = await this.sendableCluster();
      const state = await this.freshState(launch);
      const plan = planCrank(state);
      dispatch({ type: "start", steps: plan.map((a) => ({ id: crankActionKey(a), label: crankActionLabel(a) })) });
      if (plan.length === 0) {
        dispatch({ type: "finish", result: "Nothing is due: every harvest is up to date." });
        return { ok: true, value: { executed: 0, skipped: 0, failed: 0 }, signatures };
      }
      await this.requireLamports(w, MIN_CRANK_LAMPORTS, cluster, "The crank");

      let activeId: string | null = null;
      const stepsSnapshot = new Map<string, "pending" | "finished">(plan.map((a) => [crankActionKey(a), "pending"]));
      const inner = this.sender(w, dispatch, () => activeId);
      // A TxSender proxy: runCrank labels every send with the action kind, which marks the step active.
      const proxy: TxSender = {
        payer: inner.payer,
        getAccountInfo: (k) => inner.getAccountInfo(k),
        getMultipleAccountsInfo: (k) => inner.getMultipleAccountsInfo(k),
        getProgramAccounts: (p, f) => inner.getProgramAccounts(p, f),
        getTokenAccountsByOwner: (o, p) => inner.getTokenAccountsByOwner(o, p),
        simulate: (i, p) => inner.simulate(i, p),
        send: async (ixs, sendOpts?: SendOptions) => {
          const kind = sendOpts?.label ?? "crank";
          activeId = this.nextCrankStepId(kind, dispatch, stepsSnapshot);
          dispatch({ type: "step-started", id: activeId, phase: "preparing" });
          return inner.send(ixs, sendOpts);
        },
      };
      let executed = 0;
      let skipped = 0;
      let failed = 0;
      const result = await this.crankRunner(proxy, { launch: state.address }, {
        computeUnitPriceMicroLamports: cluster.priorityFeeMicroLamports,
        onStep: (step) => {
          const id = activeId ?? crankActionKey(step.action);
          stepsSnapshot.set(id, "finished");
          if (step.status === "executed") {
            executed++;
            if (step.signature) signatures.push(step.signature);
            dispatch({ type: "step-succeeded", id, signature: step.signature });
          } else if (step.status === "skipped") {
            skipped++;
            dispatch({ type: "step-skipped", id, detail: "Already done by someone else" });
          } else {
            failed++;
            dispatch({ type: "step-failed", id, error: friendlyError({ message: step.reason ?? "failed", errorName: step.errorName ?? null, name: "TransactionFailedError" }) });
          }
          activeId = null;
        },
      });
      if (failed > 0) {
        const error = `${failed} crank step${failed === 1 ? "" : "s"} failed. Finished steps are kept; run the crank again to retry.`;
        dispatch({ type: "fail", error });
        return { ok: false, error, signatures };
      }
      dispatch({ type: "skip-pending", detail: "No longer due" });
      const remaining = result.remaining.length;
      dispatch({
        type: "finish",
        result: `${executed} crank transaction${executed === 1 ? "" : "s"} confirmed${skipped ? `, ${skipped} skipped` : ""}.${remaining ? ` ${remaining} action(s) still due.` : ""}`,
      });
      return { ok: true, value: { executed, skipped, failed }, signatures };
    } catch (e) {
      const error = friendlyError(e);
      dispatch({ type: "fail", error });
      return { ok: false, error, signatures };
    }
  }

  /** The pending step for a crank send labelled with an action kind, adding one when re-planning found a new action. */
  private nextCrankStepId(kind: string, dispatch: FlowDispatch, steps: Map<string, "pending" | "finished">): string {
    for (const [id, status] of steps) {
      if (status === "pending" && (id === kind || id.startsWith(`${kind}:`))) return id;
    }
    const id = `${kind}#${steps.size}`;
    steps.set(id, "pending");
    dispatch({ type: "steps-added", steps: [{ id, label: crankActionLabel({ kind: kind as CrankAction["kind"] }) }] });
    return id;
  }
}

/**
 * The same trade with a higher swap2 minimum out. DBC and DAMM v2 `swap2` share the argument layout
 * (discriminator, amount_0 u64, amount_1 u64, swap_mode u8); `amount_1` is the minimum out for ExactIn
 * and PartialFill, the only modes `buildTrade` emits.
 */
export function withMinimumOut(trade: BuiltTrade, minAmountOut: bigint): BuiltTrade {
  const index = trade.instructions.findIndex((i) => i.programId.equals(DBC_PROGRAM_ID) || i.programId.equals(DAMM_V2_PROGRAM_ID));
  const swap = trade.instructions[index];
  if (!swap || swap.data.length !== 25) throw new Error("unexpected trade instructions: no swap2");
  const view = new DataView(swap.data.buffer, swap.data.byteOffset, swap.data.byteLength);
  const data = swapParams2(Array.from(swap.data.subarray(0, 8)), view.getBigUint64(8, true), minAmountOut, swap.data[24]!);
  const instructions = trade.instructions.slice();
  instructions[index] = new TransactionInstruction({ programId: swap.programId, keys: swap.keys, data: data as never });
  return { ...trade, minAmountOut, instructions };
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
