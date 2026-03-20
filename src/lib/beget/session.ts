import { browser } from "$app/environment";

const PERSISTENT_TOKEN_KEY = "beget-vps-manager:token";
const SESSION_TOKEN_KEY = "beget-vps-manager:session-token";

export function readStoredToken(): string | null {
  if (!browser) {
    return null;
  }

  return (
    localStorage.getItem(PERSISTENT_TOKEN_KEY) ??
    sessionStorage.getItem(SESSION_TOKEN_KEY)
  );
}

export function writeStoredToken(token: string, persistent: boolean): void {
  if (!browser) {
    return;
  }

  if (persistent) {
    localStorage.setItem(PERSISTENT_TOKEN_KEY, token);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    return;
  }

  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  localStorage.removeItem(PERSISTENT_TOKEN_KEY);
}

export function clearStoredToken(): void {
  if (!browser) {
    return;
  }

  localStorage.removeItem(PERSISTENT_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}
