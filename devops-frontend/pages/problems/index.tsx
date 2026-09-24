import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ProblemRow {
  id: number;
  problem_number: string;
  fingerprint: string;
  service: string;
  environment: string;
  summary: string;
  status: string;
  occurrence_count: number;
}

export default function ProblemsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<ProblemRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/problems`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load problems');
          return;
        }
        setItems(Array.isArray(data.problems) ? data.problems : []);
      })
      .catch(() => setError('Failed to load problems'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Problems - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Incidents</span>
            <h1 className="portal-page__title">Problems</h1>
            <p className="portal-page__subtitle">The same alert fingerprint three times in 14 days becomes a problem for RCA, not more tickets.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading problems...</div> : null}
          {!loading && !items.length ? <div className="empty-state">No recurring problems yet.</div> : null}
          {items.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Service</th>
                  <th>Count</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/problems/${item.id}`)}>
                    <td>
                      <strong>{item.problem_number}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.fingerprint}</div>
                    </td>
                    <td>{item.service || item.environment || '—'}</td>
                    <td>{item.occurrence_count}</td>
                    <td>{item.status}</td>
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
