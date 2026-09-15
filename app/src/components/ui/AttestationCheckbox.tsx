"use client";

import { useAttestation } from "@/lib/attestation";

/**
 * The non-US self-attestation (brief: eligibility control). One shared state for the whole app, so
 * ticking it on a token page or on /create applies everywhere.
 */
export function AttestationCheckbox({ className = "" }: { className?: string }) {
  const { attested, setAttested } = useAttestation();
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-sunken/60 p-3 text-sm ${className}`}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
      <span className="text-ink">
        I confirm that I am not a US person, and that I am not located in or a resident of a jurisdiction where xStocks
        or this product are restricted.
      </span>
    </label>
  );
}
