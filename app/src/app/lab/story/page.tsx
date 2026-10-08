import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { labEnabled } from "@/components/landing/variants/gate";
import { VARIANTS, variantDir } from "@/components/landing/variants/registry";

export const metadata: Metadata = {
  title: "Story lab",
  robots: { index: false, follow: false },
};

/** Dev-only index of the ten "Follow your $100" variants (see components/landing/variants). */
export default function StoryLabIndex() {
  if (!labEnabled()) notFound();
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <p className="eyebrow">Lab</p>
      <h1 className="display mt-1 text-3xl text-ink sm:text-4xl">Follow your $100: ten variants</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">
        Same eight beats, captions and fee math; different visual treatments. Scroll each one top to bottom and back.
      </p>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2">
        {VARIANTS.map((v) => (
          <li key={v.slug}>
            <Link
              href={`/lab/story/${v.n}`}
              className="flex h-full flex-col gap-1 rounded-2xl border border-line-strong bg-surface p-4 hover:border-violet focus-visible:outline-2 focus-visible:outline-violet"
            >
              <span className="text-xs font-semibold text-ink-3 tnum">
                {String(v.n).padStart(2, "0")} · {variantDir(v)}
              </span>
              <span className="text-lg font-bold text-ink">{v.title}</span>
              <span className="text-sm leading-snug text-ink-2">{v.description}</span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
