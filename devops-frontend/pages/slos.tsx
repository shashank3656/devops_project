import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@infragate/ui';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ServiceSLO {
  id: number;
  service: string;
  environment?: string;
  project_id?: number;
  latency_p95_ms?: number;
  error_ratio?: number;
  saturation?: number;
  window_days?: number;
  samples?: number;
  breaching?: number;
  budget_remaining?: number;
  burned?: boolean;
  freeze_reason?: string;
  freeze_on_budget?: boolean;
}

export default function ServiceSLOPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ServiceSLO[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    const projectId = typeof router.query.project_id === 'string' ? router.query.project_id : '';
    const environment = typeof router.query.environment === 'string' ? router.query.environment : '';
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (environment) params.set('environment', environment);
    const query = params.toString() ? `?${params}` : '';
    fetch(`${apiUrl}/api/devops/slos${query}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load SLOs');
        setItems(Array.isArray(data.slos) ? data.slos : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load SLOs'))
      .finally(() => setLoading(false));
  }, [apiUrl, router, router.query.environment, router.query.project_id]);

  const rows = useMemo(() => {
    const needle = typeof router.query.q === 'string' ? router.query.q.trim().toLowerCase() : '';
    if (!needle) return items;
    return items.filter((item) => (item.service || '').toLowerCase().includes(needle));
  }, [items, router.query.q]);

  return (
    <DevOpsLayout>
      <Head>
        <title>SLOs - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Service inventory</span>
            <h1 className="portal-page__title">Service SLOs</h1>
            <p className="portal-page__subtitle">
              Error, latency, and saturation budgets stored on the service. Missing samples stay Unknown, never healthy. A freeze is recorded here; it does not patch production.
            </p>
          </div>
          <Link href="/scorecards" className="btn btn-secondary">Open scorecards</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading SLOs...</div> : null}
          {!loading && !rows.length ? (
            <EmptyState
              title="No SLO objects yet"
              body="Define an SLO on a service. Until samples exist, budget remaining stays Unknown."
              action={<Link href="/services" className="btn btn-primary btn-sm">Open service inventory</Link>}
            />
          ) : null}
          {rows.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Window</th>
                  <th>Error budget</th>
                  <th>Latency p95</th>
                  <th>Samples</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        <Link href={`/services?q=${encodeURIComponent(item.service)}`}>{item.service || 'Unknown'}</Link>
                      </strong>
                      <div className="ig-cell-meta">{item.environment || 'Environment unknown'}</div>
                    </td>
                    <td>{item.window_days ? `${item.window_days}d` : 'Unknown'}</td>
                    <td>{typeof item.budget_remaining === 'number' && (item.samples || 0) > 0 ? item.budget_remaining.toFixed(3) : 'Unknown'}</td>
                    <td>{item.latency_p95_ms ? `${item.latency_p95_ms} ms` : 'Unknown'}</td>
                    <td>{item.samples || 0}</td>
                    <td>
                      {(item.samples || 0) <= 0
                        ? 'Unknown'
                        : item.burned
                          ? (item.freeze_reason || 'Burning')
                          : 'Inside budget'}
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
