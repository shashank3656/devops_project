import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import RecordDocuments from '../../components/RecordDocuments';
import ExecutionStage from '../../components/ExecutionStage';
import {
  buildPortalApiUrl,
  buildChangeDetailActions,
  ChangeDetailPanel,
  changeScopeIncomplete,
  DeliveryVisibilityCard,
  DeploymentVerificationCard,
  ReleaseReadinessCard,
  ResourceContextPanel,
  parsePortalNumericId,
  parsePortalPathSegment,
  portalFetch,
  type ChangeDetailModel,
  type DeliveryVisibility,
  type DeploymentVerification,
  type ReleaseEvidenceSnapshot,
  type ReleaseReadiness,
} from '@infragate/ui';
import { useApiUrl } from '../../context/ApiUrlContext';
import LinkedJiraWork from '../../components/LinkedJiraWork';

const DEVOPS_TOKEN_KEY = 'devops_token';
const CHANGE_STATUS_ACTIONS = new Set(['resolve', 'close', 'fail', 'cancel', 'reopen']);

function toLocalInput(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface ChangeBrief {
  headline?: string;
  changing?: { key: string; label: string; count: number }[];
  risk_because?: string[];
}

interface LinkedIncident {
  id: number;
  incident_number?: string;
  summary: string;
  severity: string;
  status: string;
}

interface ScopeProject {
  id: number;
  name: string;
  code: string;
  environments: string[];
}

function shortEvidenceSHA(sha?: string) {
  const value = (sha || '').trim();
  if (!value) return 'Unknown';
  return value.length > 12 ? value.slice(0, 12) : value;
}

function ReleaseEvidencePanel({
  evidence,
  currentSHA,
}: {
  evidence?: ReleaseEvidenceSnapshot | null;
  currentSHA?: string;
}) {
  if (!evidence) {
    return (
      <section className="release-readiness" aria-label="Release evidence snapshot">
        <div className="release-readiness__head">
          <strong>Release evidence snapshot</strong>
          <span className="delivery-status delivery-status--unknown">Not captured</span>
        </div>
        <p className="release-readiness__note">A snapshot is saved when this change is approved. Live readiness above is not a stored decision record.</p>
      </section>
    );
  }
  const invalidated = Boolean(evidence.invalidated);
  return (
    <section className="release-readiness" aria-label="Release evidence snapshot">
      <div className="release-readiness__head">
        <strong>Release evidence snapshot</strong>
        <span className={`delivery-status delivery-status--${invalidated ? 'failed' : 'ok'}`}>
          {invalidated ? 'Invalidated' : 'Captured'}
        </span>
      </div>
      <p className="release-readiness__note">
        {invalidated
          ? evidence.invalidated_reason || `A newer commit replaced ${shortEvidenceSHA(evidence.sha)}. Re-evaluate this evidence.`
          : 'This is the commit, approvals, checks, security, window, and rollback recorded for the approval decision.'}
      </p>
      <p className="release-readiness__evidence">
        Snapshot {shortEvidenceSHA(evidence.sha)}
        {currentSHA ? ` · current ${shortEvidenceSHA(currentSHA)}` : ''}
        {evidence.captured_at ? ` · captured ${evidence.captured_at}` : ''}
      </p>
      <ul className="release-readiness__list">
        <li>
          <span className="release-readiness__check">Approvals</span>
          <span className="release-readiness__detail">{evidence.approvals || 'Unknown'}</span>
        </li>
        <li>
          <span className="release-readiness__check">Checks</span>
          <span className="release-readiness__detail">{evidence.checks || 'Unknown'}</span>
        </li>
        <li>
          <span className="release-readiness__check">Security</span>
          <span className="release-readiness__detail">{evidence.security || 'Unknown'}</span>
        </li>
        <li>
          <span className="release-readiness__check">Deployment window</span>
          <span className="release-readiness__detail">{evidence.window || 'Unknown'}</span>
        </li>
        <li>
          <span className="release-readiness__check">Rollback plan</span>
          <span className="release-readiness__detail">{evidence.rollback || 'Unknown'}</span>
        </li>
      </ul>
    </section>
  );
}

export default function ChangeDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ChangeDetailModel | null>(null);
  const [brief, setBrief] = useState<ChangeBrief | null>(null);
  const [incidents, setIncidents] = useState<LinkedIncident[]>([]);
  const [blastRadius, setBlastRadius] = useState<string[]>([]);
  const [drift, setDrift] = useState<{ drifted?: boolean; detail?: string } | null>(null);
  const [delivery, setDelivery] = useState<DeliveryVisibility | null>(null);
  const [readiness, setReadiness] = useState<ReleaseReadiness | null>(null);
  const [verification, setVerification] = useState<DeploymentVerification | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [scopeProjects, setScopeProjects] = useState<ScopeProject[]>([]);
  const [scopeProjectId, setScopeProjectId] = useState('');
  const [scopeEnvironment, setScopeEnvironment] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [reloadAt, setReloadAt] = useState(0);
  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);
  const status = (item?.status || '').toLowerCase();
  const finished = status === 'resolved' || status === 'closed' || status === 'failed' || status === 'cancelled';

  const postAction = (suffix: string, actingKey: string, onSuccess?: (change: ChangeDetailModel) => void) => {
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!authToken || !resourceId) return;
    setActing(actingKey);
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}/${suffix}`), {
      method: 'POST',
      token: authToken,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || `Request failed (${suffix})`);
          return;
        }
        const change = (data.change as ChangeDetailModel | undefined) || item;
        if (change) setItem(change);
        if (change && onSuccess) onSuccess(change);
      })
      .catch(() => setError(`Request failed (${suffix})`))
      .finally(() => setActing(''));
  };

  const applyStatus = (action: string) => {
    const safeAction = parsePortalPathSegment(action, CHANGE_STATUS_ACTIONS);
    if (!safeAction) return;
    postAction(safeAction, action);
  };

  const applyRollout = (stage: string) => {
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const safeStage = parsePortalPathSegment(stage, new Set(['canary', '10', '50', '100']));
    if (!authToken || !resourceId || !safeStage) return;
    setActing(`rollout-${stage}`);
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}/rollout`), {
      method: 'POST',
      token: authToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: safeStage }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to update rollout');
          return;
        }
        if (data.change) setItem(data.change);
      })
      .catch(() => setError('Failed to update rollout'))
      .finally(() => setActing(''));
  };

  const saveScope = (event: FormEvent) => {
    event.preventDefault();
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const projectId = Number(scopeProjectId);
    const environment = scopeEnvironment.trim();
    if (!authToken || !resourceId || projectId <= 0 || !environment) {
      setError('Choose a project and environment from the catalog. The title is not used as scope.');
      return;
    }
    setActing('scope');
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}`), {
      method: 'PATCH',
      token: authToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, environment }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to record project and environment');
          return;
        }
        if (data.change) setItem(data.change);
      })
      .catch(() => setError('Failed to record project and environment'))
      .finally(() => setActing(''));
  };

  const applyRollback = () => {
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!authToken || !resourceId) return;
    setActing('rollback');
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}/rollback`), {
      method: 'POST',
      token: authToken,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to record rollback');
          return;
        }
        if (data.change?.id) void router.push(`/changes/${data.change.id}`);
      })
      .catch(() => setError('Failed to record rollback'))
      .finally(() => setActing(''));
  };

  useEffect(() => {
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!authToken) return;
    portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/me'), { token: authToken })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        const prof = data.devops_profile && typeof data.devops_profile === 'object' ? data.devops_profile : {};
        setIsManager(Boolean(prof.is_manager));
      })
      .catch(() => setIsManager(false));
  }, [apiUrl]);

  useEffect(() => {
    if (!resourceId) return;
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!authToken) return;
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}`), { token: authToken })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load change');
          return;
        }
        setItem(data.change || null);
        setBrief(data.change_brief || null);
        setIncidents(Array.isArray(data.linked_incidents) ? data.linked_incidents : []);
        setBlastRadius(Array.isArray(data.blast_radius) ? data.blast_radius : []);
        setDrift(data.drift && typeof data.drift === 'object' ? data.drift : null);
        setDelivery((data.delivery as DeliveryVisibility | undefined) ?? null);
        setReadiness((data.readiness as ReleaseReadiness | undefined) ?? null);
        setVerification((data.verification as DeploymentVerification | undefined) ?? null);
      })
      .catch(() => setError('Failed to load change'))
      .finally(() => setLoading(false));
  }, [apiUrl, resourceId, reloadAt]);

  useEffect(() => {
    if (!item) return;
    setScopeProjectId(item.project_id && item.project_id > 0 ? String(item.project_id) : '');
    const env = (item.environment || '').trim().toLowerCase();
    setScopeEnvironment(!env || env === 'unspecified' || env === 'unknown' ? '' : item.environment);
    setPlannedStart(toLocalInput(item.cab_window_start));
    setPlannedEnd(toLocalInput(item.cab_window_end));
  }, [item]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#window') return;
    document.getElementById('window')?.scrollIntoView({ block: 'start' });
  }, [item]);

  const saveWindow = (event: FormEvent) => {
    event.preventDefault();
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!authToken || !resourceId || !plannedStart.trim()) {
      setError('Select a planned start for the deployment window.');
      return;
    }
    setActing('window');
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}`), {
      method: 'PATCH',
      token: authToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planned_start: plannedStart, planned_end: plannedEnd }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to record the deployment window');
          return;
        }
        if (data.change) setItem(data.change);
        setReloadAt(Date.now());
      })
      .catch(() => setError('Failed to record the deployment window'))
      .finally(() => setActing(''));
  };

  useEffect(() => {
    if (!isManager || !item || !changeScopeIncomplete(item)) return;
    const authToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!authToken) return;
    portalFetch(buildPortalApiUrl(apiUrl, '/api/devops/projects'), { token: authToken })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data?.projects) ? data.projects : [];
        setScopeProjects(list
          .map((row: { id?: number; name?: string; code?: string; environments?: unknown }) => ({
            id: typeof row.id === 'number' ? row.id : 0,
            name: typeof row.name === 'string' ? row.name : '',
            code: typeof row.code === 'string' ? row.code : '',
            environments: Array.isArray(row.environments)
              ? row.environments.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
              : [],
          }))
          .filter((row: ScopeProject) => row.id > 0));
      })
      .catch(() => setScopeProjects([]));
  }, [apiUrl, isManager, item]);

  const detailActions = useMemo(() => {
    if (!item) return undefined;
    const base = buildChangeDetailActions(item, {
      portal: 'devops',
      isManager,
      canAuthorize: true,
      finished,
    });
    return {
      ...base,
      acting,
      onApprove: () => postAction('cab-approve', 'approve'),
      onSchedule: () => postAction('schedule', 'schedule'),
      onImplement: () => postAction('implement', 'implement'),
      onResolve: () => applyStatus('resolve'),
      onClose: () => applyStatus('close'),
      onFail: () => applyStatus('fail'),
      onCancel: () => applyStatus('cancel'),
      onReopen: () => applyStatus('reopen'),
      onRollout: applyRollout,
    };
  }, [item, isManager, finished, acting, apiUrl, resourceId]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.change_number || 'Change'} - OpsTrellis</title>
      </Head>
      <div className="work-page">
        <header className="work-page__head">
          <div>
            <p className="ops-kicker">{item?.change_number || 'Change request'}</p>
            <h1>{item?.title || (loading ? 'Loading change' : 'Change')}</h1>
            <p>
              {item
                ? [item.status, item.priority || item.risk_level || 'No priority', item.assignee_username ? `Owner ${item.assignee_username}` : 'Owner unassigned', changeScopeIncomplete(item) ? 'Scope incomplete' : (item.project_name || 'No project')].filter(Boolean).join(' · ')
                : 'Approval, schedule, and implementation for this change.'}
            </p>
            {item ? (
              <ExecutionStage
                status={item.status}
                recovery={
                  isManager && item.previous_sha ? (
                    <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={applyRollback}>
                      Roll back to {item.previous_sha.slice(0, 7)}
                    </button>
                  ) : (
                    <Link href="/changes/new" className="btn btn-secondary">Start a follow-up change</Link>
                  )
                }
              />
            ) : null}
          </div>
          <div className="request-actions" style={{ marginTop: 0 }}>
            {item && !finished && isManager && item.previous_sha ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={applyRollback}>
                {acting === 'rollback' ? 'Recording…' : `Roll back to ${item.previous_sha.slice(0, 7)}`}
              </button>
            ) : null}
            <Link href="/changes" className="btn btn-secondary">Back to changes</Link>
          </div>
        </header>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <p className="work-empty">Loading change…</p> : null}
        {item ? (
          <>
            <ReleaseReadinessCard readiness={readiness} />
            <ReleaseEvidencePanel evidence={item.release_evidence} currentSHA={item.sha} />
            <DeploymentVerificationCard verification={verification} />
            {isManager && !finished ? (
              <section className="work-board" id="window" aria-label="Deployment window">
                <h2 className="chg-detail__section-title">Deployment window</h2>
                <p className="chg-detail__hint">Release readiness stays unevaluated until a planned window is recorded. Saving a window does not deploy.</p>
                <form className="svc-filters" onSubmit={saveWindow}>
                  <label>
                    Planned start
                    <input className="input" type="datetime-local" value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} required />
                  </label>
                  <label>
                    Planned end
                    <input className="input" type="datetime-local" value={plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)} />
                  </label>
                  <div className="svc-filters__actions">
                    <button type="submit" className="btn btn-primary" disabled={!!acting || !plannedStart}>
                      {acting === 'window' ? 'Saving…' : 'Save window'}
                    </button>
                  </div>
                </form>
              </section>
            ) : null}
            {isManager && changeScopeIncomplete(item) ? (
              <section className="work-board" aria-label="Correct change scope">
                <h2 className="chg-detail__section-title">Record project and environment</h2>
                <p className="chg-detail__hint">Choose from the catalog. The title and description are not treated as the scope. Execution stays blocked until both are recorded.</p>
                <form className="svc-filters" onSubmit={saveScope}>
                  <label>
                    Project
                    <select className="input" value={scopeProjectId} onChange={(event) => { setScopeProjectId(event.target.value); setScopeEnvironment(''); }}>
                      <option value="">Select a project</option>
                      {scopeProjects.map((project) => (
                        <option key={project.id} value={project.id}>{project.code ? `${project.name} (${project.code})` : project.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Environment
                    <select className="input" value={scopeEnvironment} onChange={(event) => setScopeEnvironment(event.target.value)} disabled={!scopeProjectId}>
                      <option value="">{scopeProjectId ? 'Select an environment' : 'Select a project first'}</option>
                      {(scopeProjects.find((project) => String(project.id) === scopeProjectId)?.environments || []).map((environment) => (
                        <option key={environment} value={environment}>{environment}</option>
                      ))}
                    </select>
                  </label>
                  <div className="svc-filters__actions">
                    <button type="submit" className="btn btn-primary" disabled={!!acting || !scopeProjectId || !scopeEnvironment}>
                      {acting === 'scope' ? 'Saving…' : 'Save scope'}
                    </button>
                  </div>
                </form>
                {scopeProjectId && !(scopeProjects.find((project) => String(project.id) === scopeProjectId)?.environments || []).length ? (
                  <p className="chg-detail__hint">This project has no environments in the catalog. Add one before this change can enter execution.</p>
                ) : null}
              </section>
            ) : null}
            <ChangeDetailPanel item={item} actions={detailActions} />
            {resourceId ? <RecordDocuments apiUrl={apiUrl} kind="changes" recordId={resourceId} /> : null}
            {resourceId ? (
              <LinkedJiraWork
                apiUrl={apiUrl}
                source={{
                  sourceType: 'change',
                  sourceId: Number(resourceId),
                  defaultSummary: item.title || item.change_number,
                  defaultDescription: item.title,
                }}
              />
            ) : null}
            <ResourceContextPanel
              apiUrl={apiUrl}
              token={token}
              kind="change"
              resourceId={resourceId}
              hideDelivery
            />
            {(brief?.headline || incidents.length || blastRadius.length || drift?.drifted || item.files?.length || delivery) ? (
            <aside className="work-board">
              <DeliveryVisibilityCard delivery={delivery} portal="devops" />
              {brief?.headline ? (
                <div>
                  <h2 className="chg-detail__section-title">Change brief</h2>
                  <p className="chg-detail__hint">{brief.headline}</p>
                  {brief.changing?.length ? (
                    <p className="chg-detail__hint">{brief.changing.map((group) => `${group.label} (${group.count})`).join(' · ')}</p>
                  ) : null}
                  {brief.risk_because?.length ? (
                    <ul className="request-timeline">
                      {brief.risk_because.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {drift?.drifted ? <p className="chg-detail__hint">{drift.detail || 'Live image drifted from the last change.'}</p> : null}
              {blastRadius.length ? (
                <div>
                  <h2 className="chg-detail__section-title">Blast radius</h2>
                  <ul className="request-timeline">
                    {blastRadius.map((entry) => <li key={entry}>{entry}</li>)}
                  </ul>
                </div>
              ) : null}
              {incidents.length ? (
                <div>
                  <h2 className="chg-detail__section-title">Linked incidents</h2>
                  <ul className="request-timeline">
                    {incidents.map((incident) => (
                      <li key={incident.id}>
                        <Link href={`/incidents/${incident.id}/edit`}>
                          {incident.incident_number || `INC${incident.id}`} — {incident.summary}
                        </Link>
                        <small>{incident.severity}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {item.files?.length ? (
                <div>
                  <h2 className="chg-detail__section-title">Files</h2>
                  <ul className="request-timeline">
                    {item.files.map((file) => <li key={file}><code>{file}</code></li>)}
                  </ul>
                </div>
              ) : null}
            </aside>
            ) : null}
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
