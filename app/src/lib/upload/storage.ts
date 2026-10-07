import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { IMAGE_EXTENSION, type ImageType } from "./image";

/**
 * Where the upload route stores token images and metadata JSON. Server-only.
 *
 * - Pinata (IPFS) when `PINATA_JWT` is set. Gateway from `PINATA_GATEWAY`.
 * - A local directory (`app/.uploads`, served by `/api/upload/[id]`) for development: no Pinata and
 *   either a non-production `NODE_ENV` or `STOCKFLOOR_LOCAL_BUILD=1`.
 * - Otherwise none, and the route answers 501.
 */
export interface UploadStorage {
  readonly kind: "pinata" | "local";
  /** Stores an image and returns its public URL. */
  putImage(bytes: Uint8Array, type: ImageType): Promise<string>;
  /** Stores a metadata JSON document and returns its public URL, which ends in `.json`. */
  putJson(json: string): Promise<string>;
}

/** A storage call failed. The message is safe to log; it never contains the JWT or the upstream body. */
export class StorageError extends Error {}

export const DEFAULT_PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
export const PINATA_PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_TIMEOUT_MS = 20_000;

/** Gateway base with a trailing slash; https only, else the default. */
export function pinataGateway(value: string | undefined): string {
  if (!value) return DEFAULT_PINATA_GATEWAY;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return DEFAULT_PINATA_GATEWAY;
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch {
    return DEFAULT_PINATA_GATEWAY;
  }
}

/** A content id as Pinata returns it (CIDv0 or CIDv1 base32/base58): nothing that could break out of a URL path. */
const CID = /^[A-Za-z0-9]{46,100}$/;

/**
 * Pinata through the legacy `pinning/pinFileToIPFS` endpoint, which (unlike the v3 files API) takes a
 * folder. The metadata JSON is pinned as `metadata/metadata.json`, so its URI ends in `/metadata.json`:
 * the app (`isJsonMetadataUri`) and most indexers only fetch a token URI as JSON when the path says so.
 * The JWT needs the `pinFileToIPFS` scope only.
 */
export function pinataStorage(opts: { jwt: string; gateway?: string; fetchImpl?: typeof fetch }): UploadStorage {
  const gateway = pinataGateway(opts.gateway);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  async function pin(blob: Blob, filename: string, name: string): Promise<string> {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("pinataMetadata", JSON.stringify({ name }));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    let response: Response;
    try {
      response = await fetchImpl(PINATA_PIN_FILE_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.jwt}` },
        body: form,
        signal: AbortSignal.timeout(PINATA_TIMEOUT_MS),
      });
    } catch {
      throw new StorageError("Pinata is unreachable.");
    }
    // The upstream body is never echoed: only the status.
    if (!response.ok) throw new StorageError(`Pinata refused the upload (HTTP ${response.status}).`);
    let cid: unknown;
    try {
      cid = ((await response.json()) as { IpfsHash?: unknown }).IpfsHash;
    } catch {
      throw new StorageError("Pinata sent an unreadable answer.");
    }
    if (typeof cid !== "string" || !CID.test(cid)) throw new StorageError("Pinata sent no content id.");
    return `${gateway}${cid}`;
  }

  return {
    kind: "pinata",
    async putImage(bytes, type) {
      return pin(new Blob([bytes as BlobPart], { type }), `image.${IMAGE_EXTENSION[type]}`, "plinto-token-image");
    },
    async putJson(json) {
      const dir = await pin(new Blob([json], { type: "application/json" }), "metadata/metadata.json", "plinto-token-metadata");
      return `${dir}/metadata.json`;
    },
  };
}

/** Name of a locally stored upload: 32 hex characters and a known extension. */
export const LOCAL_UPLOAD_ID = /^[a-f0-9]{32}\.(png|jpg|webp|gif|json)$/;

export const LOCAL_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  json: "application/json; charset=utf-8",
};

/** Default directory of the local backend, next to the app's package.json. */
export function defaultUploadDir(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ".uploads");
}

/** Development storage: files under `dir`, served by `/api/upload/<id>` on `origin`. */
export function localDirStorage(opts: { dir: string; origin: string }): UploadStorage {
  async function put(data: Uint8Array | string, ext: string): Promise<string> {
    const id = `${randomBytes(16).toString("hex")}.${ext}`;
    try {
      await mkdir(opts.dir, { recursive: true });
      // The upload directory is runtime data, not code: keep it out of the output file tracing.
      await writeFile(path.join(/*turbopackIgnore: true*/ opts.dir, id), data, { flag: "wx" });
    } catch {
      throw new StorageError("Could not write the local upload.");
    }
    return `${opts.origin}/api/upload/${id}`;
  }
  return {
    kind: "local",
    putImage: (bytes, type) => put(bytes, IMAGE_EXTENSION[type]),
    putJson: (json) => put(json, "json"),
  };
}

/** Reads a local upload by id, or null when the id is malformed or the file does not exist. */
export async function readLocalUpload(dir: string, id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const match = LOCAL_UPLOAD_ID.exec(id);
  if (!match) return null;
  try {
    const bytes = await readFile(path.join(/*turbopackIgnore: true*/ dir, id));
    return { bytes: new Uint8Array(bytes), contentType: LOCAL_CONTENT_TYPE[match[1]!]! };
  } catch {
    return null;
  }
}

export interface UploadEnv {
  PINATA_JWT?: string;
  PINATA_GATEWAY?: string;
  NODE_ENV?: string;
  STOCKFLOOR_LOCAL_BUILD?: string;
}

/** The local backend is allowed: no Pinata, and a development server or a local build. */
export function localUploadsEnabled(env: UploadEnv): boolean {
  return !env.PINATA_JWT && (env.NODE_ENV !== "production" || env.STOCKFLOOR_LOCAL_BUILD === "1");
}

/** The storage this server is configured for, or null (the route then answers 501). */
export function storageFromEnv(
  env: UploadEnv,
  opts: { origin: string; dir?: string; fetchImpl?: typeof fetch },
): UploadStorage | null {
  if (env.PINATA_JWT) return pinataStorage({ jwt: env.PINATA_JWT, gateway: env.PINATA_GATEWAY, fetchImpl: opts.fetchImpl });
  if (localUploadsEnabled(env)) return localDirStorage({ dir: opts.dir ?? defaultUploadDir(), origin: opts.origin });
  return null;
}
