import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface PromotionItem {
  request_id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  environment: string;
  next_environment: string;
  cloud: string;
  service: string;
  status: string;
  client_name: string;
  latest_promoted_id?: number | null;
  latest_promoted_env?: string;
  latest_promoted_status?: string;
  gate?: PromotionGateDecision | null;
}

interface PromotionGateCheck {
  key: string;
  label: string;
  status: string;
  detail: string;
}

interface PromotionGateDecision {
  target_environment: string;
  status: string;
  summary: string;
  can_promote: boolean;
  requires_acknowledgement: boolean;
  review_message: string;
  blocking_check_count: number;
  attention_check_count: number;
  checks: PromotionGateCheck[];
  approved: boolean;
  approval?: PromotionGateApproval | null;
}

interface PromotionGateApproval {
  id: number;
  approved_by: number;
  approved_by_username: string;
  approved_at: string;
  expires_at?: string | null;
  note: string;
}

function normalizeGate(value: unknown): PromotionGateDecision | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const checks = Array.isArray(record.checks) ? record.checks : [];
  const approvalRecord = record.approval && typeof record.approval === 'object' ? (record.approval as Record<string, unknown>) : null;
  return {
    target_environment: typeof record.target_environment === 'string' ? record.target_environment : '',
    status: typeof record.status === 'string' ? record.status : 'attention',
    summary: typeof record.summary === 'string' ? record.summary : '',
    can_promote: typeof record.can_promote === 'boolean' ? record.can_promote : false,
    requires_acknowledgement: typeof record.requires_acknowledgement === 'boolean' ? record.requires_acknowledgement : false,
    review_message: typeof record.review_message === 'string' ? record.review_message : '',
    blocking_check_count: typeof record.blocking_check_count === 'number' ? record.blocking_check_count : 0,
    attention_check_count: typeof record.attention_check_count === 'number' ? record.attention_check_count : 0,
    approved: typeof record.approved === 'boolean' ? record.approved : false,
    approval: approvalRecord
      ? {
          id: typeof approvalRecord.id === 'number' ? approvalRecord.id : 0,
          approved_by: typeof approvalRecord.approved_by === 'number' ? approvalRecord.approved_by : 0,
          approved_by_username: typeof approvalRecord.approved_by_username === 'string' ? approvalRecord.approved_by_username : '',
          approved_at: typeof approvalRecord.approved_at === 'string' ? approvalRecord.approved_at : '',
          expires_at: typeof approvalRecord.expires_at === 'string' ? approvalRecord.expires_at : null,
          note: typeof approvalRecord.note === 'string' ? approvalRecord.note : '',
        }
      : null,
    checks: checks.map((check) => {
      const checkRecord = check && typeof check === 'object' ? (check as Record<string, unknown>) : {};
      return {
        key: typeof checkRecord.key === 'string' ? checkRecord.key : '',
        label: typeof checkRecord.label === 'string' ? checkRecord.label : '',
        status: typeof checkRecord.status === 'string' ? checkRecord.status : '',
        detail: typeof checkRecord.detail === 'string' ? checkRecord.detail : '',
      };
    }),
  };
}

function normalizePromotions(value: unknown): PromotionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    request_id: typeof item?.request_id === 'number' ? item.request_id : 0,
    project_id: typeof item?.project_id === 'number' ? item.project_id : null,
    project_name: typeof item?.project_name === 'string' ? item.project_name : '',
    project_code: typeof item?.project_code === 'string' ? item.project_code : '',
    team: typeof item?.team === 'string' ? item.team : '',
    environment: typeof item?.environment === 'string' ? item.environment : '',
    next_environment: typeof item?.next_environment === 'string' ? item.next_environment : '',
    cloud: typeof item?.cloud === 'string' ? item.cloud : '',
    service: typeof item?.service === 'string' ? item.service : '',
    status: typeof item?.status === 'string' ? item.status : '',
    client_name: typeof item?.client_name === 'string' ? item.client_name : '',
    latest_promoted_id: typeof item?.latest_promoted_id === 'number' ? item.latest_promoted_id : null,
    latest_promoted_env: typeof item?.latest_promoted_env === 'string' ? item.latest_promoted_env : '',
    latest_promoted_status: typeof item?.latest_promoted_status === 'string' ? item.latest_promoted_status : '',
    gate: normalizeGate(item?.gate),
  }));
}

