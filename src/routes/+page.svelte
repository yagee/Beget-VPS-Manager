<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { browser } from "$app/environment";
  import {
    authenticate,
    BegetClientError,
    fetchDashboard,
    logout,
  } from "$lib/beget/browser";
  import {
    readActiveAccountId,
    readStoredAccounts,
    removeStoredAccount,
    upsertStoredAccount,
    writeActiveAccountId,
  } from "$lib/beget/session";
  import LoginForm from "$lib/components/LoginForm.svelte";
  import VpsCard from "$lib/components/VpsCard.svelte";
  import type {
    AuthLoginPayload,
    DashboardPayload,
    StoredAccount,
  } from "$lib/types";
  import { formatTimestamp } from "$lib/utils/format";

  const storageKey = "beget-vps-manager:prefs";
  const allActiveScopeId = "__all-active__";
  const codeChallengeErrors = [
    "CODE_REQUIRED",
    "CODE_REQUIRED_EMAIL",
    "CODE_REQUIRED_SMS",
    "CODE_REQUIRED_TOTP",
    "INCORRECT_CODE",
    "CODE_INPUT_LIMIT",
    "CODE_SENT_LIMIT",
  ];

  type BannerState = {
    tone: "error" | "neutral";
    text: string;
  };
  type Theme = "light" | "dark";
  type StoredPreferences = {
    query?: string;
    pageSize?: number;
    theme?: Theme;
    viewMode?: "control" | "monitor";
    favoriteKeys?: string[];
  };

  function isTheme(value: unknown): value is Theme {
    return value === "light" || value === "dark";
  }

  function readInitialTheme(): Theme {
    if (!browser) {
      return "dark";
    }

    const theme = document.documentElement.dataset.theme;
    return isTheme(theme) ? theme : "dark";
  }

  let authReady = $state(false);
  let accounts = $state<StoredAccount[]>([]);
  let dashboardsByAccount = $state<Record<string, DashboardPayload>>({});
  let accountErrors = $state<Record<string, string>>({});
  let activeAccountId = $state<string | null>(null);
  let selectedScope = $state<string | null>(null);
  let loading = $state(false);
  let statusMessage = $state<BannerState | null>(null);
  let loginError = $state<string | null>(null);
  let loginPending = $state(false);
  let loginCodeRequired = $state(false);
  let addingAccount = $state(false);
  let favoriteKeys = $state<string[]>([]);
  let query = $state("");
  let page = $state(1);
  let pageSize = $state(5);
  let theme = $state<Theme>(readInitialTheme());
  let viewMode = $state<"control" | "monitor">("control");

  let authenticated = $derived(accounts.length > 0);
  let activeAccount = $derived(
    accounts.find((account) => account.id === activeAccountId) ?? null,
  );
  let showAllActiveScope = $derived(accounts.length > 1);
  let currentScopeAccountId = $derived(
    selectedScope === allActiveScopeId ? activeAccountId : selectedScope,
  );
  let scopeTitle = $derived(
    selectedScope === allActiveScopeId
      ? "All running servers"
      : (activeAccount?.login ?? "VPS configuration deck"),
  );
  let scopeDescription = $derived(
    selectedScope === allActiveScopeId
      ? `Running VPS cards from ${accounts.length} stored Beget accounts.`
      : activeAccount
        ? `Manage ${activeAccount.login} from this browser, or switch to another saved account instantly.`
        : "Authenticate locally, inspect every VPS, and push CPU/RAM changes without tab-hopping.",
  );
  let currentDashboard = $derived.by(() => {
    if (selectedScope === allActiveScopeId) {
      return buildAllRunningDashboard(accounts, dashboardsByAccount);
    }

    if (!currentScopeAccountId) {
      return null;
    }

    return dashboardsByAccount[currentScopeAccountId] ?? null;
  });
  let banner = $derived.by(() => {
    if (statusMessage) {
      return statusMessage;
    }

    if (selectedScope === allActiveScopeId) {
      const failures = accounts.flatMap((account) =>
        accountErrors[account.id]
          ? [`${account.login}: ${accountErrors[account.id]}`]
          : [],
      );

      if (failures.length > 0) {
        return {
          tone: "error",
          text: `Some accounts could not sync. ${failures.join(" ")}`,
        } satisfies BannerState;
      }

      return null;
    }

    if (currentScopeAccountId && accountErrors[currentScopeAccountId]) {
      return {
        tone: "error",
        text: accountErrors[currentScopeAccountId],
      } satisfies BannerState;
    }

    return null;
  });

  let filteredServers = $derived.by(() => {
    const servers = currentDashboard?.servers ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    const favorites = new Set(favoriteKeys);

    return servers
      .filter((server) => {
        if (!normalizedQuery) {
          return true;
        }

        return [
          server.accountLabel,
          server.displayName,
          server.hostname,
          server.ipAddress,
          server.region,
          server.status,
          server.technicalDomain,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        const favoriteDelta =
          Number(favorites.has(buildFavoriteKey(right))) -
          Number(favorites.has(buildFavoriteKey(left)));
        if (favoriteDelta !== 0) {
          return favoriteDelta;
        }

        const reconfigurableDelta =
          Number(right.reconfigurable) - Number(left.reconfigurable);
        if (reconfigurableDelta !== 0) {
          return reconfigurableDelta;
        }

        const accountDelta = (left.accountLabel ?? "").localeCompare(
          right.accountLabel ?? "",
        );
        if (accountDelta !== 0) {
          return accountDelta;
        }

        return left.displayName.localeCompare(right.displayName);
      });
  });

  let filteredCount = $derived(filteredServers.length);
  let pageCount = $derived(Math.max(1, Math.ceil(filteredCount / pageSize)));
  let currentPage = $derived(Math.min(page, pageCount));
  let visibleServers = $derived.by(() => {
    const offset = (currentPage - 1) * pageSize;
    return filteredServers.slice(offset, offset + pageSize);
  });
  let pageStart = $derived(
    filteredCount === 0 ? 0 : (currentPage - 1) * pageSize + 1,
  );
  let pageEnd = $derived(Math.min(currentPage * pageSize, filteredCount));
  let pageItems = $derived(buildPageItems(currentPage, pageCount));

  function buildAllRunningDashboard(
    storedAccounts: StoredAccount[],
    dashboards: Record<string, DashboardPayload>,
  ): DashboardPayload | null {
    const loadedDashboards = storedAccounts
      .map((account) => dashboards[account.id])
      .filter((dashboard): dashboard is DashboardPayload => Boolean(dashboard));

    if (loadedDashboards.length === 0) {
      return null;
    }

    const servers = loadedDashboards
      .flatMap((dashboard) => dashboard.servers)
      .filter((server) => server.status === "RUNNING");
    const fetchedAt = loadedDashboards
      .map((dashboard) => dashboard.summary.fetchedAt)
      .sort()
      .at(-1);

    return {
      servers,
      summary: {
        total: servers.length,
        configurable: servers.filter((server) => server.configurable).length,
        active: servers.length,
        fetchedAt: fetchedAt ?? new Date().toISOString(),
      },
    };
  }

  function buildPageItems(currentPage: number, totalPages: number) {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items = [1, totalPages];

    for (
      let pageNumber = currentPage - 1;
      pageNumber <= currentPage + 1;
      pageNumber += 1
    ) {
      if (pageNumber > 1 && pageNumber < totalPages) {
        items.push(pageNumber);
      }
    }

    if (currentPage <= 3) {
      items.push(2, 3, 4);
    }

    if (currentPage >= totalPages - 2) {
      items.push(totalPages - 1, totalPages - 2, totalPages - 3);
    }

    const sorted = [...new Set(items)].sort((left, right) => left - right);
    const output: Array<number | string> = [];

    for (const item of sorted) {
      const previousItem = output[output.length - 1];

      if (typeof previousItem === "number" && item - previousItem > 1) {
        output.push(`gap-${previousItem}-${item}`);
      }

      output.push(item);
    }

    return output;
  }

  function setPage(nextPage: number) {
    page = Math.max(1, Math.min(nextPage, pageCount));
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
  }

  function normalizeLogin(login: string) {
    return login.trim().toLowerCase();
  }

  function decorateDashboard(
    payload: DashboardPayload,
    account: StoredAccount,
  ): DashboardPayload {
    return {
      ...payload,
      servers: payload.servers.map((server) => ({
        ...server,
        accountId: account.id,
        accountLabel: account.login,
      })),
    };
  }

  function buildFavoriteKey(server: { accountId?: string; id: string }) {
    return `${server.accountId ?? "default"}:${server.id}`;
  }

  function isFavorite(server: { accountId?: string; id: string }) {
    return favoriteKeys.includes(buildFavoriteKey(server));
  }

  function toggleFavorite(server: { accountId?: string; id: string }) {
    const key = buildFavoriteKey(server);

    if (favoriteKeys.includes(key)) {
      favoriteKeys = favoriteKeys.filter((entry) => entry !== key);
      return;
    }

    favoriteKeys = [...favoriteKeys, key];
  }

  function tokenForAccount(accountId?: string) {
    return accounts.find((account) => account.id === accountId)?.token ?? "";
  }

  function clearLoginState() {
    loginError = null;
    loginCodeRequired = false;
    loginPending = false;
  }

  function syncLocalAccounts(nextAccounts = readStoredAccounts()) {
    accounts = nextAccounts;
  }

  function dropAccountFromState(accountId: string) {
    removeStoredAccount(accountId);

    const { [accountId]: _removedDashboard, ...remainingDashboards } =
      dashboardsByAccount;
    dashboardsByAccount = remainingDashboards;

    const { [accountId]: _removedError, ...remainingErrors } = accountErrors;
    accountErrors = remainingErrors;

    syncLocalAccounts();
  }

  onMount(() => {
    void (async () => {
      if (browser) {
        const raw = localStorage.getItem(storageKey);

        if (raw) {
          try {
            const parsed = JSON.parse(raw) as StoredPreferences;

            query = parsed.query ?? "";
            pageSize = [5, 10, 25].includes(parsed.pageSize ?? 0)
              ? (parsed.pageSize as 5 | 10 | 25)
              : 5;
            theme = isTheme(parsed.theme) ? parsed.theme : theme;
            viewMode = parsed.viewMode === "monitor" ? "monitor" : "control";
            favoriteKeys = Array.isArray(parsed.favoriteKeys)
              ? parsed.favoriteKeys.filter(
                  (key): key is string => typeof key === "string",
                )
              : [];
          } catch (error) {
            console.warn("Failed to restore local UI preferences", error);
          }
        }

        const storedAccounts = readStoredAccounts();
        const storedActiveAccountId = readActiveAccountId();

        accounts = storedAccounts;
        activeAccountId = storedAccounts.some(
          (account) => account.id === storedActiveAccountId,
        )
          ? storedActiveAccountId
          : (storedAccounts[0]?.id ?? null);
        selectedScope = activeAccountId;

        if (storedAccounts.length > 0) {
          await loadDashboards(storedAccounts.map((account) => account.id));
        }
      }

      authReady = true;
    })();
  });

  $effect(() => {
    if (!browser) {
      return;
    }

    document.documentElement.dataset.theme = theme;
  });

  $effect(() => {
    if (!browser) {
      return;
    }

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        query,
        pageSize,
        theme,
        viewMode,
        favoriteKeys,
      }),
    );
  });

  $effect(() => {
    const accountIds = new Set(accounts.map((account) => account.id));
    let nextActiveAccountId = activeAccountId;

    if (nextActiveAccountId && !accountIds.has(nextActiveAccountId)) {
      nextActiveAccountId = accounts[0]?.id ?? null;
    }

    if (!nextActiveAccountId && accounts[0]) {
      nextActiveAccountId = accounts[0].id;
    }

    if (nextActiveAccountId !== activeAccountId) {
      activeAccountId = nextActiveAccountId;
    }

    if (selectedScope === allActiveScopeId && accounts.length < 2) {
      selectedScope = nextActiveAccountId;
    }

    if (
      selectedScope &&
      selectedScope !== allActiveScopeId &&
      !accountIds.has(selectedScope)
    ) {
      selectedScope = nextActiveAccountId;
    }

    if (!selectedScope && nextActiveAccountId) {
      selectedScope = nextActiveAccountId;
    }

    writeActiveAccountId(nextActiveAccountId);
  });

  async function loadDashboards(
    accountIds = accounts.map((account) => account.id),
    nextViewMode: "control" | "monitor" = viewMode,
  ) {
    const targetAccounts = accounts.filter((account) =>
      accountIds.includes(account.id),
    );

    if (targetAccounts.length === 0) {
      loading = false;
      return;
    }

    loading = true;
    statusMessage = null;

    const nextDashboards = { ...dashboardsByAccount };
    const nextErrors = { ...accountErrors };
    const expiredAccounts: StoredAccount[] = [];

    await Promise.all(
      targetAccounts.map(async (account) => {
        try {
          const payload = await fetchDashboard(account.token, {
            monitorOnly: nextViewMode === "monitor",
          });
          nextDashboards[account.id] = decorateDashboard(payload, account);
          delete nextErrors[account.id];
        } catch (error) {
          if (error instanceof BegetClientError && error.status === 401) {
            expiredAccounts.push(account);
            delete nextDashboards[account.id];
            delete nextErrors[account.id];
            return;
          }

          nextErrors[account.id] =
            error instanceof Error
              ? error.message
              : "Dashboard request failed.";
        }
      }),
    );

    dashboardsByAccount = nextDashboards;
    accountErrors = nextErrors;

    if (expiredAccounts.length > 0) {
      for (const account of expiredAccounts) {
        removeStoredAccount(account.id);
      }

      const nextAccounts = readStoredAccounts();
      syncLocalAccounts(nextAccounts);

      if (nextAccounts.length === 0) {
        loginError =
          expiredAccounts.length === 1
            ? `${expiredAccounts[0].login} session expired. Sign in again.`
            : "Every saved session expired. Sign in again.";
      } else {
        statusMessage = {
          tone: "error",
          text:
            expiredAccounts.length === 1
              ? `${expiredAccounts[0].login} session expired and was removed.`
              : `${expiredAccounts.length} account sessions expired and were removed.`,
        };
      }
    }

    loading = false;
  }

  async function setViewMode(nextMode: "control" | "monitor") {
    viewMode = nextMode;
    setPage(1);
    await loadDashboards();
  }

  function selectScope(scopeId: string) {
    statusMessage = null;
    addingAccount = false;
    setPage(1);

    if (scopeId === allActiveScopeId) {
      selectedScope = allActiveScopeId;
      return;
    }

    activeAccountId = scopeId;
    selectedScope = scopeId;
  }

  function openAddAccount() {
    statusMessage = null;
    addingAccount = true;
    clearLoginState();
  }

  function closeAddAccount() {
    addingAccount = false;
    clearLoginState();
  }

  async function handleRefresh() {
    if (selectedScope === allActiveScopeId) {
      await loadDashboards();
      return;
    }

    if (currentScopeAccountId) {
      await loadDashboards([currentScopeAccountId]);
    }
  }

  async function handleLogin(payload: AuthLoginPayload) {
    loginPending = true;
    loginError = null;
    statusMessage = null;

    try {
      const response = await authenticate(payload);
      const normalizedLogin = normalizeLogin(payload.login) || "saved-session";
      const account = upsertStoredAccount({
        id: normalizedLogin,
        login:
          normalizedLogin === "saved-session"
            ? "Saved session"
            : normalizedLogin,
        token: response.token,
        persistent: payload.saveMe !== false,
      });

      syncLocalAccounts();
      activeAccountId = account.id;
      selectedScope = account.id;
      addingAccount = false;
      loginCodeRequired = false;
      await loadDashboards([account.id]);
    } catch (error) {
      if (error instanceof BegetClientError) {
        loginCodeRequired = error.code
          ? codeChallengeErrors.includes(error.code)
          : loginCodeRequired;
        loginError = error.message;
        return;
      }

      loginError = error instanceof Error ? error.message : "Login failed.";
    } finally {
      loginPending = false;
    }
  }

  async function handleLogout() {
    const account = activeAccount;
    if (!account) {
      return;
    }

    statusMessage = null;
    closeAddAccount();
    dropAccountFromState(account.id);

    try {
      await logout(account.token);
    } catch (error) {
      console.warn("Beget logout request failed", error);
    }
  }
