import Link from "next/link";
import { Wordmark } from "@/components/layout/LogoMark";
import { ChevronRightIcon } from "@/components/ui/icons";

/** Rendered under the root layout only (no app shell), so it carries its own window, like /waitlist. */
export default function NotFound() {
  return (
    <div className="min-h-dvh p-3 sm:p-6 lg:p-10">
      <div className="window flex min-h-[calc(100dvh-1.5rem)] flex-col rounded-[28px] px-5 pt-5 sm:min-h-[calc(100dvh-3rem)] sm:rounded-[36px] sm:px-10 sm:pt-8 lg:min-h-[calc(100dvh-5rem)] lg:rounded-window lg:px-12">
        <Link href="/" className="self-start rounded-xl">
          <Wordmark size="md" />
        </Link>
        <main id="main" className="mx-auto my-auto max-w-xl py-10 text-center lg:py-20">
          <p className="eyebrow">Error 404</p>
          <h1 className="display mt-2 text-[2.5rem] text-ink sm:text-5xl">Page not found</h1>
          <p className="mt-4 text-base leading-relaxed text-ink-2">The page you are looking for does not exist.</p>
          <Link href="/app" className="btn btn-primary mt-7">
            Back to launches
            <ChevronRightIcon size={16} strokeWidth={2} />
          </Link>
        </main>
      </div>
    </div>
  );
}
