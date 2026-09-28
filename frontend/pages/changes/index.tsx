import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BulkBar, ChangeCatalogTable, PageFilters, type RowKey } from '@infragate/ui';
import { SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface ChangeRow {
  id: number;
  change_number: string;
  project_name?: string;
  project_code?: string;
  service: string;
  environment: string;
  repo: string;
  pr_number: number;
  sha: string;
  title: string;
  summary?: string;
  status: string;
  cab_status?: string;
  change_type: string;
  linked_incidents: number;
  assignee_username?: string;
  priority?: string;
}

function parseProjectID(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export default function UserChangesCatalogPage() {
  const router = useRouter();
  const [items, setItems] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkActing, setBulkActing] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<RowKey>>(new Set());
  const [canAuthorize, setCanAuthorize] = useState(false);
  const projectID = parseProjectID(router.query.project_id);
  const environment = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment || '';

  const load = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams();
    if (projectID) params.set('project_id', String(projectID));
    if (environment) params.set('environment', environment);
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('change_type', typeFilter);
    if (query.trim()) params.set('q', query.trim());
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/me/changes?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return;
        }
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load changes');
        }
        setItems(Array.isArray(data?.changes) ? data.changes : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load changes'))
      .finally(() => setLoading(false));
  }, [router, projectID, environment, statusFilter, typeFilter, query]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        const user = data.user && typeof data.user === 'object' ? data.user : data;
        setCanAuthorize(Boolean(user.is_portal_manager) || user.role === 'admin');
      })
      .catch(() => setCanAuthorize(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.change_number} ${item.repo} ${item.title} ${item.summary || ''} ${item.service} ${item.sha}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  const runBulk = async (action: string) => {
    const token = localStorage.getItem('token');
    const ids = Array.from(selectedKeys).map((key) => Number(key)).filter((id) => id > 0);
    if (!token || ids.length === 0) return;
    setBulkActing(action);
    setError('');
    const path = action === 'approve' ? 'cab-approve' : action;
    const errors: string[] = [];
    try {
      for (const id of ids) {
        const res = await fetch(`${apiUrl}/api/me/changes/${id}/${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push(`${id}: ${data?.error || 'failed'}`);
        }
      }
      if (errors.length) setError(errors.slice(0, 3).join('; '));
      setSelectedKeys(new Set());
      load();
    } catch {
      setError(`Bulk ${action} failed`);
    } finally {
      setBulkActing('');
    }
  };

  return (
    <>
      <Head>
        <title>Changes - {SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Change requests</h1>
            <p className="portal-page__subtitle">
              Deploys on your projects. Team managers can Approve, Schedule, Implement, Cancel, or Close selected changes.
            </p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <PageFilters
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search repo, title, SHA, summary"
          status={statusFilter}
          onStatusChange={setStatusFilter}
          statusOptions={[
            { value: '', label: 'All status' },
            { value: 'new', label: 'New' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'failed', label: 'Failed' },
            { value: 'monitoring', label: 'Monitoring' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'closed', label: 'Closed' },
          ]}
          chips={[
            projectID ? { key: 'project', label: 'Project', value: String(projectID) } : null,
            environment ? { key: 'environment', label: 'Environment', value: environment } : null,
            statusFilter ? { key: 'status', label: 'Status', value: statusFilter } : null,
            typeFilter ? { key: 'type', label: 'Type', value: typeFilter } : null,
          ].filter((chip): chip is { key: string; label: string; value: string } => Boolean(chip))}
          onClear={() => {
            setQuery('');
            setStatusFilter('');
            setTypeFilter('');
          }}
        />
        <section className="portal-stat-grid notification-summary-grid">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Changes</span>
            <span className="portal-stat-card__value">{items.length}</span>
            <p className="portal-stat-card__copy">Deploys on your visible projects.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Awaiting approve</span>
            <span className="portal-stat-card__value">{items.filter((item) => item.status === 'new' && item.cab_status !== 'approved').length}</span>
            <p className="portal-stat-card__copy">New changes waiting for approval.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Watching</span>
            <span className="portal-stat-card__value">{items.filter((item) => item.status === 'monitoring' || item.status === 'implemented').length}</span>
            <p className="portal-stat-card__copy">Recently shipped changes still being watched.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Failed</span>
            <span className="portal-stat-card__value">{items.filter((item) => item.status === 'failed').length}</span>
            <p className="portal-stat-card__copy">Failed changes on your projects.</p>
          </article>
        </section>
        {canAuthorize ? (
          <BulkBar count={selectedKeys.size} noun="change" onClear={() => setSelectedKeys(new Set())}>
            <button type="button" className="btn btn-primary" disabled={!!bulkActing} onClick={() => void runBulk('approve')}>
              {bulkActing === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('schedule')}>
              {bulkActing === 'schedule' ? 'Scheduling…' : 'Schedule'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('implement')}>
              {bulkActing === 'implement' ? 'Starting…' : 'Implement'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('cancel')}>
              {bulkActing === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!bulkActing} onClick={() => void runBulk('close')}>
              {bulkActing === 'close' ? 'Closing…' : 'Close'}
            </button>
          </BulkBar>
        ) : null}
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Your project changes</h2>
            </div>
            <div className="ig-filter-bar devops-incident-filter-row">
              <input className="input" placeholder="Search repo, title, SHA, summary" value={query} onChange={(event) => setQuery(event.target.value)} />
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All status</option>
                <option value="new">New</option>
                <option value="scheduled">Scheduled</option>
                <option value="implementing">Implementing</option>
                <option value="implemented">Implemented</option>
                <option value="monitoring">Monitoring</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="">All types</option>
                <option value="standard">Standard</option>
                <option value="normal">Normal</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>
          <ChangeCatalogTable
            rows={visible}
            loading={loading}
            selectable={canAuthorize}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            empty={<div className="empty-state">No change requests for your projects yet.</div>}
            onOpen={(item) => void router.push(`/changes/${item.id}`)}
          />
        </section>
      </div>
    </>
  );
}
