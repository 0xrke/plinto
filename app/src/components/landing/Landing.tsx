import type { LaunchDataSource } from "@/lib/data/types";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ClosingCta } from "./ClosingCta";
import { HERO_NAV_ID, Hero } from "./Hero";
import { LiveFloorsView } from "./LiveFloors";
import { loadLiveFloors } from "./liveFloorsData";
import { LabSection } from "./lab/LabSection";
import { PinnedHeader } from "./PinnedHeader";
import { TopBar } from "./TopBar";
import styles from "./landing.module.css";

const CONTAINER = "mx-auto w-full max-w-[1120px] px-5 sm:px-10 lg:px-12";

/**
 * The landing at "/": a plain white page, edge to edge, opening on /waitlist's layout (Hero), with the
 * site footer under a hairline. A server component with no wallet, React Query or
 * web3 client code; FloorLab (the launch story) is the main client island, fed launch constants by
 * the server, beside the pinned header's reveal observer. Live floors are read on the server, so the
 * page relies on the route's ISR (`revalidate = 60`) and never waits on RPC.
 */
export async function Landing({ source }: { source?: LaunchDataSource } = {}) {
  const live = await loadLiveFloors(source);
  return (
    <div className={`${styles.page} flex min-h-dvh flex-col bg-surface`}>
      <PinnedHeader watch={HERO_NAV_ID} className={styles.header}>
        {/* The hero's frame and nav padding, so the logo and Open app stay put as the header slides in. */}
        <div className="h-full px-3 sm:px-6 lg:px-10">
          <div className="mx-auto h-full max-w-[1440px] px-2 sm:px-4 lg:pl-2 lg:pr-0 xl:pl-8">
            <TopBar />
          </div>
        </div>
      </PinnedHeader>
      <main id="main" className="flex-1 pb-12 sm:pb-20">
        <Hero />
        <div className={CONTAINER}>
          <LabSection />
          <LiveFloorsView launches={live} />
          <ClosingCta />
        </div>
      </main>
      <div className="border-t border-line">
        {/* Padding that, added to the footer's own, lines its text up with CONTAINER's. */}
        <div className="mx-auto max-w-[1120px] px-1 sm:px-4 lg:px-2">
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
