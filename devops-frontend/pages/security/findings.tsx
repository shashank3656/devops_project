import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { actorId, deskCall, sessionRole } from '../../components/deskClient';
import { useApiUrl } from '../../context/ApiUrlContext';
import { canCloseFinding, nextFindingAction, textField } from '../../lib/securityDesk';
import { asRecord } from '../../lib/payload';
import { deskCanWrite } from '../../shared-ui/deskRules';
import CollectionStatus, { collectionStateFromSync } from '../../components/CollectionStatus';
import { EmptyState } from '@infragate/ui';

interface LoadedFinding {
  id: number;
  projectId: number;
  state: string;
  coverage: string;
  rescanState: string;
  latestResult: string;
  evidence: string;
  checkId: string;
  resourceId: string;
}

interface MonitorFindingRow {
  id: number;
  service_id: number;
  service: string;
  project_name?: string;
  environment: string;
  severity: string;
  lifecycle: string;
  title: string;
  last_seen_at?: string;
  last_evaluated_at?: string;
  incident_id?: number;
}

interface CloudFindingRow {
  id: number;
  project_id: number;
  check_id: string;
  resource_id: string;
  state: string;
  latest_result: string;
  coverage: string;
}

function safeStatus(status: number): string {
  if (status === 404) return 'That finding was not found in this project.';
  if (status === 403) return 'This action is not permitted.';
  return 'The request was not accepted.';
}

