import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InspectorDrawer, useWorkspaceScope } from '@infragate/ui';
import CollectionStatus, { collectionStateLabel, type CollectionState } from '../../components/CollectionStatus';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { buildPortalApiUrl, portalFetch } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';
const CONNECTOR_STATES: CollectionState[] = ['ok', 'partial', 'no_findings', 'not_connected', 'stale', 'failed'];

type HealthAction = {
  label: string;
  href: string;
};

type HealthConnector = {
  id: string;
  name: string;
  state: CollectionState;
  source?: string;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  failed_jobs?: number;
  detail?: string;
  failure_reason?: string;
  affected_services?: string[];
  recovery?: string;
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
  if (value === 'ok' || value === 'partial' || value === 'no_findings' || value === 'not_connected' || value === 'stale' || value === 'failed') return value;
  return 'not_connected';
}

function lastLabel(value?: string | null): string {
  if (!value) return 'Unknown';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return 'Unknown';
  return when.toLocaleString();
}

function emptyCounts(): Record<CollectionState, number> {
  return { ok: 0, partial: 0, no_findings: 0, not_connected: 0, stale: 0, failed: 0 };
}

function headlineState(states: CollectionState[]): CollectionState {
  const order: CollectionState[] = ['failed', 'stale', 'partial', 'not_connected', 'no_findings', 'ok'];
  return order.find((state) => states.includes(state)) || 'not_connected';
}

