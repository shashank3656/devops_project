import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface PromotionItem {
  request_id: number;
  project_name?: string;
  project_code?: string;
  team: string;
  environment: string;
  next_environment: string;
  cloud: string;
  service: string;
  status: string;
  client_name: string;
  latest_promoted_id?: number | null;
  latest_promoted_env?: string;
  latest_promoted_status?: string;
}

function normalizePromotions(value: unknown): PromotionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    request_id: typeof item?.request_id === 'number' ? item.request_id : 0,
    project_name: typeof item?.project_name === 'string' ? item.project_name : '',
    project_code: typeof item?.project_code === 'string' ? item.project_code : '',
    team: typeof item?.team === 'string' ? item.team : '',
    environment: typeof item?.environment === 'string' ? item.environment : '',
    next_environment: typeof item?.next_environment === 'string' ? item.next_environment : '',
    cloud: typeof item?.cloud === 'string' ? item.cloud : '',
    service: typeof item?.service === 'string' ? item.service : '',
    status: typeof item?.status === 'string' ? item.status : '',
    client_name: typeof item?.client_name === 'string' ? item.client_name : '',
    latest_promoted_id: typeof item?.latest_promoted_id === 'number' ? item.latest_promoted_id : null,
    latest_promoted_env: typeof item?.latest_promoted_env === 'string' ? item.latest_promoted_env : '',
    latest_promoted_status: typeof item?.latest_promoted_status === 'string' ? item.latest_promoted_status : '',
  }));
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

export default function DevOpsPromotionsPage() {
  const apiUrl = useApiUrl();
  const [items, setItems] = useState<PromotionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [promotingId, setPromotingId] = useState<number | null>(null);
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
      const response = await fetch(`${apiUrl}/api/devops/promotions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load promotion flow');
      }
      setItems(normalizePromotions(data?.promotions));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load promotion flow');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  const promote = async (requestId: number) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setPromotingId(requestId);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/promotions/${requestId}/promote`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to promote request');
      }
      setNotice(`Created draft request #${data?.request?.id || ''} for the next environment.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote request');
    } finally {
      setPromotingId(null);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Promotion Center - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Lifecycle</span>
            <h1 className="portal-page__title">Environment Promotion Flow</h1>
            <p className="portal-page__subtitle">
              Promote delivered requests from lower environments into the next stage while preserving request lineage and audit history.
            </p>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Promotion Queue</span>
              <h2 className="portal-surface__title">Promotable requests</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading promotion candidates...</div>
          ) : items.length === 0 ? (
            <div className="empty-state">No promotable requests available.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Project</th>
                    <th>Flow</th>
                    <th>Status</th>
                    <th>Latest promotion</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.request_id}>
                      <td>#{item.request_id} · {item.client_name}</td>
                      <td>{item.project_name ? `${item.project_name} (${item.project_code})` : 'No project'}</td>
                      <td>{item.environment} → {item.next_environment || 'n/a'} · {item.cloud}/{item.service}</td>
                      <td>{item.status}</td>
                      <td>
                        {item.latest_promoted_id
                          ? `#${item.latest_promoted_id} (${item.latest_promoted_env} · ${item.latest_promoted_status})`
                          : 'No downstream promotion yet'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={promotingId === item.request_id || !item.next_environment}
                          onClick={() => void promote(item.request_id)}
                        >
                          {promotingId === item.request_id ? 'Promoting...' : 'Promote'}
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
