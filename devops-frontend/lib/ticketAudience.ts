import { sessionAuthHeaders } from './portalAccess';

export type TicketAudience = {
  scope: 'all' | 'team' | 'own';
  usernames: string[];
};

function storedUser(): { role?: string; user_type?: string; username?: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('devops_user');
    return raw ? JSON.parse(raw) as { role?: string; user_type?: string; username?: string } : null;
  } catch {
    return null;
  }
}

export function fallbackTicketAudience(): TicketAudience {
  const user = storedUser();
  if (user?.role === 'admin' || user?.user_type === 'devops_user') return { scope: 'all', usernames: [] };
  return { scope: 'own', usernames: user?.username ? [user.username] : [] };
}

export async function loadTicketAudience(apiUrl: string): Promise<TicketAudience> {
  try {
    const response = await fetch(`${apiUrl}/api/me/ticket-audience`, { headers: sessionAuthHeaders() });
    if (!response.ok) return fallbackTicketAudience();
    const body = await response.json().catch(() => ({}));
    const scope = body?.scope === 'all' || body?.scope === 'team' ? body.scope : 'own';
    const usernames = Array.isArray(body?.usernames)
      ? body.usernames.filter((name: unknown): name is string => typeof name === 'string' && name.trim() !== '')
      : [];
    return { scope, usernames };
  } catch {
    return fallbackTicketAudience();
  }
}

export function ticketVisible(names: string[], audience: TicketAudience): boolean {
  if (audience.scope === 'all') return true;
  const allowed = (audience.scope === 'team' ? audience.usernames : audience.usernames).map((name) => name.toLowerCase());
  if (!allowed.length) return false;
  return names.some((name) => {
    const value = name.toLowerCase();
    return allowed.some((person) => person && (value === person || value.includes(person)));
  });
}
