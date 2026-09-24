"use client";

import { useState } from "react";
import { CheckIcon, ChevronRightIcon, MailIcon } from "@/components/ui/icons";

type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const VALID = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!VALID.test(value)) {
      setState({ kind: "error", message: "That address looks incomplete — check it and try again." });
      return;
    }

    setState({ kind: "saving" });
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (response.ok) {
        setState({ kind: "done" });
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setState({ kind: "error", message: body?.error ?? "Could not save that — try again in a moment." });
    } catch {
      setState({ kind: "error", message: "Could not reach the server — try again in a moment." });
    }
  }

  if (state.kind === "done") {
    return (
      <p className="flex min-h-16 items-center gap-3 rounded-field bg-floor-wash px-4 py-3 text-[15px] font-semibold text-floor-strong ring-1 ring-floor-soft">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-floor text-white">
          <CheckIcon size={18} strokeWidth={2.4} />
        </span>
        You are on the list. We will write once, when launches open.
      </p>
    );
  }

  const error = state.kind === "error";

  return (
    <form onSubmit={submit} noValidate>
      <div
        className={`flex flex-wrap items-center gap-1.5 rounded-field border bg-surface p-[7px] shadow-[0_1px_2px_rgba(40,30,110,.05),0_18px_36px_-22px_rgba(60,40,150,.35)] transition-colors sm:h-16 sm:flex-nowrap sm:pl-5 ${
          error ? "border-risk-line" : "border-line-strong focus-within:border-violet"
        }`}
      >
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <span aria-hidden className={`ml-3 sm:ml-0 ${error ? "text-risk" : "text-violet"}`}>
          <MailIcon size={19} strokeWidth={1.6} />
        </span>
        <input
          id="waitlist-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@domain.com"
          value={email}
          aria-invalid={error || undefined}
          aria-describedby="waitlist-status"
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 min-w-0 flex-1 bg-transparent px-2 text-[16px] text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={state.kind === "saving"}
          className="flex h-[50px] w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[16px] bg-floor px-[22px] text-[15px] font-bold text-white shadow-cta transition hover:bg-floor-strong disabled:opacity-60 sm:w-auto"
        >
          {state.kind === "saving" ? "Saving…" : "Join the waitlist"}
          <ChevronRightIcon size={15} strokeWidth={2.2} />
        </button>
      </div>
      <p
        id="waitlist-status"
        role="status"
        aria-live="polite"
        className={`ml-1.5 mt-3 text-[13px] ${error ? "font-semibold text-risk" : "text-ink-3"}`}
      >
        {error ? state.message : "One email when launches open. Nothing else."}
      </p>
    </form>
  );
}
