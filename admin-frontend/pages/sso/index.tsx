import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import CopyField from '../../components/CopyField';
import { ADMIN_SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface SSOSettings {
  provider?: string;
  user_portal_sso_mode?: string;
  devops_portal_sso_mode?: string;
  jit_provision_enabled?: boolean;
  require_mfa_claim?: boolean;
  require_verified_email_claim?: boolean;
}

interface OIDCStatus {
  issuer_set?: boolean;
  client_id_set?: boolean;
  client_secret_set?: boolean;
  redirect_url?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  oidc: 'OIDC',
  azure_ad: 'Azure AD',
  keycloak: 'Keycloak',
  none: 'Not selected',
};

const MODE_LABELS: Record<string, string> = {
  disabled: 'Password only',
  optional: 'SSO or password',
  required: 'SSO required',
};

function modeLabel(value?: string): string {
  return MODE_LABELS[value || 'disabled'] || value || 'Password only';
}

export default function AdminSSOCatalogPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SSOSettings | null>(null);
  const [oidc, setOidc] = useState<OIDCStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fallbackCallback = `${apiUrl.replace(/\/$/, '')}/api/auth/oidc/callback`;
  const callbackUrl = oidc?.redirect_url || fallbackCallback;
  const credentialsReady = Boolean(oidc?.issuer_set && oidc?.client_id_set && oidc?.client_secret_set);
  const provider =
    settings?.provider && settings.provider !== 'none' ? settings.provider : '';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    fetch(`${apiUrl}/api/admin/sso/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load SSO');
        setSettings(data.settings || {});
        setOidc(data.oidc || null);
        setError('');
      })
      .catch((err) => {
        const message =
          err instanceof Error && err.name === 'AbortError'
            ? 'The API did not respond in time. Confirm the backend is running and NEXT_PUBLIC_API_URL is correct.'
            : err instanceof Error
              ? err.message
              : 'Failed to load SSO';
        setError(message);
        setSettings({});
        setOidc(null);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [router]);

  return (
    <AdminLayout>
      <Head>
        <title>{`SSO - ${ADMIN_SITE_NAME}`}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">People</span>
            <h1 className="portal-page__title">Single sign-on</h1>
            <p className="portal-page__subtitle">
              Let people sign in with Okta, Azure AD, or Keycloak. The Admin portal always keeps a local password.
            </p>
          </div>
          <Link href="/sso/configure" className="btn btn-primary">
            Configure portals
          </Link>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            {error} You can still follow the setup steps below; status cards reflect the last successful load or defaults.
          </div>
        ) : null}
        {loading ? (
          <div className="admin-queue-state">
            <div className="admin-queue-state__spinner" aria-hidden="true" />
            <p className="admin-queue-state__title">Loading SSO</p>
          </div>
        ) : (
          <>
            <section className="admin-status-grid">
              <article className="admin-status-card">
                <span>Provider</span>
                <strong>{PROVIDER_LABELS[settings?.provider || 'none'] || settings?.provider || 'Not selected'}</strong>
              </article>
              <article className="admin-status-card">
                <span>User portal</span>
                <strong>{modeLabel(settings?.user_portal_sso_mode)}</strong>
              </article>
              <article className="admin-status-card">
                <span>DevOps portal</span>
                <strong>{modeLabel(settings?.devops_portal_sso_mode)}</strong>
              </article>
              <article className={`admin-status-card${credentialsReady ? ' is-ready' : ''}`}>
                <span>API credentials</span>
                <strong>{credentialsReady ? 'Set on the API host' : 'Not set yet'}</strong>
              </article>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Setup</span>
                  <h2 className="portal-surface__title">Connect an identity provider</h2>
                  <p className="portal-surface__subtitle">
                    Do this once. Secrets stay on the API host — this page only turns SSO on for User and DevOps.
                  </p>
                </div>
              </div>
              <ol className="admin-setup-steps">
                <li>
                  <h3>Create an OIDC app</h3>
                  <p>
                    {provider === 'azure_ad'
                      ? 'In Azure, create an App registration and add a Web redirect URI.'
                      : provider === 'keycloak'
                        ? 'In Keycloak, create an openid-connect client and enable standard flow.'
                        : 'In Okta, Azure AD, Keycloak, or Auth0, create a web OIDC application.'}
                  </p>
                </li>
                <li>
                  <h3>Paste this callback URL</h3>
                  <p>Use it as the redirect URI / sign-in redirect. It must match the API exactly.</p>
                  <CopyField value={callbackUrl} />
                </li>
                <li>
                  <h3>Set credentials on the SetuOps API host</h3>
                  <p>These are environment variables, not git. Ask whoever runs the API if you do not have host access.</p>
                  <ul className="admin-setup-env">
                    <li>
                      <code>OIDC_ISSUER</code>
                      <span>{oidc?.issuer_set ? 'Set' : 'Missing'}</span>
                    </li>
                    <li>
                      <code>OIDC_CLIENT_ID</code>
                      <span>{oidc?.client_id_set ? 'Set' : 'Missing'}</span>
                    </li>
                    <li>
                      <code>OIDC_CLIENT_SECRET</code>
                      <span>{oidc?.client_secret_set ? 'Set' : 'Missing'}</span>
                    </li>
                    <li>
                      <code>OIDC_REDIRECT_URL</code>
                      <span>Must equal the callback above</span>
                    </li>
                  </ul>
                </li>
                <li>
                  <h3>Choose how people sign in</h3>
                  <p>
                    Optional keeps a password fallback. Required is SSO only. Admin never uses SSO.
                    {settings?.jit_provision_enabled ? ' New users can be created on first login.' : ' Unknown users are not created until you add them.'}
                  </p>
                  <Link href="/sso/configure" className="btn btn-secondary">
                    Configure portals
                  </Link>
                </li>
              </ol>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
