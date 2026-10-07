// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVED_NAME_MESSAGE } from "@stockfloor/sdk";
import { MAX_UPLOAD_BODY_BYTES, NOT_CONFIGURED_MESSAGE, handleUploadRequest, type UploadDeps } from "./handler";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, imageFileError, inspectImage, sniffImageType } from "./image";
import { buildMetadataJson, tokenLinkError, tokenNameError, tokenSymbolError } from "./metadata";
import { RateLimiter, clientIp, clientIpConfigFromEnv } from "./rateLimit";
import {
  DEFAULT_PINATA_GATEWAY,
  PINATA_PIN_FILE_URL,
  localDirStorage,
  localUploadsEnabled,
  pinataGateway,
  pinataStorage,
  readLocalUpload,
  storageFromEnv,
  type UploadStorage,
} from "./storage";

const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
/** Real 3×2 images (Pillow), so the structural check sees well-formed files. */
const PNG = b64("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFElEQVR4nGM8IafBAAZMEIqBgQEAE9gBEjRO+U0AAAAASUVORK5CYII=");
const JPEG = b64(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAEBv/aAAwDAQACEAMQAAABgANh/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD7/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
);
const GIF = b64("R0lGODdhAwACAIEAAMgeKAAAAAAAAAAAACwAAAAAAwACAAAIBgABCBwYEAA7");
const WEBP = b64("UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoDAAIAAUAmJaACdLoAA5gA/vFNr+LaR0KZD/7xn/9xn/9xn/yIAAAA");
const WEBP_LOSSLESS = b64("UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAAAdQjyIXpf+BiOh/AAA=");
const WEBP_ALPHA = b64(
  "UklGRlwAAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAAgICAgICAAFZQOCAuAAAAkAEAnQEqAwACAAFAJiWgAnS6AAOYAP7xTa/i2kdCmQ/+8Z//cZ//cZ/8iAAAAA==",
);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

/** In-memory storage that records what it was given. */
function memoryStorage(): UploadStorage & { images: { bytes: Uint8Array; type: string }[]; docs: string[] } {
  const images: { bytes: Uint8Array; type: string }[] = [];
  const docs: string[] = [];
  return {
    kind: "local",
    images,
    docs,
    async putImage(bytes, type) {
      images.push({ bytes, type });
      return `https://files.example/img-${images.length}`;
    },
    async putJson(json) {
      docs.push(json);
      return `https://files.example/meta-${docs.length}/metadata.json`;
    },
  };
}

function deps(storage: UploadStorage | null = memoryStorage(), limiter = new RateLimiter({ limit: 100, windowMs: 60_000, globalLimit: 1_000 })): UploadDeps {
  return { storage, rateLimiter: limiter };
}

function uploadRequest(
  fields: Record<string, string>,
  image?: { bytes: Uint8Array; type?: string; name?: string },
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (image) form.append("image", new Blob([image.bytes as BlobPart], { type: image.type ?? "image/png" }), image.name ?? "logo.png");
  return new Request("http://localhost:3000/api/upload", { method: "POST", body: form, headers });
}

const TOKEN = { name: "Harbor Coffee Co-op", symbol: "HRBR" };

describe("sniffImageType", () => {
  it("recognises png, jpeg, gif and webp by their magic bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(GIF)).toBe("image/gif");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe("image/gif");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("refuses svg, html, truncated signatures and other RIFF files", () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffImageType(PNG.subarray(0, 7))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    // RIFF....WAVE
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });
});

