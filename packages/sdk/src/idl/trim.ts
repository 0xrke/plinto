/**
 * Trim an Anchor IDL (spec 0.1.0) to the instructions, accounts and events a client uses, keeping
 * every type they reference (transitively). The trimmed DBC and DAMM v2 IDLs keep the web bundle
 * small; `scripts/sync-idl.ts` writes them and `test/idl-sync.test.ts` checks they are current.
 */

export interface IdlLike {
  address: string;
  metadata: Record<string, unknown>;
  instructions: Array<{ name: string; args: unknown[]; accounts: unknown[] } & Record<string, unknown>>;
  accounts?: Array<{ name: string } & Record<string, unknown>>;
  events?: Array<{ name: string } & Record<string, unknown>>;
  errors?: unknown[];
  types?: Array<{ name: string } & Record<string, unknown>>;
  constants?: unknown[];
}

export interface TrimSpec {
  instructions: readonly string[];
  accounts?: readonly string[];
  events?: readonly string[];
  /** Keep the error list (default true: error names are useful in logs). */
  errors?: boolean;
}

function collectDefined(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectDefined(v, out);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const defined = obj.defined;
    if (defined !== undefined) {
      if (typeof defined === "string") out.add(defined);
      else if (defined && typeof defined === "object" && typeof (defined as { name?: unknown }).name === "string") {
        out.add((defined as { name: string }).name);
        collectDefined((defined as { generics?: unknown }).generics, out);
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k !== "defined") collectDefined(v, out);
    }
  }
}

function pick<T extends { name: string }>(list: readonly T[] | undefined, names: readonly string[], what: string): T[] {
  const byName = new Map((list ?? []).map((x) => [x.name, x]));
  return names.map((n) => {
    const item = byName.get(n);
    if (!item) throw new Error(`IDL has no ${what} named ${n}`);
    return item;
  });
}

/** Returns a new IDL with only the requested items and the types they need, in the original order. */
export function trimIdl<T extends IdlLike>(idl: T, spec: TrimSpec): T {
  const instructions = pick(idl.instructions, spec.instructions, "instruction");
  const accounts = pick(idl.accounts, spec.accounts ?? [], "account");
  const events = pick(idl.events, spec.events ?? [], "event");

  const typesByName = new Map((idl.types ?? []).map((t) => [t.name, t]));
  const needed = new Set<string>();
  const queue: string[] = [];
  const seed = new Set<string>();
  collectDefined(instructions.map((i) => i.args), seed);
  for (const a of accounts) seed.add(a.name);
  for (const e of events) seed.add(e.name);
  for (const n of seed) queue.push(n);
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (needed.has(name)) continue;
    const t = typesByName.get(name);
    if (!t) throw new Error(`IDL type ${name} is referenced but not defined`);
    needed.add(name);
    const refs = new Set<string>();
    collectDefined(t, refs);
    for (const r of refs) if (!needed.has(r)) queue.push(r);
  }

  const keepOrder = <X extends { name: string }>(list: readonly X[] | undefined, keep: Set<string>) =>
    (list ?? []).filter((x) => keep.has(x.name));

  const out: IdlLike = {
    address: idl.address,
    metadata: idl.metadata,
    instructions: keepOrder(idl.instructions, new Set(spec.instructions)),
    accounts: keepOrder(idl.accounts, new Set(spec.accounts ?? [])),
    events: keepOrder(idl.events, new Set(spec.events ?? [])),
    errors: spec.errors === false ? [] : (idl.errors ?? []),
    types: keepOrder(idl.types, needed),
  };
  return out as T;
}

/** What the SDK needs from DBC 0.2.1 (idls/dynamic_bonding_curve.json). */
export const DBC_IDL_TRIM: TrimSpec = {
  instructions: ["create_config", "initialize_virtual_pool_with_spl_token", "swap2", "migration_damm_v2"],
  accounts: ["PoolConfig", "VirtualPool"],
  events: [],
};

/** What the SDK needs from DAMM v2 0.2.4 (idls/cp_amm.json). */
export const DAMM_V2_IDL_TRIM: TrimSpec = {
  instructions: ["swap2"],
  accounts: ["Pool", "Position"],
  events: [],
};
