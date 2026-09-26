import type { SegmentedOption } from '@infragate/ui';

export const CLOUD_PROVIDER_IDS = ['aws', 'azure', 'gcp'] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number];

export function normalizeCloudProvider(value: string): CloudProviderId {
  const v = value.trim().toLowerCase();
  if (v === 'azure' || v === 'gcp' || v === 'aws') return v;
  return 'aws';
}

export function providerLabel(provider: string): string {
  switch (normalizeCloudProvider(provider)) {
    case 'aws':
      return 'AWS';
    case 'azure':
      return 'Azure';
    case 'gcp':
      return 'GCP';
    default:
      return provider.toUpperCase();
  }
}

export const CLOUD_PROVIDER_SEGMENT: SegmentedOption[] = [
  { value: 'aws', label: 'AWS', hint: 'Amazon Web Services' },
  { value: 'azure', label: 'Azure', hint: 'Microsoft Azure' },
  { value: 'gcp', label: 'GCP', hint: 'Google Cloud Platform' },
];

export function providerChipTone(provider: string): string {
  switch (normalizeCloudProvider(provider)) {
    case 'azure':
      return 'info';
    case 'gcp':
      return 'ok';
    default:
      return 'medium';
  }
}
