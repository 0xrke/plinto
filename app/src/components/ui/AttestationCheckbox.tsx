"use client";

import { useAttestation } from "@/lib/attestation";

/**
 * The non-US self-attestation (brief: eligibility control). One shared state for the whole app, so
 * ticking it on a token page or on /create applies everywhere.
 */
export function AttestationCheckbox({ className = "" }: { className?: string }) {
  const { attested, setAttested } = useAttestation();
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[18px] bg-cloud p-3.5 text-[13px] leading-relaxed ${className}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-floor"
        checked={attested}
        onChange={(e) => setAttested(e.target.checked)}
      />
      <span className="text-ink-2">
        I confirm that I am not a US person, and that I am not located in or a resident of a jurisdiction where xStocks
        or this product are restricted.
      </span>
    </label>
  );
}
