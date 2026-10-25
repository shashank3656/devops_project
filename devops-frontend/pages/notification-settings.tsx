import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

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
  notify_handovers: boolean;
  notify_blocked_promotions: boolean;
  notify_gate_approval_expiring: boolean;
  notify_cost: boolean;
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
  notify_handovers: true,
  notify_blocked_promotions: true,
  notify_gate_approval_expiring: true,
  notify_cost: true,
};

function formatDateTime(value?: string): string {
  return formatOperationalTime(value, 'Never');
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
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to load notification settings'));
      }
      setSettings({ ...defaultSettings, ...asRecord(payload.settings) } as NotificationSettings);
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
          notify_handovers: settings.notify_handovers,
          notify_blocked_promotions: settings.notify_blocked_promotions,
          notify_gate_approval_expiring: settings.notify_gate_approval_expiring,
          notify_cost: settings.notify_cost,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(payload.error, 'Failed to save notification settings'));
      }
      setSettings({ ...defaultSettings, ...asRecord(payload.settings) } as NotificationSettings);
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
        <title>Notification Settings - OpsTrellis</title>
      </Head>
      <div className="alert-page">
        <header className="work-page__head">
          <div>
            <h1>Alert settings</h1>
            <p>Choose where alerts go, and which events create one.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/approval-notification-analytics" className="btn btn-secondary">Analytics</Link>
            <button type="button" className="btn btn-primary" onClick={() => void saveSettings()} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <div className="changes-facts">
          <div><span>In app</span><strong>{settings.in_app_enabled ? 'On' : 'Off'}</strong></div>
          <div><span>Email</span><strong>{settings.email_enabled ? 'On' : 'Off'}</strong></div>
          <div><span>Slack</span><strong>{settings.slack_configured ? 'Connected' : 'Not set'}</strong></div>
          <div><span>Teams</span><strong>{settings.teams_configured ? 'Connected' : 'Not set'}</strong></div>
          <div><span>Webhook</span><strong>{settings.webhook_configured ? 'Connected' : 'Not set'}</strong></div>
          <div><span>Updated</span><strong>{formatDateTime(settings.updated_at)}</strong></div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading alert settings...</div></div> : (
          <div className="alert-board">
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Delivery</h2>
                  <p className="portal-surface__subtitle">Turn a channel on, then paste its address. Saved addresses stay on the server.</p>
                </div>
              </div>
              <div className="alert-channels">
                <label className="alert-channel">
                  <span className="alert-switch">In app<input type="checkbox" checked={settings.in_app_enabled} onChange={(event) => updateField('in_app_enabled', event.target.checked)} /></span>
                  <p className="alert-hint">Show the alert inside the portal.</p>
                </label>
                <label className="alert-channel">
                  <span className="alert-switch">Email<input type="checkbox" checked={settings.email_enabled} onChange={(event) => updateField('email_enabled', event.target.checked)} /></span>
                  <p className="alert-hint">Send to the people already on the ticket.</p>
                </label>
                <label className="alert-channel">
                  <span className="alert-switch">Slack<input type="checkbox" checked={settings.slack_enabled} onChange={(event) => updateField('slack_enabled', event.target.checked)} /></span>
                  <input className="input" type="password" autoComplete="off" value={settings.slack_webhook_url || ''} onChange={(event) => updateField('slack_webhook_url', event.target.value)} placeholder={settings.slack_using_environment ? 'Using the server setting' : 'Slack webhook address'} />
                </label>
                <label className="alert-channel">
                  <span className="alert-switch">Teams<input type="checkbox" checked={settings.teams_enabled} onChange={(event) => updateField('teams_enabled', event.target.checked)} /></span>
                  <input className="input" type="password" autoComplete="off" value={settings.teams_webhook_url || ''} onChange={(event) => updateField('teams_webhook_url', event.target.value)} placeholder={settings.teams_using_environment ? 'Using the server setting' : 'Teams webhook address'} />
                </label>
                <label className="alert-channel alert-channel--wide">
                  <span className="alert-switch">Generic webhook<input type="checkbox" checked={settings.webhook_enabled} onChange={(event) => updateField('webhook_enabled', event.target.checked)} /></span>
                  <input className="input" type="password" autoComplete="off" value={settings.webhook_url || ''} onChange={(event) => updateField('webhook_url', event.target.value)} placeholder={settings.webhook_using_environment ? 'Using the server setting' : 'Webhook address'} />
                </label>
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">What raises an alert</h2>
                </div>
              </div>
              <div className="alert-channels alert-channels--stack">
                <label className="alert-switch-row">
                  <span className="alert-switch">Blocked promotions<input type="checkbox" checked={settings.notify_blocked_promotions} onChange={(event) => updateField('notify_blocked_promotions', event.target.checked)} /></span>
                  <p className="alert-hint">When a promotion is stopped by a gate.</p>
                </label>
                <label className="alert-switch-row">
                  <span className="alert-switch">Approvals about to expire<input type="checkbox" checked={settings.notify_gate_approval_expiring} onChange={(event) => updateField('notify_gate_approval_expiring', event.target.checked)} /></span>
                  <p className="alert-hint">Before a saved approval runs out.</p>
                </label>
                <label className="alert-switch-row">
                  <span className="alert-switch">Expiring certificates<input type="checkbox" checked={settings.notify_expiring_assets} onChange={(event) => updateField('notify_expiring_assets', event.target.checked)} /></span>
                  <p className="alert-hint">Owner emails at 30, 14, 7, 3, and 1 days before expiry, then once when it expires. Auto-renew is not proof. Secret values are never included.</p>
                </label>
                <label className="alert-switch-row">
                  <span className="alert-switch">On-call handovers<input type="checkbox" checked={settings.notify_handovers} onChange={(event) => updateField('notify_handovers', event.target.checked)} /></span>
                  <p className="alert-hint">When a handover is submitted, acknowledged, revised, or overdue. Incident reassignment is a separate choice on acknowledgement.</p>
                </label>
                <label className="alert-switch-row">
                  <span className="alert-switch">Cost anomalies and budgets<input type="checkbox" checked={settings.notify_cost} onChange={(event) => updateField('notify_cost', event.target.checked)} /></span>
                  <p className="alert-hint">When a like-for-like cost anomaly or budget threshold is detected. Budgets never stop workloads. Secret values are never included.</p>
                </label>
              </div>
            </section>
          </div>
        )}
      </div>
    </DevOpsLayout>
  );
}
