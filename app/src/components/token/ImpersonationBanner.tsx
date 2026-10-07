/**
 * Full-width warning on the page of a launch whose name or ticker imitates Plinto. Such launches were
 * created before the program rejected reserved names; they are hidden from the lists, but a shared
 * link still opens their page, so the page says plainly that the token is not ours.
 */
export function ImpersonationBanner({ symbol }: { symbol: string }) {
  return (
    <section
      role="alert"
      aria-labelledby="impersonation-heading"
      className="rounded-card bg-[#c8191b] p-5 text-white shadow-card ring-4 ring-[#c8191b]/25 sm:p-7"
    >
      <p className="text-sm font-bold tracking-[0.12em] uppercase">⚠ Warning · fake token</p>
      <h2 id="impersonation-heading" className="display mt-2 text-[28px] leading-tight sm:text-[40px]">
        This is NOT an official Plinto token
      </h2>
      <p className="mt-3 max-w-2xl text-base font-medium sm:text-lg">
        Anyone can launch a token with any name. ${symbol} copies the Plinto name; Plinto did not create it and
        does not endorse it. Do not buy it thinking it is ours.
      </p>
    </section>
  );
}
