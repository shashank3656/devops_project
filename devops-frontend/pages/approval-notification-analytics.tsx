import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface OpsAnalyticsSummary {
  active_approvals: number;
  expired_approvals: number;
  revoked_approvals: number;
  approvals_expiring_24h: number;
  notifications_last_7_days: number;
  notifications_last_30_days: number;
  blocked_promotion_alerts: number;
  expiry_tracker_alerts: number;
  gate_approval_expiring_alerts: number;
}

interface OpsAnalyticsTrendPoint {
  label: string;
  approval_count: number;
  notification_count: number;
  blocked_alert_count: number;
  expiry_alert_count: number;
}

interface OpsAnalyticsCount {
  key: string;
  label: string;
  count: number;
}

interface OpsAnalyticsRecentEvent {
  id: number;
  event_key: string;
  category: string;
  target: string;
  created_at: string;
}

interface NotificationSettingsSnapshot {
  in_app_enabled: boolean;
  email_enabled: boolean;
  slack_enabled: boolean;
  slack_configured: boolean;
  teams_enabled: boolean;
  teams_configured: boolean;
  webhook_enabled: boolean;
  webhook_configured: boolean;
  notify_expiring_assets: boolean;
  notify_blocked_promotions: boolean;
  notify_gate_approval_expiring: boolean;
}

interface OpsAnalyticsPayload {
  summary: OpsAnalyticsSummary;
  approval_trend: OpsAnalyticsTrendPoint[];
  notification_trend: OpsAnalyticsTrendPoint[];
  approvals_by_environment: OpsAnalyticsCount[];
  approvals_by_approver: OpsAnalyticsCount[];
  notifications_by_type: OpsAnalyticsCount[];
  recent_events: OpsAnalyticsRecentEvent[];
  settings: NotificationSettingsSnapshot;
}

const EMPTY_SUMMARY: OpsAnalyticsSummary = {
  active_approvals: 0,
  expired_approvals: 0,
  revoked_approvals: 0,
  approvals_expiring_24h: 0,
  notifications_last_7_days: 0,
  notifications_last_30_days: 0,
  blocked_promotion_alerts: 0,
  expiry_tracker_alerts: 0,
  gate_approval_expiring_alerts: 0,
};

