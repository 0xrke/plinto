import type { ReactNode } from "react";
import type { CurvePreset, LaunchPreview } from "@stockfloor/sdk";
import type { QuoteMarket } from "@/lib/data/types";
import {
  BASE_DECIMALS,
  CREATOR_GRADUATION_BONUS_PCT,
  FEE_COPY,
  PLATFORM_GRADUATION_FEE_PCT,
  PRICE_MOVE_BUY_USD,
} from "@/lib/config";
import { formatUsdWhole, priceMoveOnBuy } from "@/lib/launchForm";
import { EMPTY, formatMaxLoss, formatPercent, formatTokenAmount, formatUsd } from "@/lib/format";
import { quoteRawToUsd } from "@/lib/metrics";
import { FloorMeter } from "@/components/token/FloorMeter";
import { Gauge } from "@/components/ui/Gauge";
import { MidnightCard, MidnightValue } from "@/components/ui/MidnightCard";
import { ArrowDownIcon, InfoIcon } from "@/components/ui/icons";
import { NotchedCta } from "@/components/ui/Notched";
import { Pill } from "@/components/ui/Tiles";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { TokenCover } from "@/components/ui/TokenCover";
import { CurveSketch } from "./CurveSketch";
import { formatPriceUsd } from "./format";

/** Side margins for a block that becomes a flex item of the stacked page below lg (see CreateLaunchForm). */
export const MOBILE_GUTTER = "max-lg:mx-4 sm:max-lg:mx-6";

/** A label/value row in the rail, like the trade summary on the token page. */
function Row({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="tnum text-right text-sm font-bold text-ink">
        <span className="block">{children}</span>
        {sub ? <span className="mt-0.5 block text-xs font-medium text-ink-3">{sub}</span> : null}
      </dd>
    </div>
  );
}

