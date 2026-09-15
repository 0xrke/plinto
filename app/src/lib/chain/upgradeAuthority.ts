import { PublicKey } from "@solana/web3.js";
import type { ChainReader } from "@stockfloor/sdk";

/** BPF upgradeable loader, the owner of upgradeable program accounts. */
export const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/**
 * Whether a program can still be upgraded, read from chain:
 * - upgradeable: the ProgramData account names an upgrade authority, which can replace the code.
 * - immutable: the upgrade authority is revoked (None), or the program is not owned by the upgradeable loader.
 * - unknown: not read (mock data), not deployed on this cluster, or unreadable.
 */
export type UpgradeStatus =
  | { status: "upgradeable"; authority: string; programData: string }
  | { status: "immutable"; programData: string | null }
  | { status: "unknown"; reason: string };

function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

/**
 * Loader state layout (bincode): Program = tag 2 + programdata pubkey; ProgramData = tag 3 + slot u64 +
 * Option<Pubkey> (1 byte + 32).
 */
export async function readUpgradeStatus(reader: ChainReader, programId: PublicKey): Promise<UpgradeStatus> {
  const program = await reader.getAccountInfo(programId);
  if (!program) return { status: "unknown", reason: "the program is not deployed on this cluster" };
  if (!program.owner.equals(BPF_UPGRADEABLE_LOADER_ID)) return { status: "immutable", programData: null };
  if (program.data.length < 36 || u32(program.data, 0) !== 2) return { status: "unknown", reason: "unexpected program account layout" };
  const programData = new PublicKey(program.data.subarray(4, 36));
  const pd = await reader.getAccountInfo(programData);
  if (!pd || pd.data.length < 13 || u32(pd.data, 0) !== 3) return { status: "unknown", reason: "program data account not readable" };
  if (pd.data[12] === 0) return { status: "immutable", programData: programData.toBase58() };
  if (pd.data.length < 45) return { status: "unknown", reason: "unexpected program data layout" };
  return { status: "upgradeable", authority: new PublicKey(pd.data.subarray(13, 45)).toBase58(), programData: programData.toBase58() };
}
