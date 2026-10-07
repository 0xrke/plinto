import type { CSSProperties } from "react";
import {
  EXAMPLE_RAISE_USD,
  EXIT_FEE_PCT,
  FLOOR_SHARE_MAX_PCT,
  FLOOR_SHARE_MIN_PCT,
  formatWholeUsd,
  raiseSplit,
  splitAriaLabel,
  type SplitKey,
} from "@/lib/landing/figures";
import styles from "./landing.module.css";

// White on `floor` is about 5.8:1; `floor-bar` would be about 3.4:1.
const SEGMENT: Record<SplitKey, string> = {
  floor: "bg-floor",
  pool: "bg-iris",
  creator: "bg-butter",
  platform: "bg-ink-3/45",
};

export function RaiseSplit() {
  const parts = raiseSplit();
  return (
    <section aria-labelledby="split-title" className={`py-12 sm:py-20 ${styles.reveal}`}>
      <h2 id="split-title" className="heading text-ink sm:text-[28px]">
        Where a {formatWholeUsd(EXAMPLE_RAISE_USD)} raise goes
      </h2>
      <div role="img" aria-label={splitAriaLabel(parts)} className="mt-6 flex h-12 gap-0.5 overflow-hidden rounded-full">
        {parts.map((p, i) => (
          <span
            key={p.key}
            className={`flex items-center justify-center ${SEGMENT[p.key]} ${styles.grow}`}
            style={{ flexBasis: `${p.pct}%`, "--i": i } as CSSProperties}
          >
            {p.key === "floor" ? <span className="tnum text-[15px] font-bold text-white">{p.pct}%</span> : null}
          </span>
        ))}
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start gap-2 text-[15px] text-ink-2">
            <span aria-hidden className={`mt-[0.45em] h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-ink/15 ${SEGMENT[p.key]}`} />
            <span className="flex flex-col">
              <span className="whitespace-nowrap">{p.label}</span>
              <span className={`tnum ${p.key === "floor" ? "font-bold text-floor" : "font-semibold text-ink"}`}>
                {formatWholeUsd(p.usd)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-5 max-w-[640px] text-[15px] text-ink-2 [text-wrap:pretty]">
        Creators pick the floor share: {FLOOR_SHARE_MIN_PCT}–{FLOOR_SHARE_MAX_PCT}%. A share of pool fees and the{" "}
        {EXIT_FEE_PCT}% exit fee add to it.
      </p>
    </section>
  );
}
