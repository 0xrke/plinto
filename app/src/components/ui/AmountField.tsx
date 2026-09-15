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
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {onMax ? (
          <button type="button" onClick={onMax} className="text-xs font-semibold text-brand hover:underline">
            Max
          </button>
        ) : null}
      </div>
      <div
        className={`flex items-center rounded-[0.625rem] border bg-surface focus-within:outline-2 focus-within:outline-focus ${
          error ? "border-risk" : "border-line-strong"
        }`}
      >
        <input
          id={id}
          className="tnum min-w-0 flex-1 rounded-l-[0.625rem] bg-transparent px-3 py-2.5 text-lg text-ink outline-none placeholder:text-[#8a929b]"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="shrink-0 pr-2 text-sm font-semibold text-ink-2">{suffix}</div>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-risk">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