export default function IntegrationHealthPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const { scope } = useWorkspaceScope();
  const [families, setFamilies] = useState<HealthFamily[]>([]);
  const [scopeLabel, setScopeLabel] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ family: string; connector: HealthConnector } | null>(null);
  const [stateFilter, setStateFilter] = useState<CollectionState | ''>('');

  const projectId = scope.projectId || (typeof router.query.project_id === 'string' ? router.query.project_id : '');

  const load = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      void router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    const path = params.toString() ? `/api/devops/integrations/health?${params}` : '/api/devops/integrations/health';
    portalFetch(buildPortalApiUrl(apiUrl, path), { token })
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
        setScopeLabel(typeof body.scope === 'string' ? body.scope : '');
        setNote(typeof body.note === 'string' ? body.note : 'Counts are individual connectors, not integration categories.');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Integration health could not be loaded'))
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!router.isReady || loading) return;
    const connectorId = typeof router.query.connector === 'string' ? router.query.connector : '';
    if (!connectorId) return;
    for (const family of families) {
      const connector = (family.connectors || []).find((item) => item.id === connectorId);
      if (connector) {
        setSelected({ family: family.label, connector });
        setStateFilter(connector.state);
        return;
      }
    }
  }, [families, loading, router.isReady, router.query.connector]);

  const counts = useMemo(() => {
    const tally = emptyCounts();
    families.forEach((family) => {
      const rows = family.connectors?.length ? family.connectors : [{ state: family.state } as HealthConnector];
      rows.forEach((row) => { tally[row.state] += 1; });
    });
    return tally;
  }, [families]);
  const connectorTotal = CONNECTOR_STATES.reduce((sum, state) => sum + counts[state], 0);
  const headline = headlineState(families.map((item) => item.state));
  const latest = families.map((item) => item.last_success_at || '').filter(Boolean).sort().at(-1) || null;
  const source = families.map((item) => item.source).filter(Boolean).slice(0, 3).join(' · ') || 'Connectors';
  const visibleFamilies = families.map((family) => {
    if (!stateFilter) return family;
    const connectors = (family.connectors || []).filter((item) => item.state === stateFilter);
    if (connectors.length) return { ...family, connectors };
    if (!family.connectors?.length && family.state === stateFilter) return family;
    return null;
  }).filter((family): family is HealthFamily => Boolean(family));

  return (
    <DevOpsLayout>
      <Head><title>Integration health</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Integration health</h1>
            <p className="portal-page__subtitle">Connector health, last successful sync, and the next recovery action. {scopeLabel ? `Scope: ${scopeLabel}.` : ''}{projectId ? ' Billing follows the selected project or account.' : ' Billing is organization-wide until a project is selected.'}</p>
            {!loading ? (
              <CollectionStatus
                source={source}
                lastSuccess={latest}
                state={headline}
              />
            ) : null}
            <details className="onboard-advanced">
              <summary>How connector status is counted</summary>
              <p className="form-section__copy">
                Counts are individual connectors, not integration categories. Current is a successful collection. No findings is a successful empty load, never Healthy. Partially connected means some sources in a family are current and others are not. Not connected is missing. Stale has stopped collecting. Collection failed has failed jobs. Secrets are never shown. Refreshing this page does not pull newer provider billing data.
              </p>
            </details>
          </div>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>Retry</button>
          </div>
        ) : null}

        <section className="portal-surface" aria-label="Connector counts">
          <h2 className="portal-surface__title">Connector counts</h2>
          <p className="access-hint">{note || 'Counts are individual connectors, not integration categories.'}{loading ? '' : ` Total ${connectorTotal}.`}{stateFilter ? ` Showing ${collectionStateLabel(stateFilter)}.` : ''}</p>
          <div className="integration-count-tiles" role="group" aria-label="Filter connectors by status">
            {CONNECTOR_STATES.map((state) => (
              <button
                key={state}
                type="button"
                className={`integration-count-tile integration-count-tile--${state}${stateFilter === state ? ' is-active' : ''}`}
                aria-pressed={stateFilter === state}
                onClick={() => setStateFilter((current) => (current === state ? '' : state))}
              >
                <span className="integration-count-tile__icon" aria-hidden="true">
                  {state === 'ok' ? '✓' : state === 'failed' ? '!' : state === 'stale' ? '⏱' : state === 'partial' ? '◑' : state === 'no_findings' ? '○' : '–'}
                </span>
                <strong>{loading ? '…' : counts[state]}</strong>
                <span>{collectionStateLabel(state)}</span>
              </button>
            ))}
          </div>
        </section>

        {loading ? <div className="empty-state">Loading integration health...</div> : null}
        {!loading && !families.length && !error ? (
          <div className="empty-state">No connector families are included for your group.</div>
        ) : null}
        {!loading && families.length && !visibleFamilies.length ? (
          <div className="empty-state">No connectors match this status. Click the tile again to show every connector.</div>
        ) : null}

        {!loading ? visibleFamilies.map((family) => (
          <section key={family.id} className="portal-surface integration-health">
            <div className="integration-health__head">
              <div>
                <h2 className="portal-surface__title">{family.label}</h2>
                <CollectionStatus
                  source={family.source}
                  lastSuccess={family.last_success_at}
                  state={family.state}
                />
              </div>
              {family.action ? <Link className="btn btn-primary" href={family.action.href}>{family.action.label}</Link> : null}
            </div>
            {family.detail ? <p className="access-hint">{family.detail}</p> : null}
            {family.failed_jobs ? <p className="access-hint">{family.failed_jobs} failed job{family.failed_jobs === 1 ? '' : 's'}.</p> : null}
            {!family.connectors?.length ? null : (
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
                      <tr
                        key={connector.id}
                        className="integration-health__row"
                        tabIndex={0}
                        onClick={() => setSelected({ family: family.label, connector })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected({ family: family.label, connector });
                          }
                        }}
                      >
                        <td>
                          {connector.name}
                          {connector.source ? <span className="access-hint"> · {connector.source}</span> : null}
                        </td>
                        <td>{collectionStateLabel(connector.state)}</td>
                        <td>{connector.state === 'not_connected' || connector.state === 'failed' ? 'Unknown' : lastLabel(connector.last_success_at)}</td>
                        <td>{connector.failed_jobs || 0}</td>
                        <td>
                          {connector.action ? <Link href={connector.action.href} onClick={(event) => event.stopPropagation()}>{connector.action.label}</Link> : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )) : null}
      </div>
      <InspectorDrawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        resetKey={selected?.connector.id || ''}
        label="Connector diagnostics"
        eyebrow="Integration health"
        title={selected?.connector.name || 'Connector'}
        subtitle={selected ? `${selected.family} · ${collectionStateLabel(selected.connector.state)}` : undefined}
        footer={selected?.connector.action ? <Link className="btn btn-primary" href={selected.connector.action.href}>{selected.connector.action.label}</Link> : null}
      >
        {selected ? (
          <dl className="expiry-facts">
            <div>
              <dt>Last attempt</dt>
              <dd>{lastLabel(selected.connector.last_attempt_at || selected.connector.last_success_at)}</dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>{selected.connector.state === 'not_connected' || selected.connector.state === 'failed' ? 'Unknown' : lastLabel(selected.connector.last_success_at)}</dd>
            </div>
            <div>
              <dt>Failure reason</dt>
              <dd>{selected.connector.failure_reason || selected.connector.detail || 'None'}</dd>
            </div>
            <div>
              <dt>Affected services</dt>
              <dd>{(selected.connector.affected_services || []).filter(Boolean).join(', ') || selected.family}</dd>
            </div>
            <div>
              <dt>Recommended recovery</dt>
              <dd>{selected.connector.recovery || (selected.connector.action ? `${selected.connector.action.label}.` : 'No recovery action.')}</dd>
            </div>
          </dl>
        ) : null}
      </InspectorDrawer>
    </DevOpsLayout>
  );
}
