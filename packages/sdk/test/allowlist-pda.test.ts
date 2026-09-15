import {
  deriveTokenBadgeAddress,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID as SDK_DAMM_V2,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  authorityPda,
  DAMM_V2_PROGRAM_ID,
  DBC_PROGRAM_ID,
  DEFAULT_QUOTE_ASSET,
  dbcTokenBadgePda,
  findQuoteAsset,
  isAllowlistedQuoteMint,
  launchPda,
  QUOTE_ALLOWLIST,
  QUOTE_TOKEN_PROGRAM_ID,
  STOCKFLOOR_PROGRAM_ID,
  VAULT_AUTHORITY_SEED,
  vaultAddress,
  vaultAuthorityPda,
} from "../src";

describe("QUOTE_ALLOWLIST", () => {
  it("lists the eight assets in the contract order with SPYx first", () => {
    expect(QUOTE_ALLOWLIST.map((a) => a.symbol)).toEqual([
      "SPYx",
      "QQQx",
      "GLDx",
      "NVDAx",
      "AAPLx",
      "MSFTx",
      "GOOGLx",
      "TSLAx",
    ]);
    expect(DEFAULT_QUOTE_ASSET.symbol).toBe("SPYx");
  });

  it("uses the mints from docs/BRIEF.md §6 and the on-chain decimals", () => {
    const expected: Record<string, string> = {
      SPYx: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
      QQQx: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
      NVDAx: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
      TSLAx: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
      AAPLx: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
      MSFTx: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
      GOOGLx: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
      GLDx: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    };
    for (const asset of QUOTE_ALLOWLIST) {
      expect(asset.mint).toBe(expected[asset.symbol]);
      expect(new PublicKey(asset.mint).toBase58()).toBe(asset.mint);
      expect(asset.decimals).toBe(8);
      expect(asset.name.length).toBeGreaterThan(0);
      expect(asset.underlying.length).toBeGreaterThan(0);
    }
    expect(new Set(QUOTE_ALLOWLIST.map((a) => a.mint)).size).toBe(
      QUOTE_ALLOWLIST.length,
    );
    expect(QUOTE_TOKEN_PROGRAM_ID.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  it("labels index and gold as calm and single stocks as volatile", () => {
    const calm = QUOTE_ALLOWLIST.filter((a) => a.volatility === "calm").map(
      (a) => a.symbol,
    );
    expect(calm).toEqual(["SPYx", "QQQx", "GLDx"]);
    expect(
      QUOTE_ALLOWLIST.filter((a) => a.volatility === "volatile"),
    ).toHaveLength(5);
  });

  it("excludes leveraged and hyper-volatile products", () => {
    expect(findQuoteAsset("TQQQx")).toBeUndefined();
    expect(findQuoteAsset("MSTRx")).toBeUndefined();
  });

  it("finds assets by mint or symbol", () => {
    expect(findQuoteAsset("spyx")?.mint).toBe(DEFAULT_QUOTE_ASSET.mint);
    expect(findQuoteAsset(DEFAULT_QUOTE_ASSET.mint)?.symbol).toBe("SPYx");
    expect(isAllowlistedQuoteMint(DEFAULT_QUOTE_ASSET.mint)).toBe(true);
    expect(
      isAllowlistedQuoteMint(Keypair.generate().publicKey.toBase58()),
    ).toBe(false);
  });
});

describe("program ids and PDAs", () => {
  it("uses the repository program ids and matches the Meteora SDK constants", () => {
    expect(STOCKFLOOR_PROGRAM_ID.toBase58()).toBe(
      "98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA",
    );
    expect(DBC_PROGRAM_ID.toBase58()).toBe(
      "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    );
    expect(DAMM_V2_PROGRAM_ID.toBase58()).toBe(
      "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    );
    expect(DBC_PROGRAM_ID.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)).toBe(true);
    expect(DAMM_V2_PROGRAM_ID.equals(SDK_DAMM_V2)).toBe(true);
  });

  const key = fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .map((b) => new PublicKey(b));

  it("property: launch, claimer (authority) and vault authority PDAs use the documented seeds", () => {
    fc.assert(
      fc.property(key, (config) => {
        const [launch, launchBump] = launchPda(config);
        const [authority, authorityBump] = authorityPda(config);
        const [vaultAuthority, vaultAuthorityBump] = vaultAuthorityPda(config);
        const expLaunch = PublicKey.findProgramAddressSync(
          [Buffer.from("launch"), config.toBuffer()],
          STOCKFLOOR_PROGRAM_ID,
        );
        const expAuthority = PublicKey.findProgramAddressSync(
          [Buffer.from("authority"), config.toBuffer()],
          STOCKFLOOR_PROGRAM_ID,
        );
        const expVaultAuthority = PublicKey.findProgramAddressSync(
          [Buffer.from("vault_authority"), config.toBuffer()],
          STOCKFLOOR_PROGRAM_ID,
        );
        expect(launch.equals(expLaunch[0])).toBe(true);
        expect(launchBump).toBe(expLaunch[1]);
        expect(authority.equals(expAuthority[0])).toBe(true);
        expect(authorityBump).toBe(expAuthority[1]);
        expect(vaultAuthority.equals(expVaultAuthority[0])).toBe(true);
        expect(vaultAuthorityBump).toBe(expVaultAuthority[1]);
        expect(launch.equals(authority)).toBe(false);
        expect(vaultAuthority.equals(authority)).toBe(false);
        expect(vaultAuthority.equals(launch)).toBe(false);
        expect(PublicKey.isOnCurve(authority.toBytes())).toBe(false);
        expect(PublicKey.isOnCurve(vaultAuthority.toBytes())).toBe(false);
      }),
      { numRuns: 50 },
    );
    expect(VAULT_AUTHORITY_SEED).toBe("vault_authority");
  });

  it("vault is the vault authority PDA's associated token account for the quote mint, not the claimer's", () => {
    const config = Keypair.generate().publicKey;
    const quoteMint = new PublicKey(DEFAULT_QUOTE_ASSET.mint);
    const [vaultAuthority] = vaultAuthorityPda(config);
    const [authority] = authorityPda(config);
    const ata = (owner: PublicKey, tokenProgram: PublicKey) =>
      PublicKey.findProgramAddressSync(
        [owner.toBuffer(), tokenProgram.toBuffer(), quoteMint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )[0];
    const expected = ata(vaultAuthority, TOKEN_2022_PROGRAM_ID);
    expect(
      vaultAddress(config, quoteMint, TOKEN_2022_PROGRAM_ID).equals(expected),
    ).toBe(true);
    // the claimer (DBC fee_claimer) never owns the vault
    expect(
      vaultAddress(config, quoteMint, TOKEN_2022_PROGRAM_ID).equals(
        ata(authority, TOKEN_2022_PROGRAM_ID),
      ),
    ).toBe(false);
    // the token program is part of the derivation
    expect(
      vaultAddress(config, quoteMint, TOKEN_PROGRAM_ID).equals(expected),
    ).toBe(false);
  });

  it("token badge PDA matches the DBC SDK", () => {
    const mint = new PublicKey(DEFAULT_QUOTE_ASSET.mint);
    expect(
      dbcTokenBadgePda(mint)[0].equals(deriveTokenBadgeAddress(mint)),
    ).toBe(true);
  });
});
