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
  details?: {
    role?: string;
    subject?: string;
    exchanged?: boolean;
    reason?: string;
    cloud?: string;
    expires_at?: string;
  };
}

export default function IdentityPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [staticKeys, setStaticKeys] = useState<StaticKey[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [issuer, setIssuer] = useState('');
  const [audience, setAudience] = useState('');
  const [workloadRole, setWorkloadRole] = useState('');
  const [gcpServiceAccount, setGcpServiceAccount] = useState('');
  const [lastExchange, setLastExchange] = useState<Finding | null>(null);
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
        setWorkloadRole(typeof data.workload_role === 'string' ? data.workload_role : '');
        setGcpServiceAccount(typeof data.gcp_service_account === 'string' ? data.gcp_service_account : '');
        setLastExchange(data.last_exchange && typeof data.last_exchange === 'object' ? data.last_exchange : null);
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
              Static cloud keys on this backend are flagged. After GitHub or GitLab OIDC verify, SetuOps can assume AWS_WORKLOAD_ROLE_ARN (repo as subject). Cloud secrets are never stored on a CHG or Identity row.
            </p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading identity…</div> : null}
        <section className="portal-surface">
          <div className="portal-form-grid">
            <label className="label">Portal OIDC issuer<input className="input" readOnly value={issuer || 'Not configured'} /></label>
            <label className="label">GitHub OIDC audience<input className="input" readOnly value={audience || 'setuops'} /></label>
            <label className="label">AWS workload role<input className="input" readOnly value={workloadRole || 'Not configured'} /></label>
            <label className="label">GCP service account<input className="input" readOnly value={gcpServiceAccount || 'Not configured'} /></label>
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
          <h2 className="portal-surface__title">Last cloud-role exchange</h2>
          {lastExchange ? (
            <p>
              {lastExchange.name} · {lastExchange.details?.cloud || lastExchange.provider || 'oidc'}
              {lastExchange.details?.role ? ` · ${lastExchange.details.role}` : ''}
              {lastExchange.details?.exchanged ? ' · exchanged' : ' · not exchanged'}
              {lastExchange.details?.reason ? ` · ${lastExchange.details.reason}` : ''}
              {lastExchange.last_seen_at ? ` · ${new Date(lastExchange.last_seen_at).toLocaleString()}` : ''}
            </p>
          ) : (
            <p className="portal-surface__subtitle">No cloud-role exchange has been recorded yet. Secrets are never stored here.</p>
          )}
        </section>
        <section className="portal-surface" style={{ marginTop: 16 }}>
          <h2 className="portal-surface__title">Recent OIDC exchanges</h2>
          {findings.length === 0 ? (
            <p className="portal-surface__subtitle">No GitHub or GitLab OIDC tokens have been verified yet.</p>
          ) : (
            <ul>
              {findings.map((item) => (
                <li key={`${item.kind}-${item.name}`}>
                  {item.name} · {item.kind}
                  {item.provider ? ` · ${item.provider}` : ''}
                  {item.details?.role ? ` · ${item.details.role}` : ''}
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
