import type { ComponentType } from "react";
import type { VariantProps } from "./types";

/*
 * Lazy client loaders, one per variant slug (originals 1–10, site-style 11–20, combos 21–28) (each variant is its own chunk). Import only from client
 * code (VariantHost). Keys must match registry.ts (registry.test.ts checks).
 */

type Loader = () => Promise<{ default: ComponentType<VariantProps> }>;

export const VARIANT_LOADERS: Readonly<Record<string, Loader>> = {
  "editorial": () => import("./v01-editorial/Variant"),
  "trading-desk": () => import("./v02-trading-desk/Variant"),
  "cinematic": () => import("./v03-cinematic/Variant"),
  "card-stack": () => import("./v04-card-stack/Variant"),
  "blocks": () => import("./v05-blocks/Variant"),
  "reservoir": () => import("./v06-reservoir/Variant"),
  "swiss-mono": () => import("./v07-swiss-mono/Variant"),
  "cause-effect": () => import("./v08-cause-effect/Variant"),
  "horizontal-tape": () => import("./v09-horizontal-tape/Variant"),
  "playful": () => import("./v10-playful/Variant"),
  "editorial-site": () => import("./v11-editorial-site/Variant"),
  "trading-desk-site": () => import("./v12-trading-desk-site/Variant"),
  "cinematic-site": () => import("./v13-cinematic-site/Variant"),
  "card-stack-site": () => import("./v14-card-stack-site/Variant"),
  "blocks-site": () => import("./v15-blocks-site/Variant"),
  "reservoir-site": () => import("./v16-reservoir-site/Variant"),
  "swiss-mono-site": () => import("./v17-swiss-mono-site/Variant"),
  "cause-effect-site": () => import("./v18-cause-effect-site/Variant"),
  "horizontal-tape-site": () => import("./v19-horizontal-tape-site/Variant"),
  "playful-site": () => import("./v20-playful-site/Variant"),
  "editorial-plus": () => import("./v21-editorial-plus/Variant"),
  "editorial-ledger": () => import("./v22-editorial-ledger/Variant"),
  "clean-steps": () => import("./v23-clean-steps/Variant"),
  "cinematic-clean": () => import("./v24-cinematic-clean/Variant"),
  "one-panel": () => import("./v25-one-panel/Variant"),
  "blocks-clean": () => import("./v26-blocks-clean/Variant"),
  "tape-fixed": () => import("./v27-tape-fixed/Variant"),
  "editorial-panel": () => import("./v28-editorial-panel/Variant"),
};
