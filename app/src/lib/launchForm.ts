import type { CurvePreset } from "@stockfloor/sdk";
import { VAULT_SHARE_MAX, VAULT_SHARE_MIN } from "./config";

export interface LaunchFormValues {
  name: string;
  symbol: string;
  imageUrl: string;
  quoteSymbol: string;
  preset: CurvePreset;
  vaultSharePct: number;
}

export type LaunchFormErrors = Partial<Record<keyof LaunchFormValues, string>>;

/** Client-side validation of the create form. The SDK and the program validate again. */
export function validateLaunchForm(values: LaunchFormValues): LaunchFormErrors {
  const errors: LaunchFormErrors = {};
  const name = values.name.trim();
  if (name.length === 0) errors.name = "Enter a token name.";
  else if (name.length > 32) errors.name = "Use at most 32 characters.";

  const symbol = values.symbol.trim();
  if (symbol.length === 0) errors.symbol = "Enter a symbol.";
  else if (!/^[A-Z0-9]{2,10}$/.test(symbol.toUpperCase()))
    errors.symbol = "Use 2 to 10 letters or digits.";

  const url = values.imageUrl.trim();
  if (url.length > 0) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") errors.imageUrl = "Use an https:// URL.";
    } catch {
      errors.imageUrl = "Enter a valid URL.";
    }
    if (!errors.imageUrl && url.length > 200) errors.imageUrl = "Use a URL of at most 200 characters.";
  }

  if (
    !Number.isInteger(values.vaultSharePct) ||
    values.vaultSharePct < VAULT_SHARE_MIN ||
    values.vaultSharePct > VAULT_SHARE_MAX
  ) {
    errors.vaultSharePct = `Choose a vault share between ${VAULT_SHARE_MIN}% and ${VAULT_SHARE_MAX}%.`;
  }
  return errors;
}
