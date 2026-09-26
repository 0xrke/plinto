/**
 * Build-time guard against shipping a hosted app that is not wired to a chain.
 *
 * The defaults are local-development defaults: `NEXT_PUBLIC_DATA_SOURCE=mock` (four invented
 * launches, every button refused) and `NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899` (a Surfpool fork
 * on the developer's own machine). A deploy that forgets both variables builds and serves happily
 * and shows made-up tokens to whoever opens the link, so `next.config.ts` fails the production
 * build instead. Local production builds are legitimate — they say so with STOCKFLOOR_LOCAL_BUILD=1.
 *
 * This module is imported by `next.config.ts`, so it must not import anything (the config is loaded
 * outside the app bundle).
 */
export interface DeployEnv {
  NEXT_PUBLIC_DATA_SOURCE?: string;
  NEXT_PUBLIC_RPC_URL?: string;
  STOCKFLOOR_LOCAL_BUILD?: string;
}

/** Loopback host: a local fork or validator, unreachable from anywhere but this machine. */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** What makes this production build undeployable. Empty when it is fine to host. */
export function productionBuildProblems(env: DeployEnv): string[] {
  if (env.STOCKFLOOR_LOCAL_BUILD === "1") return [];
  const problems: string[] = [];
  if (env.NEXT_PUBLIC_DATA_SOURCE !== "chain") {
    problems.push(
      `NEXT_PUBLIC_DATA_SOURCE is ${env.NEXT_PUBLIC_DATA_SOURCE ? `"${env.NEXT_PUBLIC_DATA_SOURCE}"` : "unset (defaults to \"mock\")"}: the hosted app would show example launches and refuse every button. Set NEXT_PUBLIC_DATA_SOURCE=chain.`,
    );
  }
  const rpc = env.NEXT_PUBLIC_RPC_URL;
  if (!rpc) {
    problems.push(
      'NEXT_PUBLIC_RPC_URL is unset (defaults to "http://127.0.0.1:8899"): a hosted app cannot reach the machine it was built on. Set NEXT_PUBLIC_RPC_URL (and STOCKFLOOR_RPC_URL for the server routes) to a mainnet RPC endpoint.',
    );
  } else if (isLoopbackUrl(rpc)) {
    problems.push(
      `NEXT_PUBLIC_RPC_URL is a loopback address (${rpc}): a hosted app cannot reach it. Set NEXT_PUBLIC_RPC_URL (and STOCKFLOOR_RPC_URL for the server routes) to a mainnet RPC endpoint.`,
    );
  }
  return problems;
}

/** Throws with the full list of problems and the way out. Called from `next.config.ts`. */
export function assertDeployableProductionBuild(env: DeployEnv): void {
  const problems = productionBuildProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    [
      "Plinto: this production build is not deployable as configured.",
      ...problems.map((p) => `  · ${p}`),
      "",
      "  A local production build (a Surfpool fork, or a design preview on demo data) is fine — say so:",
      "    STOCKFLOOR_LOCAL_BUILD=1 pnpm build     (or: pnpm --filter @stockfloor/app build:local)",
      "  See app/README.md, \"Deploying the app\".",
    ].join("\n"),
  );
}
