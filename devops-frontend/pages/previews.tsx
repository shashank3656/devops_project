import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface PreviewRow {
  id: number;
  repo: string;
  pr_number: number;
  branch?: string;
  url?: string;
  status: string;
  change_id?: number;
  change_number?: string;
  estimated_cost_usd?: number;
  updated_at: string;
}

export default function PreviewsCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<PreviewRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/previews`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load previews');
        setItems(Array.isArray(data.previews) ? data.previews : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load previews'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Preview environments - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Changes</span>
            <h1 className="portal-page__title">Preview environments</h1>
            <p className="portal-page__subtitle">
              Opening a PR on an onboarded repo starts a preview CHG. Merge or close tears it down and records estimated cost on the PR brief.
            </p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading previews…</div> : null}
        {!loading && items.length === 0 ? (
          <div className="empty-state">No preview environments yet. Open a PR against an onboarded repo.</div>
        ) : null}
        {items.length > 0 ? (
          <section className="portal-surface">
            <table className="table">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Repo</th>
                  <th>Status</th>
                  <th>Cost</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.pr_number}{item.branch ? ` · ${item.branch}` : ''}</td>
                    <td>{item.repo}</td>
                    <td>{item.status}</td>
                    <td>${(item.estimated_cost_usd || 0).toFixed(2)}</td>
                    <td>
                      {item.change_id ? (
                        <Link href={`/changes/${item.change_id}`}>{item.change_number || `CHG ${item.change_id}`}</Link>
                      ) : '—'}
                      {item.url ? (
                        <>
                          {' · '}
                          <a href={item.url} target="_blank" rel="noreferrer">Open</a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
