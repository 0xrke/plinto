import type { ReactNode } from "react";
import type { PayToken } from "@/lib/data/types";
import { QuoteCoin } from "@/components/ui/QuoteChip";
import { ArrowDownIcon, InfoIcon } from "@/components/ui/icons";

/*
 * Pieces shared by the market and curve trade panels, drawn after the Pastel trade panel: the
 * token picker chip, the round arrow between "You pay" and "You receive", the receive tile and the
 * detail rows.
 */

function PayCoin({ token, quoteSymbol }: { token: PayToken; quoteSymbol: string }) {
  if (token === "QUOTE") return <QuoteCoin symbol={quoteSymbol} />;
  return (
    <span
      aria-hidden
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold text-white ${
        token === "USDC" ? "bg-[#2775ca]" : "bg-[linear-gradient(135deg,#9945ff,#14c98f)]"
      }`}
    >
      {token === "USDC" ? "$" : "SOL"}
    </span>
  );
}

/**
 * A native <select> laid invisibly over the chip, so it keeps the platform picker and its label
 * while the chip shows the coin and symbol.
 */
export function TokenPicker({
  value,
  onChange,
  quoteSymbol,
  routingAvailable,
  id,
  ariaLabel,
}: {
  value: PayToken;
  onChange: (token: PayToken) => void;
  quoteSymbol: string;
  routingAvailable: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  const label = (t: PayToken) => (t === "QUOTE" ? quoteSymbol : t);
  return (
    <span className="relative inline-flex h-9 items-center gap-[7px] rounded-full border border-line-strong bg-surface pl-1.5 pr-7 text-sm font-bold text-ink focus-within:outline-2 focus-within:outline-focus">
      <PayCoin token={value} quoteSymbol={quoteSymbol} />
      <span aria-hidden>{label(value)}</span>
      <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="absolute right-2.5 text-ink-3">
        <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as PayToken)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
      >
        {(["QUOTE", "USDC", "SOL"] as const).map((t) => (
          <option key={t} value={t} disabled={t !== "QUOTE" && !routingAvailable}>
            {label(t)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The launch token's own chip in a field ("$HRBR"). */
export function BaseChip({ symbol }: { symbol: string }) {
  return (
    <span className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-3 text-sm font-bold text-ink">
      ${symbol}
    </span>
  );
}

/** The round arrow between the pay and receive tiles. */
export function SwapArrow() {
  return (
    <div className="relative z-10 -my-2 flex justify-center">
      <span
        aria-hidden
        className="flex h-[34px] w-[34px] items-center justify-center rounded-xl border-[3px] border-surface bg-surface text-violet shadow-[0_0_0_1px_var(--color-line-strong)]"
      >
        <ArrowDownIcon size={16} />
      </span>
    </div>
  );
}

/**
 * "You receive" tile. `text` is the full amount as one string (what screen readers and tests read);
 * when it ends with `unit`, the unit is drawn smaller next to the number.
 */
export function ReceiveTile({ label, text, unit, action }: { label: string; text: string; unit?: string; action?: ReactNode }) {
  const split = unit && text.endsWith(` ${unit}`) ? [text.slice(0, -unit.length - 1), unit] : [text, null];
  return (
    <div className="field-soft" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">{label}</p>
        {action}
      </div>
      <p className="tnum mt-1 text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-ink sm:text-2xl">
        <span className="sr-only">{text}</span>
        <span aria-hidden>
          {split[0]}
          {split[1] ? <span className="ml-1.5 text-[15px] font-bold text-ink-2">{split[1]}</span> : null}
        </span>
      </p>
    </div>
  );
}

/** One label/value line under the trade tiles. */
export function DetailRow({ label, children, valueClassName = "" }: { label: ReactNode; children: ReactNode; valueClassName?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className={`tnum text-right font-bold text-ink ${valueClassName}`}>{children}</dd>
    </div>
  );
}

/** The rose "Max loss for this buy" line. */
export function RiskRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-0.5 flex items-center justify-between gap-3 rounded-[14px] bg-risk-wash px-3 py-2.5">
      <dt className="font-semibold text-risk-strong">{label}</dt>
      <dd className="tnum shrink-0 text-right font-extrabold text-risk">{children}</dd>
    </div>
  );
}

/**
 * The buy button's required sentence ("Price $X · Floor $Y · Max loss if you buy now: −Z%"), set on
 * two lines: price and floor small on top, the max loss as the bold line. The text content stays the
 * exact sentence (the separator between the lines is kept for screen readers and copy).
 */
export function BuyButtonLabel({ label }: { label: string }) {
  const cut = label.lastIndexOf(" · ");
  if (cut < 0) return <>{label}</>;
  return (
    <span className="flex flex-col items-center gap-0.5 leading-tight">
      <span className="tnum text-[12.5px] font-semibold opacity-90">{label.slice(0, cut)}</span>
      <span className="sr-only"> · </span>
      <span className="tnum text-[15.5px] font-extrabold">{label.slice(cut + 3)}</span>
    </span>
  );
}

/** One short muted line under a trade button, with the full fine print one click away. */
export function FinePrint({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group text-[12.5px] leading-normal text-ink-3">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg [&::-webkit-details-marker]:hidden">
        <InfoIcon size={14} className="shrink-0 text-violet" />
        <span>{summary}</span>
        <span className="ml-auto shrink-0 font-semibold text-violet group-open:hidden">Details</span>
        <span className="ml-auto hidden shrink-0 font-semibold text-violet group-open:inline">Hide</span>
      </summary>
      <div className="mt-1.5 space-y-1.5 rounded-[14px] bg-cloud px-3.5 py-3 text-ink-2">{children}</div>
    </details>
  );
}
