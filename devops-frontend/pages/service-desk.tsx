import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

type DeskKind = 'change' | 'incident' | 'problem' | 'request';
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
  service: string;
  source: string;
  href: string;
  createdAt: string;
  updatedAt?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || '—').toUpperCase();
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('fail') || s.includes('critical') || s === 'cancelled') return 'danger';
  if (s.includes('approv') || s.includes('pending') || s === 'new') return 'warning';
  if (s.includes('progress') || s.includes('implement') || s.includes('monitor') || s === 'scheduled') return 'info';
  if (s.includes('resolv') || s.includes('closed') || s.includes('complete')) return 'ok';
  if (s.includes('investigat')) return 'purple';
  return 'neutral';
}

function priorityTone(priority: string): string {
  const p = priority.toLowerCase();
  if (p.includes('critical') || p === 'p1' || p === 'high') return 'critical';
  if (p.includes('medium') || p === 'p2' || p === 'p3') return 'medium';
  return 'low';
}

function kindLabel(kind: DeskKind): string {
  switch (kind) {
    case 'change':
      return 'Change';
    case 'incident':
      return 'Incident';
    case 'problem':
      return 'Problem';
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
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

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
    Promise.all([
      fetch(`${apiUrl}/api/devops/changes`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/incidents`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/problems`, { headers }).then((res) => res.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/devops/tickets?limit=50`, { headers }).then((res) => res.json().catch(() => ({}))),
    ])
      .then(([changesData, incidentsData, problemsData, ticketsData]) => {
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
            service: str(row.service) || '—',
            source: str(row.pipeline_url) ? 'Webhook' : 'Manual',
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
            service: str(row.service) || '—',
            source: str(row.source) || 'Webhook',
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
            service: str(row.service) || '—',
            source: 'Manual',
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
            service: str(row.service) || '—',
            source: 'Manual',
            href: `/tickets?id=${id}`,
            createdAt: str(row.created_at),
            updatedAt: str(row.updated_at),
          });
        });

        next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setItems(next);
        if (!selectedKey && next[0]) setSelectedKey(next[0].key);
      })
      .catch(() => setError('Failed to load service desk'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const selected = useMemo(() => items.find((item) => item.key === selectedKey) || null, [items, selectedKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (tab === 'mine' && username && !item.owner.toLowerCase().includes(username.toLowerCase())) return false;
      if (tab === 'approval') {
        const s = item.status.toLowerCase();
        if (!(s.includes('approv') || s === 'new' || s.includes('pending'))) return false;
      }
      if (typeFilter && item.kind !== typeFilter) return false;
      if (priorityFilter && !item.priority.toLowerCase().includes(priorityFilter.toLowerCase())) return false;
      if (!needle) return true;
      return `${item.title} ${item.summary} ${item.owner} ${item.service} ${item.status} ${item.key}`
        .toLowerCase()
        .includes(needle);
    });
  }, [items, tab, query, typeFilter, priorityFilter, username]);

  const stats = useMemo(() => {
    const open = items.filter((item) => !['closed', 'resolved', 'cancelled', 'failed', 'completed', 'rejected'].includes(item.status.toLowerCase())).length;
    const critical = items.filter((item) => {
      const p = item.priority.toLowerCase();
      return p.includes('critical') || p === 'p1' || p === 'high';
    }).length;
    const awaiting = items.filter((item) => {
      const s = item.status.toLowerCase();
      return s.includes('approv') || s === 'new' || s.includes('pending');
    }).length;
    const dueToday = items.filter((item) => {
      if (!item.createdAt) return false;
      const created = new Date(item.createdAt);
      const now = new Date();
      return created.toDateString() === now.toDateString();
    }).length;
    return { open, critical, awaiting, dueToday };
  }, [items]);

  const ticketIdLabel = (item: DeskTicket) => {
    if (item.kind === 'change') return `CHG-${String(item.id).padStart(3, '0')}`;
    if (item.kind === 'incident') return `INC-${String(item.id).padStart(3, '0')}`;
    if (item.kind === 'problem') return `PRB-${String(item.id).padStart(3, '0')}`;
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
            <h1 className="sd-hero__title">Service desk</h1>
            <p className="sd-hero__subtitle">Track incidents, plan changes and solve recurring issues.</p>
          </div>
          <div className="sd-hero__actions">
            <Link href="/webhooks" className="btn btn-secondary sd-btn-ghost">
              Connect webhook
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen((open) => !open)}>
              + Create ticket
            </button>
            {createOpen ? (
              <div className="sd-hero__actions">
                <Link href="/incidents/new" className="btn btn-secondary">Incident</Link>
                <Link href="/changes/new" className="btn btn-secondary">Change</Link>
                <Link href="/problems/new" className="btn btn-secondary">Problem</Link>
                <Link href="/tickets" className="btn btn-secondary">Request</Link>
              </div>
            ) : null}
          </div>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="sd-stats" aria-label="Service desk summary">
          <article className="sd-stat">
            <span className="sd-stat__label">Open tickets</span>
            <strong className="sd-stat__value">{stats.open}</strong>
          </article>
          <article className="sd-stat">
            <span className="sd-stat__label">Critical incidents</span>
            <strong className="sd-stat__value sd-stat__value--danger">{stats.critical}</strong>
            <span className="sd-stat__hint">Needs immediate attention</span>
          </article>
          <article className="sd-stat">
            <span className="sd-stat__label">Awaiting approval</span>
            <strong className="sd-stat__value">{stats.awaiting}</strong>
            <span className="sd-stat__hint">CAB / change queue</span>
          </article>
          <article className="sd-stat">
            <span className="sd-stat__label">Created today</span>
            <strong className="sd-stat__value">{stats.dueToday}</strong>
            <span className="sd-stat__hint">New intake</span>
          </article>
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
              <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="">Type</option>
                <option value="incident">Incident</option>
                <option value="change">Change</option>
                <option value="problem">Problem</option>
                <option value="request">Request</option>
              </select>
              <select className="input" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                <option value="">Priority</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="sd-table-wrap">
              {loading ? <div className="empty-state">Loading service desk…</div> : null}
              {!loading && filtered.length === 0 ? (
                <div className="empty-state sd-empty">
                  <strong>No tickets yet</strong>
                  <p>Connect a webhook or create a change, incident, or problem to populate this desk.</p>
                  <div className="sd-empty__actions">
                    <Link href="/incidents/new" className="btn btn-primary">Incident</Link>
                    <Link href="/changes/new" className="btn btn-secondary">Change</Link>
                    <Link href="/problems/new" className="btn btn-secondary">Problem</Link>
                    <Link href="/tickets" className="btn btn-secondary">Request</Link>
                    <Link href="/webhooks" className="btn btn-secondary sd-btn-ghost">
                      Connect webhook
                    </Link>
                  </div>
                </div>
              ) : null}
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
                            <span className="sd-ticket-summary">{item.summary || 'No summary'}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`sd-type sd-type--${item.kind}`}>{kindLabel(item.kind)}</span>
                        </td>
                        <td>
                          <span className={`sd-badge sd-badge--prio-${priorityTone(item.priority)}`}>{item.priority}</span>
                        </td>
                        <td>
                          <span className={`sd-badge sd-badge--${statusTone(item.status)}`}>{item.status}</span>
                        </td>
                        <td>
                          <span className="sd-owner">
                            <span className="sd-avatar" aria-hidden>
                              {initials(item.owner)}
                            </span>
                            {item.owner}
                          </span>
                        </td>
                        <td>{item.source}</td>
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
              <span className={`sd-badge sd-badge--prio-${priorityTone(selected.priority)}`}>{selected.priority}</span>
              <Link href={selected.href} className="btn btn-primary sd-inspector__cta">
                Open {kindLabel(selected.kind).toLowerCase()}
              </Link>

              <dl className="sd-meta">
                <div>
                  <dt>Type</dt>
                  <dd>{kindLabel(selected.kind)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={`sd-badge sd-badge--${statusTone(selected.status)}`}>{selected.status}</span>
                  </dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>
                    <span className={`sd-badge sd-badge--prio-${priorityTone(selected.priority)}`}>{selected.priority}</span>
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
                <p>{selected.summary || 'No description provided for this ticket yet.'}</p>
              </section>

              <section className="sd-section">
                <h3>Related</h3>
                <Link href={selected.href} className="sd-related">
                  {selected.service !== '—' ? selected.service : ticketIdLabel(selected)}
                </Link>
              </section>
            </aside>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
