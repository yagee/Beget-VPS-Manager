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
    clearStoredToken,
    readStoredToken,
    writeStoredToken,
  } from "$lib/beget/session";
  import LoginForm from "$lib/components/LoginForm.svelte";
  import VpsCard from "$lib/components/VpsCard.svelte";
  import type { AuthLoginPayload, DashboardPayload } from "$lib/types";
  import { formatTimestamp } from "$lib/utils/format";

  let authReady = $state(false);
  let authenticated = $state(false);
  let begetToken = $state<string | null>(null);
  let dashboard = $state<DashboardPayload | null>(null);
  let loading = $state(false);
  let dashboardError = $state<string | null>(null);
  let loginError = $state<string | null>(null);
  let loginPending = $state(false);
  let loginCodeRequired = $state(false);
  let query = $state("");
  let page = $state(1);
  let pageSize = $state(5);

  const storageKey = "beget-vps-manager:prefs";
  const codeChallengeErrors = [
    "CODE_REQUIRED",
    "CODE_REQUIRED_EMAIL",
    "CODE_REQUIRED_SMS",
    "CODE_REQUIRED_TOTP",
    "INCORRECT_CODE",
    "CODE_INPUT_LIMIT",
    "CODE_SENT_LIMIT",
  ];

  let filteredServers = $derived.by(() => {
    const servers = dashboard?.servers ?? [];
    const normalizedQuery = query.trim().toLowerCase();

    return servers
      .filter((server) => {
        if (!normalizedQuery) {
          return true;
        }

        return [
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
        const reconfigurableDelta =
          Number(right.reconfigurable) - Number(left.reconfigurable);
        if (reconfigurableDelta !== 0) {
          return reconfigurableDelta;
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

  onMount(() => {
    void (async () => {
      if (browser) {
        const raw = localStorage.getItem(storageKey);

        if (raw) {
          try {
            const parsed = JSON.parse(raw) as {
              query?: string;
              pageSize?: number;
            };

            query = parsed.query ?? "";
            pageSize = [5, 10, 25].includes(parsed.pageSize ?? 0)
              ? (parsed.pageSize as 5 | 10 | 25)
              : 5;
          } catch (error) {
            console.warn("Failed to restore local UI preferences", error);
          }
        }

        const storedToken = readStoredToken();
        if (storedToken) {
          begetToken = storedToken;
          authenticated = true;
          await loadDashboard(storedToken);
        }
      }

      authReady = true;
    })();
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
      }),
    );
  });

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

  function clearAuthentication(errorMessage?: string) {
    clearStoredToken();
    begetToken = null;
    authenticated = false;
    dashboard = null;
    dashboardError = null;
    loginCodeRequired = false;

    if (errorMessage) {
      loginError = errorMessage;
    }
  }

  async function loadDashboard(token = begetToken) {
    if (!token) {
      clearAuthentication();
      return;
    }

    loading = true;
    dashboardError = null;

    try {
      dashboard = await fetchDashboard(token);
    } catch (error) {
      if (error instanceof BegetClientError && error.status === 401) {
        clearAuthentication("Session expired. Sign in again.");
        return;
      }

      dashboardError =
        error instanceof Error ? error.message : "Dashboard request failed.";
    } finally {
      loading = false;
    }
  }

  async function handleLogin(payload: AuthLoginPayload) {
    loginPending = true;
    loginError = null;

    try {
      const response = await authenticate(payload);
      begetToken = response.token;
      writeStoredToken(response.token, payload.saveMe !== false);
      loginCodeRequired = false;
      authenticated = true;
      await loadDashboard(response.token);
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
    const token = begetToken;
    clearAuthentication();

    if (!token) {
      return;
    }

    try {
      await logout(token);
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
  <meta content="https://beget-vps-manager.dokploy.me/" property="og:url">
  <meta content="Beget VPS Manager" property="og:site_name">
  <meta
    content="https://beget-vps-manager.dokploy.me/social-card.png"
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
    content="https://beget-vps-manager.dokploy.me/social-card.png"
    name="twitter:image"
  >
</svelte:head>

<div class="shell">
  <div class="background"></div>

  {#if !authReady}
    <section class="auth-wrap" transition:fade={{ duration: 180 }}>
      <div class="hero-copy">
        <p class="kicker">Svelte 5 / Bun / Static client</p>
        <h2>Rule your Beget fleet without leaving one screen.</h2>
        <p>Restoring the local Beget session from this browser.</p>
      </div>

      <div class="loading-card">
        <p>Restoring local session…</p>
      </div>
    </section>
  {:else if !authenticated}
    <section class="auth-wrap" transition:fade={{ duration: 180 }}>
      <div class="hero-copy">
        <p class="kicker">Svelte 5 / Bun / Static client</p>
        <h2>Rule your Beget fleet without leaving one screen.</h2>
        <p>
          This app keeps the Beget session in this browser and talks to the
          Beget API directly for CPU and RAM reconfiguration.
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
        error={loginError}
        onLogin={handleLogin}
        pending={loginPending}
      />
    </section>
  {:else}
    <section class="dashboard" transition:fade={{ duration: 180 }}>
      <header class="masthead">
        <div>
          <p class="kicker">Beget Control Room</p>
          <h1>VPS configuration deck</h1>
          <p class="deck">
            Authenticate locally, inspect every VPS, and push CPU/RAM changes
            without tab-hopping.
          </p>
        </div>

        <div class="masthead-actions">
          <button
            class="outline"
            disabled={loading}
            onclick={() => {
              void loadDashboard();
            }}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button class="outline" onclick={handleLogout} type="button">
            Logout
          </button>
        </div>
      </header>

      <div class="toolbar">
        <div class="toolbar-box">
          <span>Total VPS</span>
          <strong>{dashboard?.summary.total ?? '—'}</strong>
        </div>
        <div class="toolbar-box">
          <span>Configurable</span>
          <strong>{dashboard?.summary.configurable ?? '—'}</strong>
        </div>
        <div class="toolbar-box">
          <span>Running</span>
          <strong>{dashboard?.summary.active ?? '—'}</strong>
        </div>
        <div class="toolbar-box wide">
          <span>Last sync</span>
          <strong
            >{dashboard ? formatTimestamp(dashboard.summary.fetchedAt) : 'Waiting for data'}</strong
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
            placeholder="hostname, IP, region, status"
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

      {#if dashboardError}
        <p class="banner error">{dashboardError}</p>
      {/if}

      {#if loading && !dashboard}
        <div class="loading-state">Loading the VPS deck...</div>
      {:else if dashboard}
        <div class="grid">
          {#each visibleServers as server (`${server.id}:${server.currentCpuCount}:${server.currentMemory}:${server.status}`)}
            <VpsCard
              onRefresh={loadDashboard}
              {server}
              token={begetToken ?? ""}
            />
          {:else}
            <div class="empty-state">
              <h3>No VPS cards match the current filter.</h3>
              <p>Change the search query or switch to another page.</p>
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
                  <span aria-hidden="true" class="page-gap">…</span>
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
      {/if}
    </section>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
    background: #06101c;
    color: #eef5fa;
  }

  :global(html) {
    background: #06101c;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .shell {
    position: relative;
    min-height: 100vh;
    padding: 1.25rem;
    overflow: hidden;
    background:
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
  }

  .background {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(125, 231, 243, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(125, 231, 243, 0.05) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(circle at center, black, transparent 92%);
    pointer-events: none;
  }

  .auth-wrap,
  .dashboard {
    position: relative;
    z-index: 1;
    width: min(1180px, 100%);
    margin: 0 auto;
  }

  .auth-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(320px, 460px);
    gap: 1.25rem;
    align-items: center;
    min-height: calc(100vh - 2.5rem);
  }

  .hero-copy {
    padding: clamp(1rem, 3vw, 2rem);
  }

  .loading-card {
    padding: 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 1.5rem;
    background: rgba(8, 18, 31, 0.9);
    color: rgba(227, 236, 244, 0.82);
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
    color: #7de7f3;
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
  .deck {
    max-width: 55ch;
    line-height: 1.6;
    color: rgba(221, 232, 240, 0.78);
  }

  .source-note {
    margin-top: 1rem;
    font-size: 0.95rem;
  }

  .source-note a {
    color: #7de7f3;
    text-underline-offset: 0.2em;
    text-decoration-thickness: 0.08em;
  }

  .source-note a:hover {
    color: #ffd37a;
  }

  .dashboard {
    display: grid;
    gap: 1rem;
    padding-block: 1.5rem 2rem;
  }

  .masthead,
  .toolbar,
  .filters {
    display: grid;
    gap: 1rem;
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

  .toolbar {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .toolbar-box,
  .filters,
  .loading-state,
  .empty-state,
  .banner {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1.25rem;
    background: rgba(8, 18, 31, 0.82);
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
    color: rgba(188, 205, 218, 0.62);
  }

  .toolbar-box strong,
  .filter-note strong {
    display: block;
    margin-top: 0.35rem;
    font-size: 1.12rem;
    color: #f5f8fb;
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
    color: rgba(219, 231, 239, 0.78);
  }

  .search input {
    width: 100%;
    padding: 0.9rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    background: rgba(6, 13, 23, 0.72);
    color: #f5f8fb;
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
    color: rgba(188, 205, 218, 0.62);
  }

  .page-size select {
    min-width: 5.75rem;
    padding: 0.85rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    background: rgba(6, 13, 23, 0.72);
    color: #f5f8fb;
    font: inherit;
  }

  .filter-note {
    padding: 0.65rem 0.9rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .banner,
  .loading-state,
  .empty-state {
    padding: 1rem 1.1rem;
  }

  .banner.error {
    color: #ffc2ba;
    background: rgba(103, 16, 10, 0.35);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.85rem 0.95rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1.25rem;
    background: rgba(8, 18, 31, 0.82);
    backdrop-filter: blur(12px);
  }

  .pagination-summary strong,
  .pagination-summary span {
    display: block;
  }

  .pagination-summary strong {
    font-size: 1.05rem;
    color: #f5f8fb;
  }

  .pagination-summary span {
    margin-top: 0.2rem;
    font-size: 0.76rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(188, 205, 218, 0.62);
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
    color: rgba(188, 205, 218, 0.62);
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

  .outline {
    background: rgba(255, 255, 255, 0.08);
    color: #e4edf3;
  }

  .outline:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  @media (max-width: 900px) {
    .auth-wrap,
    .masthead,
    .filters,
    .toolbar,
    .pagination {
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
