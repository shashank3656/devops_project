import Head from 'next/head';
import { useEffect, useState } from 'react';
import AccessFilters from '../../components/AccessFilters';
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
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');

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
        setSettings(body?.settings && typeof body.settings === 'object' ? body.settings : {});
        const oidc = body?.oidc || {};
        setReady(Boolean(oidc.issuer_set && oidc.client_id_set && oidc.client_secret_set));
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
      const response = await fetch(`${apiUrl}/api/admin/sso/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(settings),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Sign-in settings were not saved.');
        return;
      }
      setNotice('Sign-in choices saved.');
    } catch {
      setError('Sign-in settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const userMode = typeof settings?.user_portal_sso_mode === 'string' ? settings.user_portal_sso_mode : 'disabled';
  const devopsMode = typeof settings?.devops_portal_sso_mode === 'string' ? settings.devops_portal_sso_mode : 'disabled';
  const needle = query.trim().toLowerCase();
  const showRequester = (audience === 'all' || audience === 'requester')
    && (modeFilter === 'all' || modeFilter === userMode)
    && (!needle || 'requesters password directory'.includes(needle));
  const showDevops = (audience === 'all' || audience === 'devops')
    && (modeFilter === 'all' || modeFilter === devopsMode)
    && (!needle || 'devops password directory'.includes(needle));

  return (
    <>
      <Head>
        <title>Sign-in - DevOps</title>
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
          <AccessFilters
            query={query}
            onQuery={setQuery}
            placeholder="Search requesters or DevOps"
            kind={audience}
            onKind={setAudience}
            kindLabel="Who"
            kindOptions={[
              { value: 'all', label: 'Everyone' },
              { value: 'requester', label: 'Requesters' },
              { value: 'devops', label: 'DevOps' },
            ]}
            extra={modeFilter}
            onExtra={setModeFilter}
            extraLabel="Current choice"
            extraOptions={[
              { value: 'all', label: 'Any choice' },
              { value: 'disabled', label: 'Password only' },
              { value: 'optional', label: 'Password or directory' },
              { value: 'required', label: 'Directory only' },
            ]}
          />
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading sign-in settings…</p> : null}
          {!loading && settings ? (
            <form className="portal-surface" onSubmit={save}>
              <p className={ready ? 'access-status is-ready' : 'access-status'}>
                {ready ? 'Directory is set up on the API host.' : 'Directory is not set up yet. Password sign-in still works.'}
              </p>
              {!showRequester && !showDevops ? <p className="work-empty">Nothing matches this search.</p> : (
                <div className="access-create">
                  {showRequester ? (
                    <div>
                      <label className="label" htmlFor="sso-requester">Requesters</label>
                      <select
                        id="sso-requester"
                        className="input"
                        value={userMode}
                        onChange={(event) => setSettings({ ...settings, user_portal_sso_mode: event.target.value })}
                      >
                        {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                      </select>
                    </div>
                  ) : null}
                  {showDevops ? (
                    <div>
                      <label className="label" htmlFor="sso-devops">DevOps</label>
                      <select
                        id="sso-devops"
                        className="input"
                        value={devopsMode}
                        onChange={(event) => setSettings({ ...settings, devops_portal_sso_mode: event.target.value })}
                      >
                        {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                      </select>
                    </div>
                  ) : null}
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              )}
            </form>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
