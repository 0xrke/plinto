import Link from "next/link";
import { LANDING_ROUTES } from "@/lib/landing/routes";
import styles from "./landing.module.css";
import { GET_STARTED_ID } from "./scroll/anchors";

// The risk line sits above every buy button (docs/DECISIONS.md, 2026-10-07).
export function ClosingCta() {
  return (
    <section
      id={GET_STARTED_ID}
      aria-labelledby="cta-title"
      className={`card-midnight relative overflow-hidden px-6 py-10 sm:px-12 sm:py-14 ${styles.reveal}`}
    >
      {/* The logo's floor and price line without its tile, as a watermark. */}
      <svg
        viewBox="0 0 64 64"
        aria-hidden
        focusable="false"
        className="absolute -right-4 -bottom-4 hidden h-44 w-44 opacity-10 sm:block"
      >
        <path d="M14 50.5h36v-8l-36 4.5z" fill="#ffffff" stroke="#ffffff" strokeWidth="4" strokeLinejoin="round" />
        <path d="M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 id="cta-title" tabIndex={-1} className="display relative max-w-[640px] text-[32px] text-white sm:text-[44px]">
        See your max loss before you buy.
      </h2>
      <div className="relative mt-7 grid gap-3 sm:flex">
        <Link href={LANDING_ROUTES.app} className="btn btn-butter w-full sm:w-auto">
          Open app
        </Link>
        <Link
          href={LANDING_ROUTES.create}
          className="btn w-full border border-midnight-line text-on-dark-2 hover:text-white sm:w-auto"
        >
          Launch a token
        </Link>
      </div>
    </section>
  );
}
