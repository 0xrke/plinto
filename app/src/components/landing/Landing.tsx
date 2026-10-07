import type { LaunchDataSource } from "@/lib/data/types";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ClosingCta } from "./ClosingCta";
import { Hero } from "./Hero";
import { LiveFloorsView } from "./LiveFloors";
import { loadLiveFloors } from "./liveFloorsData";
import { LabSection } from "./lab/LabSection";
import { Rules } from "./Rules";
import { TopBar } from "./TopBar";

const CONTAINER = "mx-auto w-full max-w-[1120px] px-5 sm:px-10 lg:px-12";

/**
 * The landing at "/": a plain white page, edge to edge, with the site footer under a hairline. A server component with no
 * wallet, React Query or web3 client code; FloorLab (the split sandbox and the launch story) is the
 * only client island, fed launch constants by the server. Live floors are read
 * on the server, so the page relies on the route's ISR (`revalidate = 60`) and never waits on RPC.
 */
export async function Landing({ source }: { source?: LaunchDataSource } = {}) {
  const live = await loadLiveFloors(source);
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <div className="flex-1">
        <div className={CONTAINER}>
          <TopBar />
        </div>
        <main id="main" className={`${CONTAINER} pb-12 sm:pb-20`}>
          <Hero />
          <LabSection />
          <Rules />
          <LiveFloorsView launches={live} />
          <ClosingCta />
        </main>
      </div>
      <div className="border-t border-line">
        {/* Padding that, added to the footer's own, lines its text up with CONTAINER's. */}
        <div className="mx-auto max-w-[1120px] px-1 sm:px-4 lg:px-2">
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
