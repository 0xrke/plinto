/**
 * Token image rules shared by the create form (a quick check before the preview) and the upload route
 * (the authoritative one). Client-safe: no Node APIs.
 */

/** Largest token image accepted: 1 MiB. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** Raster formats only. SVG is refused on purpose: it can carry script. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** File extension used when an image is stored under its own name. */
export const IMAGE_EXTENSION: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** For the file picker's `accept` attribute. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/**
 * The image type from the file's first bytes (its magic number), or null when it is none of the
 * accepted formats. The type a client declares is never trusted.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "GIF87a" or "GIF89a"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif";
  }
  // "RIFF" <u32 size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Largest accepted width or height in pixels (also bounds decompression bombs in viewers). */
export const MAX_IMAGE_SIDE = 4096;

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!);
const u32le = (b: Uint8Array, o: number) => u24le(b, o) + b[o + 3]! * 0x1000000;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** PNG: IHDR first, then well-formed chunks up to IEND, which must end the file. */
function pngSize(b: Uint8Array): [number, number] | null {
  if (b.length < 33 || u32be(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return null;
  const size: [number, number] = [u32be(b, 16), u32be(b, 20)];
  let o = 8;
  let sawData = false;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || len > b.length - o - 12) return null;
    if (type === "IDAT") sawData = true;
    o += 12 + len;
    if (type === "IEND") return o === b.length && sawData ? size : null;
  }
  return null;
}

/** JPEG: marker segments, entropy-coded scans, and EOI as the last two bytes. */
function jpegSize(b: Uint8Array): [number, number] | null {
  let o = 2;
  let size: [number, number] | null = null;
  while (o + 2 <= b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) return o + 2 === b.length ? size : null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    if (o + 4 > b.length) return null;
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (len < 8) return null;
      size = [u16be(b, o + 7), u16be(b, o + 5)];
    }
    o += 2 + len;
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not a stuffed 0x00 or a restart marker.
      while (o + 1 < b.length && !(b[o] === 0xff && b[o + 1] !== 0x00 && !(b[o + 1]! >= 0xd0 && b[o + 1]! <= 0xd7))) o += 1;
    }
  }
  return null;
}

/** GIF: header, optional global color table, blocks, and the trailer as the last byte. */
function gifSize(b: Uint8Array): [number, number] | null {
  if (b.length < 14) return null;
  const size: [number, number] = [u16le(b, 6), u16le(b, 8)];
  let o = 13;
  if (b[10]! & 0x80) o += 3 * (2 << (b[10]! & 7));
  const subBlocks = () => {
    while (o < b.length) {
      const n = b[o]!;
      o += 1 + n;
      if (n === 0) return true;
    }
    return false;
  };
  let frames = 0;
  while (o < b.length) {
    const block = b[o]!;
    if (block === 0x3b) return o + 1 === b.length && frames > 0 ? size : null;
    if (block === 0x21) {
      o += 2; // introducer + label
      if (!subBlocks()) return null;
    } else if (block === 0x2c) {
      if (o + 10 > b.length) return null;
      const packed = b[o + 9]!;
      o += 10;
      if (packed & 0x80) o += 3 * (2 << (packed & 7));
      o += 1; // LZW minimum code size
      if (!subBlocks()) return null;
      frames += 1;
    } else {
      return null;
    }
  }
  return null;
}

/** WebP: the RIFF size must match the file, and the chunks must fill it exactly. */
function webpSize(b: Uint8Array): [number, number] | null {
  if (b.length < 30 || u32le(b, 4) !== b.length - 8) return null;
  let o = 12;
  let size: [number, number] | null = null;
  let first = true;
  while (o + 8 <= b.length) {
    const type = ascii(b, o, 4);
    const len = u32le(b, o + 4);
    if (len > b.length - o - 8) return null;
    const d = o + 8;
    if (first) {
      if (type === "VP8X" && len >= 10) size = [u24le(b, d + 4) + 1, u24le(b, d + 7) + 1];
      else if (type === "VP8 " && len >= 10 && b[d + 3] === 0x9d && b[d + 4] === 0x01 && b[d + 5] === 0x2a) {
        size = [u16le(b, d + 6) & 0x3fff, u16le(b, d + 8) & 0x3fff];
      } else if (type === "VP8L" && len >= 5 && b[d] === 0x2f) {
        const bits = u32le(b, d + 1);
        size = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      } else return null;
      first = false;
    }
    o = d + len + (len & 1);
  }
  return o === b.length ? size : null;
}

/**
 * Parses the image's container structure: the type from its magic number, its pixel size, and that the
 * file ends where the format says it ends (no payload appended after an image header). Null when the
 * bytes are not a well-formed PNG, JPEG, GIF or WebP, or the size is zero or over `MAX_IMAGE_SIDE`.
 */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  const type = sniffImageType(bytes);
  if (!type) return null;
  const size =
    type === "image/png" ? pngSize(bytes) : type === "image/jpeg" ? jpegSize(bytes) : type === "image/gif" ? gifSize(bytes) : webpSize(bytes);
  if (!size) return null;
  const [width, height] = size;
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return null;
  return { type, width, height };
}

/**
 * Quick check of a picked file before it is previewed: declared type and size. The route sniffs the
 * bytes again. Returns an error message, or null.
 */
export function imageFileError(file: { type: string; size: number }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPEG, WebP or GIF image.";
  if (file.size > MAX_IMAGE_BYTES) return "Use an image of at most 1 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}
