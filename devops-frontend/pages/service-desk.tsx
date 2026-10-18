import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton, queryString, useConfirm, useWorkspaceScope } from '@infragate/ui';
import { productionDetailLines } from '../lib/productionConfirm';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { incidentCanFinish } from '../lib/itsm';
import { loadTicketAudience, ticketVisible } from '../lib/ticketAudience';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

type DeskKind = 'change' | 'incident' | 'problem' | 'request' | 'access';
type DeskTab = 'all' | 'mine' | 'approval';

interface DeskTicket {
  id: number;
  key: string;
  kind: DeskKind;
  title: string;
  summary: string;
  status: string;
  priority: string;
  owner: string;
  author?: string;
  requester?: string;
  service: string;
  serviceId?: number;
  projectId?: string;
  environment: string;
  source: string;
  href: string;
  createdAt: string;
  updatedAt?: string;
  dueAt?: string;
  nextAction?: string;
  reference?: string;
}

function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M14 3.5V8h4.5M8 12h8M8 16h6" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 4.5 20 19H4L12 4.5z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 2" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16.5 20 20.5" />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || '—').toUpperCase();
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('fail') || s.includes('critical') || s === 'cancelled') return 'danger';
  if (s.includes('approv') || s.includes('pending')) return 'warning';
  if (s === 'new' || s.includes('schedul')) return 'info';
  if (s.includes('progress') || s.includes('implement') || s.includes('monitor') || s.includes('resolv') || s.includes('closed') || s.includes('complete')) return 'ok';
  if (s.includes('investigat')) return 'purple';
  return 'neutral';
}

function priorityTone(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes('critical') || p === 'p1') return 'critical';
  if (p.includes('high') || p === 'p2') return 'high';
  if (p.includes('medium') || p === 'p3') return 'medium';
  return 'low';
}

function sentence(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!text) return 'Unknown';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function kindLabel(kind: DeskKind): string {
  switch (kind) {
    case 'change':
      return 'Change';
    case 'incident':
      return 'Incident';
    case 'problem':
      return 'Problem';
    case 'access':
      return 'Access request';
    default:
      return 'Request';
  }
}

function formatWhen(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function asList(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return 0;
}

function recordReference(prefix: 'CHG' | 'INC' | 'PRB' | 'REQ', id: number, stored: string): string {
  const text = stored.trim();
  if (text && !text.includes('-')) return text;
  return `${prefix}${String(id).padStart(7, '0')}`;
}

function namedEnvironment(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text || text === 'unknown' || text === 'unspecified' || text === '—' || text === '-') return '';
  return text;
}

function environmentMatches(itemEnvironment: string, selected: string): boolean {
  if (!selected.trim()) return true;
  return namedEnvironment(itemEnvironment) === selected.trim().toLowerCase();
}

function storedIsAdmin(): boolean {
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    const user = raw ? JSON.parse(raw) as { role?: string } : null;
    return user?.role === 'admin';
  } catch {
    return false;
  }
}

const DESK_VIEW_KEY = 'opstrellis-desk-view';
const PAGE_SIZE = 25;

type SortKey = 'created' | 'type' | 'priority' | 'status' | 'owner';
type SortDir = 'asc' | 'desc';

