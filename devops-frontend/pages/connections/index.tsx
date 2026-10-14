import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ConnectionHealth {
  id: number;
  project_id: number;
  name: string;
  environment: string;
  state: string;
  coverage: string;
  secret_ref_set: boolean;
  last_success?: string;
  missing_permissions: string[];
  disabled: boolean;
  last_error?: string;
  health_label: string;
}

function healthLabel(connection: ConnectionHealth) {
  const label = connection.health_label || 'Unknown';
  if (connection.state === 'stale' || connection.coverage === 'stale') return 'Stale';
  if (connection.state !== 'healthy' && label === 'Healthy') return 'Unknown';
  return label;
}

function publicError(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes('password') || lower.includes('secret') || lower.includes('token') || lower.includes('key')) {
    return 'The connection reported an error. The message was hidden.';
  }
  return value;
}

export default function ConnectionsPage() {
  const apiUrl = useApiUrl();
  const [connections, setConnections] = useState<ConnectionHealth[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');

  const load = () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    fetch(`${apiUrl}/api/connections`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(publicError(typeof data?.error === 'string' ? data.error : 'Failed to load connections'));
          setConnections([]);
          return;
        }
        setConnections(Array.isArray(data.connections) ? data.connections : []);
        setError('');
      })
      .catch(() => setError('Failed to load connections'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl]);

  const runAction = async (connection: ConnectionHealth, action: 'test' | 'disable') => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setPending(`${action}-${connection.id}`);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/connections/${connection.id}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(publicError(typeof data?.error === 'string' ? data.error : `Failed to ${action} connection`));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} connection`);
    } finally {
      setPending('');
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Connections - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Connections</span>
            <h1 className="portal-page__title">Connection health</h1>
            <p className="portal-page__subtitle">
              Coverage, last success, and errors for connections you can read. A missing, stale, or unknown result stays distinct from Healthy.
            </p>
          </div>
          <div className="portal-page__actions">
            <a className="btn btn-secondary" href="/webhooks">Webhook recovery</a>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading connections...</div> : null}
          {!loading && !connections.length ? (
            <div className="empty-state">
              <p>No connections in your scope yet.</p>
              <a className="btn btn-primary" href="/cloud-accounts">Review cloud accounts</a>
            </div>
          ) : null}
          {connections.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Connection</th>
                  <th>Health</th>
                  <th>Coverage</th>
                  <th>Last success</th>
                  <th>Missing permissions</th>
                  <th>Secret reference</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <tr key={connection.id}>
                    <td>
                      <strong>{connection.name}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {connection.environment || '—'}
                        {connection.disabled ? ' · disabled' : ''}
                      </div>
                    </td>
                    <td>
                      {healthLabel(connection)}
                      {connection.last_error ? (
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{publicError(connection.last_error)}</div>
                      ) : null}
                    </td>
                    <td>{connection.coverage || 'unknown'}</td>
                    <td>{connection.last_success ? new Date(connection.last_success).toLocaleString() : '—'}</td>
                    <td>{connection.missing_permissions?.length ? connection.missing_permissions.join(', ') : '—'}</td>
                    <td>{connection.secret_ref_set ? 'Set' : 'Not set'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={connection.disabled || pending === `test-${connection.id}`}
                        onClick={() => void runAction(connection, 'test')}
                      >
                        {pending === `test-${connection.id}` ? 'Testing...' : 'Test'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={connection.disabled || pending === `disable-${connection.id}`}
                        onClick={() => void runAction(connection, 'disable')}
                      >
                        {connection.disabled ? 'Disabled' : pending === `disable-${connection.id}` ? 'Disabling...' : 'Disable'}
                      </button>
                    </td>
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
