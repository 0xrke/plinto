import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-ink-2 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:justify-between">
          <div className="max-w-2xl space-y-2">
            <p className="font-semibold text-ink">Important</p>
            <p>
              StockFloor is unaudited hackathon code. Do not use it with funds you cannot afford to lose.
              Nothing here is investment advice.
            </p>
            <p>
              Not available to US persons or residents of other restricted jurisdictions. Quote assets are
              xStocks tracker certificates, which are not offered to US persons.
            </p>
            <p>
              The floor protects holders from a price of zero, not from loss. It moves with the underlying
              stock or index in USD.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-ink">Built on</p>
            <ul className="space-y-1">
              <li>Meteora Dynamic Bonding Curve</li>
              <li>Meteora DAMM v2</li>
              <li>Solana Token-2022 xStocks</li>
            </ul>
            <p className="pt-2">
              <Link href="/create" className="font-medium text-brand underline-offset-2 hover:underline">
                Launch a token
              </Link>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
