import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { downloadCSV } from '../lib/csv';
import { formatExpiryOn, publishedDomainExpiry } from '../lib/expiryDisplay';

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
  paused?: boolean;
  shared_count?: number;
  fingerprint?: string;
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
  collector?: string;
};

type Collector = {
  id: number;
  name: string;
  project_id?: number;
  status: string;
  last_seen_at?: string;
  coverage: string;
};

type HistoryRow = {
  asset_id: number;
  display_name: string;
  asset_type: string;
  hostname?: string;
  observed_at: string;
  source: string;
  assessment: string;
  detail: string;
  observation_point?: string;
  leaf_fingerprint?: string;
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
  const [tab, setTab] = useState<'certificate' | 'domain' | 'renewal' | 'history' | 'collectors'>('certificate');
  const [items, setItems] = useState<Asset[]>([]);
  const [summary, setSummary] = useState<Summary>({ expired_invalid: 0, due: 0, unassigned: 0, unknown_stale: 0, certificates: 0, domains: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [collectorName, setCollectorName] = useState('');
  const [collectorToken, setCollectorToken] = useState('');
  const [collectorWarning, setCollectorWarning] = useState('');
  const [savingCollector, setSavingCollector] = useState(false);

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

  useEffect(() => {
    if (tab !== 'history') return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/expiry/assets/observations`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        setHistory(Array.isArray(data.observations) ? data.observations : []);
      })
      .catch(() => setHistory([]));
  }, [apiUrl, tab, refresh]);

  useEffect(() => {
    if (tab !== 'collectors') return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/expiry/collectors`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        setCollectors(Array.isArray(data.collectors) ? data.collectors : []);
      })
      .catch(() => setCollectors([]));
  }, [apiUrl, tab, refresh]);

  const createCollector = async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !collectorName.trim()) return;
    setSavingCollector(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/expiry/collectors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: collectorName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'The private collector could not be created.');
        return;
      }
      setCollectorToken(typeof data.token === 'string' ? data.token : '');
      setCollectorWarning(typeof data.token_warning === 'string' ? data.token_warning : 'Shown once. Store it on the collector host.');
      setCollectorName('');
      setRefresh((value) => value + 1);
    } catch {
      setError('The private collector could not be created.');
    } finally {
      setSavingCollector(false);
    }
  };

  const rows = useMemo(() => {
    let next = items;
    if (tab === 'certificate') next = items.filter((item) => item.asset_type === 'certificate');
    else if (tab === 'domain') next = items.filter((item) => item.asset_type === 'domain');
    else if (tab === 'renewal') next = items.filter((item) => item.renewal_state && item.renewal_state !== 'open' && item.renewal_state !== 'verified' && item.renewal_state !== 'archived');
    return [...next].sort((left, right) => {
      const shared = (right.shared_count || 0) - (left.shared_count || 0);
      if (shared) return shared;
      const fingerprint = (left.fingerprint || '').localeCompare(right.fingerprint || '');
      if (fingerprint) return fingerprint;
      return left.id - right.id;
    });
  }, [items, tab]);

  const exportDue = () => {
    const due = items.filter((item) => ['expired', 'invalid', 'expiring'].includes((item.assessment || '').toLowerCase()));
    downloadCSV('certificates-domains-due.csv', [
      'Asset', 'Hostname', 'Domain', 'Type', 'Service', 'Environment', 'Assessment', 'Owner', 'Expiry', 'Remaining days', 'Paused', 'Collector', 'Shared endpoints',
    ], due.map((item) => [
      item.display_name,
      item.hostname || '',
      item.registered_domain || '',
      item.asset_type,
      item.service_name,
      item.environment,
      item.assessment,
      item.owner_name,
      item.asset_type === 'domain' ? publishedDomainExpiry(item.registrar_expires_at, item.registry_expires_at) : (item.certificate_expires_at || ''),
      item.remaining_days ?? '',
      item.paused ? 'paused' : '',
      item.collector || 'hosted',
      item.shared_count && item.shared_count > 1 ? item.shared_count : '',
    ]));
  };

  return (
    <DevOpsLayout>
      <Head><title>Certificates and domains</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Certificates & domains</h1>
            <p className="portal-page__subtitle">Certificate expiry and domain registration expiry are different assets. Empty coverage stays Unknown. Auto-renew is not proof of completed renewal. Issued inventory is not served-endpoint proof.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/certificates/new" className="btn btn-primary">Register asset</Link>
            <button type="button" className="btn btn-secondary" onClick={exportDue}>Export due CSV</button>
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
          <button type="button" className={`btn btn-sm ${tab === 'collectors' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('collectors')}>Private collectors</button>
        </div>
        <section className="portal-surface portal-surface--table">
          {tab === 'history' ? (
            history.length ? (
              <ul>
                {history.map((row, index) => {
                  const previous = history.slice(index + 1).find((item) => item.asset_id === row.asset_id);
                  const fingerprintChanged = Boolean(row.leaf_fingerprint && previous?.leaf_fingerprint && row.leaf_fingerprint !== previous.leaf_fingerprint);
                  const recovered = row.assessment === 'valid' && (previous?.assessment === 'expired' || previous?.assessment === 'invalid' || previous?.assessment === 'expiring');
                  return (
                    <li key={`${row.asset_id}-${row.observed_at}-${index}`}>
                      <Link href={`/certificates/${row.asset_id}`}>{known(row.display_name)}</Link>
                      {' · '}{row.observed_at} · {known(row.source)} · {assessmentLabel(row.assessment)} · {known(row.detail)}
                      {row.observation_point ? ` · ${row.observation_point}` : ''}
                      {fingerprintChanged ? ' · fingerprint changed' : ''}
                      {recovered ? ' · verified recovery' : ''}
                    </li>
                  );
                })}
              </ul>
            ) : <div className="empty-state">No observations yet. Coverage stays Unknown until a check stores evidence.</div>
          ) : null}
          {tab === 'collectors' ? (
            <>
              {collectorToken ? (
                <div className="alert alert-success" role="status">
                  <p>Collector token (shown once): {collectorToken}</p>
                  <p>{collectorWarning || 'Store it on the collector host. It is never displayed again.'}</p>
                </div>
              ) : null}
              <label className="label">Collector name
                <input className="input" value={collectorName} onChange={(event) => setCollectorName(event.target.value)} placeholder="payments-private-collector" />
              </label>
              <button type="button" className="btn btn-primary" disabled={savingCollector || !collectorName.trim()} onClick={() => void createCollector()}>
                {savingCollector ? 'Creating…' : 'Create private collector'}
              </button>
              <p className="access-hint">The collector posts TLS observations from inside the network. Hosted checks never reach private ranges. Private keys are not accepted. POST /api/expiry/collector/observations with the bearer token.</p>
              {collectors.length ? (
                <ul>
                  {collectors.map((row) => (
                    <li key={row.id}>
                      {known(row.name)} · {known(row.status)} · last seen {row.last_seen_at || 'Unknown'}
                    </li>
                  ))}
                </ul>
              ) : <div className="empty-state">No private collectors yet. Internal names stay Unknown until a collector posts evidence.</div>}
            </>
          ) : null}
          {tab !== 'history' && tab !== 'collectors' && loading ? <div className="empty-state">Loading registered endpoints and domains…</div> : null}
          {tab !== 'history' && tab !== 'collectors' && !loading && !rows.length ? (
            <div className="empty-state">
              <p>No matching assets. Register an authorized public endpoint or domain. Hosted checks never collect private keys. Empty coverage stays Unknown.</p>
              <Link href="/certificates/new" className="btn btn-primary btn-sm">Register asset</Link>
            </div>
          ) : null}
          {tab !== 'history' && tab !== 'collectors' && !loading && rows.length ? (
            <div className="table-wrap">
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>{tab === 'domain' ? 'Registered domain' : 'Endpoint'}</th>
                    <th>Service</th>
                    <th>Assessment</th>
                    <th>{tab === 'domain' ? 'Expiry date' : 'Expires on'}</th>
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
                        <div className="access-hint">
                          {row.asset_type === 'certificate' ? 'Certificate' : 'Domain'} · {known(row.environment)}
                          {row.paused ? ' · Paused' : ''}
                          {row.collector === 'private' ? ' · Private collector' : ''}
                          {row.shared_count && row.shared_count > 1 ? ` · Shared cert on ${row.shared_count} endpoints` : ''}
                        </div>
                      </td>
                      <td>{known(row.service_name)}</td>
                      <td>{assessmentLabel(row.assessment)} · renewal {known(row.renewal_state)}</td>
                      <td>
                        {row.asset_type === 'domain' ? (
                          <>
                            <div>{formatExpiryOn(publishedDomainExpiry(row.registrar_expires_at, row.registry_expires_at))}</div>
                            {row.auto_renew ? <div>Auto-renew reported. Not verified.</div> : null}
                          </>
                        ) : formatExpiryOn(row.certificate_expires_at)}
                        {typeof row.remaining_days === 'number' ? (
                          <div>{row.remaining_days} days until {row.asset_type === 'domain' ? 'registration expiry' : 'certificate expiry'}</div>
                        ) : null}
                      </td>
                      <td>{known(row.owner_name)}</td>
                      <td>{row.last_checked_at ? formatExpiryOn(row.last_checked_at) : 'Unknown'}</td>
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
