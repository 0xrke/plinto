import type { ReactNode } from "react";
import type { LaunchSummary } from "@/lib/data/types";
import { formatPercent, formatSignificantDown, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { floorPer100NowUsd, floorQuotePerToken, launchFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { IconTile, type Tone } from "@/components/ui/Tiles";
import { LockIcon, PercentIcon, StepIcon, SupplyIcon, TrendIcon, VaultIcon } from "@/components/ui/icons";

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
  const per100Now = floorPer100NowUsd(launch);
  const per100 = [
    launch.floorPer100AtListingUsd !== null ? `${formatUsd(launch.floorPer100AtListingUsd)} per $100 at listing` : null,
    per100Now !== null ? `${formatUsd(per100Now)} per $100 at today's price` : null,
  ].filter(Boolean);
  const multiplierNote = quote.multiplier !== 1 ? `Dividend multiplier ${quote.multiplier.toFixed(4)}` : "";

  return (
    <section aria-labelledby="vault-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="vault-heading" className="text-[17px] font-bold text-ink">
            Vault
          </h2>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-3">
            <span title={launch.mint}>Mint {truncateAddress(launch.mint)}</span>
            <span>·</span>
            <span className="font-mono font-semibold text-ink-2" title={launch.vault}>
              {truncateAddress(launch.vault, 6)}
            </span>
            <span>·</span>
            <span>
              {launch.dammPool ? `DAMM v2 pool ${truncateAddress(launch.dammPool)}` : `DBC pool ${truncateAddress(launch.pool)}`}
            </span>
          </p>
        </div>
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
          sub={
            <>
              <span>{`${formatFloorQuote(floorQuote)} ${symbol}`}</span>
              {per100.length > 0 ? (
                <>
                  {" · "}
                  <b className="font-bold text-floor">{per100.join(" · ")}</b>
                </>
              ) : null}
            </>
          }
        />
        <Item
          icon={<PercentIcon />}
          tone="risk"
          label="Exit fee"
          value={formatPercent(launch.exitFeeBps / 10_000)}
          sub="stays in the vault and raises the floor"
        />
        <Item
          icon={<TrendIcon />}
          tone="presale"
          label={`${symbol} price`}
          value={formatUsd(quote.priceUsd)}
          sub={`${PRICE_SOURCE_LABEL[quote.priceSource]}${multiplierNote}`.replace(/ · $/, "") || undefined}
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
        </div>
      </div>
    </section>
  );
}