describe("inspectImage", () => {
  const concat = (...parts: (Uint8Array | string)[]) =>
    new Uint8Array(parts.flatMap((p) => [...(typeof p === "string" ? new TextEncoder().encode(p) : p)]));

  it("parses well-formed images and reads their pixel size", () => {
    for (const [bytes, type] of [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
      [GIF, "image/gif"],
      [WEBP, "image/webp"],
      [WEBP_LOSSLESS, "image/webp"],
      [WEBP_ALPHA, "image/webp"],
    ] as const) {
      expect(inspectImage(bytes), type).toEqual({ type, width: 3, height: 2 });
    }
  });

  it("refuses a payload behind a valid image header, trailing bytes and truncation", () => {
    expect(inspectImage(concat("GIF89a<html><script>alert(1)</script></html>", "A".repeat(64)))).toBeNull();
    expect(inspectImage(concat(PNG.subarray(0, 33), "<script>alert(1)</script>"))).toBeNull();
    expect(inspectImage(concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), "x".repeat(40)))).toBeNull();
    for (const img of [PNG, JPEG, GIF, WEBP, WEBP_LOSSLESS, WEBP_ALPHA]) {
      expect(inspectImage(concat(img, "<html>"))).toBeNull();
      expect(inspectImage(img.subarray(0, img.length - 1))).toBeNull();
    }
  });

  it("refuses images over the side limit", () => {
    // Patch the PNG's IHDR width (the CRC is not checked; the structure still is).
    const wide = PNG.slice();
    new DataView(wide.buffer).setUint32(16, MAX_IMAGE_SIDE + 1);
    expect(inspectImage(wide)).toBeNull();
    new DataView(wide.buffer).setUint32(16, MAX_IMAGE_SIDE);
    expect(inspectImage(wide)).toEqual({ type: "image/png", width: MAX_IMAGE_SIDE, height: 2 });
  });
});

