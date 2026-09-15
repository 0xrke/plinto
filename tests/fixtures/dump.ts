/**
 * Dump mainnet programs and accounts into tests/fixtures/ for the LiteSVM fork harness.
 *
 * Read-only: only getAccountInfo / getSlot RPC calls. Never sends a transaction.
 *
 * Usage: pnpm --filter @stockfloor/tests run fixtures
 * RPC: MAINNET_RPC_URL env var, or the public mainnet endpoint.
 *
 * Output:
 *   tests/fixtures/programs/<name>.so      ELF bytes (programdata minus the 45-byte header for
 *                                          upgradeable programs, raw account data otherwise)
 *   tests/fixtures/accounts/<name>.json    solana-test-validator / Surfpool compatible account JSON
 *   tests/fixtures/manifest.json           addresses, slots, sizes, sha256, purpose
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAMDATA_HEADER = 45;

const DBC = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const DAMM_V2 = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const SPYX = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");

interface ProgramSpec {
  name: string;
  address: string;
  purpose: string;
}

interface AccountSpec {
  name: string;
  address: string;
  purpose: string;
  /** Skip without failing when the account does not exist on mainnet. */
  optional?: boolean;
}

const PROGRAMS: ProgramSpec[] = [
  {
    name: "dynamic_bonding_curve",
    address: DBC.toBase58(),
    purpose: "Meteora DBC (mainnet binary, 0.2.1 line)",
  },
  {
    name: "cp_amm",
    address: DAMM_V2.toBase58(),
    purpose: "Meteora DAMM v2 (migration target)",
  },
  {
    name: "spl_token_2022",
    address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    purpose: "Token-2022 mainnet binary (Pausable / ScaledUiAmount support for SPYx)",
  },
  {
    name: "spl_token",
    address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    purpose: "SPL Token mainnet binary (DBC base token)",
  },
  {
    name: "spl_associated_token_account",
    address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    purpose: "Associated Token Account program mainnet binary",
  },
  {
    name: "mpl_token_metadata",
    address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    purpose: "Metaplex Token Metadata (DBC SPL-token pool creation CPI)",
  },
];

const pda = (seeds: Buffer[], program: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds, program)[0].toBase58();

const ACCOUNTS: AccountSpec[] = [
  { name: "spyx_mint", address: SPYX.toBase58(), purpose: "SPYx mint (Token-2022, 8 decimals)" },
  {
    name: "dbc_token_badge_spyx",
    address: pda([Buffer.from("token_badge"), SPYX.toBuffer()], DBC),
    purpose: "DBC token badge PDA [token_badge, SPYx]; remaining account 0 for create_config / pool init",
  },
  {
    name: "damm_v2_token_badge_spyx",
    address: pda([Buffer.from("token_badge"), SPYX.toBuffer()], DAMM_V2),
    purpose: "DAMM v2 token badge PDA [token_badge, SPYx] (not required by DBC migration configs)",
    optional: true,
  },
  {
    name: "dbc_pool_authority",
    address: pda([Buffer.from("pool_authority")], DBC),
    purpose:
      "DBC pool authority PDA (system account). Mainnet keeps ~1 SOL here: migration_damm_v2 flash-rents from it and fails with 'insufficient lamports' if it is empty",
  },
  {
    name: "damm_v2_pool_authority",
    address: pda([Buffer.from("pool_authority")], DAMM_V2),
    purpose: "DAMM v2 pool authority PDA (system account, for fidelity)",
    optional: true,
  },
  {
    name: "damm_v2_config_customizable",
    address: "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck",
    purpose: "DAMM v2 dynamic config for DBC MigrationFeeOption::Customizable (6); remaining account 0 of migration_damm_v2",
  },
  {
    name: "damm_v2_config_fixed_bps100",
    address: "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp",
    purpose: "DAMM v2 static config for DBC MigrationFeeOption::FixedBps100 (2)",
  },
];

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const programsDir = join(HERE, "programs");
  const accountsDir = join(HERE, "accounts");
  mkdirSync(programsDir, { recursive: true });
  mkdirSync(accountsDir, { recursive: true });

  const manifest: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    rpc: process.env.MAINNET_RPC_URL ? "MAINNET_RPC_URL (redacted)" : RPC,
    programs: [] as unknown[],
    accounts: [] as unknown[],
  };

  for (const spec of PROGRAMS) {
    const programId = new PublicKey(spec.address);
    const { context, value: programAccount } = await connection.getAccountInfoAndContext(programId);
    if (!programAccount) throw new Error(`program ${spec.name} not found`);
    let elf: Buffer;
    let programData: string | null = null;
    let slot = context.slot;
    if (programAccount.owner.equals(BPF_UPGRADEABLE)) {
      // UpgradeableLoaderState::Program { programdata_address } = u32 tag (2) + pubkey
      const pdAddress = new PublicKey(programAccount.data.subarray(4, 36));
      programData = pdAddress.toBase58();
      const res = await connection.getAccountInfoAndContext(pdAddress);
      if (!res.value) throw new Error(`programdata for ${spec.name} not found`);
      slot = res.context.slot;
      elf = res.value.data.subarray(PROGRAMDATA_HEADER);
    } else {
      elf = programAccount.data;
    }
    const file = join(programsDir, `${spec.name}.so`);
    writeFileSync(file, elf);
    (manifest.programs as unknown[]).push({
      name: spec.name,
      address: spec.address,
      loader: programAccount.owner.toBase58(),
      programData,
      file: `programs/${spec.name}.so`,
      size: elf.length,
      sha256: sha256(elf),
      slot,
      purpose: spec.purpose,
    });
    console.log(`program ${spec.name} ${spec.address} ${elf.length} bytes @ slot ${slot}`);
  }

  for (const spec of ACCOUNTS) {
    const { context, value } = await connection.getAccountInfoAndContext(new PublicKey(spec.address));
    if (!value) {
      if (spec.optional) {
        console.log(`account ${spec.name} ${spec.address} does not exist (optional, skipped)`);
        continue;
      }
      throw new Error(`account ${spec.name} ${spec.address} not found`);
    }
    const json = {
      pubkey: spec.address,
      account: {
        lamports: value.lamports,
        data: [value.data.toString("base64"), "base64"],
        owner: value.owner.toBase58(),
        executable: value.executable,
        rentEpoch: 0,
        space: value.data.length,
      },
    };
    writeFileSync(join(accountsDir, `${spec.name}.json`), JSON.stringify(json, null, 2) + "\n");
    (manifest.accounts as unknown[]).push({
      name: spec.name,
      address: spec.address,
      owner: value.owner.toBase58(),
      file: `accounts/${spec.name}.json`,
      size: value.data.length,
      sha256: sha256(value.data),
      slot: context.slot,
      purpose: spec.purpose,
    });
    console.log(`account ${spec.name} ${spec.address} ${value.data.length} bytes @ slot ${context.slot}`);
  }

  writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("wrote manifest.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
