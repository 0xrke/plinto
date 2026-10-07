import Link from "next/link";
import { PageColumns } from "@/components/layout/PageColumns";
import { FloorsNow } from "@/components/home/FloorsNow";
import { LaunchList } from "@/components/launch/LaunchList";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { IconTile } from "@/components/ui/Tiles";
import { ChevronRightIcon, PlusCircleIcon } from "@/components/ui/icons";

const STEPS = [
  {
    title: "Presale on a bonding curve",
    tone: "presale",
    summary: "Pay in a tokenized stock; sell back any time.",
    details:
      "Buyers pay in a tokenized stock such as SPYx, straight into the curve. The flat or gently rising curve fills toward the graduation threshold the creator set. Nobody, not the creator and not us, can take that money out while it fills. On mainnet, USDC and SOL can be routed into that asset through Jupiter first.",
  },
  {
    title: "Graduation",
    tone: "graduating",
    summary: "30–60% of the raise becomes the vault; the rest is locked liquidity.",
    details:
      "The vault share is 30 to 60% of the raise (default 50%); the platform 5% and the creator 5% are paid out, and the rest seeds the pool, whose liquidity is locked permanently. Your cover changes here in one transaction, from close to what you paid down to the floor. Anyone can complete the curve at any time.",
  },
  {
    title: "Free market with a floor",
    tone: "floor",
    summary: "Redeem for your vault share any time; the 2% exit fee stays in.",
    details:
      "Redeeming burns your tokens. 30% of the locked pool's trading fees (after Meteora's share) also go to the vault; the creator gets 50% and the platform 20%. The program has no admin withdraw; the quote issuer's controls and program upgradeability are disclosed on every token page.",
  },
] as const;

function Hero() {
  return (
    <section aria-labelledby="home-title">
      <h1
        id="home-title"
        className="display max-w-[620px] text-[38px] leading-[1.04] text-ink sm:text-[44px] xl:text-[50px] xl:leading-[1.02]"
      >
        Token launches with a stock-backed floor
      </h1>
      <p className="mt-[18px] max-w-[610px] text-base leading-[1.6] text-ink-2 sm:text-[17px]">
        Part of every raise is locked in tokenized stocks. Holders can redeem against it any time.
      </p>
      <div className="mt-[26px] flex flex-wrap gap-3">
        <Link href="/create" className="btn btn-primary px-[26px]">
          <PlusCircleIcon size={18} />
          Launch a token
        </Link>
      </div>
      <p className="mt-[18px] max-w-[640px] text-[13px] leading-[1.55] text-ink-3">
        The floor protects from zero, not from loss.
      </p>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="rail-section below-header mt-8">
      <SectionHeader id="how-heading" title="How it works" />
      <ol aria-label="How it works" className="mt-3 flex flex-col gap-[18px]">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3.5">
            <IconTile tone={step.tone} size={44}>
              {i + 1}
            </IconTile>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold leading-snug text-ink">{step.title}</h3>
              <p className="mt-[3px] text-[13.5px] leading-normal text-ink-2 [text-wrap:pretty]">{step.summary}</p>
              <details className="group mt-1.5 text-[13px] leading-normal text-ink-3">
                <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-violet hover:text-violet-hover [&::-webkit-details-marker]:hidden">
                  Full details
                  <ChevronRightIcon size={13} strokeWidth={2} className="transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-1 [text-wrap:pretty]">{step.details}</p>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function HomePage() {
  return (
    <PageColumns
      railLabel="Top floors and how it works"
      main={
        <>
          <Hero />
          <LaunchList />
        </>
      }
      rail={
        <>
          <FloorsNow />
          <HowItWorks />
        </>
      }
    />
  );
}
