import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  loadCertificateMembers,
  loadCertificateTeams,
  type CertificateMemberOption,
  type CertificateTeamOption,
} from '../../lib/certificateOwnership';
import { expiryZoneLabel, formatExpiryOn, remainingExpiryCopy } from '../../lib/expiryDisplay';

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
  owner_user_id?: number;
  team_id?: number;
  project_id?: number;
  remaining_days?: number | null;
  certificate_expires_at?: string;
  registrar_expires_at?: string;
  registry_expires_at?: string;
  paused?: boolean;
  paused_reason?: string;
  shared_count?: number;
  shared_asset_ids?: number[];
  assessment: string;
  renewal_state: string;
  coverage: string;
  collector?: string;
  latest?: Observation;
  observations?: Observation[];
  renewal_cases?: { id: number; state: string; change_ref: string; note: string }[];
  dns_proposals?: { id: number; change_ref: string; state: string; note: string; live_write: boolean; records?: { type: string; name: string; value: string; ttl: number; note: string }[] }[];
};

function known(value: string | undefined): string {
  return (value || '').trim() || 'Unknown';
}

function assetKind(item: Asset): 'certificate' | 'domain' {
  return item.asset_type === 'certificate' ? 'certificate' : 'domain';
}

function certificateExpiry(item: Asset): string {
  return item.certificate_expires_at || item.latest?.not_after || '';
}

function domainExpiry(item: Asset): string {
  return item.registrar_expires_at || item.latest?.registrar_expires_at || item.registry_expires_at || item.latest?.registry_expires_at || '';
}

