import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { labEnabled } from "@/components/landing/variants/gate";
import { findVariant, neighbours, originalOf, VARIANTS } from "@/components/landing/variants/registry";
import { VariantHost } from "@/components/landing/variants/VariantHost";

type Params = { variant: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const v = findVariant((await params).variant);
  return { title: v ? `Lab ${v.n}: ${v.title}` : "Story lab", robots: { index: false, follow: false } };
}

/** One story variant with a slim header: back to the index, prev / next, title. */
export default async function StoryVariantPage({ params }: { params: Promise<Params> }) {
  if (!labEnabled()) notFound();
  const v = findVariant((await params).variant);
  if (!v) notFound();
  // Launch constants come from the SDK on the server (as on the landing); the client gets plain numbers.
  const k = simConstantsFromSdk();
  const m = launchMath(k, k.defaultVaultSharePct);
  const { prev, next } = neighbours(v);
  const original = originalOf(v);
  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2 text-sm">
        <Link href="/lab/story" className="font-semibold text-ink-2 hover:text-ink">
          ← All
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-center font-bold text-ink">
          <span className="tnum text-ink-3">
            {v.n}/{VARIANTS.length}
          </span>{" "}
          {v.title}
        </h1>
        <nav aria-label="Variants" className="flex gap-3">
          {original ? (
            <Link href={`/lab/story/${original.n}`} className="hidden font-semibold text-violet hover:text-violet-hover sm:inline" aria-label={`Original: ${original.title}`}>
              Original
            </Link>
          ) : null}
          <Link href={`/lab/story/${prev.n}`} className="font-semibold text-ink-2 hover:text-ink" aria-label={`Previous: ${prev.title}`}>
            ‹ Prev
          </Link>
          <Link href={`/lab/story/${next.n}`} className="font-semibold text-ink-2 hover:text-ink" aria-label={`Next: ${next.title}`}>
            Next ›
          </Link>
        </nav>
      </header>
      <main id="main" className="w-full">
        <VariantHost slug={v.slug} m={m} />
      </main>
    </>
  );
}
