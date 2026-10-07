import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, inspectImage, sniffImageType } from "./image";
import {
  MAX_METADATA_JSON_BYTES,
  MAX_URI_BYTES,
  buildMetadataJson,
  descriptionError,
  tokenLinkError,
  tokenNameError,
  tokenSymbolError,
  utf8Length,
  type TokenLinkKind,
  type TokenLinks,
} from "./metadata";
import { clientIp, type ClientIpConfig, type RateLimiter } from "./rateLimit";
import { StorageError, type UploadStorage } from "./storage";

/**
 * POST /api/upload: multipart form with `image` (optional file) and the text fields `name`, `symbol`,
 * `description`, `website`, `twitter`, `telegram`. Stores the image, then a Metaplex metadata JSON that
 * points at it, and answers `{ uri, image }`: `uri` is what the launch writes on chain.
 */

/** Text fields of the form; the whole body may not exceed the image cap plus this. */
const TEXT_ALLOWANCE_BYTES = 32 * 1024;
export const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES + TEXT_ALLOWANCE_BYTES;

export const NOT_CONFIGURED_MESSAGE =
  "Image upload is not set up on this server. Paste your own metadata or image URL under Advanced instead.";
const STORE_FAILED_MESSAGE = "Could not store the image. Try again, or use your own metadata URL under Advanced.";

export interface UploadDeps {
  storage: UploadStorage | null;
  rateLimiter: RateLimiter;
  /** Which header carries the client address (see `ClientIpConfig`); defaults to one trusted proxy. */
  clientIp?: ClientIpConfig;
  /** Logs storage failures server-side (never sent to the client). */
  log?: (message: string) => void;
}

export interface UploadSuccess {
  uri: string;
  image: string | null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function fail(error: string, status: number): Response {
  return json({ error }, status);
}

/** Reads at most `cap` bytes of the body; null when it is longer. */
async function readCapped(request: Request, cap: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** A browser post from another site is refused. Requests without an Origin (curl, server code) pass. */
function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function handleUploadRequest(request: Request, deps: UploadDeps): Promise<Response> {
  if (!sameOrigin(request.headers)) return fail("Uploads are only accepted from this site.", 403);
  if (!deps.storage) return fail(NOT_CONFIGURED_MESSAGE, 501);
  if (!deps.rateLimiter.take(clientIp(request.headers, deps.clientIp))) {
    return fail("Too many uploads from your address. Wait a few minutes and try again.", 429);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return fail("Send a multipart form.", 415);

  const body = await readCapped(request, MAX_UPLOAD_BODY_BYTES);
  if (body === null) return fail("Use an image of at most 1 MB.", 413);
  let form: FormData;
  try {
    form = await new Response(body as BodyInit, { headers: { "content-type": contentType } }).formData();
  } catch {
    return fail("Could not read the form.", 400);
  }

  const name = text(form, "name");
  const symbol = text(form, "symbol").toUpperCase();
  const description = text(form, "description");
  const links: TokenLinks = {};
  const fieldError =
    tokenNameError(name) ?? tokenSymbolError(symbol) ?? descriptionError(description) ?? undefined;
  if (fieldError) return fail(fieldError, 400);
  for (const kind of ["website", "twitter", "telegram"] as TokenLinkKind[]) {
    const link = text(form, kind);
    const error = tokenLinkError(kind, link);
    if (error) return fail(`${kind === "twitter" ? "X" : kind[0]!.toUpperCase() + kind.slice(1)}: ${error}`, 400);
    if (link) links[kind] = link;
  }

  const file = form.get("image");
  let imageBytes: Uint8Array | null = null;
  if (file !== null) {
    if (typeof file === "string") return fail("Send the image as a file.", 400);
    if (file.size > MAX_IMAGE_BYTES) return fail("Use an image of at most 1 MB.", 413);
    if (file.size > 0) imageBytes = new Uint8Array(await file.arrayBuffer());
  }
  // The bytes decide the type, never the name or the declared content type, and the file must be a
  // well-formed image from end to end (no payload riding behind an image header).
  if (imageBytes && !sniffImageType(imageBytes)) return fail("Use a PNG, JPEG, WebP or GIF image.", 415);
  const imageType = imageBytes ? inspectImage(imageBytes)?.type ?? null : null;
  if (imageBytes && !imageType) {
    return fail(`That image file is damaged or over ${MAX_IMAGE_SIDE}×${MAX_IMAGE_SIDE} pixels. Export it again as PNG, JPEG, WebP or GIF.`, 415);
  }
  if (!imageBytes && !description && Object.keys(links).length === 0) {
    return fail("Nothing to upload: add an image, a description or a link.", 400);
  }

  try {
    const imageUri = imageBytes && imageType ? await deps.storage.putImage(imageBytes, imageType) : null;
    const document = JSON.stringify(
      buildMetadataJson({ name, symbol, description, links }, imageUri && imageType ? { uri: imageUri, type: imageType } : null),
    );
    if (utf8Length(document) > MAX_METADATA_JSON_BYTES) return fail("The metadata is too large.", 413);
    const uri = await deps.storage.putJson(document);
    if (utf8Length(uri) > MAX_URI_BYTES) {
      deps.log?.(`upload: metadata URI is ${utf8Length(uri)} bytes, over the ${MAX_URI_BYTES}-byte limit; check PINATA_GATEWAY`);
      return fail(STORE_FAILED_MESSAGE, 502);
    }
    const result: UploadSuccess = { uri, image: imageUri };
    return json(result);
  } catch (err) {
    deps.log?.(`upload: ${err instanceof StorageError ? err.message : "storage failed"}`);
    return fail(STORE_FAILED_MESSAGE, 502);
  }
}
