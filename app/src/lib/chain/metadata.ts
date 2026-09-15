import { PublicKey } from "@solana/web3.js";
import { metaplexMetadataPda } from "@stockfloor/sdk";

/** Token metadata the UI shows (Metaplex Token Metadata, created by DBC for the base mint). */
export interface TokenMetadata {
  name: string;
  symbol: string;
  uri: string;
}

function readString(data: Uint8Array, offset: number, maxLen: number): { value: string; next: number } {
  if (offset + 4 > data.length) throw new RangeError("metadata string length out of bounds");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = view.getUint32(offset, true);
  if (len > maxLen || offset + 4 + len > data.length) throw new RangeError("metadata string out of bounds");
  const bytes = data.subarray(offset + 4, offset + 4 + len);
  // Metaplex pads name / symbol / uri with NUL bytes to fixed lengths.
  const value = new TextDecoder().decode(bytes).replace(/\0+$/g, "").trim();
  return { value, next: offset + 4 + len };
}

/**
 * Decode `name`, `symbol` and `uri` from a Metaplex `MetadataV1` account:
 * key u8 | update_authority 32 | mint 32 | name String | symbol String | uri String | ...
 * Strings are Borsh (u32 LE length + UTF-8). Throws on malformed data.
 */
export function decodeMetaplexMetadata(data: Uint8Array): TokenMetadata {
  if (data.length < 1 + 32 + 32 + 12) throw new RangeError("metadata account too short");
  const name = readString(data, 65, 64);
  const symbol = readString(data, name.next, 32);
  const uri = readString(data, symbol.next, 400);
  return { name: name.value, symbol: symbol.value, uri: uri.value };
}

/** Metadata PDA of a mint. */
export function metadataAddress(mint: PublicKey): PublicKey {
  return metaplexMetadataPda(mint);
}

/**
 * Image URL for the avatar. The create form stores an https image URL as the token URI (MVP). A
 * metadata JSON URI (path ending in .json) is not fetched; the avatar falls back to initials, and
 * so does an image that fails to load.
 */
export function imageUrlFromUri(uri: string): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    if (u.protocol !== "https:") return null;
    return /\.json$/i.test(u.pathname) ? null : uri;
  } catch {
    return null;
  }
}
