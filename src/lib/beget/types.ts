export interface BegetApiError {
  code?: string;
  message?: string;
}

export interface AuthResponse {
  token?: string;
  error?: string;
}

export interface ConfiguratorRange {
  min?: number;
  max?: number;
}

export interface ConfiguratorRangeSettings {
  range?: ConfiguratorRange;
  available_range?: ConfiguratorRange;
  step?: number;
}

export interface ConfiguratorSettings {
  cpu_settings?: ConfiguratorRangeSettings;
  memory_settings?: ConfiguratorRangeSettings;
}

export interface ConfiguratorInfoResponse {
  settings?: ConfiguratorSettings;
  is_available?: boolean;
}

export interface ConfigurationParams {
  cpu_count?: number;
  disk_size?: number;
  memory?: number;
}

export interface ConfiguratorCalculationResponse {
  success?: {
    settings?: ConfiguratorSettings;
    params?: ConfigurationParams;
    price_day?: number;
    price_month?: number;
  };
  error?: BegetApiError;
}

export interface VpsConfiguration {
  id?: string;
  name?: string;
  cpu_count?: number;
  disk_size?: number;
  memory?: number;
  bandwidth_public?: number;
  price_day?: number;
  price_month?: number;
  available?: boolean;
  custom?: boolean;
  configurable?: boolean;
  region?: string;
  group?: string;
}

export interface VpsInfo {
  id?: string;
  slug?: string;
  display_name?: string;
  hostname?: string;
  configuration?: VpsConfiguration;
  status?: string;
  manage_enabled?: boolean;
  description?: string;
  ip_address?: string;
  rescue_mode?: boolean;
  migrating?: boolean;
  host_unavailable?: boolean;
  archived?: boolean;
  disk_used?: string;
  disk_left?: string;
  technical_domain?: string;
  region?: string;
}

export interface GetListResponse {
  vps?: VpsInfo[];
  total_count?: number;
}

export interface GetAvailableConfigurationResponse {
  configurations?: VpsConfiguration[];
}

export interface ChangeConfigurationResponse {
  vps?: VpsInfo;
  error?: BegetApiError;
}

export interface StatisticSeriesData {
  date?: string[];
  value?: number[];
}

export interface StatisticGetCpuResponse {
  cpu?: StatisticSeriesData;
}

export interface StatisticGetMemoryResponse {
  memory?: StatisticSeriesData;
}
