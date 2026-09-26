import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import {
  buildPortalApiUrl,
  DeliveryVisibilityCard,
  parsePortalNumericId,
  parsePortalPathSegment,
  portalFetch,
  type DeliveryVisibility,
} from '@infragate/ui';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const CHANGE_STATUS_ACTIONS = new Set(['resolve', 'close', 'fail', 'cancel', 'reopen']);

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

interface ChangeDetail {
  id: number;
  change_number: string;
  project_name?: string;
  project_code?: string;
  service: string;
  environment: string;
  repo: string;
  pr_number: number;
  pr_url?: string;
  sha: string;
  previous_sha?: string;
  title: string;
  author?: string;
  summary?: string;
  files: string[];
  pipeline_url?: string;
  change_type: string;
  status: string;
  watch_minutes: number;
  watch_until?: string;
  watch_remaining_minutes?: number;
  request_id?: number;
  linked_incidents: number;
  baseline?: { p95_ms?: number; error_ratio?: number; saturation?: number };
  latest_metrics?: { p95_ms?: number; error_ratio?: number; saturation?: number };
  rollback_hint?: string;
  rollback_plan?: {
    allowed?: boolean;
    previous_sha?: string;
    block_reason?: string;
    k8s_href?: string;
  };
  cab_status?: string;
  linked_incident_number?: string;
  assignee_username?: string;
  priority?: string;
  risk_level?: string;
  impact?: string;
  backout_plan?: string;
  sbom_url?: string;
  attestation_url?: string;
  image_digest?: string;
  provenance_signed?: boolean;
  rollout_stage?: string;
  rollout_percent?: number;
  rollout_halted?: boolean;
  rollout_note?: string;
  cost_delta_usd?: number;
  cost_monthly_after?: number;
  cost_currency?: string;
  policy_status?: string;
  policy_reasons?: string[];
  cab_window_start?: string;
  cab_window_end?: string;
  created_at: string;
}

