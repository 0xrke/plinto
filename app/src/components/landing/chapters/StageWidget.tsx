import type { LaunchMath } from "@/lib/landing/sim/launch";
import { STAGES, netFlowAt, type StoryFrame } from "@/lib/landing/sim/story";
import { formatUsdWhole } from "@/lib/landing/sim/format";
import { PRESALE_FILL } from "@/components/ui/presaleFill";
import { RedeemBar } from "../lab/RedeemBar";
import { SplitBar } from "../lab/SplitBar";
import { redeemCents } from "../lab/storyCopy";

/**
 * The per-stage readout of "Follow your $100", copied out of LaunchStory: the raise counter, the
 * split bar, net buying or selling, the redeem bar. Pure function of (launch, frame).
 */
export function StageWidget({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  switch (frame.stage) {
    case "presale":
      return (
        <div>
          <p className="tnum text-[13px] font-semibold text-ink-2">
            Raised {formatUsdWhole(frame.raisedUsd)} of {formatUsdWhole(m.raiseUsd)}
          </p>
          <div aria-hidden className="mt-2 h-3 overflow-hidden rounded-full bg-presale-track">
            <div
              className="h-full rounded-full"
              style={{ width: `${(frame.raisedUsd / m.raiseUsd) * 100}%`, backgroundImage: PRESALE_FILL }}
            />
          </div>
        </div>
      );
    case "graduation":
      return <SplitBar m={m} progress={frame.splitProgress} />;
    case "trading":
    case "selloff": {
      // Trading: net buying since listing. Selloff: selling since the peak, so the number agrees
      // with "Everyone sells" from the first frame.
      const x = netFlowAt(m, frame.t);
      const peak = netFlowAt(m, STAGES.find((s) => s.key === "trading")!.end);
      const [verb, usd] = frame.stage === "trading" ? ["Bought", x] : ["Sold", peak - x];
      return (
        <p className="tnum text-[13px] text-ink-2">
          {verb} <b className="text-ink">{formatUsdWhole(usd)}</b>
        </p>
      );
    }
    case "redeem": {
      const { backCents, lostCents } = redeemCents(m);
      return <RedeemBar backCents={backCents} lostCents={lostCents} progress={frame.redeemProgress} />;
    }
  }
}
