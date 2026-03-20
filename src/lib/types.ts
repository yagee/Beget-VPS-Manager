export interface AuthLoginPayload {
  login: string;
  password: string;
  code?: string;
  saveMe?: boolean;
}

export interface SessionPayload {
  authenticated: boolean;
}

export interface DashboardRange {
  min: number;
  max: number;
  step: number;
  availableMin: number;
  availableMax: number;
}

export interface DashboardPreset {
  id: string;
  name: string;
  cpuCount: number;
  memory: number;
  diskSize: number;
  priceDay: number;
  priceMonth: number;
}

export interface DashboardServer {
  id: string;
  slug: string;
  displayName: string;
  hostname: string;
  description: string;
  status: string;
  region: string;
  ipAddress: string;
  technicalDomain: string;
  configurationName: string;
  configurationGroup: string;
  currentConfigurationId: string;
  currentConfigurationCustom: boolean;
  currentCpuCount: number;
  currentMemory: number;
  currentDiskSize: number;
  diskUsedMb: number | null;
  diskLeftMb: number | null;
  currentPriceDay: number;
  currentPriceMonth: number;
  dailyBandwidth: number;
  manageEnabled: boolean;
  configurable: boolean;
  reconfigurable: boolean;
  configuratorStatus: "loaded" | "unavailable" | "request_failed" | "missing";
  resizeBlockers: string[];
  presets: DashboardPreset[];
  cpu: DashboardRange | null;
  memory: DashboardRange | null;
  flags: {
    archived: boolean;
    migrating: boolean;
    rescueMode: boolean;
    hostUnavailable: boolean;
  };
}

export interface DashboardPayload {
  servers: DashboardServer[];
  summary: {
    total: number;
    configurable: number;
    active: number;
    fetchedAt: string;
  };
}

export interface CalculationPayload {
  cpuCount: number;
  memory: number;
  diskSize: number;
  priceDay: number;
  priceMonth: number;
}

export interface MetricPoint {
  date: string;
  value: number;
}

export interface MetricStats {
  current: number | null;
  average: number | null;
  peak: number | null;
  points: MetricPoint[];
}

export type StatsPeriod = "HOUR" | "DAY" | "WEEK" | "MONTH";

export interface VpsStatsPayload {
  period: StatsPeriod;
  cpu: MetricStats;
  memory: MetricStats;
}
