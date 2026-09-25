export const ITSM_PRIORITIES = [
  { value: 'p1', label: 'P1 — Critical' },
  { value: 'p2', label: 'P2 — High' },
  { value: 'p3', label: 'P3 — Moderate' },
  { value: 'p4', label: 'P4 — Low' },
] as const;

export const INCIDENT_STATES = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;

export const PROBLEM_STATES = [
  { value: 'new', label: 'New' },
  { value: 'assess', label: 'Assess' },
  { value: 'root_cause_analysis', label: 'Root Cause Analysis' },
  { value: 'fix_in_progress', label: 'Fix in Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;

export const IMPACT_URGENCY = [
  { value: 'high', label: '1 — High' },
  { value: 'medium', label: '2 — Medium' },
  { value: 'low', label: '3 — Low' },
] as const;

export type ITSMCategory = {
  value: string;
  label: string;
  subcategories: string[];
};

export type IncidentSLA = {
  priority?: string;
  respond_minutes?: number;
  resolve_minutes?: number;
  respond_by?: string;
  resolve_by?: string;
  responded_at?: string;
  resolved_at?: string;
  response_breached?: boolean;
  resolve_breached?: boolean;
  response_remaining?: string;
  resolve_remaining?: string;
};

export type ITSMJournalEntry = {
  id: number;
  kind: string;
  body: string;
  author_username?: string;
  created_at: string;
};

export const FALLBACK_ITSM_CATEGORIES: ITSMCategory[] = [
  { value: 'software', label: 'Software', subcategories: ['application', 'database', 'middleware', 'integration', 'os'] },
  { value: 'hardware', label: 'Hardware', subcategories: ['server', 'storage', 'network-device', 'peripheral'] },
  { value: 'network', label: 'Network', subcategories: ['connectivity', 'dns', 'vpn', 'load-balancer', 'firewall'] },
  { value: 'database', label: 'Database', subcategories: ['performance', 'availability', 'backup', 'replication'] },
  { value: 'inquiry', label: 'Inquiry / help', subcategories: ['access', 'how-to', 'other'] },
];

export function subcategoriesFor(categories: ITSMCategory[], category: string): string[] {
  return categories.find((item) => item.value === category)?.subcategories || [];
}

export function normalizeCategories(value: unknown): ITSMCategory[] {
  if (!Array.isArray(value)) return FALLBACK_ITSM_CATEGORIES;
  const items = value
    .map((raw) => {
      const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const subcategories = Array.isArray(item.subcategories)
        ? item.subcategories.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return {
        value: typeof item.value === 'string' ? item.value : '',
        label: typeof item.label === 'string' ? item.label : String(item.value || ''),
        subcategories,
      };
    })
    .filter((item) => item.value);
  return items.length ? items : FALLBACK_ITSM_CATEGORIES;
}

export function normalizeSLA(value: unknown): IncidentSLA | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return {
    priority: typeof item.priority === 'string' ? item.priority : '',
    respond_minutes: typeof item.respond_minutes === 'number' ? item.respond_minutes : 0,
    resolve_minutes: typeof item.resolve_minutes === 'number' ? item.resolve_minutes : 0,
    respond_by: typeof item.respond_by === 'string' ? item.respond_by : '',
    resolve_by: typeof item.resolve_by === 'string' ? item.resolve_by : '',
    responded_at: typeof item.responded_at === 'string' ? item.responded_at : '',
    resolved_at: typeof item.resolved_at === 'string' ? item.resolved_at : '',
    response_breached: item.response_breached === true,
    resolve_breached: item.resolve_breached === true,
    response_remaining: typeof item.response_remaining === 'string' ? item.response_remaining : '',
    resolve_remaining: typeof item.resolve_remaining === 'string' ? item.resolve_remaining : '',
  };
}

export function normalizeJournal(value: unknown): ITSMJournalEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      kind: typeof item.kind === 'string' ? item.kind : 'work_note',
      body: typeof item.body === 'string' ? item.body : '',
      author_username: typeof item.author_username === 'string' ? item.author_username : '',
      created_at: typeof item.created_at === 'string' ? item.created_at : '',
    };
  });
}

export function slaClockLabel(sla: IncidentSLA | null | undefined, kind: 'response' | 'resolve'): string {
  if (!sla) return '—';
  if (kind === 'response') {
    if (sla.responded_at) return 'Met';
    return sla.response_remaining || (sla.response_breached ? 'Breached' : '—');
  }
  if (sla.resolved_at) return 'Met';
  return sla.resolve_remaining || (sla.resolve_breached ? 'Breached' : '—');
}

export function severityToPriority(value: string): string {
  switch (String(value || '').toLowerCase()) {
    case 'p1':
    case 'critical':
    case 'sev1':
      return 'p1';
    case 'p2':
    case 'high':
    case 'sev2':
      return 'p2';
    case 'p4':
    case 'low':
    case 'sev4':
      return 'p4';
    default:
      return 'p3';
  }
}

export function priorityLabel(value: string): string {
  const key = severityToPriority(value);
  return ITSM_PRIORITIES.find((item) => item.value === key)?.label || 'P3 — Moderate';
}

export function incidentStateValue(value: string): string {
  switch (String(value || '').toLowerCase()) {
    case 'draft':
      return 'new';
    case 'open':
    case 'new':
      return 'new';
    case 'acknowledged':
    case 'investigating':
    case 'mitigating':
    case 'in_progress':
      return 'in_progress';
    case 'on_hold':
    case 'hold':
      return 'on_hold';
    case 'resolved':
      return 'resolved';
    case 'closed':
    case 'cancelled':
    case 'canceled':
      return 'closed';
    default:
      return value || 'new';
  }
}

export function incidentStateLabel(value: string): string {
  const key = incidentStateValue(value);
  return INCIDENT_STATES.find((item) => item.value === key)?.label || value || 'New';
}

export function problemStateLabel(value: string): string {
  const key = String(value || '').toLowerCase();
  return PROBLEM_STATES.find((item) => item.value === key)?.label
    || (key === 'open' ? 'New' : value || 'New');
}

export function priorityFromImpactUrgency(impact: string, urgency: string): string {
  const rank = (value: string) => {
    switch (String(value || '').toLowerCase()) {
      case '1':
      case 'high':
        return 1;
      case '3':
      case 'low':
        return 3;
      default:
        return 2;
    }
  };
  switch (rank(impact) + rank(urgency)) {
    case 2:
      return 'p1';
    case 3:
      return 'p2';
    case 4:
      return 'p3';
    default:
      return 'p4';
  }
}
