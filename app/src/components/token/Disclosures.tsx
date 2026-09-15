"use client";

import { useId } from "react";
import type { LaunchSummary } from "@/lib/data/types";
import { AttestationCheckbox } from "@/components/ui/AttestationCheckbox";
import { formatPercent } from "@/lib/format";

export function Disclosures({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const quote = launch.quote.asset;

  return (
    <section id="disclosures" aria-labelledby={`${id}-heading`} className="card scroll-mt-20 p-5 sm:p-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
        Disclosures
      </h2>
      <ul className="mt-3 space-y-3 text-sm leading-relaxed text-ink-2">
        <li>
          <span className="font-semibold text-ink">{quote.symbol} is a tracker certificate.</span> It tracks{" "}
          {quote.underlying} and gives no voting rights and no direct ownership of the underlying shares.
        </li>
        <li>
          <span className="font-semibold text-ink">The issuer controls the quote asset.</span> The {quote.symbol}{" "}
          issuer can pause transfers, freeze accounts, and move tokens through a permanent delegate, and could add a
          transfer hook later. While {quote.symbol} is paused, redemptions and harvests fail until it resumes.
        </li>
        <li>
          <span className="font-semibold text-ink">The floor moves with the underlying in USD.</span> The vault holds{" "}
          {quote.symbol}, so the floor in dollars rises and falls with {quote.underlying}.
        </li>
        <li>
          <span className="font-semibold text-ink">The floor protects from zero, not from loss.</span> If you buy
          above the floor, you can lose the difference. Redemptions pay a pro-rata share of the vault minus a{" "}
          {formatPercent(launch.exitFeeBps / 10_000)} exit fee that stays in the vault.
        </li>
        <li>
          <span className="font-semibold text-ink">Unaudited software.</span> StockFloor is hackathon code that has
          not been audited. Smart contract bugs can lose funds.
        </li>
      </ul>
      <AttestationCheckbox className="mt-5" />
    </section>
  );
}
