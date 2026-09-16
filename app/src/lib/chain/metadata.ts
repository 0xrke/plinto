import { PublicKey } from "@solana/web3.js";
import { metaplexMetadataPda } from "@stockfloor/sdk";

/** Token metadata the UI shows (Metaplex Token Metadata, created by DBC for the base mint). */
export interface TokenMetadata {
  name: string;
  symbol: string;
  uri: string;
  /**
   * Image resolved from `uri` (`resolveTokenImageUrl`): the URI itself when it is an image, the
   * `image` field when it is a metadata JSON document. Undefined when nothing resolved it yet;
   * null when there is no usable image.
   */
  imageUrl?: string | null;
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

/** An https URL, or null. Everything else (http, ipfs:, data:, javascript:, junk) is refused. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** A token URI that points at a metadata JSON document rather than at an image. */
export function isJsonMetadataUri(uri: string): boolean {
  const https = httpsUrl(uri);
  if (!https) return false;
  return /\.json$/i.test(new URL(https).pathname);
}

/**
 * Image URL for the avatar, without a network read: the token URI itself when it is a plain image
 * URL. A metadata JSON URI needs `resolveTokenImageUrl`; here it is null, so the avatar falls back
 * to initials rather than loading a JSON document into an `<img>`.
 */
export function imageUrlFromUri(uri: string): string | null {
  const https = httpsUrl(uri);
  if (!https) return null;
  return isJsonMetadataUri(https) ? null : https;
}

/** Fetch timeout for a token's metadata JSON. Long enough for a slow gateway, short enough to not stall a page. */
export const METADATA_FETCH_TIMEOUT_MS = 4_000;

/**
 * The image of a token URI. A plain image URL is used as is; a metadata JSON URI (the shape wallets
 * and explorers expect: `{ name, symbol, description, image }`) is fetched once and its `image`
 * field is used. Any failure — offline, a timeout, non-JSON, no https `image` — is null, and the
 * avatar shows the token's initials.
 *
 * Only a `.json` path is fetched. A JSON document served under an extension-less URI (some IPFS
 * pinning services) is not detected; such a token shows initials.
 */
export async function resolveTokenImageUrl(
  uri: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  const https = httpsUrl(uri);
  if (!https) return null;
  if (!isJsonMetadataUri(https)) return https;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? METADATA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(https, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) return null;
    const doc: unknown = await res.json();
    if (!doc || typeof doc !== "object") return null;
    return httpsUrl((doc as { image?: unknown }).image);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
