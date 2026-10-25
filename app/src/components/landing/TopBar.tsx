import Link from "next/link";
import { Wordmark } from "@/components/layout/LogoMark";
import { LANDING_ROUTES } from "@/lib/landing/routes";

/** The waitlist's midnight network pill, local to the landing. */
function ChainPill() {
  return (
    <span className="hidden h-11 items-center gap-[9px] rounded-[16px] bg-midnight px-[18px] text-[13px] font-semibold text-white sm:flex">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-mint" />
      <span>Solana · Meteora DBC</span>
    </span>
  );
}

export function TopBar() {
  return (
    <nav aria-label="Site" className="flex h-full min-h-12 items-center justify-between gap-3">
      <Link href={LANDING_ROUTES.home} className="rounded-xl">
        <Wordmark size="md" />
      </Link>
      <div className="flex items-center gap-3">
        <ChainPill />
        <Link href={LANDING_ROUTES.app} className="btn btn-dark btn-sm min-h-11">
          Open app
        </Link>
      </div>
    </nav>
  );
}
