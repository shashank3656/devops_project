import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CollectionStatus, { collectionStateLabel, type CollectionState } from '../../components/CollectionStatus';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { buildPortalApiUrl, portalFetch } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';

type HealthAction = {
  label: string;
  href: string;
};

type HealthConnector = {
  id: string;
  name: string;
  state: CollectionState;
  source?: string;
  last_success_at?: string | null;
  failed_jobs?: number;
  detail?: string;
  action?: HealthAction | null;
};

type HealthFamily = {
  id: string;
  label: string;
  state: CollectionState;
  source: string;
  last_success_at?: string | null;
  failed_jobs?: number;
  detail?: string;
  action?: HealthAction | null;
  connectors?: HealthConnector[];
};

function asState(value: string | undefined): CollectionState {
  if (value === 'ok' || value === 'no_findings' || value === 'not_connected' || value === 'stale' || value === 'failed') return value;
  return 'not_connected';
}

function lastLabel(value?: string | null): string {
  if (!value) return 'Unknown';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return 'Unknown';
  return when.toLocaleString();
}

export default function IntegrationHealthPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [families, setFamilies] = useState<HealthFamily[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      void router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/health'), { token })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          void router.replace('/login');
          return;
        }
        if (res.status === 403) {
          setFamilies([]);
          setError(typeof body.error === 'string' ? body.error : 'This section is not included for your group.');
          return;
        }
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Integration health could not be loaded');
        const rows = Array.isArray(body.families) ? body.families as HealthFamily[] : [];
        setFamilies(rows.map((item) => ({
          ...item,
          state: asState(item.state),
          connectors: Array.isArray(item.connectors)
            ? item.connectors.map((connector) => ({ ...connector, state: asState(connector.state) }))
            : [],
        })));
        setNote(typeof body.note === 'string' ? body.note : '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Integration health could not be loaded'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const tally = { ok: 0, no_findings: 0, not_connected: 0, stale: 0, failed: 0 };
    families.forEach((item) => { tally[item.state] += 1; });
    return tally;
  }, [families]);
  const headline = families.some((item) => item.state === 'failed')
    ? 'failed'
    : families.some((item) => item.state === 'stale')
      ? 'stale'
      : families.some((item) => item.state === 'not_connected')
        ? 'not_connected'
        : families.some((item) => item.state === 'no_findings')
          ? 'no_findings'
          : families.length
            ? 'ok'
            : 'not_connected';
  const latest = families.map((item) => item.last_success_at || '').filter(Boolean).sort().at(-1) || null;
  const source = families.map((item) => item.source).filter(Boolean).slice(0, 3).join(' · ') || 'Connectors';

  return (
    <DevOpsLayout>
      <Head><title>Integration health</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Integration health</h1>
            <p className="portal-page__subtitle">One place for connector health, last successful sync, stale data, failed jobs, and the next recovery action.</p>
            {!loading ? (
              <CollectionStatus
                source={source}
                lastSuccess={latest}
                state={headline}
                detail="Nothing found is No findings. A stopped collector is Stale or Collection failed, never Healthy."
              />
            ) : null}
          </div>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>Retry</button>
          </div>
        ) : null}

        <section className="portal-stat-grid portal-stat-grid--three" aria-label="Connector summary">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Current or no findings</span>
            <span className="portal-stat-card__value">{loading ? '…' : counts.ok + counts.no_findings}</span>
            <p className="portal-stat-card__copy">Successful collection. Empty stays No findings, never Healthy.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Stale or not connected</span>
            <span className="portal-stat-card__value">{loading ? '…' : counts.stale + counts.not_connected}</span>
            <p className="portal-stat-card__copy">The connector is missing or has stopped collecting data.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Collection failed</span>
            <span className="portal-stat-card__value">{loading ? '…' : counts.failed}</span>
            <p className="portal-stat-card__copy">Failed jobs need a recovery action. Secrets are never shown.</p>
          </article>
        </section>

        {loading ? <div className="empty-state">Loading integration health...</div> : null}
        {!loading && !families.length && !error ? (
          <div className="empty-state">No connector families are included for your group.</div>
        ) : null}

        {!loading ? families.map((family) => (
          <section key={family.id} className="portal-surface integration-health">
            <div className="integration-health__head">
              <div>
                <h2 className="portal-surface__title">{family.label}</h2>
                <CollectionStatus
                  source={family.source}
                  lastSuccess={family.last_success_at}
                  state={family.state}
                  detail={family.detail}
                />
              </div>
              {family.action ? <Link className="btn btn-primary" href={family.action.href}>{family.action.label}</Link> : null}
            </div>
            {family.failed_jobs ? <p className="access-hint">{family.failed_jobs} failed job{family.failed_jobs === 1 ? '' : 's'}.</p> : null}
            {!family.connectors?.length ? (
              <p className="access-hint">{family.detail || 'Not connected.'}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Connector</th>
                      <th>State</th>
                      <th>Last successful collection</th>
                      <th>Failed jobs</th>
                      <th>Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {family.connectors.map((connector) => (
                      <tr key={connector.id}>
                        <td>
                          {connector.name}
                          {connector.source ? <span className="access-hint"> · {connector.source}</span> : null}
                        </td>
                        <td>{collectionStateLabel(connector.state)}</td>
                        <td>{connector.state === 'not_connected' || connector.state === 'failed' ? 'Unknown' : lastLabel(connector.last_success_at)}</td>
                        <td>{connector.failed_jobs || 0}</td>
                        <td>
                          {connector.action ? <Link href={connector.action.href}>{connector.action.label}</Link> : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )) : null}
        {note ? <p className="access-hint">{note}</p> : null}
      </div>
    </DevOpsLayout>
  );
}
