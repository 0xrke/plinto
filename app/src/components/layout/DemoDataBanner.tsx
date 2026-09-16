"use client";

import { useState } from "react";
import { LIVE_APP_URL } from "@/lib/config";
import { useData } from "@/lib/data/context";

/**
 * Says in plain words that the launches on screen are invented, whenever the app runs on the mock
 * data source. The header badge alone is not enough: it is hidden below the md breakpoint, and a
 * visitor who does not know the product reads four token cards as real tokens.
 */
export function DemoDataBanner() {
  const { dataSource } = useData();
  const [dismissed, setDismissed] = useState(false);
  if (dataSource.kind !== "mock" || dismissed) return null;

  return (
    <div role="status" className="mb-6 flex flex-wrap items-start gap-3 rounded-xl border border-graduating/40 bg-graduating-soft px-4 py-3 text-sm text-ink-2">
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-ink">Preview with example launches.</span> The tokens below are made up and
        this build is not connected to a chain, so buying, redeeming and the crank are switched off.
        {LIVE_APP_URL ? (
          <>
            {" "}
            The live app is at{" "}
            <a href={LIVE_APP_URL} className="font-medium text-brand underline underline-offset-2">
              {LIVE_APP_URL.replace(/^https?:\/\//, "")}
            </a>
            .
          </>
        ) : null}
      </p>
      <button type="button" className="btn btn-secondary shrink-0 px-3 py-1 text-xs" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  );
}
