import { buildDashboardPayload, groupKey } from "$lib/beget/dashboard";
import type {
  AuthResponse,
  ChangeConfigurationResponse,
  ConfiguratorCalculationResponse,
  ConfiguratorInfoResponse,
  GetAvailableConfigurationResponse,
  GetListResponse,
  StatisticGetCpuResponse,
  StatisticGetMemoryResponse,
} from "$lib/beget/types";
import type {
  AuthLoginPayload,
  CalculationPayload,
  MetricPoint,
  MetricStats,
  StatsPeriod,
  VpsStatsPayload,
} from "$lib/types";

const API_BASE_URL =
  import.meta.env.PUBLIC_BEGET_API_BASE_URL || "https://api.beget.com";
const AUTH_X_TOKEN =
  import.meta.env.PUBLIC_BEGET_AUTH_X_TOKEN || "y0wcxs9n91mxf92";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  searchParams?: Record<string, string | number | boolean | null | undefined>;
};

const authErrorMessages: Record<string, string> = {
  EMPTY_LOGIN: "Login is required.",
  EMPTY_PASSWORD: "Password is required.",
  INCORRECT_CREDENTIALS: "Incorrect login or password.",
  CODE_REQUIRED: "A confirmation code is required.",
  CODE_REQUIRED_EMAIL: "Check your email for the confirmation code.",
  CODE_REQUIRED_SMS: "Check your SMS messages for the confirmation code.",
  CODE_REQUIRED_TOTP: "Your TOTP code is required.",
  INCORRECT_CODE: "The confirmation code is incorrect.",
  IP_BLOCKED: "The current IP is blocked by Beget.",
  EXPIRED_PASSWORD: "The account password has expired.",
  ACCOUNT_ON_MAINTANCE: "The Beget account is under maintenance.",
  ACCOUNT_DELETED: "The Beget account is deleted.",
};

export class BegetClientError extends Error {
  status?: number;
  code?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string } = {},
  ) {
    super(message);
    this.name = "BegetClientError";
    this.status = options.status;
    this.code = options.code;
  }
}

function parseResponseError(payload: unknown): {
  message?: string;
  code?: string;
} {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const message =
    typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message
      : undefined;
  const code =
    typeof (payload as { code?: unknown }).code === "string"
      ? (payload as { code: string }).code
      : typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : undefined;

  return { message, code };
}

async function begetRequest<T>(
  path: string,
  { method = "GET", token, body, headers, searchParams }: RequestOptions = {},
): Promise<T> {
  const url = new URL(path, API_BASE_URL);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    mode: "cors",
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJsonResponse = contentType.includes("application/json");

  async function readJsonBody() {
    try {
      return await response.json();
    } catch (error) {
      throw new BegetClientError(
        "Beget API returned an empty or invalid JSON response.",
        {
          status: response.status,
          code: error instanceof Error ? error.name : undefined,
        },
      );
    }
  }

  if (!response.ok) {
    if (isJsonResponse) {
      const payload = await readJsonBody();
      const { message, code } = parseResponseError(payload);
      throw new BegetClientError(
        message || `Beget API request failed with ${response.status}.`,
        {
          status: response.status,
          code,
        },
      );
    }

    const text = await response.text();
    throw new BegetClientError(
      text || `Beget API request failed with ${response.status}.`,
      {
        status: response.status,
      },
    );
  }

  if (response.status === 204 || !isJsonResponse) {
    return undefined as T;
  }

  return (await readJsonBody()) as T;
}

function toMetricPoints(
  date: string[] = [],
  value: number[] = [],
): MetricPoint[] {
  return date
    .map((entry, index) => ({
      date: entry,
      value: typeof value[index] === "number" ? value[index] : NaN,
    }))
    .filter((point) => Number.isFinite(point.value));
}

function toGigabytes(points: MetricPoint[]): MetricPoint[] {
  return points.map((point) => ({
    ...point,
    value: point.value / 1024,
  }));
}

