import type {
  ConfiguratorInfoResponse,
  ConfiguratorRangeSettings,
  VpsInfo,
} from "$lib/beget/types";
import type {
  DashboardPayload,
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

function mapServer(
  server: VpsInfo,
  configurators: Map<string, ConfiguratorInfoResponse>,
): DashboardServer {
  const configuration = server.configuration ?? {};
  const currentDiskSize = configuration.disk_size ?? 0;
  const key = groupKey(server.region, configuration.group);
  const configurator = key ? configurators.get(key) : undefined;
  const cpu = toDashboardRange(configurator?.settings?.cpu_settings);
  const memory = toDashboardRange(configurator?.settings?.memory_settings);
  const resizeBlockers: string[] = [];

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

  if (!configurator) {
    resizeBlockers.push(
      "Configurator info was not returned for this region/group.",
    );
  } else if (!configurator.is_available) {
    resizeBlockers.push(
      "Beget configurator is unavailable for this region/group right now.",
    );
  }

  if (!cpu) {
    resizeBlockers.push(
      "CPU resize limits were not returned by the configurator.",
    );
  }

  if (!memory) {
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
    resizeBlockers,
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
): DashboardPayload {
  return {
    servers: servers.map((server) => mapServer(server, configurators)),
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
