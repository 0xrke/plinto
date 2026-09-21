#!/usr/bin/env python3
"""Read-only Meteora DBC inspector (mainnet). Sends no transactions.

Used for docs/research/dbc-launchpad-economics.md: it decodes the DBC configs of other launchpads so their
fee splits can be read from chain instead of from their marketing pages.

RPC: $MAINNET_RPC_URL, else MAINNET_RPC_URL from the repo's .env (never printed), else the public mainnet
RPC. Only getAccountInfo and memcmp-filtered getProgramAccounts.

Usage:
  python3 scripts/research/dbc_inspect.py mint <base_mint>        # find the DBC pool for a token, decode pool + its config
  python3 scripts/research/dbc_inspect.py config <config_addr>    # decode one PoolConfig
  python3 scripts/research/dbc_inspect.py pools <config_addr>     # count pools on a config (+ migrated), list up to 10
  python3 scripts/research/dbc_inspect.py claimer <fee_claimer>   # configs whose fee_claimer == address (count + first 5 decoded)
  python3 scripts/research/dbc_inspect.py creator <creator>       # pools whose creator == address (count)
  python3 scripts/research/dbc_inspect.py claimer-stats <fee_claimer>  # histogram of fee/migration/LP params over ALL configs of a claimer

Offsets: docs/research/dbc-facts.md (PoolConfig, verified against live configs). VirtualPool:
config@72, creator@104, base_mint@136 (SDK filters), is_migrated / reserves decoded best-effort.
"""
import json, os, sys, struct, base64, urllib.request
from pathlib import Path

DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
POOL_CONFIG_SIZE = 1048
VIRTUAL_POOL_SIZE = 424
ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
KNOWN_QUOTES = {
    "So11111111111111111111111111111111111111112": "SOL",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
    "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W": "SPYx",
    "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ": "QQQx",
    "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh": "NVDAx",
    "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB": "TSLAx",
    "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp": "AAPLx",
    "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL": "MET (Meteora)",
}


