import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
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
  requester?: string;
  service: string;
  environment: string;
  source: string;
  href: string;
  createdAt: string;
  updatedAt?: string;
  dueAt?: string;
  nextAction?: string;
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

function storedIsAdmin(): boolean {
  try {
    const raw = localStorage.getItem(DEVOPS_USER_KEY);
    const user = raw ? JSON.parse(raw) as { role?: string } : null;
    return user?.role === 'admin';
  } catch {
    return false;
  }
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
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
    Promise.all([
      loadCatalog('/api/devops/changes', '/api/admin/changes'),
      loadCatalog('/api/devops/incidents', '/api/admin/incidents'),
      fetch(`${apiUrl}/api/devops/problems`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/tickets?limit=50`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/iam/access-requests?scope=desk`, { headers }).then((res) => (res.ok ? res.json().catch(() => ({})) : { requests: [] })),
    ])
      .then(([changesData, incidentsData, problemsData, ticketsData, accessData]) => {
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
            owner: str(row.assignee_username) || str(row.author) || 'Unassigned',
            requester: str(row.created_by_username) || str(row.author),
            service: str(row.service) || 'Unknown',
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: str(row.pipeline_url) ? 'Webhook' : 'Manual',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href: `/changes/${id}`,
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
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: str(row.source) || 'Webhook',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href: `/incidents/${id}/edit`,
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
            requester: str(row.created_by_username),
            service: str(row.service) || 'Unknown',
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: 'Manual',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href: `/problems/${id}`,
            createdAt: str(row.created_at),
            updatedAt: str(row.updated_at),
          });
        });

        asList(ticketsData.tickets || ticketsData.requests).forEach((row) => {
          const id = num(row.id);
          if (!id) return;
          next.push({
            id,
            key: `request-${id}`,
            kind: 'request',
            title: str(row.service, `Request #${id}`),
            summary: `${str(row.cloud)} · ${str(row.env) || str(row.environment)}`.trim(),
            status: str(row.status, 'new'),
            priority: str(row.priority, 'medium'),
            owner: str(row.assignee_username) || str(row.created_by_username) || 'Unassigned',
            requester: str(row.created_by_username),
            service: str(row.service) || 'Unknown',
            environment: str(row.environment) || str(row.env) || 'Unknown',
            source: 'Manual',
            dueAt: str(row.due_at) || str(row.due_date) || undefined,
            nextAction: str(row.next_action) || str(row.next_step) || undefined,
            href: `/tickets?id=${id}`,
            createdAt: str(row.created_at),
            updatedAt: str(row.updated_at),
          });
        });

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
            summary: scope || 'Waiting for DevOps approval',
            status: str(row.status, 'pending'),
            priority: 'high',
            owner: str(row.requesterName) || 'DevOps',
            requester: str(row.requesterName),
            service: role || 'Access',
            environment: '—',
            source: 'IAM',
            href: '/iam/approvals',
            createdAt: str(row.createdAt) || str(row.created_at),
            updatedAt: str(row.updatedAt) || str(row.updated_at),
          });
        });

        return loadTicketAudience(apiUrl).then((audience) => {
          const visible = next.filter((item) => ticketVisible([item.owner, item.requester || ''], audience));
          visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setItems(visible);
          if (!selectedKey && visible[0]) setSelectedKey(visible[0].key);
        });
      })
      .catch(() => setError('Failed to load service desk'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const selected = useMemo(() => items.find((item) => item.key === selectedKey) || null, [items, selectedKey]);

  const owners = useMemo(() => Array.from(new Set(items.map((item) => item.owner))).sort(), [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = items.filter((item) => {
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
    next.sort((a, b) => {
      const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortOrder === 'newest' ? -delta : delta;
    });
    return next;
  }, [items, tab, query, typeFilter, priorityFilter, ownerFilter, sortOrder, username]);

  const stats = useMemo(() => {
    const open = items.filter((item) => !['closed', 'resolved', 'cancelled', 'failed', 'completed', 'rejected'].includes(item.status.toLowerCase())).length;
    const critical = items.filter((item) => {
      const p = item.priority.toLowerCase();
      return item.kind === 'incident' && (p.includes('critical') || p === 'p1');
    }).length;
    const awaiting = items.filter((item) => {
      const s = item.status.toLowerCase();
      return s.includes('approv') || s === 'new' || s.includes('pending');
    }).length;
    const dueToday = items.filter((item) => {
      if (!item.dueAt) return false;
      const due = new Date(item.dueAt);
      if (Number.isNaN(due.getTime())) return false;
      return due.toDateString() === new Date().toDateString();
    }).length;
    return { open, critical, awaiting, dueToday };
  }, [items]);

  const ticketIdLabel = (item: DeskTicket) => {
    if (item.kind === 'change') return `CHG-${String(item.id).padStart(3, '0')}`;
    if (item.kind === 'incident') return `INC-${String(item.id).padStart(3, '0')}`;
    if (item.kind === 'problem') return `PRB-${String(item.id).padStart(3, '0')}`;
    if (item.kind === 'access') return `ACC-${String(item.id).padStart(3, '0')}`;
    return `REQ-${String(item.id).padStart(3, '0')}`;
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Service desk - DevOps</title>
      </Head>
      <div className={`sd-page${selected ? ' sd-page--with-inspector' : ''}`}>
        <header className="sd-hero">
          <div>
            <p className="ops-kicker">Service management</p>
            <h1 className="sd-hero__title">Great service starts here.</h1>
            <p className="sd-hero__subtitle">Resolve incidents, plan changes and keep every request moving.</p>
          </div>
          <Link href="/changes/new" className="btn btn-primary">Create change</Link>
        </header>

        <section className="ops-spotlight">
          <div>
            <p className="ops-home__eyebrow">Your team&apos;s service hub</p>
            <h2>One queue. Clear ownership. Faster action.</h2>
            <p>Choose a request below, or pick up work from your shared queue.</p>
          </div>
          <div>
            <small>{loading || error ? 'QUEUE' : `${items.length} LIVE TICKETS`}</small>
            <span>{loading || error ? 'Counts stay unknown until the queue loads.' : 'Live records for this workspace. Missing fields stay blank.'}</span>
          </div>
        </section>

        {error ? <div className="alert alert-error">{error}</div> : null}

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
          <Link href="/projects/new" className="ops-jump ops-jump--mint">
            <span>Request infrastructure</span>
            <small>Open project onboarding.</small>
          </Link>
        </section>

        <section className="sd-workspace">
          <div className="sd-main">
            <div className="sd-tabs" role="tablist">
              {[
                { id: 'all' as const, label: `All tickets (${items.length})` },
                { id: 'mine' as const, label: `Assigned to me (${items.filter((i) => username && i.owner.toLowerCase().includes(username.toLowerCase())).length})` },
                { id: 'approval' as const, label: `Needs approval (${stats.awaiting})` },
              ].map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  className={`sd-tab${tab === entry.id ? ' is-active' : ''}`}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <div className="sd-filters">
              <input
                className="input sd-search"
                placeholder="Search tickets..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Type">
                <option value="">Type</option>
                <option value="incident">Incident</option>
                <option value="change">Change</option>
                <option value="problem">Problem</option>
                <option value="request">Request</option>
                <option value="access">Access request</option>
              </select>
              <select className="input" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Priority">
                <option value="">Priority</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select className="input" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="Owner">
                <option value="">Owner</option>
                {owners.map((owner) => (
                  <option key={owner} value={owner}>{owner}</option>
                ))}
              </select>
              <select className="input sd-sort" value={sortOrder} onChange={(event) => setSortOrder(event.target.value === 'oldest' ? 'oldest' : 'newest')} aria-label="Sort">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>

            <div className="sd-table-wrap">
              {loading ? <div className="empty-state">Loading service desk…</div> : null}
              {!loading && filtered.length > 0 ? (
                <table className="sd-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Type</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Owner</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr
                        key={item.key}
                        className={selectedKey === item.key ? 'is-selected' : undefined}
                        onClick={() => setSelectedKey(item.key)}
                      >
                        <td>
                          <div className="sd-ticket-cell">
                            <span className="sd-ticket-id">{ticketIdLabel(item)}</span>
                            <strong>{item.title}</strong>
                            <span className="sd-ticket-summary">{item.summary || 'Unknown'}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`sd-type sd-type--${item.kind}`}>
                            {item.kind === 'problem' ? <IconSearch /> : item.kind === 'change' ? <IconLink /> : <IconAlert />}
                            {kindLabel(item.kind)}
                          </span>
                        </td>
                        <td>
                          <span className={`sd-badge sd-badge--prio-${priorityTone(item.priority)}`}>{sentence(item.priority)}</span>
                        </td>
                        <td>
                          <span className={`sd-badge sd-badge--${statusTone(item.status)}`}>{sentence(item.status)}</span>
                        </td>
                        <td>
                          <span className="sd-owner">
                            <span className="sd-avatar" aria-hidden>
                              {initials(item.owner)}
                            </span>
                            {item.owner}
                          </span>
                        </td>
                        <td>
                          <span className="sd-source">
                            {item.source.toLowerCase().includes('webhook') ? <IconLink /> : <IconDoc />}
                            {sentence(item.source)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>

          {selected ? (
            <aside className="sd-inspector" aria-label="Ticket details">
              <div className="sd-inspector__head">
                <div>
                  <span className="sd-ticket-id">{ticketIdLabel(selected)}</span>
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
                <Link href={selected.href} className="sd-inspector__more" aria-label="More actions">...</Link>
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
                  <dd className="sd-owner">
                    <span className="sd-avatar" aria-hidden>
                      {initials(selected.owner)}
                    </span>
                    {selected.owner}
                  </dd>
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
                <label className="sd-next">
                  <input type="checkbox" disabled checked={false} />
                  <span>
                    {selected.nextAction || 'Unknown'}
                    <small>{selected.owner} · {selected.dueAt ? `Due ${formatWhen(selected.dueAt)}` : 'Due Unknown'}</small>
                  </span>
                </label>
              </section>

              <section className="sd-section">
                <h3>Related items</h3>
                <Link href={selected.href} className="sd-related-card">
                  <span>{selected.service}</span>
                  <small>Service · {selected.environment}</small>
                </Link>
              </section>
            </aside>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
