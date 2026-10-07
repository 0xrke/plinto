import type { TokenLinks } from "./metadata";

/** Browser side of `/api/upload`: sends the image and the text fields, returns the metadata URI. */

export type UploadResult =
  | { ok: true; uri: string; image: string | null }
  /** `notConfigured`: the server has no storage (501); the form then offers the own-URL field. */
  | { ok: false; error: string; notConfigured: boolean };

export async function uploadTokenMetadata(
  fields: { name: string; symbol: string; description: string; links: TokenLinks; image: File | null },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("name", fields.name);
  form.append("symbol", fields.symbol);
  form.append("description", fields.description);
  for (const [kind, link] of Object.entries(fields.links)) if (link) form.append(kind, link);
  if (fields.image) form.append("image", fields.image, fields.image.name || "image");

  let response: Response;
  try {
    response = await fetchImpl("/api/upload", { method: "POST", body: form });
  } catch {
    return { ok: false, error: "Could not reach the server to upload the image. Check your connection.", notConfigured: false };
  }
  let body: { uri?: unknown; image?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Handled below.
  }
  if (response.ok && typeof body.uri === "string") {
    return { ok: true, uri: body.uri, image: typeof body.image === "string" ? body.image : null };
  }
  return {
    ok: false,
    error: typeof body.error === "string" ? body.error : `The image upload failed (HTTP ${response.status}).`,
    notConfigured: response.status === 501,
  };
}
