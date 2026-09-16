import Link from "next/link";
import { LaunchList } from "@/components/launch/LaunchList";

const STEPS = [
  {
    title: "Presale on a bonding curve",
    body: "Buyers pay in a tokenized stock such as SPYx, straight into the curve. The flat or gently rising curve fills toward the graduation threshold the creator set. On mainnet, USDC and SOL can be routed into that asset through Jupiter first.",
  },
  {
    title: "Graduation",
    body: "A fixed share of the raise (30 to 70%, default 50%) moves into the token's vault. The rest seeds a Meteora DAMM v2 pool with permanently locked liquidity.",
  },
  {
    title: "Free market with a floor",
    body: "Any holder can burn tokens for a pro-rata share of the vault at any time, minus a 2% exit fee that stays in the vault. The program has no admin withdraw; the quote issuer's controls and program upgradeability are disclosed on every token page.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow">Launchpad on Meteora DBC</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]">
            Token launches with a floor in tokenized S&amp;P&nbsp;500
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-2 sm:text-lg">
            A large share of every raise becomes a redeemable vault in stocks the moment the market opens. The
            token can go up without limit, and while the vault holds its stock token, it cannot fall to zero.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="#launches" className="btn btn-primary">
              Explore launches
            </Link>
            <Link href="/create" className="btn btn-secondary">
              Launch a token
            </Link>
          </div>
          <p className="mt-4 max-w-xl text-sm text-ink-3">
            The floor protects from zero, not from loss. Buying far above the floor can still lose most of the
            purchase. Every token page shows the maximum loss before you buy.
          </p>
        </div>
        <ol className="card divide-y divide-line" aria-label="How it works">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 p-5">
              <span
                aria-hidden
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  i === 2 ? "bg-floor text-white" : "bg-brand-soft text-brand"
                }`}
              >
                {i + 1}
              </span>
              <div>
                <h2 className="font-semibold text-ink">{step.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <LaunchList />
    </div>
  );
}
