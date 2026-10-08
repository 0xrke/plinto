"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { VARIANT_LOADERS } from "./loaders";
import type { VariantProps } from "./types";

/** One lazily loaded component per slug, created once at module level (next/dynamic requirement). */
const COMPONENTS: Readonly<Record<string, ComponentType<VariantProps>>> = Object.fromEntries(
  Object.entries(VARIANT_LOADERS).map(([slug, load]) => [
    slug,
    dynamic(load, { loading: () => <p className="px-4 py-10 text-sm text-ink-3">Loading variant…</p> }),
  ]),
);

/** Renders the variant `slug` with the server-computed launch math. */
export function VariantHost({ slug, m }: { slug: string; m: LaunchMath }) {
  const Variant = COMPONENTS[slug];
  if (!Variant) return <p className="px-4 py-10 text-sm text-ink-3">Unknown variant: {slug}</p>;
  return <Variant m={m} />;
}
