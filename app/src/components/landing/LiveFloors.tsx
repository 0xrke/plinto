import Link from "next/link";
import type { LaunchSummary } from "@/lib/data/types";
import { LaunchCard } from "@/components/launch/LaunchCard";
import { ChevronRightIcon, ExternalIcon } from "@/components/ui/icons";
import { FIRST_VAULT_URL, LANDING_ROUTES, MAINNET_SINCE } from "@/lib/landing/routes";
import styles from "./landing.module.css";

/** Live floors as launch cards, or, with none (or no chain data), the first mainnet vault. */
export function LiveFloorsView({ launches }: { launches: LaunchSummary[] | null }) {
  const live = launches !== null && launches.length > 0;
  return (
    <section aria-labelledby="live-title" className={`py-12 sm:py-20 ${styles.reveal}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="live-title" className="heading text-ink sm:text-[28px]">
          {live ? "Floors live now" : "Live on Solana mainnet"}
        </h2>
        <Link href={LANDING_ROUTES.app} className="link-violet">
          All launches
          <ChevronRightIcon />
        </Link>
      </div>
      {live ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {launches.map((launch) => (
            <LaunchCard key={launch.mint} launch={launch} />
          ))}
        </div>
      ) : (
        <div className="card mt-6 p-5 sm:p-6">
          <p className="text-[16px] font-semibold text-ink">First launch ran on {MAINNET_SINCE}.</p>
          <a href={FIRST_VAULT_URL} target="_blank" rel="noreferrer" className="link-violet">
            See the first vault
            <ExternalIcon />
            <span className="sr-only">(opens in new tab)</span>
          </a>
        </div>
      )}
    </section>
  );
}
