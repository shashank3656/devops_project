export function isMonitoredEnvironment(value?: string): boolean {
  const text = (value || '').trim().toLowerCase();
  return text === '' || text === 'prod' || text === 'production';
}

export function monitoredEnvironmentName(options: string[] = []): string {
  const names = options.map((item) => item.trim()).filter(Boolean);
  const production = names.find((item) => item.toLowerCase() === 'production');
  if (production) return production;
  const prod = names.find((item) => item.toLowerCase() === 'prod');
  if (prod) return prod;
  return 'production';
}

export const SERVICE_CLASSES = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'mission_critical', label: 'Mission Critical' },
  { value: 'business_essential', label: 'Business Essential' },
  { value: 'business_supporting', label: 'Business Supporting' },
  { value: 'low_impact', label: 'Low Impact' },
] as const;

export type ServiceWorkspaceTab = 'overview' | 'observability' | 'findings' | 'configuration';

export function serviceClassLabel(value?: string): string {
  const found = SERVICE_CLASSES.find((item) => item.value === value);
  return found ? found.label : 'Unclassified';
}

export function workspaceTab(value: string | string[] | undefined): ServiceWorkspaceTab {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === 'observability' || text === 'findings' || text === 'configuration') return text;
  return 'overview';
}

export function formatBps(bps?: number): string {
  if (typeof bps !== 'number' || Number.isNaN(bps)) return 'Unknown';
  return `${(bps / 100).toFixed(2)}%`;
}

export function scoreDisplay(measurement?: { state?: string; availability_bps?: number }): string {
  const state = measurement?.state;
  if (!measurement || state === 'query_failed' || state === 'unknown' || state === 'disabled' || state === 'stale') {
    return 'Unknown';
  }
  if (state === 'no_traffic') return 'No traffic';
  if (typeof measurement.availability_bps !== 'number') return 'Unknown';
  return formatBps(measurement.availability_bps);
}

export function budgetDisplay(measurement?: { state?: string; budget_remaining_bps?: number }): string {
  const state = measurement?.state;
  if (!measurement || state === 'query_failed' || state === 'unknown' || state === 'no_traffic' || state === 'disabled' || state === 'stale') {
    return 'Unknown';
  }
  if (typeof measurement.budget_remaining_bps !== 'number') return 'Unknown';
  return formatBps(measurement.budget_remaining_bps);
}

export function sparklineHeights(values: number[], max = 10000): number[] {
  return values.map((value) => {
    if (!Number.isFinite(value) || max <= 0) return 4;
    return Math.max(4, Math.round((value / max) * 40));
  });
}

export const CONNECTOR_SOURCES = [
  { value: 'fixture', label: 'Pilot fixture' },
  { value: 'grafana', label: 'Grafana' },
  { value: 'prometheus', label: 'Prometheus' },
  { value: 'splunk', label: 'Splunk' },
  { value: 'datadog', label: 'Datadog' },
  { value: 'private', label: 'Private sample push' },
] as const;

export function validSecretRefName(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(value.trim());
}

export function previewFindingRule(value: number | null, warningBelow: number, criticalBelow: number): string {
  if (value == null || Number.isNaN(value)) return 'unknown';
  if (value < criticalBelow) return 'critical';
  if (value < warningBelow) return 'warning';
  return 'healthy';
}

export function qualityLabel(value?: string): string {
  if (value === 'valid') return 'Valid';
  if (value === 'partial') return 'Partial';
  if (value === 'invalid') return 'Invalid';
  return 'Unknown';
}

export const MEASUREMENT_TYPES = [
  { value: 'availability_sli', label: 'Availability SLI' },
  { value: 'latency_sli', label: 'Latency SLI' },
  { value: 'latency_percentiles', label: 'Latency percentiles' },
  { value: 'provider_calculated', label: 'Provider-calculated compliance' },
] as const;
