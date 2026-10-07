/**
 * Permanent (308) redirects from the URLs the app used before it moved under /app, so shared links
 * keep working. "/" is now the landing page, so it is not redirected.
 */
export function routeRedirects(): { source: string; destination: string; permanent: true }[] {
  return [
    { source: "/create", destination: "/app/create", permanent: true },
    { source: "/t/:mint", destination: "/app/t/:mint", permanent: true },
  ];
}