function formatDateTime(value?: string): string {
  return formatOperationalTime(value);
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function AnalyticsBarList({
  title,
  eyebrow,
  items,
}: {
  title: string;
  eyebrow: string;
  items: OpsAnalyticsCount[];
}) {
  const maxCount = useMemo(() => {
    return items.reduce((highest, item) => (item.count > highest ? item.count : highest), 0);
  }, [items]);

  return (
    <section className="portal-surface">
      <div className="portal-surface__header">
        <div>
          <span className="portal-surface__eyebrow">{eyebrow}</span>
          <h2 className="portal-surface__title">{title}</h2>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">Nothing recorded yet.</div>
      ) : (
        <div className="alert-bars">
          {items.map((item) => {
            const width = maxCount > 0 ? `${Math.max(8, Math.round((item.count / maxCount) * 100))}%` : '8%';
            return (
              <article key={`${eyebrow}-${item.key}`}>
                <div>
                  <strong>{toTitleCase(item.label || item.key)}</strong>
                  <span className="portal-pill">{item.count}</span>
                </div>
                <div className="alert-meter"><span style={{ width }} /></div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ApprovalNotificationAnalyticsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [analytics, setAnalytics] = useState<OpsAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      localStorage.removeItem(DEVOPS_USER_KEY);
      router.replace('/login');
      return;
    }

    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/devops/approval-notification-analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem(DEVOPS_TOKEN_KEY);
          localStorage.removeItem(DEVOPS_USER_KEY);
          router.replace('/login');
          return null;
        }
        const payload = asRecord(await response.json().catch(() => ({})));
        if (!response.ok) {
          throw new Error(getString(payload.error, 'Failed to load approval analytics'));
        }
        return payload;
      })
      .then((payload) => {
        if (!payload) return;
        const nextAnalytics = payload.analytics && typeof payload.analytics === 'object'
          ? (payload.analytics as OpsAnalyticsPayload)
          : null;
        setAnalytics(nextAnalytics);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load approval analytics');
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const summary = analytics?.summary || EMPTY_SUMMARY;

  return (
    <DevOpsLayout>
      <Head>
        <title>Approval & Notification Analytics - OpsTrellis</title>
      </Head>
      <div className="alert-page">
        <header className="work-page__head">
          <div>
            <h1>Alert analytics</h1>
            <p>Approvals, alert volume, and whether each channel is turned on.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/notification-settings" className="btn btn-secondary">Settings</Link>
            <Link href="/retry-center" className="btn btn-secondary">Retries</Link>
          </div>
        </header>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading analytics...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && analytics ? (
          <>
            <div className="changes-facts">
              <div><span>Active approvals</span><strong>{summary.active_approvals}</strong></div>
              <div><span>Expiring in 24h</span><strong>{summary.approvals_expiring_24h}</strong></div>
              <div><span>Alerts, 7 days</span><strong>{summary.notifications_last_7_days}</strong></div>
              <div><span>Alerts, 30 days</span><strong>{summary.notifications_last_30_days}</strong></div>
              <div><span>Blocked</span><strong>{summary.blocked_promotion_alerts}</strong></div>
              <div><span>Expiry</span><strong>{summary.expiry_tracker_alerts}</strong></div>
            </div>

            <div className="changes-facts">
              <div><span>In app</span><strong>{analytics.settings.in_app_enabled ? 'On' : 'Off'}</strong></div>
              <div><span>Email</span><strong>{analytics.settings.email_enabled ? 'On' : 'Off'}</strong></div>
              <div><span>Slack</span><strong>{analytics.settings.slack_configured ? 'Connected' : 'Not set'}</strong></div>
              <div><span>Teams</span><strong>{analytics.settings.teams_configured ? 'Connected' : 'Not set'}</strong></div>
              <div><span>Webhook</span><strong>{analytics.settings.webhook_configured ? 'Connected' : 'Not set'}</strong></div>
            </div>

            <div className="alert-trends">
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <h2 className="portal-surface__title">Approvals, 14 days</h2>
                </div>
                <div className="alert-trend">
                  {analytics.approval_trend.map((point) => (
                    <article key={`approval-trend-${point.label}`}>
                      <div className="alert-trend__meta">
                        <span>{point.label}</span>
                        <span className="portal-pill">{point.approval_count}</span>
                      </div>
                      <div className="alert-meter"><span style={{ width: `${Math.min(100, Math.max(point.approval_count > 0 ? 18 : 0, point.approval_count * 12))}%` }} /></div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <h2 className="portal-surface__title">Alerts, 14 days</h2>
                </div>
                <div className="alert-trend">
                  {analytics.notification_trend.map((point) => (
                    <article key={`notification-trend-${point.label}`}>
                      <div className="alert-trend__meta">
                        <span>{point.label}</span>
                        <span className="portal-pill">{point.notification_count} · blocked {point.blocked_alert_count}</span>
                      </div>
                      <div className="alert-meter alert-meter--warm"><span style={{ width: `${Math.min(100, Math.max(point.notification_count > 0 ? 18 : 0, point.notification_count * 10))}%` }} /></div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <div className="alert-trends alert-trends--three">
              <AnalyticsBarList title="By environment" eyebrow="Approvals" items={analytics.approvals_by_environment} />
              <AnalyticsBarList title="By approver" eyebrow="Approvals" items={analytics.approvals_by_approver} />
              <AnalyticsBarList title="By type" eyebrow="Alerts" items={analytics.notifications_by_type} />
            </div>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <h2 className="portal-surface__title">Latest events</h2>
              </div>
              {analytics.recent_events.length === 0 ? (
                <div className="empty-state">No alert events yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Category</th>
                        <th>Target</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.recent_events.map((event) => (
                        <tr key={`recent-event-${event.id}`}>
                          <td><strong>{event.event_key || `event-${event.id}`}</strong></td>
                          <td>{toTitleCase(event.category)}</td>
                          <td>{event.target || '—'}</td>
                          <td>{formatDateTime(event.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
