import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../context/ApiUrlContext';
import { recordReference } from '../../../../lib/recordRef';
import { epssLabel, lifecycleLabel, matchSourceLabel, patchLabel, queryText, reachabilityLabel, sessionCanManageVulnWorkspace, severityBadge, severityLabel, usageLabel, vulnRequest } from '../../../../lib/securityVuln';
import LinkedJiraWork from '../../../../components/LinkedJiraWork';

type Finding = {
  id: number;
  repository: string;
  service?: string;
  canonical_id: string;
  title: string;
  severity: string;
  priority: string;
  priority_reason: string;
  lifecycle: string;
  patch_state: string;
  confidence: string;
  ecosystem: string;
  package_name: string;
  installed_version: string;
  first_fixed_version?: string;
  recommended_version?: string;
  parent_package?: string;
  module_path?: string;
  path?: string;
  owner?: string;
  kev: boolean;
  pr_url?: string;
  change_ref?: string;
  source_url?: string;
  last_seen_at?: string;
  due_at?: string;
  commit_sha?: string;
  reachability?: string;
  match_source?: string;
  direct?: boolean;
  dev?: boolean;
  epss?: number;
  epss_percentile?: number;
  affected_ranges?: string[];
  overdue?: boolean;
  linked_change_id?: number;
  linked_incident_id?: number;
  linked_ticket_id?: number;
  linked_change?: string;
  linked_incident?: string;
  linked_ticket?: string;
};

type Activity = { kind: string; detail: string; created_at: string };
type ExceptionRow = { id: number; kind: string; reason: string; evidence?: string; issuer?: string; status: string; expires_at: string };

