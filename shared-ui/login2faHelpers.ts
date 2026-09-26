export type Pending2FA = {
  token: string;
  emailHint: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function pending2FAFromLoginResponse(data: unknown): Pending2FA | null {
  const record = asRecord(data);
  if (!record.requires_otp || typeof record.pending_2fa_token !== 'string') {
    return null;
  }
  const hint =
    typeof record.email_hint === 'string' && record.email_hint.trim()
      ? record.email_hint.trim()
      : 'your email';
  return { token: record.pending_2fa_token, emailHint: hint };
}

export async function resendLogin2FACode(apiUrl: string, pendingToken: string): Promise<Pending2FA> {
  const base = apiUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/resend-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_2fa_token: pendingToken }),
  });
  const data = asRecord(await res.json().catch(() => ({})));
  if (!res.ok) {
    throw new Error(getString(data.error, 'Could not resend verification code'));
  }
  const token = typeof data.pending_2fa_token === 'string' ? data.pending_2fa_token : pendingToken;
  const emailHint =
    typeof data.email_hint === 'string' && data.email_hint.trim() ? data.email_hint.trim() : 'your email';
  return { token, emailHint };
}
