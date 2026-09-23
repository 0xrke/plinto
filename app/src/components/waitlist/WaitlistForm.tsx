"use client";

import { useState } from "react";

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
      <p className="max-w-md rounded-2xl border border-floor-soft bg-floor-soft/60 px-4 py-3 text-sm text-floor-strong">
        You are on the list. We will write once, when launches open.
      </p>
    );
  }

  return (
    <div>
      <form onSubmit={submit} noValidate className="flex max-w-md flex-wrap gap-2">
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <input
          id="waitlist-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@domain.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 basis-56 rounded-full border border-line bg-surface px-5 py-3 text-[0.95rem] text-ink shadow-sm outline-none placeholder:text-ink-3/70 focus-visible:ring-2 focus-visible:ring-focus"
        />
        <button
          type="submit"
          disabled={state.kind === "saving"}
          className="rounded-full bg-floor px-6 py-3 text-[0.95rem] font-medium text-white shadow-sm transition hover:bg-floor-strong disabled:opacity-55"
        >
          {state.kind === "saving" ? "Saving…" : "Join the waitlist"}
        </button>
      </form>
      <p
        role="status"
        aria-live="polite"
        className={`mt-3 text-xs ${state.kind === "error" ? "text-risk" : "text-ink-3"}`}
      >
        {state.kind === "error" ? state.message : "One email when launches open. Nothing else."}
      </p>
    </div>
  );
}
