"use client";

import type { ReactNode } from "react";

export function AmountField({
  id,
  label,
  value,
  onChange,
  suffix,
  error,
  hint,
  onMax,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Token symbol or a small select rendered inside the field on the right. */
  suffix: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  onMax?: () => void;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <div
        className={`field-soft focus-within:outline-2 focus-within:outline-focus ${
          error ? "outline-2 outline-risk" : ""
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-[13px] text-ink-3">
            {label}
          </label>
          {onMax ? (
            <button
              type="button"
              onClick={onMax}
              className="-my-2 min-h-8 rounded-lg px-2 text-xs font-bold text-violet hover:bg-lilac"
            >
              Max
            </button>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2.5">
          <input
            id={id}
            className="tnum h-11 min-w-0 flex-1 bg-transparent p-0 text-[28px] font-extrabold text-ink outline-none placeholder:text-ink-3/50"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="shrink-0 text-sm font-bold text-ink">{suffix}</div>
        </div>
        {!error && hint ? (
          <p id={`${id}-hint`} className="tnum text-[13px] text-ink-3">
            {hint}
          </p>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 px-1 text-sm font-medium text-risk">
          {error}
        </p>
      ) : null}
    </div>
  );
}
