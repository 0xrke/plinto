import type { Metadata } from "next";
import Link from "next/link";
import { CreateLaunchForm } from "@/components/create/CreateLaunchForm";
import { ChevronRightIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Launch a token",
};

export default function CreatePage() {
  // CreateLaunchForm renders the PageColumns root: the form in the main column, the live preview in the rail.
  return (
    <CreateLaunchForm
      intro={
        <header className="mb-5 max-w-[640px]">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 text-[15px] text-ink-3">
              <li>
                <Link href="/#launches" className="hover:text-ink">
                  Launches
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRightIcon size={14} />
              </li>
              <li aria-current="page" className="text-ink-2">
                Create
              </li>
            </ol>
          </nav>
          <h1 className="display mt-4 text-balance text-[36px] text-ink sm:text-[50px]">Launch a token</h1>
          <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
            Part of the raise becomes a floor every holder can redeem.
          </p>
        </header>
      }
    />
  );
}
