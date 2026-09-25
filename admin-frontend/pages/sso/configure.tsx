import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState, type FormEvent } from 'react';
import AdminLayout from '../../components/AdminLayout';
import CopyField from '../../components/CopyField';
import { ADMIN_SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const PROVIDER_HINTS: Record<string, string> = {
  oidc: 'Works with Okta, Auth0, Google Workspace, or any OIDC issuer. Discovery is loaded from the issuer URL.',
  azure_ad: 'Issuer looks like https://login.microsoftonline.com/{tenant}/v2.0. Add the callback as a Web redirect URI.',
  keycloak: 'Issuer looks like https://{host}/realms/{realm}. Use a confidential openid-connect client.',
  none: 'Turns SSO off. People use their existing passwords on User and DevOps.',
};

export default function AdminSSOConfigurePage() {
  const router = useRouter();
  const [provider, setProvider] = useState('oidc');
  const [userMode, setUserMode] = useState('optional');
  const [devopsMode, setDevopsMode] = useState('optional');
  const [jit, setJit] = useState(true);
  const [mfa, setMfa] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState(true);
  const [callbackUrl, setCallbackUrl] = useState(`${apiUrl.replace(/\/$/, '')}/api/auth/oidc/callback`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/sso/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        const settings = data.settings || {};
        setProvider(settings.provider || 'oidc');
        setUserMode(settings.user_portal_sso_mode || 'optional');
        setDevopsMode(settings.devops_portal_sso_mode || 'optional');
        setJit(Boolean(settings.jit_provision_enabled));
        setMfa(Boolean(settings.require_mfa_claim));
        setVerifiedEmail(Boolean(settings.require_verified_email_claim));
        if (typeof data.oidc?.redirect_url === 'string' && data.oidc.redirect_url) {
          setCallbackUrl(data.oidc.redirect_url);
        }
      })
      .catch(() => undefined);
  }, [router]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/sso/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          user_portal_sso_mode: userMode,
          devops_portal_sso_mode: devopsMode,
          user_portal_sso_enabled: userMode !== 'disabled',
          devops_portal_sso_enabled: devopsMode !== 'disabled',
          jit_provision_enabled: jit,
          require_mfa_claim: mfa,
          require_verified_email_claim: verifiedEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setNotice('Portal SSO settings saved. Sign in on the User portal to confirm.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <Head>
        <title>{`Configure SSO - ${ADMIN_SITE_NAME}`}</title>
      </Head>
      <div className="portal-page portal-page--narrow">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">SSO</span>
            <h1 className="portal-page__title">Configure portals</h1>
            <p className="portal-page__subtitle">
              Choose the provider and whether User and DevOps require SSO. Client secrets stay in API environment variables.
            </p>
          </div>
          <Link href="/sso" className="btn btn-secondary">
            Back
          </Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        <form className="portal-surface" onSubmit={save}>
          <div className="admin-setup-hint">
            <p>Redirect URI in your identity provider:</p>
            <CopyField value={callbackUrl} />
          </div>
          <label className="label">
            Provider
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="oidc">OIDC (Okta, Auth0, Google)</option>
              <option value="azure_ad">Azure AD</option>
              <option value="keycloak">Keycloak</option>
              <option value="none">None</option>
            </select>
          </label>
          <p className="portal-surface__subtitle">{PROVIDER_HINTS[provider] || PROVIDER_HINTS.oidc}</p>
          <div className="portal-form-grid">
            <label className="label">
              User portal
              <select className="input" value={userMode} onChange={(e) => setUserMode(e.target.value)}>
                <option value="disabled">Password only</option>
                <option value="optional">SSO or password</option>
                <option value="required">SSO required</option>
              </select>
            </label>
            <label className="label">
              DevOps portal
              <select className="input" value={devopsMode} onChange={(e) => setDevopsMode(e.target.value)}>
                <option value="disabled">Password only</option>
                <option value="optional">SSO or password</option>
                <option value="required">SSO required</option>
              </select>
            </label>
          </div>
          <label className="admin-check">
            <input type="checkbox" checked={jit} onChange={(e) => setJit(e.target.checked)} />
            <span>
              <strong>Create unknown users on first login</strong>
              <em>Turn this off if you want to provision accounts yourself.</em>
            </span>
          </label>
          <label className="admin-check">
            <input type="checkbox" checked={verifiedEmail} onChange={(e) => setVerifiedEmail(e.target.checked)} />
            <span>
              <strong>Require a verified email claim</strong>
              <em>Reject logins whose IdP has not verified the email.</em>
            </span>
          </label>
          <label className="admin-check">
            <input type="checkbox" checked={mfa} onChange={(e) => setMfa(e.target.checked)} />
            <span>
              <strong>Require an MFA claim</strong>
              <em>Only if your IdP sends an MFA claim SetuOps can read.</em>
            </span>
          </label>
          <div className="portal-form-actions">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}
