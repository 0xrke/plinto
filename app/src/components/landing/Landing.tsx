import type { LaunchDataSource } from "@/lib/data/types";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ClosingCta } from "./ClosingCta";
import { Hero } from "./Hero";
import { LiveFloorsView } from "./LiveFloors";
import { loadLiveFloors } from "./liveFloorsData";
import { NoOneCan } from "./NoOneCan";
import { RaiseSplit } from "./RaiseSplit";
import { TopBar } from "./TopBar";
import { WorstCase } from "./WorstCase";

const CONTAINER = "mx-auto w-full max-w-[1120px] px-5 sm:px-10 lg:px-12";

/**
 * The landing at "/": one white window on the wash, then the site footer. A server component with no
 * wallet, React Query or web3 client code; PhaseChart is the only client island. Live floors are read
 * on the server, so the page relies on the route's ISR (`revalidate = 60`) and never waits on RPC.
 */
export async function Landing({ source }: { source?: LaunchDataSource } = {}) {
  const live = await loadLiveFloors(source);
  return (
    <div className="min-h-dvh p-3 sm:p-6 lg:p-10">
      <div className="window rounded-[28px] sm:rounded-[36px] lg:rounded-window">
        <div className={CONTAINER}>
          <TopBar />
        </div>
        <main id="main" className={`${CONTAINER} pb-12 sm:pb-20`}>
          <Hero />
          <RaiseSplit />
          <NoOneCan />
          <WorstCase />
          <LiveFloorsView launches={live} />
          <ClosingCta />
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
