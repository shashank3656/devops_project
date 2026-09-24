import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';

interface FeedEvent {
  pr_number: number;
  title: string;
  author?: string;
  risk_level: string;
  score: number;
  repo_owner?: string;
  repo_name?: string;
  pr_url?: string;
  merged_at?: string;
  request_id?: number;
  change_brief?: { headline?: string; risk_because?: string[]; changing?: { label: string; count: number }[] };
}

export default function AdminDeployIntelligencePage() {
  const router = useRouter();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
    }
  }, [token, router]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${apiUrl}/api/admin/deploy-intelligence/feed?limit=40`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data?.error || 'Failed to load deploy feed');
          return;
        }
        setEvents(Array.isArray(data?.events) ? data.events : []);
      })
      .catch(() => setError('Failed to load deploy feed'))
      .finally(() => setLoading(false));
  }, [apiUrl, token]);

  return (
    <>
      <Head>
        <title>Deploy intelligence - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Read only</span>
              <h1 className="portal-page__title">Deploy intelligence</h1>
              <p className="portal-page__subtitle">
                Recent production-branch merges analyzed by InfraGate. This feed is read-only — managers apply protection and acknowledge promotions in DevOps.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/requests" className="btn btn-secondary">
                Back to requests
              </Link>
            </div>
          </div>

          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="portal-surface">
            {loading ? <p className="portal-surface__subtitle">Loading merge feed…</p> : null}
            {!loading && events.length === 0 ? (
              <p className="portal-surface__subtitle">No stored merge analyses yet.</p>
            ) : null}
            {!loading && events.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Pull request</th>
                    <th>Changing</th>
                    <th>Risk because</th>
                    <th>Risk</th>
                    <th>Merged</th>
                    <th>Request</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={`${event.repo_owner}/${event.repo_name}#${event.pr_number}`}>
                      <td>
                        {event.repo_owner}/{event.repo_name}
                      </td>
                      <td>
                        {event.pr_url ? (
                          <a href={event.pr_url} target="_blank" rel="noopener noreferrer">
                            #{event.pr_number} {event.title}
                          </a>
                        ) : (
                          <>
                            #{event.pr_number} {event.title}
                          </>
                        )}
                      </td>
                      <td>{event.change_brief?.headline || event.title}</td>
                      <td>{event.change_brief?.risk_because?.[0] || '—'}</td>
                      <td>
                        {event.risk_level} · {event.score}
                      </td>
                      <td>{event.merged_at ? new Date(event.merged_at).toLocaleString() : '—'}</td>
                      <td>
                        {event.request_id ? (
                          <Link href={`/requests?id=${event.request_id}`}>#{event.request_id}</Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        </div>
      </AdminLayout>
    </>
  );
}
