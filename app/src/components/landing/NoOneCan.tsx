import type { ComponentType } from "react";
import { IconTile } from "@/components/ui/Tiles";
import { CloseIcon, LockIcon, VaultIcon, type IconProps } from "@/components/ui/icons";
import styles from "./landing.module.css";

// README, "What the program guarantees". The upgrade key is disclosed under "Know the worst case".
const ITEMS: { Icon: ComponentType<IconProps>; title: string; body: string }[] = [
  { Icon: VaultIcon, title: "No withdraw", body: "Only redemptions pay out of the vault." },
  { Icon: LockIcon, title: "No unlock", body: "Pool liquidity is locked for good." },
  { Icon: CloseIcon, title: "No pause", body: "No pause or sweep instruction exists." },
];

export function NoOneCan() {
  return (
    <section aria-labelledby="noone-title" className={`py-12 sm:py-20 ${styles.reveal}`}>
      <h2 id="noone-title" className="heading text-ink sm:text-[28px]">
        What the program can&apos;t do
      </h2>
      <ul className="mt-6 grid gap-3 md:grid-cols-3">
        {ITEMS.map(({ Icon, title, body }) => (
          <li key={title} className="tile-soft p-5">
            <IconTile tone="floor" size={44}>
              <Icon aria-hidden />
            </IconTile>
            <p className="mt-4 text-[16px] font-bold text-ink">{title}</p>
            <p className="mt-1 text-[14.5px] leading-[1.55] text-ink-2">{body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-ink-3">Today&apos;s code. Our upgrade key can still change it; see below.</p>
    </section>
  );
}