describe("imageFileError", () => {
  it("accepts the four raster types up to 1 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(imageFileError({ type, size: MAX_IMAGE_BYTES }), type).toBeNull();
    }
    expect(imageFileError({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPEG, WebP or GIF/);
    expect(imageFileError({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toMatch(/at most 1 MB/);
    expect(imageFileError({ type: "image/png", size: 0 })).toMatch(/empty/);
  });
});

describe("token field rules", () => {
  it("reserves names and tickers that look like the brand", () => {
    expect(tokenNameError("Plinto")).toBe(RESERVED_NAME_MESSAGE);
    expect(tokenNameError("P L I N T O")).toBe(RESERVED_NAME_MESSAGE);
    expect(tokenNameError("РLІNТО")).toBe(RESERVED_NAME_MESSAGE);
    expect(tokenSymbolError("PL1NT0")).toBe(RESERVED_NAME_MESSAGE);
    expect(tokenNameError("Planet Coffee")).toBeUndefined();
    expect(tokenSymbolError("PLAN")).toBeUndefined();
  });

  it("checks links: https, the right host for X and Telegram", () => {
    expect(tokenLinkError("website", "")).toBeUndefined();
    expect(tokenLinkError("website", "https://harbor.coffee")).toBeUndefined();
    expect(tokenLinkError("website", "http://harbor.coffee")).toMatch(/https/);
    expect(tokenLinkError("website", "harbor.coffee")).toMatch(/full link/);
    expect(tokenLinkError("website", "javascript:alert(1)")).toMatch(/https/);
    expect(tokenLinkError("twitter", "https://x.com/harbor")).toBeUndefined();
    expect(tokenLinkError("twitter", "https://twitter.com/harbor")).toBeUndefined();
    expect(tokenLinkError("twitter", "https://evil.example/harbor")).toMatch(/x\.com/);
    expect(tokenLinkError("telegram", "https://t.me/harbor")).toBeUndefined();
    expect(tokenLinkError("telegram", "https://x.com/harbor")).toMatch(/t\.me/);
    expect(tokenLinkError("website", `https://a.example/${"a".repeat(200)}`)).toMatch(/200 bytes/);
  });

  it("builds the Metaplex metadata JSON and leaves empty fields out", () => {
    expect(
      buildMetadataJson(
        { name: "Harbor", symbol: "HRBR", description: "Beans.", links: { website: "https://h.example", twitter: "https://x.com/h" } },
        { uri: "https://files.example/i", type: "image/png" },
      ),
    ).toEqual({
      name: "Harbor",
      symbol: "HRBR",
      description: "Beans.",
      image: "https://files.example/i",
      properties: { files: [{ uri: "https://files.example/i", type: "image/png" }], category: "image" },
      external_url: "https://h.example",
      extensions: { website: "https://h.example", twitter: "https://x.com/h" },
    });
    expect(buildMetadataJson({ name: "H", symbol: "HH", description: "", links: {} }, null)).toEqual({ name: "H", symbol: "HH" });
  });
});

describe("handleUploadRequest", () => {
  it("stores the sniffed image, then a metadata JSON that points at it", async () => {
    const storage = memoryStorage();
    const res = await handleUploadRequest(
      uploadRequest(
        { ...TOKEN, symbol: "hrbr", description: "  Coffee, roasted by the harbor.  ", twitter: "https://x.com/harbor" },
        // The declared type lies; the bytes are what count.
        { bytes: WEBP, type: "image/png", name: "logo.png" },
      ),
      deps(storage),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uri: "https://files.example/meta-1/metadata.json", image: "https://files.example/img-1" });
    expect(storage.images.map((i) => i.type)).toEqual(["image/webp"]);
    expect(JSON.parse(storage.docs[0]!)).toEqual({
      name: "Harbor Coffee Co-op",
      symbol: "HRBR",
      description: "Coffee, roasted by the harbor.",
      image: "https://files.example/img-1",
      properties: { files: [{ uri: "https://files.example/img-1", type: "image/webp" }], category: "image" },
      extensions: { twitter: "https://x.com/harbor" },
    });
  });

  it("refuses a damaged image or one with a payload appended, before storing anything", async () => {
    const storage = memoryStorage();
    const polyglot = new Uint8Array([...GIF.subarray(0, 6), ...new TextEncoder().encode("<html><script>alert(1)</script></html>")]);
    for (const bytes of [polyglot, new Uint8Array([...PNG, 0x3c, 0x68])]) {
      const res = await handleUploadRequest(uploadRequest(TOKEN, { bytes, type: "image/gif" }), deps(storage));
      expect(res.status).toBe(415);
      expect((await res.json()).error).toMatch(/damaged/);
    }
    expect(storage.images).toEqual([]);
  });

  it("refuses a file that is not one of the raster types, whatever it claims to be", async () => {
    const storage = memoryStorage();
    for (const bytes of [SVG, new TextEncoder().encode("MZ executable")]) {
      const res = await handleUploadRequest(uploadRequest(TOKEN, { bytes, type: "image/png" }), deps(storage));
      expect(res.status).toBe(415);
      expect((await res.json()).error).toMatch(/PNG, JPEG, WebP or GIF/);
    }
    expect(storage.images).toEqual([]);
    expect(storage.docs).toEqual([]);
  });

  it("refuses an image over 1 MB and a body over the cap, before storing anything", async () => {
    const storage = memoryStorage();
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    const res = await handleUploadRequest(uploadRequest(TOKEN, { bytes: big }), deps(storage));
    expect(res.status).toBe(413);

    // A body far over the cap, declared or streamed without a length.
    const huge = new Uint8Array(MAX_UPLOAD_BODY_BYTES + 10);
    const declared = new Request("http://localhost:3000/api/upload", {
      method: "POST",
      body: huge,
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(huge.length) },
    });
    expect((await handleUploadRequest(declared, deps(storage))).status).toBe(413);
    const streamed = new Request("http://localhost:3000/api/upload", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          c.enqueue(huge);
          c.close();
        },
      }),
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    expect((await handleUploadRequest(streamed, deps(storage))).status).toBe(413);
    expect(storage.images).toEqual([]);
  });

  it("refuses reserved names and tickers server-side", async () => {
    const storage = memoryStorage();
    for (const fields of [
      { name: "PLINTO", symbol: "HRBR" },
      { name: "Harbor", symbol: "PL1NT0" },
      { name: "ＰＬＩＮＴＯ", symbol: "HRBR" },
      { name: "Pl​into", symbol: "HRBR" },
    ]) {
      const res = await handleUploadRequest(uploadRequest(fields, { bytes: PNG }), deps(storage));
      expect(res.status, fields.name).toBe(400);
      expect((await res.json()).error).toBe(RESERVED_NAME_MESSAGE);
    }
    expect(storage.images).toEqual([]);
  });

  it("validates the other fields", async () => {
    const run = async (fields: Record<string, string>) => {
      const res = await handleUploadRequest(uploadRequest(fields, { bytes: PNG }), deps());
      return { status: res.status, error: (await res.json()).error as string | undefined };
    };
    expect(await run({ symbol: "HRBR" })).toEqual({ status: 400, error: "Enter a token name." });
    expect((await run({ ...TOKEN, symbol: "H" })).error).toMatch(/2 to 10/);
    expect((await run({ ...TOKEN, description: "x".repeat(501) })).error).toMatch(/500 characters/);
    expect((await run({ ...TOKEN, website: "http://insecure.example" })).error).toMatch(/^Website: Use an https/);
    expect((await run({ ...TOKEN, telegram: "https://evil.example/t" })).error).toMatch(/^Telegram:/);
    // Nothing to store at all.
    const empty = await handleUploadRequest(uploadRequest(TOKEN), deps());
    expect(empty.status).toBe(400);
  });

  it("stores a metadata JSON without an image when there is a description", async () => {
    const storage = memoryStorage();
    const res = await handleUploadRequest(uploadRequest({ ...TOKEN, description: "Beans." }), deps(storage));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uri: "https://files.example/meta-1/metadata.json", image: null });
    expect(JSON.parse(storage.docs[0]!)).toEqual({ ...TOKEN, description: "Beans." });
  });

  it("answers 501 with a clear message when no storage is configured", async () => {
    const res = await handleUploadRequest(uploadRequest(TOKEN, { bytes: PNG }), deps(null));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe(NOT_CONFIGURED_MESSAGE);
  });

  it("refuses non-multipart bodies and cross-site browser posts", async () => {
    const asJson = new Request("http://localhost:3000/api/upload", {
      method: "POST",
      body: JSON.stringify(TOKEN),
      headers: { "content-type": "application/json" },
    });
    expect((await handleUploadRequest(asJson, deps())).status).toBe(415);
    const crossSite = uploadRequest(TOKEN, { bytes: PNG }, { origin: "https://evil.example", host: "localhost:3000" });
    expect((await handleUploadRequest(crossSite, deps())).status).toBe(403);
    const sameSite = uploadRequest(TOKEN, { bytes: PNG }, { origin: "http://localhost:3000", host: "localhost:3000" });
    expect((await handleUploadRequest(sameSite, deps())).status).toBe(200);
  });

  it("rate-limits per client address: the hop the trusted proxy appended, not the client's own", async () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000, globalLimit: 100 });
    // The proxy appends the real peer; the first hop is whatever the client sent.
    const from = (forged: string, real: string) => uploadRequest(TOKEN, { bytes: PNG }, { "x-forwarded-for": `${forged}, ${real}` });
    expect((await handleUploadRequest(from("10.0.0.1", "1.1.1.1"), deps(memoryStorage(), limiter))).status).toBe(200);
    expect((await handleUploadRequest(from("10.0.0.2", "1.1.1.1"), deps(memoryStorage(), limiter))).status).toBe(200);
    expect((await handleUploadRequest(from("10.0.0.3", "1.1.1.1"), deps(memoryStorage(), limiter))).status).toBe(429);
    expect((await handleUploadRequest(from("10.0.0.1", "2.2.2.2"), deps(memoryStorage(), limiter))).status).toBe(200);
  });

  it("bounds a client that forges a new address on every request with the global budget", async () => {
    const limiter = new RateLimiter({ limit: 10, windowMs: 60_000, globalLimit: 5 });
    const storage = memoryStorage();
    const statuses: number[] = [];
    for (let n = 0; n < 25; n++) {
      const req = uploadRequest(TOKEN, { bytes: PNG }, { "x-forwarded-for": `10.0.0.${n}` });
      statuses.push((await handleUploadRequest(req, deps(storage, limiter))).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(storage.images).toHaveLength(5);
  });

  it("refuses a URI over the 200-byte Metaplex limit", async () => {
    const storage = memoryStorage();
    storage.putJson = async () => `https://files.example/${"a".repeat(200)}.json`;
    const res = await handleUploadRequest(uploadRequest(TOKEN, { bytes: PNG }), deps(storage));
    expect(res.status).toBe(502);
  });
});

