import { defaultUploadDir, localUploadsEnabled, readLocalUpload } from "@/lib/upload/storage";

/**
 * Serves files of the local upload backend (`app/.uploads`), development only. With Pinata configured,
 * or on a production build that is not local, it answers 404.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!localUploadsEnabled(process.env)) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const file = await readLocalUpload(defaultUploadDir(), id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.bytes as BodyInit, {
    headers: {
      "content-type": file.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      // The token page fetches the metadata JSON from the browser.
      "access-control-allow-origin": "*",
    },
  });
}
