export function publishedDomainExpiry(registrar?: string | null, registry?: string | null): string {
  const dates = [registrar, registry]
    .map((value) => (value || '').trim())
    .filter(Boolean)
    .filter((value) => !Number.isNaN(new Date(value).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return dates[0] || '';
}

export function formatExpiryOn(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${weekday}, ${day} at ${time}`;
}

export function expiryZoneLabel(at = new Date()): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone || undefined, timeZoneName: 'shortOffset' }).formatToParts(at);
    const offset = (parts.find((part) => part.type === 'timeZoneName')?.value || '').replace(/^GMT/, 'UTC');
    if (zone === 'Asia/Kolkata') return offset ? `IST ${offset.replace(/^UTC/, '')}` : 'IST';
    return [zone.split('/').pop()?.replace(/_/g, ' '), offset].filter(Boolean).join(' ');
  } catch {
    return 'Unknown';
  }
}

export function remainingExpiryCopy(days?: number | null, kind: 'certificate' | 'domain' = 'certificate'): string {
  if (typeof days !== 'number') {
    return kind === 'domain'
      ? 'Remaining days are Unknown until a check stores registration expiry evidence.'
      : 'Remaining days are Unknown until a check stores certificate expiry evidence.';
  }
  const unit = days === 1 ? 'day' : 'days';
  if (kind === 'domain') {
    return `${days} ${unit} until domain registration expiry. This is not the TLS certificate.`;
  }
  return `${days} ${unit} until the leaf certificate expires. Owner emails go out at 30, 14, 7, 3, and 1 days.`;
}
