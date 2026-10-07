import type { ReactNode } from "react";
import { METEORA_KEEPER_MIN_THRESHOLD_USD, type LaunchPreview } from "@stockfloor/sdk";
import type { QuoteMarket } from "@/lib/data/types";
import {
  CREATOR_GRADUATION_BONUS_PCT,
  FEE_COPY,
  LP_FEE_SPLIT_PCT,
  PLATFORM_GRADUATION_FEE_PCT,
  PRICE_MOVE_BUY_USD,
} from "@/lib/config";
import { formatUsdWhole, priceMoveOnBuy } from "@/lib/launchForm";
import { EMPTY, formatMaxLoss, formatPercent, formatTokenAmount, formatUsd } from "@/lib/format";
import { Gauge } from "@/components/ui/Gauge";
import { MidnightCard, MidnightValue } from "@/components/ui/MidnightCard";
import { Details } from "@/components/ui/Details";
import { InfoIcon } from "@/components/ui/icons";
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
 * The live preview of a launch. Desktop: the rail, with the token card in flow and the midnight floor
 * card plus the key numbers sticky, so the floor and the max loss stay in view while the form scrolls.
 * Everything that explains the numbers sits in one closed "How it works" disclosure. Below lg the section is `display: contents` and its blocks are ordered into the page:
 * the midnight card right after the intro (order 2), the rest after the form (orders 4 and 5).
 */
export function LaunchPreviewPanel({
  preview,
  error,
  loading,
  market,
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
  vaultSharePct: number;
  /** Graduation threshold the preview was computed with; null when the form value is not usable. */
  thresholdUsd: number | null;
  name: string;
  symbol: string;
  /** Image for the avatar (the picked file's object URL, or a direct image URL), or null. */
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
        subtitle="per token, est."
        headingLevel={3}
        minHeight={0}
        gauge={
          <Gauge
            value={vaultSharePct / 100}
            label={`${vaultSharePct}%`}
            caption="Floor share"
            ariaLabel={`${vaultSharePct}% of the raise goes to the vault`}
          />
        }
      >
        <MidnightValue value={floorText} size={floorText.length > 12 ? "md" : "lg"} />
        <p className="tnum mt-3 text-sm text-on-dark">
          <b className="text-mint">{formatUsd(preview.floorPer100AtListingUsd)}</b> floor per $100 · after the{" "}
          {formatPercent(exitFeeBps / 10_000)} exit fee
        </p>
      </MidnightCard>
    );
  }

  return (
    <section aria-labelledby="preview-heading" className="max-lg:contents lg:flex lg:h-full lg:flex-col lg:gap-6">
      {/* One short live line instead of a live region over the whole rail (which re-read ~300 words per keystroke). */}
      <p role="status" className="sr-only">
        {ready && preview ? `Estimated floor at graduation: ${floorText} per token.` : ""}
      </p>
      {/* In flow on desktop; after the form on a phone. */}
      <div className={`space-y-5 max-lg:order-4 max-lg:mt-8 ${MOBILE_GUTTER}`}>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id="preview-heading" className="heading text-ink">
            Preview
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
                {quoteSymbol ? ` · ${quoteSymbol}` : ""}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky on desktop so the floor and the max loss stay in view; on a phone the card goes above the form. */}
      <div className="max-lg:contents lg:sticky lg:top-8 lg:space-y-6">
        <div className={`max-lg:order-2 max-lg:mt-5 ${MOBILE_GUTTER}`}>{hero}</div>

        {ready && preview && market ? (
          <div className={`rail-section max-lg:order-5 max-lg:mt-5 max-lg:mb-10 ${MOBILE_GUTTER}`}>
            <h3 className="card-title text-lg text-ink">Key numbers</h3>
            <dl className="mt-1 divide-y divide-line">
              <Row label="Raise target" sub={thresholdUsd !== null ? `≈ ${formatUsd(thresholdUsd)}` : EMPTY}>
                {formatTokenAmount(preview.thresholdQuoteRaw, market.asset.decimals, {
                  multiplier: market.multiplier,
                })}{" "}
                {quoteSymbol}
              </Row>
              <Row label={`Price move on a ${formatUsdWhole(PRICE_MOVE_BUY_USD)} buy`}>
                {formatPercent(priceMoveOnBuy(preview, PRICE_MOVE_BUY_USD), { signed: true })}
              </Row>
            </dl>
            <dl className="mt-2 flex items-baseline justify-between gap-4 rounded-[14px] bg-risk-wash px-3.5 py-3">
              <dt className="text-sm font-semibold text-risk-strong">Max loss at graduation price</dt>
              <dd className="tnum text-[15px] font-extrabold text-risk">
                {formatMaxLoss(preview.maxLossAtGraduationPrice)}
              </dd>
            </dl>
            <p className="mt-3 text-[13px] font-semibold text-ink-2">The floor protects from zero, not from loss.</p>

            <Details summary="How it works" className="mt-4 border-t border-line pt-2">
              <div className="space-y-5 pb-1 pt-2">
                <div className="tile-soft px-4 pb-4 pt-3">
                  <CurveSketch
                    startPriceUsd={preview.startPriceUsd}
                    graduationPriceUsd={preview.graduationPriceUsd}
                    floorUsd={preview.floorAtGraduationUsd}
                  />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-ink">At graduation</h4>
                  <dl className="mt-1 divide-y divide-line">
                    <Row label={`Floor vault (${preview.vaultSharePct}%)`}>{formatUsd(preview.vaultAtGraduationUsd)}</Row>
                    <Row label={`Locked pool (${preview.poolSharePct}%)`}>{formatUsd(preview.poolQuoteAtGraduationUsd)}</Row>
                    <Row label={`Platform (${PLATFORM_GRADUATION_FEE_PCT}%)`}>
                      {formatUsd(preview.platformGraduationFeeUsd)}
                    </Row>
                    <Row label={`Creator bonus (${CREATOR_GRADUATION_BONUS_PCT}%)`}>
                      {formatUsd(preview.creatorGraduationBonusUsd)}
                    </Row>
                  </dl>
                </div>
                <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-2">
                  {[FEE_COPY.presale, FEE_COPY.graduation, FEE_COPY.trading, FEE_COPY.exit].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  <li>
                    The creator earns only if the token graduates: {CREATOR_GRADUATION_BONUS_PCT}% of the raise, then{" "}
                    {LP_FEE_SPLIT_PCT.creator}% of the pool&apos;s trading fees. No team allocation.
                  </li>
                  <li>
                    Floor per $100: what $100 of tokens bought at the listing price redeems for right after graduation,
                    after the {formatPercent(exitFeeBps / 10_000)} exit fee (the max loss is before it). In USD the floor moves with{" "}
                    {market.asset.underlying}.
                  </li>
                  <li>
                    Below a raise target of about {formatUsdWhole(METEORA_KEEPER_MIN_THRESHOLD_USD)}, Meteora&apos;s
                    keeper does not migrate the pool; anyone can run the crank on the token page instead.
                  </li>
                </ul>
              </div>
            </Details>
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