/**
 * The live preview of a launch. Desktop: the rail, with the token card and price path in flow and the
 * midnight floor card plus the key numbers sticky, so the floor and the max loss stay in view while the
 * form scrolls. Below lg the section is `display: contents` and its blocks are ordered into the page:
 * the midnight card right after the intro (order 2), the rest after the form (orders 4 and 5).
 */
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
  exitFeeBps,
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
  /** Direct image URL for the avatar, or null (a metadata JSON document is not read here). */
  imageUrl: string | null;
  /** Exit fee of the launch, for the floor-per-$100 note. */
  exitFeeBps: number;
}) {
  const displaySymbol = symbol.trim() || "TOKEN";
  const quoteSymbol = market?.asset.symbol ?? "";
  const ready = !loading && !error && preview !== null && market !== null;
  const floorText = preview ? formatPriceUsd(preview.floorAtGraduationUsd) : "";

  let hero: ReactNode;
  if (loading) {
    hero = (
      <div aria-busy="true">
        <div className="card-midnight space-y-4 p-6" style={{ minHeight: 300 }}>
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-tile" />
          <div className="h-10 w-3/4 animate-pulse rounded-full bg-tile" />
          <div className="h-3 w-2/3 animate-pulse rounded-full bg-tile" />
        </div>
        <span className="sr-only">Loading quote prices</span>
      </div>
    );
  } else if (error || !preview || !market) {
    hero = (
      <div className="tile-risk flex gap-3 p-5 text-sm text-ink-2" role="alert">
        <InfoIcon size={20} className="mt-px shrink-0 text-risk" />
        <div>
          <p className="font-bold text-ink">Preview unavailable</p>
          <p className="mt-1 leading-relaxed">{error ?? "Select a quote asset to see the preview."}</p>
        </div>
      </div>
    );
  } else {
    hero = (
      <MidnightCard
        title="Floor at graduation"
        subtitle={`$${displaySymbol} · est. per token`}
        headingLevel={3}
        minHeight={300}
        cta={
          <NotchedCta
            href="#launch-submit"
            aria-label="Go to the launch button"
            icon={<ArrowDownIcon size={18} strokeWidth={2.2} />}
          >
            Launch
          </NotchedCta>
        }
        gauge={
          <Gauge
            value={vaultSharePct / 100}
            label={`${vaultSharePct}%`}
            caption="Vault share"
            ariaLabel={`${vaultSharePct}% of the raise goes to the vault`}
          />
        }
      >
        <MidnightValue value={floorText} size={floorText.length > 12 ? "md" : "lg"} />
        <p className="mt-3 text-sm leading-relaxed text-on-dark">
          per token, backed by{" "}
          <span className="tnum font-bold text-mint">
            {formatTokenAmount(preview.vaultAtGraduationQuoteRaw, market.asset.decimals, {
              multiplier: market.multiplier,
            })}{" "}
            {quoteSymbol}
          </span>{" "}
          <span className="whitespace-nowrap">(≈ {formatUsd(quoteRawToUsd(preview.vaultAtGraduationQuoteRaw, market))})</span>{" "}
          in the vault
        </p>
        <p className="tnum mt-2 text-sm text-on-dark">
          <b className="text-mint">{formatUsd(preview.floorPer100AtListingUsd)}</b> back per $100 bought at listing
        </p>
      </MidnightCard>
    );
  }

  return (
    <section
      aria-labelledby="preview-heading"
      aria-live="polite"
      className="max-lg:contents lg:flex lg:h-full lg:flex-col lg:gap-6"
    >
      {/* In flow on desktop; after the form on a phone. */}
      <div className={`space-y-5 max-lg:order-4 max-lg:mt-8 ${MOBILE_GUTTER}`}>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id="preview-heading" className="heading text-ink">
            Live preview
          </h2>
          <Pill tone="presale" dot size="sm">
            Presale
          </Pill>
        </div>

        {/* The token as its page will look: cover from the logo, the logo tile over its edge. */}
        <div className="card overflow-hidden">
          <TokenCover symbol={displaySymbol} imageUrl={imageUrl} className="h-[76px]" />
          <div className="flex items-end gap-3.5 px-5 pb-5">
            <div className="-mt-7 shrink-0">
              <TokenAvatar symbol={displaySymbol} imageUrl={imageUrl} size={60} ring />
            </div>
            <div className="min-w-0 pt-3">
              <h3 className="card-title truncate text-[20px] leading-tight text-ink">{name.trim() || "Your token"}</h3>
              <p className="meta-violet mt-0.5 truncate">
                ${displaySymbol}
                {quoteSymbol ? ` · ${quoteSymbol}` : ""} · {preset === "gentle" ? "Gentle" : "Flat"} curve
              </p>
            </div>
          </div>
        </div>

        {ready && preview && market ? (
          <div className="rail-section">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="card-title text-lg text-ink">Price path</h3>
              <span className="text-xs text-ink-3">illustrative</span>
            </div>
            <div className="tile-soft mt-3 px-4 pb-4 pt-3">
              <CurveSketch
                startPriceUsd={preview.startPriceUsd}
                graduationPriceUsd={preview.graduationPriceUsd}
                floorUsd={preview.floorAtGraduationUsd}
              />
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-2 flex justify-between text-xs text-ink-3">
                  <span>Floor vs. graduation price</span>
                  <span className="font-semibold text-risk">at risk</span>
                </p>
                <FloorMeter
                  compact
                  priceUsd={preview.graduationPriceUsd}
                  floorUsd={preview.floorAtGraduationUsd}
                  maxLoss={preview.maxLossAtGraduationPrice}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Sticky on desktop so the floor and the max loss stay in view; on a phone the card goes above the form. */}
      <div className="max-lg:contents lg:sticky lg:top-8 lg:space-y-6">
        <div className={`max-lg:order-2 max-lg:mt-5 ${MOBILE_GUTTER}`}>{hero}</div>

        {ready && preview && market ? (
          <div className={`rail-section max-lg:order-5 max-lg:mt-5 max-lg:mb-10 ${MOBILE_GUTTER}`}>
            <h3 className="card-title text-lg text-ink">Key numbers</h3>
            <dl className="mt-1 divide-y divide-line">
              <Row label="Graduation threshold" sub={thresholdUsd !== null ? `≈ ${formatUsd(thresholdUsd)}` : EMPTY}>
                {formatTokenAmount(preview.thresholdQuoteRaw, market.asset.decimals, {
                  multiplier: market.multiplier,
                })}{" "}
                {quoteSymbol}
              </Row>
              <Row label="Supply at graduation">
                {formatTokenAmount(preview.baseSupplyAtGraduationRaw, BASE_DECIMALS, { compact: true })}
              </Row>
              <Row label="Floor vs graduation price">
                {preview.graduationPriceUsd > 0
                  ? formatPercent(preview.floorAtGraduationUsd / preview.graduationPriceUsd)
                  : "—"}
              </Row>
            </dl>
            <div className="mt-2 rounded-[14px] bg-floor-wash px-3.5 py-3">
              <dl className="flex items-baseline justify-between gap-4">
                <dt className="text-sm font-semibold text-floor-strong">Floor per $100 at listing</dt>
                <dd className="tnum text-[17px] font-extrabold text-floor">
                  {formatUsd(preview.floorPer100AtListingUsd)}
                </dd>
              </dl>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">
                What $100 of tokens bought at the listing price redeems for at the floor right after graduation, after
                the {formatPercent(exitFeeBps / 10_000)} exit fee. Not a guarantee: the floor only rises, but in USD it
                moves with {market.asset.underlying}.
              </p>
            </div>
            <dl className="mt-1 divide-y divide-line">
              <Row
                label={`Price move on a ${formatUsdWhole(PRICE_MOVE_BUY_USD)} buy`}
                sub={`into the ${formatUsd(preview.poolQuoteAtGraduationUsd, { compact: true })} pool, before its fee`}
              >
                {formatPercent(priceMoveOnBuy(preview, PRICE_MOVE_BUY_USD), { signed: true })}
              </Row>
            </dl>
            <div className="mt-2 flex items-baseline justify-between gap-4 rounded-[14px] bg-risk-wash px-3.5 py-3">
              <p className="text-sm font-semibold text-risk-strong">Max loss at graduation price</p>
              <p className="tnum text-[15px] font-extrabold text-risk">
                {formatMaxLoss(preview.maxLossAtGraduationPrice)}
              </p>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
              A buyer at the graduation price can lose up to {formatPercent(preview.maxLossAtGraduationPrice)} if the
              market falls to the floor. The floor also moves with {market.asset.underlying} in USD.{" "}
              <span className="font-semibold text-ink-2">The floor protects from zero, not from loss.</span>
            </p>

            <h3 className="card-title mt-6 text-lg text-ink">At graduation</h3>
            <dl className="mt-1 divide-y divide-line">
              <Row label={`Floor vault (${preview.vaultSharePct}%)`}>{formatUsd(preview.vaultAtGraduationUsd)}</Row>
              <Row label={`Locked pool (${preview.poolSharePct}%)`}>{formatUsd(preview.poolQuoteAtGraduationUsd)}</Row>
              <Row label={`Platform (${PLATFORM_GRADUATION_FEE_PCT}%)`}>{formatUsd(preview.platformGraduationFeeUsd)}</Row>
              <Row label={`Creator bonus (${CREATOR_GRADUATION_BONUS_PCT}%)`}>
                {formatUsd(preview.creatorGraduationBonusUsd)}
              </Row>
            </dl>

            <h3 className="card-title mt-6 text-lg text-ink">Fees</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-2">
              {[FEE_COPY.presale, FEE_COPY.graduation, FEE_COPY.trading, FEE_COPY.exit].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={`text-[13px] text-ink-3 max-lg:order-5 max-lg:mb-10 max-lg:mt-4 ${MOBILE_GUTTER}`}>
            The floor protects from zero, not from loss.
          </p>
        )}
      </div>
    </section>
  );
}
