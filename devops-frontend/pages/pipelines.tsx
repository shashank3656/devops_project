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

type PipelineState = 'all' | 'running' | 'failed' | 'succeeded' | 'unknown';

function pipelineState(label?: string): Exclude<PipelineState, 'all'> {
  const key = (label || 'Unknown').toLowerCase();
  if (key === 'failed') return 'failed';
  if (key === 'succeeded') return 'succeeded';
  if (key === 'running' || key === 'posted') return 'running';
  return 'unknown';
}

function formatWhen(value?: string) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function PipelinesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<PipelineRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<PipelineState>('all');

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
    running: items.filter((item) => pipelineState(item.pipeline_label) === 'running').length,
    failed: items.filter((item) => pipelineState(item.pipeline_label) === 'failed').length,
    succeeded: items.filter((item) => pipelineState(item.pipeline_label) === 'succeeded').length,
    unknown: items.filter((item) => pipelineState(item.pipeline_label) === 'unknown').length,
  }), [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const state = pipelineState(item.pipeline_label);
      if (stateFilter !== 'all' && state !== stateFilter) return false;
      if (!needle) return true;
      return [item.repo, item.service, item.change_number, item.title, item.environment].join(' ').toLowerCase().includes(needle);
    });
  }, [items, query, stateFilter]);

  const filters: { id: PipelineState; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'failed', label: 'Failed', count: counts.failed },
    { id: 'succeeded', label: 'Succeeded', count: counts.succeeded },
    { id: 'running', label: 'Running', count: counts.running },
    { id: 'unknown', label: 'Unknown', count: counts.unknown },
  ];

  return (
    <DevOpsLayout>
      <Head>
        <title>Pipelines - OpsTrellis</title>
      </Head>
      <div className="pipe-page">
        <header className="pipe-page__head">
          <div>
            <p className="pipe-page__kicker">Delivery</p>
            <h1 className="pipe-page__title">Pipelines</h1>
            <p className="pipe-page__lede">
              CI runs posted onto a change. Failed is red. Succeeded is green. A missing URL stays Unknown.
            </p>
          </div>
          <Link href="/operations/webhooks" className="btn btn-secondary">Open webhooks</Link>
        </header>
        <DeliveryHubNav active="pipelines" />
        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="pipe-stats" role="group" aria-label="Pipeline counts">
          <div className="pipe-stat">
            <span className="pipe-stat__label">Runs</span>
            <strong className="pipe-stat__value">{loading ? '—' : counts.all}</strong>
          </div>
          <div className="pipe-stat pipe-stat--failed">
            <span className="pipe-stat__label">Failed</span>
            <strong className="pipe-stat__value">{loading ? '—' : counts.failed}</strong>
          </div>
          <div className="pipe-stat pipe-stat--succeeded">
            <span className="pipe-stat__label">Succeeded</span>
            <strong className="pipe-stat__value">{loading ? '—' : counts.succeeded}</strong>
          </div>
          <div className="pipe-stat pipe-stat--running">
            <span className="pipe-stat__label">Running</span>
            <strong className="pipe-stat__value">{loading ? '—' : counts.running}</strong>
          </div>
          <div className="pipe-stat pipe-stat--unknown">
            <span className="pipe-stat__label">Unknown</span>
            <strong className="pipe-stat__value">{loading ? '—' : counts.unknown}</strong>
          </div>
        </div>

        <div className="pipe-toolbar">
          <label className="pipe-search">
            <span className="pipe-search__label">Find run</span>
            <input
              className="pipe-search__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Repo, service, or change"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="pipe-filters" role="group" aria-label="Pipeline state">
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`pipe-filter pipe-filter--${filter.id}${stateFilter === filter.id ? ' is-active' : ''}`}
                onClick={() => setStateFilter(filter.id)}
              >
                {filter.label} {loading ? '' : filter.count}
              </button>
            ))}
          </div>
        </div>

        {loading ? <p className="pipe-empty">Loading pipelines…</p> : null}
        {!loading && !items.length ? (
          <div className="pipe-empty-panel">
            <h2 className="pipe-empty-panel__title">No pipeline runs yet</h2>
            <p className="pipe-empty-panel__copy">
              Post a change webhook with pipeline_url, or a CI webhook against a request. A GitHub repo onboard is not required here.
            </p>
            <div className="portal-page__actions">
              <Link href="/operations/webhooks" className="btn btn-primary btn-sm">Connect a webhook</Link>
              <Link href="/changes/new" className="btn btn-secondary btn-sm">Create from PR</Link>
            </div>
          </div>
        ) : null}
        {!loading && items.length > 0 && visible.length === 0 ? (
          <p className="pipe-empty">No pipelines match this filter.</p>
        ) : null}

        {visible.length ? (
          <ul className="pipe-list">
            {visible.map((item) => {
              const state = pipelineState(item.pipeline_label);
              const label = item.pipeline_label || 'Unknown';
              return (
                <li key={item.id} className={`pipe-run pipe-run--${state}`}>
                  <span className="pipe-run__rail" aria-hidden="true" />
                  <div className="pipe-run__main">
                    <Link href={`/changes/${item.id}`} className="pipe-run__chg">
                      {item.change_number || `CHG${item.id}`}
                    </Link>
                    <p className="pipe-run__title">{item.title || item.service || 'Unknown'}</p>
                    <p className="pipe-run__meta">
                      {item.repo || 'Unknown'}
                      {item.preview ? ' · Preview CHG' : ''}
                      {' · '}
                      {item.environment || 'Unknown'}
                      {' · '}
                      {formatWhen(item.updated_at)}
                    </p>
                  </div>
                  <code className="pipe-run__sha">{item.sha || 'Unknown'}</code>
                  <span className={`pipe-status pipe-status--${state}`}>
                    <i className="pipe-status__dot" aria-hidden="true" />
                    {label}
                  </span>
                  {item.pipeline_url ? (
                    <a className="pipe-run__open" href={item.pipeline_url} target="_blank" rel="noreferrer">
                      Open run
                    </a>
                  ) : (
                    <span className="pipe-run__open pipe-run__open--muted">No URL</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