export default function ChangeDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ChangeDetail | null>(null);
  const [brief, setBrief] = useState<ChangeBrief | null>(null);
  const [incidents, setIncidents] = useState<LinkedIncident[]>([]);
  const [blastRadius, setBlastRadius] = useState<string[]>([]);
  const [drift, setDrift] = useState<{ drifted?: boolean; detail?: string } | null>(null);
  const [delivery, setDelivery] = useState<DeliveryVisibility | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [approving, setApproving] = useState(false);
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);
  const status = (item?.status || '').toLowerCase();
  const finished = status === 'resolved' || status === 'closed' || status === 'failed' || status === 'cancelled';

  const applyStatus = (action: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const safeAction = parsePortalPathSegment(action, CHANGE_STATUS_ACTIONS);
    if (!token || !resourceId || !safeAction) return;
    setActing(action);
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}/${safeAction}`), {
      method: 'POST',
      token,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || `Failed to ${action} change`);
          return;
        }
        setItem(data.change || item);
      })
      .catch(() => setError(`Failed to ${action} change`))
      .finally(() => setActing(''));
  };

  const applyRollout = (stage: string) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const safeStage = parsePortalPathSegment(stage, new Set(['canary', '10', '50', '100']));
    if (!token || !resourceId || !safeStage) return;
    setActing(`rollout-${stage}`);
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}/rollout`), {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: safeStage }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to update rollout');
          return;
        }
        setItem(data.change || item);
      })
      .catch(() => setError('Failed to update rollout'))
      .finally(() => setActing(''));
  };

  const applyRollback = () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !resourceId) return;
    setActing('rollback');
    setError('');
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}/rollback`), {
      method: 'POST',
      token,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to record rollback');
          return;
        }
        if (data.change?.id) {
          void router.push(`/changes/${data.change.id}`);
        }
      })
      .catch(() => setError('Failed to record rollback'))
      .finally(() => setActing(''));
  };

  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}`), { token })
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
      })
      .catch(() => setError('Failed to load change'))
      .finally(() => setLoading(false));
  }, [apiUrl, resourceId]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.change_number || 'Change'} - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Change request</span>
            <h1 className="portal-page__title">{item?.change_number || 'Change'}</h1>
            <p className="portal-page__subtitle">{item?.title || 'Deployment recorded from CI.'}</p>
          </div>
          <div className="portal-page__actions">
            {item?.cab_status === 'pending' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={approving}
                onClick={() => {
                  const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                  if (!token || !resourceId) return;
                  setApproving(true);
                  portalFetch(buildPortalApiUrl(apiUrl, `/api/devops/changes/${resourceId}/cab-approve`), {
                    method: 'POST',
                    token,
                  })
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(data?.error || 'Failed to approve CAB');
                        return;
                      }
                      setItem(data.change || item);
                    })
                    .finally(() => setApproving(false));
                }}
              >
                {approving ? 'Approving...' : 'Approve CAB'}
              </button>
            ) : null}
            {item && !finished ? (
              <>
                {status !== 'resolved' ? (
                  <button type="button" className="btn btn-primary" disabled={!!acting} onClick={() => applyStatus('resolve')}>
                    {acting === 'resolve' ? 'Resolving...' : 'Resolve'}
                  </button>
                ) : null}
                <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => applyStatus('close')}>
                  {acting === 'close' ? 'Closing...' : 'Close'}
                </button>
                <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => applyStatus('fail')}>
                  {acting === 'fail' ? 'Failing...' : 'Mark failed'}
                </button>
                <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => applyStatus('cancel')}>
                  {acting === 'cancel' ? 'Cancelling...' : 'Cancel'}
                </button>
                {item.previous_sha ? (
                  <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={applyRollback}>
                    {acting === 'rollback' ? 'Recording…' : `Roll back to ${item.previous_sha.slice(0, 7)}`}
                  </button>
                ) : null}
                {item.rollback_plan?.k8s_href ? (
                  <Link href={item.rollback_plan.k8s_href} className="btn btn-secondary">
                    Open cluster
                  </Link>
                ) : null}
              </>
            ) : null}
            {item && status === 'resolved' ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => applyStatus('close')}>
                {acting === 'close' ? 'Closing...' : 'Close'}
              </button>
            ) : null}
            {item && finished ? (
              <button type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => applyStatus('reopen')}>
                {acting === 'reopen' ? 'Reopening...' : 'Reopen'}
              </button>
            ) : null}
            <Link href="/changes" className="btn btn-secondary">
              Back to changes
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading change...</div> : null}
        {item ? (
          <>
            <DeliveryVisibilityCard delivery={delivery} portal="devops" />
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">
                Status
                <input className="input" readOnly value={item.status} />
              </label>
              <label className="label">
                Type
                <input className="input" readOnly value={item.change_type} />
              </label>
              <label className="label">
                Priority
                <input className="input" readOnly value={item.priority || 'medium'} />
              </label>
              <label className="label">
                Risk
                <input className="input" readOnly value={item.risk_level || 'medium'} />
              </label>
              <label className="label">
                Planned start
                <input className="input" readOnly value={item.cab_window_start ? new Date(item.cab_window_start).toLocaleString() : '—'} />
              </label>
              <label className="label">
                Planned end
                <input className="input" readOnly value={item.cab_window_end ? new Date(item.cab_window_end).toLocaleString() : '—'} />
              </label>
              <label className="label">
                Repo
                <input className="input" readOnly value={item.repo} />
              </label>
              <label className="label">
                SHA
                <input className="input" readOnly value={item.sha} />
              </label>
              <label className="label">
                Pull request
                <input className="input" readOnly value={item.pr_number ? `#${item.pr_number}` : 'None'} />
              </label>
              <label className="label">
                Service
                <input className="input" readOnly value={item.service || '—'} />
              </label>
              <label className="label">
                Environment
                <input className="input" readOnly value={item.environment === 'unspecified' ? '—' : item.environment} />
              </label>
              <label className="label">
                Assigned to
                <input className="input" readOnly value={item.assignee_username || '—'} />
              </label>
              <label className="label">
                Author
                <input className="input" readOnly value={item.author || '—'} />
              </label>
              <label className="label">
                Project
                <input className="input" readOnly value={item.project_name ? `${item.project_name} (${item.project_code})` : '—'} />
              </label>
              <label className="label">
                Watch window
                <input className="input" readOnly value={`${item.watch_minutes} min${item.watch_until ? ` · until ${new Date(item.watch_until).toLocaleString()}` : ''}`} />
              </label>
              <label className="label">
                Linked incidents
                <input className="input" readOnly value={String(item.linked_incidents || 0)} />
              </label>
              <label className="label">
                Previous SHA
                <input className="input" readOnly value={item.previous_sha || '—'} />
              </label>
              <label className="label">
                Remaining watch
                <input className="input" readOnly value={`${item.watch_remaining_minutes ?? 0} min`} />
              </label>
              <label className="label">
                Latest p95
                <input className="input" readOnly value={item.latest_metrics?.p95_ms != null ? `${item.latest_metrics.p95_ms}ms (baseline ${item.baseline?.p95_ms ?? '—'})` : 'No sample yet'} />
              </label>
              <label className="label">
                Provenance
                <input className="input" readOnly value={item.provenance_signed ? 'Signed attestation' : 'Unsigned'} />
              </label>
              <label className="label">
                Image digest
                <input className="input" readOnly value={item.image_digest || '—'} />
              </label>
            </div>
            <p className="portal-surface__subtitle">
              Cost delta: {item.cost_currency || 'USD'} {item.cost_delta_usd ?? 0}
              {item.cost_monthly_after ? ` · monthly after ${item.cost_monthly_after}` : ''}
              {item.policy_status ? ` · policy ${item.policy_status}` : ''}
              {item.policy_reasons?.length ? ` · ${item.policy_reasons.join('; ')}` : ''}
            </p>
            <p className="portal-surface__subtitle">
              Rollout: {item.rollout_stage || 'full'} · {item.rollout_percent ?? 100}%
              {item.rollout_halted ? ' · halted by Health watcher' : ''}
              {item.rollout_note ? ` · ${item.rollout_note}` : ''}
            </p>
            {!finished ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {['canary', '10', '50', '100'].map((stage) => (
                  <button key={stage} type="button" className="btn btn-secondary" disabled={!!acting} onClick={() => applyRollout(stage)}>
                    {acting === `rollout-${stage}` ? 'Updating…' : stage === '100' ? '100%' : stage === 'canary' ? 'Canary' : `${stage}%`}
                  </button>
                ))}
              </div>
            ) : null}
            {item.sbom_url || item.attestation_url ? (
              <p className="portal-surface__subtitle">
                {item.sbom_url ? <a href={item.sbom_url} target="_blank" rel="noreferrer">SBOM</a> : null}
                {item.sbom_url && item.attestation_url ? ' · ' : ''}
                {item.attestation_url ? <a href={item.attestation_url} target="_blank" rel="noreferrer">Attestation</a> : null}
              </p>
            ) : null}
            <p className="portal-surface__subtitle">
              Resolve when the deploy and watch look good. Close when the change is done. Open linked incidents must be resolved or closed first.
            </p>
            {item.cab_status ? <p className="portal-surface__subtitle">CAB: {item.cab_status}{item.linked_incident_number ? ` · linked ${item.linked_incident_number}` : ''}</p> : null}
            {item.rollback_hint ? <p className="portal-surface__subtitle">{item.rollback_hint}</p> : null}
            {item.summary ? <p className="portal-surface__subtitle">{item.summary}</p> : null}
            {item.impact ? <p className="portal-surface__subtitle">Impact: {item.impact}</p> : null}
            {item.backout_plan ? <p className="portal-surface__subtitle">Backout: {item.backout_plan}</p> : null}
            {item.pr_url ? (
              <p>
                <a href={item.pr_url} target="_blank" rel="noreferrer">
                  Open pull request
                </a>
              </p>
            ) : null}
            {item.pipeline_url ? (
              <p>
                <a href={item.pipeline_url} target="_blank" rel="noreferrer">
                  Open pipeline
                </a>
              </p>
            ) : null}
            {brief?.headline ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Change brief</h2>
                <p className="portal-surface__subtitle">{brief.headline}</p>
                {brief.changing?.length ? (
                  <p className="portal-surface__subtitle">
                    {brief.changing.map((group) => `${group.label} (${group.count})`).join(' · ')}
                  </p>
                ) : null}
                {brief.risk_because?.length ? (
                  <ul>
                    {brief.risk_because.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {drift?.drifted ? (
              <p className="portal-surface__subtitle">{drift.detail || 'Live image drifted from last CHG'}</p>
            ) : null}
            {blastRadius.length ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Blast radius</h2>
                <p className="portal-surface__subtitle">One hop from the service map (same repo or team). This is not a CMDB rebuild.</p>
                <ul>
                  {blastRadius.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {incidents.length ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Linked incidents</h2>
                <ul>
                  {incidents.map((incident) => (
                    <li key={incident.id}>
                      <Link href={`/incidents/${incident.id}/edit`}>
                        {incident.incident_number || `INC${incident.id}`} — {incident.summary} ({incident.severity})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {item.files?.length ? (
              <>
                <h2 className="portal-surface__title" style={{ marginTop: 24 }}>Files</h2>
                <ul>
                  {item.files.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
