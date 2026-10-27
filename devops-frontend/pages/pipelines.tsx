import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useWorkspaceScope } from '@infragate/ui';
import DeliveryHubNav from '../components/DeliveryHubNav';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { formatDurationMinutes, formatWhen } from '../lib/delivery';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface PipelineRow {
  id: number;
  change_number?: string;
  repo?: string;
  pr_number?: number;
  service?: string;
  environment?: string;
  status?: string;
  pipeline_url?: string;
  pipeline_label?: string;
  sha?: string;
  title?: string;
  change_type?: string;
  updated_at?: string;
  last_checked?: string;
  duration_minutes?: number;
  duration_known?: boolean;
  stale?: boolean;
  preview?: boolean;
}

type PipelineState = 'all' | 'running' | 'failed' | 'succeeded' | 'unknown' | 'stale';

function pipelineState(label?: string): Exclude<PipelineState, 'all' | 'stale'> {
  const key = (label || 'Unknown').toLowerCase();
  if (key === 'failed') return 'failed';
  if (key === 'succeeded') return 'succeeded';
  if (key === 'running' || key === 'posted') return 'running';
  return 'unknown';
}

export default function PipelinesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const { scope } = useWorkspaceScope();
  const [items, setItems] = useState<PipelineRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<PipelineState>('all');

  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams();
    if (scope.projectId) params.set('project_id', scope.projectId);
    if (scope.environment) params.set('environment', scope.environment);
    const repo = typeof router.query.repo === 'string' ? router.query.repo : '';
    const pr = typeof router.query.pr === 'string' ? router.query.pr : '';
    if (repo) params.set('repo', repo);
    if (pr) params.set('pr', pr);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    setLoading(true);
    fetch(`${apiUrl}/api/devops/pipelines${suffix}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load pipelines');
        setItems(Array.isArray(data.pipelines) ? data.pipelines : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load pipelines'))
      .finally(() => setLoading(false));
  }, [apiUrl, router, router.isReady, router.query.pr, router.query.repo, scope.environment, scope.projectId]);

  const counts = useMemo(() => ({
    all: items.length,
    running: items.filter((item) => pipelineState(item.pipeline_label) === 'running').length,
    failed: items.filter((item) => pipelineState(item.pipeline_label) === 'failed').length,
    succeeded: items.filter((item) => pipelineState(item.pipeline_label) === 'succeeded').length,
    unknown: items.filter((item) => pipelineState(item.pipeline_label) === 'unknown').length,
    stale: items.filter((item) => item.stale).length,
  }), [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (stateFilter === 'stale') return Boolean(item.stale);
      const state = pipelineState(item.pipeline_label);
      if (stateFilter !== 'all' && state !== stateFilter) return false;
      if (!needle) return true;
      return [item.repo, item.service, item.change_number, item.title, item.environment].join(' ').toLowerCase().includes(needle);
    });
  }, [items, query, stateFilter]);

  const filters: { id: PipelineState; label: string; count: number }[] = [
    { id: 'all', label: 'Runs', count: counts.all },
    { id: 'failed', label: 'Failed', count: counts.failed },
    { id: 'succeeded', label: 'Succeeded', count: counts.succeeded },
    { id: 'running', label: 'Running', count: counts.running },
    { id: 'stale', label: 'Stale', count: counts.stale },
    { id: 'unknown', label: 'Unknown', count: counts.unknown },
  ];

  return (
    <DevOpsLayout>
      <Head>
        <title>Pipelines - OpsTrellis</title>
      </Head>
      <div className="delivery-shell">
        <header className="delivery-head">
          <div>
            <p className="delivery-kicker">Delivery</p>
            <h1 className="delivery-title">Pipelines</h1>
            <p className="delivery-lede">CI runs posted onto a change. Environment comes from the recorded change, not the run title.</p>
          </div>
        </header>
        <DeliveryHubNav active="pipelines" />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {typeof router.query.repo === 'string' && router.query.repo ? (
          <p className="delivery-scope">
            Showing runs recorded for <strong>{router.query.repo}</strong>
            {typeof router.query.pr === 'string' && router.query.pr ? ` PR #${router.query.pr}` : ''}.
            {' '}
            <Link href="/pipelines">Clear PR filter</Link>
          </p>
        ) : null}
        {scope.environment ? (
          <p className="delivery-scope">
            Showing runs recorded for <strong>{scope.environment}</strong>. Titles such as “in dev” are not used for this filter.
          </p>
        ) : (
          <p className="delivery-scope">Workspace environment is All. Each run shows its recorded environment.</p>
        )}

        <div className="delivery-toolbar delivery-toolbar--pipe">
          <label className="delivery-search">
            <input
              className="delivery-search__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find run"
              aria-label="Find run"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="delivery-filters delivery-filters--pipe" role="group" aria-label="Pipeline state">
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`delivery-filter delivery-filter--${filter.id}${stateFilter === filter.id ? ' is-active' : ''}`}
                onClick={() => setStateFilter(filter.id)}
              >
                {filter.label}
                <strong>{loading ? '—' : filter.count}</strong>
              </button>
            ))}
          </div>
        </div>

        {loading ? <p className="delivery-empty">Loading pipelines…</p> : null}
        {!loading && !items.length ? (
          <div className="delivery-empty-panel">
            <h2>No pipeline runs yet</h2>
            <p>
              {typeof router.query.repo === 'string' && router.query.repo
                ? 'No pipeline URL is recorded for this pull request yet. Missing stays Unknown.'
                : 'Post a change webhook with pipeline_url. A GitHub repo onboard is not required here.'}
            </p>
            <Link href="/operations/webhooks" className="btn btn-primary btn-sm">Connect a webhook</Link>
          </div>
        ) : null}
        {!loading && items.length > 0 && visible.length === 0 ? (
          <p className="delivery-empty">No pipelines match this filter.</p>
        ) : null}

        {visible.length ? (
          <section className="delivery-panel">
            <div className="table-scroll">
              <table className="delivery-table">
                <thead>
                  <tr>
                    <th>Run name</th>
                    <th>Repository</th>
                    <th>Environment</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Last checked</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const state = pipelineState(item.pipeline_label);
                    const label = item.pipeline_label || 'Unknown';
                    return (
                      <tr key={item.id}>
                        <td>
                          <span className="delivery-pr-link__title">{item.title || item.change_number || `Run ${item.id}`}</span>
                          <span className="delivery-pr-link__meta">{item.change_number || `CHG${item.id}`}</span>
                        </td>
                        <td>{item.repo || 'Unknown'}</td>
                        <td>{item.environment || 'Unknown'}</td>
                        <td>
                          <span className={`delivery-status delivery-status--${state === 'succeeded' ? 'ok' : state === 'failed' ? 'failed' : state === 'running' ? 'pending' : 'unknown'}`}>
                            {label}
                          </span>
                          {item.stale ? <span className="delivery-status delivery-status--setup">Status stale</span> : null}
                        </td>
                        <td>{formatDurationMinutes(item.duration_minutes, item.duration_known)}</td>
                        <td>{formatWhen(item.last_checked || item.updated_at)}</td>
                        <td>
                          {item.pipeline_url ? (
                            <a className="btn btn-primary btn-sm" href={item.pipeline_url} target="_blank" rel="noreferrer">View run</a>
                          ) : (
                            <Link href={`/changes/${item.id}`} className="btn btn-secondary btn-sm">View change</Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
