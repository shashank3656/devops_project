export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function getString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
