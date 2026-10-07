import { PublicKey } from "@solana/web3.js";

/*
 * Swap events of Meteora DBC and DAMM v2, decoded from their self-CPI event instructions.
 *
 * Both programs emit events with `emit_cpi!`: an inner instruction to the program itself whose data is
 * EVENT_IX_TAG (8 bytes) + event discriminator (8 bytes) + the Borsh body. The event handler requires the
 * program's event-authority PDA as signer, so in a successful transaction an inner instruction of DBC or
 * DAMM v2 that starts with the tag is genuine. Layouts follow idls/dynamic_bonding_curve.json and
 * idls/cp_amm.json (the tests re-derive the offsets from the IDLs).
 *
 * DBC emits EvtSwap and then EvtSwap2 for every swap; only EvtSwap2 (and its transfer-hook twin) is read,
 * so a trade is never counted twice. DBC and DAMM v2 share the EvtSwap2 discriminator with different
 * layouts: pick the decoder from the inner instruction's program id, never from the discriminator.
 *
 * This file imports nothing app-specific, so the integration tests can import it relatively.
 */

/** `sha256("anchor:event")[0..8]`, reversed (little-endian u64 tag). */
export const EVENT_IX_TAG = Uint8Array.of(0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d);
/** `sha256("event:EvtSwap2")[0..8]`: DBC and DAMM v2. */
export const EVT_SWAP2_DISC = Uint8Array.of(189, 66, 51, 168, 38, 80, 117, 153);
/** `sha256("event:EvtSwap2WithTransferHook")[0..8]`: DBC, same layout as its EvtSwap2. */
export const DBC_EVT_SWAP2_HOOK_DISC = Uint8Array.of(134, 59, 168, 120, 94, 51, 114, 231);

const PREFIX = 16;
/** Body sizes (bytes after the 16-byte prefix). Longer data is accepted: fields appended later are ignored. */
export const DBC_SWAP2_BODY_LEN = 179;
export const DAMM_SWAP2_BODY_LEN = 180;

/** Offsets in the DBC EvtSwap2 body. */
const DBC = { pool: 0, direction: 64, includedFeeInput: 83, output: 107, nextSqrtPrice: 115, timestamp: 171 } as const;
/** Offsets in the DAMM v2 EvtSwap2 body. */
const DAMM = { pool: 0, direction: 32, includedFeeInput: 52, output: 76, nextSqrtPrice: 84, timestamp: 156 } as const;

export type Venue = "dbc" | "damm";

export interface SwapEvent {
  venue: Venue;
  /** DBC virtual pool or DAMM v2 pool, base58. */
  pool: string;
  /** Quote in, base out (DBC QuoteToBase, DAMM BtoA: base is token A, quote is token B). */
  buy: boolean;
  /** Post-trade Q64.64 sqrt of (quote raw / base raw). */
  nextSqrtPrice: bigint;
  /** Quote raw traded: the input (fee included) on a buy, the output on a sell. */
  quoteVolumeRaw: bigint;
  /** Unix seconds (the program's Clock::unix_timestamp). */
  timestamp: number;
}

function startsWith(data: Uint8Array, prefix: Uint8Array, at = 0): boolean {
  if (data.length < at + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[at + i] !== prefix[i]) return false;
  return true;
}

function decode(data: Uint8Array, venue: Venue, layout: typeof DBC | typeof DAMM, bodyLen: number, discs: Uint8Array[]): SwapEvent | null {
  if (data.length < PREFIX + bodyLen) return null;
  if (!startsWith(data, EVENT_IX_TAG)) return null;
  if (!discs.some((d) => startsWith(data, d, 8))) return null;
  const view = new DataView(data.buffer, data.byteOffset + PREFIX, bodyLen);
  const u64 = (off: number) => view.getBigUint64(off, true);
  const direction = view.getUint8(layout.direction);
  if (direction > 1) return null;
  const buy = direction === 1;
  const nextSqrtPrice = u64(layout.nextSqrtPrice) | (u64(layout.nextSqrtPrice + 8) << 64n);
  // A pool's sqrt price is never zero: such data is not a swap of this layout.
  if (nextSqrtPrice === 0n) return null;
  const timestamp = Number(u64(layout.timestamp));
  return {
    venue,
    pool: new PublicKey(data.subarray(PREFIX + layout.pool, PREFIX + layout.pool + 32)).toBase58(),
    buy,
    nextSqrtPrice,
    quoteVolumeRaw: buy ? u64(layout.includedFeeInput) : u64(layout.output),
    timestamp,
  };
}

/** Decodes a DBC EvtSwap2 / EvtSwap2WithTransferHook event instruction (full data, tag included), else null. */
export function decodeDbcSwapEvent(data: Uint8Array): SwapEvent | null {
  return decode(data, "dbc", DBC, DBC_SWAP2_BODY_LEN, [EVT_SWAP2_DISC, DBC_EVT_SWAP2_HOOK_DISC]);
}

/** Decodes a DAMM v2 EvtSwap2 event instruction (full data, tag included), else null. */
export function decodeDammSwapEvent(data: Uint8Array): SwapEvent | null {
  return decode(data, "damm", DAMM, DAMM_SWAP2_BODY_LEN, [EVT_SWAP2_DISC]);
}

/**
 * Whole quote tokens (unscaled by the ScaledUiAmount multiplier) per whole base token, from a Q64.64 sqrt
 * price. The u128 → double conversion loses ~1e-16 relative precision.
 */
export function sqrtPriceToPrice(sqrtX64: bigint, baseDecimals: number, quoteDecimals: number): number {
  const sqrt = Number(sqrtX64) / 2 ** 64;
  return sqrt * sqrt * 10 ** (baseDecimals - quoteDecimals);
}
