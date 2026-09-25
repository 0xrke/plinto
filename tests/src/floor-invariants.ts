/**
 * Floor invariants checked around every step of a launch lifecycle on the fork
 * (docs/BRIEF.md §5.4 and §8 step 12):
 *
 * 1. vault_raw / supply never decreases (checked as a cross product, no rounding), and it strictly
 *    increases on a redemption that retains a non-zero exit fee;
 * 2. only `redeem` takes quote out of the vault, and exactly the redeemer's net amount;
 * 3. `mint.supply` is the truth: it equals the sum of every base token account that exists
 *    (tracked explicitly: DBC base vault, DAMM v2 base vault, holders, claimer base ATA);
 * 4. the claimer PDA holds no base tokens after any instruction (its base ATA is empty);
 * 5. the claimer never holds or controls the vault: the vault is the vault authority's quote ATA
 *    (owner and mint never change), with no delegate and no close authority;
 * 6. (launch v3) the claimer's quote transit account is empty after every instruction, and on a
 *    harvest step the vault, the platform and the creator receive exactly the declared parts.
 */
import { PublicKey } from "@solana/web3.js";
import { expect } from "vitest";
import { Fork } from "./fork.js";
import { mintSupply, tokenAccountMint, tokenAccountOwner, tokenAmount } from "./token.js";

/** The launch accounts the tracker reads. */
export interface FloorTrackerAccounts {
  vault: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  /** PDA ["vault_authority", config]: the only allowed vault owner. */
  vaultAuthority: PublicKey;
  /** PDA ["authority", config]: DBC fee_claimer; must never own or control the vault. */
  claimer: PublicKey;
  /** ATA(claimer, base mint): must be empty after every non-donation step. */
  claimerBaseAccount: PublicKey;
  /** ATA(claimer, quote mint): the v3 fee-split transit, empty after every step. */
  claimerQuoteAccount?: PublicKey;
  /** ATA(launch creator, quote mint): the creator's payee account. */
  creatorQuoteAccount?: PublicKey;
  /** ATA(PLATFORM_TREASURY, quote mint): the platform's payee account. */
  platformQuoteAccount?: PublicKey;
}

/** SPL / Token-2022 base account layout: delegate COption at 72, close_authority COption at 129. */
export function tokenAccountDelegate(fork: Fork, account: PublicKey): PublicKey | null {
  const d = fork.mustGetAccount(account).data;
  return d.readUInt32LE(72) === 1 ? new PublicKey(d.subarray(76, 108)) : null;
}

export function tokenAccountCloseAuthority(fork: Fork, account: PublicKey): PublicKey | null {
  const d = fork.mustGetAccount(account).data;
  return d.readUInt32LE(129) === 1 ? new PublicKey(d.subarray(133, 165)) : null;
}

export interface FloorState {
  label: string;
  vault: bigint;
  supply: bigint;
  claimerBase: bigint;
  trackedBase: bigint;
  /** Transit, creator and platform quote balances (0 when the account is absent or not tracked). */
  transit: bigint;
  creatorQuote: bigint;
  platformQuote: bigint;
}

export type StepKind =
  /** Any instruction that must not take quote out of the vault. */
  | "no-outflow"
  /** A `redeem`: the vault must decrease by exactly `vaultOut`. */
  | "redeem"
  /**
   * A plain token transfer into the claimer's base ATA (donation). The claimer may hold base
   * tokens right after it; the next burn must empty it.
   */
  | "donation";

export interface StepOptions {
  /** Exact quote leaving the vault (required for "redeem"). */
  vaultOut?: bigint;
  /** For "redeem": the exit fee retained, > 0 requires a strictly higher floor. */
  feeRetained?: bigint;
  /** Exact quote entering the vault in this step (harvest steps). */
  vaultIn?: bigint;
  /** Exact quote entering the platform payee account in this step. */
  platformIn?: bigint;
  /** Exact quote entering the creator payee account in this step. */
  creatorIn?: bigint;
}

export class FloorTracker {
  readonly history: FloorState[] = [];
  private readonly baseAccounts = new Map<string, PublicKey>();

  readonly vault: PublicKey;
  readonly baseMint: PublicKey;
  readonly quoteMint: PublicKey;
  readonly vaultAuthority: PublicKey;
  readonly claimer: PublicKey;
  readonly claimerBaseAccount: PublicKey;
  readonly claimerQuoteAccount?: PublicKey;
  readonly creatorQuoteAccount?: PublicKey;
  readonly platformQuoteAccount?: PublicKey;

  constructor(
    private readonly fork: Fork,
    accounts: FloorTrackerAccounts,
  ) {
    this.vault = accounts.vault;
    this.baseMint = accounts.baseMint;
    this.quoteMint = accounts.quoteMint;
    this.vaultAuthority = accounts.vaultAuthority;
    this.claimer = accounts.claimer;
    this.claimerBaseAccount = accounts.claimerBaseAccount;
    this.claimerQuoteAccount = accounts.claimerQuoteAccount;
    this.creatorQuoteAccount = accounts.creatorQuoteAccount;
    this.platformQuoteAccount = accounts.platformQuoteAccount;
    this.trackBase(accounts.claimerBaseAccount);
  }

