import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState, type FormEvent } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function AdminSSOConfigurePage() {
  const router = useRouter();
  const [provider, setProvider] = useState('oidc');
  const [userMode, setUserMode] = useState('optional');
  const [devopsMode, setDevopsMode] = useState('optional');
  const [jit, setJit] = useState(true);
  const [mfa, setMfa] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState(true);
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
      setNotice('SSO settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <Head>
        <title>Configure SSO - {ADMIN_SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">SSO</span>
            <h1 className="portal-page__title">Configure</h1>
            <p className="portal-page__subtitle">Turn on OIDC for User and DevOps. Issuer and client secrets live in environment variables, not git.</p>
          </div>
          <Link href="/sso" className="btn btn-secondary">Back</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        <form className="portal-surface" onSubmit={save}>
          <div className="portal-form-grid">
            <label className="label">
              Provider
              <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="oidc">OIDC</option>
                <option value="azure_ad">Azure AD</option>
                <option value="keycloak">Keycloak</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="label">
              User portal
              <select className="input" value={userMode} onChange={(e) => setUserMode(e.target.value)}>
                <option value="disabled">Disabled</option>
                <option value="optional">Optional</option>
                <option value="required">Required</option>
              </select>
            </label>
            <label className="label">
              DevOps portal
              <select className="input" value={devopsMode} onChange={(e) => setDevopsMode(e.target.value)}>
                <option value="disabled">Disabled</option>
                <option value="optional">Optional</option>
                <option value="required">Required</option>
              </select>
            </label>
          </div>
          <label className="label" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
            <input type="checkbox" checked={jit} onChange={(e) => setJit(e.target.checked)} />
            JIT provision unknown users on first OIDC login
          </label>
          <label className="label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={verifiedEmail} onChange={(e) => setVerifiedEmail(e.target.checked)} />
            Require verified email claim
          </label>
          <label className="label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={mfa} onChange={(e) => setMfa(e.target.checked)} />
            Require MFA claim
          </label>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}
