import type { Metadata } from "next";
import { TokenView } from "@/components/token/TokenView";

export const metadata: Metadata = {
  title: "Token",
};

export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <TokenView mint={decodeURIComponent(mint)} />;
}
