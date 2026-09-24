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

/**
 * Sits on the wash under the app window: the one-line brand footer from the mockups, then the
 * legal notes and project links in small type.
 */
export function SiteFooter() {
  const links = projectLinks();
  return (
    <footer className="px-4 pb-10 pt-8 text-[13px] text-ink-2 sm:px-6 lg:px-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <b className="font-bold text-ink">StockFloor</b> · Launchpad on Meteora DBC
        </p>
        <p>The floor protects from zero, not from loss.</p>
      </div>
      <div className="mt-6 grid gap-6 border-t border-ink/10 pt-6 text-xs leading-relaxed md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
        <div className="space-y-1.5">
          <p className="font-bold text-ink">Important</p>
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
        <div className="space-y-1.5">
          <p className="font-bold text-ink">Project</p>
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.label}>
                <a href={link.href} target="_blank" rel="noreferrer" className="link">
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/create" className="link">
                Launch a token
              </Link>
            </li>
          </ul>
        </div>
        <div className="space-y-1.5">
          <p className="font-bold text-ink">Built on</p>
          <ul className="space-y-1">
            <li>Meteora Dynamic Bonding Curve</li>
            <li>Meteora DAMM v2</li>
            <li>Solana Token-2022 xStocks</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