function normalizeCpu(
  points: MetricPoint[],
  cpuCount: number | null,
): MetricPoint[] {
  if (!cpuCount || !points.length) {
    return points;
  }

  const peak = Math.max(...points.map((point) => point.value));

  if (peak <= 100) {
    return points;
  }

  return points.map((point) => ({
    ...point,
    value: point.value / cpuCount,
  }));
}

function summarize(points: MetricPoint[]): MetricStats {
  if (!points.length) {
    return {
      current: null,
      average: null,
      peak: null,
      points: [],
    };
  }

  const values = points.map((point) => point.value);
  const total = values.reduce((sum, item) => sum + item, 0);

  return {
    current: values.at(-1) ?? null,
    average: total / values.length,
    peak: Math.max(...values),
    points,
  };
}

async function getServerListPage(token: string, offset: number, limit: number) {
  return begetRequest<GetListResponse>("/v1/vps/server/list", {
    token,
    searchParams: {
      offset,
      limit,
    },
  });
}

async function getServerList(token: string) {
  const pageSize = 250;
  const firstPage = await getServerListPage(token, 0, pageSize);
  const servers = [...(firstPage.vps ?? [])];
  const totalCount = firstPage.total_count ?? servers.length;

  if (servers.length >= totalCount) {
    return {
      ...firstPage,
      vps: servers,
    };
  }

  for (let offset = servers.length; offset < totalCount; offset += pageSize) {
    const page = await getServerListPage(token, offset, pageSize);
    servers.push(...(page.vps ?? []));
  }

  return {
    ...firstPage,
    vps: servers,
    total_count: totalCount,
  };
}

async function getConfiguratorInfo(
  token: string,
  region: string,
  configurationGroup: string,
) {
  return begetRequest<ConfiguratorInfoResponse>("/v1/vps/configurator/info", {
    token,
    searchParams: {
      region,
      configuration_group: configurationGroup,
    },
  });
}

async function getAvailableConfigurations(token: string) {
  return begetRequest<GetAvailableConfigurationResponse>(
    "/v1/vps/configuration",
    {
      token,
    },
  );
}

export function isBegetClientError(error: unknown): error is BegetClientError {
  return error instanceof BegetClientError;
}

export async function authenticate(
  payload: AuthLoginPayload,
): Promise<{ token: string }> {
  const response = await begetRequest<AuthResponse>("/v1/auth", {
    method: "POST",
    headers: {
      "x-token": AUTH_X_TOKEN,
    },
    body: {
      login: payload.login.trim().toLowerCase(),
      password: payload.password,
      code: payload.code?.trim() ?? "",
      saveMe: false,
    },
  });

  if (!response.token) {
    throw new BegetClientError(
      authErrorMessages[response.error ?? ""] || "Authentication failed.",
      {
        status: 401,
        code: response.error,
      },
    );
  }

  return {
    token: response.token,
  };
}

export async function logout(token: string): Promise<void> {
  await begetRequest("/v1/auth/logout", {
    method: "POST",
    token,
  });
}

export async function fetchDashboard(
  token: string,
  options: { monitorOnly?: boolean } = {},
) {
  const { monitorOnly = false } = options;
  const [listResponse, configurationResponse] = await Promise.all([
    getServerList(token),
    monitorOnly
      ? Promise.resolve({ configurations: [] })
      : getAvailableConfigurations(token).catch(() => ({ configurations: [] })),
  ]);
  const servers = listResponse.vps ?? [];
  const configurations = configurationResponse.configurations ?? [];

  if (monitorOnly) {
    return buildDashboardPayload(servers, new Map(), new Map(), configurations);
  }

  const uniqueKeys = new Map<
    string,
    { region: string; configurationGroup: string }
  >();

  for (const server of servers) {
    const configurationGroup = server.configuration?.group;
    const key = groupKey(server.region, configurationGroup);

    if (!key || uniqueKeys.has(key)) {
      continue;
    }

    uniqueKeys.set(key, {
      region: server.region ?? "",
      configurationGroup: configurationGroup ?? "",
    });
  }

  const configuratorEntries = await Promise.allSettled(
    Array.from(uniqueKeys.entries()).map(async ([key, params]) => {
      try {
        const configurator = await getConfiguratorInfo(
          token,
          params.region,
          params.configurationGroup,
        );

        return { key, configurator } as const;
      } catch (error) {
        throw { key, error };
      }
    }),
  );

  const configurators = new Map<string, ConfiguratorInfoResponse>();
  const configuratorFailures = new Map<string, string>();

  for (const result of configuratorEntries) {
    if (result.status === "fulfilled") {
      configurators.set(result.value.key, result.value.configurator);
      continue;
    }

    const rejected = result.reason as
      | { key?: string; error?: unknown }
      | undefined;
    const reason =
      rejected?.error instanceof Error
        ? rejected.error.message
        : "Unknown configurator request failure.";

    if (rejected?.key) {
      configuratorFailures.set(rejected.key, reason);
    }
  }

  return buildDashboardPayload(
    servers,
    configurators,
    configuratorFailures,
    configurations,
  );
}

