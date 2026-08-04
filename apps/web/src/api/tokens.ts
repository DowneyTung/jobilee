/**
 * Token storage.
 *
 * The access token lives in memory only — it dies with the tab, and no XSS
 * payload can read it out of storage. The refresh token has to survive a
 * reload to keep you logged in, so it goes to localStorage.
 *
 * That trade-off is deliberate but not free: a successful XSS could steal the
 * refresh token. The stronger design is an httpOnly, SameSite cookie issued by
 * the gateway, which the browser never exposes to JavaScript. That's a Phase 5
 * hardening item — it needs cookie handling and CSRF protection at the gateway.
 */
const REFRESH_KEY = "jobilee.refreshToken";

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    // Private browsing modes can throw on storage access.
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(REFRESH_KEY);
    else localStorage.setItem(REFRESH_KEY, token);
  } catch {
    /* storage unavailable — session simply won't survive a reload */
  }
}

export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}