function headerExpiry(item: Asset): string {
  const value = assetKind(item) === 'certificate' ? certificateExpiry(item) : domainExpiry(item);
  if (!value) return 'Expiry Unknown until a check stores evidence';
  return assetKind(item) === 'certificate'
    ? `Expires on ${formatExpiryOn(value)}`
    : `Registration expires on ${formatExpiryOn(value)}`;
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
  const [pauseReason, setPauseReason] = useState('');
  const [dnsNote, setDnsNote] = useState('');
  const [teams, setTeams] = useState<CertificateTeamOption[]>([]);
  const [members, setMembers] = useState<CertificateMemberOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');

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
        setTeamId(data.asset?.team_id ? String(data.asset.team_id) : '');
        setOwnerUserId(data.asset?.owner_user_id ? String(data.asset.owner_user_id) : '');
        setError('');
      })
      .catch(() => setError('That asset is not available.'));
  };

  useEffect(() => { load(); }, [apiUrl, id]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    let cancelled = false;
    setTeamsLoading(true);
    const scopedProject = item?.project_id ? String(item.project_id) : '';
    loadCertificateTeams(apiUrl, token, scopedProject)
      .then((rows) => {
        if (!cancelled) setTeams(rows);
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, item?.project_id]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !teamId) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    loadCertificateMembers(apiUrl, token, teamId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, teamId]);

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

  const saveOwner = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !id) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/expiry/assets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ team_id: Number(teamId) || 0, owner_user_id: Number(ownerUserId) || 0 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'The owner could not be saved.');
        return;
      }
      if (data.asset) setItem(data.asset);
      setNote('Owner saved. Reminder emails go to that person at 30, 14, 7, 3, and 1 days.');
    } catch {
      setError('The owner could not be saved.');
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
            <p className="portal-page__subtitle">{item ? `${item.asset_type === 'certificate' ? 'Certificate endpoint' : 'Registered domain'} · ${headerExpiry(item)}${item.environment ? ` · ${item.environment}` : ''}${item.service_name ? ` · ${item.service_name}` : ''}` : 'Loading evidence.'}</p>
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
              {item.paused ? <span className="portal-pill">Paused</span> : null}
              {item.shared_count && item.shared_count > 1 ? <span className="portal-pill">Shared cert on {item.shared_count} endpoints</span> : null}
            </div>
            <div className="portal-tabs">
              {['overview', 'evidence', 'renewal', 'history'].map((key) => (
                <button key={key} type="button" className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>{key[0].toUpperCase() + key.slice(1)}</button>
              ))}
            </div>
            {tab === 'overview' ? (
              <>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">{assetKind(item) === 'certificate' ? 'Certificate expiry' : 'Domain registration expiry'}</h2>
                  <dl className="expiry-facts">
                    <div className="expiry-facts__expires">
                      <dt>Expires on</dt>
                      <dd>
                        {formatExpiryOn(assetKind(item) === 'certificate' ? certificateExpiry(item) : domainExpiry(item))}
                        {assetKind(item) === 'certificate' || domainExpiry(item) ? ` · ${expiryZoneLabel()}` : ''}
                      </dd>
                    </div>
                    {assetKind(item) === 'certificate' ? (
                      <>
                        <div>
                          <dt>Endpoint</dt>
                          <dd>{known(item.hostname)}:{item.port || 443}</dd>
                        </div>
                        <div>
                          <dt>Issuer</dt>
                          <dd>{known(item.latest?.issuer)}</dd>
                        </div>
                        <div>
                          <dt>Hostname check</dt>
                          <dd>{item.latest?.hostname_ok ? 'Matched' : 'Failed or Unknown'}</dd>
                        </div>
                        <div>
                          <dt>Chain</dt>
                          <dd>{item.latest?.chain_ok ? 'Valid' : 'Failed or Unknown'}</dd>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <dt>Registered domain</dt>
                          <dd>{known(item.registered_domain || item.display_name)}</dd>
                        </div>
                        <div>
                          <dt>Registrar expiry</dt>
                          <dd>{formatExpiryOn(item.registrar_expires_at || item.latest?.registrar_expires_at)}</dd>
                        </div>
                        <div>
                          <dt>Registry expiry</dt>
                          <dd>{formatExpiryOn(item.registry_expires_at || item.latest?.registry_expires_at)}</dd>
                        </div>
                        <div>
                          <dt>Auto-renew</dt>
                          <dd>{item.latest?.auto_renew ? 'Reported. Not verified.' : 'Unknown'}</dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt>Remaining</dt>
                      <dd>{remainingExpiryCopy(item.remaining_days, assetKind(item))}</dd>
                    </div>
                  </dl>
                  {assetKind(item) === 'domain' ? (
                    <p className="access-hint">
                      This date is the domain registration, not the TLS certificate served on HTTPS.
                      Register a certificate endpoint to track leaf expiry.
                      {' '}
                      <Link href={`/certificates/new?asset_type=certificate&hostname=${encodeURIComponent(item.registered_domain || item.display_name || '')}${item.project_id ? `&project_id=${item.project_id}` : ''}${item.environment ? `&environment=${encodeURIComponent(item.environment)}` : ''}${item.service_name ? `&service=${encodeURIComponent(item.service_name)}` : ''}`}>
                        Register certificate endpoint
                      </Link>
                    </p>
                  ) : null}
                  {item.shared_count && item.shared_count > 1 ? (
                    <p className="access-hint">
                      Same fingerprint on {(item.shared_asset_ids || []).map((assetId) => (
                        <span key={assetId}><Link href={`/certificates/${assetId}`}>{assetId}</Link>{' '}</span>
                      ))}
                      A failing host stays its own row.
                    </p>
                  ) : null}
                  <p className="access-hint">{known(item.coverage)}</p>
                  {item.collector === 'private' ? <p className="access-hint">Private collector target. Check now does not probe from hosted. Coverage stays Unknown until the collector posts an observation.</p> : null}
                </section>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">Owner</h2>
                  <p className="access-hint">Owner is a team member name only. Emails are not shown. Reminder emails go to that person at 30, 14, 7, 3, and 1 days.</p>
                  <form onSubmit={saveOwner}>
                    <div className="portal-field-grid portal-field-grid--two">
                      <label className="label">Team
                        <select className="input" value={teamId} onChange={(event) => { setTeamId(event.target.value); setOwnerUserId(''); }} disabled={teamsLoading}>
                          <option value="">{teamsLoading ? 'Loading teams…' : 'Select a team'}</option>
                          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                        </select>
                      </label>
                      <label className="label">Owner
                        <select className="input" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} disabled={!teamId || membersLoading}>
                          <option value="">{!teamId ? 'Select a team first' : membersLoading ? 'Loading members…' : 'Select an owner'}</option>
                          {(ownerUserId && !members.some((member) => String(member.user_id) === ownerUserId)
                            ? [{ user_id: Number(ownerUserId) || 0, name: known(item.owner_name) }, ...members]
                            : members
                          ).filter((member) => member.user_id > 0).map((member) => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}
                        </select>
                      </label>
                    </div>
                    {!teamsLoading && !teams.length ? <p className="access-hint">No teams were returned for this workspace.</p> : null}
                    {teamId && !membersLoading && !members.length ? <p className="access-hint">This team has no members.</p> : null}
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-primary" disabled={saving}>Save owner</button>
                    </div>
                  </form>
                </section>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">Checks</h2>
                  <div className="portal-form-actions">
                    <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void post('check', {}, 'Check queued. The page will refresh from saved evidence.')}>Check now</button>
                    {item.paused ? (
                      <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void post('pause', { paused: false }, 'Scheduled checks resumed. Check now still works while paused.')}>Resume scheduled checks</button>
                    ) : null}
                  </div>
                  {item.paused && item.paused_reason ? <p className="access-hint">Paused: {item.paused_reason}</p> : null}
                  {!item.paused ? (
                    <form onSubmit={(event) => { event.preventDefault(); void post('pause', { paused: true, reason: pauseReason }, 'Scheduled checks paused. History stays. Check now still works.'); }}>
                      <div className="portal-field-grid portal-field-grid--two">
                        <label className="label">Pause reason
                          <input className="input" value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} placeholder="Why scheduled checks should stop" required />
                        </label>
                      </div>
                      <div className="portal-form-actions">
                        <button type="submit" className="btn btn-secondary" disabled={saving}>Pause scheduled checks</button>
                      </div>
                    </form>
                  ) : null}
                </section>
              </>
            ) : null}
            {tab === 'evidence' ? (
              <>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">Latest observation</h2>
                  <dl className="expiry-facts">
                    {item.latest?.not_after ? (
                      <div className="expiry-facts__expires">
                        <dt>Leaf expires on</dt>
                        <dd>{formatExpiryOn(item.latest.not_after)} · {expiryZoneLabel()}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Detail</dt>
                      <dd>{known(item.latest?.detail)}</dd>
                    </div>
                    <div>
                      <dt>Fingerprint</dt>
                      <dd>{known(item.latest?.leaf_fingerprint)}</dd>
                    </div>
                    <div>
                      <dt>Observation point</dt>
                      <dd>{known(item.latest?.observation_point)}</dd>
                    </div>
                  </dl>
                </section>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">Manual evidence</h2>
                  <p className="access-hint">Manual evidence is stored for review. Verification still needs a non-manual observation.</p>
                  <form onSubmit={(event: FormEvent) => { event.preventDefault(); void post('manual', { expires_at: new Date(manualDate).toISOString(), note: manualNote, source: 'manual' }, 'Manual evidence saved. Verification is still due.'); }}>
                    <div className="portal-field-grid portal-field-grid--two">
                      <label className="label">UTC expiration
                        <input className="input" type="datetime-local" value={manualDate} onChange={(event) => setManualDate(event.target.value)} required />
                      </label>
                      <label className="label">Reviewer note
                        <input className="input" value={manualNote} onChange={(event) => setManualNote(event.target.value)} />
                      </label>
                    </div>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-primary" disabled={saving}>Save manual evidence</button>
                    </div>
                  </form>
                </section>
              </>
            ) : null}
            {tab === 'renewal' ? (
              <>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">Renewal cases</h2>
                  <p className="access-hint">This portal does not renew the certificate and does not write DNS. Auto-renew stays unverified until a fresh served observation proves it.</p>
                  {(item.renewal_cases || []).length ? (
                    <ul>
                      {(item.renewal_cases || []).map((row) => (
                        <li key={row.id}>{known(row.state)} · {known(row.change_ref)} · {known(row.note)}</li>
                      ))}
                    </ul>
                  ) : <p className="access-hint">No renewal cases yet.</p>}
                  <form onSubmit={(event) => { event.preventDefault(); void post('renewal-cases', { state: 'awaiting_verification', change_ref: changeRef, note: 'Awaiting a fresh observation.' }, 'Marked awaiting verification.'); }}>
                    <div className="portal-field-grid portal-field-grid--two">
                      <label className="label">Linked change
                        <input className="input" value={changeRef} onChange={(event) => setChangeRef(event.target.value)} placeholder="CHG0000001" />
                      </label>
                    </div>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-secondary" disabled={saving}>Await verification</button>
                      <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void post('auto-renew', {}, 'Auto-renew is now tracked. It is not treated as completed renewal.')}>Track registrar auto-renew</button>
                      <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void post('verify', {}, 'Verified from the latest non-manual observation.')}>Verify from latest observation</button>
                    </div>
                  </form>
                </section>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">DNS records</h2>
                  {(item.dns_proposals || []).length ? (item.dns_proposals || []).map((row) => (
                    <div key={row.id}>
                      <p className="access-hint">{known(row.state)} · {known(row.change_ref)} · {known(row.note)}{row.live_write ? '' : ' · no live DNS write'}</p>
                      {(row.records || []).map((record, index) => (
                        <p key={`${row.id}-${index}`}>{record.type} {record.name} {record.value} ttl {record.ttl}</p>
                      ))}
                      {row.state === 'proposed' ? (
                        <div className="portal-form-actions">
                          <button type="button" className="btn btn-secondary" disabled={saving || !dnsNote.trim()} onClick={() => void post('dns-confirm', { proposal_id: row.id, note: dnsNote, live_write: false }, 'Recorded that DNS was applied outside this portal.')}>Confirm applied in DNS</button>
                        </div>
                      ) : null}
                    </div>
                  )) : <p className="access-hint">No DNS records proposed.</p>}
                  <form onSubmit={(event) => { event.preventDefault(); void post('dns-proposals', { note: dnsNote, live_write: false }, 'DNS records proposed. Nothing was written to DNS.'); }}>
                    <div className="portal-field-grid portal-field-grid--two">
                      <label className="label">DNS confirmation note
                        <input className="input" value={dnsNote} onChange={(event) => setDnsNote(event.target.value)} placeholder="Applied CAA in the registrar" />
                      </label>
                    </div>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-secondary" disabled={saving}>Propose DNS records</button>
                    </div>
                  </form>
                </section>
                <section className="portal-surface expiry-panel">
                  <h2 className="portal-surface__title">Archive</h2>
                  <p className="access-hint">Archive removes this from the active register. That is not Renewed.</p>
                  <form onSubmit={(event) => { event.preventDefault(); void post('archive', { reason: archiveReason }, 'Archived. This is not Renewed.'); }}>
                    <div className="portal-field-grid portal-field-grid--two">
                      <label className="label">Archive reason
                        <input className="input" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Why this asset should leave the active register" required />
                      </label>
                    </div>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-secondary" disabled={saving}>Archive</button>
                    </div>
                  </form>
                </section>
              </>
            ) : null}
            {tab === 'history' ? (
              <section className="portal-surface expiry-panel">
                <h2 className="portal-surface__title">Check history</h2>
                {(item.observations || []).length ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="templates-table">
                      <thead>
                        <tr>
                          <th>Observed</th>
                          <th>Source</th>
                          <th>Assessment</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(item.observations || []).map((row, index) => (
                          <tr key={`${row.observed_at}-${index}`}>
                            <td>{formatExpiryOn(row.observed_at)}</td>
                            <td>{known(row.source)}{row.manual ? ' · manual' : ''}</td>
                            <td>{known(row.assessment)}</td>
                            <td>{known(row.detail)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="access-hint">No observations yet. Coverage stays Unknown until a check stores evidence.</p>}
              </section>
            ) : null}
          </>
        )}
      </div>
    </DevOpsLayout>
  );
}