describe("RateLimiter", () => {
  it("opens a new window after the window length", () => {
    let t = 0;
    const limiter = new RateLimiter({ limit: 1, windowMs: 1_000, globalLimit: 100, now: () => t });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    t = 1_000;
    expect(limiter.take("a")).toBe(true);
  });

  it("has a global budget over all keys", () => {
    let t = 0;
    const limiter = new RateLimiter({ limit: 5, windowMs: 1_000, globalLimit: 3, now: () => t });
    expect(["a", "b", "c", "d"].map((k) => limiter.take(k))).toEqual([true, true, true, false]);
    t = 1_000;
    expect(limiter.take("d")).toBe(true);
  });

  it("caps the number of tracked keys and sweeps expired ones at most once per window", () => {
    let t = 0;
    const limiter = new RateLimiter({ limit: 5, windowMs: 1_000, globalLimit: 1_000, maxKeys: 3, now: () => t });
    expect(["a", "b", "c"].map((k) => limiter.take(k))).toEqual([true, true, true]);
    // Full of live windows: a new key is refused, a known key still counts.
    expect(limiter.take("d")).toBe(false);
    expect(limiter.take("a")).toBe(true);
    t = 1_000;
    // The old windows expired: the sweep frees room.
    expect(limiter.take("d")).toBe(true);
  });

  it("takes the client address from the right: the hop the trusted proxy appended", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 9.9.9.9, 10.0.0.1" }), { trustedHops: 2 })).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9" }), { trustedHops: 3 })).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("prefers a platform header when one is configured", () => {
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "8.8.8.8" });
    expect(clientIp(headers, { header: "x-real-ip" })).toBe("8.8.8.8");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6" }), { header: "x-real-ip" })).toBe("unknown");
    expect(clientIpConfigFromEnv({ VERCEL: "1" })).toEqual({ header: "x-real-ip", trustedHops: 1 });
    expect(clientIpConfigFromEnv({ UPLOAD_CLIENT_IP_HEADER: "CF-Connecting-IP", UPLOAD_TRUSTED_PROXY_HOPS: "2" })).toEqual({
      header: "cf-connecting-ip",
      trustedHops: 2,
    });
    expect(clientIpConfigFromEnv({ UPLOAD_TRUSTED_PROXY_HOPS: "zero" })).toEqual({ header: undefined, trustedHops: 1 });
  });
});

