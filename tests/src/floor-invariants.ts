/**
 * Floor invariants checked around every step of a launch lifecycle on the fork
 * (docs/BRIEF.md §5.4 and §8 step 12):
 *
 * 1. vault_raw / supply never decreases (checked as a cross product, no rounding), and it strictly
 *    increases on a redemption that retains a non-zero exit fee;
 * 2. only `redeem` takes quote out of the vault, and exactly the redeemer's net amount;
 * 3. `mint.supply` is the truth: it equals the sum of every base token account that exists
 *    (tracked explicitly: DBC base vault, DAMM v2 base vault, holders, Authority base ATA);
 * 4. the Authority holds no base tokens after any instruction (its base ATA is empty);
 * 5. the vault is the Authority's SPYx ATA (owner and mint never change).
 */
import { PublicKey } from "@solana/web3.js";
import { expect } from "vitest";
import { Fork } from "./fork.js";
import { mintSupply, tokenAccountMint, tokenAccountOwner, tokenAmount } from "./token.js";

export interface FloorState {
  label: string;
  vault: bigint;
  supply: bigint;
  authorityBase: bigint;
  trackedBase: bigint;
}

export type StepKind =
  /** Any instruction that must not take quote out of the vault. */
  | "no-outflow"
  /** A `redeem`: the vault must decrease by exactly `vaultOut`. */
  | "redeem"
  /**
   * A plain token transfer into an Authority account (donation). The Authority may hold base
   * tokens right after it; the next StockFloor instruction must burn them.
   */
  | "donation";

export interface StepOptions {
  /** Exact quote leaving the vault (required for "redeem"). */
  vaultOut?: bigint;
  /** For "redeem": the exit fee retained, > 0 requires a strictly higher floor. */
  feeRetained?: bigint;
}

export class FloorTracker {
  readonly history: FloorState[] = [];
  private readonly baseAccounts = new Map<string, PublicKey>();

  constructor(
    private readonly fork: Fork,
    readonly vault: PublicKey,
    readonly baseMint: PublicKey,
    readonly authority: PublicKey,
    readonly quoteMint: PublicKey,
    readonly authorityBaseAccount: PublicKey,
  ) {
    this.trackBase(authorityBaseAccount);
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
      authorityBase: tokenAmount(this.fork, this.authorityBaseAccount),
      trackedBase,
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
      expect(s.authorityBase, `${ctx} Authority holds no base tokens`).toBe(0n);
    }
    expect(tokenAccountOwner(this.fork, this.vault).equals(this.authority), `${ctx} vault owner is the Authority`).toBe(true);
    expect(tokenAccountMint(this.fork, this.vault).equals(this.quoteMint), `${ctx} vault mint is the quote mint`).toBe(true);
  }

  /** The floor ratio history as [label, vault, supply] rows (for logs and evidence). */
  table(): Array<{ label: string; vault: string; supply: string }> {
    return this.history.map((s) => ({ label: s.label, vault: s.vault.toString(), supply: s.supply.toString() }));
  }
}
