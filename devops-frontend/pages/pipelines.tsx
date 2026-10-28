import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { DeploymentVerificationCard, InspectorDrawer, useWorkspaceScope, type DeploymentVerification } from '@infragate/ui';
import DeliveryHubNav from '../components/DeliveryHubNav';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { formatDurationMinutes, formatVerification, formatWhen } from '../lib/delivery';

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
  verification?: DeploymentVerification;
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
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<PipelineRow | null>(null);
  const [detailVerification, setDetailVerification] = useState<DeploymentVerification | null>(null);
  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/webhooks/change`;

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

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

  useEffect(() => {
    if (!selected?.id) {
      setDetailVerification(null);
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    let cancelled = false;
    setDetailVerification(selected.verification || null);
    fetch(`${apiUrl}/api/devops/changes/${selected.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        return data?.verification as DeploymentVerification | undefined;
      })
      .then((verification) => {
        if (!cancelled && verification) setDetailVerification(verification);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiUrl, selected]);

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
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConnecting((value) => !value)}>
            {connecting ? 'Hide connect steps' : 'Connect pipeline'}
          </button>
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

        {connecting || (!loading && !items.length) ? (
          <section className="delivery-empty-panel">
            <h2>Connect pipeline</h2>
            <p>Record CI runs onto a change. A GitHub repository onboard is not required here. Missing runs stay Unknown.</p>
            <ol className="delivery-steps">
              <li>Copy the change webhook URL for this workspace.</li>
              <li>Point your CI at that URL from the integration documentation.</li>
              <li>New runs appear here with the environment recorded on the change, not the job title.</li>
            </ol>
            <div className="portal-page__actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void copyWebhook()}>
                {copied ? 'Webhook copied' : 'Copy webhook URL'}
              </button>
              <Link href="/operations/webhooks" className="btn btn-secondary btn-sm">Open webhook settings</Link>
            </div>
          </section>
        ) : null}
        {loading ? <p className="delivery-empty">Loading pipelines…</p> : null}
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
                    <th>Verification</th>
                    <th>Duration</th>
                    <th>Last checked</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const state = pipelineState(item.pipeline_label);
                    const label = item.pipeline_label || 'Unknown';
                    const verification = formatVerification(item.verification?.state, item.verification?.label);
                    return (
                      <tr key={item.id}>
                        <td>
                          <button type="button" className="delivery-pr-link" onClick={() => setSelected(item)}>
                            <span className="delivery-pr-link__title">{item.title || item.change_number || `Run ${item.id}`}</span>
                            <span className="delivery-pr-link__meta">{item.change_number || `CHG${item.id}`}</span>
                          </button>
                        </td>
                        <td>{item.repo || 'Unknown'}</td>
                        <td>{item.environment || 'Unknown'}</td>
                        <td>
                          <span className={`delivery-status delivery-status--${state === 'succeeded' ? 'ok' : state === 'failed' ? 'failed' : state === 'running' ? 'pending' : 'unknown'}`}>
                            {label}
                          </span>
                          {item.stale ? <span className="delivery-status delivery-status--setup">Status stale</span> : null}
                        </td>
                        <td>
                          <span className={`delivery-status delivery-status--${verification.tone}`}>{verification.label}</span>
                        </td>
                        <td>{formatDurationMinutes(item.duration_minutes, item.duration_known)}</td>
                        <td>{formatWhen(item.last_checked || item.updated_at)}</td>
                        <td>
                          <div className="delivery-row-actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(item)}>Details</button>
                            {item.pipeline_url ? (
                              <a className="btn btn-primary btn-sm" href={item.pipeline_url} target="_blank" rel="noreferrer">View run</a>
                            ) : (
                              <Link href={`/changes/${item.id}`} className="btn btn-secondary btn-sm">View change</Link>
                            )}
                          </div>
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
      <InspectorDrawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        wide
        resetKey={selected?.id}
        eyebrow="Deployment details"
        title={selected ? (selected.title || selected.change_number || `Run ${selected.id}`) : 'Deployment'}
        subtitle={selected ? [selected.change_number, selected.environment || 'Unknown', selected.sha || 'Unknown commit'].filter(Boolean).join(' · ') : ''}
        footer={selected ? (
          <div className="delivery-drawer-actions">
            <Link href={`/changes/${selected.id}`} className="btn btn-secondary">Open change</Link>
            {selected.pipeline_url ? (
              <a className="btn btn-primary" href={selected.pipeline_url} target="_blank" rel="noreferrer">Open recorded run</a>
            ) : null}
          </div>
        ) : null}
      >
        {selected ? (
          <div className="delivery-drawer">
            <section>
              <h3>Recorded run</h3>
              <p>{selected.pipeline_label || 'Unknown'} · {selected.environment || 'Unknown'} · {formatWhen(selected.last_checked || selected.updated_at)}</p>
              <p className="delivery-table__hint">Environment comes from the recorded change, not the run title. Missing telemetry stays Inconclusive, never Healthy.</p>
            </section>
            <DeploymentVerificationCard verification={detailVerification || selected.verification} />
          </div>
        ) : null}
      </InspectorDrawer>
    </DevOpsLayout>
  );
}
