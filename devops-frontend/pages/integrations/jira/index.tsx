import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  jiraHealthLabel,
  jiraHealthTone,
  jiraRelationshipLabel,
  type JiraConnection,
  type JiraLink,
  type JiraOperation,
  type JiraSpace,
} from '../../../lib/jira';
import { buildPortalApiUrl, portalFetch } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';

type Tab = 'connections' | 'spaces' | 'linked' | 'activity';

export default function JiraIntegrationsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const tab = (['connections', 'spaces', 'linked', 'activity'] as Tab[]).includes(router.query.tab as Tab)
    ? (router.query.tab as Tab)
    : 'connections';
  const [oauthReady, setOauthReady] = useState(true);
  const [connections, setConnections] = useState<JiraConnection[]>([]);
  const [spaces, setSpaces] = useState<JiraSpace[]>([]);
  const [links, setLinks] = useState<JiraLink[]>([]);
  const [activity, setActivity] = useState<JiraOperation[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('Company Jira');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      void router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira'), { token })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          void router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(body.error || 'Jira integrations could not be loaded');
        setOauthReady(body.oauth_ready !== false);
        setConnections(Array.isArray(body.connections) ? body.connections : []);
        setSpaces(Array.isArray(body.spaces) ? body.spaces : []);
        setLinks(Array.isArray(body.linked_work) ? body.linked_work : []);
        setActivity(Array.isArray(body.activity) ? body.activity : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Jira integrations could not be loaded'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (typeof router.query.error === 'string' && router.query.error) setError(router.query.error);
  }, [router.query.error]);

  async function addConnection() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/connections'), {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Connection could not be created');
      return;
    }
    setNotice(body.requested_access?.explanation || 'Connection created.');
    if (typeof body.authorize_url === 'string' && body.authorize_url) {
      window.location.href = body.authorize_url;
      return;
    }
    void router.push(`/integrations/jira/${body.connection?.id}`);
  }

  const tabs = useMemo(() => ([
    { id: 'connections' as Tab, label: 'Connections', count: connections.length },
    { id: 'spaces' as Tab, label: 'Spaces', count: spaces.length },
    { id: 'linked' as Tab, label: 'Linked work', count: links.length },
    { id: 'activity' as Tab, label: 'Activity', count: activity.length },
  ]), [activity.length, connections.length, links.length, spaces.length]);

  return (
    <DevOpsLayout>
      <Head><title>Jira - OpsTrellis</title></Head>
      <div className="work-page">
        <header className="work-page__head">
          <div>
            <p className="ops-kicker">Integrations</p>
            <h1>Jira</h1>
            <p>Connect authorized Jira Cloud sites and selected spaces. One connection can serve Delivery, incidents, security, and cost. Jira Data Center is a later adapter.</p>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {!oauthReady ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Onboard the Jira app</h2>
                <p className="portal-surface__subtitle">Enter the Atlassian OAuth client ID and secret here. OpsTrellis stores them encrypted in the database. They are not read from a server environment file.</p>
              </div>
            </div>
            <div className="portal-form-actions">
              <Link href="/integrations/jira/onboard" className="btn btn-primary">Onboard Jira app</Link>
            </div>
          </section>
        ) : (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Add connection</h2>
                <p className="portal-surface__subtitle">Authorization uses the connection owner’s Jira access. Portal team grants still control who can view, link, or create.</p>
              </div>
            </div>
            <div className="portal-form-grid">
              <label className="label">Name
                <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            </div>
            <div className="portal-form-actions">
              <button type="button" className="btn btn-primary" onClick={() => void addConnection()}>Add connection</button>
              <Link href="/integrations/jira/onboard" className="btn btn-secondary">Replace app credentials</Link>
            </div>
          </section>
        )}
        <div className="delivery-filters" role="tablist" aria-label="Jira views">
          {tabs.map((item) => (
            <Link key={item.id} href={`/integrations/jira?tab=${item.id}`} className={`delivery-filter${tab === item.id ? ' is-selected' : ''}`}>
              {item.label} {item.count}
            </Link>
          ))}
        </div>
        {loading ? <p className="work-empty">Loading Jira…</p> : null}
        {tab === 'connections' && !loading ? (
          <section className="portal-surface">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Owner</th>
                    <th>Authentication</th>
                    <th>Sync</th>
                    <th>Spaces</th>
                    <th>Last success</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {connections.length === 0 ? (
                    <tr><td colSpan={7}>No Jira connections yet.</td></tr>
                  ) : connections.map((conn) => (
                    <tr key={conn.id}>
                      <td>{conn.site_name || conn.name}</td>
                      <td>{conn.owner_username || 'Unknown'}</td>
                      <td><span className={`jira-health jira-health--${jiraHealthTone(conn.auth_health)}`}>{jiraHealthLabel(conn.auth_health)}</span></td>
                      <td><span className={`jira-health jira-health--${jiraHealthTone(conn.sync_health)}`}>{jiraHealthLabel(conn.sync_health)}</span></td>
                      <td>{conn.connected_space_count}</td>
                      <td>{conn.last_success_at ? new Date(conn.last_success_at).toLocaleString() : 'Unknown'}</td>
                      <td><Link href={`/integrations/jira/${conn.id}`}>Configure</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {tab === 'spaces' && !loading ? (
          <section className="portal-surface">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Space</th>
                    <th>Site</th>
                    <th>Mapped projects</th>
                    <th>Teams</th>
                    <th>Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {spaces.length === 0 ? (
                    <tr><td colSpan={5}>No permitted Jira spaces yet.</td></tr>
                  ) : spaces.map((space) => (
                    <tr key={space.id}>
                      <td><Link href={`/integrations/jira/${space.connection_id}?screen=mappings`}>{space.name} ({space.jira_project_key})</Link></td>
                      <td>{space.site_name || space.connection_name}</td>
                      <td>{(space.mapped_portal_projects || []).join(', ') || 'None'}</td>
                      <td>{(space.permitted_teams || []).join(', ') || 'Owner only'}</td>
                      <td><span className={`jira-health jira-health--${jiraHealthTone(space.sync_health)}`}>{jiraHealthLabel(space.sync_health)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {tab === 'linked' && !loading ? (
          <section className="portal-surface">
            {links.some((link) => link.issue.stale) ? (
              <div className="portal-form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    const token = localStorage.getItem(TOKEN_KEY);
                    const stale = links.filter((link) => link.issue.stale).slice(0, 25);
                    if (!token || stale.length === 0) return;
                    setBusy(true);
                    void portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/bulk'), {
                      method: 'POST',
                      token,
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'refresh',
                        items: stale.map((link) => ({ cloud_id: link.issue.cloud_id, issue_id: link.issue.issue_id })),
                      }),
                    })
                      .then(async (res) => {
                        const body = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(body.error || 'Refresh could not be queued');
                        setNotice('Refresh queued for stale linked issues.');
                        load();
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Refresh could not be queued'))
                      .finally(() => setBusy(false));
                  }}
                >
                  Refresh stale issues
                </button>
              </div>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Site / space</th>
                    <th>Status</th>
                    <th>Assignee</th>
                    <th>Portal record</th>
                    <th>Freshness</th>
                  </tr>
                </thead>
                <tbody>
                  {links.length === 0 ? (
                    <tr><td colSpan={6}>No linked Jira work yet.</td></tr>
                  ) : links.map((link) => (
                    <tr key={link.id}>
                      <td>{link.issue.issue_key} {link.issue.summary}</td>
                      <td>{link.issue.site_name} / {link.issue.space_key || link.issue.space_name}</td>
                      <td>{link.issue.status}</td>
                      <td>{link.issue.assignee || 'Unassigned'}</td>
                      <td>{jiraRelationshipLabel(link.relationship)} · {link.source_type}{link.source_id ? ` #${link.source_id}` : ''}</td>
                      <td>{jiraHealthLabel(link.issue.freshness)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {tab === 'activity' && !loading ? (
          <section className="portal-surface">
            {activity.some((op) => op.retryable) ? (
              <div className="portal-form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const token = localStorage.getItem(TOKEN_KEY);
                    if (!token) return;
                    void Promise.all(activity.filter((op) => op.retryable).map((op) => portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/operations/${encodeURIComponent(op.operation_id)}/retry`), { method: 'POST', token }))).then(load);
                  }}
                >
                  Retry failed operations
                </button>
              </div>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Source</th>
                    <th>Result</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {activity.length === 0 ? (
                    <tr><td colSpan={5}>No Jira operations yet.</td></tr>
                  ) : activity.map((op) => (
                    <tr key={op.operation_id}>
                      <td>{op.kind.replace(/_/g, ' ')}</td>
                      <td>{op.issue_key || op.source_type || '—'}{op.source_id ? ` #${op.source_id}` : ''}</td>
                      <td>
                        <span className={`jira-health jira-health--${jiraHealthTone(op.state)}`}>{jiraHealthLabel(op.state)}</span>
                        {op.last_error ? <div className="form-section__copy">{op.last_error}</div> : null}
                      </td>
                      <td>{op.updated_at ? new Date(op.updated_at).toLocaleString() : 'Unknown'}</td>
                      <td>
                        {op.retryable ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              const token = localStorage.getItem(TOKEN_KEY);
                              if (!token) return;
                              void portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/integrations/jira/operations/${encodeURIComponent(op.operation_id)}/retry`), { method: 'POST', token }).then(load);
                            }}
                          >
                            Retry
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
