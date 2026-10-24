import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { labEnabled } from "@/components/landing/variants/gate";
import { VARIANTS, originalOf, restyleOf, variantDir, variantGroup, type VariantMeta } from "@/components/landing/variants/registry";

export const metadata: Metadata = {
  title: "Story lab",
  robots: { index: false, follow: false },
};

const num = (n: number) => String(n).padStart(2, "0");

/**
 * One variant card. The title link is stretched over the whole card; the "based on" / "restyled as"
 * link sits above it (z-10), so the two links never nest.
 */
function VariantCard({ v }: { v: VariantMeta }) {
  const mixes = v.mixes ?? [];
  const original = originalOf(v);
  const restyle = restyleOf(v);
  const related = original
    ? { href: `/lab/story/${original.n}`, text: `Based on ${num(original.n)} · ${original.title}` }
    : restyle
      ? { href: `/lab/story/${restyle.n}`, text: `Site style: ${num(restyle.n)}` }
      : null;
  return (
    <li className="relative flex h-full flex-col gap-1 rounded-2xl border border-line-strong bg-surface p-4 focus-within:border-violet hover:border-violet">
      <span className="text-xs font-semibold text-ink-3 tnum">
        {num(v.n)} · {variantDir(v)}
      </span>
      <Link
        href={`/lab/story/${v.n}`}
        className="text-lg font-bold text-ink after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none"
      >
        {v.title}
      </Link>
      <span className="text-sm leading-snug text-ink-2">{v.description}</span>
      {mixes.length ? (
        <span className="relative z-10 mt-1 flex flex-wrap gap-x-3 text-sm">
          <span className="text-ink-3">Mixes</span>
          {mixes.map((n) => (
            <Link key={n} href={`/lab/story/${n}`} className="link tnum">
              {num(n)}
            </Link>
          ))}
        </span>
      ) : null}
      {related ? (
        <Link href={related.href} className="link relative z-10 mt-1 self-start text-sm">
          {related.text}
        </Link>
      ) : null}
    </li>
  );
}

function Section({ id, title, intro, items }: { id: string; title: string; intro: string; items: readonly VariantMeta[] }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="heading text-ink">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">{intro}</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((v) => (
          <VariantCard key={v.slug} v={v} />
        ))}
      </ol>
    </section>
  );
}

/** Dev-only index of the "Follow your $100" variants (see components/landing/variants). */
export default function StoryLabIndex() {
  if (!labEnabled()) notFound();
  const originals = VARIANTS.filter((v) => variantGroup(v) === "original");
  const site = VARIANTS.filter((v) => variantGroup(v) === "site");
  const combos = VARIANTS.filter((v) => variantGroup(v) === "combo");
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <p className="eyebrow">Lab</p>
      <h1 className="display mt-1 text-3xl text-ink sm:text-4xl">Follow your $100: {VARIANTS.length} variants</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">
        Same eight beats, captions and fee math; different visual treatments. Scroll each one top to bottom and back.
      </p>
      <Section id="lab-combos" title="Combined from the review" intro="New treatments that mix the favourites: the editorial chart, the vault ledger, the clean steps, and the vertical split column of 1 and 3." items={combos} />
      <Section id="lab-originals" title="Originals" intro="The first ten treatments, each in its own visual language." items={originals} />
      <Section id="lab-site" title="In site style" intro="Each original's idea, composition and motion, rebuilt to look like the rest of Plinto." items={site} />
    </main>
  );
}
