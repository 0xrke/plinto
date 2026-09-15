import type { ReactNode } from "react";
import type { LaunchSummary } from "@/lib/data/types";
import { formatPercent, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { floorQuotePerToken, launchFloorUsd, quoteRawToUsd } from "@/lib/metrics";

function Row({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="tnum block text-sm font-semibold text-ink">{value}</span>
        {sub ? <span className="block text-xs text-ink-3">{sub}</span> : null}
      </dd>
    </div>
  );
}

function formatFloorQuote(value: number): string {
  if (!(value > 0)) return "0";
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(value);
}

export function VaultStats({ launch }: { launch: LaunchSummary }) {
  const quote = launch.quote;
  const vaultUsd = quoteRawToUsd(launch.vaultRaw, quote);
  const floorQuote = floorQuotePerToken(launch.vaultRaw, launch.supplyRaw, launch.baseDecimals, quote);

  return (
    <section aria-labelledby="vault-heading" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="vault-heading" className="text-lg font-semibold text-ink">
          Vault
        </h2>
        <p className="text-xs text-ink-3">No admin, no withdraw. Quote leaves the vault only through redemption.</p>
      </div>
      <dl className="mt-2 divide-y divide-line">
        <Row
          label="Vault balance"
          value={`${formatTokenAmount(launch.vaultRaw, quote.asset.decimals, { multiplier: quote.multiplier })} ${quote.asset.symbol}`}
          sub={`≈ ${formatUsd(vaultUsd)}`}
        />
        <Row
          label="Token supply"
          value={`${formatTokenAmount(launch.supplyRaw, launch.baseDecimals, { maxFractionDigits: 0 })} $${launch.symbol}`}
          sub="Burned on redemption"
        />
        <Row
          label="Floor per token"
          value={formatUsd(launchFloorUsd(launch))}
          sub={`${formatFloorQuote(floorQuote)} ${quote.asset.symbol}`}
        />
        <Row
          label="Exit fee"
          value={formatPercent(launch.exitFeeBps / 10_000)}
          sub="Stays in the vault and raises the floor"
        />
        <Row label="Vault share at graduation" value={`${launch.vaultSharePct}% of the raise`} />
        <Row
          label={`${quote.asset.symbol} price`}
          value={formatUsd(quote.priceUsd)}
          sub={`Dividend multiplier ${quote.multiplier.toFixed(4)}`}
        />
        <Row
          label="Vault account"
          value={<span className="font-mono text-xs">{truncateAddress(launch.vault, 6)}</span>}
          sub={launch.dammPool ? `DAMM v2 pool ${truncateAddress(launch.dammPool)}` : `DBC pool ${truncateAddress(launch.pool)}`}
        />
      </dl>
    </section>
  );
}

export function FloorHistoryPlaceholder({ quoteSymbol, underlying }: { quoteSymbol: string; underlying: string }) {
  return (
    <section aria-labelledby="history-heading" className="card p-5 sm:p-6">
      <h2 id="history-heading" className="text-lg font-semibold text-ink">
        Floor history
      </h2>
      <div className="mt-4 flex h-36 items-center justify-center rounded-lg border border-dashed border-line-strong bg-sunken/50 px-4 text-center text-sm text-ink-3">
        History appears here once the indexer is connected.
      </div>
      <p className="mt-3 text-sm text-ink-2">
        In {quoteSymbol}, the floor per token only rises: through the vault share of trading fees, retained exit fees,
        burned fees and dividends paid through the {quoteSymbol} multiplier. In USD it also moves with {underlying}.
      </p>
    </section>
  );
}
