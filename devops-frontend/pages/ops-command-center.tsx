import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { downloadCSV } from '../lib/csv';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';
const SAVED_VIEWS_KEY = 'devops_ops_command_views_v1';

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface OpsSummary {
  blocked_promotions: number;
  attention_promotions: number;
  active_incidents: number;
  delivery_failures: number;
  actionable_expiry: number;
  drifted_projects: number;
  unhealthy_namespaces: number;
  active_overrides: number;
}

interface ProjectPulse {
  project_id: number;
  project_name: string;
  project_code: string;
  drift_state: string;
  drift_score: number;
  pending_requests: number;
  blocked_promotions: number;
  attention_promotions: number;
  open_incidents: number;
  expiry_items: number;
  namespace_alerts: number;
}

interface PromotionItem {
  request_id: number;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  team: string;
  environment: string;
  next_environment: string;
  cloud: string;
  service: string;
  status: string;
  updated_at: string;
}

interface IncidentItem {
  id: number;
  incident_number?: string;
  request_id: number;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  severity: string;
  status: string;
  escalation_level: string;
  summary: string;
  updated_at: string;
}

interface DeliveryFailureItem {
  id: number;
  job_type: string;
  target: string;
  error_message: string;
  status: string;
  retry_count: number;
  updated_at: string;
}

interface ExpiryItem {
  item_key: string;
  project_id?: number;
  project_name?: string;
  project_code?: string;
  category: string;
  environment?: string;
  resource_name: string;
  status: string;
  workflow_state: string;
  days_remaining: number;
  recommendation: string;
}

interface NamespaceAlert {
  project_id: number;
  project_name: string;
  project_code: string;
  namespace: string;
  cluster_name: string;
  status: string;
  issue_count: number;
  restarting_pods: number;
  warning_logs: number;
}

interface AccessOverride {
  id: number;
  project_id: number;
  project_name: string;
  project_code: string;
  username: string;
  permission: string;
  reason: string;
  expires_at: string;
}

interface DriftProject {
  project_id: number;
  project_name: string;
  project_code: string;
  state: string;
  drift_score: number;
  summary: string;
}

interface OpsPayload {
  projects: ProjectSummary[];
  summary: OpsSummary;
  project_pulse: ProjectPulse[];
  drifted_projects: DriftProject[];
  blocked_promotions: PromotionItem[];
  attention_promotions: PromotionItem[];
  active_incidents: IncidentItem[];
  delivery_failures: DeliveryFailureItem[];
  expiry_items: ExpiryItem[];
  namespace_alerts: NamespaceAlert[];
  active_overrides: AccessOverride[];
}

type QueueFocus =
  | 'all'
  | 'project-pulse'
  | 'drift'
  | 'promotions'
  | 'incidents'
  | 'failures'
  | 'expiry'
  | 'namespaces'
  | 'overrides';

interface SavedView {
  id: string;
  name: string;
  projectId: string;
  queueFocus: QueueFocus;
  searchText: string;
  driftState: string;
  incidentSeverity: string;
  expiryWorkflow: string;
  actionableOnly: boolean;
}

interface FilterState {
  projectId: string;
  queueFocus: QueueFocus;
  searchText: string;
  driftState: string;
  incidentSeverity: string;
  expiryWorkflow: string;
  actionableOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  projectId: '',
  queueFocus: 'all',
  searchText: '',
  driftState: '',
  incidentSeverity: '',
  expiryWorkflow: '',
  actionableOnly: false,
};

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function loadSavedViews(): SavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedViews(views: SavedView[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
}

function includesText(values: Array<string | number | undefined>, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value || '').toLowerCase().includes(needle));
}

