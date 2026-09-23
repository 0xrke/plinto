import type { Metadata } from "next";
import { PhaseChart } from "@/components/waitlist/PhaseChart";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";

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
  },
  {
    n: "02",
    title: "Market opens.",
    body: "Half the raise becomes the floor. The other half becomes liquidity, locked for good.",
    value: "50%",
  },
  {
    n: "03",
    title: "Trading.",
    body: "The price wanders. The floor creeps up on trading fees and on the 2% left behind by everyone who exits, and never moves down.",
    value: "2%",
  },
];

export default function WaitlistPage() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-surface px-4 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-[55%]"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 100%, var(--color-floor-soft) 0%, transparent 72%)",
        }}
      />

      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 pt-6">
        <span className="flex items-center gap-2.5">
          <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
            <rect width="64" height="64" rx="16" fill="var(--color-ink)" />
            <path
              fill="var(--color-floor)"
              stroke="var(--color-floor)"
              strokeWidth="4"
              strokeLinejoin="round"
              d="M14 50.5h36v-8l-36 4.5z"
            />
            <path
              d="M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1"
              fill="none"
              stroke="var(--color-surface)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-serif text-2xl tracking-tight">plinto</span>
        </span>
        <span className="text-xs text-ink-3">Solana · Meteora DBC</span>
      </nav>

      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 py-8 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
        <section>
          <h1 className="max-w-[13ch] font-serif text-[clamp(2.4rem,5.4vw,3.6rem)] leading-[1.03] tracking-tight">
            Token launches with a <em className="italic">floor</em>
          </h1>
          <p className="mt-4 max-w-[44ch] text-ink-2">
            Part of every raise is locked in tokenized stocks the moment the market opens, and any holder can
            burn their tokens for a share of it at any time.
          </p>

          <div className="mt-6">
            <WaitlistForm />
          </div>

          <p className="mt-7 max-w-[46ch] border-t border-line pt-4 text-[0.72rem] leading-relaxed text-ink-3">
            It protects from zero, not from loss: the floor is a fixed amount per token, so a buyer far above
            it can still lose most of the purchase. Not available to US persons. Unaudited code.
          </p>
        </section>

        <aside className="overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_2px_4px_rgba(19,32,45,.05),0_20px_44px_rgba(19,32,45,.07)]">
          <div className="px-5 pb-3 pt-5">
            <h2 className="font-serif text-[1.35rem] tracking-tight">How a launch runs</h2>
            <p className="mt-1 text-sm text-ink-3">
              Three phases. The floor appears at the second one and only ever moves up.
            </p>
          </div>

          <PhaseChart />

          <div className="flex gap-4 px-5 pb-3 pt-2 text-xs text-ink-3">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-[3px] w-3.5 rounded-sm bg-ink" />
              Price
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-[3px] w-3.5 rounded-sm bg-floor" />
              Floor
            </span>
          </div>

          <ol className="border-t border-line">
            {PHASES.map((phase) => (
              <li
                key={phase.n}
                className="grid grid-cols-[1.6rem_1fr_auto] items-baseline gap-3 border-b border-line px-5 py-3 last:border-b-0"
              >
                <span className="font-mono text-xs text-floor">{phase.n}</span>
                <span className="text-sm text-ink-2">
                  <b className="font-medium text-ink">{phase.title}</b> {phase.body}
                </span>
                <span className="font-mono text-sm tabular-nums text-ink">{phase.value}</span>
              </li>
            ))}
          </ol>
        </aside>
      </main>

      <footer className="mx-auto w-full max-w-5xl pb-5 pt-2 text-[0.72rem] text-ink-3">
        Floor figures are the defaults of the gentle curve at a 50% vault share. The floor is held in SPYx and
        moves with the S&amp;P 500 in USD.
      </footer>
    </div>
  );
}
