import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { encodeMetadata } from "../../test/chainFixtures";
import { decodeMetaplexMetadata, imageUrlFromUri } from "./metadata";

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
