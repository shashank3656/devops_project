/**
 * Keys (case-insensitive) whose values should be masked when displaying request/response or config data.
 * Covers headers (e.g. Authorization, Cookie) and common sensitive payload fields.
 */
const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'credential',
  'credentials',
  'private_key',
  'privatekey',
  'auth',
  'bearer',
];

const MASKED_VALUE = '***MASKED***';

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return SENSITIVE_KEYS.some((s) => {
    const n = s.toLowerCase().replace(/[-_\s]/g, '');
    return normalized === n || normalized.includes(n) || n.includes(normalized);
  });
}

/**
 * Recursively masks sensitive keys in an object. Used for displaying config/request data in the UI.
 */
export function maskSensitiveObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveObject(item));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      out[key] = MASKED_VALUE;
    } else {
      out[key] = maskSensitiveObject(value);
    }
  }
  return out;
}

/**
 * Parses a JSON string, masks sensitive keys, and returns a formatted string for display.
 * If parsing fails, returns the original string with a note (does not mask raw string).
 */
export function maskSensitiveJson(jsonString: string): string {
  if (!jsonString || typeof jsonString !== 'string') return jsonString;
  try {
    const parsed = JSON.parse(jsonString);
    const masked = maskSensitiveObject(parsed);
    return JSON.stringify(masked, null, 2);
  } catch {
    return jsonString;
  }
}

/** Returns true if the string looks like it contains sensitive data (e.g. tokens, auth in URLs). */
export function shouldMaskDisplayValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return (
    lower.includes('bearer ') ||
    lower.includes('token=') ||
    lower.includes('auth=') ||
    lower.includes('key=') ||
    lower.includes('secret=') ||
    /\b(password|apikey|api_key|access_token)=/i.test(value)
  );
}

/** For display only: returns masked placeholder if value looks sensitive, otherwise the value. */
export function maskDisplayValue(value: string): string {
  return shouldMaskDisplayValue(value) ? MASKED_VALUE : value;
}
