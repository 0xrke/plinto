import type { Volatility } from "@stockfloor/sdk";

export function volatilityLabel(volatility: Volatility): string {
  return volatility === "calm" ? "Calm" : "Volatile";
}

export function VolatilityTag({ volatility }: { volatility: Volatility }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide ${
        volatility === "calm" ? "bg-floor-soft text-floor-strong" : "bg-risk-soft text-risk"
      }`}
    >
      {volatilityLabel(volatility)}
    </span>
  );
}

export function QuoteChip({ symbol, volatility }: { symbol: string; volatility?: Volatility }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-2">
      <span className="font-semibold text-ink">{symbol}</span>
      {volatility ? <VolatilityTag volatility={volatility} /> : null}
    </span>
  );
}