function clearSessionAndRedirect() {
  localStorage.removeItem(DEVOPS_TOKEN_KEY);
  localStorage.removeItem(DEVOPS_USER_KEY);
  window.location.assign('/login');
}

function parsePositiveIntQuery(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeQueryValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function gateTone(status?: string): { background: string; color: string } {
  switch ((status || '').toLowerCase()) {
    case 'blocked':
      return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
    case 'attention':
      return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    default:
      return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function DevOpsPromotionsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [items, setItems] = useState<PromotionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeProjectID = useMemo(() => parsePositiveIntQuery(router.query.project_id), [router.query.project_id]);
  const activeRequestID = useMemo(() => parsePositiveIntQuery(router.query.request_id), [router.query.request_id]);
  const activeEnvironment = useMemo(() => normalizeQueryValue(router.query.environment), [router.query.environment]);
  const activeNextEnvironment = useMemo(() => normalizeQueryValue(router.query.next_environment), [router.query.next_environment]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeProjectID && item.project_id !== activeProjectID) return false;
      if (activeRequestID && item.request_id !== activeRequestID) return false;
      if (activeEnvironment && item.environment.trim().toLowerCase() !== activeEnvironment) return false;
      if (activeNextEnvironment && item.next_environment.trim().toLowerCase() !== activeNextEnvironment) return false;
      return true;
    });
  }, [activeEnvironment, activeNextEnvironment, activeProjectID, activeRequestID, items]);

  const hasActiveFilters = Boolean(activeProjectID || activeRequestID || activeEnvironment || activeNextEnvironment);

  const loadData = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/promotions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load promotion flow');
      }
      setItems(normalizePromotions(data?.promotions));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load promotion flow');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [apiUrl]);

  const approveGate = async (item: PromotionItem) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (!item.gate?.requires_acknowledgement) {
      setNotice('This promotion does not need a gate approval.');
      return;
    }
    const note = window.prompt('Add an approval note for the deployment gate (optional):', '') ?? null;
    if (note === null) return;

    setApprovingId(item.request_id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/promotions/${item.request_id}/approve-gate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ note }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const nextGate = normalizeGate(data?.gate);
        if (nextGate) {
          setItems((current) =>
            current.map((candidate) =>
              candidate.request_id === item.request_id ? { ...candidate, gate: nextGate } : candidate
            )
          );
        }
        throw new Error(data?.error || 'Failed to approve deployment gate');
      }
      const nextGate = normalizeGate(data?.gate);
      if (nextGate) {
        setItems((current) =>
          current.map((candidate) =>
            candidate.request_id === item.request_id ? { ...candidate, gate: nextGate } : candidate
          )
        );
      } else {
        await loadData();
      }
      setNotice(`Deployment gate approval recorded for request #${item.request_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve deployment gate');
    } finally {
      setApprovingId(null);
    }
  };

  const promote = async (item: PromotionItem) => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    if (item.gate?.status === 'blocked') {
      setError(item.gate.summary || 'This promotion is blocked by deployment gate policy.');
      return;
    }
    if (item.gate?.requires_acknowledgement) {
      setError(item.gate.review_message || 'A persisted deployment gate approval is required before promotion.');
      return;
    }

    setPromotingId(item.request_id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/promotions/${item.request_id}/promote`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const nextGate = normalizeGate(data?.gate);
        if (nextGate) {
          setItems((current) =>
            current.map((candidate) =>
              candidate.request_id === item.request_id ? { ...candidate, gate: nextGate } : candidate
            )
          );
        }
        throw new Error(data?.error || 'Failed to promote request');
      }
      setNotice(`Created draft request #${data?.request?.id || ''} for the next environment.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote request');
    } finally {
      setPromotingId(null);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Promotion Center - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Project Lifecycle</span>
            <h1 className="portal-page__title">Environment Promotion Flow</h1>
            <p className="portal-page__subtitle">
              Promote delivered requests from lower environments into the next stage while preserving request lineage and audit history.
            </p>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {hasActiveFilters ? (
          <div className="alert alert-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                Showing promotion candidates
                {activeProjectID ? ` for project #${activeProjectID}` : ''}
                {activeRequestID ? ` for request #${activeRequestID}` : ''}
                {activeEnvironment ? ` from ${activeEnvironment.toUpperCase()}` : ''}
                {activeNextEnvironment ? ` into ${activeNextEnvironment.toUpperCase()}` : ''}.
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void router.push('/promotions')}>
                Clear filters
              </button>
            </div>
          </div>
        ) : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Promotion Queue</span>
              <h2 className="portal-surface__title">Promotable requests</h2>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading promotion candidates...</div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">
              {hasActiveFilters ? 'No promotion candidates match the current filters.' : 'No promotable requests available.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Project</th>
                    <th>Flow</th>
                    <th>Gate</th>
                    <th>Status</th>
                    <th>Latest promotion</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.request_id}>
                      <td>#{item.request_id} · {item.client_name}</td>
                      <td>{item.project_name ? `${item.project_name} (${item.project_code})` : 'No project'}</td>
                      <td>{item.environment} → {item.next_environment || 'n/a'} · {item.cloud}/{item.service}</td>
                      <td style={{ minWidth: 240 }}>
                        {item.gate ? (
                          <div style={{ display: 'grid', gap: 8 }}>
                            <span
                              style={{
                                width: 'fit-content',
                                padding: '4px 10px',
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 700,
                                textTransform: 'capitalize',
                                ...gateTone(item.gate.status),
                              }}
                            >
                              {item.gate.status}
                            </span>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{item.gate.summary}</div>
                            {item.gate.approved && item.gate.approval ? (
                              <div
                                style={{
                                  border: '1px solid rgba(34, 197, 94, 0.3)',
                                  background: 'rgba(34, 197, 94, 0.08)',
                                  borderRadius: 10,
                                  padding: 8,
                                  fontSize: 12,
                                  color: 'var(--color-text-muted)',
                                }}
                              >
                                <div style={{ color: 'var(--color-success)', fontWeight: 700 }}>
                                  Approved by {item.gate.approval.approved_by_username || 'reviewer'}
                                </div>
                                <div style={{ marginTop: 4 }}>Approved at {formatDateTime(item.gate.approval.approved_at)}</div>
                                {item.gate.approval.expires_at ? <div>Expires at {formatDateTime(item.gate.approval.expires_at)}</div> : null}
                                {item.gate.approval.note ? <div style={{ marginTop: 4 }}>Note: {item.gate.approval.note}</div> : null}
                              </div>
                            ) : null}
                            {item.gate.checks.length > 0 ? (
                              <details>
                                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--color-primary)' }}>Review checks</summary>
                                <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                                  {item.gate.checks.map((check) => (
                                    <div key={`${item.request_id}-${check.key}`} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 8 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                        <strong style={{ fontSize: 12 }}>{check.label}</strong>
                                        <span style={{ textTransform: 'capitalize', fontSize: 11, color: gateTone(check.status).color }}>{check.status}</span>
                                      </div>
                                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>{check.detail}</div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ) : null}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Gate evaluation unavailable.</span>
                        )}
                      </td>
                      <td>{item.status}</td>
                      <td>
                        {item.latest_promoted_id
                          ? `#${item.latest_promoted_id} (${item.latest_promoted_env} · ${item.latest_promoted_status})`
                          : 'No downstream promotion yet'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {item.gate?.requires_acknowledgement ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={approvingId === item.request_id || promotingId === item.request_id}
                              onClick={() => void approveGate(item)}
                            >
                              {approvingId === item.request_id ? 'Approving...' : 'Approve gate'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={
                              promotingId === item.request_id ||
                              approvingId === item.request_id ||
                              !item.next_environment ||
                              item.gate?.status === 'blocked' ||
                              item.gate?.requires_acknowledgement
                            }
                            onClick={() => void promote(item)}
                          >
                            {promotingId === item.request_id ? 'Promoting...' : 'Promote'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
