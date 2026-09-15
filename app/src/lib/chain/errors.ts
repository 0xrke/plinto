import { LaunchInputError, STOCKFLOOR_IDL, TradeUnavailableError, TransactionFailedError } from "@stockfloor/sdk";

/** An error the app raises with a message that is already written for the user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Messages for Meteora DBC / DAMM v2 and token program failures users actually hit. */
const EXTERNAL_ERRORS: Record<string, string> = {
  ExceededSlippage: "The price moved beyond your slippage limit before the transaction landed. Review the new quote and try again.",
  PoolIsCompleted: "The curve just completed. Trading resumes on DAMM v2 after migration.",
  NotEnoughLiquidity: "The pool does not have enough liquidity for this trade. Try a smaller amount.",
  InsufficientLiquidity: "The pool does not have enough liquidity for this trade. Try a smaller amount.",
  AmountIsZero: "The amount is too small: it rounds down to zero.",
  PoolDisabled: "This pool is disabled.",
};

let programMessages: Map<string, string> | null = null;
function stockfloorMessage(name: string): string | undefined {
  programMessages ??= new Map((STOCKFLOOR_IDL.errors ?? []).map((e) => [e.name, e.msg ?? e.name]));
  return programMessages.get(name);
}

const OVERRIDES: Record<string, string> = {
  NothingToRedeem: "This amount is too small: the redemption would pay nothing.",
  QuoteMintPaused: "The quote asset is paused by its issuer. Redemptions and harvests work again once it resumes.",
  MigrationFeeNotHarvested: "Redemption opens after the migration fee is harvested into the vault. Run the crank first.",
  MigrationNotComplete: "The pool has not migrated to DAMM v2 yet. Run the crank first.",
  InsufficientBaseBalance: "Your token balance is lower than the amount.",
};

function logsText(e: unknown): string {
  const logs = (e as { logs?: unknown })?.logs;
  return Array.isArray(logs) ? logs.join("\n") : "";
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** The user declined the wallet prompt (wallet adapter rejection or EIP-1193 style code 4001). */
export function isWalletRejection(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code ?? (e as { error?: { code?: unknown } })?.error?.code;
  return code === 4001 || /user rejected|rejected the request|user denied|request was declined/.test(messageOf(e).toLowerCase());
}

/**
 * Turn anything thrown by a wallet, the RPC, the SDK or a program into one sentence a user can act
 * on. Unknown failures keep their first line so nothing is hidden.
 */
export function friendlyError(e: unknown): string {
  if (e instanceof UserFacingError) return e.message;
  const name = (e as { name?: string })?.name ?? "";
  const message = messageOf(e);
  const lower = message.toLowerCase();

  if (isWalletRejection(e)) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }
  if (name === "WalletNotConnectedError") return "Connect a wallet to continue.";
  if (name === "WalletSignTransactionError" || name === "WalletSendTransactionError") {
    return `Your wallet could not sign the transaction: ${message || "unknown wallet error"}.`;
  }
  if (e instanceof LaunchInputError) return `Invalid launch parameters: ${message}`;
  if (e instanceof TradeUnavailableError) {
    if (message.includes("NothingToRedeem")) return OVERRIDES.NothingToRedeem!;
    return capitalize(message.trim()) + ".";
  }

  if (e instanceof TransactionFailedError || (e as { errorName?: unknown })?.errorName !== undefined) {
    const errorName = (e as { errorName?: string | null }).errorName ?? null;
    if (errorName) {
      const known = OVERRIDES[errorName] ?? EXTERNAL_ERRORS[errorName] ?? stockfloorMessage(errorName);
      if (known) return known;
    }
  }

  const logs = logsText(e).toLowerCase();
  const all = `${lower}\n${logs}`;
  if (/attempt to debit an account but found no record of a prior credit|insufficient lamports|insufficient funds for fee|insufficientfundsforfee/.test(all)) {
    return "Your wallet does not have enough SOL for fees and rent on this network.";
  }
  if (/insufficient funds|custom program error: 0x1\b/.test(all)) {
    return "Your token balance is too low for this transaction.";
  }
  if (/blockhash not found|block height exceeded|expired/.test(all)) {
    return "The transaction expired before it was confirmed. Try again.";
  }
  if (/failed to fetch|networkerror|econnrefused|fetch failed/.test(all)) {
    return "Could not reach the RPC endpoint. Check that the cluster is running and try again.";
  }
  const first = message.split("\n")[0]?.trim() || "Unknown error";
  return first.endsWith(".") ? first : `${first}.`;
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
