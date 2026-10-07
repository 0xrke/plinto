/** Where the landing page links: the app lives under /app (docs/DECISIONS.md, 2026-10-07). */
export const LANDING_ROUTES = {
  home: "/",
  app: "/app",
  create: "/app/create",
} as const;

/** The first mainnet floor vault (SFDEMO, phase `redeemable`), from README "On mainnet". */
export const FIRST_VAULT_URL = "https://solscan.io/account/8Y6vZa3zJJNFjvADg3pEGeDAUg6WcufECWohvzmEDmZr";
/** The date of that first mainnet launch, as the landing prints it (README "On mainnet": 2026-09-16). */
export const MAINNET_SINCE = "Sept 16, 2026";
