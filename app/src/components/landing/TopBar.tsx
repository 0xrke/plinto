import Link from "next/link";
import { Wordmark } from "@/components/layout/LogoMark";
import { ChainPill } from "@/components/waitlist/ChainPill";
import { LANDING_ROUTES } from "@/lib/landing/routes";

export function TopBar() {
  return (
    <nav aria-label="Site, pinned" className="flex h-full min-h-12 items-center justify-between gap-3">
      <Link href={LANDING_ROUTES.home} className="rounded-xl">
        <Wordmark size="md" />
      </Link>
      <div className="flex items-center gap-2.5">
        <ChainPill className="hidden h-10 px-4 text-[13px] sm:flex" />
        <Link href={LANDING_ROUTES.app} className="btn btn-dark">
          Open app
        </Link>
      </div>
    </nav>
  );
}
