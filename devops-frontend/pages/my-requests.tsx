import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import AccessFilters from '../components/AccessFilters';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { sessionAuthHeaders } from '../lib/portalAccess';
import { CopyButton } from '@infragate/ui';

type HistoryRequest = {
  id: number;
  project_name?: string;
  team?: string;
  env?: string;
  cloud?: string;
  service?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  created_at?: string;
};

function requestReference(id: number): string {
  return `REQ${String(id).padStart(7, '0')}`;
}

function statusLabel(status?: string) {
  switch (status) {
    case 'draft': return 'Draft';
    case 'pending_user_manager_approval': return 'Waiting for manager';
    case 'pending_devops_approval': return 'Waiting for DevOps';
    case 'pending_approval': return 'Waiting for approval';
    case 'in_progress': return 'In progress';
    case 'completed': return 'Completed';
    case 'rejected': return 'Rejected';
    default: return status ? status.replaceAll('_', ' ') : 'Unknown';
  }
}

export default function MyRequestsPage() {
  const apiUrl = useApiUrl();
  const [items, setItems] = useState<HistoryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setFailed(false);
    fetch(`${apiUrl}/api/history?limit=100`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json();
      })
      .then((body) => {
        if (cancel) return;
        setItems(Array.isArray(body?.requests) ? body.requests : []);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, reloadTick]);

  const needle = query.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (status !== 'all' && item.status !== status) return false;
    if (priority !== 'all' && (item.priority || 'medium') !== priority) return false;
    if (!needle) return true;
    return `${item.service || ''} ${item.project_name || ''} ${item.team || ''} ${item.env || ''} ${item.id}`.toLowerCase().includes(needle);
  });

  return (
    <>
      <Head>
        <title>My requests - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Requests</p>
              <h1>Your requests</h1>
              <p>Open a request to see who approves it next. Priority chooses the DevOps level: low is L1, medium L2, high L3, critical L4.</p>
            </div>
            <Link href="/requests/new" className="btn btn-primary">New request</Link>
          </header>
          <AccessFilters
            query={query}
            onQuery={setQuery}
            placeholder="Search service, project, or number"
            kind={status}
            onKind={setStatus}
            kindLabel="Status"
            kindOptions={[
              { value: 'all', label: 'Any status' },
              { value: 'draft', label: 'Draft' },
              { value: 'pending_user_manager_approval', label: 'Waiting for manager' },
              { value: 'pending_devops_approval', label: 'Waiting for DevOps' },
              { value: 'pending_approval', label: 'Waiting for approval' },
              { value: 'in_progress', label: 'In progress' },
              { value: 'completed', label: 'Completed' },
              { value: 'rejected', label: 'Rejected' },
            ]}
            extra={priority}
            onExtra={setPriority}
            extraLabel="Priority"
            extraOptions={[
              { value: 'all', label: 'Any priority' },
              { value: 'low', label: 'Low · L1' },
              { value: 'medium', label: 'Medium · L2' },
              { value: 'high', label: 'High · L3' },
              { value: 'critical', label: 'Critical · L4' },
            ]}
          />
          {loading ? <p className="work-empty">Loading your requests…</p> : null}
          {!loading && failed ? (
            <div className="alert alert-error" role="alert">
              <span>Failed to load your requests.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReloadTick((current) => current + 1)}>Retry</button>
            </div>
          ) : null}
          {!loading && !failed && items.length === 0 ? (
            <section className="ops-caught">
              <h2>No requests yet.</h2>
              <p>When you raise a request, it shows up here with its environment and status.</p>
            </section>
          ) : null}
          {!loading && items.length > 0 && visible.length === 0 ? <p className="work-empty">No requests match this search.</p> : null}
          {!loading && visible.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Environment</th>
                    <th>Project</th>
                    <th>Priority</th>
                    <th>Needed by</th>
                    <th>Status</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/requests/${item.id}`}>{item.service || 'Request'}</Link>
                        <span className="ig-cell-meta">
                          {' '}
                          {requestReference(item.id)}
                          <CopyButton value={requestReference(item.id)} label="request number" />
                          {item.cloud ? ` · ${item.cloud}` : ''}
                        </span>
                      </td>
                      <td>{item.env || '—'}</td>
                      <td>{item.project_name || item.team || '—'}</td>
                      <td>{item.priority || 'medium'}</td>
                      <td>{item.due_date ? String(item.due_date).slice(0, 10) : '—'}</td>
                      <td>{statusLabel(item.status)}</td>
                      <td>{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
