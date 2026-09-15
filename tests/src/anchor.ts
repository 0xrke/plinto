/**
 * Offline Anchor Program clients (no RPC): used only to encode instructions and decode accounts.
 */
import { AnchorProvider, BorshAccountsCoder, BorshEventCoder, Idl, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IDLS_DIR, TARGET_IDL_DIR } from "./constants.js";
import { Fork } from "./fork.js";

/** A provider stub: Program only needs it for RPC methods, which the harness never calls. */
const offlineProvider = {
  connection: new Connection("http://127.0.0.1:1"),
} as unknown as AnchorProvider;

export function loadIdl(path: string): Idl {
  if (!existsSync(path)) throw new Error(`IDL not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as Idl;
}

export function offlineProgram(idl: Idl): Program {
  return new Program(idl, offlineProvider);
}

let dbc: Program | undefined;
let damm: Program | undefined;
const targetPrograms = new Map<string, Program>();

/** Meteora DBC 0.2.1 (idls/dynamic_bonding_curve.json). */
export function dbcProgram(): Program {
  dbc ??= offlineProgram(loadIdl(join(IDLS_DIR, "dynamic_bonding_curve.json")));
  return dbc;
}

/** Meteora DAMM v2 0.2.4 (idls/cp_amm.json). */
export function dammProgram(): Program {
  damm ??= offlineProgram(loadIdl(join(IDLS_DIR, "cp_amm.json")));
  return damm;
}

/** One of our programs, from target/idl/<name>.json (requires a build). */
export function targetProgram(name: string): Program {
  let p = targetPrograms.get(name);
  if (!p) {
    p = offlineProgram(loadIdl(join(TARGET_IDL_DIR, `${name}.json`)));
    targetPrograms.set(name, p);
  }
  return p;
}

/**
 * Decode an Anchor account by IDL account name (e.g. "VirtualPool" or "virtualPool"; Program
 * converts the IDL to camelCase internally). Returns null if the account does not exist.
 */
export function fetchAnchorAccount<T = any>(fork: Fork, program: Program, accountName: string, address: PublicKey): T | null {
  const acc = fork.getAccount(address);
  if (!acc) return null;
  const name = accountName.charAt(0).toLowerCase() + accountName.slice(1);
  return (program.coder.accounts as BorshAccountsCoder).decode(name, acc.data) as T;
}

export function mustFetchAnchorAccount<T = any>(fork: Fork, program: Program, accountName: string, address: PublicKey): T {
  const v = fetchAnchorAccount<T>(fork, program, accountName, address);
  if (!v) throw new Error(`${accountName} ${address.toBase58()} does not exist`);
  return v;
}

/** Anchor `event::EVENT_IX_TAG_LE`: prefix of the self-CPI instruction data written by `emit_cpi!`. */
const EVENT_IX_TAG = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

/**
 * Parse Anchor events emitted with `emit_cpi!` (DBC and DAMM v2 use it): they are not logged but
 * carried in inner instructions whose data is EVENT_IX_TAG + event discriminator + Borsh body.
 * `meta` is `TxSuccess.meta`. Inner instructions that do not decode with `program`'s event coder
 * are ignored (note: same-named events of different programs share a discriminator).
 */
export function parseCpiEvents(
  program: Program,
  meta: { innerInstructions(): Array<Array<{ instruction(): { data(): Uint8Array } }>> },
): Array<{ name: string; data: any }> {
  const coder = program.coder.events as BorshEventCoder;
  const out: Array<{ name: string; data: any }> = [];
  for (const group of meta.innerInstructions()) {
    for (const inner of group) {
      const data = Buffer.from(inner.instruction().data());
      if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      try {
        const ev = coder.decode(data.subarray(8).toString("base64"));
        if (ev) out.push(ev);
      } catch {
        // not an event of this program
      }
    }
  }
  return out;
}

/** Parse Anchor events emitted with `emit!` ("Program data: <base64>") from transaction logs. */
export function parseEvents(program: Program, logs: string[]): Array<{ name: string; data: any }> {
  const coder = program.coder.events as BorshEventCoder;
  const out: Array<{ name: string; data: any }> = [];
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/);
    if (!m) continue;
    try {
      const ev = coder.decode(m[1]);
      if (ev) out.push(ev);
    } catch {
      // not an event of this program
    }
  }
  return out;
}
