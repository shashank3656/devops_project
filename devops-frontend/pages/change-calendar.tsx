import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ChangeCalendarItem {
  request_id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  environment: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  due_date: string;
  window_start: string;
  window_end: string;
  calendar_date: string;
  change_type: string;
  risk_level: string;
  summary: string;
}

interface ChangeCalendarResponse {
  summary: {
    upcoming_count: number;
    overdue_count: number;
    production_watch_count: number;
    in_progress_count: number;
  };
  items: ChangeCalendarItem[];
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export default function DevOpsChangeCalendarPage() {
  const apiUrl = useApiUrl();
  const [calendar, setCalendar] = useState<ChangeCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    window.location.assign('/login');
  };

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    fetch(`${apiUrl}/api/devops/change-calendar`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        const payload = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(payload.error, 'Failed to load change calendar'));
        }
        return payload;
      })
      .then((payload) => {
        if (payload.summary && Array.isArray(payload.items)) {
          setCalendar({
            summary: payload.summary as ChangeCalendarResponse['summary'],
            items: payload.items as ChangeCalendarItem[],
          });
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, ChangeCalendarItem[]> = {};
    for (const item of calendar?.items || []) {
      if (!groups[item.calendar_date]) groups[item.calendar_date] = [];
      groups[item.calendar_date].push(item);
    }
    return Object.entries(groups).sort(([left], [right]) => left.localeCompare(right));
  }, [calendar]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Change Calendar - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Delivery windows</span>
            <h1 className="portal-page__title">Change Calendar</h1>
            <p className="portal-page__subtitle">Upcoming and overdue request windows, with production and in-flight changes surfaced first.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">Projects</Link>
            <Link href="/tickets" className="btn btn-primary">Open tickets</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading change calendar...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && calendar ? (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Upcoming windows</span>
                <span className="portal-stat-card__value">{calendar.summary.upcoming_count}</span>
                <p className="portal-stat-card__copy">Changes planned in the upcoming calendar range.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Overdue windows</span>
                <span className="portal-stat-card__value">{calendar.summary.overdue_count}</span>
                <p className="portal-stat-card__copy">Requests whose expected change window has already passed.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Production watch</span>
                <span className="portal-stat-card__value">{calendar.summary.production_watch_count}</span>
                <p className="portal-stat-card__copy">Production-facing changes needing extra visibility.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">In progress</span>
                <span className="portal-stat-card__value">{calendar.summary.in_progress_count}</span>
                <p className="portal-stat-card__copy">Changes already moving inside an active delivery window.</p>
              </article>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Calendar view</span>
                  <h2 className="portal-surface__title">Upcoming change windows</h2>
                </div>
              </div>
              {groupedItems.length === 0 ? (
                <div className="empty-state">No change windows are scheduled in the current range.</div>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {groupedItems.map(([day, items]) => (
                    <div key={day} className="portal-surface" style={{ padding: 16 }}>
                      <div style={{ marginBottom: 12 }}>
                        <strong>{day}</strong>
                      </div>
                      <div style={{ display: 'grid', gap: 12 }}>
                        {items.map((item) => (
                          <div key={`${item.calendar_date}-${item.request_id}`} style={{ border: '1px solid var(--color-border-strong)', borderRadius: 14, padding: 14 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                              <div>
                                <strong>#{item.request_id} {item.project_name || 'Unassigned project'}</strong>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                                  {item.project_code || 'no-code'} · {item.environment} · {item.cloud} · {item.service}
                                </div>
                              </div>
                              <span className="portal-pill">{item.change_type}</span>
                            </div>
                            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{item.summary}</p>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                              <span className="portal-pill">Window: {formatDateTime(item.window_start)} - {formatDateTime(item.window_end)}</span>
                              <span className="portal-pill">Due: {formatDateTime(item.due_date)}</span>
                              <span className="portal-pill">Risk: {item.risk_level}</span>
                              <span className="portal-pill">Status: {item.status}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                              <Link href={`/tickets?id=${item.request_id}`} className="btn btn-secondary btn-sm">Open ticket</Link>
                              {item.project_id ? <Link href={`/projects/${item.project_id}`} className="btn btn-secondary btn-sm">Open project</Link> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