  private quoteBalance(account?: PublicKey): bigint {
    if (!account) return 0n;
    const a = this.fork.getAccount(account);
    return a && a.data.length >= 72 ? a.data.readBigUInt64LE(64) : 0n;
  }

  /** Register a base token account so that it counts toward the supply reconciliation. */
  trackBase(...accounts: PublicKey[]): void {
    for (const a of accounts) this.baseAccounts.set(a.toBase58(), a);
  }

  state(label: string): FloorState {
    let trackedBase = 0n;
    for (const a of this.baseAccounts.values()) trackedBase += tokenAmount(this.fork, a);
    return {
      label,
      vault: tokenAmount(this.fork, this.vault),
      supply: mintSupply(this.fork, this.baseMint),
      claimerBase: tokenAmount(this.fork, this.claimerBaseAccount),
      trackedBase,
      transit: this.quoteBalance(this.claimerQuoteAccount),
      creatorQuote: this.quoteBalance(this.creatorQuoteAccount),
      platformQuote: this.quoteBalance(this.platformQuoteAccount),
    };
  }

  /** Record the starting state and check the static invariants. */
  start(label: string): FloorState {
    const s = this.state(label);
    this.checkStatic(s, "no-outflow");
    this.history.push(s);
    return s;
  }

  get last(): FloorState {
    const s = this.history[this.history.length - 1];
    if (!s) throw new Error("FloorTracker.start() was not called");
    return s;
  }

  /** Run `fn` as one step and check every invariant against the previous state. */
  async step<T>(label: string, kind: StepKind, fn: () => T | Promise<T>, opts: StepOptions = {}): Promise<T> {
    const prev = this.last;
    const result = await fn();
    const next = this.state(label);
    this.checkStatic(next, kind);

    const ctx = `[${label}]`;
    if (kind === "redeem") {
      if (opts.vaultOut === undefined) throw new Error(`${ctx} redeem step needs vaultOut`);
      expect(prev.vault - next.vault, `${ctx} vault outflow equals the redeemer's net`).toBe(opts.vaultOut);
    } else {
      expect(next.vault >= prev.vault, `${ctx} vault must not decrease outside redeem (${prev.vault} -> ${next.vault})`).toBe(true);
    }
    if (opts.vaultIn !== undefined) expect(next.vault - prev.vault, `${ctx} vault part`).toBe(opts.vaultIn);
    if (opts.platformIn !== undefined) expect(next.platformQuote - prev.platformQuote, `${ctx} platform part`).toBe(opts.platformIn);
    if (opts.creatorIn !== undefined) expect(next.creatorQuote - prev.creatorQuote, `${ctx} creator part`).toBe(opts.creatorIn);

    // Floor per token never decreases: next.vault / next.supply >= prev.vault / prev.supply.
    if (prev.supply > 0n && next.supply > 0n) {
      const lhs = next.vault * prev.supply;
      const rhs = prev.vault * next.supply;
      expect(lhs >= rhs, `${ctx} floor decreased: ${prev.vault}/${prev.supply} -> ${next.vault}/${next.supply}`).toBe(true);
      if (kind === "redeem" && (opts.feeRetained ?? 0n) > 0n) {
        expect(lhs > rhs, `${ctx} floor must strictly increase when an exit fee is retained`).toBe(true);
      }
    }
    this.history.push(next);
    return result;
  }

  private checkStatic(s: FloorState, kind: StepKind): void {
    const ctx = `[${s.label}]`;
    expect(s.trackedBase, `${ctx} mint.supply equals the sum of all base token accounts`).toBe(s.supply);
    if (kind !== "donation") {
      expect(s.claimerBase, `${ctx} claimer holds no base tokens`).toBe(0n);
    }
    if (kind !== "donation") expect(s.transit, `${ctx} the claimer's quote transit account is empty`).toBe(0n);
    const owner = tokenAccountOwner(this.fork, this.vault);
    expect(owner.equals(this.vaultAuthority), `${ctx} vault owner is the vault authority`).toBe(true);
    expect(owner.equals(this.claimer), `${ctx} the claimer does not own the vault`).toBe(false);
    expect(tokenAccountDelegate(this.fork, this.vault), `${ctx} vault has no delegate`).toBeNull();
    expect(tokenAccountCloseAuthority(this.fork, this.vault), `${ctx} vault has no close authority`).toBeNull();
    expect(tokenAccountMint(this.fork, this.vault).equals(this.quoteMint), `${ctx} vault mint is the quote mint`).toBe(true);
  }

  /** The floor ratio history as [label, vault, supply] rows (for logs and evidence). */
  table(): Array<{ label: string; vault: string; supply: string }> {
    return this.history.map((s) => ({ label: s.label, vault: s.vault.toString(), supply: s.supply.toString() }));
  }
}
