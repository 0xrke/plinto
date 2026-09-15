/**
 * Node-only keypair loading with the repository safety rules:
 * - the file must resolve (after symlinks) inside `<repo>/keys/`, or inside a temporary directory
 *   created by tests (`<os.tmpdir()>/stockfloor-test-*`);
 * - `~/.config/solana/id.json` and any other path are refused.
 */
import { Keypair } from "@solana/web3.js";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (packages/sdk/src/node -> repo). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const REPO_KEYS_DIR = join(REPO_ROOT, "keys");
export const TEST_KEYS_PREFIX = "stockfloor-test-";

export class KeypairPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeypairPathError";
  }
}

/** realpath of `p`, or of its nearest existing ancestor joined with the rest when `p` does not exist. */
function real(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(real(parent), basename(abs));
  }
}

/** Validate a keypair path and return its real path; throws `KeypairPathError` when refused. */
export function resolveKeypairPath(path: string, opts: { cwd?: string; repoKeysDir?: string } = {}): string {
  if (!path || typeof path !== "string") throw new KeypairPathError("a --keypair path is required");
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  const abs = isAbsolute(expanded) ? expanded : resolve(opts.cwd ?? process.cwd(), expanded);
  const solanaDefault = real(join(homedir(), ".config", "solana", "id.json"));
  const target = real(abs);
  if (target === solanaDefault || abs === join(homedir(), ".config", "solana", "id.json")) {
    throw new KeypairPathError("refusing ~/.config/solana/id.json: use a dedicated keypair under keys/");
  }
  if (target.split(sep).includes(".config") && target.split(sep).includes("solana")) {
    throw new KeypairPathError(`refusing a Solana CLI wallet path: ${target}`);
  }
  const keysDir = real(opts.repoKeysDir ?? REPO_KEYS_DIR);
  if (target.startsWith(keysDir + sep)) return target;
  const tmp = real(tmpdir());
  if (target.startsWith(tmp + sep)) {
    const rel = target.slice(tmp.length + 1).split(sep);
    if (rel.length >= 2 && rel[0]!.startsWith(TEST_KEYS_PREFIX)) return target;
  }
  throw new KeypairPathError(`refusing keypair outside ${keysDir}: ${target} (${basename(target)})`);
}

/** Load a keypair JSON (64-byte secret key array) after `resolveKeypairPath`. */
export function loadKeypair(path: string, opts: { cwd?: string; repoKeysDir?: string } = {}): Keypair {
  const p = resolveKeypairPath(path, opts);
  if (!existsSync(p)) throw new KeypairPathError(`keypair file not found: ${p}`);
  const bytes = JSON.parse(readFileSync(p, "utf8")) as unknown;
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new KeypairPathError(`not a keypair file (expected a JSON array of 64 bytes): ${p}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}
