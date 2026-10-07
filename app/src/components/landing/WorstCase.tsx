import type { CSSProperties } from "react";
import { formatCentsUsd, worstCasePer100 } from "@/lib/landing/figures";
import styles from "./landing.module.css";

// README, "Who could still hurt the floor".
const RISKS = [
  "Buy far above the floor and you can lose most of it.",
  "The SPYx issuer can freeze or move vault tokens.",
  "Unaudited, and still upgradeable by our key.",
];

/**
 * The default-terms worst case in dollars. No max-loss percentage here: the app's 64.4% excludes the
 * exit fee and would clash with the $65.12, which includes it.
 */
export function WorstCase() {
  const { backUsd, atRiskUsd } = worstCasePer100();
  const back = formatCentsUsd(backUsd);
  const atRisk = formatCentsUsd(atRiskUsd);
  return (
    <section aria-labelledby="worst-title" className={`py-12 sm:py-20 ${styles.reveal}`}>
      <h2 id="worst-title" className="heading text-ink sm:text-[28px]">
        Know the worst case
      </h2>
      <div className="mt-6 rounded-card bg-cloud p-5 sm:p-7">
        <p className="font-display text-[18px] font-bold leading-snug text-ink sm:text-[22px]">
          $100 bought at the opening price redeems for {back}.
        </p>
        <div
          role="img"
          aria-label={`Of $100: ${back} back from the floor, ${atRisk} at risk`}
          className="mt-5 flex h-10 overflow-hidden rounded-full"
        >
          <span className={`bg-floor ${styles.grow}`} style={{ flexBasis: `${backUsd}%`, "--i": 0 } as CSSProperties} />
          <span className={`hatch-risk ${styles.grow}`} style={{ flexBasis: `${atRiskUsd}%`, "--i": 1 } as CSSProperties} />
        </div>
        <p className="tnum mt-3 flex justify-between gap-3 text-[13.5px]">
          <span className="font-bold text-floor">{back} back</span>
          <span className="font-bold text-risk">{atRisk} at risk</span>
        </p>
        <p className="mt-4 text-[13px] text-ink-3">Default terms. Moves with the S&amp;P 500.</p>
      </div>
      <div className="mt-4 rounded-card border-l-[3px] border-risk-line bg-risk-wash p-5">
        <h3 className="text-[15px] font-bold text-ink">Also know</h3>
        <ul className="mt-3 space-y-2">
          {RISKS.map((risk) => (
            <li key={risk} className="flex items-start gap-2.5 text-[15px] text-ink-2">
              <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-risk-line" />
              <span>{risk}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
