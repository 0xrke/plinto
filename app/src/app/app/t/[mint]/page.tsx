import type { Metadata } from "next";
import { TokenView } from "@/components/token/TokenView";

export const metadata: Metadata = {
  title: "Token",
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <TokenView mint={safeDecode(mint)} />;
}
