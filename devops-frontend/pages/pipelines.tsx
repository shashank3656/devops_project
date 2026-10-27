import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import DeliveryHubNav from '../components/DeliveryHubNav';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface PipelineRow {
  id: number;
  change_number?: string;
  repo?: string;
  service?: string;
  environment?: string;
  status?: string;
  pipeline_url?: string;
  pipeline_label?: string;
  sha?: string;
  title?: string;
  change_type?: string;
  updated_at?: string;
  preview?: boolean;
}

function pipelineTone(label: string): string {
  const key = label.toLowerCase();
  if (key === 'failed') return 'ig-chip ig-chip--high';
  if (key === 'running' || key === 'posted') return 'ig-chip ig-chip--medium';
  if (key === 'succeeded') return 'ig-chip ig-chip--low';
  return 'ig-chip';
}

export default function PipelinesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<PipelineRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/pipelines`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load pipelines');
        setItems(Array.isArray(data.pipelines) ? data.pipelines : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load pipelines'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const counts = useMemo(() => ({
    all: items.length,
    running: items.filter((item) => item.pipeline_label === 'Running' || item.pipeline_label === 'Posted').length,
    failed: items.filter((item) => item.pipeline_label === 'Failed').length,
    unknown: items.filter((item) => !item.pipeline_label || item.pipeline_label === 'Unknown').length,
  }), [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const label = item.pipeline_label || 'Unknown';
      if (stateFilter === 'running' && label !== 'Running' && label !== 'Posted') return false;
      if (stateFilter === 'failed' && label !== 'Failed') return false;
      if (stateFilter === 'unknown' && label !== 'Unknown') return false;
      if (!needle) return true;
      return [item.repo, item.service, item.change_number, item.title, item.environment].join(' ').toLowerCase().includes(needle);
    });
  }, [items, query, stateFilter]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Pipelines - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Delivery</span>
            <h1 className="portal-page__title">Pipelines</h1>
            <p className="portal-page__subtitle">
              CI runs posted onto a change. A missing pipeline URL stays Unknown. A preview environment is a PR sandbox, not a pipeline. GitHub merge risk stays on Repositories after a repo is onboarded.
            </p>
          </div>
          <Link href="/operations/webhooks" className="btn btn-secondary">Open webhooks</Link>
        </div>
        <DeliveryHubNav active="pipelines" />
        {error ? <div className="alert alert-error">{error}</div> : null}
        <div className="k8s-summary-strip">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Posted</span>
            <strong className="k8s-summary-card__value">{loading ? '—' : counts.all}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Running</span>
            <strong className="k8s-summary-card__value">{loading ? '—' : counts.running}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Failed</span>
            <strong className="k8s-summary-card__value">{loading ? '—' : counts.failed}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Unknown</span>
            <strong className="k8s-summary-card__value">{loading ? '—' : counts.unknown}</strong>
          </div>
        </div>
        <section className="portal-surface">
          <form className="iam-filters" onSubmit={(event) => event.preventDefault()}>
            <label>
              Search
              <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Repo, service, or change" />
            </label>
            <label>
              State
              <select className="input" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
                <option value="all">All ({counts.all})</option>
                <option value="running">Running ({counts.running})</option>
                <option value="failed">Failed ({counts.failed})</option>
                <option value="unknown">Unknown ({counts.unknown})</option>
              </select>
            </label>
          </form>
          {loading ? <div className="empty-state">Loading pipelines…</div> : null}
          {!loading && !items.length ? (
            <div className="empty-state">
              <p>No pipeline runs yet. Post the change webhook with pipeline_url, or the CI webhook against a request. A GitHub repo onboard is not required here.</p>
              <div className="portal-page__actions">
                <Link href="/operations/webhooks" className="btn btn-primary btn-sm">Connect a webhook</Link>
                <Link href="/changes/new" className="btn btn-secondary btn-sm">Create from PR</Link>
                <Link href="/deploy-intelligence/onboard" className="btn btn-secondary btn-sm">Onboard a repository</Link>
              </div>
            </div>
          ) : null}
          {!loading && items.length > 0 && visible.length === 0 ? (
            <div className="empty-state">No pipelines match this filter.</div>
          ) : null}
          {visible.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Repo</th>
                  <th>Pipeline</th>
                  <th>Environment</th>
                  <th>SHA</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong><Link href={`/changes/${item.id}`}>{item.change_number || `CHG${item.id}`}</Link></strong>
                      <div className="ig-cell-meta">{item.title || item.service || 'Unknown'}</div>
                    </td>
                    <td>{item.repo || 'Unknown'}{item.preview ? ' · Preview CHG' : ''}</td>
                    <td>
                      <span className={pipelineTone(item.pipeline_label || 'Unknown')}>{item.pipeline_label || 'Unknown'}</span>
                      {item.pipeline_url ? (
                        <>
                          {' '}
                          <a href={item.pipeline_url} target="_blank" rel="noreferrer">Open run</a>
                        </>
                      ) : null}
                    </td>
                    <td>{item.environment || 'Unknown'}</td>
                    <td><code>{item.sha || 'Unknown'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
