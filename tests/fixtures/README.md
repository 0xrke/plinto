# Test fixtures: mainnet program binaries and accounts

Everything in `programs/` and `accounts/` is **third-party data dumped verbatim from Solana
mainnet**, not StockFloor code. It exists so the LiteSVM integration suite can run the real
programs offline and deterministically (see README.md, "The fork approach"). It is redistributed
here only as a test fixture: nothing in this directory is executed on a cluster, modified, or
shipped in the app or the SDK.

`dump.ts` re-creates the whole directory from a read-only RPC (`pnpm fixtures`), so a reviewer who
would rather not take our word for it can regenerate the bytes and compare the hashes.

## Programs (`programs/*.so`)

Each file is the program data account of a deployed mainnet program, dumped at the slot recorded in
`manifest.json` together with its loader, programdata address and sha256.

| File | Program id | Bytes | sha256 | What it is |
|---|---|---:|---|---|
| `dynamic_bonding_curve.so` | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | 2,326,577 | `4c26a8a5da99f8ce…` | Meteora Dynamic Bonding Curve (0.2.1 line) |
| `cp_amm.so` | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | 2,174,352 | `4d5b920baebc090f…` | Meteora DAMM v2 (cp-amm 0.2.4), the migration target |
| `spl_token_2022.so` | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | 1,382,016 | `0999dbf708971e72…` | Token-2022 (SPYx: Pausable, ScaledUiAmount, …) |
| `spl_token.so` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | 108,600 | `8190d3f7ceb6cb7a…` | SPL Token (the launched base token) |
| `spl_associated_token_account.so` | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | 105,032 | `6804554e69fd3a58…` | Associated Token Account program |
| `mpl_token_metadata.so` | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | 793,991 | `31f0a627dba051a9…` | Metaplex Token Metadata (DBC CPIs it at pool creation) |

**Licences.** These are upstream artifacts and keep their upstream licences; StockFloor's own
LICENSE does not apply to them.

- Meteora DBC and DAMM v2: **Meteora Non-commercial Licence** (`license.md` in
  [dynamic-bonding-curve](https://github.com/MeteoraAg/dynamic-bonding-curve) and
  [damm-v2](https://github.com/MeteoraAg/damm-v2)).
- SPL Token, Token-2022, Associated Token Account: Apache-2.0
  ([solana-program-library](https://github.com/solana-program)).
- Metaplex Token Metadata: Apache-2.0
  ([metaplex-foundation/mpl-token-metadata](https://github.com/metaplex-foundation/mpl-token-metadata)).

If a rights holder would rather not have their compiled program redistributed here, deleting the
file and running `pnpm fixtures` restores it from the RPC for anyone who wants to run the suite.

## Accounts (`accounts/*.json`)

Mainnet account snapshots the suite needs: the SPYx mint, the DBC and DAMM v2 token badges for
SPYx, the DBC pool authority (migration pays DAMM v2 rent out of it), the DAMM v2 pool authority
and the DAMM v2 migration configs. Addresses, slots and sizes are in `manifest.json`. These are
public on-chain account states, not code.

## Re-dumping

```bash
pnpm fixtures      # read-only RPC; rewrites this directory and manifest.json
```

The suite never writes here at runtime, and no fixture carries a private key.
