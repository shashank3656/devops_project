import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
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
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
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
        <div className="empty-state">No data available yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((item) => {
            const width = maxCount > 0 ? `${Math.max(12, Math.round((item.count / maxCount) * 100))}%` : '12%';
            return (
              <article key={`${eyebrow}-${item.key}`} style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <strong>{toTitleCase(item.label || item.key)}</strong>
                  <span className="portal-pill">{item.count}</span>
                </div>
                <div style={{ height: 10, background: 'rgba(15, 23, 42, 0.08)', borderRadius: 999, overflow: 'hidden' }}>
                  <div
                    style={{
                      width,
                      height: '100%',
                      borderRadius: 999,
                      background: 'linear-gradient(90deg, rgba(14, 165, 233, 0.9), rgba(34, 197, 94, 0.85))',
                    }}
                  />
                </div>
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
        <title>Approval & Notification Analytics - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations Analytics</span>
            <h1 className="portal-page__title">Approval & notification analytics</h1>
            <p className="portal-page__subtitle">
              Track approval load, alert volume, reminder pressure, and delivery channel posture from one operational dashboard.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/notification-settings" className="btn btn-secondary">Notification Settings</Link>
            <Link href="/gate-approvals" className="btn btn-secondary">Gate Audit</Link>
            <Link href="/ops-command-center" className="btn btn-primary">Ops Command Center</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading approval and notification analytics...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && analytics ? (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Active approvals</span>
                <strong className="portal-stat-card__value">{summary.active_approvals}</strong>
                <p className="portal-stat-card__copy">Currently valid promotion gate approvals across all environments.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Approvals expiring soon</span>
                <strong className="portal-stat-card__value">{summary.approvals_expiring_24h}</strong>
                <p className="portal-stat-card__copy">Approvals that will expire in the next 24 hours and may block promotion flow.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Notifications this week</span>
                <strong className="portal-stat-card__value">{summary.notifications_last_7_days}</strong>
                <p className="portal-stat-card__copy">Ops notifications sent in the last 7 days across all configured channels.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Blocked promotion alerts</span>
                <strong className="portal-stat-card__value">{summary.blocked_promotion_alerts}</strong>
                <p className="portal-stat-card__copy">Notifications triggered because promotions were blocked by gate policy.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Expiry tracker alerts</span>
                <strong className="portal-stat-card__value">{summary.expiry_tracker_alerts}</strong>
                <p className="portal-stat-card__copy">Reminder traffic created by expiring secrets and certificates.</p>
              </article>
            </section>

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Approvals</span>
                    <h2 className="portal-surface__title">14-day approval trend</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {analytics.approval_trend.map((point) => (
                    <article key={`approval-trend-${point.label}`} style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <span>{point.label}</span>
                        <span className="portal-pill">{point.approval_count}</span>
                      </div>
                      <div style={{ height: 10, background: 'rgba(15, 23, 42, 0.08)', borderRadius: 999, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.max(point.approval_count > 0 ? point.approval_count * 12 : 12, 12)}%`,
                            maxWidth: '100%',
                            height: '100%',
                            background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.9), rgba(14, 165, 233, 0.9))',
                          }}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Notifications</span>
                    <h2 className="portal-surface__title">14-day notification trend</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {analytics.notification_trend.map((point) => (
                    <article key={`notification-trend-${point.label}`} style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <span>{point.label}</span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span className="portal-pill">Total {point.notification_count}</span>
                          <span className="portal-pill">Blocked {point.blocked_alert_count}</span>
                          <span className="portal-pill">Expiry {point.expiry_alert_count}</span>
                        </div>
                      </div>
                      <div style={{ height: 10, background: 'rgba(15, 23, 42, 0.08)', borderRadius: 999, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.max(point.notification_count > 0 ? point.notification_count * 10 : 12, 12)}%`,
                            maxWidth: '100%',
                            height: '100%',
                            background: 'linear-gradient(90deg, rgba(249, 115, 22, 0.9), rgba(239, 68, 68, 0.9))',
                          }}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              <AnalyticsBarList title="Approvals by environment" eyebrow="Breakdown" items={analytics.approvals_by_environment} />
              <AnalyticsBarList title="Approvals by approver" eyebrow="Breakdown" items={analytics.approvals_by_approver} />
              <AnalyticsBarList title="Notifications by type" eyebrow="Breakdown" items={analytics.notifications_by_type} />
            </div>

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Settings posture</span>
                    <h2 className="portal-surface__title">Current delivery configuration</h2>
                  </div>
                  <Link href="/notification-settings" className="btn btn-secondary btn-sm">Edit settings</Link>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="portal-pill">In-app: {analytics.settings.in_app_enabled ? 'enabled' : 'disabled'}</span>
                    <span className="portal-pill">Email: {analytics.settings.email_enabled ? 'enabled' : 'disabled'}</span>
                    <span className="portal-pill">Slack: {analytics.settings.slack_enabled ? 'enabled' : 'disabled'}</span>
                    <span className="portal-pill">Teams: {analytics.settings.teams_enabled ? 'enabled' : 'disabled'}</span>
                    <span className="portal-pill">Webhook: {analytics.settings.webhook_enabled ? 'enabled' : 'disabled'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="portal-pill">Blocked promotions: {analytics.settings.notify_blocked_promotions ? 'on' : 'off'}</span>
                    <span className="portal-pill">Expiring approvals: {analytics.settings.notify_gate_approval_expiring ? 'on' : 'off'}</span>
                    <span className="portal-pill">Expiring assets: {analytics.settings.notify_expiring_assets ? 'on' : 'off'}</span>
                  </div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                    Slack configured: {analytics.settings.slack_configured ? 'yes' : 'no'} · Teams configured: {analytics.settings.teams_configured ? 'yes' : 'no'} · Generic webhook configured: {analytics.settings.webhook_configured ? 'yes' : 'no'}
                  </div>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Recent activity</span>
                    <h2 className="portal-surface__title">Latest notification events</h2>
                  </div>
                </div>
                {analytics.recent_events.length === 0 ? (
                  <div className="empty-state">No notification events recorded yet.</div>
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
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