export default function FindingsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [canWrite, setCanWrite] = useState(false);
  const [findingId, setFindingId] = useState('');
  const [finding, setFinding] = useState<LoadedFinding | null>(null);
  const [monitorFindings, setMonitorFindings] = useState<MonitorFindingRow[]>([]);
  const [cloudFindings, setCloudFindings] = useState<CloudFindingRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [lifecycle, setLifecycle] = useState('open');
  const [severity, setSeverity] = useState('');
  const [owner, setOwner] = useState('Unknown');
  const [expiry, setExpiry] = useState('Unknown');
  const [serviceId, setServiceId] = useState('');
  const [fixNote, setFixNote] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionEvidence, setExceptionEvidence] = useState('');
  const [exceptionControl, setExceptionControl] = useState('');
  const [exceptionEnvironment, setExceptionEnvironment] = useState('');
  const [exceptionExpiry, setExceptionExpiry] = useState('');
  const [approverId, setApproverId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setCanWrite(deskCanWrite(sessionRole()));
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const open = String(router.query.open || '') === '1';
    const sev = typeof router.query.severity === 'string' ? router.query.severity : '';
    const life = typeof router.query.lifecycle === 'string' ? router.query.lifecycle : open ? 'open' : 'open';
    const id = typeof router.query.finding_id === 'string' ? router.query.finding_id : '';
    setSeverity(sev);
    setLifecycle(life);
    if (id) setFindingId(id.replace(/\D/g, ''));
  }, [router.isReady, router.query.finding_id, router.query.lifecycle, router.query.open, router.query.severity]);

  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem('devops_token');
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const monitorQuery = new URLSearchParams();
    if (lifecycle) monitorQuery.set('lifecycle', lifecycle);
    if (severity) monitorQuery.set('severity', severity);
    const cloudQuery = new URLSearchParams();
    if (lifecycle === 'open') cloudQuery.set('open', '1');
    else if (lifecycle) cloudQuery.set('state', lifecycle);
    setListLoading(true);
    setListFailed(false);
    Promise.all([
      fetch(`${apiUrl}/api/devops/monitor-findings?${monitorQuery.toString()}`, { headers }).then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) })),
      fetch(`${apiUrl}/api/findings?${cloudQuery.toString()}`, { headers }).then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) })),
    ])
      .then(([monitorResult, cloudResult]) => {
        setListFailed(!monitorResult.ok && !cloudResult.ok);
        setMonitorFindings(Array.isArray(monitorResult.body?.findings) ? monitorResult.body.findings : []);
        const cloudRows = Array.isArray(cloudResult.body?.findings) ? cloudResult.body.findings : Array.isArray(cloudResult.body) ? cloudResult.body : [];
        setCloudFindings(cloudRows.filter((item: { id?: number }) => typeof item.id === 'number'));
      })
      .catch(() => {
        setListFailed(true);
        setMonitorFindings([]);
        setCloudFindings([]);
      })
      .finally(() => setListLoading(false));
  }, [apiUrl, lifecycle, router.isReady, severity]);

  const visibleMonitor = useMemo(() => monitorFindings, [monitorFindings]);
  const findingsLastSuccess = useMemo(() => {
    const stamps = [
      ...monitorFindings.map((item) => item.last_evaluated_at || item.last_seen_at || ''),
    ].filter(Boolean).sort();
    return stamps.at(-1) || '';
  }, [monitorFindings]);
  const findingsCollection = collectionStateFromSync({
    connected: !listFailed,
    failed: listFailed,
    lastSuccess: findingsLastSuccess,
    empty: !monitorFindings.length && !cloudFindings.length,
  });

  const gate = finding ? canCloseFinding(finding.coverage, finding.rescanState, finding.latestResult) : { allowed: false, reason: 'Load a finding before choosing a next action.' };
  const action = finding ? nextFindingAction(finding.state, finding.coverage, finding.rescanState, finding.latestResult) : 'Load a finding to see evidence, owner, and the next action.';

  async function loadFindingFor(id: string) {
    setError('');
    setNotice('');
    setFinding(null);
    setOwner('Unknown');
    setExpiry('Unknown');
    if (!id) return;
    const result = await deskCall(apiUrl, `/api/findings?finding_id=${encodeURIComponent(id)}`, 'GET');
    if (result.status !== 200) {
      setError(safeStatus(result.status));
      return;
    }
    const body = asRecord(result.body);
    const observations = Array.isArray(body.observations) ? body.observations : [];
    const latest = observations.length > 0 ? asRecord(observations[observations.length - 1]) : {};
    setFinding({
      id: Number(body.id) || 0,
      projectId: Number(body.project_id) || 0,
      state: textField(body, 'state') || 'unknown',
      coverage: textField(body, 'coverage') || 'unknown',
      rescanState: textField(body, 'rescan_state') || 'unknown',
      latestResult: textField(body, 'latest_result') || 'unknown',
      evidence: textField(latest, 'evidence') || 'Unknown',
      checkId: textField(body, 'check_id') || 'Unknown',
      resourceId: textField(body, 'resource_id') || 'Unknown',
    });
  }

  async function nameOwner() {
    if (!finding || !canWrite || !serviceId) return;
    const result = await deskCall(apiUrl, '/api/remediation/assignments', 'POST', {
      project_id: finding.projectId,
      service_id: Number(serviceId),
      finding_key: String(finding.id),
      severity: '',
    });
    if (result.status !== 201 && result.status !== 200) {
      setError(safeStatus(result.status));
      return;
    }
    const body = asRecord(result.body);
    setOwner(textField(body, 'owner_team') || 'Unknown');
    const due = textField(body, 'due_at');
    if (due) setExpiry(due);
    setNotice('Owner recorded. Assignment is not acknowledgement and it is not cloud access.');
  }

  async function loadFinding() {
    await loadFindingFor(findingId);
  }

  async function recordException() {
    if (!finding || !canWrite) return;
    const approver = Number(approverId);
    if (owner === 'Unknown') {
      setError('Name an owner before recording an exception.');
      return;
    }
    if (!exceptionReason.trim() || !exceptionEvidence.trim() || !exceptionControl.trim() || !exceptionEnvironment.trim() || !exceptionExpiry || !approver || approver === actorId()) {
      setError('An exception needs one environment, a reason, a compensating control, evidence, a future expiry, and a different approver.');
      return;
    }
    const result = await deskCall(apiUrl, '/api/remediation/exceptions', 'POST', {
      project_id: finding.projectId,
      finding_key: String(finding.id),
      environment: exceptionEnvironment.trim(),
      reason: exceptionReason.trim(),
      compensating_control: exceptionControl.trim(),
      evidence: exceptionEvidence.trim(),
      approver_user_id: approver,
      expires_at: new Date(exceptionExpiry).toISOString(),
    });
    if (result.status !== 201) {
      setError(safeStatus(result.status));
      return;
    }
    const body = asRecord(result.body);
    setExpiry(textField(body, 'expires_at') || exceptionExpiry);
    setNotice(body.access_granted === true ? 'The exception response was not accepted.' : 'Exception recorded. Cloud access was not granted.');
  }

  async function closeFinding() {
    if (!finding || !canWrite || !gate.allowed) {
      setError(gate.reason);
      return;
    }
    const result = await deskCall(apiUrl, '/api/findings/close', 'POST', {
      finding_id: finding.id,
      reason: 'verified rescan',
    });
    if (result.status !== 200) {
      setError(safeStatus(result.status));
      return;
    }
    setFinding({ ...finding, state: 'closed' });
    setNotice('Finding closed after a verified rescan. Closure does not grant cloud access.');
  }

  return (
    <DevOpsLayout>
      <Head><title>Findings</title></Head>
      <div className="portal-page desk-landing">
        <header className="portal-page__header">
          <div>
            <h1 className="portal-page__title">Findings</h1>
            <p className="portal-page__subtitle">Open monitor and cloud findings. Empty coverage stays Unknown, never Secure. An exception is not cloud access.</p>
            {!listLoading ? (
              <CollectionStatus
                source="Monitor findings · Cloud scan"
                lastSuccess={findingsLastSuccess}
                state={findingsCollection}
                detail="Empty coverage stays Unknown, never Secure."
              />
            ) : null}
          </div>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert">{notice}</div> : null}
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <h2 className="portal-surface__title">Open findings</h2>
              <p className="portal-surface__subtitle">Filter the inventory. ID lookup stays below for a specific cloud finding.</p>
            </div>
          </div>
          <form className="iam-filters" onSubmit={(event) => event.preventDefault()}>
            <label>
              Lifecycle
              <select className="input" value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="">All</option>
              </select>
            </label>
            <label>
              Severity
              <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </select>
            </label>
          </form>
          {listLoading ? <div className="empty-state">Loading findings...</div> : null}
          {!listLoading && !visibleMonitor.length && !cloudFindings.length ? (
            <EmptyState
              title="No findings in this view"
              body="Missing telemetry stays Unknown, never Secure. Open a service monitor or run a cloud scan to record findings."
              action={<Link href="/services" className="btn btn-primary btn-sm">Open service inventory</Link>}
            />
          ) : null}
          {visibleMonitor.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Finding</th>
                  <th>Service</th>
                  <th>Severity</th>
                  <th>State</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {visibleMonitor.map((item) => (
                  <tr key={`monitor-${item.id}`}>
                    <td>
                      <strong>{item.title || `Finding ${item.id}`}</strong>
                      <div className="ig-cell-meta">{item.environment || 'Environment unknown'}</div>
                    </td>
                    <td>
                      {item.service_id ? (
                        <Link href={`/services/${item.service_id}`}>{item.service || `Service ${item.service_id}`}</Link>
                      ) : (item.service || 'Unknown')}
                    </td>
                    <td>{item.severity || 'Unknown'}</td>
                    <td>{item.lifecycle || 'Unknown'}</td>
                    <td>{item.last_evaluated_at || item.last_seen_at || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {cloudFindings.length ? (
            <table className="templates-table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Cloud finding</th>
                  <th>Resource</th>
                  <th>State</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {cloudFindings.map((item) => (
                  <tr key={`cloud-${item.id}`} style={{ cursor: 'pointer' }} onClick={() => { setFindingId(String(item.id)); void loadFindingFor(String(item.id)); }}>
                    <td><strong>#{item.id}</strong> · {item.check_id || 'Unknown check'}</td>
                    <td>{item.resource_id || 'Unknown'}</td>
                    <td>{item.state || 'Unknown'}</td>
                    <td>{item.coverage || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
        <form className="portal-surface" onSubmit={(event) => { event.preventDefault(); void loadFinding(); }}>
          <label className="label">Finding id
            <input className="input" value={findingId} onChange={(event) => setFindingId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </label>
          <div className="portal-page__actions">
            <button className="btn btn-primary" type="submit" disabled={!findingId} title={findingId ? 'Load finding' : 'Enter a finding id to continue.'}>Load finding</button>
            {!findingId ? <span className="blocked-action__reason">Enter a finding id to continue.</span> : null}
          </div>
        </form>
        {finding ? (
          <section className="portal-surface">
            <dl className="security-facts">
              <div><dt>Evidence</dt><dd>{finding.evidence}</dd></div>
              <div><dt>Owner</dt><dd>{owner}</dd></div>
              <div><dt>Expiry</dt><dd>{expiry}</dd></div>
              <div><dt>Next action</dt><dd>{action}</dd></div>
            </dl>
            <p className="portal-page__subtitle">{finding.checkId} · {finding.resourceId} · {finding.state} · coverage {finding.coverage} · rescan {finding.rescanState}</p>
            <div className="portal-field-grid portal-field-grid--two">
              <label className="label">Service id for the owner
                <input className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
              </label>
              <label className="label">Fix note
                <textarea className="input" value={fixNote} onChange={(event) => setFixNote(event.target.value)} />
              </label>
            </div>
            <p className="portal-page__subtitle">A fix note does not deploy. A change request is not execution. Close waits for a verified rescan.</p>
            <div className="portal-page__actions">
              <button className="btn btn-secondary" type="button" disabled={!canWrite || !serviceId} title={!canWrite ? 'Your role cannot change this finding.' : !serviceId ? 'Enter a service id to continue.' : 'Name owner'} onClick={() => void nameOwner()}>Name owner</button>
              <Link className="btn btn-secondary" href="/changes/new">Open a change request</Link>
              <button className="btn btn-primary" type="button" disabled={!canWrite || !gate.allowed} title={!canWrite ? 'Your role cannot close this finding.' : gate.reason || 'Close after a verified rescan'} onClick={() => void closeFinding()}>Close after verified rescan</button>
            </div>
            {!canWrite ? <p className="blocked-action__reason">Your role cannot change this finding.</p> : !serviceId ? <p className="blocked-action__reason">Enter a service id to name an owner.</p> : null}
            <p>{gate.reason}</p>
            <h2 className="portal-surface__title">Exception</h2>
            <div className="portal-field-grid portal-field-grid--two">
              <label className="label">Reason
                <input className="input" value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} />
              </label>
              <label className="label">Environment
                <input className="input" value={exceptionEnvironment} onChange={(event) => setExceptionEnvironment(event.target.value)} placeholder="One environment" />
              </label>
              <label className="label">Compensating control
                <input className="input" value={exceptionControl} onChange={(event) => setExceptionControl(event.target.value)} />
              </label>
              <label className="label">Evidence
                <input className="input" value={exceptionEvidence} onChange={(event) => setExceptionEvidence(event.target.value)} />
              </label>
              <label className="label">Expiry
                <input className="input" type="datetime-local" value={exceptionExpiry} onChange={(event) => setExceptionExpiry(event.target.value)} />
              </label>
              <label className="label">Approver user id
                <input className="input" value={approverId} onChange={(event) => setApproverId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
              </label>
            </div>
            <div className="portal-page__actions">
              <button className="btn btn-secondary" type="button" disabled={!canWrite} onClick={() => void recordException()}>Record exception</button>
            </div>
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
