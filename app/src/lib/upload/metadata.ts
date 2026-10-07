import { RESERVED_NAME_MESSAGE, isReservedTokenName } from "@stockfloor/sdk";
import type { ImageType } from "./image";

/**
 * Token metadata fields, as the create form and the upload route both check them, and the Metaplex
 * metadata JSON built from them. Client-safe.
 */

/** Longest description stored in the metadata JSON. */
export const MAX_DESCRIPTION_CHARS = 500;
/** Longest link stored in the metadata JSON, in UTF-8 bytes. */
export const MAX_LINK_BYTES = 200;
/** Largest metadata JSON document stored. Well above what the capped fields can produce. */
export const MAX_METADATA_JSON_BYTES = 8 * 1024;
/** Metaplex limit for the token URI written on chain. */
export const MAX_URI_BYTES = 200;

export type TokenLinkKind = "website" | "twitter" | "telegram";
export type TokenLinks = Partial<Record<TokenLinkKind, string>>;

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Token name error (Metaplex: at most 32 bytes; the reserved brand), or undefined. Expects a trimmed name. */
export function tokenNameError(name: string): string | undefined {
  if (name.length === 0) return "Enter a token name.";
  if (utf8Length(name) > 32) return "Use at most 32 bytes (fewer characters for emoji or accents).";
  if (isReservedTokenName(name, "")) return RESERVED_NAME_MESSAGE;
  return undefined;
}

/** Ticker error (2 to 10 letters or digits; the reserved brand), or undefined. Expects a trimmed symbol. */
export function tokenSymbolError(symbol: string): string | undefined {
  if (symbol.length === 0) return "Enter a symbol.";
  if (!/^[A-Z0-9]{2,10}$/.test(symbol.toUpperCase())) return "Use 2 to 10 letters or digits.";
  if (isReservedTokenName("", symbol)) return RESERVED_NAME_MESSAGE;
  return undefined;
}

export function descriptionError(description: string): string | undefined {
  return description.length > MAX_DESCRIPTION_CHARS ? `Use at most ${MAX_DESCRIPTION_CHARS} characters.` : undefined;
}

const LINK_HOSTS: Partial<Record<TokenLinkKind, readonly string[]>> = {
  twitter: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  telegram: ["t.me", "telegram.me", "www.telegram.me"],
};

const LINK_EXAMPLE: Record<TokenLinkKind, string> = {
  website: "https://example.com",
  twitter: "https://x.com/yourtoken",
  telegram: "https://t.me/yourtoken",
};

/** Error for an optional link (empty is fine), or undefined. Expects a trimmed value. */
export function tokenLinkError(kind: TokenLinkKind, value: string): string | undefined {
  if (value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `Enter a full link, for example ${LINK_EXAMPLE[kind]}.`;
  }
  if (url.protocol !== "https:") return "Use an https:// link.";
  const hosts = LINK_HOSTS[kind];
  if (hosts && !hosts.includes(url.hostname.toLowerCase())) return `Use a link like ${LINK_EXAMPLE[kind]}.`;
  if (utf8Length(value) > MAX_LINK_BYTES) return `Use a link of at most ${MAX_LINK_BYTES} bytes.`;
  return undefined;
}

export interface TokenMetadataFields {
  name: string;
  symbol: string;
  description: string;
  links: TokenLinks;
}

/**
 * The Metaplex fungible-token metadata JSON: `{ name, symbol, description, image, properties }`, plus
 * `external_url` (the website) and `extensions` with the social links, the shape wallets, explorers
 * and the launchpad aggregators read. Empty fields are left out.
 */
export function buildMetadataJson(
  fields: TokenMetadataFields,
  image: { uri: string; type: ImageType } | null,
): Record<string, unknown> {
  const json: Record<string, unknown> = { name: fields.name, symbol: fields.symbol };
  if (fields.description) json.description = fields.description;
  if (image) {
    json.image = image.uri;
    json.properties = { files: [{ uri: image.uri, type: image.type }], category: "image" };
  }
  if (fields.links.website) json.external_url = fields.links.website;
  const extensions: Record<string, string> = {};
  for (const kind of ["website", "twitter", "telegram"] as const) {
    const link = fields.links[kind];
    if (link) extensions[kind] = link;
  }
  if (Object.keys(extensions).length > 0) json.extensions = extensions;
  return json;
}
