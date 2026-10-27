// While someone signs in (and enters their authenticator code) to approve the connector, we remember where they were
// going in a short-lived cookie, not in a web address. Only the consent page is ever remembered.

export const RETURN_TO_COOKIE = "zfh_return_to";

const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{8,200}$/;

export function isAuthorizationId(value: string | null | undefined): value is string {
  return typeof value === "string" && AUTHORIZATION_ID.test(value);
}

export function consentPath(authorizationId: string) {
  return `/oauth/consent?authorization_id=${authorizationId}`;
}

export function isSafeReturnTo(value: string | null | undefined): value is string {
  const m = /^\/oauth\/consent\?authorization_id=(.+)$/.exec(value ?? "");
  return !!m && AUTHORIZATION_ID.test(m[1]);
}

/** Where Claude may be sent back to after approval. Never anywhere else. */
export function isAllowedRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && (u.hostname === "claude.ai" || u.hostname === "claude.com")) return true;
    // Local development and tests only.
    return process.env.NODE_ENV !== "production" && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
}
