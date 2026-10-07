import type { ComponentType } from "react";
import { IconTile } from "@/components/ui/Tiles";
import { CloseIcon, LockIcon, VaultIcon, type IconProps } from "@/components/ui/icons";
import styles from "./landing.module.css";

// README, "What the program guarantees" and "Who could still hurt the floor".
const CANT: { Icon: ComponentType<IconProps>; title: string }[] = [
  { Icon: VaultIcon, title: "No withdraw" },
  { Icon: LockIcon, title: "No unlock" },
  { Icon: CloseIcon, title: "No pause" },
];

const RISKS = [
  "Buying far above the floor.",
  "The SPYx issuer can pause, freeze or move vault tokens.",
  "Unaudited, and still upgradeable by our key.",
];

export function Rules() {
  return (
    <section
      aria-labelledby="rules-title"
      className={`grid gap-6 py-10 sm:py-16 lg:grid-cols-2 lg:items-start lg:gap-8 ${styles.reveal}`}
    >
      <div>
        <h2 id="rules-title" className="heading text-ink sm:text-[28px]">
          What the code can&apos;t do
        </h2>
        <ul className="mt-6 flex flex-wrap gap-3">
          {CANT.map(({ Icon, title }) => (
            <li key={title} className="tile-soft flex items-center gap-3 py-2 pr-4 pl-2">
              <IconTile tone="floor" size={40}>
                <Icon aria-hidden />
              </IconTile>
              <span className="text-[15px] font-bold text-ink">{title}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-card border-l-[3px] border-risk-line bg-risk-wash p-5">
        <h3 className="text-[15px] font-bold text-ink">What can still hurt</h3>
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