export async function fetchVpsStats(
  token: string,
  id: string,
  period: StatsPeriod,
  cpuCount: number,
): Promise<VpsStatsPayload> {
  const [cpuResponse, memoryResponse] = await Promise.all([
    begetRequest<StatisticGetCpuResponse>(`/v1/vps/statistic/cpu/${id}`, {
      token,
      searchParams: {
        period,
      },
    }),
    begetRequest<StatisticGetMemoryResponse>(`/v1/vps/statistic/memory/${id}`, {
      token,
      searchParams: {
        period,
      },
    }),
  ]);

  const cpuPoints = normalizeCpu(
    toMetricPoints(cpuResponse.cpu?.date, cpuResponse.cpu?.value),
    cpuCount,
  );
  const memoryPoints = toGigabytes(
    toMetricPoints(memoryResponse.memory?.date, memoryResponse.memory?.value),
  );

  return {
    period,
    cpu: summarize(cpuPoints),
    memory: summarize(memoryPoints),
  };
}

export async function fetchConfigurationCalculation(
  token: string,
  params: {
    cpuCount: number;
    memory: number;
    diskSize: number;
    region: string;
    configurationGroup: string;
    vpsId: string;
  },
): Promise<CalculationPayload> {
  const response = await begetRequest<ConfiguratorCalculationResponse>(
    "/v1/vps/configurator/calculation",
    {
      token,
      searchParams: {
        "params.cpu_count": params.cpuCount,
        "params.memory": params.memory,
        "params.disk_size": params.diskSize,
        region: params.region,
        configuration_group: params.configurationGroup,
        vps_id: params.vpsId,
      },
    },
  );

  if (!response.success) {
    throw new BegetClientError(
      response.error?.message ||
        "Calculation is unavailable for this configuration.",
      {
        status: 409,
        code: response.error?.code,
      },
    );
  }

  return {
    cpuCount: response.success.params?.cpu_count ?? params.cpuCount,
    memory: response.success.params?.memory ?? params.memory,
    diskSize: response.success.params?.disk_size ?? params.diskSize,
    priceDay: response.success.price_day ?? 0,
    priceMonth: response.success.price_month ?? 0,
  };
}

export async function updateServerConfiguration(
  token: string,
  params: {
    id: string;
    configurationId?: string;
    cpuCount: number;
    memory: number;
    diskSize: number;
  },
): Promise<void> {
  const response = await begetRequest<ChangeConfigurationResponse>(
    `/v1/vps/server/${params.id}/configuration`,
    {
      method: "PUT",
      token,
      body: params.configurationId
        ? {
            configuration_id: params.configurationId,
          }
        : {
            configuration_params: {
              cpu_count: params.cpuCount,
              memory: params.memory,
              disk_size: params.diskSize,
            },
          },
    },
  );

  if (response.error) {
    throw new BegetClientError(
      response.error.message || "Configuration update failed.",
      {
        status: 409,
        code: response.error.code,
      },
    );
  }
}
