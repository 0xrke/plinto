import { describe, expect, it } from "vitest";
import { LaunchInputError, TradeUnavailableError, TransactionFailedError } from "@stockfloor/sdk";
import { UserFacingError, friendlyError } from "./errors";

function txError(errorName: string | null, logs: string[] = [], message = "transaction failed") {
  return new TransactionFailedError(message, logs, errorName, errorName ? 6000 : null, "label");
}

describe("friendlyError", () => {
  it("passes user-facing messages through", () => {
    expect(friendlyError(new UserFacingError("Connect a wallet to continue."))).toBe("Connect a wallet to continue.");
  });

  it("explains wallet rejections", () => {
    const rejected = Object.assign(new Error("User rejected the request."), { name: "WalletSignTransactionError" });
    expect(friendlyError(rejected)).toBe("You rejected the request in your wallet. Nothing was sent.");
    expect(friendlyError({ code: 4001, message: "denied" })).toBe("You rejected the request in your wallet. Nothing was sent.");
    const other = Object.assign(new Error("Ledger locked"), { name: "WalletSignTransactionError" });
    expect(friendlyError(other)).toBe("Your wallet could not sign the transaction: Ledger locked.");
  });

  it("maps StockFloor, DBC and DAMM v2 program errors by name", () => {
    expect(friendlyError(txError("NothingToRedeem"))).toBe("This amount is too small: the redemption would pay nothing.");
    expect(friendlyError(txError("QuoteMintPaused"))).toMatch(/paused by its issuer/);
    expect(friendlyError(txError("ExceededSlippage"))).toMatch(/slippage limit/);
    expect(friendlyError(txError("PoolIsCompleted"))).toMatch(/curve just completed/);
    // Any other stockfloor error uses the IDL message.
    expect(friendlyError(txError("VaultEncumbered"))).toMatch(/^Vault token account has a delegate/);
  });

  it("recognizes fee, balance, expiry and network failures from messages and logs", () => {
    expect(friendlyError(txError(null, ["Attempt to debit an account but found no record of a prior credit."]))).toBe(
      "Your wallet does not have enough SOL for fees and rent on this network.",
    );
    expect(friendlyError(txError(null, ["Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x1"]))).toBe(
      "Your token balance is too low for this transaction.",
    );
    expect(friendlyError(new Error("Blockhash not found"))).toBe("The transaction expired before it was confirmed. Try again.");
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/Could not reach the RPC endpoint/);
  });

  it("explains SDK validation errors and keeps the first line of unknown ones", () => {
    expect(friendlyError(new LaunchInputError("vaultSharePct must be an integer in [30, 70]"))).toBe(
      "Invalid launch parameters: vaultSharePct must be an integer in [30, 70]",
    );
    expect(friendlyError(new TradeUnavailableError("redeem opens after migration and the migration-fee harvest (phase: presale)"))).toBe(
      "Redeem opens after migration and the migration-fee harvest (phase: presale).",
    );
    expect(friendlyError(new Error("something odd\nstack line"))).toBe("something odd.");
    expect(friendlyError("plain")).toBe("plain.");
  });
});
