const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i] as const));

/**
 * Base58 (Bitcoin alphabet) decoder for instruction data in RPC responses. The app has no direct bs58
 * dependency (it is only transitive), so this small one is used. Returns null on an invalid character.
 */
export function base58Decode(text: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const char of text) {
    let carry = INDEX.get(char);
    if (carry === undefined) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading "1" is a leading zero byte.
  for (let i = 0; i < text.length && text[i] === "1"; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}
