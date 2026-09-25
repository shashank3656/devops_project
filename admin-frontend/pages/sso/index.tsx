import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface SSOSettings {
  provider?: string;
  user_portal_sso_mode?: string;
  devops_portal_sso_mode?: string;
  jit_provision_enabled?: boolean;
  require_mfa_claim?: boolean;
}

export default function AdminSSOCatalogPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SSOSettings | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/sso/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load SSO');
        setSettings(data.settings || {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load SSO'))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <AdminLayout>
      <Head>
        <title>SSO - {ADMIN_SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">People</span>
            <h1 className="portal-page__title">SSO</h1>
            <p className="portal-page__subtitle">OIDC login for User and DevOps portals. Admin stays on break-glass password.</p>
          </div>
          <Link href="/sso/configure" className="btn btn-primary">Configure</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading SSO…</div> : null}
        {settings ? (
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">Provider<input className="input" readOnly value={settings.provider || 'none'} /></label>
              <label className="label">User portal<input className="input" readOnly value={settings.user_portal_sso_mode || 'disabled'} /></label>
              <label className="label">DevOps portal<input className="input" readOnly value={settings.devops_portal_sso_mode || 'disabled'} /></label>
              <label className="label">JIT provision<input className="input" readOnly value={settings.jit_provision_enabled ? 'On' : 'Off'} /></label>
              <label className="label">Require MFA claim<input className="input" readOnly value={settings.require_mfa_claim ? 'On' : 'Off'} /></label>
            </div>
            <p className="portal-surface__subtitle">
              Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URL on the backend. Redirect must be /api/auth/oidc/callback.
            </p>
          </section>
        ) : null}
      </div>
    </AdminLayout>
  );
}
