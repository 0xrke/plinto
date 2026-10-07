import Link from "next/link";
import { FloorWord } from "@/components/ui/FloorWord";
import { PlusCircleIcon } from "@/components/ui/icons";
import { LANDING_ROUTES } from "@/lib/landing/routes";

/** No scroll reveal: the h1 is the LCP. One column; the floor lab right below carries the visuals. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pt-10 pb-2 sm:pt-12">
      <div>
        <h1
          id="hero-title"
          className="display max-w-[600px] text-[46px] tracking-[-0.04em] text-ink sm:text-[64px] xl:text-[78px]"
        >
          Token launches with a <FloorWord />
        </h1>
        <p className="mt-5 max-w-[540px] text-[16px] leading-[1.6] text-ink-2 sm:mt-6 sm:text-[18px]">
          Part of every raise is locked in tokenized stocks. Holders redeem against it once the market opens.
        </p>
        <div className="mt-7 grid gap-3 sm:flex">
          <Link href={LANDING_ROUTES.app} className="btn btn-primary w-full sm:w-auto">
            Open app
          </Link>
          <Link href={LANDING_ROUTES.create} className="btn btn-secondary w-full sm:w-auto">
            <PlusCircleIcon size={18} />
            Launch a token
          </Link>
        </div>
        <p className="mt-6 max-w-[540px] border-t border-line pt-4 text-[13px] text-ink-3">
          The floor protects from zero, not from loss.
        </p>
      </div>
    </section>
  );
}
