/**
 * The story lab (/lab/story) is a dev tool: it renders outside production builds, or in production
 * only with STOCKFLOOR_LAB=1. Otherwise the routes 404.
 */
export function labEnabled(env: { NODE_ENV?: string; STOCKFLOOR_LAB?: string } = process.env): boolean {
  return env.NODE_ENV !== "production" || env.STOCKFLOOR_LAB === "1";
}
