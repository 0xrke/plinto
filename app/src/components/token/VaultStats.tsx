import type { ReactNode } from "react";
import type { LaunchSummary } from "@/lib/data/types";
import { formatPercent, formatSignificantDown, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { floorQuotePerToken, launchFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { IconTile, type Tone } from "@/components/ui/Tiles";
import { LockIcon, PercentIcon, PieIcon, StepIcon, SupplyIcon, TrendIcon, VaultIcon } from "@/components/ui/icons";

function Item({
  icon,
  tone,
  label,
  value,
  valueClassName = "",
  sub,
  aside,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: ReactNode;
  valueClassName?: string;
  sub?: ReactNode;
  /** Right-aligned secondary figure ("≈ $494.80"). */
  aside?: ReactNode;
}) {
  return (
    <li className="flex min-h-[62px] min-w-0 items-center gap-3.5">
      <IconTile tone={tone} size={44} className="!rounded-icon">
        {icon}
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink-3">{label}</p>
        <p className={`tnum mt-0.5 break-words text-[17px] font-extrabold leading-snug text-ink ${valueClassName}`}>{value}</p>
        {sub ? <p className="text-xs leading-snug text-ink-3">{sub}</p> : null}
      </div>
      {aside ? <p className="tnum shrink-0 text-[13px] text-ink-2">{aside}</p> : null}
    </li>
  );
}

const PRICE_SOURCE_LABEL: Record<LaunchSummary["quote"]["priceSource"], string> = {
  jupiter: "Jupiter · ",
  stale: "Last Jupiter price, over 5 minutes old (Jupiter unavailable) · ",
  reference: "Reference price (Jupiter unavailable) · ",
  mock: "",
};

/**
 * The floor per token in the quote asset. Rounded down: `Intl` rounds to nearest, which can print a
 * floor above the one the vault actually backs.
 */
function formatFloorQuote(value: number): string {
  return formatSignificantDown(value, 4);
}

export function VaultStats({ launch }: { launch: LaunchSummary }) {
  const quote = launch.quote;
  const symbol = quote.asset.symbol;
  const vaultUsd = quoteRawToUsd(launch.vaultRaw, quote);
  const floorQuote = floorQuotePerToken(launch.vaultRaw, launch.supplyRaw, launch.baseDecimals, quote);

  return (
    <section aria-labelledby="vault-heading" className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="vault-heading" className="heading text-[22px] text-ink sm:text-2xl">
            Vault
          </h2>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-3">
            <span className="font-mono font-semibold text-ink-2" title={launch.vault}>
              {truncateAddress(launch.vault, 6)}
            </span>
            <span>·</span>
            <span>
              {launch.dammPool ? `DAMM v2 pool ${truncateAddress(launch.dammPool)}` : `DBC pool ${truncateAddress(launch.pool)}`}
            </span>
          </p>
        </div>
        <span className="pill pill-neutral tnum h-[30px] text-[13px] font-semibold">
          {symbol} price <b className="text-ink">{formatUsd(quote.priceUsd)}</b>
        </span>
      </div>
      <ul className="mt-5 grid gap-x-7 gap-y-3 md:grid-cols-2">
        <Item
          icon={<VaultIcon />}
          tone="floor"
          label="Vault balance"
          value={`${formatTokenAmount(launch.vaultRaw, quote.asset.decimals, { multiplier: quote.multiplier })} ${symbol}`}
          aside={`≈ ${formatUsd(vaultUsd)}`}
        />
        <Item
          icon={<SupplyIcon />}
          tone="violet"
          label="Token supply"
          value={`${formatTokenAmount(launch.supplyRaw, launch.baseDecimals, { maxFractionDigits: 0 })} $${launch.symbol}`}
          sub="burned on redemption"
        />
        <Item
          icon={<StepIcon />}
          tone="floor"
          label="Floor per token"
          value={formatUsd(launchFloorUsd(launch))}
          valueClassName="text-floor"
          sub={`${formatFloorQuote(floorQuote)} ${symbol}`}
        />
        <Item
          icon={<PercentIcon />}
          tone="risk"
          label="Exit fee"
          value={formatPercent(launch.exitFeeBps / 10_000)}
          sub="stays in the vault and raises the floor"
        />
        <Item
          icon={<PieIcon />}
          tone="graduating"
          label="Vault share at graduation"
          value={
            <>
              {launch.vaultSharePct}% <span className="text-[13px] font-medium text-ink-2">of the raise</span>
            </>
          }
        />
        <Item
          icon={<TrendIcon />}
          tone="presale"
          label={`${symbol} price`}
          value={formatUsd(quote.priceUsd)}
          sub={`${PRICE_SOURCE_LABEL[quote.priceSource]}Dividend multiplier ${quote.multiplier.toFixed(4)}`}
        />
      </ul>
      <div className="tile-soft mt-5 flex items-start gap-3 !rounded-[18px] px-4 py-3.5 text-[13.5px] leading-normal text-ink-2">
        <LockIcon size={18} className="mt-px shrink-0 text-floor" />
        <div className="space-y-1.5">
          <p>
            The program has no admin or withdraw instruction: redemption is its only way out of the vault. The {symbol}{" "}
            issuer&apos;s permanent delegate and a program upgrade are exceptions (see{" "}
            <a href="#disclosures" className="link">
              disclosures
            </a>
            ).
          </p>
          <p className="text-[12.5px] text-ink-3">
            In {symbol}, the floor per token only rises: through the vault share of trading fees, retained exit fees,
            burned fees and dividends paid through the {symbol} multiplier. In USD it also moves with{" "}
            {quote.asset.underlying}.
          </p>
        </div>
      </div>
    </section>
  );
}