function priorityRank(priority: string) {
  const p = priority.toLowerCase();
  if (p.includes('critical') || p === 'p1' || p === 'sev1') return 0;
  if (p.includes('high') || p === 'p2' || p === 'sev2') return 1;
  if (p.includes('medium') || p === 'p3' || p === 'sev3') return 2;
  if (p.includes('low') || p === 'p4' || p === 'sev4') return 3;
  return 4;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default function ServiceDeskPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<DeskTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<DeskTab>('all');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState('');
  const viewHydrated = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const { scope } = useWorkspaceScope();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [finishing, setFinishing] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEVOPS_USER_KEY);
      if (raw) {
        const user = JSON.parse(raw) as { username?: string };
        setUsername(user.username || '');
      }
    } catch {
      setUsername('');
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DESK_VIEW_KEY) || '{}') as Record<string, unknown>;
      if (saved.tab === 'all' || saved.tab === 'mine' || saved.tab === 'approval') setTab(saved.tab);
      if (typeof saved.query === 'string') setQuery(saved.query);
      if (typeof saved.typeFilter === 'string') setTypeFilter(saved.typeFilter);
      if (typeof saved.priorityFilter === 'string') setPriorityFilter(saved.priorityFilter);
      if (typeof saved.ownerFilter === 'string') setOwnerFilter(saved.ownerFilter);
      if (['created', 'type', 'priority', 'status', 'owner'].includes(String(saved.sortKey))) setSortKey(saved.sortKey as SortKey);
      if (saved.sortDir === 'asc' || saved.sortDir === 'desc') setSortDir(saved.sortDir);
      if (typeof saved.page === 'number' && saved.page > 0) setPage(saved.page);
    } catch {
      // A broken saved view falls back to defaults.
    }
    viewHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!viewHydrated.current) return;
    try {
      sessionStorage.setItem(
        DESK_VIEW_KEY,
        JSON.stringify({ tab, query, typeFilter, priorityFilter, ownerFilter, sortKey, sortDir, page }),
      );
    } catch {
      // Storage can be unavailable in private windows.
    }
  }, [tab, query, typeFilter, priorityFilter, ownerFilter, sortKey, sortDir, page]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    const headers = { Authorization: `Bearer ${token}` };
    const admin = storedIsAdmin();
    const loadCatalog = (devopsPath: string, adminPath: string) => {
      const devopsCall = fetch(`${apiUrl}${devopsPath}`, { headers }).then((res) => res.json().catch(() => ({})));
      if (!admin) return devopsCall;
      return fetch(`${apiUrl}${adminPath}`, { headers })
        .then(async (res) => (res.ok ? res.json().catch(() => ({})) : devopsCall))
        .catch(() => devopsCall);
    };
    const readJson = (res: Response) => res.json().catch(() => ({}));
    Promise.all([
      loadCatalog('/api/devops/changes', '/api/admin/changes'),
      loadCatalog('/api/devops/incidents', '/api/admin/incidents'),
      fetch(`${apiUrl}/api/devops/problems`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/history?limit=100`, { headers }).then(async (res) => ({ ok: res.ok, body: await readJson(res) })),
      fetch(`${apiUrl}/api/devops/requests?limit=50`, { headers }).then(async (res) => ({ ok: res.ok, body: await readJson(res) })),
      fetch(`${apiUrl}/api/devops/iam/access-requests?scope=desk`, { headers }).then((res) => (res.ok ? res.json().catch(() => ({})) : { requests: [] })),
    ])
      .then(([changesData, incidentsData, problemsData, historyData, queueData, accessData]) => {
        const next: DeskTicket[] = [];

        asList(changesData.changes).forEach((row) => {
          const id = num(row.id);
          if (!id) return;
          next.push({
            id,
            key: `change-${id}`,
            kind: 'change',
            title: str(row.title, 'Untitled change'),
            summary: str(row.summary) || str(row.service) || str(row.repo),
            status: str(row.status, 'new'),
            priority: str(row.priority, 'medium'),
            owner: str(row.assignee_username) || 'Unassigned',
            author: str(row.author),
            requester: str(row.created_by_username) || str(row.author),
            service: str(row.service) || 'Unknown',
            serviceId: num(row.service_id) || num(row.service_map_id) || undefined,
            projectId: num(row.project_id) ? String(num(row.project_id)) : '',
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: str(row.pipeline_url) ? 'Webhook' : 'Manual',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href: `/changes/${id}`,
            reference: recordReference('CHG', id, str(row.change_number)),
            createdAt: str(row.created_at),
            updatedAt: str(row.updated_at),
          });
        });

        asList(incidentsData.incidents || incidentsData.items).forEach((row) => {
          const id = num(row.id);
          if (!id) return;
          next.push({
            id,
            key: `incident-${id}`,
            kind: 'incident',
            title: str(row.summary, str(row.title, 'Untitled incident')),
            summary: str(row.status_note) || str(row.service) || str(row.message),
            status: str(row.status, 'new'),
            priority: str(row.severity, str(row.priority, 'medium')),
            owner: str(row.owner_username) || str(row.assignee_username) || 'Unassigned',
            requester: str(row.created_by_username) || str(row.caller) || str(row.owner_username),
            service: str(row.service) || 'Unknown',
            serviceId: num(row.service_id) || undefined,
            projectId: num(row.project_id) ? String(num(row.project_id)) : '',
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: str(row.source) || 'Webhook',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href: `/incidents/${id}/edit`,
            reference: recordReference('INC', id, str(row.incident_number)),
            createdAt: str(row.created_at),
            updatedAt: str(row.updated_at),
          });
        });

        asList(problemsData.problems || problemsData.items).forEach((row) => {
          const id = num(row.id);
          if (!id) return;
          next.push({
            id,
            key: `problem-${id}`,
            kind: 'problem',
            title: str(row.summary, str(row.title, 'Untitled problem')),
            summary: str(row.description) || str(row.root_cause) || str(row.workaround),
            status: str(row.status, 'new'),
            priority: str(row.priority, 'medium'),
            owner: str(row.assignee_username) || 'Unassigned',
            author: str(row.created_by_username),
            requester: str(row.created_by_username),
            service: str(row.service) || 'Unknown',
            projectId: num(row.project_id) ? String(num(row.project_id)) : '',
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: 'Manual',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href: `/problems/${id}`,
            reference: recordReference('PRB', id, str(row.problem_number)),
            createdAt: str(row.created_at),
            updatedAt: str(row.updated_at),
          });
        });

        const requestRows = new Map<number, DeskTicket>();
        const pushRequest = (row: Record<string, unknown>, href: string) => {
          const id = num(row.id);
          if (!id || requestRows.has(id)) return;
          requestRows.set(id, {
            id,
            key: `request-${id}`,
            kind: 'request',
            title: str(row.service, `Request #${id}`),
            summary: `${str(row.cloud)} · ${str(row.env) || str(row.environment)}`.replace(/^ · | · $/g, '').trim() || 'Infrastructure request',
            status: str(row.status, 'new'),
            priority: str(row.priority, 'medium'),
            owner: str(row.assignee_username) || 'Unassigned',
            author: str(row.created_by_username),
            requester: str(row.created_by_username),
            service: str(row.service) || 'Unknown',
            projectId: num(row.project_id) ? String(num(row.project_id)) : '',
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: 'Manual',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href,
            reference: recordReference('REQ', id, ''),
            createdAt: str(row.created_at),
            updatedAt: str(row.updated_at),
          });
        };
        if (historyData.ok) asList(historyData.body?.requests).forEach((row) => pushRequest(row, `/requests/${num(row.id)}`));
        if (queueData.ok) asList(queueData.body?.requests || queueData.body?.tickets).forEach((row) => pushRequest(row, `/tickets?id=${num(row.id)}`));
        requestRows.forEach((item) => next.push(item));
        if (!historyData.ok && !queueData.ok) {
          setError('Requests could not be loaded. Incidents, changes, and problems are still listed below.');
        }

        asList(accessData.requests).forEach((row, index) => {
          const rawId = str(row.id);
          if (!rawId) return;
          const id = index + 1;
          const evaluation = row.evaluation && typeof row.evaluation === 'object' ? row.evaluation as Record<string, unknown> : {};
          const role = str(evaluation.roleName);
          const scope = str(evaluation.normalizedScope);
          next.push({
            id,
            key: `access-${rawId}`,
            kind: 'access',
            title: role || 'Access request',
            summary: [scope, str(row.provisionFile)].filter(Boolean).join(' · ') || 'Waiting for DevOps approval',
            status: str(row.status, 'pending'),
            priority: 'high',
            owner: str(row.requesterName) || 'DevOps',
            requester: str(row.requesterName),
            service: role || 'Access',
            environment: '—',
            source: 'IAM',
            reference: str(row.accessNumber),
            href: str(row.provisionUrl) || '/iam/approvals',
            createdAt: str(row.createdAt) || str(row.created_at),
            updatedAt: str(row.updatedAt) || str(row.updated_at),
          });
        });

        return loadTicketAudience(apiUrl).then((audience) => {
          const visible = next.filter((item) => item.href.startsWith('/requests/') || ticketVisible([item.owner, item.requester || ''], audience));
          visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setItems(visible);
          if (!selectedKey && visible[0]) setSelectedKey(visible[0].key);
        });
      })
      .catch(() => setError('The service desk could not load. Check your connection, then try again.'))
      .finally(() => setLoading(false));
  }, [apiUrl, router, reloadTick]);

  const scopeProject = (router.isReady ? queryString(router.query, 'project_id') : '') || scope.projectId;
  const scopeEnvironment = (router.isReady ? queryString(router.query, 'environment') : '') || scope.environment;
  const scopedItems = useMemo(() => items.filter((item) => {
    if (scopeProject && item.projectId !== scopeProject) return false;
    return environmentMatches(item.environment, scopeEnvironment);
  }), [items, scopeEnvironment, scopeProject]);

  const selected = useMemo(() => scopedItems.find((item) => item.key === selectedKey) || null, [scopedItems, selectedKey]);

  const finishIncident = async (ticket: DeskTicket, action: 'close' | 'cancel') => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      void router.replace('/login');
      return;
    }
    setFinishing(ticket.key);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/incidents/${ticket.id}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.status === 401) {
        void router.replace('/login');
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not update the incident');
      }
      const nextStatus = action === 'close' ? 'closed' : 'cancelled';
      setItems((current) => current.map((item) => (item.key === ticket.key ? { ...item, status: nextStatus } : item)));
      setReloadTick((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the incident');
    } finally {
      setFinishing('');
    }
  };

  const owners = useMemo(() => Array.from(new Set(scopedItems.map((item) => item.owner))).sort(), [scopedItems]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = scopedItems.filter((item) => {
      if (tab === 'mine' && username && !item.owner.toLowerCase().includes(username.toLowerCase())) return false;
      if (tab === 'approval') {
        const s = item.status.toLowerCase();
        if (!(s.includes('approv') || s === 'new' || s.includes('pending'))) return false;
      }
      if (typeFilter && item.kind !== typeFilter) return false;
      if (priorityFilter && !item.priority.toLowerCase().includes(priorityFilter.toLowerCase())) return false;
      if (ownerFilter && item.owner !== ownerFilter) return false;
      if (!needle) return true;
      return `${item.title} ${item.summary} ${item.owner} ${item.service} ${item.status} ${item.key}`
        .toLowerCase()
        .includes(needle);
    });
    const direction = sortDir === 'asc' ? 1 : -1;
    next.sort((a, b) => {
      let delta = 0;
      if (sortKey === 'priority') delta = priorityRank(b.priority) - priorityRank(a.priority);
      else if (sortKey === 'status') delta = a.status.localeCompare(b.status);
      else if (sortKey === 'owner') delta = a.owner.localeCompare(b.owner);
      else if (sortKey === 'type') delta = a.kind.localeCompare(b.kind);
      if (delta === 0) delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return delta * direction;
    });
    return next;
  }, [scopedItems, tab, query, typeFilter, priorityFilter, ownerFilter, sortKey, sortDir, username]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const pageKeys = pageRows.map((item) => item.key);
  const checkedOnPage = pageKeys.filter((key) => checkedKeys.includes(key));
  const allOnPageChecked = pageKeys.length > 0 && checkedOnPage.length === pageKeys.length;
  const someOnPageChecked = checkedOnPage.length > 0 && !allOnPageChecked;
  const checkedTickets = pageRows.filter((item) => checkedKeys.includes(item.key));
  const closableIncidents = checkedTickets.filter((item) => item.kind === 'incident' && incidentCanFinish(item.status));
  const filtersActive = Boolean(query.trim() || typeFilter || priorityFilter || ownerFilter || tab !== 'all');

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPageChecked;
  }, [someOnPageChecked]);

  const changeView = (apply: () => void) => {
    apply();
    setPage(1);
    setCheckedKeys([]);
    setBulkNotice('');
  };

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), pageCount));
    setCheckedKeys([]);
    setBulkNotice('');
  };

  const clearFilters = () =>
    changeView(() => {
      setTab('all');
      setQuery('');
      setTypeFilter('');
      setPriorityFilter('');
      setOwnerFilter('');
    });

  const sortBy = (key: SortKey) =>
    changeView(() => {
      if (sortKey === key) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(key === 'created' || key === 'priority' ? 'desc' : 'asc');
      }
    });

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  const toggleChecked = (key: string) => {
    setBulkNotice('');
    setCheckedKeys((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  };

  const toggleAllOnPage = () => {
    setBulkNotice('');
    setCheckedKeys(allOnPageChecked ? [] : pageKeys);
  };

  const exportChecked = () => {
    const header = ['Ticket', 'Type', 'Title', 'Priority', 'Status', 'Owner', 'Service', 'Environment', 'Created'];
    const lines = checkedTickets.map((item) =>
      [ticketIdLabel(item), kindLabel(item.kind), item.title, item.priority, item.status, item.owner, item.service, item.environment, item.createdAt]
        .map((value) => csvCell(String(value || '')))
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'opstrellis-service-desk.csv';
    link.click();
    URL.revokeObjectURL(url);
    setBulkNotice(`Exported ${checkedTickets.length} ticket${checkedTickets.length === 1 ? '' : 's'}.`);
  };

  const closeCheckedIncidents = async () => {
    if (!closableIncidents.length || bulkBusy) return;
    const ok = await confirm({
      title: `Close ${closableIncidents.length} incident${closableIncidents.length === 1 ? '' : 's'}?`,
      message: 'Closed incidents leave the open queue. Other selected tickets are not changed.',
      detailLines: productionDetailLines({
        project: '',
        environment: Array.from(new Set(closableIncidents.map((item) => item.environment || 'Unknown'))).slice(0, 4).join(', '),
        resource: closableIncidents.map((item) => `${ticketIdLabel(item)} (${item.service || 'service unknown'})`).slice(0, 5).join(', '),
        consequence: 'These incidents are marked closed and leave the open queue. This does not roll back a deployment.',
      }),
      confirmLabel: 'Close incidents',
      destructive: true,
    });
    if (!ok) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      void router.replace('/login');
      return;
    }
    setBulkBusy(true);
    setBulkNotice('');
    let closed = 0;
    for (const ticket of closableIncidents) {
      try {
        const response = await fetch(`${apiUrl}/api/devops/incidents/${ticket.id}/close`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (response.ok) closed += 1;
      } catch {
        // Counted as not closed below.
      }
    }
    const failed = closableIncidents.length - closed;
    setBulkNotice(failed ? `Closed ${closed} of ${closableIncidents.length}. ${failed} could not be closed; open them to see why.` : `Closed ${closed} incident${closed === 1 ? '' : 's'}.`);
    setCheckedKeys([]);
    setBulkBusy(false);
    setReloadTick((current) => current + 1);
  };

  const stats = useMemo(() => {
    const open = scopedItems.filter((item) => !['closed', 'resolved', 'cancelled', 'failed', 'completed', 'rejected'].includes(item.status.toLowerCase())).length;
    const critical = scopedItems.filter((item) => {
      const p = item.priority.toLowerCase();
      return item.kind === 'incident' && (p.includes('critical') || p === 'p1');
    }).length;
    const awaiting = scopedItems.filter((item) => {
      const s = item.status.toLowerCase();
      return s.includes('approv') || s === 'new' || s.includes('pending');
    }).length;
    const dueToday = scopedItems.filter((item) => {
      if (!item.dueAt) return false;
      const due = new Date(item.dueAt);
      if (Number.isNaN(due.getTime())) return false;
      return due.toDateString() === new Date().toDateString();
    }).length;
    return { open, critical, awaiting, dueToday };
  }, [scopedItems]);

  const ticketIdLabel = (item: DeskTicket) => {
    if (item.reference) return item.reference;
    if (item.kind === 'change') return recordReference('CHG', item.id, '');
    if (item.kind === 'incident') return recordReference('INC', item.id, '');
    if (item.kind === 'problem') return recordReference('PRB', item.id, '');
    if (item.kind === 'access') return `ACC${String(item.id).padStart(7, '0')}`;
    return recordReference('REQ', item.id, '');
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Service desk - OpsTrellis</title>
      </Head>
      <div className={`sd-page${selected ? ' sd-page--with-inspector' : ''}`}>
        <header className="sd-hero">
          <div>
            <p className="ops-kicker">Service management</p>
            <h1 className="sd-hero__title">Great service starts here.</h1>
            <p className="sd-hero__subtitle">
              {scopeEnvironment || scopeProject
                ? `Showing ${scopeEnvironment || 'every environment'}${scopeProject ? ' in the selected project' : ''}.`
                : 'Resolve incidents, plan changes and keep every request moving.'}
            </p>
          </div>
          <Link href="/changes/new" className="btn btn-primary">Create change</Link>
        </header>

        {error ? (
          <div className="alert alert-error sd-alert" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReloadTick((current) => current + 1)}>
              Try again
            </button>
          </div>
        ) : null}

        <section className="ops-actions-4" aria-label="Start a request">
          <Link href="/incidents/new" className="ops-jump ops-jump--peach">
            <span>Restore a service</span>
            <small>Something broken? Start here. {loading || error ? 'Critical count unknown.' : `${stats.critical} critical.`}</small>
          </Link>
          <Link href="/changes/new" className="ops-jump ops-jump--lilac">
            <span>Plan a change</span>
            <small>Assess risk before you deploy.</small>
          </Link>
          <Link href="/problems/new" className="ops-jump ops-jump--blue">
            <span>Find the root cause</span>
            <small>Investigate recurring issues.</small>
          </Link>
          <Link href="/requests/new" className="ops-jump ops-jump--mint">
            <span>Raise a request</span>
            <small>Ask for a cloud service on a project.</small>
          </Link>
        </section>

        <section className="sd-workspace">
          <div className="sd-main">
            <div className="sd-tabs" role="tablist">
              {[
                { id: 'all' as const, label: `All tickets (${scopedItems.length})` },
                { id: 'mine' as const, label: `Assigned to me (${scopedItems.filter((i) => username && i.owner !== 'Unassigned' && i.owner.toLowerCase().includes(username.toLowerCase())).length})` },
                { id: 'approval' as const, label: `Needs approval (${stats.awaiting})` },
              ].map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  className={`sd-tab${tab === entry.id ? ' is-active' : ''}`}
                  onClick={() => changeView(() => setTab(entry.id))}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <div className="sd-filters">
              <input
                className="input sd-search"
                type="search"
                placeholder="Search tickets…"
                aria-label="Search tickets"
                value={query}
                onChange={(event) => {
                  const value = event.target.value;
                  changeView(() => setQuery(value));
                }}
              />
              <select className="input" value={typeFilter} onChange={(event) => { const value = event.target.value; changeView(() => setTypeFilter(value)); }} aria-label="Type">
                <option value="">All types</option>
                <option value="incident">Incident</option>
                <option value="change">Change</option>
                <option value="problem">Problem</option>
                <option value="request">Request</option>
                <option value="access">Access request</option>
              </select>
              <select className="input" value={priorityFilter} onChange={(event) => { const value = event.target.value; changeView(() => setPriorityFilter(value)); }} aria-label="Priority">
                <option value="">All priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select className="input" value={ownerFilter} onChange={(event) => { const value = event.target.value; changeView(() => setOwnerFilter(value)); }} aria-label="Owner">
                <option value="">All owners</option>
                {owners.map((owner) => (
                  <option key={owner} value={owner}>{owner}</option>
                ))}
              </select>
              <select
                className="input sd-sort"
                value={`${sortKey}:${sortDir}`}
                onChange={(event) => {
                  const [key, dir] = event.target.value.split(':') as [SortKey, SortDir];
                  changeView(() => {
                    setSortKey(key);
                    setSortDir(dir);
                  });
                }}
                aria-label="Sort"
              >
                <option value="created:desc">Newest first</option>
                <option value="created:asc">Oldest first</option>
                <option value="priority:desc">Highest priority</option>
                <option value="status:asc">Status A–Z</option>
                <option value="owner:asc">Owner A–Z</option>
                <option value="type:asc">Type A–Z</option>
              </select>
              {filtersActive ? (
                <button type="button" className="btn btn-secondary btn-sm sd-clear" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>

            {checkedTickets.length > 0 || bulkNotice ? (
              <div className="sd-bulk" role="region" aria-label="Bulk actions">
                {checkedTickets.length > 0 ? (
                  <>
                    <strong>{checkedTickets.length} selected</strong>
                    <span className="sd-bulk__scope">on this page</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={exportChecked} disabled={bulkBusy}>
                      Export CSV
                    </button>
                    {closableIncidents.length > 0 ? (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void closeCheckedIncidents()} disabled={bulkBusy}>
                        {bulkBusy ? 'Closing…' : `Close ${closableIncidents.length} incident${closableIncidents.length === 1 ? '' : 's'}`}
                      </button>
                    ) : null}
                    <button type="button" className="sd-bulk__clear" onClick={() => setCheckedKeys([])} disabled={bulkBusy}>
                      Clear selection
                    </button>
                  </>
                ) : null}
                {bulkNotice ? <span className="sd-bulk__notice" role="status">{bulkNotice}</span> : null}
              </div>
            ) : null}

            <div className="sd-table-wrap">
              {loading ? <div className="empty-state" role="status">Loading service desk…</div> : null}
              {!loading && !error && scopedItems.length === 0 ? (
                <div className="sd-empty">
                  <h3>{items.length === 0 ? 'No tickets yet' : 'No tickets in this scope'}</h3>
                  <p>{items.length === 0 ? 'Incidents, changes, problems and requests you can see will appear here.' : 'The selected project and environment have no matching tickets. Tickets from other environments stay out of this list.'}</p>
                  <Link href="/incidents/new" className="btn btn-primary btn-sm">Report an incident</Link>
                </div>
              ) : null}
              {!loading && scopedItems.length > 0 && filtered.length === 0 ? (
                <div className="sd-empty">
                  <h3>No tickets match these filters</h3>
                  <p>Try a different search, or clear the filters to see every ticket.</p>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>
                </div>
              ) : null}
              {!loading && filtered.length > 0 ? (
                <table className="sd-table">
                  <thead>
                    <tr>
                      <th className="sd-table__check" scope="col">
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          checked={allOnPageChecked}
                          onChange={toggleAllOnPage}
                          aria-label={allOnPageChecked ? 'Clear selection on this page' : 'Select all tickets on this page'}
                        />
                      </th>
                      <th scope="col" aria-sort={ariaSort('created')}>
                        <button type="button" className="sd-sort-btn" onClick={() => sortBy('created')}>Ticket</button>
                      </th>
                      <th scope="col" className="sd-col-type" aria-sort={ariaSort('type')}>
                        <button type="button" className="sd-sort-btn" onClick={() => sortBy('type')}>Type</button>
                      </th>
                      <th scope="col" aria-sort={ariaSort('priority')}>
                        <button type="button" className="sd-sort-btn" onClick={() => sortBy('priority')}>Priority</button>
                      </th>
                      <th scope="col" aria-sort={ariaSort('status')}>
                        <button type="button" className="sd-sort-btn" onClick={() => sortBy('status')}>Status</button>
                      </th>
                      <th scope="col" className="sd-col-owner" aria-sort={ariaSort('owner')}>
                        <button type="button" className="sd-sort-btn" onClick={() => sortBy('owner')}>Owner</button>
                      </th>
                      <th scope="col" className="sd-col-source">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((item) => (
                      <tr
                        key={item.key}
                        className={`${selectedKey === item.key ? 'is-selected' : ''}${checkedKeys.includes(item.key) ? ' is-checked' : ''}`.trim() || undefined}
                        onClick={() => setSelectedKey(item.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && event.target === event.currentTarget) setSelectedKey(item.key);
                        }}
                        tabIndex={0}
                        aria-selected={selectedKey === item.key}
                      >
                        <td className="sd-table__check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checkedKeys.includes(item.key)}
                            onChange={() => toggleChecked(item.key)}
                            aria-label={`Select ${ticketIdLabel(item)}`}
                          />
                        </td>
                        <td>
                          <div className="sd-ticket-cell">
                            <span className="sd-ticket-id">
                              {ticketIdLabel(item)}
                              <CopyButton value={ticketIdLabel(item)} label="ticket number" />
                            </span>
                            <strong>{item.title}</strong>
                            <span className="sd-ticket-summary">{item.summary || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="sd-col-type">
                          <span className={`sd-type sd-type--${item.kind}`} title={kindLabel(item.kind)}>
                            {item.kind === 'problem' ? <IconSearch /> : item.kind === 'change' ? <IconLink /> : <IconAlert />}
                            <span className="sd-clip">{kindLabel(item.kind)}</span>
                          </span>
                        </td>
                        <td>
                          <span className={`sd-badge sd-badge--prio-${priorityTone(item.priority)}`}>{sentence(item.priority)}</span>
                        </td>
                        <td>
                          <span className={`sd-badge sd-badge--${statusTone(item.status)}`}>{sentence(item.status)}</span>
                        </td>
                        <td className="sd-col-owner">
                          <span className="sd-owner" title={item.owner}>
                            <span className="sd-avatar" aria-hidden>
                              {initials(item.owner)}
                            </span>
                            <span className="sd-clip">{item.owner}</span>
                          </span>
                        </td>
                        <td className="sd-col-source">
                          <span className="sd-source" title={sentence(item.source)}>
                            {item.source.toLowerCase().includes('webhook') ? <IconLink /> : <IconDoc />}
                            <span className="sd-clip">{sentence(item.source)}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
            {!loading && filtered.length > PAGE_SIZE ? (
              <nav className="sd-pager" aria-label="Ticket pages">
                <span>
                  {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
                  Previous
                </button>
                <span aria-current="page">Page {currentPage} of {pageCount}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= pageCount}>
                  Next
                </button>
              </nav>
            ) : null}
          </div>

          {selected ? (
            <aside className="sd-inspector" aria-label="Ticket details">
              <div className="sd-inspector__head">
                <div>
                  <span className="sd-ticket-id">
                    {ticketIdLabel(selected)}
                    <CopyButton value={ticketIdLabel(selected)} label="ticket number" />
                  </span>
                  <h2 className="sd-inspector__title">{selected.title}</h2>
                </div>
                <button type="button" className="sd-inspector__close" onClick={() => setSelectedKey(null)} aria-label="Close">
                  ✕
                </button>
              </div>
              <span className={`sd-badge sd-badge--prio-${priorityTone(selected.priority)}`}>{sentence(selected.priority)}</span>
              <div className="sd-inspector__actions">
                <Link href={selected.href} className="btn btn-primary sd-inspector__cta">
                  Open {kindLabel(selected.kind).toLowerCase()}
                </Link>
                {selected.kind === 'incident' && incidentCanFinish(selected.status) ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={finishing === selected.key}
                      onClick={() => void finishIncident(selected, 'close')}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={finishing === selected.key}
                      onClick={() => void finishIncident(selected, 'cancel')}
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
              </div>

              <h3 className="sd-section__title">Key details</h3>
              <dl className="sd-meta">
                <div>
                  <dt>Type</dt>
                  <dd>{kindLabel(selected.kind)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={`sd-badge sd-badge--${statusTone(selected.status)}`}>{sentence(selected.status)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>
                    <span className={`sd-badge sd-badge--prio-${priorityTone(selected.priority)}`}>{sentence(selected.priority)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Assigned to</dt>
                  <dd className="sd-owner" title={selected.owner}>
                    <span className="sd-avatar" aria-hidden>
                      {initials(selected.owner)}
                    </span>
                    <span className="sd-clip">{selected.owner}</span>
                  </dd>
                </div>
                <div>
                  <dt>Author</dt>
                  <dd title={selected.author || 'Unknown'}>{selected.author || 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Affected service</dt>
                  <dd>{selected.service}</dd>
                </div>
                <div>
                  <dt>Created via</dt>
                  <dd>{selected.source}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatWhen(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last update</dt>
                  <dd>{formatWhen(selected.updatedAt || selected.createdAt)}</dd>
                </div>
              </dl>

              <section className="sd-section">
                <h3>Description</h3>
                <p>{selected.summary || 'Unknown'}</p>
              </section>

              <section className="sd-section">
                <h3>Next action</h3>
                <p>{selected.nextAction || 'No next action configured'}</p>
                <p className="access-hint">{selected.dueAt ? `Due ${formatWhen(selected.dueAt)}` : 'No due date'}</p>
              </section>

              <section className="sd-section">
                <h3>Related items</h3>
                {selected.serviceId ? (
                  <Link href={`/services/${selected.serviceId}`} className="sd-related-card">
                    <span>{selected.service}</span>
                    <small>Service · {selected.environment}</small>
                  </Link>
                ) : (
                  <div className="sd-related-card">
                    <span>Service not linked</span>
                    <small>{selected.service && selected.service !== 'Unknown' ? selected.service : 'This ticket has no catalog service.'}</small>
                    <Link className="sd-related" href={`/services?q=${encodeURIComponent(selected.service && selected.service !== 'Unknown' ? selected.service : '')}`}>Link a service</Link>
                  </div>
                )}
              </section>
            </aside>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
