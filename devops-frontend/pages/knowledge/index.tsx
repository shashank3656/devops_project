import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface KnowledgeRow {
  id: number;
  article_number: string;
  title: string;
  problem_number?: string;
  created_at?: string;
}

export default function KnowledgeIndexPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [items, setItems] = useState<KnowledgeRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/knowledge`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load knowledge');
          return;
        }
        setItems(Array.isArray(data.articles) ? data.articles : []);
      })
      .catch(() => setError('Failed to load knowledge'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Knowledge - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Problems</span>
            <h1 className="portal-page__title">Knowledge</h1>
            <p className="portal-page__subtitle">Articles published from known-error problems, including the workaround and root cause.</p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading knowledge...</div> : null}
          {!loading && !items.length ? <div className="empty-state">No knowledge articles yet. Publish one from a known-error problem.</div> : null}
          {items.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Title</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/knowledge/${item.id}`)}>
                    <td><strong>{item.article_number}</strong></td>
                    <td>{item.title}</td>
                    <td>{item.problem_number || '—'}</td>
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
