import { describe, expect, it } from "vitest";
import { Fork } from "../src/fork.js";
import { DBC_TOKEN_BADGE_SPYX, SPYX_MINT, SPYX_ONE, TOKEN_2022_PROGRAM_ID } from "../src/constants.js";
import { extensionTypes, fundSpyx, mintSupply, tokenAmount } from "../src/token.js";

describe("fork smoke", () => {
  it("loads fixtures and funds a SPYx ATA via the real ATA + Token-2022 programs", () => {
    const fork = Fork.create();
    const mint = fork.mustGetAccount(SPYX_MINT);
    expect(mint.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(fork.getAccount(DBC_TOKEN_BADGE_SPYX)).not.toBeNull();
    const payer = fork.newWallet();
    const supply0 = mintSupply(fork, SPYX_MINT);
    const ata = fundSpyx(fork, payer, payer.publicKey, 3n * SPYX_ONE);
    expect(tokenAmount(fork, ata)).toBe(3n * SPYX_ONE);
    expect(mintSupply(fork, SPYX_MINT)).toBe(supply0 + 3n * SPYX_ONE);
    console.log("ATA extensions", extensionTypes(fork.mustGetAccount(ata).data), "len", fork.mustGetAccount(ata).data.length);
  });
});
