import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

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
  author?: string;
  status: string;
  change_type: string;
  linked_incidents: number;
  created_at: string;
}

const CHANGE_WEBHOOK_SAMPLE = `- name: Record SetuOps change
  if: github.ref == 'refs/heads/main'
  env:
    SETUOPS_API: \${{ secrets.SETUOPS_API_URL }}
    SETUOPS_SECRET: \${{ secrets.CHANGE_WEBHOOK_SECRET }}
  run: |
    curl -sS -X POST "$SETUOPS_API/api/webhooks/change" \\
      -H "Content-Type: application/json" \\
      -H "X-CI-Secret: $SETUOPS_SECRET" \\
      -d '{"repo":"'"$GITHUB_REPOSITORY"'","sha":"'"$GITHUB_SHA"'","previous_sha":"'"$GITHUB_EVENT_BEFORE"'","environment":"dev","title":"merge to main","pr_number":0,"change_type":"standard"}'`;

function parseProjectID(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export default function ChangesCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/change`;
  const projectID = parseProjectID(router.query.project_id);
  const environment = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment || '';

  const load = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (projectID) params.set('project_id', String(projectID));
      if (environment) params.set('environment', environment);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('change_type', typeFilter);
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`${apiUrl}/api/devops/changes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to load changes');
        return;
      }
      setItems(Array.isArray(data?.changes) ? data.changes : []);
    } catch {
      setError('Failed to load changes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiUrl, projectID, environment, statusFilter, typeFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.change_number} ${item.repo} ${item.title} ${item.service} ${item.sha} ${item.pr_number}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  const implementedCount = items.filter((item) => item.status === 'implemented' || item.status === 'monitoring' || item.status === 'closed').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const watchingCount = items.filter((item) => item.status === 'monitoring' || item.status === 'implemented').length;

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Changes - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Deployments</span>
            <h1 className="portal-page__title">Changes</h1>
            <p className="portal-page__subtitle">
              Application deploys recorded from CI when code merges to main. This list is the catalog — pipelines create the rows.
            </p>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="k8s-summary-strip">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Changes</span>
            <strong className="k8s-summary-card__value">{items.length}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Shipped</span>
            <strong className="k8s-summary-card__value">{implementedCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Watching</span>
            <strong className="k8s-summary-card__value">{watchingCount}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Failed</span>
            <strong className="k8s-summary-card__value">{failedCount}</strong>
          </div>
        </section>

        <section className="portal-surface" style={{ marginBottom: 16 }}>
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Inbound CI</span>
              <h2 className="portal-surface__title">Change webhook</h2>
              <p className="portal-surface__subtitle">
                POST from GitHub Actions after merge to main. Send <code>X-CI-Secret</code> or HMAC. Same SHA + repo + env updates the existing change.
              </p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void copyWebhook()}>
              {copied ? 'Copied' : 'Copy webhook URL'}
            </button>
          </div>
          <p className="portal-surface__subtitle" style={{ marginBottom: 8 }}>
            <code>{webhookUrl}</code>
          </p>
          <pre className="admin-maintenance-card__code-block" style={{ overflow: 'auto', fontSize: 12, padding: 16, borderRadius: 8, background: 'var(--color-surface-muted)' }}>
            {CHANGE_WEBHOOK_SAMPLE}
          </pre>
        </section>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Recorded changes</h2>
            </div>
            <div className="devops-incident-filter-row">
              <input
                className="input"
                placeholder="Search repo, PR, SHA, title"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All status</option>
                <option value="new">New</option>
                <option value="implementing">Implementing</option>
                <option value="implemented">Implemented</option>
                <option value="monitoring">Monitoring</option>
                <option value="closed">Closed</option>
                <option value="failed">Failed</option>
              </select>
              <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="">All types</option>
                <option value="standard">Standard</option>
                <option value="normal">Normal</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading changes...</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              No changes yet. Point a CI job at the webhook when code merges to main.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Change</th>
                    <th>Repo / PR</th>
                    <th>Service</th>
                    <th>Env</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/changes/${item.id}`)}>
                      <td>
                        <strong>{item.change_number || `CHG${String(item.id).padStart(7, '0')}`}</strong>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.title || item.sha}</div>
                      </td>
                      <td>
                        {item.repo}
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                          {item.pr_number ? `PR #${item.pr_number}` : 'No PR'} · {item.sha.slice(0, 7)}
                        </div>
                      </td>
                      <td>{item.service || '—'}</td>
                      <td>{item.environment}</td>
                      <td>{item.change_type}</td>
                      <td>{item.status}</td>
                      <td>{item.linked_incidents || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
