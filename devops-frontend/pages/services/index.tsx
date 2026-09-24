import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ServiceRow {
  id: number;
  service: string;
  repo: string;
  environment: string;
  grafana_uid?: string;
  team?: string;
  project_name?: string;
}

export default function ServiceMapPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ServiceRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/services`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load services');
          return;
        }
        setItems(Array.isArray(data.services) ? data.services : []);
      })
      .catch(() => setError('Failed to load services'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Services - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Changes</span>
            <h1 className="portal-page__title">Services</h1>
            <p className="portal-page__subtitle">
              Catalog of services used on change requests. Add a service here and it appears in the Change request dropdown.
            </p>
          </div>
          <Link href="/services/new" className="btn btn-primary">
            Add service
          </Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading services...</div> : null}
          {!loading && !items.length ? <div className="empty-state">No services yet. Add one so change requests can pick it from the dropdown.</div> : null}
          {items.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Repo</th>
                  <th>Env</th>
                  <th>Team</th>
                  <th>Grafana</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/services/${item.id}`)}>
                    <td>
                      <strong>{item.service}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_name || '—'}</div>
                    </td>
                    <td>{item.repo || '—'}</td>
                    <td>{item.environment || 'all'}</td>
                    <td>{item.team || '—'}</td>
                    <td>{item.grafana_uid || '—'}</td>
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
