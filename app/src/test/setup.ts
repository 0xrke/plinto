/**
 * Vitest setup for the jsdom environment.
 *
 * jsdom installs its own realm's typed-array constructors as globals, so bytes produced by Node
 * APIs (Buffer, TextEncoder, crypto) fail `instanceof Uint8Array` checks inside @noble/hashes.
 * PDA derivation in @solana/web3.js then throws "Unable to find a viable program address nonce".
 * Browsers have a single realm, so restoring Node's constructor only affects tests.
 */
const NodeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as Uint8ArrayConstructor;
if (globalThis.Uint8Array !== NodeUint8Array) {
  globalThis.Uint8Array = NodeUint8Array;
}
