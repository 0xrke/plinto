import Link from "next/link";
import { STOCKFLOOR_PROGRAM_ID } from "@stockfloor/sdk";
import { REPO_URL, RPC_URL, repoFileUrl } from "@/lib/config";
import { explorerAddressUrl } from "@/lib/chain/explorer";

/** Outbound links: only the ones that exist in this deployment (the repository is configurable). */
function projectLinks(): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  if (REPO_URL) links.push({ href: REPO_URL, label: "Source code" });
  const architecture = repoFileUrl("docs/architecture.md");
  if (architecture) links.push({ href: architecture, label: "Architecture" });
  const security = repoFileUrl("README.md#security");
  if (security) links.push({ href: security, label: "Security model" });
  links.push({ href: explorerAddressUrl(STOCKFLOOR_PROGRAM_ID.toBase58(), RPC_URL), label: "stockfloor program" });
  return links;
}

export function SiteFooter() {
  const links = projectLinks();
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
          <div className="flex flex-col gap-6 sm:flex-row md:gap-10">
            <div className="space-y-2">
              <p className="font-semibold text-ink">Project</p>
              <ul className="space-y-1">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-brand underline-offset-2 hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
                <li>
                  <Link href="/create" className="font-medium text-brand underline-offset-2 hover:underline">
                    Launch a token
                  </Link>
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-ink">Built on</p>
              <ul className="space-y-1">
                <li>Meteora Dynamic Bonding Curve</li>
                <li>Meteora DAMM v2</li>
                <li>Solana Token-2022 xStocks</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
