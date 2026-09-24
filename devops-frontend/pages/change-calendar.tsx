import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface CalendarItem {
  request_id?: number;
  change_id?: number;
  project_name?: string;
  service: string;
  environment: string;
  status: string;
  change_type: string;
  risk_level: string;
  summary: string;
  calendar_date: string;
}

interface CalendarPayload {
  summary?: { upcoming_count?: number; overdue_count?: number };
  items?: CalendarItem[];
}

export default function ChangeCalendarPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/change-calendar`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load calendar');
          return;
        }
        setPayload(data);
      })
      .catch(() => setError('Failed to load calendar'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Change calendar - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">CAB</span>
            <h1 className="portal-page__title">Change calendar</h1>
            <p className="portal-page__subtitle">
              Infra windows plus normal production changes waiting for CAB. Emergency changes skip this queue.
            </p>
          </div>
          <Link href="/changes" className="btn btn-secondary">Open changes</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="k8s-summary-strip">
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Upcoming</span>
            <strong className="k8s-summary-card__value">{payload?.summary?.upcoming_count ?? 0}</strong>
          </div>
          <div className="k8s-summary-card">
            <span className="k8s-summary-card__label">Overdue</span>
            <strong className="k8s-summary-card__value">{payload?.summary?.overdue_count ?? 0}</strong>
          </div>
        </section>
        <section className="portal-surface">
          {loading ? <div className="empty-state">Loading calendar...</div> : null}
          {!loading && !payload?.items?.length ? <div className="empty-state">No CAB windows in the next three weeks.</div> : null}
          {payload?.items?.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Service</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((item, index) => (
                  <tr
                    key={`${item.calendar_date}-${item.service}-${index}`}
                    style={item.change_id ? { cursor: 'pointer' } : undefined}
                    onClick={() => {
                      if (item.change_id) void router.push(`/changes/${item.change_id}`);
                    }}
                  >
                    <td>{item.calendar_date}</td>
                    <td>{item.change_type}</td>
                    <td>{item.service} · {item.environment}</td>
                    <td>{item.summary}</td>
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
