import type { CurvePreset, LaunchPreview } from "@stockfloor/sdk";
import type { QuoteMarket } from "@/lib/data/types";
import { BASE_DECIMALS } from "@/lib/config";
import { EMPTY, formatMaxLoss, formatPercent, formatTokenAmount, formatUsd } from "@/lib/format";
import { quoteRawToUsd } from "@/lib/metrics";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { CurveSketch } from "./CurveSketch";

export function LaunchPreviewPanel({
  preview,
  error,
  loading,
  market,
  preset,
  vaultSharePct,
  thresholdUsd,
  name,
  symbol,
  imageUrl,
}: {
  preview: LaunchPreview | null;
  error: string | null;
  loading: boolean;
  market: QuoteMarket | null;
  preset: CurvePreset;
  vaultSharePct: number;
  /** Graduation threshold the preview was computed with; null when the form value is not usable. */
  thresholdUsd: number | null;
  name: string;
  symbol: string;
  imageUrl: string;
}) {
  const displaySymbol = symbol.trim() || "TOKEN";
  const quoteSymbol = market?.asset.symbol ?? "";

  return (
    <section aria-labelledby="preview-heading" className="card overflow-hidden" aria-live="polite">
      <header className="flex items-center gap-3 border-b border-line bg-sunken/60 px-5 py-4">
        <TokenAvatar symbol={displaySymbol} imageUrl={imageUrl.trim() || null} size={40} />
        <div className="min-w-0">
          <h2 id="preview-heading" className="truncate font-semibold text-ink">
            {name.trim() || "Your token"}
          </h2>
          <p className="text-sm text-ink-3">
            ${displaySymbol} · {preset === "gentle" ? "Gentle" : "Flat"} curve · {vaultSharePct}% vault
          </p>
        </div>
      </header>

      {loading ? (
        <div className="space-y-3 p-5" aria-busy="true">
          <div className="h-10 w-2/3 animate-pulse rounded bg-sunken" />
          <div className="h-24 animate-pulse rounded bg-sunken" />
          <span className="sr-only">Loading quote prices</span>
        </div>
      ) : error || !preview || !market ? (
        <div className="p-5 text-sm text-ink-2" role="alert">
          <p className="font-semibold text-ink">Preview unavailable</p>
          <p className="mt-1">{error ?? "Select a quote asset to see the preview."}</p>
        </div>
      ) : (
        <div className="space-y-5 p-5">
          <div>
            <p className="eyebrow">Floor at graduation</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight text-floor-strong">
              {formatUsd(preview.floorAtGraduationUsd)}
            </p>
            <p className="mt-1 text-sm text-ink-2">
              per token, backed by{" "}
              <span className="font-semibold text-ink">
                {formatTokenAmount(preview.vaultAtGraduationQuoteRaw, market.asset.decimals, {
                  multiplier: market.multiplier,
                })}{" "}
                {quoteSymbol}
              </span>{" "}
              (≈ {formatUsd(quoteRawToUsd(preview.vaultAtGraduationQuoteRaw, market))}) in the vault
            </p>
          </div>

          <CurveSketch
            startPriceUsd={preview.startPriceUsd}
            graduationPriceUsd={preview.graduationPriceUsd}
            floorUsd={preview.floorAtGraduationUsd}
          />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-ink-3">Start price</dt>
              <dd className="font-semibold text-ink">{formatUsd(preview.startPriceUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Graduation price</dt>
              <dd className="font-semibold text-ink">{formatUsd(preview.graduationPriceUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Graduation threshold</dt>
              <dd className="font-semibold text-ink">
                {formatTokenAmount(preview.thresholdQuoteRaw, market.asset.decimals, {
                  multiplier: market.multiplier,
                })}{" "}
                {quoteSymbol}
              </dd>
              <dd className="text-xs text-ink-3">{thresholdUsd !== null ? `≈ ${formatUsd(thresholdUsd)}` : EMPTY}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Supply at graduation</dt>
              <dd className="font-semibold text-ink">
                {formatTokenAmount(preview.baseSupplyAtGraduationRaw, BASE_DECIMALS, { compact: true })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Floor vs graduation price</dt>
              <dd className="font-semibold text-ink">
                {preview.graduationPriceUsd > 0
                  ? formatPercent(preview.floorAtGraduationUsd / preview.graduationPriceUsd)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Max loss at graduation price</dt>
              <dd className="font-semibold text-risk">{formatMaxLoss(preview.maxLossAtGraduationPrice)}</dd>
            </div>
          </dl>

          <p className="rounded-lg bg-risk-soft px-3 py-2 text-sm text-risk">
            A buyer at the graduation price can lose up to{" "}
            {formatPercent(preview.maxLossAtGraduationPrice)} if the market falls to the floor. The floor also
            moves with {market.asset.underlying} in USD.
          </p>
        </div>
      )}
    </section>
  );
}
