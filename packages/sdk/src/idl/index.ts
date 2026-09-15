/**
 * IDLs and offline Anchor coders.
 *
 * - `STOCKFLOOR_IDL`: target/idl/stockfloor.json copied by `pnpm --filter @stockfloor/sdk run sync-idl`
 *   (Anchor 1.0 format). `Stockfloor` is Anchor's camelCase type helper for it.
 * - `DBC_IDL` / `DAMM_V2_IDL`: idls/dynamic_bonding_curve.json (DBC 0.2.1) and idls/cp_amm.json
 *   (DAMM v2 0.2.4), trimmed to what the SDK uses (src/idl/trim.ts).
 *
 * Coders come from an offline `Program` (no provider is ever used), so names are camelCase exactly
 * as in Anchor's TypeScript client: instructions `createConfig`, accounts `poolConfig`, fields
 * `migrationQuoteThreshold`.
 */
import { type Idl, Program, type Provider } from "@coral-xyz/anchor";
import dammV2IdlJson from "./damm_v2.json";
import dbcIdlJson from "./dbc.json";
import stockfloorIdlJson from "./stockfloor.json";
import type { Stockfloor } from "./stockfloor-types";

export type { Stockfloor };

export const STOCKFLOOR_IDL = stockfloorIdlJson as unknown as Idl;
export const DBC_IDL = dbcIdlJson as unknown as Idl;
export const DAMM_V2_IDL = dammV2IdlJson as unknown as Idl;

/** Program methods are never called with this provider; it only satisfies the constructor. */
const OFFLINE_PROVIDER = {} as Provider;

let stockfloor: Program<Stockfloor> | undefined;
let dbc: Program | undefined;
let damm: Program | undefined;

/** Offline typed Program for the stockfloor IDL (coder, camelCase IDL, event parser). */
export function stockfloorProgram(): Program<Stockfloor> {
  stockfloor ??= new Program<Stockfloor>(STOCKFLOOR_IDL as unknown as Stockfloor, OFFLINE_PROVIDER);
  return stockfloor;
}

export function dbcProgram(): Program {
  dbc ??= new Program(DBC_IDL, OFFLINE_PROVIDER);
  return dbc;
}

export function dammV2Program(): Program {
  damm ??= new Program(DAMM_V2_IDL, OFFLINE_PROVIDER);
  return damm;
}

/** Raw IDL instruction entry by snake_case name (accounts in program order). */
export function idlInstruction(idl: Idl, name: string) {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL ${idl.metadata.name} has no instruction ${name}`);
  return ix;
}

/** Map of program error code -> name from an IDL. */
export function idlErrorNames(idl: Idl): Map<number, string> {
  return new Map((idl.errors ?? []).map((e) => [e.code, e.name]));
}
