import Link from "next/link";
import { Wordmark } from "@/components/layout/LogoMark";
import { FloorWord } from "@/components/ui/FloorWord";
import { PlusCircleIcon } from "@/components/ui/icons";
import { ChainPill } from "@/components/waitlist/ChainPill";
import { LaunchRunsCard } from "@/components/waitlist/LaunchRunsCard";
import { LANDING_ROUTES } from "@/lib/landing/routes";

/** The hero's nav: the pinned header stays hidden while it is on screen (PinnedHeader watches it). */
export const HERO_NAV_ID = "hero-nav";

/**
 * The first screen: /waitlist's layout and copy on the white page, with the app's two actions in
 * place of the email form. Everything sits on white: no window card, no lavender column; the phase card
 * carries a hairline so it reads on white. On lg+ it fills the viewport
 * (never clipping: it grows with its content). No scroll reveal: the h1 is the LCP.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="p-3 sm:p-6 lg:p-10">
      <div className="mx-auto grid max-w-[1440px] lg:min-h-[calc(100svh-5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:grid-rows-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_520px]">
        {/* Left: brand, pitch, actions */}
        <div className="flex flex-col px-2 pt-2 sm:px-4 sm:pt-2 lg:col-start-1 lg:row-start-1 lg:pl-2 lg:pr-12 lg:pt-[34px] xl:pl-8 xl:pr-16">
          <nav id={HERO_NAV_ID} aria-label="Site" className="flex min-h-12 items-center justify-between gap-3">
            <Wordmark size="lg" />
            <div className="flex items-center gap-2.5 lg:hidden">
              <ChainPill className="flex h-9 px-3.5 text-[12px]" />
              <Link href={LANDING_ROUTES.app} className="btn btn-dark btn-sm hidden sm:inline-flex">
                Open app
              </Link>
            </div>
          </nav>

          <div className="flex flex-col py-10 sm:py-14 lg:my-auto lg:py-12">
            <h1
              id="hero-title"
              className="max-w-[600px] font-display text-[46px] font-extrabold leading-[1.02] tracking-[-0.04em] text-ink sm:text-[64px] sm:leading-none xl:text-[78px]"
            >
              Token launches with a <FloorWord />
            </h1>
            <p className="mt-5 max-w-[540px] text-[16px] leading-[1.6] text-ink-2 sm:mt-[26px] sm:text-[18px]">
              Part of every raise is locked in tokenized stocks. Holders redeem against it once the market opens.
            </p>

            <div className="mt-7 grid gap-3 sm:mt-8 sm:flex">
              <Link href={LANDING_ROUTES.app} className="btn btn-primary btn-lg w-full sm:w-auto">
                Open app
              </Link>
              <Link href={LANDING_ROUTES.create} className="btn btn-secondary btn-lg w-full sm:w-auto">
                <PlusCircleIcon size={18} />
                Launch a token
              </Link>
            </div>

            <p className="mt-[30px] max-w-[540px] border-t border-line pt-4 text-[12.5px] leading-[1.65] text-ink-3">
              Protects from zero, not from loss. Not for US persons. Unaudited.
            </p>
          </div>
        </div>

        {/* Right: the phase card on white, the network pill and Open app above it */}
        <div className="flex flex-col px-0 pb-2 sm:px-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:px-0 lg:pb-[30px] lg:pt-[34px]">
          <div className="hidden min-h-12 items-center justify-end gap-2.5 lg:flex">
            <ChainPill className="flex h-9 px-4 text-[12.5px]" />
            <Link href={LANDING_ROUTES.app} className="btn btn-dark btn-sm">
              Open app
            </Link>
          </div>

          <LaunchRunsCard className="border border-line lg:my-auto" />
        </div>

        <div className="px-2 pt-4 text-[12.5px] leading-[1.6] text-ink-3 sm:px-4 lg:col-start-1 lg:row-start-2 lg:pl-2 lg:pr-12 lg:pb-[30px] lg:pt-0 xl:pl-8 xl:pr-16">
          <p className="max-w-[600px]">Example figures: 50% floor share.</p>
        </div>
      </div>
    </section>
  );
}
