import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CopyButton, buildPortalApiUrl, portalFetch } from '@infragate/ui';

const TOKEN_KEY = 'devops_token';

type OAuthApp = {
  configured?: boolean;
  client_id?: string;
  client_secret_set?: boolean;
  redirect_url?: string;
  callback_url?: string;
  scopes?: string;
  can_manage?: boolean;
};

export default function JiraOnboardPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [app, setApp] = useState<OAuthApp | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      void router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/app'), { token })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          void router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(body.error || 'Jira app settings could not be loaded');
        const next = (body.oauth_app || {}) as OAuthApp;
        setApp(next);
        setClientId(next.client_id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Jira app settings could not be loaded'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  useEffect(() => { load(); }, [load]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    if (!clientId.trim()) {
      setError('Client ID is required.');
      return;
    }
    if (!app?.client_secret_set && !clientSecret.trim()) {
      setError('Client secret is required for the first save.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/integrations/jira/app'), {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Jira app could not be saved');
      setClientSecret('');
      setNotice('Client ID and secret are stored encrypted. They are not shown again. You can now add a Jira connection.');
      setApp(body.oauth_app || app);
      void router.push('/integrations/jira');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Jira app could not be saved');
    } finally {
      setSaving(false);
    }
  }

  const callback = app?.callback_url || app?.redirect_url || '';

  return (
    <DevOpsLayout>
      <Head><title>Onboard Jira - OpsTrellis</title></Head>
      <div className="work-page">
        <header className="work-page__head">
          <div>
            <p className="ops-kicker"><Link href="/integrations/jira">Jira</Link></p>
            <h1>Onboard Jira app</h1>
            <p>Store the Atlassian OAuth client ID and secret in OpsTrellis. Credentials stay encrypted on the API and are never returned to the browser.</p>
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {loading ? <p className="work-empty">Loading Jira app settings…</p> : null}
        {!loading && app && !app.can_manage ? (
          <section className="portal-surface">
            <p>Only a portal admin or manager can change these credentials after the first onboard.</p>
            <Link href="/integrations/jira" className="btn btn-secondary">Back to Jira</Link>
          </section>
        ) : null}
        {!loading && app?.can_manage !== false ? (
          <form className="portal-surface" onSubmit={(event) => void onSubmit(event)}>
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Atlassian OAuth app</h2>
                <p className="portal-surface__subtitle">Create an OAuth 2.0 (3LO) app in the Atlassian developer console, then paste the values here. Do not put them in a server environment file.</p>
              </div>
            </div>
            <ol className="jira-onboard-steps">
              <li>Create the app at developer.atlassian.com and enable authorization code grants.</li>
              <li>Add this callback URL to the app.</li>
              <li>Grant {app?.scopes || 'read:jira-work write:jira-work read:jira-user manage:jira-webhook offline_access'}.</li>
              <li>Save the client ID and secret below. OpsTrellis encrypts the secret in the database.</li>
            </ol>
            <label className="label">Callback URL
              <div className="jira-onboard-copy">
                <input className="input" value={callback} readOnly />
                {callback ? <CopyButton value={callback} label="callback URL" /> : null}
              </div>
            </label>
            <div className="portal-form-grid">
              <label className="label">Client ID
                <input
                  className="input"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <label className="label">{app?.client_secret_set ? 'Replace client secret' : 'Client secret'}
                <input
                  className="input"
                  type="password"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  autoComplete="new-password"
                  placeholder={app?.client_secret_set ? 'Leave blank to keep the stored secret' : ''}
                />
              </label>
            </div>
            {app?.client_secret_set ? <p className="form-section__copy">A client secret is already stored. Enter a new value only if you are rotating it. The current secret is never shown.</p> : null}
            <div className="portal-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Store credentials'}</button>
              <Link href="/integrations/jira" className="btn btn-secondary">Cancel</Link>
            </div>
          </form>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
