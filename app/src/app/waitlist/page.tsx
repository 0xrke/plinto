import type { Metadata } from "next";
import { PhaseChart } from "@/components/waitlist/PhaseChart";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { FloorWord } from "@/components/ui/FloorWord";
import { LogoMark } from "@/components/layout/LogoMark";

export const metadata: Metadata = {
  // Absolute: this page stands on its own, without the app's title template behind it.
  title: { absolute: "Plinto — token launches with a floor" },
  description:
    "Token launches with a floor: part of every raise is locked in tokenized stocks and any holder can redeem against it.",
};

const PHASES = [
  {
    n: "01",
    title: "Presale.",
    body: "Everyone pays nearly the same price. No floor yet — but you can sell back into the curve for close to what you paid.",
    value: "SPYx",
    chip: "bg-presale-soft text-presale",
    valueTone: "text-ink",
  },
  {
    n: "02",
    title: "Market opens.",
    body: "Half the raise becomes the floor. The other half becomes liquidity, locked for good.",
    value: "50%",
    chip: "bg-graduating-soft text-graduating",
    valueTone: "text-floor",
  },
  {
    n: "03",
    title: "Trading.",
    body: "The price wanders. The floor creeps up on trading fees and on the 2% left behind by everyone who exits, and never moves down.",
    value: "2%",
    chip: "bg-floor-soft text-floor",
    valueTone: "text-ink",
  },
];

function NetworkPill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`items-center gap-[9px] rounded-[16px] bg-midnight font-semibold text-white ${className}`}
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-mint" />
      <span>
        Solana<span className="hidden min-[360px]:inline"> · Meteora DBC</span>
      </span>
    </span>
  );
}

export default function WaitlistPage() {
  return (
    <div className="min-h-dvh p-3 sm:p-6 lg:p-10">
      <div className="window grid min-h-[calc(100dvh-1.5rem)] rounded-[28px] sm:min-h-[calc(100dvh-3rem)] sm:rounded-[36px] lg:min-h-[max(880px,calc(100dvh-5rem))] lg:rounded-window lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:grid-rows-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_620px]">
        {/* Left: brand, pitch, form */}
        <div className="flex flex-col px-5 pt-5 sm:px-10 sm:pt-8 lg:col-start-1 lg:row-start-1 lg:px-12 lg:pt-[34px] xl:px-[72px]">
          <nav aria-label="Site" className="flex min-h-12 items-center justify-between gap-3">
            <span className="flex items-center gap-[11px] text-ink">
              <LogoMark className="h-[34px] w-[34px] shrink-0 sm:h-[38px] sm:w-[38px]" />
              <span className="font-display text-[24px] font-extrabold leading-none tracking-[-0.03em] sm:text-[28px]">
                plinto
              </span>
            </span>
            <NetworkPill className="flex h-9 px-3.5 text-[12px] lg:hidden" />
          </nav>

          <main className="flex flex-col py-10 sm:py-14 lg:my-auto lg:py-12">
            <h1 className="max-w-[600px] font-display text-[46px] font-extrabold leading-[1.02] tracking-[-0.04em] text-ink sm:text-[64px] sm:leading-none xl:text-[78px]">
              Token launches with a <FloorWord />
            </h1>
            <p className="mt-5 max-w-[540px] text-[16px] leading-[1.6] text-ink-2 sm:mt-[26px] sm:text-[18px]">
              Part of every raise is locked in tokenized stocks the moment the market opens, and any holder can
              burn their tokens for a share of it at any time.
            </p>

            <div className="mt-7 max-w-[540px] sm:mt-8">
              <WaitlistForm />
            </div>

            <p className="mt-[30px] max-w-[540px] border-t border-line pt-4 text-[12.5px] leading-[1.65] text-ink-3">
              It protects from zero, not from loss: the floor is a fixed amount per token, so a buyer far above
              it can still lose most of the purchase. Not available to US persons. Unaudited code.
            </p>
          </main>
        </div>

        {/* Right: lavender column with the phase card */}
        <div className="flex flex-col bg-cloud px-3 py-3 sm:px-8 sm:py-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:px-10 lg:pb-[30px] lg:pt-[34px] xl:px-14">
          <div className="hidden min-h-12 items-center justify-end lg:flex">
            <NetworkPill className="flex h-11 px-[18px] text-[13px]" />
          </div>

          <aside
            aria-labelledby="launch-runs"
            className="overflow-hidden rounded-[24px] bg-surface shadow-card sm:rounded-card lg:my-auto"
          >
            <div className="px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
              <h2
                id="launch-runs"
                className="font-display text-[22px] font-bold tracking-[-0.015em] text-ink sm:text-[25px]"
              >
                How a launch runs
              </h2>
              <p className="mt-1.5 text-[14px] leading-normal text-ink-3">
                Three phases. The floor appears at the second one and only ever moves up.
              </p>
            </div>

            <div className="mx-5 sm:mx-4">
              <PhaseChart />
            </div>

            <ol className="flex flex-col gap-1.5 px-5 pb-5 pt-3 sm:p-3">
              {PHASES.map((phase) => (
                <li
                  key={phase.n}
                  className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 rounded-btn bg-cloud p-3"
                >
                  <span
                    className={`tnum flex h-[26px] items-center justify-center rounded-[9px] text-[12px] font-extrabold ${phase.chip}`}
                  >
                    {phase.n}
                  </span>
                  <span className="text-[13.5px] leading-[1.5] text-ink-2">
                    <b className="font-bold text-ink">{phase.title}</b> {phase.body}
                  </span>
                  <span className={`tnum pt-0.5 text-[14px] font-extrabold ${phase.valueTone}`}>
                    {phase.value}
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        <footer className="bg-cloud px-5 pb-6 pt-2 text-[12.5px] leading-[1.6] text-ink-3 sm:px-10 sm:pb-8 lg:col-start-1 lg:bg-transparent lg:row-start-2 lg:px-12 lg:pb-[30px] lg:pt-0 xl:px-[72px]">
          <p className="max-w-[600px]">
            Floor figures are the defaults of the gentle curve at a 50% vault share. The floor is held in SPYx
            and moves with the S&amp;P 500 in USD.
          </p>
        </footer>
      </div>
    </div>
  );
}
