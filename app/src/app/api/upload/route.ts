import { handleUploadRequest } from "@/lib/upload/handler";
import { RateLimiter, clientIpConfigFromEnv } from "@/lib/upload/rateLimit";
import { storageFromEnv } from "@/lib/upload/storage";

/**
 * Token image and metadata upload for the create form (see lib/upload/handler.ts). Storage: Pinata when
 * `PINATA_JWT` is set, the local `app/.uploads` directory in development, else 501. The JWT is read
 * here, on the server, and never reaches the browser bundle.
 */
export const dynamic = "force-dynamic";

/**
 * 10 uploads per 10 minutes per client address and 200 per 10 minutes in all, per server instance. The
 * global budget bounds a client that forges its address where no trusted proxy sets it.
 */
const limiter = new RateLimiter({ limit: 10, windowMs: 10 * 60_000, globalLimit: 200 });

export async function POST(request: Request) {
  const storage = storageFromEnv(process.env, { origin: new URL(request.url).origin });
  return handleUploadRequest(request, {
    storage,
    rateLimiter: limiter,
    clientIp: clientIpConfigFromEnv(process.env),
    log: (message) => console.warn(message),
  });
}
