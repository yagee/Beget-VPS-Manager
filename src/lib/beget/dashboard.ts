import type {
  ConfiguratorInfoResponse,
  ConfiguratorRangeSettings,
  VpsConfiguration,
  VpsInfo,
} from "$lib/beget/types";
import type {
  DashboardPayload,
  DashboardPreset,
  DashboardRange,
  DashboardServer,
} from "$lib/types";

export function groupKey(
  region?: string,
  configurationGroup?: string,
): string | null {
  if (!region || !configurationGroup) {
    return null;
  }

  return `${region}::${configurationGroup}`;
}

function toDashboardRange(
  settings?: ConfiguratorRangeSettings,
): DashboardRange | null {
  const min = settings?.range?.min;
  const max = settings?.range?.max;

  if (typeof min !== "number" || typeof max !== "number") {
    return null;
  }

  return {
    min,
    max,
    step: settings?.step ?? 1,
    availableMin: settings?.available_range?.min ?? min,
    availableMax: settings?.available_range?.max ?? max,
  };
}

function parseDiskMetric(
  value: string | undefined,
  diskSizeMb: number,
): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  if (diskSizeMb > 0 && parsed > diskSizeMb * 1024) {
    return parsed / (1024 * 1024);
  }

  return parsed;
}

function isCustomConfiguration(
  configuration: VpsInfo["configuration"],
): boolean {
  if (!configuration) {
    return false;
  }

  if (configuration.custom) {
    return true;
  }

  const normalizedName = configuration.name?.trim().toLowerCase() ?? "";
  return (
    normalizedName === "custom configuration" || normalizedName === "custom"
  );
}

function hasPresetShape(
  configuration: VpsConfiguration | undefined,
): configuration is VpsConfiguration {
  return Boolean(configuration?.id);
}

function mapServer(
  server: VpsInfo,
  configurators: Map<string, ConfiguratorInfoResponse>,
  configuratorFailures: Map<string, string>,
  configurations: VpsInfo["configuration"][],
): DashboardServer {
  const configuration = server.configuration ?? {};
  const currentDiskSize = configuration.disk_size ?? 0;
  const key = groupKey(server.region, configuration.group);
  const configurator = key ? configurators.get(key) : undefined;
  const configuratorFailure = key ? configuratorFailures.get(key) : undefined;
  const cpu = toDashboardRange(configurator?.settings?.cpu_settings);
  const memory = toDashboardRange(configurator?.settings?.memory_settings);
  const resizeBlockers: string[] = [];
  let configuratorStatus: DashboardServer["configuratorStatus"] = "loaded";
  const presets: DashboardPreset[] = configurations
    .filter(hasPresetShape)
    .filter(
      (item) =>
        item.available &&
        !item.custom &&
        item.region === server.region &&
        item.group === configuration.group,
    )
    .map((item) => ({
      id: item.id ?? "",
      name: item.name ?? "Preset configuration",
      cpuCount: item.cpu_count ?? 0,
      memory: item.memory ?? 0,
      diskSize: item.disk_size ?? 0,
      priceDay: item.price_day ?? 0,
      priceMonth: item.price_month ?? 0,
    }))
    .sort((left, right) => {
      if (left.cpuCount !== right.cpuCount) {
        return left.cpuCount - right.cpuCount;
      }

      if (left.memory !== right.memory) {
        return left.memory - right.memory;
      }

      return left.diskSize - right.diskSize;
    });

  if (!server.manage_enabled) {
    resizeBlockers.push(
      "Beget manage operations are disabled for this server.",
    );
  }

  if (!configuration.configurable) {
    resizeBlockers.push(
      "The current Beget configuration is not marked as configurable.",
    );
  }

  if (configuratorFailure) {
    configuratorStatus = "request_failed";
    resizeBlockers.push(
      `Configurator limits could not be loaded right now. Try Refresh. ${configuratorFailure}`,
    );
  } else if (!configurator) {
    configuratorStatus = "missing";
    resizeBlockers.push(
      "Configurator info was not returned for this region/group.",
    );
  } else if (!configurator.is_available) {
    configuratorStatus = "unavailable";
    resizeBlockers.push(
      "Beget configurator is unavailable for this region/group right now.",
    );
  }

  if (!cpu && !configuratorFailure) {
    resizeBlockers.push(
      "CPU resize limits were not returned by the configurator.",
    );
  }

  if (!memory && !configuratorFailure) {
    resizeBlockers.push(
      "RAM resize limits were not returned by the configurator.",
    );
  }

  const reconfigurable =
    Boolean(server.manage_enabled) &&
    Boolean(configuration.configurable) &&
    Boolean(configurator?.is_available) &&
    Boolean(cpu) &&
    Boolean(memory);

  return {
    id: server.id ?? "",
    slug: server.slug ?? "",
    displayName:
      server.display_name ?? server.hostname ?? server.id ?? "Unnamed VPS",
    hostname: server.hostname ?? "",
    description: server.description ?? "",
    status: server.status ?? "UNKNOWN",
    region: server.region ?? "",
    ipAddress: server.ip_address ?? "",
    technicalDomain: server.technical_domain ?? "",
    configurationName: configuration.name ?? "Custom",
    configurationGroup: configuration.group ?? "",
    currentConfigurationId: configuration.id ?? "",
    currentConfigurationCustom: isCustomConfiguration(configuration),
    currentCpuCount: configuration.cpu_count ?? 0,
    currentMemory: configuration.memory ?? 0,
    currentDiskSize,
    diskUsedMb: parseDiskMetric(server.disk_used, currentDiskSize),
    diskLeftMb: parseDiskMetric(server.disk_left, currentDiskSize),
    currentPriceDay: configuration.price_day ?? 0,
    currentPriceMonth: configuration.price_month ?? 0,
    dailyBandwidth: configuration.bandwidth_public ?? 0,
    manageEnabled: Boolean(server.manage_enabled),
    configurable: Boolean(configuration.configurable),
    reconfigurable,
    configuratorStatus,
    resizeBlockers,
    presets,
    cpu,
    memory,
    flags: {
      archived: Boolean(server.archived),
      migrating: Boolean(server.migrating),
      rescueMode: Boolean(server.rescue_mode),
      hostUnavailable: Boolean(server.host_unavailable),
    },
  };
}

export function buildDashboardPayload(
  servers: VpsInfo[],
  configurators: Map<string, ConfiguratorInfoResponse>,
  configuratorFailures: Map<string, string>,
  configurations: VpsInfo["configuration"][],
): DashboardPayload {
  return {
    servers: servers.map((server) =>
      mapServer(server, configurators, configuratorFailures, configurations),
    ),
    summary: {
      total: servers.length,
      configurable: servers.filter(
        (server) => server.configuration?.configurable,
      ).length,
      active: servers.filter((server) => server.status === "RUNNING").length,
      fetchedAt: new Date().toISOString(),
    },
  };
}
