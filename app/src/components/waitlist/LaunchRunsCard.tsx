import { PhaseChart } from "./PhaseChart";

const PHASES = [
  {
    n: "01",
    title: "Presale.",
    body: "Everyone pays about the same; sell back any time.",
    value: "SPYx",
    chip: "bg-presale-soft text-presale",
    valueTone: "text-ink",
  },
  {
    n: "02",
    title: "Market opens.",
    body: "Half the raise becomes the floor, 40% locked liquidity.",
    value: "50%",
    chip: "bg-graduating-soft text-graduating",
    valueTone: "text-floor",
  },
  {
    n: "03",
    title: "Trading.",
    body: "Fees and the 2% exit fee push the floor up.",
    value: "2%",
    chip: "bg-floor-soft text-floor",
    valueTone: "text-ink",
  },
];

/**
 * "How a launch runs": the phase chart over three phase rows. One card for /waitlist and the
 * landing's first screen; callers place it (`lg:my-auto` in the lavender column).
 */
export function LaunchRunsCard({ className = "" }: { className?: string }) {
  return (
    <aside
      aria-labelledby="launch-runs"
      className={`overflow-hidden rounded-[24px] bg-surface shadow-card sm:rounded-card ${className}`}
    >
      <div className="px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
        <h2 id="launch-runs" className="font-display text-[22px] font-bold tracking-[-0.015em] text-ink sm:text-[25px]">
          How a launch runs
        </h2>
      </div>

      <div className="mx-5 sm:mx-4">
        <PhaseChart />
      </div>

      <ol className="flex flex-col gap-1.5 px-5 pb-5 pt-3 sm:p-3">
        {PHASES.map((phase) => (
          <li
            key={phase.n}
            className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 rounded-btn bg-cloud p-3"
          >
            <span
              className={`tnum flex h-[26px] items-center justify-center rounded-[9px] text-[12px] font-extrabold ${phase.chip}`}
            >
              {phase.n}
            </span>
            <span className="text-[13.5px] leading-[1.5] text-ink-2">
              <b className="font-bold text-ink">{phase.title}</b> {phase.body}
            </span>
            <span className={`tnum pt-0.5 text-[14px] font-extrabold ${phase.valueTone}`}>{phase.value}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
