import type { Volatility } from "@stockfloor/sdk";

export function volatilityLabel(volatility: Volatility): string {
  return volatility === "calm" ? "Calm" : "Volatile";
}

/** Tiny uppercase tag: CALM on violet, VOLATILE on rose. */
export function VolatilityTag({ volatility }: { volatility: Volatility }) {
  return (
    <span
      className={`rounded-full px-[7px] py-0.5 text-[10.5px] font-bold uppercase leading-none tracking-[0.06em] ${
        volatility === "calm" ? "bg-violet-soft text-violet-strong" : "bg-risk-soft text-risk-strong"
      }`}
    >
      {volatilityLabel(volatility)}
    </span>
  );
}

/** The quote asset's coin: a midnight disc with the first three letters in mint ("SPY"). */
export function QuoteCoin({ symbol, size = 24 }: { symbol: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-midnight font-extrabold text-mint"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.37)) }}
    >
      {symbol.replace(/x$/, "").slice(0, 3).toUpperCase()}
    </span>
  );
}

/**
 * White chip naming the quote asset: "[prefix] SPYx CALM". `coin` adds the coin disc in front (the
 * token picker look from the trade panel).
 */
export function QuoteChip({
  symbol,
  volatility,
  prefix,
  coin = false,
}: {
  symbol: string;
  volatility?: Volatility;
  /** Leading grey word inside the chip, e.g. "Quote". */
  prefix?: string;
  coin?: boolean;
}) {
  return (
    <span className={`chip ${coin ? "pl-[5px]" : ""}`}>
      {coin ? <QuoteCoin symbol={symbol} /> : null}
      {prefix ? <span>{prefix}</span> : null}
      <b>{symbol}</b>
      {volatility ? <VolatilityTag volatility={volatility} /> : null}
    </span>
  );
}
