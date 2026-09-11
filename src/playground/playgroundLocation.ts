/**
 * Where Plaza links back to.
 *
 * Plaza runs on its OWN origin, so a card's `/a/<slug>` is NOT resolvable
 * there: left relative it would resolve against the Plaza host and 404.
 * Card links are therefore built absolute against the configured PWA origin,
 * falling back to this document's origin only when Plaza is being served
 * from the PWA itself (dev).
 *
 * The reverse direction — where the PWA links TO Plaza — lives in the PWA
 * (`apps/ato-pwa`'s `playgroundLocation`), not here. Plaza never needs its
 * own address from configuration: `playgroundSocketUrl` derives the socket
 * from `window.location`, and the document's host is by definition canonical.
 */

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function configured(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    // Reject anything that is not an absolute http(s) URL, so a malformed
    // var cannot become an open redirect target.
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return trimTrailingSlash(url.origin);
  } catch {
    return null;
  }
}

/** The PWA origin card links resolve against. */
export function pwaOriginUrl(
  fallback: string | null = typeof window === "undefined"
    ? null
    : window.location.origin,
): string | null {
  return configured(import.meta.env.VITE_PWA_ORIGIN) ?? configured(fallback);
}

/**
 * Absolute URL for a path served by the PWA (an App's `/a/<slug>`, an
 * Activity's join route). Returns null when there is no origin to resolve
 * against, so a caller renders a disabled card instead of a broken link.
 */
export function pwaUrl(path: string): string | null {
  const origin = pwaOriginUrl();
  if (!origin) return null;
  if (!path.startsWith("/")) return null;
  return `${origin}${path}`;
}
