import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface WebhookActivity {
  inbox_id: number;
  project_id: number;
  event_id: string;
  external_id: string;
  received_at: string;
  processing_state: string;
  service_alias: string;
  record_id: number;
  service_id: number;
  mapping_version: number;
  can_replay: boolean;
}

export default function WebhookActivityPage() {
  const apiUrl = useApiUrl();
  const [activity, setActivity] = useState<WebhookActivity[]>([]);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('repair the service alias');
  const [alias, setAlias] = useState('');
  const [serviceID, setServiceID] = useState('');
  const [preview, setPreview] = useState('');
  const [outcome, setOutcome] = useState('');
  const [pending, setPending] = useState('');
  const canRecover = activity.some((item) => item.can_replay);

  const load = (nextState = state) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    const query = nextState ? `?state=${encodeURIComponent(nextState)}` : '';
    fetch(`${apiUrl}/api/webhooks/activity${query}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError('Failed to load webhook activity');
          setActivity([]);
          return;
        }
        setActivity(Array.isArray(data.activity) ? data.activity : []);
        setError('');
      })
      .catch(() => setError('Failed to load webhook activity'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load('');
  }, [apiUrl]);

  const previewMapping = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const projectID = activity[0]?.project_id;
    if (!token || !projectID) return;
    setPending('preview');
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/webhooks/mappings/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectID, alias, service_id: Number(serviceID) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Preview failed');
      setPreview(`Dry run version ${data.next_version ?? 'Unknown'}. Effects ${data.effects ?? 'Unknown'}. This preview does not activate the mapping.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPending('');
    }
  };

  const activateMapping = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const projectID = activity[0]?.project_id;
    if (!token || !projectID) return;
    setPending('activate');
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/webhooks/mappings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectID, alias, service_id: Number(serviceID) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Activate failed');
      setPreview(`Active version ${data.version}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activate failed');
    } finally {
      setPending('');
    }
  };

  const replay = async (item: WebhookActivity) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !reason.trim()) return;
    setPending(`replay-${item.inbox_id}`);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/webhooks/inbox/${item.inbox_id}/replay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Replay failed');
      if (data.approval_state === 'approved') throw new Error('Replay must not approve the record');
      setOutcome(data.duplicate || data.already_recorded ? 'Duplicate. The replay did not create a second record.' : 'Replay recorded once. It did not approve the record.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setPending('');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Webhook activity — DevOps</title>
      </Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Webhook recovery</h1>
            <p className="portal-page__subtitle">Unmapped events stay quarantined. Payloads and secrets stay on the server. This page does not approve a record.</p>
          </div>
          <div className="portal-page__actions">
            <a className="btn btn-secondary" href="/connections">Connection health</a>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <div className="portal-field-grid portal-field-grid--two">
            <label className="label">State
              <select
                className="input"
                value={state}
                onChange={(event) => {
                  setState(event.target.value);
                  load(event.target.value);
                }}
              >
                <option value="">All</option>
                <option value="quarantined">Quarantined</option>
                <option value="mapped">Mapped</option>
                <option value="accepted">Accepted</option>
                <option value="stale">Stale</option>
              </select>
            </label>
            <label className="label">Alias
              <input className="input" value={alias} onChange={(event) => setAlias(event.target.value)} />
            </label>
            <label className="label">Service
              <input className="input" value={serviceID} onChange={(event) => setServiceID(event.target.value)} inputMode="numeric" />
            </label>
            {canRecover ? (
              <label className="label">Replay reason
                <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
            ) : null}
          </div>
          {canRecover ? (
            <div className="portal-page__actions">
              <button className="btn btn-secondary" type="button" disabled={pending === 'preview'} onClick={previewMapping}>Preview</button>
              <button className="btn btn-primary" type="button" disabled={pending === 'activate'} onClick={activateMapping}>Activate</button>
            </div>
          ) : null}
          {preview ? <p>{preview}</p> : null}
          {outcome ? <p>{outcome}</p> : null}
          {loading ? <p>Loading activity…</p> : null}
          <table className="templates-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Event</th>
                <th>State</th>
                <th>Alias</th>
                <th>Mapped record</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activity.map((item) => (
                <tr key={item.inbox_id}>
                  <td>{item.received_at}</td>
                  <td>{item.event_id}</td>
                  <td>{item.service_id > 0 ? item.processing_state : 'Quarantined · unmapped scope'}</td>
                  <td>{item.service_alias || '—'}</td>
                  <td>
                    {item.record_id > 0 ? (
                      item.service_id > 0 ? (
                        <Link href={`/catalog/${item.service_id}`}>Record {item.record_id} · v{item.mapping_version}</Link>
                      ) : (
                        `Record ${item.record_id}`
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {canRecover && (item.processing_state === 'quarantined' || item.service_id <= 0) ? (
                      <button className="btn btn-secondary" type="button" disabled={pending === `replay-${item.inbox_id}`} onClick={() => replay(item)}>
                        Replay
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!loading && activity.length === 0 ? (
                <tr>
                  <td colSpan={6}>No webhook activity in this scope.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </DevOpsLayout>
  );
}
