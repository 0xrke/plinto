"use client";

import { useId } from "react";
import type { LaunchSummary } from "@/lib/data/types";
import { AttestationCheckbox } from "@/components/ui/AttestationCheckbox";
import type { UpgradeStatus } from "@/lib/chain/upgradeAuthority";
import { useProgramUpgradeStatus } from "@/lib/data/context";
import { formatPercent, truncateAddress } from "@/lib/format";
import { IconTile } from "@/components/ui/Tiles";
import { InfoIcon } from "@/components/ui/icons";

function upgradeStatusText(status: UpgradeStatus | undefined): string {
  if (!status) return "Checking the upgrade authority on this cluster…";
  switch (status.status) {
    case "upgradeable":
      return `Status on this cluster: upgradeable by ${truncateAddress(status.authority)}.`;
    case "immutable":
      return "Status on this cluster: the upgrade authority is revoked, so the program can no longer change.";
    case "unknown":
      return "Status on this cluster: not checked; assume it is upgradeable.";
  }
}

export function Disclosures({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const quote = launch.quote.asset;
  const upgrade = useProgramUpgradeStatus();

  return (
    <section id="disclosures" aria-labelledby={`${id}-heading`} className="card below-header p-5 sm:p-7">
      <div className="flex items-center gap-3">
        <IconTile tone="neutral" size={40}>
          <InfoIcon />
        </IconTile>
        <div>
          <h2 id={`${id}-heading`} className="heading text-[22px] text-ink sm:text-2xl">
            Disclosures
          </h2>
          <p className="text-[13px] text-ink-3">Read these before you buy or redeem.</p>
        </div>
      </div>
      <ul className="mt-5 space-y-3 text-[13.5px] leading-relaxed text-ink-2 [&>li]:relative [&>li]:pl-4 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[0.6em] [&>li]:before:h-1.5 [&>li]:before:w-1.5 [&>li]:before:rounded-full [&>li]:before:bg-iris">
        <li>
          <span className="font-bold text-ink">{quote.symbol} is a tracker certificate.</span> It tracks{" "}
          {quote.underlying} and gives no voting rights and no direct ownership of the underlying shares.
        </li>
        <li>
          <span className="font-bold text-ink">The issuer controls the quote asset.</span> The {quote.symbol}{" "}
          issuer can pause transfers, freeze accounts, and move tokens through a permanent delegate, and could add a
          transfer hook later. While {quote.symbol} is paused, redemptions and harvests fail until it resumes.
        </li>
        <li>
          <span className="font-bold text-ink">The floor moves with the underlying in USD.</span> The vault holds{" "}
          {quote.symbol}, so the floor in dollars rises and falls with {quote.underlying}.
        </li>
        <li>
          <span className="font-bold text-ink">The floor protects from zero, not from loss.</span> If you buy
          above the floor, you can lose the difference. Redemptions pay a pro-rata share of the vault minus a{" "}
          {formatPercent(launch.exitFeeBps / 10_000)} exit fee that stays in the vault.
        </li>
        <li>
          <span className="font-bold text-ink">The programs are upgradeable.</span> The StockFloor program has no
          admin, pause or withdraw instruction, but its deployer can upgrade it until the upgrade authority is
          revoked, and an upgrade could change the rules, including how vault funds move. {upgradeStatusText(upgrade.data)}{" "}
          Meteora DBC and DAMM v2 are upgradeable by Meteora; an upgrade there could stop or divert fees that are not
          yet harvested into the vault.
        </li>
        <li>
          <span className="font-bold text-ink">Unaudited software.</span> StockFloor is hackathon code that has
          not been audited. Smart contract bugs can lose funds.
        </li>
      </ul>
      <AttestationCheckbox className="mt-6" />
    </section>
  );
}
