import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface FailureItem {
  id: number;
  job_type: string;
  target: string;
  error_message: string;
  status: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

function normalizeFailures(value: unknown): FailureItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((failure) => {
    const item = failure && typeof failure === 'object' ? (failure as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      job_type: typeof item.job_type === 'string' ? item.job_type : 'unknown',
      target: typeof item.target === 'string' ? item.target : '',
      error_message: typeof item.error_message === 'string' ? item.error_message : '',
      status: typeof item.status === 'string' ? item.status : 'failed',
      retry_count: typeof item.retry_count === 'number' ? item.retry_count : 0,
      created_at: typeof item.created_at === 'string' ? item.created_at : '',
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : '',
    };
  });
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function DevOpsRetryCenterPage() {
  const apiUrl = useApiUrl();
  const [failures, setFailures] = useState<FailureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/retry-center`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to load retry center'));
      }
      setFailures(normalizeFailures(data.failures));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load retry center');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  const retry = async (id: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setRetryingId(id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/retry-center/${id}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok && data.error) {
        throw new Error(getString(data.error, 'Retry failed'));
      }
      const failureRecord = asRecord(data.failure);
      setNotice(failureRecord.status === 'resolved' ? 'Delivery retried successfully.' : 'Retry attempted.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Retry Center - OpsTrellis</title>
      </Head>
      <div className="alert-page">
        <header className="work-page__head">
          <div>
            <h1>Delivery retries</h1>
            <p>Failed alert and webhook deliveries. Retry one when the destination is ready again.</p>
          </div>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <div className="changes-facts">
          <div><span>Waiting</span><strong>{loading ? '—' : failures.length}</strong></div>
          <div><span>Retrying now</span><strong>{retryingId ? '1' : '0'}</strong></div>
        </div>

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <h2 className="portal-surface__title">Queue</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading failed deliveries...</div>
          ) : failures.length === 0 ? (
            <div className="empty-state">No delivery failures recorded.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Retries</th>
                    <th>Last error</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((failure) => (
                    <tr key={failure.id}>
                      <td>{failure.job_type}</td>
                      <td>{failure.target || 'n/a'}</td>
                      <td>{failure.status}</td>
                      <td>{failure.retry_count}</td>
                      <td>{failure.error_message}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={retryingId === failure.id}
                          onClick={() => void retry(failure.id)}
                        >
                          {retryingId === failure.id ? 'Retrying...' : 'Retry'}
                        </button>
                      </td>
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
