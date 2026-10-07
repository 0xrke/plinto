"use client";

import { useCallback, useId, type KeyboardEvent } from "react";
import { useStoryState } from "../scroll/StoryState";
import { coinLetters, QUOTE_ASSETS, quoteAssetLabel, type QuoteAsset } from "../scroll/quoteAssets";
import { PICKER_LEGEND, PICKER_ROWS, tracksLine, VOLATILE_NOTE } from "./whyStocks.copy";

/** The quote asset's coin: a midnight disc with up to three mint letters (the app's QuoteCoin, without the SDK type). */
export function Coin({ symbol, size = 22, className = "" }: { symbol: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-midnight font-extrabold text-mint ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.37)) }}
    >
      {coinLetters(symbol).toUpperCase()}
    </span>
  );
}

const ROWS: ReadonlyArray<{ calm: boolean; label: string }> = [
  { calm: true, label: PICKER_ROWS.calm },
  { calm: false, label: PICKER_ROWS.volatile },
];

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * "Floor asset": eight native radios (one tab stop, arrow keys move the pick) inside label chips,
 * calm index trackers first, then single stocks. The pick changes labels downstream, never the
 * math. Arrow keys are handled here too so the order is the visual one (calm row, then volatile)
 * in every browser.
 */
export function StockPicker() {
  const { asset, setSymbol } = useStoryState();
  const rowId = useId();

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLFieldSetElement>) => {
      const step = NEXT_KEYS[e.key];
      const t = e.target;
      if (!step || !(t instanceof HTMLInputElement) || t.type !== "radio") return;
      e.preventDefault();
      const i = QUOTE_ASSETS.findIndex((a) => a.symbol === t.value);
      const next = QUOTE_ASSETS[(i + step + QUOTE_ASSETS.length) % QUOTE_ASSETS.length]!;
      setSymbol(next.symbol);
      e.currentTarget.querySelector<HTMLInputElement>(`input[value="${next.symbol}"]`)?.focus();
    },
    [setSymbol],
  );

  return (
    <div className="mt-4">
      <fieldset onKeyDown={onKeyDown} className="min-w-0">
        <legend className="text-[14px] font-semibold text-ink">{PICKER_LEGEND}</legend>
        {/* Each row is a named group, so screen readers hear "Calm" / "Volatile" with the chip. */}
        {ROWS.map((row) => (
          <div key={row.label} role="group" aria-labelledby={`${rowId}-${row.calm ? "calm" : "volatile"}`} className="mt-3">
            <p id={`${rowId}-${row.calm ? "calm" : "volatile"}`} className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
              {row.label}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {QUOTE_ASSETS.filter((a) => a.calm === row.calm).map((a) => (
                <AssetChip key={a.symbol} a={a} checked={a.symbol === asset.symbol} onPick={setSymbol} />
              ))}
            </div>
          </div>
        ))}
      </fieldset>
      <p className="mt-3 text-[14px] text-ink-2">
        {tracksLine(asset)}
        {asset.calm ? null : <span className="mt-1 block text-risk">{VOLATILE_NOTE}</span>}
      </p>
    </div>
  );
}

function AssetChip({ a, checked, onPick }: { a: QuoteAsset; checked: boolean; onPick: (s: string) => void }) {
  return (
    <label
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-[14px] font-semibold transition-colors motion-reduce:transition-none has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-violet ${
        checked
          ? "border-midnight bg-midnight text-white ring-2 ring-mint"
          : "border-line-strong bg-surface text-ink hover:border-violet"
      }`}
    >
      <input
        type="radio"
        name="floor-asset"
        value={a.symbol}
        checked={checked}
        onChange={() => onPick(a.symbol)}
        aria-label={quoteAssetLabel(a)}
        className="sr-only"
      />
      <Coin symbol={a.symbol} size={22} className={checked ? "ring-1 ring-mint/60" : ""} />
      {a.symbol}
    </label>
  );
}