describe("pinataStorage", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.secret-test-jwt.sig";

  it("pins the image and the JSON (as metadata/metadata.json) with the JWT, and builds gateway URIs", async () => {
    const calls: { url: string; auth: string | null; form: FormData }[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), form: init!.body as FormData });
      n += 1;
      return Response.json({ IpfsHash: `${CID.slice(0, -1)}${n}`, PinSize: 10, Timestamp: "now" });
    }) as unknown as typeof fetch;
    const storage = pinataStorage({ jwt: JWT, fetchImpl });
    const res = await handleUploadRequest(uploadRequest({ ...TOKEN, description: "Beans." }, { bytes: PNG }), deps(storage));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uri: string; image: string };
    expect(body.image).toBe(`${DEFAULT_PINATA_GATEWAY}${CID.slice(0, -1)}1`);
    expect(body.uri).toBe(`${DEFAULT_PINATA_GATEWAY}${CID.slice(0, -1)}2/metadata.json`);
    expect(new TextEncoder().encode(body.uri).length).toBeLessThanOrEqual(200);

    expect(calls.map((c) => c.url)).toEqual([PINATA_PIN_FILE_URL, PINATA_PIN_FILE_URL]);
    expect(calls.every((c) => c.auth === `Bearer ${JWT}`)).toBe(true);
    const image = calls[0]!.form.get("file") as File;
    expect(image.name).toBe("image.png");
    expect(image.type).toBe("image/png");
    const doc = calls[1]!.form.get("file") as File;
    expect(doc.name).toBe("metadata/metadata.json");
    expect(JSON.parse(await doc.text())).toMatchObject({ name: TOKEN.name, image: body.image, description: "Beans." });
    expect(JSON.parse(calls[1]!.form.get("pinataOptions") as string)).toEqual({ cidVersion: 1 });
  });

  it("never echoes the JWT or the upstream body when Pinata fails", async () => {
    const logs: string[] = [];
    for (const fetchImpl of [
      async () => new Response(`invalid key ${JWT}`, { status: 401 }),
      async () => {
        throw new Error(`connect failed with ${JWT}`);
      },
      async () => Response.json({ IpfsHash: "../../etc/passwd" }),
    ]) {
      const storage = pinataStorage({ jwt: JWT, fetchImpl: fetchImpl as unknown as typeof fetch });
      const res = await handleUploadRequest(uploadRequest(TOKEN, { bytes: PNG }), {
        ...deps(storage),
        log: (m) => logs.push(m),
      });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).not.toContain(JWT);
      expect(text).not.toContain("invalid key");
      expect(text).toMatch(/Could not store the image/);
    }
    expect(logs.join("\n")).not.toContain(JWT);
    expect(logs[0]).toMatch(/HTTP 401/);
  });

  it("takes an https gateway from PINATA_GATEWAY and falls back to the default", () => {
    expect(pinataGateway(undefined)).toBe(DEFAULT_PINATA_GATEWAY);
    expect(pinataGateway("https://plinto.mypinata.cloud/ipfs")).toBe("https://plinto.mypinata.cloud/ipfs/");
    expect(pinataGateway("http://insecure.example/ipfs/")).toBe(DEFAULT_PINATA_GATEWAY);
    expect(pinataGateway("not a url")).toBe(DEFAULT_PINATA_GATEWAY);
  });
});

