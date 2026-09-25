"use client";

import { useState } from "react";
import Link from "next/link";
import type { LaunchSummary } from "@/lib/data/types";
import { formatUsd, truncateAddress } from "@/lib/format";
import { phaseLabel } from "@/lib/phase";
import { PhaseBadge } from "@/components/ui/PhaseBadge";
import { QuoteChip } from "@/components/ui/QuoteChip";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { TokenCover } from "@/components/ui/TokenCover";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon } from "@/components/ui/icons";

/**
 * Breadcrumb, the cover built from the logo (profile header like on X: the logo tile overlaps its
 * bottom-left edge), the name and symbol beside the tile, and the chips row (phase, quote asset, vault
 * share and floor per $100 at listing before graduation, mint with a copy button on wider screens).
 */
export function TokenHeader({ launch }: { launch: LaunchSummary }) {
  const [copied, setCopied] = useState(false);
  const floorLive = launch.phase === "graduated" && launch.migrationFeeHarvested;
  const presale = launch.phase !== "graduated";

  async function copyMint() {
    try {
      await navigator.clipboard.writeText(launch.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; the mint stays visible.
    }
  }

  return (
    <header>
      <nav aria-label="Breadcrumb">
        <ol className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 sm:font-medium">
          <li>
            <Link href="/#launches" className="inline-flex min-h-11 items-center gap-1 hover:text-ink">
              <ChevronLeftIcon size={14} className="sm:hidden" />
              Launches
            </Link>
          </li>
          <li aria-current="page" className="hidden min-w-0 items-center gap-1.5 text-ink-3 sm:flex">
            <ChevronRightIcon size={14} />
            <span className="truncate">{launch.name}</span>
          </li>
        </ol>
      </nav>

      <TokenCover
        symbol={launch.symbol}
        imageUrl={launch.imageUrl}
        className="mt-2 h-24 rounded-[24px] sm:mt-3 sm:h-36 sm:rounded-card"
      />

      {/* Logo tile overlapping the cover, the name beside it; on wider screens the chips sit under the name, on phones below both. */}
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-3.5 px-3 sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-x-5 sm:px-5">
        <TokenAvatar
          symbol={launch.symbol}
          imageUrl={launch.imageUrl}
          size={84}
          ring
          className="relative z-10 -mt-8 max-sm:!h-16 max-sm:!w-16 max-sm:!rounded-[19px] sm:row-span-2 sm:-mt-10"
        />
        <div className="min-w-0 pt-2 sm:pt-3">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <h1 className="display min-w-0 text-[26px] leading-[1.08] text-ink sm:text-[40px] sm:leading-[1.05] xl:text-[44px]">
              {launch.name}
            </h1>
            <span className="hidden text-xl font-bold text-ink-3 sm:inline">${launch.symbol}</span>
          </div>
          <p className="meta-violet mt-1 text-sm font-semibold sm:hidden">
            ${launch.symbol} · {launch.quote.asset.symbol} · {floorLive ? "Floor live" : phaseLabel(launch.phase)}
          </p>
        </div>

        {/* Presale has one more chip; it drops a "calm" volatility tag (never a risk tag) so the row stays on one line. */}
        <div
          className={`col-span-2 mt-3.5 flex flex-wrap items-center gap-1.5 max-sm:[&>*]:px-2.5 max-sm:[&>*]:text-[12.5px] sm:col-span-1 sm:col-start-2 sm:mt-2.5 sm:gap-2 ${
            presale && launch.quote.asset.volatility === "calm" ? "[&_b+span]:hidden" : ""
          }`}
        >
          <PhaseBadge phase={launch.phase} label={floorLive ? "Floor live" : undefined} />
          <QuoteChip symbol={launch.quote.asset.symbol} volatility={launch.quote.asset.volatility} prefix="Quote" />
          {presale ? (
            <span className="chip tnum">
              Vault share <b>{launch.vaultSharePct}%</b>
            </span>
          ) : null}
          {presale && launch.floorPer100AtListingUsd !== null ? (
            <span className="chip tnum" title="What $100 bought at the listing price redeems for at the floor, after the exit fee">
              Floor per $100 <b className="text-floor">{formatUsd(launch.floorPer100AtListingUsd)}</b>
            </span>
          ) : null}
          <span className="chip tnum pr-1 max-sm:hidden" title={launch.mint}>
            Mint {truncateAddress(launch.mint, 4)}
            <button
              type="button"
              onClick={copyMint}
              className="-my-2 flex h-11 w-9 items-center justify-center rounded-full text-violet hover:text-violet-hover"
              aria-label={`Copy mint address ${launch.mint}`}
            >
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
            <span aria-live="polite" className="sr-only">
              {copied ? "Mint address copied" : ""}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}
