import Link from "next/link";
import { PageColumns } from "@/components/layout/PageColumns";
import { ChevronRightIcon } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <PageColumns
      main={
        <div className="mx-auto max-w-xl py-10 text-center lg:py-20">
          <p className="eyebrow">Error 404</p>
          <h1 className="display mt-2 text-[2.5rem] text-ink sm:text-5xl">Page not found</h1>
          <p className="mt-4 text-base leading-relaxed text-ink-2">The page you are looking for does not exist.</p>
          <Link href="/" className="btn btn-primary mt-7">
            Back to launches
            <ChevronRightIcon size={16} strokeWidth={2} />
          </Link>
        </div>
      }
    />
  );
}
