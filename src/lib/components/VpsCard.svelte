<script lang="ts">
  import { untrack } from "svelte";
  import {
    fetchConfigurationCalculation,
    fetchVpsStats,
    updateServerConfiguration,
  } from "$lib/beget/browser";
  import MetricSparkline from "$lib/components/MetricSparkline.svelte";
  import type {
    CalculationPayload,
    DashboardServer,
    StatsPeriod,
    VpsStatsPayload,
  } from "$lib/types";
  import { formatGigabytes, formatPrice } from "$lib/utils/format";

  type Props = {
    server: DashboardServer;
    token: string;
    onRefresh?: () => Promise<void> | void;
    viewMode?: "control" | "monitor";
    showAccountLabel?: boolean;
    favorite?: boolean;
    onToggleFavorite?: () => void;
  };

  let {
    server,
    token,
    onRefresh,
    viewMode = "control",
    showAccountLabel = false,
    favorite = false,
    onToggleFavorite,
  }: Props = $props();

  let cpuCount = $state(0);
  let memory = $state(0);
  let diskSize = $state(0);
  let configurationMode = $state<"custom" | "preset">("custom");
  let selectedPresetId = $state("");
  let calculation = $state<CalculationPayload | null>(null);
  let calculationError = $state<string | null>(null);
  let savingError = $state<string | null>(null);
  let successMessage = $state<string | null>(null);
  let calculating = $state(false);
  let saving = $state(false);
  let stats = $state<VpsStatsPayload | null>(null);
  let statsPeriod = $state<StatsPeriod>("DAY");
  let statsCache = $state<Partial<Record<StatsPeriod, VpsStatsPayload>>>({});
  let statsLoading = $state(false);
  let statsError = $state<string | null>(null);
  let statsController = $state<AbortController | null>(null);

  const periodOptions: Array<{ value: StatsPeriod; label: string }> = [
    { value: "HOUR", label: "1H" },
    { value: "DAY", label: "1D" },
    { value: "WEEK", label: "1W" },
    { value: "MONTH", label: "1M" },
  ];

  let selectedPreset = $derived(
    server.presets.find((preset) => preset.id === selectedPresetId) ?? null,
  );
  let isDirty = $derived(
    configurationMode === "preset" && selectedPreset
      ? selectedPreset.id !== server.currentConfigurationId
      : cpuCount !== server.currentCpuCount ||
          memory !== server.currentMemory ||
          diskSize !== server.currentDiskSize,
  );
  let projectedPriceMonth = $derived(
    configurationMode === "preset" && selectedPreset
      ? selectedPreset.priceMonth
      : (calculation?.priceMonth ?? server.currentPriceMonth),
  );
  let priceDeltaMonth = $derived(
    projectedPriceMonth - server.currentPriceMonth,
  );
  let hasPresetOptions = $derived(server.presets.length > 0);
  let showPlanCard = $derived(!server.currentConfigurationCustom);
  let canSwitchToCustom = $derived(server.configurable);
  let showConfigurationMode = $derived(
    showPlanCard && hasPresetOptions && canSwitchToCustom,
  );
  let showPresetSelect = $derived(
    showPlanCard &&
      hasPresetOptions &&
      (configurationMode === "preset" || !canSwitchToCustom),
  );
  let showFacts = $derived(
    showPlanCard || showConfigurationMode || showPresetSelect,
  );
  let canUsePresets = $derived(server.manageEnabled && hasPresetOptions);
  let canApplyCurrentMode = $derived(
    configurationMode === "preset" ? canUsePresets : server.reconfigurable,
  );
  let isMonitorView = $derived(viewMode === "monitor");
  let serverKey = $derived(`${server.accountId ?? "default"}:${server.id}`);

  function clamp(value: number, min: number, max: number, step: number) {
    const bounded = Math.min(max, Math.max(min, value));
    const normalized = Math.round((bounded - min) / step) * step + min;
    return Math.min(max, Math.max(min, normalized));
  }

  function formatDelta(value: number) {
    if (value === 0) {
      return "No price change";
    }

    const sign = value > 0 ? "+" : "−";
    return `${sign}${formatPrice(Math.abs(value))} / month`;
  }

  function statusTone() {
    if (server.status === "RUNNING") return "ok";
    if (server.status === "RECONFIGURING") return "warn";
    if (server.status === "STOPPED") return "muted";
    return "busy";
  }

  async function applyChange() {
    if (!server.reconfigurable) {
      if (!(configurationMode === "preset" && canUsePresets)) {
        return;
      }
    }

    saving = true;
    savingError = null;
    successMessage = null;

    try {
      await updateServerConfiguration(token, {
        id: server.id,
        configurationId:
          configurationMode === "preset" && selectedPreset
            ? selectedPreset.id
            : undefined,
        cpuCount,
        memory,
        diskSize,
      });
      successMessage = "Resize request sent to Beget.";
      await onRefresh?.();
    } catch (error) {
      savingError =
        error instanceof Error ? error.message : "Configuration update failed.";
    } finally {
      saving = false;
    }
  }

  function resetDraft() {
    const currentPreset =
      !server.currentConfigurationCustom && server.currentConfigurationId
        ? server.presets.find(
            (preset) => preset.id === server.currentConfigurationId,
          )
        : null;

    configurationMode = currentPreset ? "preset" : "custom";
    selectedPresetId = currentPreset?.id ?? "";
    cpuCount = currentPreset?.cpuCount ?? server.currentCpuCount;
    memory = currentPreset?.memory ?? server.currentMemory;
    diskSize = currentPreset?.diskSize ?? server.currentDiskSize;
    calculation = null;
    calculationError = null;
    successMessage = null;
  }

  async function loadStats(
    serverId: string,
    period: StatsPeriod,
    forceRefresh = false,
  ) {
    const cachedStats = statsCache[period];
    if (cachedStats && !forceRefresh) {
      stats = cachedStats;
      statsError = null;
      return;
    }

    statsController?.abort();
    const controller = new AbortController();
    statsController = controller;
    statsLoading = true;
    statsError = null;

    try {
      const payload = await fetchVpsStats(
        token,
        serverId,
        period,
        server.currentCpuCount,
      );

      if (
        server.id === serverId &&
        statsPeriod === period &&
        statsController === controller
      ) {
        statsCache = {
          ...statsCache,
          [period]: payload,
        };
        stats = payload;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      if (
        server.id === serverId &&
        statsPeriod === period &&
        statsController === controller
      ) {
        statsError =
          error instanceof Error ? error.message : "Statistics request failed.";
      }
    } finally {
      if (statsController === controller) {
        statsController = null;
        statsLoading = false;
      }
    }
  }

  $effect(() => {
    server.currentCpuCount;
    server.currentMemory;
    server.currentDiskSize;
    server.currentConfigurationId;
    server.currentConfigurationCustom;
    server.presets;

    const currentPreset =
      !server.currentConfigurationCustom && server.currentConfigurationId
        ? server.presets.find(
            (preset) => preset.id === server.currentConfigurationId,
          )
        : null;

    configurationMode = currentPreset ? "preset" : "custom";
    selectedPresetId = currentPreset?.id ?? "";
    cpuCount = currentPreset?.cpuCount ?? server.currentCpuCount;
    memory = currentPreset?.memory ?? server.currentMemory;
    diskSize = currentPreset?.diskSize ?? server.currentDiskSize;
    calculation = null;
    calculationError = null;
    successMessage = null;
  });

  $effect(() => {
    if (!showPlanCard) {
      return;
    }

    if (!canSwitchToCustom && hasPresetOptions) {
      configurationMode = "preset";
    }
  });

  $effect(() => {
    if (
      configurationMode === "preset" &&
      !selectedPresetId &&
      server.presets[0]?.id
    ) {
      selectedPresetId = server.presets[0].id;
    }

    if (configurationMode === "custom") {
      diskSize = server.currentDiskSize;
      return;
    }

    if (configurationMode !== "preset" || !selectedPreset) {
      return;
    }

    cpuCount = selectedPreset.cpuCount;
    memory = selectedPreset.memory;
    diskSize = selectedPreset.diskSize;
    calculation = null;
    calculationError = null;
  });

  $effect(() => {
    serverKey;
    token;
    const serverId = server.id;

    untrack(() => {
      statsController?.abort();
    });

    statsPeriod = "DAY";
    statsCache = {};
    stats = null;
    statsError = null;
    statsLoading = false;
    statsController = null;

    return () => {
      statsController?.abort();
    };
  });

  $effect(() => {
    serverKey;
    token;
    const serverId = server.id;
    const period = statsPeriod;

    stats = statsCache[period] ?? null;
    statsError = null;

    untrack(() => {
      void loadStats(serverId, period);
    });
  });

  $effect(() => {
    if (!isMonitorView) {
      return;
    }

    serverKey;
    token;
    const serverId = server.id;
    const period = statsPeriod;
    const interval = window.setInterval(() => {
      untrack(() => {
        void loadStats(serverId, period, true);
      });
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  });

  $effect(() => {
    if (
      !server.reconfigurable ||
      !server.cpu ||
      !server.memory ||
      !isDirty ||
      configurationMode === "preset"
    ) {
      calculation = null;
      calculationError = null;
      calculating = false;
      return;
    }

    const nextCpu = clamp(
      cpuCount,
      server.cpu.min,
      server.cpu.max,
      server.cpu.step,
    );
    const nextMemory = clamp(
      memory,
      server.memory.min,
      server.memory.max,
      server.memory.step,
    );

    if (nextCpu !== cpuCount) {
      cpuCount = nextCpu;
    }

    if (nextMemory !== memory) {
      memory = nextMemory;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      calculating = true;
      calculationError = null;

      try {
        calculation = await fetchConfigurationCalculation(token, {
          cpuCount: nextCpu,
          memory: nextMemory,
          diskSize: server.currentDiskSize,
          region: server.region,
          configurationGroup: server.configurationGroup,
          vpsId: server.id,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        calculationError =
          error instanceof Error ? error.message : "Calculation failed.";
      } finally {
        if (!controller.signal.aborted) {
          calculating = false;
        }
      }
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  });
</script>

<article class="card" class:monitor={isMonitorView}>
  <header class="card-head">
    <div class="title-block">
      {#if showAccountLabel && server.accountLabel}
        <p class="account-pill">{server.accountLabel}</p>
      {/if}
      <p class="name">{server.displayName}</p>
      <p class="meta">
        {#if !isMonitorView}
          {server.hostname || server.technicalDomain || server.id}
          <span>{server.region || 'n/a'}</span>
        {/if}
        <span>{server.ipAddress || 'n/a'}</span>
      </p>
    </div>
    <div class="card-head-actions">
      <button
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={favorite}
        class="favorite-toggle"
        class:active={favorite}
        onclick={() => {
          onToggleFavorite?.();
        }}
        type="button"
      >
        <span aria-hidden="true">★</span>
      </button>
      <div class="status {statusTone()}">{server.status}</div>
    </div>
  </header>

  <div class="metrics">
    <div class="metrics-toolbar">
      <p class="metrics-label">Load history</p>
      <div aria-label="Chart period" class="periods">
        {#each periodOptions as option (option.value)}
          <button
            class="period-button"
            class:active={statsPeriod === option.value}
            onclick={() => {
              statsPeriod = option.value;
            }}
            type="button"
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>

    <MetricSparkline
      compact={isMonitorView}
      error={statsError}
      idSuffix={`${serverKey}-cpu`}
      loading={statsLoading}
      stats={stats?.cpu ?? null}
      title="CPU load"
      tone="cpu"
      unit="percent"
    />
    <MetricSparkline
      ceiling={server.currentMemory / 1024}
      compact={isMonitorView}
      error={statsError}
      idSuffix={`${serverKey}-memory`}
      loading={statsLoading}
      stats={stats?.memory ?? null}
      title="RAM load"
      tone="memory"
      unit="gigabytes"
    />
  </div>

  {#if !isMonitorView && showFacts}
    <div class="facts" class:preset-layout={showPlanCard}>
      {#if showPlanCard}
        <div>
          <span>Current plan</span>
          <strong>{server.configurationName}</strong>
        </div>
      {/if}
      {#if showConfigurationMode}
        <label class="facts-select">
          <span>Configuration mode</span>
          <select bind:value={configurationMode} disabled={!canUsePresets}>
            <option value="custom">Custom</option>
            <option value="preset">Preset</option>
          </select>
        </label>
      {/if}
      {#if showPresetSelect}
        <label class="facts-select preset-select">
          <span>Preset</span>
          <select bind:value={selectedPresetId} disabled={!canUsePresets}>
            {#each server.presets as preset (preset.id)}
              <option value={preset.id}>
                {preset.name}
                · {preset.cpuCount} CPU · {formatGigabytes(preset.memory)} GB
                RAM
              </option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  {/if}

  {#if !isMonitorView}
    <div class="resources">
      <label class="control">
        <div class="control-head">
          <span>CPU</span>
          <strong>{cpuCount}</strong>
        </div>
        <input
          bind:value={cpuCount}
          disabled={!server.reconfigurable || configurationMode === "preset"}
          max={server.cpu?.max}
          min={server.cpu?.min}
          step={server.cpu?.step ?? 1}
          type="range"
        >
        <input
          bind:value={cpuCount}
          class="number"
          disabled={!server.reconfigurable || configurationMode === "preset"}
          max={server.cpu?.max}
          min={server.cpu?.min}
          step={server.cpu?.step ?? 1}
          type="number"
        >
      </label>

      <label class="control">
        <div class="control-head">
          <span>RAM</span>
          <strong>{formatGigabytes(memory)} GB</strong>
        </div>
        <input
          bind:value={memory}
          disabled={!server.reconfigurable || configurationMode === "preset"}
          max={server.memory?.max}
          min={server.memory?.min}
          step={server.memory?.step ?? 1}
          type="range"
        >
        <input
          bind:value={memory}
          class="number"
          disabled={!server.reconfigurable || configurationMode === "preset"}
          max={server.memory?.max}
          min={server.memory?.min}
          step={server.memory?.step ?? 1}
          type="number"
        >
      </label>

      <div class="control disk-card">
        <div class="control-head">
          <span>DISK</span>
          <strong>{formatGigabytes(diskSize)} GB</strong>
        </div>
        <div class="disk-copy">
          <span
            >{configurationMode === "preset" ? "Current volume" : "Used"}</span
          >
          <strong>
            {configurationMode === "preset"
            ? `${formatGigabytes(diskSize)} GB`
            : server.diskUsedMb !== null
            ? `${formatGigabytes(server.diskUsedMb)} / ${formatGigabytes(server.currentDiskSize)} GB`
            : 'n/a'}
          </strong>
        </div>
      </div>

      <div class="control price-card">
        <div class="price-row">
          <span>Current</span>
          <strong>{formatPrice(server.currentPriceMonth)} / month</strong>
        </div>
        <div class="price-row">
          <span>Projected</span>
          <strong>{formatPrice(projectedPriceMonth)} / month</strong>
        </div>
        <div
          class="price-row"
          class:gain={priceDeltaMonth < 0}
          class:loss={priceDeltaMonth > 0}
        >
          <span>Delta</span>
          <strong>{formatDelta(priceDeltaMonth)}</strong>
        </div>
      </div>
    </div>
  {/if}

  {#if !isMonitorView && calculating}
    <p class="info recalculating">Recalculating cost and limits...</p>
  {/if}

  {#if !isMonitorView && !server.reconfigurable && server.configurable}
    <p class="info muted">
      {#if configurationMode === "preset" && canUsePresets}
        Ready to switch to a preset configuration. Custom configurator controls
        are unavailable for this server right now.
      {:else if server.configuratorStatus === "request_failed"}
        Resize options are temporarily unavailable because configurator data
        could not be loaded.
      {:else}
        This server cannot be resized from the configurator right now.
      {/if}
    </p>

    {#if server.resizeBlockers.length}
      <div class="blockers">
        {#each server.resizeBlockers as blocker (blocker)}
          <p class="info error-soft">{blocker}</p>
        {/each}
      </div>
    {/if}
  {/if}

  {#if !isMonitorView && calculationError}
    <p class="info error">{calculationError}</p>
  {/if}

  {#if !isMonitorView && savingError}
    <p class="info error">{savingError}</p>
  {/if}

  {#if !isMonitorView && successMessage}
    <p class="info success">{successMessage}</p>
  {/if}

  {#if server.flags.archived || server.flags.migrating || server.flags.rescueMode || server.flags.hostUnavailable}
    <div class="flags">
      {#if server.flags.archived}
        <span>archived</span>
      {/if}
      {#if server.flags.migrating}
        <span>migrating</span>
      {/if}
      {#if server.flags.rescueMode}
        <span>rescue</span>
      {/if}
      {#if server.flags.hostUnavailable}
        <span>host issue</span>
      {/if}
    </div>
  {/if}

  {#if !isMonitorView}
    <footer class="actions">
      <button
        class="ghost"
        disabled={!isDirty || saving}
        onclick={resetDraft}
        type="button"
      >
        Reset
      </button>
      <button
        class="primary"
        disabled={!canApplyCurrentMode || !isDirty || saving}
        onclick={applyChange}
        type="button"
      >
        {saving ? 'Applying...' : 'Apply changes'}
      </button>
    </footer>
  {/if}
</article>

<style>
  .card {
    position: relative;
    display: grid;
    gap: 1rem;
    padding: 1.2rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1.35rem;
    background:
      linear-gradient(180deg, rgba(9, 18, 30, 0.96), rgba(6, 13, 23, 0.94)),
      radial-gradient(
        circle at top left,
        rgba(255, 198, 90, 0.14),
        transparent 34%
      );
    box-shadow: 0 24px 65px rgba(3, 7, 16, 0.3);
  }

  .card.monitor {
    gap: 0.85rem;
    padding: 1rem;
  }

  .card-head,
  .control-head,
  .actions,
  .flags,
  .card-head-actions {
    display: flex;
    gap: 0.75rem;
  }

  .card-head,
  .control-head,
  .actions,
  .card-head-actions {
    justify-content: space-between;
    align-items: center;
  }

  .title-block {
    display: grid;
    gap: 0.25rem;
  }

  .account-pill {
    margin: 0;
    width: fit-content;
    padding: 0.22rem 0.55rem;
    border-radius: 999px;
    background: rgba(125, 231, 243, 0.12);
    color: #9aeef8;
    font:
      700 0.68rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .name,
  .meta {
    margin: 0;
  }

  .name {
    font:
      700 1.12rem / 1.1 "Space Grotesk",
      "Avenir Next",
      "Segoe UI",
      sans-serif;
    color: #f4f7fb;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.8rem;
    font:
      0.79rem / 1.35 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    color: rgba(187, 208, 224, 0.72);
  }

  .meta span::before {
    content: "•";
    margin-right: 0.45rem;
    color: rgba(125, 231, 243, 0.48);
  }

  .favorite-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(217, 231, 239, 0.66);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .favorite-toggle:hover {
    color: #fff1bb;
    transform: translateY(-1px);
  }

  .favorite-toggle.active {
    background: linear-gradient(135deg, #ffd37a 0%, #f8b84b 100%);
    color: #241707;
  }

  .favorite-toggle span {
    font-size: 1rem;
    line-height: 1;
  }

  .status {
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    font:
      700 0.72rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .ok {
    background: rgba(85, 224, 167, 0.14);
    color: #8cf4c0;
  }

  .warn {
    background: rgba(255, 197, 92, 0.16);
    color: #ffd27f;
  }

  .busy {
    background: rgba(103, 197, 255, 0.16);
    color: #93dbff;
  }

  .muted {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(220, 230, 238, 0.76);
  }

  .facts,
  .resources,
  .metrics {
    width: 100%;
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.85rem;
  }

  .facts.preset-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .facts > div {
    padding: 0.8rem 0.9rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .facts span {
    display: block;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(185, 203, 218, 0.64);
  }

  .facts strong {
    display: block;
    margin-top: 0.3rem;
    color: #f5f9fb;
  }

  .facts-select {
    display: grid;
    gap: 0.45rem;
    padding: 0.8rem 0.9rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .facts-select select {
    width: 100%;
    padding: 0.7rem 0.8rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.8rem;
    background: rgba(5, 13, 22, 0.72);
    color: #f4f7fb;
    font: inherit;
  }

  .resources {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.85rem;
  }

  .disk-card {
    justify-content: space-between;
  }

  .disk-copy {
    display: grid;
    gap: 0.35rem;
  }

  .disk-copy span {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(185, 203, 218, 0.64);
  }

  .disk-copy strong {
    color: #f5f9fb;
  }

  .price-card {
    align-content: start;
  }

  .price-row {
    display: grid;
    gap: 0.3rem;
  }

  .price-row + .price-row {
    padding-top: 0.65rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .price-row span {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(185, 203, 218, 0.64);
  }

  .price-row strong {
    color: #f5f9fb;
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
  }

  .card.monitor .metrics {
    gap: 0.7rem;
  }

  .metrics-toolbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .metrics-label {
    margin: 0;
    font:
      700 0.76rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(188, 205, 218, 0.62);
  }

  .card.monitor .metrics-label {
    font-size: 0.72rem;
  }

  .periods {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.28rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
  }

  .period-button {
    border: 0;
    border-radius: 999px;
    padding: 0.48rem 0.72rem;
    background: transparent;
    color: rgba(219, 231, 239, 0.8);
    font:
      700 0.72rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition:
      background 160ms ease,
      color 160ms ease,
      transform 160ms ease;
  }

  .period-button:hover {
    color: #f6fafc;
    transform: translateY(-1px);
  }

  .period-button.active {
    background: linear-gradient(
      135deg,
      rgba(248, 184, 75, 0.22),
      rgba(125, 231, 243, 0.18)
    );
    color: #f9fbfd;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }

  .card.monitor .periods {
    gap: 0.25rem;
    padding: 0.22rem;
  }

  .card.monitor .period-button {
    padding: 0.42rem 0.58rem;
    font-size: 0.68rem;
  }

  .control {
    display: grid;
    gap: 0.55rem;
    padding: 0.9rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.035);
  }

  .control span {
    font-size: 0.84rem;
    color: rgba(209, 221, 231, 0.82);
  }

  .control strong {
    color: #f5f8fa;
  }

  input[type="range"] {
    width: 100%;
    accent-color: #f7c160;
  }

  .number {
    width: 100%;
    padding: 0.7rem 0.8rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.8rem;
    background: rgba(5, 13, 22, 0.72);
    color: #f4f7fb;
    font: inherit;
  }

  .info {
    margin: 0;
    padding: 0.75rem 0.85rem;
    border-radius: 0.95rem;
    background: rgba(125, 231, 243, 0.08);
    color: #bfeff5;
  }

  .info.muted {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(222, 231, 237, 0.8);
  }

  .info.error {
    background: rgba(255, 109, 91, 0.14);
    color: #ffbdb3;
  }

  .info.error-soft {
    background: rgba(255, 109, 91, 0.1);
    color: #ffbdb3;
  }

  .info.success {
    background: rgba(93, 232, 177, 0.12);
    color: #abf4d1;
  }

  .recalculating {
    position: absolute;
    left: 50%;
    bottom: 1.1rem;
    transform: translateX(-50%);
    width: max-content;
    max-width: calc(100% - 2.4rem);
    z-index: 2;
    box-shadow: 0 12px 30px rgba(3, 7, 16, 0.28);
  }

  .flags {
    flex-wrap: wrap;
  }

  .actions {
    justify-content: flex-end;
    margin-top: 0.2rem;
  }

  .blockers {
    display: grid;
    gap: 0.5rem;
  }

  .flags span {
    padding: 0.4rem 0.65rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(235, 240, 245, 0.8);
    font-size: 0.75rem;
  }

  .gain strong {
    color: #8cf4c0;
  }

  .loss strong {
    color: #ffcb92;
  }

  button {
    border: 0;
    border-radius: 999px;
    padding: 0.8rem 1rem;
    font:
      700 0.85rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
    cursor: pointer;
  }

  .ghost {
    background: rgba(255, 255, 255, 0.08);
    color: #d9e6ef;
  }

  .actions .ghost {
    margin-right: auto;
  }

  .primary {
    background: linear-gradient(120deg, #f8b84b, #ffd770);
    color: #111722;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  @media (max-width: 1080px) {
    .resources {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 620px) {
    .metrics-toolbar {
      flex-direction: column;
      align-items: flex-start;
    }

    .facts,
    .resources,
    .metrics {
      grid-template-columns: 1fr;
    }

    .actions {
      flex-direction: column;
      align-items: stretch;
    }

    .actions .ghost {
      margin-right: 0;
    }
  }
</style>
