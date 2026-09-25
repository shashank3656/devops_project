export function isSignedSessionToken(raw: string): boolean {
  const token = raw.trim();
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}
