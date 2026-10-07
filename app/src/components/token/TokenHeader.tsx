"use client";

import { useState } from "react";
import Link from "next/link";
import type { LaunchSummary } from "@/lib/data/types";
import { formatUsd } from "@/lib/format";
import { phaseLabel } from "@/lib/phase";
import { PhaseBadge } from "@/components/ui/PhaseBadge";
import { QuoteChip } from "@/components/ui/QuoteChip";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon } from "@/components/ui/icons";

/** Market cap in USD: price × total supply (before graduation the supply minted into the curve). */
export function marketCapUsd(launch: LaunchSummary): number {
  return launch.priceUsd * (Number(launch.supplyRaw) / 10 ** launch.baseDecimals);
}

/**
 * Breadcrumb, then one row: the logo, the name with $SYMBOL and a copy-mint button, the phase and quote
 * chips, and (right-aligned on wider screens, under the name on phones) the price and market cap.
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
      // Clipboard may be blocked; the mint is in the vault details.
    }
  }

  return (
    <header>
      <nav aria-label="Breadcrumb">
        <ol className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 sm:font-medium">
          <li>
            <Link href="/app#launches" className="inline-flex min-h-11 items-center gap-1 hover:text-ink">
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

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-3 sm:mt-2">
        <TokenAvatar
          symbol={launch.symbol}
          imageUrl={launch.imageUrl}
          size={64}
          className="max-sm:!h-14 max-sm:!w-14 max-sm:!rounded-[17px]"
        />
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <h1 className="display min-w-0 text-[26px] leading-[1.08] text-ink sm:text-[34px] sm:leading-[1.05]">
              {launch.name}
            </h1>
            <span className="inline-flex items-center text-lg font-bold text-ink-3 max-sm:hidden">
              ${launch.symbol}
              <button
                type="button"
                onClick={copyMint}
                title={launch.mint}
                className="-my-2 ml-0.5 flex h-11 w-9 items-center justify-center rounded-full text-violet hover:text-violet-hover"
                aria-label={`Copy mint address ${launch.mint}`}
              >
                {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              </button>
              <span aria-live="polite" className="sr-only">
                {copied ? "Mint address copied" : ""}
              </span>
            </span>
          </div>
          <p className="meta-violet mt-1 text-sm font-semibold sm:hidden">
            ${launch.symbol} · {floorLive ? "Floor live" : phaseLabel(launch.phase)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 max-sm:hidden">
            <PhaseBadge phase={launch.phase} label={floorLive ? "Floor live" : undefined} />
            <QuoteChip symbol={launch.quote.asset.symbol} volatility={launch.quote.asset.volatility} />
          </div>
        </div>
        <div className="sm:text-right max-sm:w-full max-sm:flex max-sm:items-baseline max-sm:gap-3">
          <p className="text-[13px] font-medium text-ink-3 max-sm:sr-only">{presale ? "Curve price" : "Price"}</p>
          <p className="tnum text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">
            {formatUsd(launch.priceUsd)}
          </p>
          <p className="tnum text-[13px] text-ink-3">
            Mcap <b className="font-bold text-ink-2">{formatUsd(marketCapUsd(launch), { compact: true })}</b>
          </p>
        </div>
      </div>
    </header>
  );
}