describe("storageFromEnv and the local backend", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "plinto-uploads-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("picks Pinata with a JWT, the local backend in development or a local build, else nothing", () => {
    const origin = "http://localhost:3000";
    expect(storageFromEnv({ PINATA_JWT: "j", NODE_ENV: "production" }, { origin })?.kind).toBe("pinata");
    expect(storageFromEnv({ NODE_ENV: "development" }, { origin, dir })?.kind).toBe("local");
    expect(storageFromEnv({ NODE_ENV: "production", STOCKFLOOR_LOCAL_BUILD: "1" }, { origin, dir })?.kind).toBe("local");
    expect(storageFromEnv({ NODE_ENV: "production" }, { origin })).toBeNull();
    expect(localUploadsEnabled({ PINATA_JWT: "j", NODE_ENV: "development" })).toBe(false);
  });

  it("writes files under the directory and reads them back by id with their content type", async () => {
    const storage = localDirStorage({ dir, origin: "http://localhost:3000" });
    const imageUrl = await storage.putImage(PNG, "image/png");
    const jsonUrl = await storage.putJson('{"name":"H"}');
    expect(imageUrl).toMatch(/^http:\/\/localhost:3000\/api\/upload\/[a-f0-9]{32}\.png$/);
    expect(jsonUrl).toMatch(/^http:\/\/localhost:3000\/api\/upload\/[a-f0-9]{32}\.json$/);
    expect((await readdir(dir)).length).toBe(2);

    const id = imageUrl.split("/").pop()!;
    const file = await readLocalUpload(dir, id);
    expect(file?.contentType).toBe("image/png");
    expect(Array.from(file!.bytes)).toEqual(Array.from(PNG));
    const doc = await readLocalUpload(dir, jsonUrl.split("/").pop()!);
    expect(doc?.contentType).toMatch(/^application\/json/);
    expect(await readFile(path.join(dir, jsonUrl.split("/").pop()!), "utf8")).toBe('{"name":"H"}');
  });

  it("refuses ids that are not its own file names", async () => {
    for (const id of ["../package.json", "..%2Fpackage.json", "abc.png", `${"a".repeat(32)}.svg`, `${"A".repeat(32)}.png`]) {
      expect(await readLocalUpload(dir, id), id).toBeNull();
    }
    expect(await readLocalUpload(dir, `${"a".repeat(32)}.png`)).toBeNull();
  });
});
