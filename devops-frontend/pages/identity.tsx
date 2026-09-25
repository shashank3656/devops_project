import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface StaticKey {
  name: string;
  advice?: string;
}

interface Finding {
  kind: string;
  name: string;
  provider?: string;
  last_seen_at?: string;
}

export default function IdentityPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [staticKeys, setStaticKeys] = useState<StaticKey[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [issuer, setIssuer] = useState('');
  const [audience, setAudience] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/identity`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load identity');
        setStaticKeys(Array.isArray(data.static_keys) ? data.static_keys : []);
        setFindings(Array.isArray(data.findings) ? data.findings : []);
        setIssuer(typeof data.oidc_issuer === 'string' ? data.oidc_issuer : '');
        setAudience(typeof data.oidc_audience === 'string' ? data.oidc_audience : '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load identity'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Identity - SetuOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Health</span>
            <h1 className="portal-page__title">Identity</h1>
            <p className="portal-page__subtitle">
              Static cloud keys on this backend are flagged. CI should POST a GitHub Actions or GitLab OIDC token to /api/auth/workload/github or /api/auth/workload/gitlab instead of long-lived keys.
            </p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading identity…</div> : null}
        <section className="portal-surface">
          <div className="portal-form-grid">
            <label className="label">Portal OIDC issuer<input className="input" readOnly value={issuer || 'Not configured'} /></label>
            <label className="label">GitHub OIDC audience<input className="input" readOnly value={audience || 'setuops'} /></label>
          </div>
        </section>
        <section className="portal-surface" style={{ marginTop: 16 }}>
          <h2 className="portal-surface__title">Static keys</h2>
          {staticKeys.length === 0 ? (
            <p className="portal-surface__subtitle">No long-lived cloud keys detected in this process environment.</p>
          ) : (
            <ul>
              {staticKeys.map((key) => (
                <li key={key.name}>
                  <strong>{key.name}</strong> is set. {key.advice}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="portal-surface" style={{ marginTop: 16 }}>
          <h2 className="portal-surface__title">Recent OIDC exchanges</h2>
          {findings.length === 0 ? (
            <p className="portal-surface__subtitle">No GitHub OIDC tokens have been verified yet.</p>
          ) : (
            <ul>
              {findings.map((item) => (
                <li key={`${item.kind}-${item.name}`}>
                  {item.name} · {item.kind}
                  {item.provider ? ` · ${item.provider}` : ''}
                  {item.last_seen_at ? ` · ${new Date(item.last_seen_at).toLocaleString()}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
