import type { ComponentType } from "react";
import type { VariantProps } from "./types";

/*
 * Lazy client loaders, one per variant slug (each variant is its own chunk). Import only from client
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
};
