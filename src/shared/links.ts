// Only http: and https: links leave the app, opened in the system browser.
// Everything else, including relative links and file:, is ignored.
export function externalUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    // No base URL: a relative link throws instead of resolving against the app's own URL.
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
