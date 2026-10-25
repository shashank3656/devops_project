import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type Observation = {
  source: string;
  observed_at: string;
  observation_point: string;
  leaf_fingerprint?: string;
  issuer?: string;
  not_after?: string;
  registrar_expires_at?: string;
  registry_expires_at?: string;
  assessment: string;
  detail: string;
  hostname_ok?: boolean;
  chain_ok?: boolean;
  auto_renew?: boolean | null;
  manual?: boolean;
};

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
  coverage: string;
  latest?: Observation;
  observations?: Observation[];
  renewal_cases?: { id: number; state: string; change_ref: string; note: string }[];
};

function known(value: string | undefined): string {
  return (value || '').trim() || 'Unknown';
}

export default function CertificateAssetDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = Number(router.query.id);
  const [tab, setTab] = useState('overview');
  const [item, setItem] = useState<Asset | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [manualDate, setManualDate] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [changeRef, setChangeRef] = useState('');
  const [archiveReason, setArchiveReason] = useState('');

  const load = () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !id) return;
    fetch(`${apiUrl}/api/expiry/assets/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'That asset is not available.');
          return;
        }
        setItem(data.asset);
        setError('');
      })
      .catch(() => setError('That asset is not available.'));
  };

  useEffect(() => { load(); }, [apiUrl, id]);

  const post = async (path: string, body: Record<string, unknown>, success: string, method = 'POST') => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !id) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/expiry/assets/${id}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : success);
        return;
      }
      if (data.asset) setItem(data.asset);
      setNote(success);
      if (path === 'check') {
        setTimeout(load, 2500);
      }
    } catch {
      setError(success);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>{item ? item.display_name : 'Certificate or domain'}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">{item ? known(item.display_name) : 'Asset'}</h1>
            <p className="portal-page__subtitle">{item ? `${item.asset_type === 'certificate' ? 'Certificate endpoint' : 'Registered domain'} · ${known(item.environment)} · ${known(item.service_name)}` : 'Loading evidence.'}</p>
          </div>
          <Link href="/certificates" className="btn btn-secondary">All assets</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        {!item ? <div className="empty-state">Loading asset…</div> : (
          <>
            <div className="portal-pill-row">
              <span className="portal-pill">{known(item.assessment)}</span>
              <span className="portal-pill">Renewal {known(item.renewal_state)}</span>
              <span className="portal-pill">{known(item.owner_name)}</span>
            </div>
            <p className="access-hint">{item.coverage}</p>
            <div className="portal-tabs">
              {['overview', 'evidence', 'renewal', 'history'].map((key) => (
                <button key={key} type="button" className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>{key[0].toUpperCase() + key.slice(1)}</button>
              ))}
            </div>
            {tab === 'overview' ? (
              <section className="portal-surface">
                {item.asset_type === 'certificate' ? (
                  <>
                    <p>Endpoint {known(item.hostname)}:{item.port || 443}</p>
                    <p>Leaf expiry {item.latest?.not_after || 'Unknown'}</p>
                    <p>Issuer {known(item.latest?.issuer)}</p>
                    <p>Hostname check {item.latest?.hostname_ok ? 'Matched' : 'Failed or Unknown'} · Chain {item.latest?.chain_ok ? 'Valid' : 'Failed or Unknown'}</p>
                  </>
                ) : (
                  <>
                    <p>Registered domain {known(item.registered_domain)}</p>
                    <p>Registrar expiry {item.latest?.registrar_expires_at || 'Unknown'}</p>
                    <p>Registry expiry {item.latest?.registry_expires_at || 'Unknown'}</p>
                    <p>Auto-renew {item.latest?.auto_renew ? 'Reported. Not verified.' : 'Unknown'}</p>
                  </>
                )}
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void post('check', {}, 'Check queued. The page will refresh from saved evidence.')}>Check now</button>
              </section>
            ) : null}
            {tab === 'evidence' ? (
              <section className="portal-surface">
                <p>{known(item.latest?.detail)}</p>
                <p>Fingerprint {known(item.latest?.leaf_fingerprint)}</p>
                <p>Observation point {known(item.latest?.observation_point)}</p>
                <form onSubmit={(event: FormEvent) => { event.preventDefault(); void post('manual', { expires_at: new Date(manualDate).toISOString(), note: manualNote, source: 'manual' }, 'Manual evidence saved. Verification is still due.'); }}>
                  <h3>Manual evidence</h3>
                  <label className="label">UTC expiration
                    <input className="input" type="datetime-local" value={manualDate} onChange={(event) => setManualDate(event.target.value)} required />
                  </label>
                  <label className="label">Reviewer note
                    <input className="input" value={manualNote} onChange={(event) => setManualNote(event.target.value)} />
                  </label>
                  <button type="submit" className="btn btn-secondary" disabled={saving}>Save manual evidence</button>
                </form>
              </section>
            ) : null}
            {tab === 'renewal' ? (
              <section className="portal-surface">
                {(item.renewal_cases || []).map((row) => (
                  <p key={row.id}>{known(row.state)} · {known(row.change_ref)} · {known(row.note)}</p>
                ))}
                <form onSubmit={(event) => { event.preventDefault(); void post('renewal-cases', { state: 'awaiting_verification', change_ref: changeRef, note: 'Awaiting a fresh observation.' }, 'Marked awaiting verification.'); }}>
                  <label className="label">Linked change
                    <input className="input" value={changeRef} onChange={(event) => setChangeRef(event.target.value)} placeholder="CHG0000001" />
                  </label>
                  <button type="submit" className="btn btn-secondary" disabled={saving}>Await verification</button>
                </form>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void post('verify', {}, 'Verified from the latest non-manual observation.')}>Verify from latest observation</button>
                <form onSubmit={(event) => { event.preventDefault(); void post('archive', { reason: archiveReason }, 'Archived. This is not Renewed.'); }}>
                  <input className="input" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Archive reason" />
                  <button type="submit" className="btn btn-secondary" disabled={saving}>Archive</button>
                </form>
              </section>
            ) : null}
            {tab === 'history' ? (
              <section className="portal-surface">
                {(item.observations || []).map((row, index) => (
                  <p key={`${row.observed_at}-${index}`}>
                    {row.observed_at} · {known(row.source)} · {known(row.assessment)} · {known(row.detail)}
                    {row.manual ? ' · manual' : ''}
                  </p>
                ))}
                {!item.observations?.length ? <p>No observations yet. Coverage stays Unknown until a check stores evidence.</p> : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </DevOpsLayout>
  );
}
