import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ServiceDetail {
  id: number;
  service: string;
  repo: string;
  environment: string;
  grafana_uid?: string;
  promql?: string;
  dashboard_url?: string;
  metrics_url?: string;
  team?: string;
  project_name?: string;
}

export default function ServiceDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ServiceDetail | null>(null);
  const [error, setError] = useState('');
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/services/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load service');
          return;
        }
        setItem(data.service || null);
      })
      .catch(() => setError('Failed to load service'));
  }, [apiUrl, id]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.service || 'Service'} - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Service map</span>
            <h1 className="portal-page__title">{item?.service || 'Service'}</h1>
          </div>
          <Link href="/services" className="btn btn-secondary">Back to catalog</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {item ? (
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">Repo<input className="input" readOnly value={item.repo || '—'} /></label>
              <label className="label">Environment<input className="input" readOnly value={item.environment || 'all'} /></label>
              <label className="label">Team<input className="input" readOnly value={item.team || '—'} /></label>
              <label className="label">Grafana UID<input className="input" readOnly value={item.grafana_uid || '—'} /></label>
              <label className="label">Project<input className="input" readOnly value={item.project_name || '—'} /></label>
            </div>
            {item.dashboard_url ? <p><a href={item.dashboard_url} target="_blank" rel="noreferrer">Open dashboard</a></p> : null}
            {item.metrics_url ? <p className="portal-surface__subtitle">Watcher pull: {item.metrics_url}</p> : null}
            {item.promql ? <pre className="portal-surface__subtitle">{item.promql}</pre> : null}
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
