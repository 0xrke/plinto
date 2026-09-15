import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { STOCKFLOOR_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@stockfloor/sdk";
import { FakeReader, account } from "../../test/chainFixtures";
import { BPF_UPGRADEABLE_LOADER_ID, readUpgradeStatus } from "./upgradeAuthority";

function programAccount(programData: PublicKey): Uint8Array {
  const data = new Uint8Array(36);
  new DataView(data.buffer).setUint32(0, 2, true);
  data.set(programData.toBytes(), 4);
  return data;
}

function programDataAccount(authority: PublicKey | null): Uint8Array {
  const data = new Uint8Array(45 + 16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 3, true);
  view.setBigUint64(4, 447_000_000n, true);
  if (authority) {
    data[12] = 1;
    data.set(authority.toBytes(), 13);
  }
  return data;
}

describe("readUpgradeStatus", () => {
  it("reads the upgrade authority from the ProgramData account", async () => {
    const reader = new FakeReader();
    const programData = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    reader.set(STOCKFLOOR_PROGRAM_ID, account(programAccount(programData), BPF_UPGRADEABLE_LOADER_ID));
    reader.set(programData, account(programDataAccount(authority), BPF_UPGRADEABLE_LOADER_ID));
    expect(await readUpgradeStatus(reader, STOCKFLOOR_PROGRAM_ID)).toEqual({ status: "upgradeable", authority: authority.toBase58(), programData: programData.toBase58() });

    reader.set(programData, account(programDataAccount(null), BPF_UPGRADEABLE_LOADER_ID));
    expect(await readUpgradeStatus(reader, STOCKFLOOR_PROGRAM_ID)).toEqual({ status: "immutable", programData: programData.toBase58() });
  });

  it("reports unknown when the program is missing or the layout is unexpected, and immutable for other loaders", async () => {
    const reader = new FakeReader();
    expect(await readUpgradeStatus(reader, STOCKFLOOR_PROGRAM_ID)).toMatchObject({ status: "unknown" });
    reader.set(STOCKFLOOR_PROGRAM_ID, account(new Uint8Array(8), BPF_UPGRADEABLE_LOADER_ID));
    expect(await readUpgradeStatus(reader, STOCKFLOOR_PROGRAM_ID)).toMatchObject({ status: "unknown" });
    reader.set(STOCKFLOOR_PROGRAM_ID, account(new Uint8Array(36), TOKEN_PROGRAM_ID));
    expect(await readUpgradeStatus(reader, STOCKFLOOR_PROGRAM_ID)).toEqual({ status: "immutable", programData: null });
  });
});