export default function VulnFindingDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = Number(queryText(router.query.id));
  const returnTo = queryText(router.query.return) || '/security/vulnerabilities?tab=findings';
  const [finding, setFinding] = useState<Finding | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [owner, setOwner] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [changeRef, setChangeRef] = useState('');
  const [incidentRef, setIncidentRef] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [exKind, setExKind] = useState('exception');
  const [exEvidence, setExEvidence] = useState('');
  const [exIssuer, setExIssuer] = useState('');
  const [exExpires, setExExpires] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const result = await vulnRequest(apiUrl, `/api/devops/security/findings/${id}`);
    if (result.status !== 200) {
      setError('That finding was not found in your authorized projects.');
      setFinding(null);
      return;
    }
    const item = result.body.finding as Finding;
    setFinding(item);
    setOwner(item.owner || '');
    setDueAt(item.due_at ? item.due_at.slice(0, 10) : '');
    setPrUrl(item.pr_url || '');
    setChangeRef(item.linked_change || item.change_ref || '');
    setIncidentRef(item.linked_incident || '');
    setTicketRef(item.linked_ticket || '');
    setActivity(Array.isArray(result.body.activity) ? result.body.activity as Activity[] : []);
    setExceptions(Array.isArray(result.body.exceptions) ? result.body.exceptions as ExceptionRow[] : []);
  }, [apiUrl, id]);

  useEffect(() => {
    setIsManager(sessionCanManageVulnWorkspace());
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [load, router.isReady]);

  async function patch(body: Record<string, string>) {
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/findings/${id}`, 'PATCH', body);
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The update was not accepted.');
      return;
    }
    setNotice('Saved.');
    await load();
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    await patch({ owner, due_at: dueAt, pr_url: prUrl, change_ref: changeRef, incident_ref: incidentRef, ticket_ref: ticketRef, reason, lifecycle: finding?.lifecycle || 'open' });
  }

  async function verify() {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/findings/${id}/verify`, 'POST', {});
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Rescan could not be queued.');
      return;
    }
    setNotice('Rescan queued. Fixed is only set after the scoped scan succeeds.');
    await load();
  }

  async function submitException(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/findings/${id}/exceptions`, 'POST', {
      kind: exKind, reason, evidence: exEvidence, issuer: exIssuer, expires_at: exExpires,
    });
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The exception was not accepted.');
      return;
    }
    setNotice('Exception recorded. This is not Fixed.');
    setExEvidence('');
    setExExpires('');
    await load();
  }

  return (
    <DevOpsLayout>
      <Head>
        <title>{finding ? `${finding.canonical_id} - Vulnerabilities` : 'Finding - OpsTrellis'}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security</span>
            <h1 className="portal-page__title">{finding?.canonical_id || 'Finding'}</h1>
            <p className="portal-page__subtitle">{finding?.title || 'Repository dependency evidence. This is not proof of production exposure.'}</p>
            {finding?.patch_state === 'fix_available' ? <p className="form-section__copy"><span className="sec-sev sec-sev--high">Patch now available</span> A source-supported fix is listed. Tests are still required. This is not production-fixed.</p> : null}
          </div>
          <Link className="btn btn-secondary" href={returnTo.startsWith('/security/vulnerabilities') ? returnTo : '/security/vulnerabilities?tab=findings'}>Back to findings</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {finding ? (
          <>
            <dl className="sre-meta">
              <div className="sre-meta__item"><dt>Severity</dt><dd><span className={severityBadge(finding.severity)}>{severityLabel(finding.severity)}</span></dd></div>
              <div className="sre-meta__item"><dt>State</dt><dd>{lifecycleLabel(finding.lifecycle)}</dd></div>
              <div className="sre-meta__item"><dt>Priority</dt><dd>{finding.priority} · {finding.priority_reason || 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Confidence</dt><dd>{finding.confidence.replace(/_/g, ' ')}</dd></div>
              <div className="sre-meta__item"><dt>Reachability</dt><dd>{reachabilityLabel(finding.reachability)}{finding.reachability === 'not_imported' ? ' · not a not-affected claim' : ''}</dd></div>
              <div className="sre-meta__item"><dt>Origin</dt><dd>{matchSourceLabel(finding.match_source)}{finding.match_source === 'intel' ? ' · public advisory matched the stored inventory; the lockfile was not fetched again' : ''}</dd></div>
              <div className="sre-meta__item"><dt>KEV</dt><dd>{finding.kev ? 'Known exploitation' : 'Not listed'}</dd></div>
              <div className="sre-meta__item"><dt>EPSS</dt><dd>{epssLabel(finding.epss, finding.epss_percentile)}</dd></div>
              <div className="sre-meta__item"><dt>Due</dt><dd>{finding.overdue ? <span className="sec-sev sec-sev--critical">Overdue</span> : null}{finding.overdue ? ' ' : ''}{finding.due_at ? formatOperationalTime(finding.due_at) : 'None'}</dd></div>
              <div className="sre-meta__item"><dt>Last seen</dt><dd>{finding.last_seen_at ? formatOperationalTime(finding.last_seen_at) : 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Linked change</dt><dd>{finding.linked_change_id ? <Link href={`/changes/${finding.linked_change_id}`}>{finding.linked_change || recordReference('CHG', finding.linked_change_id)}</Link> : 'None'}</dd></div>
              <div className="sre-meta__item"><dt>Linked incident</dt><dd>{finding.linked_incident_id ? <Link href={`/incidents/${finding.linked_incident_id}/edit`}>{finding.linked_incident || recordReference('INC', finding.linked_incident_id)}</Link> : 'None'}</dd></div>
              <div className="sre-meta__item"><dt>Linked ticket</dt><dd>{finding.linked_ticket_id ? <Link href={`/tickets?id=${finding.linked_ticket_id}`}>{finding.linked_ticket || recordReference('REQ', finding.linked_ticket_id)}</Link> : 'None'}</dd></div>
            </dl>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Evidence</h2>
                  <p className="portal-surface__subtitle">Lockfile path, installed package, and advisory range from the stored inventory. This is not a live clone.</p>
                </div>
              </div>
              <dl className="sre-meta">
                <div className="sre-meta__item"><dt>Package</dt><dd>{finding.ecosystem} {finding.package_name}@{finding.installed_version || 'unresolved'}</dd></div>
                <div className="sre-meta__item"><dt>Usage</dt><dd>{usageLabel(finding)}</dd></div>
                <div className="sre-meta__item"><dt>Repository</dt><dd>{finding.repository || 'Unknown'}</dd></div>
                <div className="sre-meta__item"><dt>Service</dt><dd>{finding.service || 'Unknown'}</dd></div>
                <div className="sre-meta__item"><dt>Module</dt><dd>{finding.module_path || '/'}</dd></div>
                <div className="sre-meta__item"><dt>Lockfile</dt><dd>{finding.path || 'Unknown'}</dd></div>
                <div className="sre-meta__item"><dt>Commit</dt><dd>{finding.commit_sha ? finding.commit_sha.slice(0, 12) : 'Unknown'}</dd></div>
                <div className="sre-meta__item"><dt>Advisory</dt><dd>{finding.source_url ? <a href={finding.source_url} target="_blank" rel="noreferrer">{finding.canonical_id}</a> : finding.canonical_id}</dd></div>
                <div className="sre-meta__item"><dt>Advisory range</dt><dd>{(finding.affected_ranges || []).length ? finding.affected_ranges?.join(' · ') : 'Unknown'}</dd></div>
              </dl>
            </section>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Patch</h2>
                  <p className="portal-surface__subtitle">First fixed version and recommended candidate stay separate. Compatibility is not claimed from the version number alone.</p>
                </div>
              </div>
              <dl className="sre-meta">
                <div className="sre-meta__item"><dt>Patch state</dt><dd>{patchLabel(finding.patch_state)}</dd></div>
                <div className="sre-meta__item"><dt>First fixed version</dt><dd>{finding.first_fixed_version || 'No known fix'}</dd></div>
                <div className="sre-meta__item"><dt>Recommended candidate</dt><dd>{finding.recommended_version || 'None'} · tests required</dd></div>
                <div className="sre-meta__item"><dt>Parent to upgrade</dt><dd>{finding.parent_package || 'Direct dependency'}</dd></div>
              </dl>
            </section>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Remediation</h2>
                  <p className="portal-surface__subtitle">Link a PR, change, incident, or ticket. Linked work is not Fixed. Request a rescan to verify the repository.</p>
                </div>
              </div>
              <form className="portal-form-grid" onSubmit={onSave}>
                <label className="label">Owner<input className="input" value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
                <label className="label">Due<input className="input" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
                <label className="label">Pull request URL<input className="input" value={prUrl} onChange={(event) => setPrUrl(event.target.value)} /></label>
                <label className="label">Change<input className="input" value={changeRef} onChange={(event) => setChangeRef(event.target.value)} placeholder="CHG0000001" /></label>
                <label className="label">Incident<input className="input" value={incidentRef} onChange={(event) => setIncidentRef(event.target.value)} placeholder="INC0000001" /></label>
                <label className="label">Ticket<input className="input" value={ticketRef} onChange={(event) => setTicketRef(event.target.value)} placeholder="REQ0000001" /></label>
                <label className="label">Note<input className="input" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void patch({ lifecycle: 'acknowledged', reason })}>Acknowledge</button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void verify()}>Request rescan</button>
                </div>
              </form>
            </section>
            {finding ? (
              <LinkedJiraWork
                apiUrl={apiUrl}
                source={{
                  sourceType: 'security_finding',
                  sourceId: finding.id,
                  defaultSummary: finding.title,
                  defaultDescription: finding.title,
                }}
              />
            ) : null}
            <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Exception / VEX</h2>
                    <p className="portal-surface__subtitle">{isManager ? 'Time-limited risk acceptance. Expiry returns the finding to review. This never marks Fixed.' : 'You can request an exception. A manager must activate it. This never marks Fixed.'}</p>
                  </div>
                </div>
                {exceptions.length ? (
                  <ul className="sre-monitor-list">
                    {exceptions.map((item) => (
                      <li key={item.id}>
                        <strong>{item.kind.replace(/_/g, ' ')} · {item.status}</strong>
                        <span>{item.reason} · expires {formatOperationalTime(item.expires_at)}{item.issuer ? ` · ${item.issuer}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="form-section__copy">No exceptions recorded.</p>}
                <form className="portal-form-grid" onSubmit={(event) => void submitException(event)}>
                  <label className="label">Kind
                    <select className="input" value={exKind} onChange={(event) => setExKind(event.target.value)}>
                      <option value="exception">Exception</option>
                      <option value="vex_not_affected">VEX not affected</option>
                      <option value="vex_mitigated">VEX mitigated</option>
                    </select>
                  </label>
                  <label className="label">Issuer<input className="input" value={exIssuer} onChange={(event) => setExIssuer(event.target.value)} /></label>
                  <label className="label">Evidence<input className="input" value={exEvidence} onChange={(event) => setExEvidence(event.target.value)} /></label>
                  <label className="label">Expires<input className="input" type="date" value={exExpires} onChange={(event) => setExExpires(event.target.value)} required /></label>
                  <div className="portal-form-actions">
                    <button type="submit" className="btn btn-secondary" disabled={busy}>{isManager ? 'Record exception' : 'Request exception'}</button>
                  </div>
                </form>
              </section>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Activity</h2>
                </div>
              </div>
              {activity.length ? (
                <ul className="sre-monitor-list">
                  {activity.map((item, index) => (
                    <li key={`${item.kind}-${index}`}>
                      <strong>{item.kind.replace(/_/g, ' ')}</strong>
                      <span>{item.detail} · {formatOperationalTime(item.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="form-section__copy">No activity recorded yet.</p>}
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
