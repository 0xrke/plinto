import type { Metadata } from "next";
import { ChainPill } from "@/components/waitlist/ChainPill";
import { LaunchRunsCard } from "@/components/waitlist/LaunchRunsCard";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { FloorWord } from "@/components/ui/FloorWord";
import { LogoMark } from "@/components/layout/LogoMark";

export const metadata: Metadata = {
  // Absolute: this page stands on its own, without the app's title template behind it.
  title: { absolute: "Plinto · Join the waitlist" },
  description:
    "Token launches with a floor: part of every raise is locked in tokenized stocks and any holder can redeem against it.",
};

export default function WaitlistPage() {
  return (
    <div className="min-h-dvh p-3 sm:p-6 lg:p-10">
      <div className="window grid min-h-[calc(100dvh-1.5rem)] rounded-[28px] sm:min-h-[calc(100dvh-3rem)] sm:rounded-[36px] lg:min-h-[max(880px,calc(100dvh-5rem))] lg:rounded-window lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:grid-rows-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_620px]">
        {/* Left: brand, pitch, form */}
        <div className="flex flex-col px-5 pt-5 sm:px-10 sm:pt-8 lg:col-start-1 lg:row-start-1 lg:px-12 lg:pt-[34px] xl:px-[72px]">
          <nav aria-label="Site" className="flex min-h-12 items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-ink">
              <LogoMark className="h-[34px] w-[34px] shrink-0 sm:h-[38px] sm:w-[38px]" />
              <span className="font-display text-[24px] font-extrabold leading-none tracking-[-0.03em] sm:text-[28px]">
                plinto
              </span>
            </span>
            <ChainPill className="flex h-[42px] px-3.5 text-[12px] lg:hidden" />
          </nav>

          <main id="main" className="flex flex-col py-10 sm:py-14 lg:my-auto lg:py-12">
            <h1 className="max-w-[600px] font-display text-[46px] font-extrabold leading-[1.02] tracking-[-0.04em] text-ink sm:text-[64px] sm:leading-none xl:text-[78px]">
              Token launches with a <FloorWord />
            </h1>
            <p className="mt-5 max-w-[540px] text-[16px] leading-[1.6] text-ink-2 sm:mt-[26px] sm:text-[18px]">
              Part of every raise is locked in tokenized stocks — any holder can redeem against it.
            </p>

            <div className="mt-7 max-w-[540px] sm:mt-8">
              <WaitlistForm />
            </div>

            <p className="mt-[30px] max-w-[540px] border-t border-line pt-4 text-[12.5px] leading-[1.65] text-ink-3">
              Protects from zero, not from loss. Not for US persons. Unaudited.
            </p>
          </main>
        </div>

        {/* Right: lavender column with the phase card */}
        <div className="flex flex-col bg-cloud px-3 py-3 sm:px-8 sm:py-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:px-10 lg:pb-[30px] lg:pt-[34px] xl:px-14">
          <div className="hidden min-h-12 items-center justify-end lg:flex">
            <ChainPill className="flex h-[42px] px-4 text-[13px]" />
          </div>

          <LaunchRunsCard className="lg:my-auto" />
        </div>

        <footer className="bg-cloud px-5 pb-6 pt-2 text-[12.5px] leading-[1.6] text-ink-3 sm:px-10 sm:pb-8 lg:col-start-1 lg:bg-transparent lg:row-start-2 lg:px-12 lg:pb-[30px] lg:pt-0 xl:px-[72px]">
          <p className="max-w-[600px]">
            Example figures: 50% floor share.
          </p>
        </footer>
      </div>
    </div>
  );
}