</script>

<svelte:head>
  <title>Beget VPS Manager</title>
  <meta
    content="Static browser dashboard for Beget VPS authentication and single-screen CPU/RAM reconfiguration."
    name="description"
  >
  <meta content="Beget VPS Manager" property="og:title">
  <meta
    content="Static browser dashboard for Beget VPS authentication and single-screen CPU/RAM reconfiguration."
    property="og:description"
  >
  <meta content="website" property="og:type">
  <meta content="https://beget-vps-manager.yagee.me/" property="og:url">
  <meta content="Beget VPS Manager" property="og:site_name">
  <meta
    content="https://beget-vps-manager.yagee.me/social-card.png"
    property="og:image"
  >
  <meta
    content="Beget VPS Manager login and VPS control dashboard preview"
    property="og:image:alt"
  >
  <meta content="summary_large_image" name="twitter:card">
  <meta content="Beget VPS Manager" name="twitter:title">
  <meta
    content="Static browser dashboard for Beget VPS authentication and single-screen CPU/RAM reconfiguration."
    name="twitter:description"
  >
  <meta
    content="https://beget-vps-manager.yagee.me/social-card.png"
    name="twitter:image"
  >
</svelte:head>

<div class="shell">
  <div class="background"></div>
  <div class="shell-controls">
    <button
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      class="theme-toggle"
      onclick={toggleTheme}
      type="button"
    >
      <span>Theme</span>
      <strong>{theme === "dark" ? "Dark" : "Light"}</strong>
    </button>
  </div>

  {#if !authReady}
    <section class="auth-wrap" transition:fade={{ duration: 180 }}>
      <div class="hero-copy">
        <p class="kicker">Svelte 5 / Bun / Static client</p>
        <h2>Rule your Beget fleet without leaving one screen.</h2>
        <p>Restoring local Beget sessions from this browser.</p>
      </div>

      <div class="loading-card">
        <p>Restoring local sessions...</p>
      </div>
    </section>
  {:else if !authenticated}
    <section class="auth-wrap" transition:fade={{ duration: 180 }}>
      <div class="hero-copy">
        <p class="kicker">Svelte 5 / Bun / Static client</p>
        <h2>Rule your Beget fleet without leaving one screen.</h2>
        <p>
          This app keeps Beget sessions in this browser, supports multiple
          accounts, and can show running VPS cards across every saved account.
        </p>
        <p class="source-note">
          Check the source code in the
          <a
            href="https://github.com/yagee/Beget-VPS-Manager"
            rel="noreferrer"
            target="_blank"
          >
            GitHub repository
          </a>.
        </p>
      </div>

      <LoginForm
        codeRequired={loginCodeRequired}
        description="Authenticate directly with the Beget API, save more than one account in this browser, and switch between them without retyping credentials."
        error={loginError}
        onLogin={handleLogin}
        pending={loginPending}
      />
    </section>
  {:else}
    <section class="dashboard" transition:fade={{ duration: 180 }}>
      <div class="account-bar">
        <div aria-label="Account scope" class="scope-tabs">
          {#each accounts as account (account.id)}
            <button
              class="scope-button"
              class:active={selectedScope === account.id}
              onclick={() => {
                selectScope(account.id);
              }}
              type="button"
            >
              {account.login}
            </button>
          {/each}

          {#if showAllActiveScope}
            <button
              class="scope-button"
              class:active={selectedScope === allActiveScopeId}
              onclick={() => {
                selectScope(allActiveScopeId);
              }}
              type="button"
            >
              All running
            </button>
          {/if}
        </div>

        <div class="scope-summary">
          <span>Active account</span>
          <strong>{activeAccount?.login ?? 'n/a'}</strong>
        </div>
      </div>

      <header class="masthead">
        <div class="masthead-copy">
          <p class="kicker">Beget Control Room</p>
          <h1>{scopeTitle}</h1>
          <p class="deck">{scopeDescription}</p>
        </div>

        <div class="masthead-actions">
          <div aria-label="Card view mode" class="view-mode-buttons">
            <button
              class="view-button"
              class:active={viewMode === "control"}
              onclick={() => {
                void setViewMode("control");
              }}
              type="button"
            >
              Manage
            </button>
            <button
              class="view-button"
              class:active={viewMode === "monitor"}
              onclick={() => {
                void setViewMode("monitor");
              }}
              type="button"
            >
              Monitor
            </button>
          </div>

          <button class="outline" onclick={openAddAccount} type="button">
            Add account
          </button>
          <button
            class="outline"
            disabled={loading}
            onclick={() => {
            void handleRefresh();
          }}
            type="button"
          >
            Refresh
          </button>
          <button class="outline" onclick={handleLogout} type="button">
            Logout active
          </button>
        </div>
      </header>

      {#if addingAccount}
        <section class="account-entry">
          <div class="account-entry-head">
            <div class="account-entry-copy">
              <p class="kicker">Add Another Account</p>
              <h3>Keep multiple Beget sessions in one browser.</h3>
              <p>
                New logins stay local to this browser. After sign-in, the
                account appears in the scope bar immediately and can join the
                combined running-servers tab.
              </p>
            </div>

            <button class="outline" onclick={closeAddAccount} type="button">
              Close
            </button>
          </div>

          <LoginForm
            codeRequired={loginCodeRequired}
            description="Authenticate this additional Beget account and keep its session in the current browser."
            error={loginError}
            eyebrow="Multi-Account"
            onLogin={handleLogin}
            pending={loginPending}
            pendingLabel="Adding account..."
            submitLabel="Add account"
            title="Link another account"
          />
        </section>
      {/if}

      <div class="toolbar">
        <div class="toolbar-box">
          <span>Total VPS</span>
          <strong>{currentDashboard?.summary.total ?? '—'}</strong>
        </div>
        <div class="toolbar-box">
          <span>Configurable</span>
          <strong>{currentDashboard?.summary.configurable ?? '—'}</strong>
        </div>
        <div class="toolbar-box">
          <span>Running</span>
          <strong>{currentDashboard?.summary.active ?? '—'}</strong>
        </div>
        <div class="toolbar-box wide">
          <span>Last sync</span>
          <strong
            >{currentDashboard
              ? formatTimestamp(currentDashboard.summary.fetchedAt)
              : 'Waiting for data'}</strong
          >
        </div>
      </div>

      <div class="filters">
        <label class="search">
          <span>Search fleet</span>
          <input
            bind:value={query}
            oninput={() => {
              setPage(1);
            }}
            placeholder="account, hostname, IP, region, status"
          >
        </label>

        <label class="page-size">
          <span>Cards per page</span>
          <select
            bind:value={pageSize}
            onchange={() => {
              setPage(1);
            }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
          </select>
        </label>

        <div class="filter-note">
          <strong>{filteredCount}</strong>
          <span>cards visible</span>
        </div>
      </div>

      {#if banner}
        <p
          class="banner"
          class:error={banner.tone === "error"}
          class:neutral={banner.tone === "neutral"}
        >
          {banner.text}
        </p>
      {/if}

      {#if loading && !currentDashboard}
        <div class="loading-state">Loading the VPS deck...</div>
      {:else if currentDashboard}
        <div class="grid" class:monitor-grid={viewMode === "monitor"}>
          {#each visibleServers as server (`${server.accountId ?? 'default'}:${server.id}:${server.currentCpuCount}:${server.currentMemory}:${server.status}`)}
            <VpsCard
              favorite={isFavorite(server)}
              onRefresh={() => {
                if (server.accountId) {
                  return loadDashboards([server.accountId]);
                }
              }}
              onToggleFavorite={() => {
                toggleFavorite(server);
              }}
              {server}
              showAccountLabel={selectedScope === allActiveScopeId}
              token={tokenForAccount(server.accountId)}
              {viewMode}
            />
          {:else}
            <div class="empty-state">
              <h3>No VPS cards match the current filter.</h3>
              <p>Change the search query, switch account scope, or refresh.</p>
            </div>
          {/each}
        </div>

        {#if filteredCount > 0 && pageCount > 1}
          <nav aria-label="VPS list pagination" class="pagination">
            <div class="pagination-summary">
              <strong>{pageStart}-{pageEnd}</strong>
              <span>of {filteredCount} servers</span>
            </div>

            <div class="pagination-controls">
              <button
                class="page-button outline"
                disabled={currentPage === 1}
                onclick={() => {
                  setPage(currentPage - 1);
                }}
                type="button"
              >
                Prev
              </button>

              {#each pageItems as item (item)}
                {#if typeof item === "number"}
                  <button
                    aria-current={item === currentPage ? "page" : undefined}
                    class:active={item === currentPage}
                    class="page-button"
                    onclick={() => {
                      setPage(item);
                    }}
                    type="button"
                  >
                    {item}
                  </button>
                {:else}
                  <span aria-hidden="true" class="page-gap">...</span>
                {/if}
              {/each}

              <button
                class="page-button outline"
                disabled={currentPage === pageCount}
                onclick={() => {
                  setPage(currentPage + 1);
                }}
                type="button"
              >
                Next
              </button>
            </div>
          </nav>
        {/if}
      {:else}
        <div class="empty-state">
          <h3>No VPS data is available for this scope yet.</h3>
          <p>Refresh the current scope or switch to another saved account.</p>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  :global(:root) {
    color-scheme: dark;
    --app-bg: #06101c;
    --app-shell-bg:
      radial-gradient(
        circle at top left,
        rgba(24, 145, 163, 0.22),
        transparent 25%
      ),
      radial-gradient(
        circle at top right,
        rgba(255, 184, 75, 0.13),
        transparent 23%
      ),
      linear-gradient(180deg, #08131f 0%, #07111c 55%, #050d17 100%);
    --app-grid-line: rgba(125, 231, 243, 0.05);
    --app-text: #eef5fa;
    --app-text-strong: #f5f8fb;
    --app-text-soft: rgba(221, 232, 240, 0.78);
    --app-text-secondary: rgba(219, 231, 239, 0.78);
    --app-text-muted: rgba(188, 205, 218, 0.62);
    --app-panel-border: rgba(255, 255, 255, 0.08);
    --app-panel-border-strong: rgba(255, 255, 255, 0.14);
    --app-panel-bg: rgba(8, 18, 31, 0.82);
    --app-panel-bg-strong: rgba(8, 18, 31, 0.9);
    --app-panel-bg-soft: rgba(255, 255, 255, 0.04);
    --app-field-bg: rgba(6, 13, 23, 0.72);
    --app-button-bg: rgba(255, 255, 255, 0.08);
    --app-button-text: #e4edf3;
    --app-button-text-soft: rgba(228, 237, 243, 0.84);
    --app-toggle-bg: rgba(255, 255, 255, 0.05);
    --app-active-bg: linear-gradient(
      135deg,
      rgba(248, 184, 75, 0.22),
      rgba(125, 231, 243, 0.18)
    );
    --app-active-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    --app-card-shadow: 0 24px 65px rgba(3, 7, 16, 0.3);
    --app-focus-ring: rgba(125, 231, 243, 0.45);
    --app-banner-error-bg: rgba(103, 16, 10, 0.35);
    --app-banner-error-text: #ffc2ba;
    --app-banner-neutral-bg: rgba(12, 74, 93, 0.34);
    --app-banner-neutral-text: #d7eef6;
    --app-link: #7de7f3;
    --app-link-hover: #ffd37a;
    --login-card-bg:
      linear-gradient(180deg, rgba(8, 18, 31, 0.96), rgba(5, 11, 22, 0.92)),
      radial-gradient(
        circle at top right,
        rgba(27, 190, 214, 0.18),
        transparent 40%
      );
    --login-card-shadow:
      0 20px 70px rgba(1, 6, 14, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    --vps-card-bg:
      linear-gradient(180deg, rgba(9, 18, 30, 0.96), rgba(6, 13, 23, 0.94)),
      radial-gradient(
        circle at top left,
        rgba(255, 198, 90, 0.14),
        transparent 34%
      );
    --status-ok-bg: rgba(85, 224, 167, 0.14);
    --status-ok-text: #8cf4c0;
    --status-warn-bg: rgba(255, 197, 92, 0.16);
    --status-warn-text: #ffd27f;
    --status-busy-bg: rgba(103, 197, 255, 0.16);
    --status-busy-text: #93dbff;
    --status-muted-bg: rgba(255, 255, 255, 0.08);
    --status-muted-text: rgba(220, 230, 238, 0.76);
    --info-bg: rgba(125, 231, 243, 0.08);
    --info-text: #bfeff5;
    --info-muted-bg: rgba(255, 255, 255, 0.05);
    --info-muted-text: rgba(222, 231, 237, 0.8);
    --danger-bg: rgba(255, 109, 91, 0.14);
    --danger-bg-soft: rgba(255, 109, 91, 0.1);
    --danger-text: #ffbdb3;
    --success-bg: rgba(93, 232, 177, 0.12);
    --success-text: #abf4d1;
    --flag-bg: rgba(255, 255, 255, 0.08);
    --flag-text: rgba(235, 240, 245, 0.8);
    --metric-grid: rgba(255, 255, 255, 0.1);
    --metric-surface: rgba(255, 255, 255, 0.04);
    --placeholder-surface: rgba(255, 255, 255, 0.04);
  }

  :global(html[data-theme="light"]) {
    color-scheme: light;
    --app-bg: #eaf2f6;
    --app-shell-bg:
      radial-gradient(
        circle at top left,
        rgba(24, 145, 163, 0.18),
        transparent 25%
      ),
      radial-gradient(
        circle at top right,
        rgba(255, 184, 75, 0.18),
        transparent 23%
      ),
      linear-gradient(180deg, #fbfdfe 0%, #f1f6f9 55%, #e6eef3 100%);
    --app-grid-line: rgba(20, 52, 67, 0.08);
    --app-text: #14202c;
    --app-text-strong: #0f1b27;
    --app-text-soft: rgba(20, 32, 44, 0.78);
    --app-text-secondary: rgba(31, 47, 61, 0.78);
    --app-text-muted: rgba(55, 76, 92, 0.62);
    --app-panel-border: rgba(17, 36, 49, 0.12);
    --app-panel-border-strong: rgba(17, 36, 49, 0.16);
    --app-panel-bg: rgba(255, 255, 255, 0.72);
    --app-panel-bg-strong: rgba(255, 255, 255, 0.88);
    --app-panel-bg-soft: rgba(17, 36, 49, 0.05);
    --app-field-bg: rgba(255, 255, 255, 0.92);
    --app-button-bg: rgba(17, 36, 49, 0.08);
    --app-button-text: #213444;
    --app-button-text-soft: rgba(33, 52, 68, 0.84);
    --app-toggle-bg: rgba(17, 36, 49, 0.06);
    --app-active-bg: linear-gradient(
      135deg,
      rgba(248, 184, 75, 0.22),
      rgba(125, 231, 243, 0.24)
    );
    --app-active-shadow: inset 0 0 0 1px rgba(17, 36, 49, 0.12);
    --app-card-shadow: 0 24px 65px rgba(50, 74, 90, 0.16);
    --app-focus-ring: rgba(47, 159, 177, 0.32);
    --app-banner-error-bg: rgba(196, 57, 39, 0.12);
    --app-banner-error-text: #a53a2a;
    --app-banner-neutral-bg: rgba(12, 139, 166, 0.1);
    --app-banner-neutral-text: #0c6476;
    --app-link: #0e95a7;
    --app-link-hover: #c28a1f;
    --login-card-bg:
      linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.96),
        rgba(245, 250, 252, 0.94)
      ),
      radial-gradient(
        circle at top right,
        rgba(27, 190, 214, 0.12),
        transparent 42%
      );
    --login-card-shadow:
      0 20px 70px rgba(66, 93, 110, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.65);
    --vps-card-bg:
      linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.95),
        rgba(247, 250, 252, 0.94)
      ),
      radial-gradient(
        circle at top left,
        rgba(255, 198, 90, 0.15),
        transparent 34%
      );
    --status-ok-bg: rgba(39, 168, 103, 0.12);
    --status-ok-text: #1d7a50;
    --status-warn-bg: rgba(214, 144, 16, 0.14);
    --status-warn-text: #9a670d;
    --status-busy-bg: rgba(56, 138, 204, 0.12);
    --status-busy-text: #236798;
    --status-muted-bg: rgba(17, 36, 49, 0.08);
    --status-muted-text: rgba(52, 72, 88, 0.76);
    --info-bg: rgba(12, 139, 166, 0.1);
    --info-text: #0c6476;
    --info-muted-bg: rgba(17, 36, 49, 0.05);
    --info-muted-text: rgba(52, 72, 88, 0.76);
    --danger-bg: rgba(196, 57, 39, 0.12);
    --danger-bg-soft: rgba(196, 57, 39, 0.08);
    --danger-text: #a53a2a;
    --success-bg: rgba(39, 168, 103, 0.14);
    --success-text: #1d7a50;
    --flag-bg: rgba(17, 36, 49, 0.08);
    --flag-text: rgba(42, 60, 74, 0.8);
    --metric-grid: rgba(17, 36, 49, 0.1);
    --metric-surface: rgba(17, 36, 49, 0.05);
    --placeholder-surface: rgba(17, 36, 49, 0.05);
  }

  :global(body) {
    margin: 0;
    font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
    background: var(--app-bg);
    color: var(--app-text);
  }

  :global(html) {
    background: var(--app-bg);
  }

  :global(*) {
    box-sizing: border-box;
  }

  .shell {
    position: relative;
    display: grid;
    gap: 1rem;
    min-height: 100vh;
    padding: 1.25rem;
    overflow: hidden;
    background: var(--app-shell-bg);
  }

  .background {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(var(--app-grid-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--app-grid-line) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(circle at center, black, transparent 92%);
    pointer-events: none;
  }

  .shell-controls,
  .auth-wrap,
  .dashboard {
    position: relative;
    z-index: 1;
    width: min(1180px, 100%);
    margin: 0 auto;
  }

  .shell-controls {
    display: flex;
    justify-content: flex-end;
  }

  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.7rem 0.95rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 999px;
    background: var(--app-panel-bg);
    color: var(--app-button-text);
    backdrop-filter: blur(12px);
    box-shadow: var(--app-card-shadow);
  }

  .theme-toggle span,
  .theme-toggle strong {
    display: block;
    line-height: 1;
  }

  .theme-toggle span {
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--app-text-muted);
  }

  .theme-toggle strong {
    color: var(--app-text-strong);
  }

  .auth-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(320px, 460px);
    gap: 1.25rem;
    align-items: center;
    min-height: calc(100vh - 5.5rem);
  }

  .hero-copy {
    padding: clamp(1rem, 3vw, 2rem);
  }

  .loading-card {
    padding: 1.6rem;
    border: 1px solid var(--app-panel-border-strong);
    border-radius: 1.5rem;
    background: var(--app-panel-bg-strong);
    color: var(--app-text-secondary);
  }

  .kicker {
    margin: 0 0 0.75rem;
    font:
      700 0.78rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--app-link);
  }

  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }

  h2 {
    max-width: 10ch;
    font-size: clamp(2.8rem, 8vw, 5.8rem);
    line-height: 0.92;
    letter-spacing: -0.04em;
  }

  .hero-copy p:last-child,
  .deck,
  .account-entry-copy p:last-child {
    line-height: 1.6;
    color: var(--app-text-soft);
  }

  .source-note {
    margin-top: 1rem;
    font-size: 0.95rem;
  }

  .source-note a {
    color: var(--app-link);
    text-underline-offset: 0.2em;
    text-decoration-thickness: 0.08em;
  }

  .source-note a:hover {
    color: var(--app-link-hover);
  }

  .dashboard {
    display: grid;
    gap: 1rem;
    padding-block: 1.5rem 2rem;
  }

  .account-bar,
  .masthead,
  .toolbar,
  .filters,
  .account-entry {
    display: grid;
    gap: 1rem;
  }

  .account-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .scope-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .scope-button {
    background: var(--app-button-bg);
    color: var(--app-button-text-soft);
  }

  .scope-button.active {
    background: var(--app-active-bg);
    color: var(--app-text-strong);
    box-shadow: var(--app-active-shadow);
  }

  .scope-summary {
    padding: 0.75rem 0.95rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 1.1rem;
    background: var(--app-panel-bg);
    backdrop-filter: blur(12px);
  }

  .scope-summary span {
    display: block;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--app-text-muted);
  }

  .scope-summary strong {
    display: block;
    margin-top: 0.35rem;
    color: var(--app-text-strong);
  }

  .masthead {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }

  h1 {
    margin-bottom: 0.55rem;
    font-size: clamp(2.3rem, 5vw, 4.5rem);
    line-height: 0.94;
    letter-spacing: -0.04em;
  }

  .masthead-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .account-entry {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 440px);
    align-items: start;
    padding: 1rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 1.25rem;
    background: var(--app-panel-bg);
    backdrop-filter: blur(12px);
  }

  .account-entry-head {
    display: grid;
    gap: 1rem;
    align-content: start;
  }

  .account-entry-copy {
    max-width: 54ch;
  }

  .account-entry-copy h3 {
    margin-bottom: 0.7rem;
    font-size: clamp(1.5rem, 3vw, 2.1rem);
    line-height: 1;
  }

  .toolbar {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .toolbar-box,
  .filters,
  .loading-state,
  .empty-state,
  .banner {
    border: 1px solid var(--app-panel-border);
    border-radius: 1.25rem;
    background: var(--app-panel-bg);
    backdrop-filter: blur(12px);
  }

  .toolbar-box {
    padding: 0.9rem 1rem;
  }

  .toolbar-box span,
  .filter-note span {
    display: block;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--app-text-muted);
  }

  .toolbar-box strong,
  .filter-note strong {
    display: block;
    margin-top: 0.35rem;
    font-size: 1.12rem;
    color: var(--app-text-strong);
  }

  .toolbar-box.wide strong {
    font-size: 1rem;
  }

  .filters {
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: end;
    padding: 0.9rem;
  }

  .search {
    display: grid;
    gap: 0.45rem;
  }

  .search span {
    font-size: 0.82rem;
    color: var(--app-text-secondary);
  }

  .search input {
    width: 100%;
    padding: 0.9rem 1rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 999px;
    background: var(--app-field-bg);
    color: var(--app-text-strong);
    font: inherit;
  }

  .page-size {
    display: grid;
    gap: 0.45rem;
  }

  .page-size span {
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--app-text-muted);
  }

  .page-size select {
    min-width: 5.75rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 999px;
    background: var(--app-field-bg);
    color: var(--app-text-strong);
    font: inherit;
  }

  .view-mode-buttons {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.24rem;
    border-radius: 999px;
    background: var(--app-toggle-bg);
  }

  .view-button {
    padding: 0.62rem 0.9rem;
    background: transparent;
    color: var(--app-text-secondary);
  }

  .view-button.active {
    background: var(--app-active-bg);
    color: var(--app-text-strong);
    box-shadow: var(--app-active-shadow);
  }

  .filter-note {
    padding: 0.65rem 0.9rem;
    border-radius: 1rem;
    background: var(--app-panel-bg-soft);
  }

  .banner,
  .loading-state,
  .empty-state {
    padding: 1rem 1.1rem;
  }

  .banner.error {
    color: var(--app-banner-error-text);
    background: var(--app-banner-error-bg);
  }

  .banner.neutral {
    color: var(--app-banner-neutral-text);
    background: var(--app-banner-neutral-bg);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .grid.monitor-grid {
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--app-panel-border);
    border-radius: 1.25rem;
    background: var(--app-panel-bg);
    backdrop-filter: blur(12px);
  }

  .pagination-summary strong,
  .pagination-summary span {
    display: block;
  }

  .pagination-summary strong {
    font-size: 1.05rem;
    color: var(--app-text-strong);
  }

  .pagination-summary span {
    margin-top: 0.2rem;
    font-size: 0.76rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--app-text-muted);
  }

  .pagination-controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .page-button {
    min-width: 2.75rem;
    padding-inline: 0.9rem;
  }

  .page-button.active {
    background: linear-gradient(135deg, #ffd37a 0%, #d6a53f 100%);
    color: #161004;
  }

  .page-gap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    color: var(--app-text-muted);
  }

  button {
    border: 0;
    border-radius: 999px;
    padding: 0.85rem 1rem;
    font:
      700 0.84rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    cursor: pointer;
  }

  button:focus-visible,
  .search input:focus,
  .page-size select:focus {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .outline {
    background: var(--app-button-bg);
    color: var(--app-button-text);
  }

  .outline:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  @media (max-width: 900px) {
    .auth-wrap,
    .account-bar,
    .masthead,
    .filters,
    .toolbar,
    .pagination,
    .account-entry {
      grid-template-columns: 1fr;
    }

    .hero-copy {
      padding: 1rem 0;
    }

    h2 {
      max-width: none;
    }

    .pagination {
      align-items: stretch;
    }

    .pagination-controls {
      justify-content: flex-start;
    }
  }
</style>