export default function OpsCommandCenterPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [center, setCenter] = useState<OpsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState(DEFAULT_FILTERS.projectId);
  const [queueFocus, setQueueFocus] = useState<QueueFocus>(DEFAULT_FILTERS.queueFocus);
  const [searchText, setSearchText] = useState(DEFAULT_FILTERS.searchText);
  const [driftState, setDriftState] = useState(DEFAULT_FILTERS.driftState);
  const [incidentSeverity, setIncidentSeverity] = useState(DEFAULT_FILTERS.incidentSeverity);
  const [expiryWorkflow, setExpiryWorkflow] = useState(DEFAULT_FILTERS.expiryWorkflow);
  const [actionableOnly, setActionableOnly] = useState(DEFAULT_FILTERS.actionableOnly);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewName, setSavedViewName] = useState('');
  const [activeViewId, setActiveViewId] = useState('');

  useEffect(() => {
    setSavedViews(loadSavedViews());
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const queryProjectId = router.query.project_id;
    if (typeof queryProjectId === 'string' && queryProjectId.trim()) {
      setProjectId(queryProjectId.trim());
    }
  }, [router.isReady, router.query.project_id]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      localStorage.removeItem(DEVOPS_USER_KEY);
      router.replace('/login');
      return;
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);

    fetch(`${apiUrl}/api/devops/ops-command-center?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem(DEVOPS_TOKEN_KEY);
          localStorage.removeItem(DEVOPS_USER_KEY);
          router.replace('/login');
          return null;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load ops command center');
        }
        return data;
      })
      .then((data) => {
        if (!data) return;
        setCenter(data?.center || null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load ops command center';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [apiUrl, projectId, router]);

  const projects = center?.projects || [];

  const filteredProjectPulse = useMemo(() => {
    return (center?.project_pulse || []).filter((item) => {
      if (driftState && item.drift_state !== driftState) return false;
      if (actionableOnly && item.blocked_promotions + item.attention_promotions + item.open_incidents + item.expiry_items + item.namespace_alerts === 0) {
        return false;
      }
      return includesText([item.project_name, item.project_code], searchText);
    });
  }, [actionableOnly, center?.project_pulse, driftState, searchText]);

  const filteredDriftedProjects = useMemo(() => {
    return (center?.drifted_projects || []).filter((item) => {
      if (driftState && item.state !== driftState) return false;
      if (actionableOnly && item.state === 'aligned') return false;
      return includesText([item.project_name, item.project_code, item.summary], searchText);
    });
  }, [actionableOnly, center?.drifted_projects, driftState, searchText]);

  const filteredBlockedPromotions = useMemo(() => {
    return (center?.blocked_promotions || []).filter((item) =>
      includesText(
        [item.project_name, item.project_code, item.service, item.cloud, item.environment, item.next_environment, item.team, item.request_id],
        searchText,
      ),
    );
  }, [center?.blocked_promotions, searchText]);

  const filteredAttentionPromotions = useMemo(() => {
    return (center?.attention_promotions || []).filter((item) =>
      includesText(
        [item.project_name, item.project_code, item.service, item.cloud, item.environment, item.next_environment, item.team, item.request_id],
        searchText,
      ),
    );
  }, [center?.attention_promotions, searchText]);

  const filteredIncidents = useMemo(() => {
    return (center?.active_incidents || []).filter((item) => {
      if (incidentSeverity && item.severity !== incidentSeverity) return false;
      if (actionableOnly && item.status === 'resolved') return false;
      return includesText([item.project_name, item.project_code, item.summary, item.incident_number, item.request_id], searchText);
    });
  }, [actionableOnly, center?.active_incidents, incidentSeverity, searchText]);

  const filteredDeliveryFailures = useMemo(() => {
    return (center?.delivery_failures || []).filter((item) => {
      if (actionableOnly && item.status === 'resolved') return false;
      return includesText([item.job_type, item.target, item.error_message, item.status], searchText);
    });
  }, [actionableOnly, center?.delivery_failures, searchText]);

  const filteredExpiryItems = useMemo(() => {
    return (center?.expiry_items || []).filter((item) => {
      if (expiryWorkflow && item.workflow_state !== expiryWorkflow) return false;
      if (actionableOnly && ['resolved', 'completed'].includes(item.workflow_state)) return false;
      return includesText([item.project_name, item.project_code, item.resource_name, item.category, item.environment, item.recommendation], searchText);
    });
  }, [actionableOnly, center?.expiry_items, expiryWorkflow, searchText]);

  const filteredNamespaceAlerts = useMemo(() => {
    return (center?.namespace_alerts || []).filter((item) => {
      if (actionableOnly && item.issue_count <= 0 && item.warning_logs <= 0 && item.restarting_pods <= 0) return false;
      return includesText([item.project_name, item.project_code, item.namespace, item.cluster_name, item.status], searchText);
    });
  }, [actionableOnly, center?.namespace_alerts, searchText]);

  const filteredOverrides = useMemo(() => {
    return (center?.active_overrides || []).filter((item) =>
      includesText([item.project_name, item.project_code, item.username, item.permission, item.reason], searchText),
    );
  }, [center?.active_overrides, searchText]);

  const saveCurrentView = () => {
    const trimmedName = savedViewName.trim();
    if (!trimmedName) return;
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name: trimmedName,
      projectId,
      queueFocus,
      searchText,
      driftState,
      incidentSeverity,
      expiryWorkflow,
      actionableOnly,
    };
    const nextViews = [view, ...savedViews.filter((item) => item.name.toLowerCase() !== trimmedName.toLowerCase())].slice(0, 8);
    setSavedViews(nextViews);
    persistSavedViews(nextViews);
    setSavedViewName('');
    setActiveViewId(view.id);
  };

  const applySavedView = (view: SavedView) => {
    setProjectId(view.projectId);
    setQueueFocus(view.queueFocus);
    setSearchText(view.searchText);
    setDriftState(view.driftState);
    setIncidentSeverity(view.incidentSeverity);
    setExpiryWorkflow(view.expiryWorkflow);
    setActionableOnly(view.actionableOnly);
    setActiveViewId(view.id);
  };

  const deleteSavedView = (viewId: string) => {
    const nextViews = savedViews.filter((view) => view.id !== viewId);
    setSavedViews(nextViews);
    persistSavedViews(nextViews);
    if (activeViewId === viewId) setActiveViewId('');
  };

  const clearFilters = () => {
    setProjectId(DEFAULT_FILTERS.projectId);
    setQueueFocus(DEFAULT_FILTERS.queueFocus);
    setSearchText(DEFAULT_FILTERS.searchText);
    setDriftState(DEFAULT_FILTERS.driftState);
    setIncidentSeverity(DEFAULT_FILTERS.incidentSeverity);
    setExpiryWorkflow(DEFAULT_FILTERS.expiryWorkflow);
    setActionableOnly(DEFAULT_FILTERS.actionableOnly);
    setActiveViewId('');
  };

  const exportCSV = () => {
    const rows: unknown[][] = [];
    filteredProjectPulse.forEach((item) => {
      rows.push([
        'project_pulse',
        item.project_name,
        item.project_code,
        item.project_id,
        item.drift_state,
        item.drift_score,
        item.pending_requests,
        item.blocked_promotions,
        item.attention_promotions,
        item.open_incidents,
        item.expiry_items,
        item.namespace_alerts,
      ]);
    });
    filteredDriftedProjects.forEach((item) => {
      rows.push([
        'drift',
        item.project_name,
        item.project_code,
        item.project_id,
        item.state,
        item.drift_score,
        item.summary,
        '',
        '',
        '',
        '',
        '',
      ]);
    });
    filteredBlockedPromotions.forEach((item) => {
      rows.push([
        'blocked_promotion',
        item.project_name || '',
        item.project_code || '',
        item.request_id,
        item.status,
        '',
        `${item.environment} -> ${item.next_environment}`,
        item.service,
        item.cloud,
        item.team,
        formatDateTime(item.updated_at),
        '',
      ]);
    });
    filteredAttentionPromotions.forEach((item) => {
      rows.push([
        'attention_promotion',
        item.project_name || '',
        item.project_code || '',
        item.request_id,
        item.status,
        '',
        `${item.environment} -> ${item.next_environment}`,
        item.service,
        item.cloud,
        item.team,
        formatDateTime(item.updated_at),
        '',
      ]);
    });
    filteredIncidents.forEach((item) => {
      rows.push([
        'incident',
        item.project_name || '',
        item.project_code || '',
        item.incident_number || '',
        item.status,
        item.severity,
        item.summary,
        item.escalation_level,
        '',
        '',
        formatDateTime(item.updated_at),
        '',
      ]);
    });
    filteredDeliveryFailures.forEach((item) => {
      rows.push([
        'delivery_failure',
        '',
        '',
        item.id,
        item.status,
        '',
        item.error_message,
        item.job_type,
        item.target,
        item.retry_count,
        formatDateTime(item.updated_at),
        '',
      ]);
    });
    filteredExpiryItems.forEach((item) => {
      rows.push([
        'expiry',
        item.project_name || '',
        item.project_code || '',
        item.item_key,
        item.workflow_state,
        item.status,
        item.resource_name,
        item.category,
        item.environment || '',
        item.days_remaining,
        item.recommendation,
        '',
      ]);
    });
    filteredNamespaceAlerts.forEach((item) => {
      rows.push([
        'namespace_alert',
        item.project_name,
        item.project_code,
        item.namespace,
        item.status,
        '',
        item.cluster_name,
        item.issue_count,
        item.restarting_pods,
        item.warning_logs,
        '',
        '',
      ]);
    });
    filteredOverrides.forEach((item) => {
      rows.push([
        'access_override',
        item.project_name,
        item.project_code,
        item.id,
        item.permission,
        '',
        item.username,
        item.reason,
        '',
        '',
        formatDateTime(item.expires_at),
        '',
      ]);
    });

    downloadCSV(
      `ops-command-center-${new Date().toISOString().slice(0, 10)}.csv`,
      ['record_type', 'project_name', 'project_code', 'reference', 'state', 'severity_or_status', 'detail_a', 'detail_b', 'detail_c', 'detail_d', 'timestamp_or_expiry', 'notes'],
      rows,
    );
  };

  const shouldShow = (section: QueueFocus): boolean => {
    return queueFocus === 'all' || queueFocus === section;
  };

  const filteredSummary = {
    blockedPromotions: filteredBlockedPromotions.length,
    attentionPromotions: filteredAttentionPromotions.length,
    activeIncidents: filteredIncidents.length,
    deliveryFailures: filteredDeliveryFailures.length,
    actionableExpiry: filteredExpiryItems.length,
    namespaceAlerts: filteredNamespaceAlerts.length,
    activeOverrides: filteredOverrides.length,
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Ops Command Center - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Phase 1</span>
            <h1 className="portal-page__title">Ops Command Center</h1>
            <p className="portal-page__subtitle">
              A single operational surface for blocked promotions, unhealthy workloads, expiring assets, active incidents, drift, and delivery failures.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/environment-drift" className="btn btn-secondary">Environment Drift</Link>
            <Link href="/promotions" className="btn btn-secondary">Promotions</Link>
            <button type="button" className="btn btn-secondary" onClick={exportCSV} disabled={!center}>
              Export CSV
            </button>
            <Link href="/incidents" className="btn btn-primary">Incidents</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading ops command center...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && center ? (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Blocked promotions</span>
                <strong className="portal-stat-card__value">{filteredSummary.blockedPromotions}</strong>
                <p className="portal-stat-card__copy">Promotion candidates currently blocked by deployment gate policy.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Attention promotions</span>
                <strong className="portal-stat-card__value">{filteredSummary.attentionPromotions}</strong>
                <p className="portal-stat-card__copy">Candidates waiting on a gate approval or manual review step.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Active incidents</span>
                <strong className="portal-stat-card__value">{filteredSummary.activeIncidents}</strong>
                <p className="portal-stat-card__copy">Open incidents that should shape release decisions and response priorities.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Delivery failures</span>
                <strong className="portal-stat-card__value">{filteredSummary.deliveryFailures}</strong>
                <p className="portal-stat-card__copy">Recent failed automation or delivery tasks that may need retry or triage.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Actionable expiry</span>
                <strong className="portal-stat-card__value">{filteredSummary.actionableExpiry}</strong>
                <p className="portal-stat-card__copy">Secrets and certificates that need acknowledgement, rotation, or owner action.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Namespace alerts</span>
                <strong className="portal-stat-card__value">{filteredSummary.namespaceAlerts}</strong>
                <p className="portal-stat-card__copy">Namespaces with workload health issues, restart pressure, or warning logs.</p>
              </article>
            </section>

            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Views</span>
                  <h2 className="portal-surface__title">Filters and saved command views</h2>
                  <p className="portal-surface__subtitle">Build focused triage views for incidents, promotions, expiry, or namespace health and keep them for reuse.</p>
                </div>
              </div>
              <div className="portal-toolbar">
                <div className="portal-toolbar__group">
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-project-filter">Project</label>
                    <select
                      id="ops-command-project-filter"
                      className="input"
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                    >
                      <option value="">All projects</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}{project.code ? ` (${project.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-queue-focus">Queue focus</label>
                    <select
                      id="ops-command-queue-focus"
                      className="input"
                      value={queueFocus}
                      onChange={(event) => setQueueFocus(event.target.value as QueueFocus)}
                    >
                      <option value="all">All queues</option>
                      <option value="project-pulse">Project pulse</option>
                      <option value="drift">Drift</option>
                      <option value="promotions">Promotions</option>
                      <option value="incidents">Incidents</option>
                      <option value="failures">Failures</option>
                      <option value="expiry">Expiry</option>
                      <option value="namespaces">Namespaces</option>
                      <option value="overrides">Overrides</option>
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-search">Search</label>
                    <input
                      id="ops-command-search"
                      className="input"
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      placeholder="Project, service, incident, namespace, username"
                    />
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-drift-state">Drift state</label>
                    <select
                      id="ops-command-drift-state"
                      className="input"
                      value={driftState}
                      onChange={(event) => setDriftState(event.target.value)}
                    >
                      <option value="">All</option>
                      <option value="drift">Drift</option>
                      <option value="attention">Attention</option>
                      <option value="aligned">Aligned</option>
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-incident-severity">Incident severity</label>
                    <select
                      id="ops-command-incident-severity"
                      className="input"
                      value={incidentSeverity}
                      onChange={(event) => setIncidentSeverity(event.target.value)}
                    >
                      <option value="">All</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-expiry-state">Expiry workflow</label>
                    <select
                      id="ops-command-expiry-state"
                      className="input"
                      value={expiryWorkflow}
                      onChange={(event) => setExpiryWorkflow(event.target.value)}
                    >
                      <option value="">All</option>
                      <option value="new">New</option>
                      <option value="acknowledged">Acknowledged</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                  <div className="portal-toolbar__item">
                    <label className="credential-audit-label" htmlFor="ops-command-actionable-only">Focus</label>
                    <label className="label" htmlFor="ops-command-actionable-only" style={{ marginBottom: 0 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <input
                          id="ops-command-actionable-only"
                          type="checkbox"
                          checked={actionableOnly}
                          onChange={(event) => setActionableOnly(event.target.checked)}
                        />
                        Actionable only
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ maxWidth: 260 }}
                  value={savedViewName}
                  onChange={(event) => setSavedViewName(event.target.value)}
                  placeholder="Name this filtered view"
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={saveCurrentView} disabled={!savedViewName.trim()}>
                  Save view
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
                {activeViewId ? <span className="portal-pill">Active view applied</span> : null}
              </div>
              {savedViews.length > 0 ? (
                <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
                  {savedViews.map((view) => (
                    <article key={view.id} className="portal-surface" style={{ padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <strong>{view.name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                            {view.queueFocus} · {view.projectId ? `project #${view.projectId}` : 'all projects'} · {view.actionableOnly ? 'actionable only' : 'full scope'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => applySavedView(view)}>
                            Apply
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => deleteSavedView(view.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>

            {shouldShow('project-pulse') ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Project pulse</span>
                    <h2 className="portal-surface__title">Priority projects</h2>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Drift</th>
                        <th>Pending</th>
                        <th>Promotions</th>
                        <th>Incidents</th>
                        <th>Expiry</th>
                        <th>Namespaces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjectPulse.map((item) => (
                        <tr key={`pulse-${item.project_id}`}>
                          <td>
                            <Link href={`/projects/${item.project_id}`}><strong>{item.project_name}</strong></Link>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_code}</div>
                          </td>
                          <td>{item.drift_state} · {item.drift_score}</td>
                          <td>{item.pending_requests}</td>
                          <td>{item.blocked_promotions + item.attention_promotions}</td>
                          <td>{item.open_incidents}</td>
                          <td>{item.expiry_items}</td>
                          <td>{item.namespace_alerts}</td>
                        </tr>
                      ))}
                      {filteredProjectPulse.length === 0 ? (
                        <tr>
                          <td colSpan={7}><div className="empty-state">No project pulse items match the current filters.</div></td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              {shouldShow('drift') ? (
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Drift</span>
                      <h2 className="portal-surface__title">Projects needing alignment</h2>
                    </div>
                    <Link href="/environment-drift" className="btn btn-secondary btn-sm">Open drift view</Link>
                  </div>
                  {filteredDriftedProjects.length === 0 ? (
                    <div className="empty-state">No drifted projects in the current scope.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {filteredDriftedProjects.map((item) => (
                        <article key={`drift-project-${item.project_id}`} className="portal-surface" style={{ padding: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div>
                              <strong>{item.project_name}</strong>
                              <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_code}</div>
                            </div>
                            <span className="portal-pill">{item.state} · score {item.drift_score}</span>
                          </div>
                          <p style={{ marginTop: 8, color: 'var(--color-text-muted)' }}>{item.summary}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {shouldShow('promotions') ? (
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Promotion gates</span>
                      <h2 className="portal-surface__title">Blocked and attention promotions</h2>
                    </div>
                    <Link href="/promotions" className="btn btn-secondary btn-sm">Open promotions</Link>
                  </div>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {[...filteredBlockedPromotions, ...filteredAttentionPromotions].slice(0, 12).map((item) => (
                      <article key={`promotion-${item.request_id}`} className="portal-surface" style={{ padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <div>
                            <strong>{item.project_name || `Request #${item.request_id}`}</strong>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                                  {item.environment.toUpperCase()} {'->'} {item.next_environment.toUpperCase()} · {item.cloud} / {item.service}
                                </div>
                          </div>
                          <span className="portal-pill">{item.status}</span>
                        </div>
                      </article>
                    ))}
                    {filteredBlockedPromotions.length + filteredAttentionPromotions.length === 0 ? (
                      <div className="empty-state">No promotion gates need attention right now.</div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>

            <div className="portal-grid" style={{ alignItems: 'start', marginTop: 24 }}>
              {(shouldShow('incidents') || shouldShow('failures')) ? (
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Incidents and failures</span>
                      <h2 className="portal-surface__title">Response queue</h2>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Link href="/incidents" className="btn btn-secondary btn-sm">Incidents</Link>
                      <Link href="/retry-center" className="btn btn-secondary btn-sm">Retry center</Link>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {shouldShow('incidents')
                      ? filteredIncidents.slice(0, 6).map((item) => (
                          <article key={`incident-${item.id}`} className="portal-surface" style={{ padding: 16 }}>
                            <strong>{item.incident_number || `INC${String(item.id).padStart(7, '0')}`} · {item.project_name || `Request #${item.request_id}`}</strong>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                              {item.severity} · {item.status} · {formatDateTime(item.updated_at)}
                            </div>
                            <p style={{ marginTop: 8 }}>{item.summary}</p>
                          </article>
                        ))
                      : null}
                    {shouldShow('failures')
                      ? filteredDeliveryFailures.slice(0, 6).map((item) => (
                          <article key={`failure-${item.id}`} className="portal-surface" style={{ padding: 16 }}>
                            <strong>{item.job_type}</strong>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                              {item.target} · retries {item.retry_count} · {formatDateTime(item.updated_at)}
                            </div>
                            <p style={{ marginTop: 8 }}>{item.error_message}</p>
                          </article>
                        ))
                      : null}
                    {(shouldShow('incidents') && filteredIncidents.length === 0 && (!shouldShow('failures') || filteredDeliveryFailures.length === 0)) ||
                    (shouldShow('failures') && filteredDeliveryFailures.length === 0 && (!shouldShow('incidents') || filteredIncidents.length === 0)) ? (
                      <div className="empty-state">No active incidents or unresolved delivery failures.</div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {(shouldShow('expiry') || shouldShow('namespaces')) ? (
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Expiry and workload</span>
                      <h2 className="portal-surface__title">Operational watchlists</h2>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Link href="/credential-audit" className="btn btn-secondary btn-sm">Credential audit</Link>
                      <Link href="/k8s" className="btn btn-secondary btn-sm">K8s dashboard</Link>
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="templates-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Project</th>
                          <th>Resource</th>
                          <th>State</th>
                          <th>Days / Issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shouldShow('expiry')
                          ? filteredExpiryItems.slice(0, 8).map((item) => (
                              <tr key={item.item_key}>
                                <td>{item.category}</td>
                                <td>{item.project_name || item.project_code || '—'}</td>
                                <td>
                                  <strong>{item.resource_name}</strong>
                                  {item.environment ? (
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.environment.toUpperCase()}</div>
                                  ) : null}
                                </td>
                                <td>{item.workflow_state}</td>
                                <td>{item.days_remaining}</td>
                              </tr>
                            ))
                          : null}
                        {shouldShow('namespaces')
                          ? filteredNamespaceAlerts.slice(0, 8).map((item) => (
                              <tr key={`${item.project_id}-${item.namespace}-${item.cluster_name}`}>
                                <td>namespace</td>
                                <td>{item.project_name}</td>
                                <td>
                                  <strong>{item.namespace}</strong>
                                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.cluster_name}</div>
                                </td>
                                <td>{item.status}</td>
                                <td>{item.issue_count}</td>
                              </tr>
                            ))
                          : null}
                        {(shouldShow('expiry') && filteredExpiryItems.length === 0 && (!shouldShow('namespaces') || filteredNamespaceAlerts.length === 0)) ||
                        (shouldShow('namespaces') && filteredNamespaceAlerts.length === 0 && (!shouldShow('expiry') || filteredExpiryItems.length === 0)) ? (
                          <tr>
                            <td colSpan={5}><div className="empty-state">No watchlist items match the current filters.</div></td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {shouldShow('overrides') ? (
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Access overrides</span>
                      <h2 className="portal-surface__title">Temporary elevated access</h2>
                    </div>
                    <Link href="/access-overrides" className="btn btn-secondary btn-sm">Open overrides</Link>
                  </div>
                  {filteredOverrides.length === 0 ? (
                    <div className="empty-state">No active overrides in the current scope.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {filteredOverrides.map((item) => (
                        <article key={`override-${item.id}`} className="portal-surface" style={{ padding: 16 }}>
                          <strong>{item.project_name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                            {item.username} · {item.permission} · expires {formatDateTime(item.expires_at)}
                          </div>
                          <p style={{ marginTop: 8 }}>{item.reason}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
