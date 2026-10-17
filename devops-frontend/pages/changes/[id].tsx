import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import {
  buildPortalApiUrl,
  buildChangeDetailActions,
  ChangeDetailPanel,
  DeliveryVisibilityCard,
  ResourceContextPanel,
  parsePortalNumericId,
  parsePortalPathSegment,
  portalFetch,
  type ChangeDetailModel,
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

export default function ChangeDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ChangeDetailModel | null>(null);
  const [brief, setBrief] = useState<ChangeBrief | null>(null);
  const [incidents, setIncidents] = useState<LinkedIncident[]>([]);
  const [blastRadius, setBlastRadius] = useState<string[]>([]);
  const [drift, setDrift] = useState<{ drifted?: boolean; detail?: string } | null>(null);
  const [delivery, setDelivery] = useState<DeliveryVisibility | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
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
      })
      .catch(() => setError('Failed to load change'))
      .finally(() => setLoading(false));
  }, [apiUrl, resourceId]);

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
                ? [item.status, item.service, item.environment === 'unspecified' ? '' : item.environment].filter(Boolean).join(' · ')
                : 'Approval, schedule, and implementation for this change.'}
            </p>
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
            <ChangeDetailPanel item={item} actions={detailActions} />
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
