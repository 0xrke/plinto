import type { Metadata } from "next";
import { CreateLaunchForm } from "@/components/create/CreateLaunchForm";

export const metadata: Metadata = {
  title: "Launch a token",
};

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 max-w-2xl">
        <p className="eyebrow">Create</p>
        <h1 className="display mt-2 text-[1.75rem] text-ink sm:text-[2.125rem]">Launch a token with a floor</h1>
        <p className="mt-2 text-ink-2">
          Your presale runs on a Meteora Dynamic Bonding Curve quoted in a tokenized stock. At graduation, the vault
          share of the raise becomes a floor that every holder can redeem against. No team allocation, no admin
          withdraw.
        </p>
      </header>
      <CreateLaunchForm />
    </div>
  );
}
