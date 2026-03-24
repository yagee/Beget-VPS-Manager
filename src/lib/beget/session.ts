import { browser } from "$app/environment";
import type { StoredAccount } from "$lib/types";

const LEGACY_PERSISTENT_TOKEN_KEY = "beget-vps-manager:token";
const LEGACY_SESSION_TOKEN_KEY = "beget-vps-manager:session-token";
const PERSISTENT_ACCOUNTS_KEY = "beget-vps-manager:accounts";
const SESSION_ACCOUNTS_KEY = "beget-vps-manager:session-accounts";
const ACTIVE_ACCOUNT_KEY = "beget-vps-manager:active-account";

type StoredAccountDraft = Pick<
  StoredAccount,
  "id" | "login" | "token" | "persistent"
> &
  Partial<Pick<StoredAccount, "addedAt" | "lastUsedAt">>;

function parseStoredAccounts(
  raw: string | null,
  persistent: boolean,
): StoredAccount[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      const candidate = entry as Partial<StoredAccount>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.login !== "string" ||
        typeof candidate.token !== "string"
      ) {
        return [];
      }

      const now = new Date().toISOString();

      return [
        {
          id: candidate.id.trim().toLowerCase(),
          login: candidate.login.trim() || candidate.id.trim().toLowerCase(),
          token: candidate.token,
          persistent,
          addedAt:
            typeof candidate.addedAt === "string" ? candidate.addedAt : now,
          lastUsedAt:
            typeof candidate.lastUsedAt === "string"
              ? candidate.lastUsedAt
              : typeof candidate.addedAt === "string"
                ? candidate.addedAt
                : now,
        },
      ];
    });
  } catch (error) {
    console.warn("Failed to parse stored Beget accounts", error);
    return [];
  }
}

function readRawStoredAccounts(): StoredAccount[] {
  const localAccounts = parseStoredAccounts(
    localStorage.getItem(PERSISTENT_ACCOUNTS_KEY),
    true,
  );
  const sessionAccounts = parseStoredAccounts(
    sessionStorage.getItem(SESSION_ACCOUNTS_KEY),
    false,
  );

  return [...localAccounts, ...sessionAccounts];
}

function persistAccounts(accounts: StoredAccount[]): void {
  const persistentAccounts = accounts.filter((account) => account.persistent);
  const sessionAccounts = accounts.filter((account) => !account.persistent);

  localStorage.setItem(
    PERSISTENT_ACCOUNTS_KEY,
    JSON.stringify(persistentAccounts),
  );
  sessionStorage.setItem(SESSION_ACCOUNTS_KEY, JSON.stringify(sessionAccounts));
}

function readLegacyAccount(): StoredAccount | null {
  const persistentToken = localStorage.getItem(LEGACY_PERSISTENT_TOKEN_KEY);
  const sessionToken = sessionStorage.getItem(LEGACY_SESSION_TOKEN_KEY);
  const token = persistentToken ?? sessionToken;

  if (!token) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: persistentToken ? "legacy-persistent" : "legacy-session",
    login: "Saved session",
    token,
    persistent: Boolean(persistentToken),
    addedAt: now,
    lastUsedAt: now,
  };
}

function clearLegacyStoredToken(): void {
  localStorage.removeItem(LEGACY_PERSISTENT_TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
}

function migrateLegacyStorage(): StoredAccount[] {
  const accounts = readRawStoredAccounts();

  if (accounts.length > 0) {
    return accounts;
  }

  const legacyAccount = readLegacyAccount();
  if (!legacyAccount) {
    return [];
  }

  persistAccounts([legacyAccount]);
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, legacyAccount.id);
  clearLegacyStoredToken();

  return [legacyAccount];
}

export function readStoredAccounts(): StoredAccount[] {
  if (!browser) {
    return [];
  }

  return migrateLegacyStorage().sort((left, right) =>
    right.lastUsedAt.localeCompare(left.lastUsedAt),
  );
}

export function readActiveAccountId(): string | null {
  if (!browser) {
    return null;
  }

  return localStorage.getItem(ACTIVE_ACCOUNT_KEY);
}

export function writeActiveAccountId(accountId: string | null): void {
  if (!browser) {
    return;
  }

  if (!accountId) {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    return;
  }

  localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
}

export function upsertStoredAccount(draft: StoredAccountDraft): StoredAccount {
  if (!browser) {
    const now = new Date().toISOString();

    return {
      id: draft.id.trim().toLowerCase(),
      login: draft.login.trim() || draft.id.trim().toLowerCase(),
      token: draft.token,
      persistent: draft.persistent,
      addedAt: draft.addedAt ?? now,
      lastUsedAt: draft.lastUsedAt ?? now,
    };
  }

  const now = new Date().toISOString();
  const normalizedId = draft.id.trim().toLowerCase();
  const existingAccounts = readRawStoredAccounts();
  const existingAccount = existingAccounts.find(
    (account) => account.id === normalizedId,
  );
  const nextAccount: StoredAccount = {
    id: normalizedId,
    login: draft.login.trim() || normalizedId,
    token: draft.token,
    persistent: draft.persistent,
    addedAt: existingAccount?.addedAt ?? draft.addedAt ?? now,
    lastUsedAt: draft.lastUsedAt ?? now,
  };

  persistAccounts(
    existingAccounts
      .filter((account) => account.id !== normalizedId)
      .concat(nextAccount),
  );

  return nextAccount;
}

export function removeStoredAccount(accountId: string): void {
  if (!browser) {
    return;
  }

  const normalizedId = accountId.trim().toLowerCase();
  const nextAccounts = readRawStoredAccounts().filter(
    (account) => account.id !== normalizedId,
  );

  persistAccounts(nextAccounts);

  if (localStorage.getItem(ACTIVE_ACCOUNT_KEY) === normalizedId) {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  }
}
