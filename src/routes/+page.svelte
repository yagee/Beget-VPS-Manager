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
  let configurableOnly = $state(false);

  const storageKey = "beget-vps-manager:prefs";
  const codeChallengeErrors = new Set([
    "CODE_REQUIRED",
    "CODE_REQUIRED_EMAIL",
    "CODE_REQUIRED_SMS",
    "CODE_REQUIRED_TOTP",
    "INCORRECT_CODE",
    "CODE_INPUT_LIMIT",
    "CODE_SENT_LIMIT",
  ]);

  let filteredServers = $derived.by(() => {
    const servers = dashboard?.servers ?? [];
    const normalizedQuery = query.trim().toLowerCase();

    return servers
      .filter((server) => {
        if (configurableOnly && !server.reconfigurable) {
          return false;
        }

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

  onMount(() => {
    void (async () => {
      if (browser) {
        const raw = localStorage.getItem(storageKey);

        if (raw) {
          try {
            const parsed = JSON.parse(raw) as {
              query?: string;
              configurableOnly?: boolean;
            };

            query = parsed.query ?? "";
            configurableOnly = Boolean(parsed.configurableOnly);
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
        configurableOnly,
      }),
    );
  });

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
          ? codeChallengeErrors.has(error.code)
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
    content="Local-first dashboard for Beget VPS authentication and single-screen CPU/RAM reconfiguration."
    name="description"
  >
</svelte:head>

<div class="shell">
  <div class="background"></div>

  {#if !authReady}
    <section class="auth-wrap" transition:fade={{ duration: 180 }}>
      <div class="hero-copy">
        <p class="kicker">Svelte 5 / Bun / Local-first</p>
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
        <p class="kicker">Svelte 5 / Bun / Local-first</p>
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
          <input bind:value={query} placeholder="hostname, IP, region, status">
        </label>

        <label class="toggle">
          <input bind:checked={configurableOnly} type="checkbox">
          <span>Show only servers that can be resized now</span>
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
          {#each filteredServers as server (`${server.id}:${server.currentCpuCount}:${server.currentMemory}:${server.status}`)}
            <VpsCard
              onRefresh={loadDashboard}
              {server}
              token={begetToken ?? ""}
            />
          {:else}
            <div class="empty-state">
              <h3>No VPS cards match the current filter.</h3>
              <p>
                Change the search query or disable the reconfigurable-only
                toggle.
              </p>
            </div>
          {/each}
        </div>
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

  .toggle {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 0.95rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
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
    .toolbar {
      grid-template-columns: 1fr;
    }

    .hero-copy {
      padding: 1rem 0;
    }

    h2 {
      max-width: none;
    }
  }
</style>
