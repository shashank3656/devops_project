import Head from 'next/head';
import { useEffect, useState } from 'react';
import AccessNav from '../../components/AccessNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type SsoSettings = Record<string, unknown>;

const MODES = [
  { value: 'disabled', label: 'Password only' },
  { value: 'optional', label: 'Password or directory' },
  { value: 'required', label: 'Directory only' },
];

export default function PortalSsoPage() {
  const apiUrl = useApiUrl();
  const [settings, setSettings] = useState<SsoSettings | null>(null);
  const [baseline, setBaseline] = useState({ user: 'disabled', devops: 'disabled' });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/admin/sso/settings`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Sign-in settings could not be loaded.');
        return body;
      })
      .then((body) => {
        if (cancel) return;
        const next = body?.settings && typeof body.settings === 'object' ? body.settings as SsoSettings : {};
        const oidc = body?.oidc || {};
        const directoryReady = Boolean(oidc.issuer_set && oidc.client_id_set && oidc.client_secret_set);
        const userMode = typeof next.user_portal_sso_mode === 'string' ? next.user_portal_sso_mode : 'disabled';
        const devopsMode = typeof next.devops_portal_sso_mode === 'string' ? next.devops_portal_sso_mode : 'disabled';
        setSettings(next);
        setReady(directoryReady);
        setBaseline({
          user: !directoryReady && userMode === 'required' ? 'disabled' : userMode,
          devops: !directoryReady && devopsMode === 'required' ? 'disabled' : devopsMode,
        });
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = { ...settings };
      if (!ready) {
        if (payload.user_portal_sso_mode === 'required') payload.user_portal_sso_mode = 'disabled';
        if (payload.devops_portal_sso_mode === 'required') payload.devops_portal_sso_mode = 'disabled';
      }
      const response = await fetch(`${apiUrl}/api/admin/sso/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Sign-in settings were not saved.');
        return;
      }
      setNotice('Sign-in choices saved.');
      setBaseline({
        user: typeof payload.user_portal_sso_mode === 'string' ? payload.user_portal_sso_mode : 'disabled',
        devops: typeof payload.devops_portal_sso_mode === 'string' ? payload.devops_portal_sso_mode : 'disabled',
      });
    } catch {
      setError('Sign-in settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const userMode = typeof settings?.user_portal_sso_mode === 'string' ? settings.user_portal_sso_mode : 'disabled';
  const devopsMode = typeof settings?.devops_portal_sso_mode === 'string' ? settings.devops_portal_sso_mode : 'disabled';
  const shownUser = ready ? userMode : (userMode === 'required' ? 'disabled' : userMode);
  const shownDevops = ready ? devopsMode : (devopsMode === 'required' ? 'disabled' : devopsMode);
  const dirty = shownUser !== baseline.user || shownDevops !== baseline.devops;

  return (
    <>
      <Head>
        <title>Sign-in - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>Sign-in</h1>
              <p>Choose a password, a company directory, or both. Directory secrets are not shown here.</p>
            </div>
          </header>
          <AccessNav />
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading sign-in settings…</p> : null}
          {!loading && settings ? (
            <form className="portal-surface" onSubmit={save}>
              <p className={ready ? 'access-status is-ready' : 'access-status'}>
                {ready
                  ? 'Directory is set up on the API host.'
                  : 'Directory is not set up yet. Password sign-in still works. Directory only stays unavailable until the directory issuer, client id, and client secret are set on the API host.'}
              </p>
              <div className="access-create">
                <div>
                  <label className="label" htmlFor="sso-requester">Requesters</label>
                  <select
                    id="sso-requester"
                    className="input"
                    value={ready ? userMode : (userMode === 'required' ? 'disabled' : userMode)}
                    onChange={(event) => setSettings({ ...settings, user_portal_sso_mode: event.target.value })}
                  >
                    {MODES.map((mode) => (
                      <option key={mode.value} value={mode.value} disabled={mode.value === 'required' && !ready}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="sso-devops">DevOps</label>
                  <select
                    id="sso-devops"
                    className="input"
                    value={ready ? devopsMode : (devopsMode === 'required' ? 'disabled' : devopsMode)}
                    onChange={(event) => setSettings({ ...settings, devops_portal_sso_mode: event.target.value })}
                  >
                    {MODES.map((mode) => (
                      <option key={mode.value} value={mode.value} disabled={mode.value === 'required' && !ready}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={!dirty || saving} title={dirty ? 'Save sign-in choices' : 'No changes to save'}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
