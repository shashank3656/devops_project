import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type Asset = {
  id: number;
  asset_type: string;
  display_name: string;
  hostname?: string;
  port?: number;
  registered_domain?: string;
  service_name: string;
  environment: string;
  owner_name: string;
  assessment: string;
  renewal_state: string;
  remaining_days?: number | null;
  issuer?: string;
  registrar_expires_at?: string;
  registry_expires_at?: string;
  certificate_expires_at?: string;
  last_checked_at?: string;
  auto_renew?: boolean | null;
  coverage: string;
};

type Summary = {
  expired_invalid: number;
  due: number;
  unassigned: number;
  unknown_stale: number;
  certificates: number;
  domains: number;
};

function known(value: string | undefined): string {
  return (value || '').trim() || 'Unknown';
}

function assessmentLabel(value: string): string {
  const key = (value || '').toLowerCase();
  if (key === 'valid') return 'Valid';
  if (key === 'expiring') return 'Expiring';
  if (key === 'expired') return 'Expired';
  if (key === 'invalid') return 'Invalid certificate';
  if (key === 'stale') return 'Stale';
  return 'Unknown';
}

export default function CertificatesPage() {
  const apiUrl = useApiUrl();
  const [tab, setTab] = useState<'certificate' | 'domain' | 'renewal' | 'history'>('certificate');
  const [items, setItems] = useState<Asset[]>([]);
  const [summary, setSummary] = useState<Summary>({ expired_invalid: 0, due: 0, unassigned: 0, unknown_stale: 0, certificates: 0, domains: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    fetch(`${apiUrl}/api/expiry/assets`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'Certificate and domain records could not be loaded.');
          return;
        }
        setError('');
        setItems(Array.isArray(data.assets) ? data.assets : []);
        setSummary({
          expired_invalid: Number(data.summary?.expired_invalid) || 0,
          due: Number(data.summary?.due) || 0,
          unassigned: Number(data.summary?.unassigned) || 0,
          unknown_stale: Number(data.summary?.unknown_stale) || 0,
          certificates: Number(data.summary?.certificates) || 0,
          domains: Number(data.summary?.domains) || 0,
        });
      })
      .catch(() => setError('Certificate and domain records could not be loaded.'))
      .finally(() => setLoading(false));
  }, [apiUrl, refresh]);

  const rows = useMemo(() => {
    if (tab === 'certificate') return items.filter((item) => item.asset_type === 'certificate');
    if (tab === 'domain') return items.filter((item) => item.asset_type === 'domain');
    if (tab === 'renewal') return items.filter((item) => item.renewal_state && item.renewal_state !== 'open' && item.renewal_state !== 'verified' && item.renewal_state !== 'archived');
    return items;
  }, [items, tab]);

  return (
    <DevOpsLayout>
      <Head><title>Certificates and domains</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Certificates & domains</h1>
            <p className="portal-page__subtitle">Certificate expiry and domain registration expiry are different assets. Empty coverage stays Unknown. Auto-renew is not proof of completed renewal.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/certificates/new" className="btn btn-primary">Register asset</Link>
            <Link href="/credential-audit" className="btn btn-secondary">Secret review</Link>
          </div>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefresh((value) => value + 1)}>Retry</button>
          </div>
        ) : null}
        <section className="portal-surface">
          <div className="portal-pill-row">
            <span className="portal-pill">Expired or invalid {summary.expired_invalid}</span>
            <span className="portal-pill">Due within policy {summary.due}</span>
            <span className="portal-pill">Unassigned {summary.unassigned}</span>
            <span className="portal-pill">Unknown or stale {summary.unknown_stale}</span>
            <span className="portal-pill">Certificates {summary.certificates}</span>
            <span className="portal-pill">Domains {summary.domains}</span>
          </div>
        </section>
        <div className="portal-tabs" role="tablist">
          <button type="button" className={`btn btn-sm ${tab === 'certificate' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('certificate')}>Certificates</button>
          <button type="button" className={`btn btn-sm ${tab === 'domain' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('domain')}>Domains</button>
          <button type="button" className={`btn btn-sm ${tab === 'renewal' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('renewal')}>Renewal queue</button>
          <button type="button" className={`btn btn-sm ${tab === 'history' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('history')}>Check history</button>
        </div>
        <section className="portal-surface portal-surface--table">
          {loading ? <div className="empty-state">Loading registered endpoints and domains…</div> : null}
          {!loading && !rows.length ? <div className="empty-state">No matching assets. Register an authorized public endpoint or domain. Hosted checks never collect private keys.</div> : null}
          {!loading && rows.length ? (
            <div className="table-wrap">
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>{tab === 'domain' ? 'Registered domain' : 'Endpoint'}</th>
                    <th>Service</th>
                    <th>Assessment</th>
                    <th>{tab === 'domain' ? 'Registrar / registry' : 'Certificate expiry'}</th>
                    <th>Owner</th>
                    <th>Last verified</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{known(row.display_name)}{row.asset_type === 'certificate' && row.port ? `:${row.port}` : ''}</strong>
                        <div className="access-hint">{row.asset_type === 'certificate' ? 'Certificate' : 'Domain'} · {known(row.environment)}</div>
                      </td>
                      <td>{known(row.service_name)}</td>
                      <td>{assessmentLabel(row.assessment)} · renewal {known(row.renewal_state)}</td>
                      <td>
                        {row.asset_type === 'domain' ? (
                          <>
                            <div>Registrar {row.registrar_expires_at || 'Unknown'}</div>
                            <div>Registry {row.registry_expires_at || 'Unknown'}</div>
                            {row.auto_renew ? <div>Auto-renew reported. Not verified.</div> : null}
                          </>
                        ) : (row.certificate_expires_at || 'Unknown')}
                        {typeof row.remaining_days === 'number' ? <div>{row.remaining_days} days remaining</div> : null}
                      </td>
                      <td>{known(row.owner_name)}</td>
                      <td>{row.last_checked_at || 'Unknown'}</td>
                      <td><Link href={`/certificates/${row.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
