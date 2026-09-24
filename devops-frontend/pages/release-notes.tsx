import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ReleaseItem {
  change_number: string;
  title: string;
  service: string;
  repo: string;
  sha: string;
  author?: string;
  pr_number?: number;
  environment: string;
}

interface ReleaseNotes {
  from: string;
  to: string;
  count: number;
  items: ReleaseItem[];
}

export default function ReleaseNotesPage() {
  const apiUrl = useApiUrl();
  const [payload, setPayload] = useState<ReleaseNotes | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/release-notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load release notes');
          return;
        }
        setPayload(data.release_notes || null);
      })
      .catch(() => setError('Failed to load release notes'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Release notes - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Changes</span>
            <h1 className="portal-page__title">Release notes</h1>
            <p className="portal-page__subtitle">Closed and implemented changes from the last seven days.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading release notes...</div> : null}
          {!loading && !payload?.items?.length ? <div className="empty-state">Nothing shipped in this window.</div> : null}
          {payload?.items?.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Service</th>
                  <th>SHA</th>
                  <th>Author</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((item) => (
                  <tr key={item.change_number}>
                    <td>
                      <strong>{item.change_number}</strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.title}</div>
                    </td>
                    <td>{item.service}</td>
                    <td>{item.sha.slice(0, 7)}</td>
                    <td>{item.author || '—'}</td>
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
