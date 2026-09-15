/**
 * Little-endian readers over Uint8Array (DataView, no Node Buffer APIs) so decoders run in
 * browsers without polyfills.
 */
import { PublicKey } from "@solana/web3.js";

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function need(data: Uint8Array, offset: number, len: number, what: string): void {
  if (offset < 0 || offset + len > data.length) {
    throw new RangeError(`${what}: read of ${len} bytes at ${offset} exceeds ${data.length}`);
  }
}

export function readU8(data: Uint8Array, offset: number): number {
  need(data, offset, 1, "u8");
  return data[offset]!;
}

export function readBool(data: Uint8Array, offset: number): boolean {
  return readU8(data, offset) !== 0;
}

export function readU16(data: Uint8Array, offset: number): number {
  need(data, offset, 2, "u16");
  return view(data).getUint16(offset, true);
}

export function readU32(data: Uint8Array, offset: number): number {
  need(data, offset, 4, "u32");
  return view(data).getUint32(offset, true);
}

export function readU64(data: Uint8Array, offset: number): bigint {
  need(data, offset, 8, "u64");
  return view(data).getBigUint64(offset, true);
}

export function readI64(data: Uint8Array, offset: number): bigint {
  need(data, offset, 8, "i64");
  return view(data).getBigInt64(offset, true);
}

export function readU128(data: Uint8Array, offset: number): bigint {
  need(data, offset, 16, "u128");
  const v = view(data);
  return v.getBigUint64(offset, true) | (v.getBigUint64(offset + 8, true) << 64n);
}

/** Unsigned little-endian integer of any byte length (e.g. DAMM v2 `[u8; 32]` U256 fields). */
export function readUintLE(bytes: ArrayLike<number>): bigint {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]!);
  return v;
}

export function readF64(data: Uint8Array, offset: number): number {
  need(data, offset, 8, "f64");
  return view(data).getFloat64(offset, true);
}

export function readPubkey(data: Uint8Array, offset: number): PublicKey {
  need(data, offset, 32, "pubkey");
  return new PublicKey(data.subarray(offset, offset + 32));
}

export function writeU64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function startsWith(data: ArrayLike<number>, prefix: ArrayLike<number>): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

/** Base64 to bytes with `atob` (browsers and Node >= 16). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, "0");
  return s;
}

export const minBigint = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxBigint = (a: bigint, b: bigint) => (a > b ? a : b);
