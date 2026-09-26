import { normalizeCloudProvider, type CloudProviderId } from './cloudProviders';

/** Inventory landing for one onboarded cloud account (resources scoped to account_id). */
export function cloudInventoryAccountHref(cloud: string, accountId: string): string {
  const params = new URLSearchParams({
    cloud: normalizeCloudProvider(cloud),
    account_id: accountId.trim(),
  });
  return `/cloud-resources/account?${params.toString()}`;
}

export function parseInventoryAccountQuery(
  cloudRaw: string | string[] | undefined,
  accountRaw: string | string[] | undefined,
): { cloud: CloudProviderId; accountId: string } | null {
  const accountId = (Array.isArray(accountRaw) ? accountRaw[0] : accountRaw)?.trim() || '';
  if (!accountId) return null;
  const cloud = normalizeCloudProvider(Array.isArray(cloudRaw) ? cloudRaw[0] : cloudRaw);
  return { cloud, accountId };
}
