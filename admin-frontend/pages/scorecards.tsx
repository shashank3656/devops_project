import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface DoraMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  band: string;
}

interface Scorecard {
  service: string;
  environment?: string;
  team?: string;
  score: number;
  open_incidents: number;
  last_change?: string;
  slo_burned?: boolean;
  drift?: { drifted?: boolean; detail?: string };
  dora?: DoraMetric[];
}

export default function AdminScorecardsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Scorecard[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/scorecards`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load scorecards');
        setItems(Array.isArray(data.scorecards) ? data.scorecards : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load scorecards'))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <AdminLayout>
      <Head><title>Scorecards - {ADMIN_SITE_NAME}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Services</span>
            <h1 className="portal-page__title">Scorecards</h1>
            <p className="portal-page__subtitle">Read-only owner, SLO, incidents, last CHG, live-vs-CHG drift, and DORA for catalog services.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading…</div> : null}
        {items.length > 0 ? (
          <section className="portal-surface">
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Score</th>
                  <th>Incidents</th>
                  <th>DORA</th>
                  <th>Last change</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.service}-${item.environment || ''}`}>
                    <td>
                      <strong>{item.service}</strong>
                      <div className="portal-surface__subtitle">{item.team || item.environment || '—'}</div>
                    </td>
                    <td>{item.score}</td>
                    <td>{item.open_incidents}</td>
                    <td>
                      {(item.dora || []).filter((metric) => metric.key === 'change_failure_rate').map((metric) => (
                        <span key={metric.key}>{metric.value}% ({metric.band})</span>
                      ))}
                    </td>
                    <td>
                      {item.last_change || 'no CHG'}{item.slo_burned ? ' · SLO burning' : ''}
                      {item.drift?.drifted ? <div className="portal-surface__subtitle">{item.drift.detail || 'Live image drifted from last CHG'}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : !loading ? <div className="empty-state">No services in the catalog.</div> : null}
      </div>
    </AdminLayout>
  );
}
