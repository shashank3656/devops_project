import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface NotificationSettings {
  in_app_enabled: boolean;
  email_enabled: boolean;
  slack_enabled: boolean;
  slack_webhook_url?: string;
  slack_configured: boolean;
  slack_using_environment: boolean;
  teams_enabled: boolean;
  teams_webhook_url?: string;
  teams_configured: boolean;
  teams_using_environment: boolean;
  webhook_enabled: boolean;
  webhook_url?: string;
  webhook_configured: boolean;
  webhook_using_environment: boolean;
  notify_expiring_assets: boolean;
  notify_blocked_promotions: boolean;
  notify_gate_approval_expiring: boolean;
  updated_at?: string;
  updated_by_username?: string;
}

const defaultSettings: NotificationSettings = {
  in_app_enabled: true,
  email_enabled: true,
  slack_enabled: false,
  slack_webhook_url: '',
  slack_configured: false,
  slack_using_environment: false,
  teams_enabled: false,
  teams_webhook_url: '',
  teams_configured: false,
  teams_using_environment: false,
  webhook_enabled: false,
  webhook_url: '',
  webhook_configured: false,
  webhook_using_environment: false,
  notify_expiring_assets: true,
  notify_blocked_promotions: true,
  notify_gate_approval_expiring: true,
};

function formatDateTime(value?: string): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function NotificationSettingsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    router.replace('/login');
  };

  const loadSettings = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/notification-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load notification settings');
      }
      setSettings({ ...defaultSettings, ...(data?.settings || {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notification settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, [apiUrl]);

  const updateField = <K extends keyof NotificationSettings>(field: K, value: NotificationSettings[K]) => {
    setSettings((current) => ({ ...current, [field]: value }));
  };

  const saveSettings = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/notification-settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          in_app_enabled: settings.in_app_enabled,
          email_enabled: settings.email_enabled,
          slack_enabled: settings.slack_enabled,
          slack_webhook_url: settings.slack_webhook_url || '',
          teams_enabled: settings.teams_enabled,
          teams_webhook_url: settings.teams_webhook_url || '',
          webhook_enabled: settings.webhook_enabled,
          webhook_url: settings.webhook_url || '',
          notify_expiring_assets: settings.notify_expiring_assets,
          notify_blocked_promotions: settings.notify_blocked_promotions,
          notify_gate_approval_expiring: settings.notify_gate_approval_expiring,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to save notification settings');
      }
      setSettings({ ...defaultSettings, ...(data?.settings || {}) });
      setNotice('Notification settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save notification settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Notification Settings - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations Controls</span>
            <h1 className="portal-page__title">Notification Settings</h1>
            <p className="portal-page__subtitle">
              Manage how blocked promotions, approval-expiry reminders, and expiry tracker alerts are delivered without relying only on deployment environment variables.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/approval-notification-analytics" className="btn btn-secondary">Ops Analytics</Link>
            <button type="button" className="btn btn-primary" onClick={() => void saveSettings()} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {loading ? <div className="portal-surface"><div className="empty-state">Loading notification settings...</div></div> : null}

        {!loading ? (
          <>
            <section className="portal-stat-grid" style={{ marginBottom: 24 }}>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Slack</span>
                <strong className="portal-stat-card__value">{settings.slack_enabled ? 'On' : 'Off'}</strong>
                <p className="portal-stat-card__copy">
                  {settings.slack_configured ? (settings.slack_using_environment ? 'Using environment fallback' : 'Using saved webhook') : 'No webhook configured'}
                </p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Teams</span>
                <strong className="portal-stat-card__value">{settings.teams_enabled ? 'On' : 'Off'}</strong>
                <p className="portal-stat-card__copy">
                  {settings.teams_configured ? (settings.teams_using_environment ? 'Using environment fallback' : 'Using saved webhook') : 'No webhook configured'}
                </p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Generic webhook</span>
                <strong className="portal-stat-card__value">{settings.webhook_enabled ? 'On' : 'Off'}</strong>
                <p className="portal-stat-card__copy">
                  {settings.webhook_configured ? (settings.webhook_using_environment ? 'Using environment fallback' : 'Using saved webhook') : 'No webhook configured'}
                </p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Updated</span>
                <strong className="portal-stat-card__value">{settings.updated_by_username || 'Default'}</strong>
                <p className="portal-stat-card__copy">{formatDateTime(settings.updated_at)}</p>
              </article>
            </section>

            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Delivery channels</span>
                  <h2 className="portal-surface__title">Choose how ops alerts are delivered</h2>
                </div>
              </div>
              <div className="portal-form-grid">
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.in_app_enabled} onChange={(event) => updateField('in_app_enabled', event.target.checked)} />
                    In-app notifications
                  </span>
                </label>
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.email_enabled} onChange={(event) => updateField('email_enabled', event.target.checked)} />
                    Email notifications
                  </span>
                </label>
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.slack_enabled} onChange={(event) => updateField('slack_enabled', event.target.checked)} />
                    Slack webhook
                  </span>
                  <input className="input" value={settings.slack_webhook_url || ''} onChange={(event) => updateField('slack_webhook_url', event.target.value)} placeholder={settings.slack_using_environment ? 'Using environment fallback' : 'https://hooks.slack.com/services/...'} />
                </label>
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.teams_enabled} onChange={(event) => updateField('teams_enabled', event.target.checked)} />
                    Teams webhook
                  </span>
                  <input className="input" value={settings.teams_webhook_url || ''} onChange={(event) => updateField('teams_webhook_url', event.target.value)} placeholder={settings.teams_using_environment ? 'Using environment fallback' : 'https://outlook.office.com/webhook/...'} />
                </label>
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.webhook_enabled} onChange={(event) => updateField('webhook_enabled', event.target.checked)} />
                    Generic webhook
                  </span>
                  <input className="input" value={settings.webhook_url || ''} onChange={(event) => updateField('webhook_url', event.target.value)} placeholder={settings.webhook_using_environment ? 'Using environment fallback' : 'https://example.com/hooks/ops'} />
                </label>
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Alert categories</span>
                  <h2 className="portal-surface__title">Control which ops events generate alerts</h2>
                </div>
              </div>
              <div className="portal-form-grid">
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.notify_blocked_promotions} onChange={(event) => updateField('notify_blocked_promotions', event.target.checked)} />
                    Blocked promotions
                  </span>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Notify when a promotion candidate is blocked by gate policy.</div>
                </label>
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.notify_gate_approval_expiring} onChange={(event) => updateField('notify_gate_approval_expiring', event.target.checked)} />
                    Gate approvals nearing expiry
                  </span>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Alert before a persisted gate approval lapses.</div>
                </label>
                <label className="label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={settings.notify_expiring_assets} onChange={(event) => updateField('notify_expiring_assets', event.target.checked)} />
                    Expiring secrets and certificates
                  </span>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Alert owners and managers when credentials move into an actionable window.</div>
                </label>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
