import type { LaunchMath } from "@/lib/landing/sim/launch";
import { applyFloorEvent, floorEvents } from "@/lib/landing/sim/floorPath";
import { T_GRAD } from "@/lib/landing/sim/timeline";
import type { StoryFrame } from "../shared";

/*
 * The vault ledger behind variant 8, a pure function of (launch, frame). It replays the engine's own
 * floor events (floorPath.applyFloorEvent: LP fee harvests and redemptions) so every number on the
 * ledger is the one the staircase on the chart is drawn from. Nothing is magnified: bar widths are
 * linear from zero on a fixed axis.
 */

export type EntryKind = "split" | "harvest" | "redeem";
export type LedgerRow = "vault" | "supply";

export interface LedgerEntry {
  /** 1-based, shared by the chart chip and the journal line. */
  n: number;
  kind: EntryKind;
  /** Story time (the chart's x). */
  t: number;
  /** Gross floor per $100 after the entry (the chart's y). */
  floor100: number;
  /** Change of the vault in USD. */
  vaultDelta: number;
  /** Change of supply, share points (negative for burns). */
  supplyDelta: number;
  /** Floor change in percent (null for the split, which sets it). */
  floorPct: number | null;
  /** Ledger rows this entry moved. */
  rows: readonly LedgerRow[];
  /** Redemption share of supply. */
  share?: number;
}

export interface Ledger {
  /** Presale meter: USD raised so far. */
  raisedUsd: number;
  /** 0..1, how far the raise has been split (0 in the presale, 1 after the split beat). */
  split: number;
  vaultUsd: number;
  /** Vault split into what came from the raise and from LP fee harvests (pro rata after redemptions). */
  fromRaiseUsd: number;
  fromFeesUsd: number;
  /** SPYx paid out to redeemers so far. */
  paidOutUsd: number;
  /** Share of graduation supply still outstanding (1 = 100%). */
  supplyShare: number;
  entries: LedgerEntry[];
  latest: LedgerEntry | null;
  /** 1 right after the latest entry, easing to 0 as story time moves on. */
  fresh: number;
  /** Fixed bar axis in USD: the vault's largest balance in the whole story, rounded up. */
  axisUsd: number;
}

/** Story time over which a fresh entry's highlight fades to its resting level. */
const FRESH_SPAN = 0.9;

const pct = (to: number, from: number) => (to / from - 1) * 100;

const axisCache = new WeakMap<LaunchMath, number>();

function axisFor(m: LaunchMath): number {
  let a = axisCache.get(m);
  if (a === undefined) {
    let s = { vaultUsd: m.split.floorUsd, supplyShare: 1 };
    let max = s.vaultUsd;
    for (const e of floorEvents(m)) {
      s = applyFloorEvent(m, s, e);
      max = Math.max(max, s.vaultUsd);
    }
    const unit = 10 ** Math.floor(Math.log10(max));
    a = Math.ceil((max * 1.04) / (unit / 2)) * (unit / 2);
    axisCache.set(m, a);
  }
  return a;
}

export function ledgerAt(m: LaunchMath, frame: StoryFrame): Ledger {
  const split = frame.beatIndex === 0 ? 0 : frame.splitProgress;
  const base = m.split.floorUsd;
  const f100 = m.floorPer100GrossUsd;
  const entries: LedgerEntry[] = [];
  let fromRaise = base * split;
  let fromFees = 0;
  let paidOut = 0;
  let state = { vaultUsd: base, supplyShare: 1 };

  if (split > 0) {
    entries.push({ n: 1, kind: "split", t: T_GRAD, floor100: f100, vaultDelta: base, supplyDelta: 0, floorPct: null, rows: ["vault"] });
  }
  let floorBefore = f100;
  for (const e of floorEvents(m)) {
    if (e.t > frame.t) break;
    const next = applyFloorEvent(m, state, e);
    const floorAfter = (f100 * (next.vaultUsd / base)) / next.supplyShare;
    if (e.kind === "harvest") {
      fromFees += next.vaultUsd - state.vaultUsd;
    } else {
      const keep = next.vaultUsd / state.vaultUsd;
      fromRaise *= keep;
      fromFees *= keep;
      paidOut += state.vaultUsd - next.vaultUsd;
    }
    entries.push({
      n: entries.length + 1,
      kind: e.kind,
      t: e.t,
      floor100: floorAfter,
      vaultDelta: next.vaultUsd - state.vaultUsd,
      supplyDelta: next.supplyShare - state.supplyShare,
      floorPct: pct(floorAfter, floorBefore),
      rows: e.kind === "harvest" ? ["vault"] : ["vault", "supply"],
      share: e.kind === "redeem" ? e.share : undefined,
    });
    floorBefore = floorAfter;
    state = next;
  }

  const latest = entries.length > 0 ? entries[entries.length - 1]! : null;
  const age = latest ? (latest.kind === "split" ? 1 - split : frame.t - latest.t) : Infinity;
  return {
    raisedUsd: frame.raisedUsd,
    split,
    vaultUsd: split < 1 ? base * split : state.vaultUsd,
    fromRaiseUsd: fromRaise,
    fromFeesUsd: fromFees,
    paidOutUsd: paidOut,
    supplyShare: split > 0 ? state.supplyShare : 1,
    entries,
    latest,
    fresh: latest ? Math.max(0, 1 - age / FRESH_SPAN) : 0,
    axisUsd: axisFor(m),
  };
}

/** Journal wording, at most four words. */
export function entryLabel(e: LedgerEntry): string {
  if (e.kind === "split") return "Raise split";
  if (e.kind === "harvest") return "Fee harvest";
  return (e.share ?? 0) >= 0.05 ? "Holders redeem" : "Arbitrage redeem";
}

/** "+0.96%", "+0.01%", "sets floor". */
export function entryEffect(e: LedgerEntry): string {
  if (e.floorPct === null) return "sets floor";
  return `+${e.floorPct.toFixed(2)}%`;
}
