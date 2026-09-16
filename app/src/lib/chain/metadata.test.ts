import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { encodeMetadata } from "../../test/chainFixtures";
import { decodeMetaplexMetadata, imageUrlFromUri, isJsonMetadataUri, resolveTokenImageUrl } from "./metadata";

describe("decodeMetaplexMetadata", () => {
  it("reads NUL-padded name, symbol and uri", () => {
    const mint = Keypair.generate().publicKey;
    const data = encodeMetadata(mint, "Harbor Coffee Co-op ☕", "HRBR", "https://example.com/hrbr.png");
    expect(decodeMetaplexMetadata(data)).toEqual({ name: "Harbor Coffee Co-op ☕", symbol: "HRBR", uri: "https://example.com/hrbr.png" });
  });

  it("rejects truncated or malformed data", () => {
    expect(() => decodeMetaplexMetadata(new Uint8Array(40))).toThrow(RangeError);
    const data = encodeMetadata(Keypair.generate().publicKey, "A", "B", "C");
    new DataView(data.buffer).setUint32(65, 10_000, true);
    expect(() => decodeMetaplexMetadata(data)).toThrow(RangeError);
  });
});

describe("imageUrlFromUri", () => {
  it("uses https image URIs and ignores JSON metadata, http and junk", () => {
    expect(imageUrlFromUri("https://example.com/logo.png")).toBe("https://example.com/logo.png");
    expect(imageUrlFromUri("https://ipfs.io/ipfs/bafy123")).toBe("https://ipfs.io/ipfs/bafy123");
    expect(imageUrlFromUri("https://example.com/token.json")).toBeNull();
    expect(imageUrlFromUri("http://example.com/logo.png")).toBeNull();
    expect(imageUrlFromUri("javascript:alert(1)")).toBeNull();
    expect(imageUrlFromUri("")).toBeNull();
  });
});

describe("resolveTokenImageUrl", () => {
  const ok = (body: unknown) => (async () => ({ ok: true, json: async () => body }) as Response) as unknown as typeof fetch;

  it("uses a plain image URI without any network read", async () => {
    const fetchImpl = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    expect(await resolveTokenImageUrl("https://example.com/logo.png", { fetchImpl })).toBe("https://example.com/logo.png");
    expect(await resolveTokenImageUrl("http://example.com/logo.png", { fetchImpl })).toBeNull();
    expect(await resolveTokenImageUrl("", { fetchImpl })).toBeNull();
  });

  it("reads the image field of a metadata JSON document", async () => {
    const image = await resolveTokenImageUrl("https://x.test/token.json", {
      fetchImpl: ok({ name: "Harbor", symbol: "HRBR", description: "d", image: "https://x.test/logo.png" }),
    });
    expect(image).toBe("https://x.test/logo.png");
  });

  it("falls back to no image on a failed read, a non-document, or an image that is not https", async () => {
    const fail = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await resolveTokenImageUrl("https://x.test/token.json", { fetchImpl: fail })).toBeNull();
    const notOk = (async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await resolveTokenImageUrl("https://x.test/token.json", { fetchImpl: notOk })).toBeNull();
    expect(await resolveTokenImageUrl("https://x.test/token.json", { fetchImpl: ok("<html>") })).toBeNull();
    expect(await resolveTokenImageUrl("https://x.test/token.json", { fetchImpl: ok({ image: "javascript:alert(1)" }) })).toBeNull();
    expect(await resolveTokenImageUrl("https://x.test/token.json", { fetchImpl: ok({}) })).toBeNull();
  });

  it("gives up on a document that never answers", async () => {
    const hang = (async (_u: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expect(await resolveTokenImageUrl("https://x.test/token.json", { fetchImpl: hang, timeoutMs: 5 })).toBeNull();
  });

  it("recognises a metadata JSON URI", () => {
    expect(isJsonMetadataUri("https://x.test/token.json")).toBe(true);
    expect(isJsonMetadataUri("https://x.test/TOKEN.JSON?v=2")).toBe(true);
    expect(isJsonMetadataUri("https://x.test/logo.png")).toBe(false);
    expect(isJsonMetadataUri("not a url")).toBe(false);
  });
});