def b58e(b):
    n = int.from_bytes(b, "big"); out = ""
    while n: n, r = divmod(n, 58); out = ALPH[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def b58d(s):
    n = 0
    for c in s: n = n * 58 + ALPH.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw


def rpc_url():
    if os.environ.get("MAINNET_RPC_URL"):
        return os.environ["MAINNET_RPC_URL"]
    try:
        for line in open(Path(__file__).resolve().parents[2] / ".env"):
            if line.startswith("MAINNET_RPC_URL="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v: return v
    except OSError:
        pass
    return "https://api.mainnet-beta.solana.com"


def call(method, params):
    req = urllib.request.Request(rpc_url(), data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    if "error" in r: raise SystemExit(f"RPC error: {r['error']}")
    return r["result"]


def acct(addr):
    v = call("getAccountInfo", [addr, {"encoding": "base64"}])["value"]
    return None if v is None else (v["owner"], base64.b64decode(v["data"][0]))


def gpa(size, offset, key, slice_len=None):
    cfg = {"encoding": "base64", "filters": [{"dataSize": size}, {"memcmp": {"offset": offset, "bytes": key}}]}
    if slice_len is not None: cfg["dataSlice"] = {"offset": 0, "length": slice_len}
    return call("getProgramAccounts", [DBC, cfg])


def pk(d, o): return b58e(d[o:o + 32])
def u8(d, o): return d[o]
def u16(d, o): return struct.unpack_from("<H", d, o)[0]
def u64(d, o): return struct.unpack_from("<Q", d, o)[0]


def on_curve_hint(addr):
    """Cheap hint only: an account with no data owned by System is a wallet; a PDA usually is not.
    Report the owner so a reader can judge (program-owned token accounts, multisigs...)."""
    a = acct(addr)
    if a is None: return "no account (wallet with 0 SOL or unused PDA)"
    owner, data = a
    return f"owner={owner} data_len={len(data)}"


def mint_decimals(m):
    a = acct(m)
    return None if a is None else a[1][44]


def decode_config(addr, d):
    q = pk(d, 8)
    dec = mint_decimals(q)
    cliff = u64(d, 104)
    thr = u64(d, 264)
    out = {
        "config": addr,
        "quote_mint": q, "quote_symbol": KNOWN_QUOTES.get(q, "?"), "quote_decimals": dec,
        "fee_claimer": pk(d, 40), "leftover_receiver": pk(d, 72),
        "base_fee_cliff_bps": cliff / 1e9 * 1e4,  # FEE_DENOMINATOR = 1e9
        "base_fee_mode": u8(d, 130),  # 0 linear sched, 1 exp sched, 2 rate limiter
        "base_fee_first_factor_num_periods": u16(d, 128),
        "base_fee_second_factor": u64(d, 112), "base_fee_third_factor": u64(d, 120),
        "dynamic_fee_on": u8(d, 136),
        "collect_fee_mode": u8(d, 232),  # 0 quote only, 1 both
        "migration_option": u8(d, 233),  # 0 DAMM v1, 1 DAMM v2
        "token_type": u8(d, 237), "quote_token_flag": u8(d, 238),
        "lp_partner_locked_pct": u8(d, 239), "lp_partner_unlocked_pct": u8(d, 240),
        "lp_creator_locked_pct": u8(d, 241), "lp_creator_unlocked_pct": u8(d, 242),
        "partner_lp_vesting_initialized": u8(d, 184), "creator_lp_vesting_initialized": u8(d, 200),
        "migration_fee_option": u8(d, 243), "fixed_token_supply": u8(d, 244),
        "creator_trading_fee_pct": u8(d, 245),
        "migration_fee_pct": u8(d, 247), "creator_migration_fee_pct": u8(d, 248),
        "migration_quote_threshold_raw": thr,
        "migration_quote_threshold_ui": (thr / 10 ** dec) if dec is not None else None,
        "migrated_collect_fee_mode": u8(d, 360), "migrated_dynamic_fee": u8(d, 361),
        "migrated_pool_fee_bps": u16(d, 362),
        "pool_creation_fee_lamports": u64(d, 368),
        "locked_vesting_amount_per_period": u64(d, 296), "locked_vesting_cliff_unlock": u64(d, 328),
        "post_migration_supply": u64(d, 352),
    }
    out["_notes"] = ("Trading fee split: protocol takes 20% of the fee; of the remaining 80%, creator gets "
                     "creator_trading_fee_pct and partner (fee_claimer) the rest. Migration fee = migration_fee_pct% of "
                     "threshold; creator gets creator_migration_fee_pct% of that fee, partner the rest. "
                     "base_fee_cliff_bps is the starting fee for schedulers (it decays to the final fee).")
    return out


def cmd_config(addr):
    a = acct(addr)
    if not a: raise SystemExit("config not found")
    owner, d = a
    if owner != DBC or len(d) != POOL_CONFIG_SIZE: raise SystemExit(f"not a DBC PoolConfig (owner={owner}, len={len(d)})")
    c = decode_config(addr, d)
    c["fee_claimer_account"] = on_curve_hint(c["fee_claimer"])
    return c


def decode_pool(addr, d):
    return {"pool": addr, "config": pk(d, 72), "creator": pk(d, 104), "base_mint": pk(d, 136)}


def cmd_mint(m):
    res = gpa(VIRTUAL_POOL_SIZE, 136, m)
    if not res: return {"base_mint": m, "dbc_pool": None, "note": "no DBC VirtualPool with this base mint (not a DBC launch, or a transfer-hook pool variant)"}
    r = res[0]; d = base64.b64decode(r["account"]["data"][0])
    p = decode_pool(r["pubkey"], d)
    p["config_decoded"] = cmd_config(p["config"])
    return p


def cmd_pools(cfg):
    res = gpa(VIRTUAL_POOL_SIZE, 72, cfg)
    pools = [decode_pool(r["pubkey"], base64.b64decode(r["account"]["data"][0])) for r in res]
    return {"config": cfg, "pool_count": len(pools), "first_10": pools[:10]}


def cmd_claimer(c):
    res = gpa(POOL_CONFIG_SIZE, 40, c, slice_len=0)
    keys = [r["pubkey"] for r in res]
    return {"fee_claimer": c, "config_count": len(keys), "first_5_decoded": [cmd_config(k) for k in keys[:5]], "all_config_keys_first_50": keys[:50]}


def cmd_creator(c):
    res = gpa(VIRTUAL_POOL_SIZE, 104, c, slice_len=0)
    return {"creator": c, "pool_count": len(res), "first_20": [r["pubkey"] for r in res[:20]]}


def cmd_claimer_stats(c):
    from collections import Counter
    cfg = {"encoding": "base64", "dataSlice": {"offset": 0, "length": 376},
           "filters": [{"dataSize": POOL_CONFIG_SIZE}, {"memcmp": {"offset": 40, "bytes": c}}]}
    res = call("getProgramAccounts", [DBC, cfg])
    h = {k: Counter() for k in ["quote_mint", "base_fee_cliff_bps", "base_fee_mode", "dynamic_fee_on", "collect_fee_mode",
                                "creator_trading_fee_pct", "migration_fee_pct", "creator_migration_fee_pct",
                                "lp_split(pL/pU/cL/cU)", "migrated_pool_fee_bps", "migrated_collect_fee_mode",
                                "pool_creation_fee_sol", "fixed_supply", "leftover_receiver==claimer"]}
    for r in res:
        d = base64.b64decode(r["account"]["data"][0])
        q = pk(d, 8)
        h["quote_mint"][KNOWN_QUOTES.get(q, q)] += 1
        h["base_fee_cliff_bps"][u64(d, 104) / 1e5] += 1
        h["base_fee_mode"][u8(d, 130)] += 1
        h["dynamic_fee_on"][u8(d, 136)] += 1
        h["collect_fee_mode"][u8(d, 232)] += 1
        h["creator_trading_fee_pct"][u8(d, 245)] += 1
        h["migration_fee_pct"][u8(d, 247)] += 1
        h["creator_migration_fee_pct"][u8(d, 248)] += 1
        h["lp_split(pL/pU/cL/cU)"][f"{u8(d,239)}/{u8(d,240)}/{u8(d,241)}/{u8(d,242)}"] += 1
        h["migrated_pool_fee_bps"][u16(d, 362)] += 1
        h["migrated_collect_fee_mode"][u8(d, 360)] += 1
        h["pool_creation_fee_sol"][u64(d, 368) / 1e9] += 1
        h["fixed_supply"][u8(d, 244)] += 1
        h["leftover_receiver==claimer"][pk(d, 72) == c] += 1
    return {"fee_claimer": c, "config_count": len(res),
            "histograms_top15": {k: v.most_common(15) for k, v in h.items()},
            "note": "base_fee_cliff_bps is the starting fee; with base_fee_mode 0/1 and num_periods>0 it decays. "
                    "Protocol takes 20% of every trading fee; creator_trading_fee_pct applies to the remaining 80%."}


if __name__ == "__main__":
    if len(sys.argv) != 3: raise SystemExit(__doc__)
    fn = {"mint": cmd_mint, "config": cmd_config, "pools": cmd_pools, "claimer": cmd_claimer, "creator": cmd_creator, "claimer-stats": cmd_claimer_stats}[sys.argv[1]]
    print(json.dumps(fn(sys.argv[2]), indent=1))
