import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import {
  BulkBar,
  CostCheckCard,
  DataTable,
  Day2Banner,
  DeliveryVisibilityCard,
  InspectorDrawer,
  ResourceContextPanel,
  PlanReviewCard,
  PolicyChecksCard,
  PageFilters,
  SavedViews,
  UndoToaster,
  useSavedFilterViews,
  CopyButton,
  RelativeTime,
  formatCalendarDate,
  formatOperationalTime,
  queryString,
  useUndoQueue,
  type DataTableColumn,
  type DeliveryVisibility,
  type PlanReview,
  type PolicyCheckSummary,
  type RequestCostCheck,
  type RequestOperation,
  type RowKey,
  type SavedView,
} from '@infragate/ui';
import DevOpsLayout from '../components/DevOpsLayout';
import { RequestPRImpact, useConfirm } from '@infragate/ui';
import { useApiUrl } from '../context/ApiUrlContext';
import { getRecentRequestIds, addRecentRequestId } from '../lib/recentRequests';
import { asRecord, getString } from '../lib/payload';
import { expireSession } from '../lib/sessionExpiry';
import { recordReference, requestIdFromQuery } from '../lib/recordRef';
import { approvalLevel, priorityTone, requestPriorityName } from '../lib/requestPriority';

const DEVOPS_TOKEN_KEY = 'devops_token';

const CLOUDS = ['AWS', 'GCP', 'Azure'];
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'pending_user_manager_approval', label: 'Pending user manager' },
  { value: 'pending_devops_approval', label: 'Pending DevOps approval' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
];

interface TicketFilters {
  idFilter: string;
  team: string;
  projectId: string;
  cloud: string;
  status: string;
  search: string;
  requester: string;
  sortBy: string;
  sortOrder: string;
  atRisk: boolean;
  mine: boolean;
}

const DEFAULT_TICKET_FILTERS: TicketFilters = {
  idFilter: '', team: '', projectId: '', cloud: '', status: '', search: '', requester: '', sortBy: 'created_at', sortOrder: 'desc', atRisk: false, mine: false,
};

const TICKET_VIEW_PRESETS: SavedView<TicketFilters>[] = [
  { name: 'Assigned to me', filters: { ...DEFAULT_TICKET_FILTERS, mine: true } },
  { name: 'Awaiting approval', filters: { ...DEFAULT_TICKET_FILTERS, status: 'pending_devops_approval' } },
  { name: 'Breaching SLA', filters: { ...DEFAULT_TICKET_FILTERS, atRisk: true, sortBy: 'due_date', sortOrder: 'asc' } },
];

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed': return 'ticket-status--success';
    case 'rejected': return 'ticket-status--danger';
    case 'in_progress': return 'ticket-status--info';
    case 'pending_approval':
    case 'pending_user_manager_approval':
    case 'pending_devops_approval':
      return 'ticket-status--warning';
    default: return 'ticket-status--default';
  }
}

function formatStatus(status: string): string {
  const value = typeof status === 'string' ? status : '';
  const map: Record<string, string> = {
    pending_approval: 'Pending approval',
    pending_user_manager_approval: 'Pending user manager',
    pending_devops_approval: 'Pending DevOps approval',
    in_progress: 'In progress',
    completed: 'Completed',
    rejected: 'Rejected',
  };
  return map[value] || value || 'Unknown';
}

function formatDateTime(value?: string | null): string {
  return value ? formatOperationalTime(value, 'Not available') : 'Not available';
}

function formatDateOnly(value?: string | null): string {
  return value ? formatCalendarDate(value, 'Not set') : 'Not set';
}

interface TicketRow {
  id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  due_date: string | null;
  due_status: '' | 'overdue' | 'due_soon';
  pr_url: string;
  created_at: string;
  updated_at: string;
  created_by_username?: string;
  config?: string;
}

interface BlockedByItem {
  id: number;
  status: string;
}

interface CostRiskSignal {
  severity: 'low' | 'medium' | 'high';
  category: string;
  title: string;
  detail: string;
}

interface CostRiskPreview {
  cost_link: string;
  estimated_band: string;
  estimated_monthly: string;
  estimate_basis: string;
  risk_level: 'low' | 'medium' | 'high';
  summary: string;
  signals: CostRiskSignal[];
}

interface ApprovalContext {
  rule_source: string;
  rule_environment: string;
  requires_manager_approval: boolean;
  requires_devops_approval: boolean;
  manager_path_available: boolean;
  current_stage: string;
  next_stage?: string;
  summary: string;
}

interface TicketDetail extends TicketRow {
  client_name?: string;
  application_id?: string;
  branch?: string;
  file_path?: string;
  config?: string;
  reject_reason?: string;
  terraform_plan_output?: string;
  jira_ticket_id?: string;
  depends_on?: number[];
  blocked_by?: number[];
  blocked_by_with_status?: BlockedByItem[];
  cost_risk_preview?: CostRiskPreview | null;
  approval_context?: ApprovalContext | null;
  plan_review?: PlanReview | null;
  policy_checks?: PolicyCheckSummary | null;
  cost_check?: RequestCostCheck | null;
  operation?: RequestOperation | null;
  last_merge?: {
    pr_number: number;
    title: string;
    risk_level: string;
    score: number;
    pr_url?: string;
    change_brief?: { headline?: string; risk_because?: string[]; changing?: { label: string; count: number }[] };
    similar_merges?: { pr_number: number; title?: string; headline?: string; later_revert?: { pr_number: number } }[];
  } | null;
  delivery?: DeliveryVisibility | null;
  high_risk_merge?: {
    required?: boolean;
    acknowledged?: boolean;
    message?: string;
    change_brief?: { headline?: string; risk_because?: string[]; changing?: { label: string; count: number }[] };
    similar_merges?: { pr_number: number; title?: string; headline?: string; later_revert?: { pr_number: number } }[];
    ack?: { username?: string; reasons?: string[]; created_at?: string };
  } | null;
}

interface RequestComment {
  id: number;
  request_id: number;
  user_id: number;
  username: string;
  body: string;
  created_at: string;
}

interface RequestTimelineEvent {
  id: number;
  kind: string;
  action: string;
  username: string;
  details: string;
  body?: string;
  created_at: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface ServiceBundleEntry {
  cloud: string;
  service: string;
  normalized_service?: string;
  display_name?: string;
  env?: string;
  config?: Record<string, any>;
}

function getPreviewRiskClass(level?: string): string {
  switch (level) {
    case 'high':
      return 'portal-preview-risk portal-preview-risk--high';
    case 'medium':
      return 'portal-preview-risk portal-preview-risk--medium';
    default:
      return 'portal-preview-risk portal-preview-risk--low';
  }
}

function getPreviewSignalClass(severity?: string): string {
  switch (severity) {
    case 'high':
      return 'portal-preview-signal portal-preview-signal--high';
    case 'medium':
      return 'portal-preview-signal portal-preview-signal--medium';
    default:
      return 'portal-preview-signal portal-preview-signal--low';
  }
}

function isAccessRequest(request: Pick<TicketRow, 'config'> | null | undefined): boolean {
  if (!request?.config) return false;
  try {
    const parsed = JSON.parse(request.config) as { request_type?: unknown };
    return typeof parsed.request_type === 'string' && parsed.request_type.trim().toLowerCase() === 'iam';
  } catch {
    return false;
  }
}

function getRequestServiceBundle(request: (Pick<TicketRow, 'config'> & { service_bundle?: ServiceBundleEntry[] }) | null | undefined): ServiceBundleEntry[] {
  if (Array.isArray(request?.service_bundle) && request.service_bundle.length > 0) {
    return request.service_bundle.filter((entry) => entry && entry.cloud && entry.service);
  }
  if (!request?.config) return [];
  try {
    const parsed = JSON.parse(request.config) as { service_bundle?: unknown; config?: { service_bundle?: unknown } };
    const serviceBundle = parsed?.service_bundle ?? parsed?.config?.service_bundle;
    return Array.isArray(serviceBundle) ? (serviceBundle as ServiceBundleEntry[]) : [];
  } catch {
    return [];
  }
}

function normalizeBundlePathSegment(value: string | number | undefined | null, fallback: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeBundleServicePathKey(cloud: string, service: string): string {
  const normalizedCloud = cloud.trim().toLowerCase();
  const normalizedService = service.trim().toLowerCase();
  if (normalizedCloud === 'gcp') {
    if (normalizedService === 'cloud-storage' || normalizedService === 'storage') return 'storage';
    if (normalizedService === 'cloud-sql' || normalizedService === 'cloudsql') return 'cloudsql';
  }
  return normalizedService || 'service';
}

function formatBundleEnvironmentLabel(entry: ServiceBundleEntry, request: TicketDetail | null | undefined): string {
  const rawEnv = entry.env || entry.config?.env || request?.env || 'env';
  return rawEnv.trim() ? rawEnv.trim().toUpperCase() : 'ENV';
}

function buildBundleTargetPath(request: TicketDetail, entry: ServiceBundleEntry): string {
  const projectKey = normalizeBundlePathSegment(request.project_code || request.project_name, 'project');
  const teamKey = normalizeBundlePathSegment(request.team, 'team');
  const cloudKey = normalizeBundlePathSegment(entry.cloud || request.cloud, 'cloud');
  const envKey = normalizeBundlePathSegment(entry.env || entry.config?.env || request.env, 'env');
  const serviceKey = normalizeBundlePathSegment(
    normalizeBundleServicePathKey(entry.cloud || request.cloud, entry.normalized_service || entry.service),
    'service',
  );
  const applicationKey = normalizeBundlePathSegment(request.application_id, 'application-id');
  return `project/${projectKey}/${teamKey}/${cloudKey}/envs/${envKey}/${serviceKey}/${applicationKey}/request.json`;
}

function groupServiceBundleByEnvironment(serviceBundle: ServiceBundleEntry[], request: TicketDetail | null | undefined) {
  const groups = new Map<string, ServiceBundleEntry[]>();
  for (const entry of serviceBundle) {
    const environment = formatBundleEnvironmentLabel(entry, request);
    const existing = groups.get(environment);
    if (existing) existing.push(entry);
    else groups.set(environment, [entry]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([environment, entries]) => ({ environment, entries }));
}

function getRequestBundleCount(request: Pick<TicketRow, 'config'> | null | undefined): number {
  return getRequestServiceBundle(request).length;
}

export default function DevOpsTickets() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [idFilter, setIdFilter] = useState('');
  const [team, setTeam] = useState('');
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [cloud, setCloud] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [requester, setRequester] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [atRisk, setAtRisk] = useState(false);
  const [mine, setMine] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [shareReady, setShareReady] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailSeq = useRef(0);
  const [detailRequest, setDetailRequest] = useState<TicketDetail | null>(null);
  const [detailComments, setDetailComments] = useState<RequestComment[]>([]);
  const [detailTimeline, setDetailTimeline] = useState<RequestTimelineEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailNotice, setDetailNotice] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [ackHighRiskMerge, setAckHighRiskMerge] = useState(false);
  const [ackReasons, setAckReasons] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pageSize, setPageSize] = useState(10);
  const [pendingDecisions, setPendingDecisions] = useState<Record<number, string>>({});
  const [actionError, setActionError] = useState('');
  const undoQueue = useUndoQueue(6000);
  const detailRequestIsAccess = isAccessRequest(detailRequest);
  const detailServiceBundle = getRequestServiceBundle(detailRequest);
  const detailServiceBundleGroups = groupServiceBundleByEnvironment(detailServiceBundle, detailRequest);
  const limit = pageSize;

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  const { remoteViews, ready: savedViewsReady, saveRemote, deleteRemote } = useSavedFilterViews<TicketFilters>({
    apiUrl,
    token,
    scope: 'devops_tickets',
    storageKey: 'infragate.devops.tickets.views',
    portal: 'devops',
  });

  const hasActiveFilters = Boolean(idFilter || team || cloud || status || search || requester || atRisk || mine);
  const activeFilterCount = [
    idFilter.trim(),
    team.trim(),
    cloud,
    status,
    search.trim(),
    requester.trim(),
    atRisk ? 'at-risk' : '',
    mine ? 'mine' : '',
    sortBy !== 'created_at' ? sortBy : '',
    sortOrder !== 'desc' ? sortOrder : '',
  ].filter(Boolean).length;
  const detailOutsideScope = Boolean(
    detailRequest && (
      (projectId && String(detailRequest.project_id || '') !== projectId) ||
      (environment && detailRequest.env.toLowerCase() !== environment.toLowerCase()) ||
      (status && detailRequest.status !== status) ||
      (cloud && detailRequest.cloud !== cloud) ||
      (team && detailRequest.team !== team) ||
      (search.trim() && !`${detailRequest.service} ${detailRequest.team} ${detailRequest.project_name || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    ),
  );
  const canActOnDetail = detailRequest?.status === 'pending_devops_approval' && !detailOutsideScope;

  const fetchTickets = () => {
    if (!token) return;
    setLoading(true);
    setListError('');
    const params = new URLSearchParams();
    if (idFilter.trim()) params.set('id', requestIdFromQuery(idFilter));
    if (team) params.set('team', team);
    if (projectId) params.set('project_id', projectId);
    if (environment) params.set('env', environment);
    if (cloud) params.set('cloud', cloud);
    if (status) params.set('status', status);
    if (search) params.set('q', search);
    if (requester) params.set('requester', requester);
    params.set('sort_by', sortBy);
    params.set('sort_order', sortOrder);
    if (atRisk) params.set('at_risk', 'true');
    if (mine) params.set('mine', '1');
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    fetch(`${apiUrl}/api/devops/requests?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.status === 401) {
          expireSession();
          return null;
        }
        if (res.status === 403) {
          setRequests([]);
          setTotal(0);
          setListError('You do not have access to this request queue. Your own requests are on My requests.');
          return null;
        }
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok || !Array.isArray(data.requests)) {
          setRequests([]);
          setTotal(0);
          setListError('The request queue could not be loaded.');
          return null;
        }
        return data;
      })
      .then((data) => {
        if (!data) return;
        setRequests(data.requests as TicketRow[]);
        if (typeof data.total_count === 'number') setTotal(data.total_count);
      })
      .catch(() => {
        setRequests([]);
        setTotal(0);
        setListError('We couldn’t load the request queue right now.');
      })
      .finally(() => setLoading(false));
  };

  const fetchProjects = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => (res.ok ? asRecord(await res.json().catch(() => ({}))) : null))
      .then((data) => setProjects(Array.isArray(data?.projects) ? (data.projects as Array<{ id: number; name: string; code: string }>) : []))
      .catch(() => setProjects([]));
  };

  const loadDetail = async (id: number, syncUrl = true) => {
    if (!token) return;
    detailSeq.current += 1;
    const seq = detailSeq.current;
    const isStale = () => seq !== detailSeq.current;
    setDetailId(id);
    setDetailLoading(true);
    setDetailError('');
    setDetailNotice('');
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const [detailRes, commentsRes, timelineRes] = await Promise.all([
        fetch(`${apiUrl}/api/devops/requests/${id}`, { headers }),
        fetch(`${apiUrl}/api/devops/requests/${id}/comments`, { headers }),
        fetch(`${apiUrl}/api/devops/requests/${id}/timeline`, { headers }),
      ]);

      if (!detailRes.ok) {
        const data = asRecord(await detailRes.json().catch(() => ({})));
        throw new Error(getString(data.error, 'Failed to load request'));
      }

      const detailData = asRecord(await detailRes.json());
      const commentsData = commentsRes.ok ? asRecord(await commentsRes.json().catch(() => ({}))) : {};
      const timelineData = timelineRes.ok ? asRecord(await timelineRes.json().catch(() => ({}))) : {};
      if (isStale()) return;
      const loadedId = Number(asRecord(detailData.request).id);
      if (loadedId && loadedId !== id) return;

      const detailRequestData = asRecord(detailData.request);
      setDetailRequest((detailData.request as TicketDetail | null) || null);
      setDetailComments(Array.isArray(commentsData.comments) ? (commentsData.comments as RequestComment[]) : []);
      const baseTimeline = Array.isArray(timelineData.timeline) ? (timelineData.timeline as RequestTimelineEvent[]) : [];
      const operatorRaw = detailRequestData.operator_activity;
      const operatorEvents = Array.isArray(operatorRaw) ? operatorRaw : [];
      const mergedTimeline: RequestTimelineEvent[] = [...baseTimeline];
      for (const raw of operatorEvents) {
        const op = asRecord(raw);
        const opId = typeof op.id === 'number' ? op.id : Number(op.id) || 0;
        const action = getString(op.action, 'operator_action');
        const result = getString(op.result, '');
        const summary = getString(op.summary, '');
        mergedTimeline.push({
          id: opId > 0 ? opId : mergedTimeline.length + 1,
          kind: 'operator_audit',
          action,
          username: getString(op.actor_username, 'Operator'),
          details: summary,
          body: result ? `${action} (${result})${summary ? ` — ${summary}` : ''}` : action,
          created_at: getString(op.created_at, new Date().toISOString()),
        });
      }
      mergedTimeline.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setDetailTimeline(mergedTimeline);
      setRejectReason(getString(detailRequestData.reject_reason));
      setAckHighRiskMerge(false);
      setAckReasons('');
      setCommentBody('');

      addRecentRequestId(id);
      setRecentIds(getRecentRequestIds());

      if (syncUrl) {
        sessionStorage.setItem('opstrellis-tickets-scroll', String(window.scrollY));
        const next = { ...(router.query as Record<string, string | string[]>), id: String(id) };
        void router.push({ pathname: '/tickets', query: next }, undefined, { shallow: true });
      }
    } catch (error) {
      if (isStale()) return;
      const message = error instanceof Error ? error.message : 'Failed to load request';
      setDetailError(message);
      setDetailRequest(null);
      setDetailComments([]);
      setDetailTimeline([]);
    } finally {
      if (!isStale()) setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    detailSeq.current += 1;
    if (router.query.id) {
      const next = { ...(router.query as Record<string, string | string[]>) };
      delete next.id;
      void router.replace({ pathname: '/tickets', query: next }, undefined, { shallow: true });
      return;
    }
    setDetailLoading(false);
    setDetailId(null);
    setDetailRequest(null);
    setDetailComments([]);
    setDetailTimeline([]);
    setDetailError('');
    setDetailNotice('');
    setCommentBody('');
    setRejectReason('');
    const savedScroll = Number(sessionStorage.getItem('opstrellis-tickets-scroll') || '');
    if (Number.isFinite(savedScroll)) window.requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  };

  const refreshDetail = async () => {
    if (!detailId) return;
    await loadDetail(detailId, false);
  };

  const acknowledgePlan = async (planHash: string, note: string) => {
    if (!token || !detailRequest) return;
    const id = detailRequest.id;
    const res = await fetch(`${apiUrl}/api/devops/requests/${id}/plan-review/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan_hash: planHash, note }),
    });
    const data = asRecord(await res.json().catch(() => ({})));
    const review = data.plan_review as PlanReview | undefined;
    if (review) setDetailRequest((prev) => (prev && prev.id === id ? { ...prev, plan_review: review } : prev));
    if (!res.ok) throw new Error(getString(data.error, 'Could not save the acknowledgement.'));
    setDetailNotice('Destructive plan acknowledged. The pull request can merge once its other checks pass.');
  };

  const submitComment = async () => {
    if (!token || !detailRequest || !commentBody.trim()) return;
    setCommentSubmitting(true);
    setDetailError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/requests/${detailRequest.id}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok) {
        setDetailError(getString(data.error, 'Failed to add comment'));
        return;
      }
      setCommentBody('');
      setDetailNotice('Comment added.');
      await loadDetail(detailRequest.id, false);
    } catch (_) {
      setDetailError('Failed to add comment');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const sendDevopsAction = async (path: string, body?: unknown) => {
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = asRecord(await res.json().catch(() => ({})));
    if (res.status === 428 && data.runbook_required) {
      const err = new Error(getString(data.error, 'Production runbook required')) as Error & { runbookRequired?: boolean };
      err.runbookRequired = true;
      throw err;
    }
    if (res.status === 428 && data.high_risk_merge_required) {
      const brief = data.change_brief && typeof data.change_brief === 'object' ? (data.change_brief as Record<string, unknown>) : null;
      const headline = brief && typeof brief.headline === 'string' ? brief.headline : '';
      const err = new Error(getString(data.error, 'High-risk merge acknowledgement required')) as Error & {
        highRiskMergeRequired?: boolean;
        changeBriefHeadline?: string;
      };
      err.highRiskMergeRequired = true;
      err.changeBriefHeadline = headline;
      throw err;
    }
    if (!res.ok) throw new Error(getString(data.error, `Request failed (${res.status})`));
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      throw new Error(`Some requests were not updated: ${(data.errors as string[]).join('; ')}`);
    }
    return data;
  };

  const setPendingFor = (ids: number[], label: string | null) => {
    setPendingDecisions((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        if (label) next[id] = label;
        else delete next[id];
      });
      return next;
    });
  };

  // Decisions are held client-side for the undo window; nothing reaches the backend until it closes.
  const scheduleDecision = (ids: number[], label: string, message: string, commit: () => Promise<unknown>, restoreSelection = false) => {
    if (ids.length === 0) return;
    setDetailError('');
    setDetailNotice('');
    setActionError('');
    setPendingFor(ids, label);
    undoQueue.schedule({
      message,
      commit: async () => {
        await commit();
      },
      revert: () => {
        setPendingFor(ids, null);
        if (restoreSelection) setSelectedIds(new Set(ids));
      },
      onError: (err) => {
        const text = err instanceof Error ? err.message : 'The change could not be applied';
        setActionError(text);
        fetchTickets();
      },
      onCommitted: () => {
        setPendingFor(ids, null);
        fetchTickets();
        if (detailId && ids.includes(detailId)) void loadDetail(detailId, false);
        window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
      },
    });
  };

  const handleDecision = (action: 'approve' | 'reject') => {
    if (!token || !detailRequest) return;
    const id = detailRequest.id;
    const reason = rejectReason.trim();
    if (action === 'reject') setRejectReason('');
    scheduleDecision(
      [id],
      action === 'approve' ? 'Approving' : 'Rejecting',
      `${action === 'approve' ? 'Approved' : 'Rejected'} ${recordReference('REQ', id)}`,
      async () => {
        try {
          const freshRes = await fetch(`${apiUrl}/api/devops/requests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          const freshData = asRecord(await freshRes.json().catch(() => ({})));
          if (!freshRes.ok) {
            throw new Error(getString(freshData.error, 'This request could not be rechecked. The decision was not applied.'));
          }
          const freshStatus = getString(asRecord(freshData.request).status);
          if (freshStatus !== 'pending_devops_approval') {
            throw new Error(`This request is now ${freshStatus.replace(/_/g, ' ') || 'in a different state'}. The decision was not applied. Refresh the queue before trying again.`);
          }
          await sendDevopsAction(
            `/api/devops/requests/${id}/${action}`,
            action === 'reject'
              ? { reason }
              : ackHighRiskMerge
                ? {
                    high_risk_merge_acknowledged: true,
                    ack_reasons: ackReasons.split('\n').map((line) => line.trim()).filter(Boolean),
                  }
                : undefined,
          );
        } catch (err) {
          const gateErr = err as Error & { runbookRequired?: boolean; highRiskMergeRequired?: boolean; changeBriefHeadline?: string };
          if (action === 'approve' && gateErr.runbookRequired) {
            const ok = await confirm({
              title: 'Runbook acknowledgment',
              message: `${gateErr.message}\n\nAcknowledge that the production runbook is linked (or add one under Guides) and approve anyway?`,
              confirmLabel: 'Approve anyway',
            });
            if (!ok) throw err;
            await sendDevopsAction(`/api/devops/requests/${id}/${action}`, { runbook_acknowledged: true });
            return;
          }
          if (action === 'approve' && gateErr.highRiskMergeRequired) {
            const headline = gateErr.changeBriefHeadline ? `\n\nChanging: ${gateErr.changeBriefHeadline}` : '';
            const ok = await confirm({
              title: 'High-risk merge',
              message: `${gateErr.message}${headline}\n\nAcknowledge the high-risk merge change brief and approve anyway?`,
              confirmLabel: 'Approve anyway',
            });
            if (!ok) throw err;
            await sendDevopsAction(`/api/devops/requests/${id}/${action}`, {
              high_risk_merge_acknowledged: true,
              ack_reasons: ackReasons.split('\n').map((line) => line.trim()).filter(Boolean),
            });
            return;
          }
          throw err;
        }
      },
    );
  };

  const isDevopsPending = (row: { id: number; status: string }) => row.status === 'pending_devops_approval' && !pendingDecisions[row.id];
  const selectedActionableIds = Array.from<number>(selectedIds).filter((id) => {
    const row = requests.find((req) => req.id === id);
    return row ? isDevopsPending(row) : false;
  });

  const handleBulk = (action: 'approve' | 'reject') => {
    const ids = selectedActionableIds.slice(0, 50);
    if (ids.length === 0) return;
    let reason = '';
    if (action === 'reject') {
      const input = window.prompt(`Reject ${ids.length} request(s)? Add a reason (optional, visible to requesters):`);
      if (input === null) return;
      reason = input.trim();
    }
    setSelectedIds(new Set());
    setDetailNotice(`Sending ${ids.length} on this page. Each item is recorded separately.`);
    scheduleDecision(
      ids,
      action === 'approve' ? 'Approving' : 'Rejecting',
      `${action === 'approve' ? 'Approved' : 'Rejected'} ${ids.length} request${ids.length === 1 ? '' : 's'}`,
      async () => {
        const outcomes: string[] = [];
        for (const id of ids) {
          try {
            const freshRes = await fetch(`${apiUrl}/api/devops/requests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
            const freshData = asRecord(await freshRes.json().catch(() => ({})));
            const freshStatus = getString(asRecord(freshData.request).status);
            if (!freshRes.ok || freshStatus !== 'pending_devops_approval') {
              outcomes.push(`${recordReference('REQ', id)} is now ${freshStatus.replace(/_/g, ' ') || 'unavailable'}. It was left unchanged.`);
              continue;
            }
            await sendDevopsAction(`/api/devops/requests/${id}/${action}`, action === 'reject' ? { reason } : undefined);
            outcomes.push(`${recordReference('REQ', id)} recorded`);
          } catch {
            outcomes.push(`${recordReference('REQ', id)} not recorded`);
          }
        }
        const failed = outcomes.filter((line) => line.endsWith('not recorded'));
        const summary = outcomes.join('; ');
        if (failed.length === ids.length) throw new Error(summary);
        if (failed.length) setActionError(summary);
        else setDetailNotice(summary);
      },
      true,
    );
  };

  const handleSortChange = (key: string) => {
    if (sortBy === key) setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    else {
      setSortBy(key);
      setSortOrder('desc');
    }
    setOffset(0);
  };

  const ticketColumns: DataTableColumn<TicketRow>[] = [
    {
      id: 'request',
      header: 'Request',
      width: '46%',
      className: 'ig-col-title',
      cell: (req) => {
        const bundleCount = getRequestBundleCount(req);
        const context = [req.project_name, req.env, req.team || req.created_by_username].filter(Boolean).join(' · ');
        return (
          <div className="ig-cell-stack">
            <span className="ig-cell-title">{req.service || 'Request'}</span>
            <span className="ig-cell-meta">
              <span className="ig-mono">{recordReference('REQ', req.id)}</span>
              <CopyButton value={recordReference('REQ', req.id)} label="request reference" />
              {context ? ` · ${context}` : ''}
              {bundleCount > 1 ? ` · ${bundleCount}` : ''}
              {isAccessRequest(req) ? ' · Access' : ''}
            </span>
          </div>
        );
      },
    },
    {
      id: 'priority',
      header: 'Priority',
      sortable: true,
      cell: (req) => {
        const priority = typeof req.priority === 'string' && req.priority.trim() ? req.priority.trim().toLowerCase() : 'medium';
        return <span className={`ig-priority ig-priority--${priorityTone(priority)}`}>{requestPriorityName(priority)}</span>;
      },
    },
    {
      id: 'due_date',
      header: 'Due',
      sortable: true,
      cell: (req) => (
        <div className="ig-cell-stack">
          <span className="ig-cell-meta">{formatDateOnly(req.due_date)}</span>
          {req.due_status === 'overdue' ? <span className="ig-badge ig-badge--danger">Overdue</span> : null}
          {req.due_status === 'due_soon' ? <span className="ig-badge ig-badge--medium">Due in 24h</span> : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (req) =>
        pendingDecisions[req.id] ? (
          <span className="ig-badge ig-badge--info">{pendingDecisions[req.id]}…</span>
        ) : (
          <span className={`ticket-status ${getStatusBadgeClass(req.status)}`}>{formatStatus(req.status)}</span>
        ),
    },
    {
      id: 'updated_at',
      header: 'Updated',
      sortable: true,
      cell: (req) => (
        <span className="ig-cell-meta">
          <RelativeTime value={req.updated_at} />
        </span>
      ),
    },
    {
      id: 'pr',
      header: <span className="ig-sr-only">Pull request</span>,
      align: 'right',
      cell: (req) =>
        req.pr_url ? (
          <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            PR ↗
          </a>
        ) : null,
    },
  ];

  useEffect(() => {
    if (!token) router.replace('/login');
  }, [token, router]);

  useEffect(() => {
    const saveScroll = () => {
      if (!window.location.pathname.startsWith('/tickets')) return;
      sessionStorage.setItem('opstrellis-tickets-scroll', String(window.scrollY));
    };
    router.events.on('routeChangeStart', saveScroll);
    return () => router.events.off('routeChangeStart', saveScroll);
  }, [router]);

  useEffect(() => {
    if (!router.isReady || router.query.id) return;
    const savedScroll = Number(sessionStorage.getItem('opstrellis-tickets-scroll') || '');
    if (!Number.isFinite(savedScroll) || savedScroll <= 0) return;
    window.requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  }, [router.isReady, router.query.id]);

  useEffect(() => {
    if (!token) return;
    fetchTickets();
  }, [token, apiUrl, idFilter, team, projectId, environment, cloud, status, search, requester, sortBy, sortOrder, atRisk, mine, offset, limit]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [idFilter, team, projectId, environment, cloud, status, search, requester, sortBy, sortOrder, atRisk, mine, offset, limit]);

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(queryString(router.query, 'project_id'));
    setEnvironment(queryString(router.query, 'environment'));
    setStatus(queryString(router.query, 'status'));
    setSearch(queryString(router.query, 'q'));
    setMine(queryString(router.query, 'mine') === '1');
    setAtRisk(queryString(router.query, 'at_risk') === 'true');
    setShareReady(true);
  }, [router.isReady, router.query.project_id, router.query.environment, router.query.status, router.query.q, router.query.mine, router.query.at_risk]);

  useEffect(() => {
    if (!router.isReady || !shareReady) return;
    const next: Record<string, string | string[]> = { ...router.query as Record<string, string | string[]> };
    const assign = (key: string, value: string) => {
      if (value) next[key] = value;
      else delete next[key];
    };
    assign('status', status);
    assign('q', search);
    assign('project_id', projectId);
    assign('environment', environment);
    assign('mine', mine ? '1' : '');
    assign('at_risk', atRisk ? 'true' : '');
    const same = ['status', 'q', 'project_id', 'environment', 'mine', 'at_risk'].every((key) => String(next[key] || '') === queryString(router.query, key));
    if (same) return;
    void router.replace({ pathname: '/tickets', query: next }, undefined, { shallow: true });
  }, [atRisk, environment, mine, projectId, router.isReady, router.query, search, shareReady, status]);

  useEffect(() => {
    fetchProjects();
  }, [apiUrl, token]);

  useEffect(() => {
    if (team || cloud || requester || atRisk || sortBy !== 'created_at' || sortOrder !== 'desc') {
      setFilterExpanded(true);
    }
  }, [team, cloud, requester, atRisk, sortBy, sortOrder]);

  useEffect(() => {
    setRecentIds(getRecentRequestIds());
    const stored = window.localStorage.getItem('opstrellis-ticket-columns');
    if (stored) setHiddenColumns(stored.split(',').map((id) => id.trim()).filter(Boolean));
  }, []);

  useEffect(() => {
    if (requests.length === 1 && idFilter.trim()) {
      const id = parseInt(idFilter.trim(), 10);
      if (!Number.isNaN(id) && requests[0].id === id) {
        addRecentRequestId(id);
        setRecentIds(getRecentRequestIds());
      }
    }
  }, [requests, idFilter]);

  useEffect(() => {
    if (!router.isReady || !token) return;
    const idParam = router.query.id;
    const parsed = typeof idParam === 'string' ? parseInt(idParam, 10) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0 && parsed !== detailId) {
      loadDetail(parsed, false);
      return;
    }
    if ((typeof idParam !== 'string' || Number.isNaN(parsed) || parsed <= 0) && detailId) {
      detailSeq.current += 1;
      setDetailLoading(false);
      setDetailId(null);
      setDetailRequest(null);
      setDetailComments([]);
      setDetailTimeline([]);
      setDetailError('');
      setDetailNotice('');
      setCommentBody('');
      setRejectReason('');
      const savedScroll = Number(sessionStorage.getItem('opstrellis-tickets-scroll') || '');
      if (Number.isFinite(savedScroll)) window.requestAnimationFrame(() => window.scrollTo(0, savedScroll));
    }
  }, [router.isReady, router.query.id, token, detailId]);

  const goToRecent = (id: number) => {
    setIdFilter(String(id));
    setTeam('');
    setCloud('');
    setStatus('');
    setSearch('');
    setRequester('');
    setAtRisk(false);
    setMine(false);
    setOffset(0);
    loadDetail(id);
  };

  const applyFilterSet = (next: TicketFilters) => {
    setIdFilter(next.idFilter);
    setTeam(next.team);
    setProjectId(next.projectId);
    setCloud(next.cloud);
    setStatus(next.status);
    setSearch(next.search);
    setRequester(next.requester);
    setSortBy(next.sortBy);
    setSortOrder(next.sortOrder);
    setAtRisk(next.atRisk);
    setMine(Boolean(next.mine));
    setOffset(0);
    setFilterExpanded(Boolean(next.team || next.cloud || next.requester || next.atRisk || next.sortBy !== 'created_at' || next.sortOrder !== 'desc'));
  };

  const clearFilters = () => applyFilterSet(DEFAULT_TICKET_FILTERS);

  const currentFilters: TicketFilters = { idFilter, team, projectId, cloud, status, search, requester, sortBy, sortOrder, atRisk, mine };

  return (
    <>
      <Head>
        <title>Requests - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="devops-tickets-page">
          <div className="devops-tickets-header">
            <div>
              <h1 className="devops-tickets-title">Requests</h1>
              {recentIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Recent:</span>
                  {recentIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: 13 }}
                      onClick={() => goToRecent(id)}
                      title={`Open ${recordReference('REQ', id)}`}
                    >
                      {recordReference('REQ', id)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <PageFilters
            chips={[
              projectId ? { key: 'project', label: 'Project', value: projects.find((item) => String(item.id) === projectId)?.name || projectId } : null,
              environment ? { key: 'environment', label: 'Environment', value: environment } : null,
              status ? { key: 'status', label: 'Status', value: formatStatus(status) } : null,
              search ? { key: 'q', label: 'Search', value: search } : null,
              team ? { key: 'team', label: 'Team', value: team } : null,
              atRisk ? { key: 'at_risk', label: 'Risk', value: 'At risk' } : null,
            ].filter((chip): chip is { key: string; label: string; value: string } => Boolean(chip))}
            onClear={hasActiveFilters ? clearFilters : undefined}
          />

          <SavedViews<TicketFilters>
            storageKey="infragate.devops.tickets.views"
            current={currentFilters}
            onApply={applyFilterSet}
            presets={TICKET_VIEW_PRESETS}
            canSave={activeFilterCount > 0}
            serverViews={savedViewsReady ? remoteViews : undefined}
            onServerSave={saveRemote}
            onServerDelete={deleteRemote}
          />

          <div className="devops-filter-ribbon card">
            <div className="devops-filter-ribbon__bar">
              <label className="devops-filter-ribbon__pill">
                <span className="devops-filter-ribbon__key">Request #</span>
                <input
                  type="text"
                  placeholder="REQ0000013"
                  value={idFilter}
                  onChange={(e) => setIdFilter(e.target.value)}
                  className="devops-filter-ribbon__control"
                />
              </label>
              <label className="devops-filter-ribbon__pill devops-filter-ribbon__pill--search">
                <span className="devops-filter-ribbon__key">Search</span>
                <input
                  type="text"
                  placeholder="Project, team, service, or requester"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="devops-filter-ribbon__control"
                />
              </label>
              <label className="devops-filter-ribbon__pill">
                <span className="devops-filter-ribbon__key">Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="devops-filter-ribbon__control">
                  {STATUS_OPTIONS.map((entry) => (
                    <option key={entry.value || 'all'} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </label>
              <div className="devops-filter-ribbon__actions">
                {activeFilterCount > 0 && <span className="devops-filter-ribbon__badge">{activeFilterCount} active</span>}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setFilterExpanded(!filterExpanded)}
                  aria-expanded={filterExpanded}
                >
                  {filterExpanded ? 'Less' : 'More'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters} disabled={!activeFilterCount}>
                  Clear
                </button>
              </div>
            </div>

            <div className="devops-filter-ribbon__footer">
              <span className="devops-filter-ribbon__hint">Results update automatically. Open more only when you need a narrower queue.</span>
            </div>

            {filterExpanded && (
              <div className="devops-filter-ribbon__panel">
                <div className="devops-filter-ribbon__panel-grid">
                  <label className="devops-tickets-filter-group">
                    <span className="devops-tickets-filter-label">Team</span>
                    <input
                      type="text"
                      placeholder="Team name"
                      value={team}
                      onChange={(e) => setTeam(e.target.value)}
                      className="input devops-tickets-filter-input"
                    />
                  </label>
                  <label className="devops-tickets-filter-group">
                    <span className="devops-tickets-filter-label">Cloud</span>
                    <select value={cloud} onChange={(e) => setCloud(e.target.value)} className="input devops-tickets-filter-input">
                      <option value="">All clouds</option>
                      {CLOUDS.map((entry) => (
                        <option key={entry} value={entry}>{entry}</option>
                      ))}
                    </select>
                  </label>
                  <label className="devops-tickets-filter-group">
                    <span className="devops-tickets-filter-label">Requester</span>
                    <input
                      type="text"
                      placeholder="Username or user ID"
                      value={requester}
                      onChange={(e) => setRequester(e.target.value)}
                      className="input devops-tickets-filter-input"
                    />
                  </label>
                  <label className="devops-tickets-filter-group">
                    <span className="devops-tickets-filter-label">Sort by</span>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="input devops-tickets-filter-input">
                      <option value="created_at">Created</option>
                      <option value="updated_at">Updated</option>
                      <option value="priority">Priority</option>
                      <option value="due_date">Due date</option>
                    </select>
                  </label>
                  <label className="devops-tickets-filter-group">
                    <span className="devops-tickets-filter-label">Order</span>
                    <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input devops-tickets-filter-input">
                      <option value="desc">Newest first</option>
                      <option value="asc">Oldest first</option>
                    </select>
                  </label>
                  <div className="devops-tickets-filter-group devops-tickets-filter-group--checkbox">
                    <label className="devops-tickets-filter-checkbox">
                      <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
                      <span>Assigned to me</span>
                    </label>
                    <p className="access-hint">Includes requests assigned to you and requests you raised.</p>
                  </div>
                  <div className="devops-tickets-filter-group devops-tickets-filter-group--checkbox">
                    <label className="devops-tickets-filter-checkbox">
                      <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} />
                      <span>Breaching SLA</span>
                    </label>
                    <p className="access-hint">Requests that are overdue or due soon.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {actionError ? (
            <div className="alert alert-error" role="alert">
              {actionError}
            </div>
          ) : null}

          {!loading && listError ? (
            <div className="portal-table-state portal-table-state--error">
              <div className="portal-table-state__icon" aria-hidden>!</div>
              <h3 className="portal-table-state__title">We couldn’t load this queue</h3>
              <p className="portal-table-state__copy">{listError}</p>
              <div className="portal-table-state__actions">
                <button type="button" className="btn btn-secondary" onClick={fetchTickets}>
                  Try again
                </button>
                <Link href="/my-requests" className="btn btn-secondary">My requests</Link>
              </div>
            </div>
          ) : (
            <>
              <div className="devops-tickets-summary">
                <span>Showing {requests.length} of {total} requests</span>
                <span>Open a row to work the request without leaving this page.</span>
                <span>
                  <label className="devops-tickets-filter-checkbox">
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.includes('updated_at')}
                      onChange={() => {
                        setHiddenColumns((current) => {
                          const next = current.includes('updated_at') ? current.filter((id) => id !== 'updated_at') : [...current, 'updated_at'];
                          window.localStorage.setItem('opstrellis-ticket-columns', next.join(','));
                          return next;
                        });
                      }}
                    />
                    <span>Updated</span>
                  </label>
                  <label className="devops-tickets-filter-checkbox">
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.includes('pr')}
                      onChange={() => {
                        setHiddenColumns((current) => {
                          const next = current.includes('pr') ? current.filter((id) => id !== 'pr') : [...current, 'pr'];
                          window.localStorage.setItem('opstrellis-ticket-columns', next.join(','));
                          return next;
                        });
                      }}
                    />
                    <span>Pull request</span>
                  </label>
                </span>
              </div>
              <div className="devops-tickets-table-card card ig-table-card">
                <DataTable<TicketRow>
                  label="DevOps request queue"
                  columns={ticketColumns.filter((column) => !hiddenColumns.includes(column.id))}
                  rows={requests}
                  rowKey={(req) => req.id}
                  loading={loading}
                  selectable
                  selectedKeys={selectedIds as Set<RowKey>}
                  onSelectionChange={(next) => setSelectedIds(new Set(Array.from(next).map(Number)))}
                  isRowSelectable={isDevopsPending}
                  activeKey={detailId}
                  onRowOpen={(req) => void loadDetail(req.id)}
                  sort={{ key: sortBy, direction: sortOrder === 'asc' ? 'asc' : 'desc' }}
                  onSortChange={handleSortChange}
                  rowClassName={(req) => (pendingDecisions[req.id] ? 'is-pending' : undefined)}
                  rowVersion={(req) => req.status}
                  empty={
                    <div className="ig-table-empty">
                      <strong>No requests match these filters</strong>
                      <p>Clear a filter or two to bring the queue back.</p>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </div>
                  }
                />
              </div>
              <p className="ig-table-hint">
                <span className="ig-kbd">J</span>/<span className="ig-kbd">K</span> move · <span className="ig-kbd">Enter</span> open ·{' '}
                <span className="ig-kbd">X</span> select · <span className="ig-kbd">Esc</span> close
              </p>
              <div className="devops-tickets-pagination">
                  <span className="devops-tickets-pagination-info">
                    Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))} ({total} total). Selection is this page only.
                  </span>
                  <label className="label">
                    Page size
                    <select
                      className="input"
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setOffset(0);
                        setSelectedIds(new Set());
                      }}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </label>
                  <div className="devops-tickets-pagination__actions">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))}>
                      Previous
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={offset + limit >= total} onClick={() => setOffset((value) => value + limit)}>
                      Next
                    </button>
                  </div>
                </div>
            </>
          )}

          <BulkBar count={selectedIds.size} noun="request" onClear={() => setSelectedIds(new Set())}>
            <span>{selectedActionableIds.length} on this page can be sent. Each result is recorded separately.</span>
            <button type="button" className="btn btn-primary btn-sm" disabled={selectedActionableIds.length === 0} onClick={() => handleBulk('approve')}>
              Approve
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={selectedActionableIds.length === 0} onClick={() => handleBulk('reject')}>
              Reject
            </button>
          </BulkBar>

          <UndoToaster
            entries={undoQueue.entries}
            onUndo={undoQueue.undo}
            onCommit={(id) => void undoQueue.commitNow(id)}
            onUndoLatest={undoQueue.undoLatest}
          />

          {(detailId || detailLoading || detailRequest) && (
            <InspectorDrawer
              open
              onClose={closeDetail}
              resetKey={detailId}
              returnFocusId={detailId ? `ig-row-${detailId}` : undefined}
              label="Request details"
              eyebrow={detailRequestIsAccess ? 'Access request' : 'Request'}
              title={
                detailRequest ? (
                  <>
                    <span className="ig-mono">{recordReference('REQ', detailRequest.id)}</span> <CopyButton value={recordReference('REQ', detailRequest.id)} label="request reference" /> {detailRequest.service}
                  </>
                ) : (
                  'Loading request'
                )
              }
              subtitle={detailRequest ? [detailRequest.project_name, detailRequest.team, detailRequest.env].filter(Boolean).join(' · ') : undefined}
              headerActions={
                <>
                  {detailRequest && pendingDecisions[detailRequest.id] ? (
                    <span className="ig-badge ig-badge--info">{pendingDecisions[detailRequest.id]}…</span>
                  ) : null}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={refreshDetail} disabled={detailLoading}>
                    Refresh
                  </button>
                </>
              }
            >
              <div className="devops-approval-workspace">
              {detailOutsideScope ? (
                <div className="alert" role="status">
                  This request is outside the current project, environment, or filters. Approvals stay off until it is back in the list.
                </div>
              ) : null}
              {detailId ? (
                <ResourceContextPanel
                  apiUrl={apiUrl}
                  token={token}
                  kind="ticket"
                  resourceId={detailId}
                  hideDelivery
                />
              ) : null}
              {detailLoading && !detailRequest ? (
                <div className="empty-state">Loading approval workspace...</div>
              ) : (
                <>
                  {detailError && <div className="alert alert-error">{detailError}</div>}
                  {detailNotice && <div className="devops-approval-workspace__notice">{detailNotice}</div>}

                  {detailRequest ? (
                    <>
                      <Day2Banner operation={detailRequest.operation} />
                      <DeliveryVisibilityCard delivery={detailRequest.delivery} portal="devops" />
                      <PlanReviewCard review={detailRequest.plan_review} env={detailRequest.env} onAcknowledge={acknowledgePlan} />
                      <PolicyChecksCard summary={detailRequest.policy_checks} />
                      <CostCheckCard check={detailRequest.cost_check} />
                    </>
                  ) : null}

                  {detailRequest && (
                    <section className="portal-surface portal-surface--tight" aria-label="Decision summary">
                      <div className="portal-surface__header">
                        <div>
                          <span className="portal-surface__eyebrow">Before you decide</span>
                          <h3 className="portal-surface__title">Decision summary</h3>
                        </div>
                      </div>
                      <div className="devops-approval-workspace__meta-grid">
                        <div className="devops-approval-workspace__meta-item"><span>Requested change</span><strong>{detailRequest.service || 'Unknown'}</strong></div>
                        <div className="devops-approval-workspace__meta-item"><span>Scope</span><strong>{[detailRequest.project_name, detailRequest.team, detailRequest.env].filter(Boolean).join(' · ') || 'Unknown'}</strong></div>
                        <div className="devops-approval-workspace__meta-item"><span>Priority</span><strong>{requestPriorityName(detailRequest.priority)}</strong></div>
                        <div className="devops-approval-workspace__meta-item"><span>Approval level</span><strong>{approvalLevel(detailRequest.priority)}</strong></div>
                        <div className="devops-approval-workspace__meta-item"><span>Duration</span><strong>{detailRequest.due_date ? `Due ${formatDateOnly(detailRequest.due_date)}` : 'No duration recorded'}</strong></div>
                        <div className="devops-approval-workspace__meta-item"><span>Evidence</span><strong>{detailRequest.pr_url ? 'Pull request linked in this request' : 'No supporting link yet'}</strong></div>
                      </div>
                    </section>
                  )}

                  {detailRequest && (
                    <div className="devops-approval-workspace__grid">
                      <section className="portal-surface portal-surface--tight devops-approval-workspace__summary-surface">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Request Summary</span>
                            <h3 className="portal-surface__title">Execution Context</h3>
                          </div>
                          <span className={`ticket-status ${getStatusBadgeClass(detailRequest.status)} devops-approval-workspace__summary-status`}>
                            {formatStatus(detailRequest.status)}
                          </span>
                        </div>
                        <div className="devops-approval-workspace__meta-grid">
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Project</span>
                            <strong>{detailRequest.project_name || 'Not set'}</strong>
                            {detailRequest.project_code ? <small>{detailRequest.project_code}</small> : null}
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Team</span>
                            <strong>{detailRequest.team}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Environment</span>
                            <strong>{detailRequest.env}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Cloud</span>
                            <strong>{detailRequest.cloud}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">{detailRequestIsAccess ? 'Target' : 'Service'}</span>
                            <strong>{detailRequest.service}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Requester</span>
                            <strong>{detailRequest.created_by_username || 'Not available'}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Priority</span>
                            <strong>{requestPriorityName(detailRequest.priority)}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Approval level</span>
                            <strong>{approvalLevel(detailRequest.priority)}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Due date</span>
                            <strong>{formatDateOnly(detailRequest.due_date)}</strong>
                            {detailRequest.due_status && (
                              <small className={`devops-approval-workspace__due devops-approval-workspace__due--${detailRequest.due_status}`}>
                                {detailRequest.due_status === 'overdue' ? 'Overdue' : 'Due in 24h'}
                              </small>
                            )}
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Application ID</span>
                            <strong>{detailRequest.application_id || 'Not set'}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Request branch</span>
                            <strong>{detailRequest.branch || 'Not set'}</strong>
                            <small>project/&lt;project-code&gt;/&lt;team-slug&gt;/&lt;cloud&gt;/&lt;env&gt;/&lt;service&gt;/&lt;request-id&gt;</small>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Config path</span>
                            <strong>{detailRequest.file_path || 'Not set'}</strong>
                            <small>project/&lt;project-code&gt;/&lt;team-slug&gt;/&lt;cloud&gt;/envs/&lt;env&gt;/&lt;service&gt;/&lt;application-id&gt;/request.json</small>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Created</span>
                            <strong>{formatDateTime(detailRequest.created_at)}</strong>
                          </div>
                          <div className="devops-approval-workspace__meta-item">
                            <span className="devops-approval-workspace__meta-label">Updated</span>
                            <strong>{formatDateTime(detailRequest.updated_at)}</strong>
                          </div>
                        </div>

                        <div className="devops-approval-workspace__dependency-strip">
                          <div className="devops-approval-workspace__dependency-card">
                            <span className="devops-approval-workspace__meta-label">Depends on</span>
                            <strong>{detailRequest.depends_on?.length || 0}</strong>
                            <p>{detailRequest.depends_on?.length ? detailRequest.depends_on.map((entry) => recordReference('REQ', entry)).join(', ') : 'No upstream dependencies'}</p>
                          </div>
                          <div className="devops-approval-workspace__dependency-card">
                            <span className="devops-approval-workspace__meta-label">Blocking</span>
                            <strong>{detailRequest.blocked_by_with_status?.length || 0}</strong>
                            <p>
                              {detailRequest.blocked_by_with_status?.length
                                ? detailRequest.blocked_by_with_status.map((entry) => `${recordReference('REQ', entry.id)} (${formatStatus(entry.status)})`).join(', ')
                                : 'No downstream dependencies'}
                            </p>
                          </div>
                        </div>

                        {detailRequest.cost_risk_preview && (
                          <div className="portal-preview-panel">
                            <div className="portal-surface__header">
                              <div>
                                <span className="portal-surface__eyebrow">Cost And Risk</span>
                                <h3 className="portal-surface__title">Approval Preview</h3>
                              </div>
                              <span className={getPreviewRiskClass(detailRequest.cost_risk_preview.risk_level)}>
                                {detailRequest.cost_risk_preview.risk_level} risk
                              </span>
                            </div>

                            <div className="portal-preview-grid">
                              <div className="portal-preview-card">
                                <span className="portal-preview-eyebrow">Estimated monthly</span>
                                <strong className="portal-preview-value">{detailRequest.cost_risk_preview.estimated_monthly}</strong>
                                <p className="portal-preview-copy">
                                  {detailRequest.cost_risk_preview.estimated_band} footprint. {detailRequest.cost_risk_preview.estimate_basis}
                                </p>
                              </div>
                              <div className="portal-preview-card">
                                <span className="portal-preview-eyebrow">Review summary</span>
                                <strong className="portal-preview-value">{detailRequest.cost_risk_preview.signals.length} signals</strong>
                                <p className="portal-preview-copy">{detailRequest.cost_risk_preview.summary}</p>
                              </div>
                            </div>

                            {detailRequest.cost_risk_preview.cost_link && (
                              <div className="portal-preview-actions">
                                <a href={detailRequest.cost_risk_preview.cost_link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                  Open cost calculator
                                </a>
                              </div>
                            )}

                            <div className="portal-preview-signals">
                              {detailRequest.cost_risk_preview.signals.length > 0 ? (
                                detailRequest.cost_risk_preview.signals.map((signal) => (
                                  <article key={`${signal.category}-${signal.title}`} className={getPreviewSignalClass(signal.severity)}>
                                    <div className="portal-preview-signal__top">
                                      <strong className="portal-preview-signal__title">{signal.title}</strong>
                                      <span className={getPreviewRiskClass(signal.severity)}>{signal.severity}</span>
                                    </div>
                                    <p className="portal-preview-signal__detail">{signal.detail}</p>
                                  </article>
                                ))
                              ) : (
                                <article className={getPreviewSignalClass('low')}>
                                  <div className="portal-preview-signal__top">
                                    <strong className="portal-preview-signal__title">No major heuristic risks</strong>
                                    <span className={getPreviewRiskClass('low')}>low</span>
                                  </div>
                                  <p className="portal-preview-signal__detail">
                                    The request did not trigger major risk heuristics, but approval should still verify ownership, rollback, and expected spend.
                                  </p>
                                </article>
                              )}
                            </div>
                          </div>
                        )}
                        {detailRequest.approval_context && (
                          <div className="portal-preview-panel">
                            <div className="portal-surface__header">
                              <div>
                                <span className="portal-surface__eyebrow">Approval Flow</span>
                                <h3 className="portal-surface__title">Project rule explanation</h3>
                              </div>
                              <span className={getPreviewRiskClass(detailRequest.approval_context.requires_devops_approval ? 'medium' : 'low')}>
                                {detailRequest.approval_context.current_stage}
                              </span>
                            </div>
                            <div className="portal-preview-grid">
                              <div className="portal-preview-card">
                                <span className="portal-preview-eyebrow">Current stage</span>
                                <strong className="portal-preview-value">{detailRequest.approval_context.current_stage}</strong>
                                <p className="portal-preview-copy">
                                  {detailRequest.approval_context.next_stage
                                    ? `Next stage: ${detailRequest.approval_context.next_stage}`
                                    : 'No further approval stage is pending.'}
                                </p>
                              </div>
                              <div className="portal-preview-card">
                                <span className="portal-preview-eyebrow">Rule source</span>
                                <strong className="portal-preview-value">
                                  {detailRequest.approval_context.rule_source === 'project_rule' ? 'Project rule' : 'Default flow'}
                                </strong>
                                <p className="portal-preview-copy">{detailRequest.approval_context.summary}</p>
                              </div>
                            </div>
                            <div className="devops-approval-workspace__signal-row">
                              <span className={getPreviewSignalClass(detailRequest.approval_context.requires_manager_approval ? 'medium' : 'low')}>
                                {detailRequest.approval_context.requires_manager_approval ? 'Manager gate enabled' : 'No manager gate'}
                              </span>
                              <span className={getPreviewSignalClass(detailRequest.approval_context.requires_devops_approval ? 'medium' : 'low')}>
                                {detailRequest.approval_context.requires_devops_approval ? 'DevOps gate enabled' : 'No DevOps gate'}
                              </span>
                            </div>
                          </div>
                        )}

                        {detailRequest.reject_reason && (
                          <div className="devops-approval-workspace__reason">
                            <span className="devops-approval-workspace__meta-label">Reject reason</span>
                            <p>{detailRequest.reject_reason}</p>
                          </div>
                        )}

                        {detailServiceBundle.length > 1 && (
                          <div className="portal-surface portal-surface--tight devops-approval-workspace__bundle-surface">
                            <div className="portal-surface__header">
                              <div>
                                <span className="portal-surface__eyebrow">Service Bundle</span>
                                <h3 className="portal-surface__title">Target file layout</h3>
                              </div>
                            </div>
                            <p className="devops-approval-workspace__bundle-copy">
                              This request carries multiple services. Review the exact per-environment target files before approving the delivery path.
                            </p>
                            <div className="devops-approval-workspace__bundle-groups">
                              {detailServiceBundleGroups.map((group) => (
                                <div key={group.environment} className="devops-approval-workspace__bundle-group">
                                  <div className="devops-approval-workspace__bundle-group-head">
                                    <strong>{group.environment}</strong>
                                    <span className="devops-approval-workspace__bundle-group-count">
                                      {group.entries.length} service{group.entries.length === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                  <div className="portal-detail-grid">
                                    {group.entries.map((entry, index) => (
                                      <article key={`${group.environment}-${entry.cloud}-${entry.service}-${index}`} className="portal-detail-card">
                                        <span className="devops-approval-workspace__meta-label">Service {index + 1}</span>
                                        <strong className="portal-detail-card__value">{entry.display_name || entry.service}</strong>
                                        <p className="devops-approval-workspace__bundle-copy">
                                          {group.environment} · {(entry.cloud || detailRequest.cloud || 'cloud').toUpperCase()}
                                        </p>
                                        <code className="devops-approval-workspace__bundle-path">
                                          {buildBundleTargetPath(detailRequest, entry)}
                                        </code>
                                      </article>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <details className="devops-approval-workspace__details" open>
                          <summary>{detailRequestIsAccess ? 'Access request details' : 'Request details'}</summary>
                          <pre className="devops-approval-workspace__code">{detailRequest.config || '{}'}</pre>
                        </details>

                        {detailRequest.terraform_plan_output && (
                          <details className="devops-approval-workspace__details">
                            <summary>Terraform plan output</summary>
                            <p className="portal-surface__subtitle" style={{ marginBottom: 8 }}>
                              Compare add/change/destroy counts with the PR file list in the impact brief. Destroys and “plan 2 / PR 12 files” mismatches are flagged there.
                            </p>
                            <pre className="devops-approval-workspace__code">{detailRequest.terraform_plan_output}</pre>
                          </details>
                        )}
                      </section>

                      <section className="portal-surface portal-surface--tight devops-approval-workspace__decision-surface">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Decision Panel</span>
                            <h3 className="portal-surface__title">Approval Controls</h3>
                          </div>
                          {detailRequest.pr_url ? (
                            <a href={detailRequest.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                              Open PR
                            </a>
                          ) : null}
                          <RequestPRImpact compact apiUrl={apiUrl} token={typeof window === 'undefined' ? null : localStorage.getItem(DEVOPS_TOKEN_KEY)} requestId={detailRequest.id} />
                          <a href={`/incidents`} className="btn btn-secondary btn-sm">
                            Incident panel
                          </a>
                          <a href={`/runbooks`} className="btn btn-secondary btn-sm">
                            Runbooks
                          </a>
                        </div>

                        <div className="devops-approval-workspace__decision-copy">
                          <p>
                            {canActOnDetail
                              ? 'This request is waiting for DevOps approval. Review the configuration, comments, and dependency state before deciding.'
                              : 'This request is no longer waiting on DevOps approval. Use this workspace to review context and discussion.'}
                          </p>
                        </div>

                        {detailRequest.high_risk_merge?.required || detailRequest.last_merge ? (
                          <div className="admin-request-detail-modal__notice" style={{ marginBottom: 16 }}>
                            <strong className="admin-request-detail-modal__notice-title">
                              {detailRequest.high_risk_merge?.change_brief?.headline
                                || detailRequest.last_merge?.change_brief?.headline
                                || 'Recent merge'}
                            </strong>
                            <p className="admin-request-detail-modal__notice-copy">
                              {detailRequest.high_risk_merge?.message
                                || `Last merge PR #${detailRequest.last_merge?.pr_number} · ${detailRequest.last_merge?.risk_level} · score ${detailRequest.last_merge?.score}`}
                            </p>
                            {(detailRequest.high_risk_merge?.change_brief?.risk_because
                              || detailRequest.last_merge?.change_brief?.risk_because
                              || []).slice(0, 3).map((reason) => (
                                <p key={reason} className="admin-request-detail-modal__notice-copy">{reason}</p>
                              ))}
                            {(detailRequest.high_risk_merge?.similar_merges
                              || detailRequest.last_merge?.similar_merges
                              || []).slice(0, 3).map((item) => (
                                <p key={item.pr_number} className="admin-request-detail-modal__notice-copy">
                                  Similar #{item.pr_number} {item.headline || item.title || ''}
                                  {item.later_revert ? ` · later revert #${item.later_revert.pr_number}` : ''}
                                </p>
                              ))}
                            {detailRequest.high_risk_merge?.ack ? (
                              <p className="admin-request-detail-modal__notice-copy">
                                Acknowledged by {detailRequest.high_risk_merge.ack.username || 'reviewer'}
                                {detailRequest.high_risk_merge.ack.reasons?.length
                                  ? `: ${detailRequest.high_risk_merge.ack.reasons.join('; ')}`
                                  : ''}
                              </p>
                            ) : null}
                            {canActOnDetail && detailRequest.high_risk_merge?.required ? (
                              <>
                                <label className="portal-toolbar__item" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={ackHighRiskMerge}
                                    onChange={(event) => setAckHighRiskMerge(event.target.checked)}
                                  />
                                  <span>Acknowledge risks in this change brief</span>
                                </label>
                                <textarea aria-label="Exception reasons"
                                  className="input devops-approval-workspace__textarea"
                                  rows={3}
                                  value={ackReasons}
                                  onChange={(event) => setAckReasons(event.target.value)}
                                  placeholder="Exception reasons (required)"
                                />
                              </>
                            ) : null}
                          </div>
                        ) : null}

                        <label className="label" htmlFor="devops-reject-reason">Reject reason</label>
                        <textarea
                          id="devops-reject-reason"
                          className="input devops-approval-workspace__textarea"
                          rows={4}
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                          placeholder="Explain why this request should not move forward"
                        />

                        <div className="devops-approval-workspace__actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleDecision('approve')}
                            disabled={!canActOnDetail || Boolean(pendingDecisions[detailRequest.id]) || (Boolean(detailRequest.high_risk_merge?.required) && (!ackHighRiskMerge || !ackReasons.trim()))}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleDecision('reject')}
                            disabled={!canActOnDetail || Boolean(pendingDecisions[detailRequest.id])}
                          >
                            Reject
                          </button>
                        </div>
                      </section>

                      <section className="portal-surface portal-surface--tight">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Comments</span>
                            <h3 className="portal-surface__title">Request Discussion</h3>
                          </div>
                        </div>

                        {detailComments.length === 0 ? (
                          <div className="devops-approval-workspace__empty">No comments yet.</div>
                        ) : (
                          <div className="devops-approval-workspace__comment-list">
                            {detailComments.map((comment) => (
                              <article key={comment.id} className="devops-approval-workspace__comment-item">
                                <div className="devops-approval-workspace__comment-meta">
                                  <strong>{comment.username}</strong>
                                  <span>{formatDateTime(comment.created_at)}</span>
                                </div>
                                <p>{comment.body}</p>
                              </article>
                            ))}
                          </div>
                        )}

                        <div className="devops-approval-workspace__comment-form">
                          <label className="label" htmlFor="devops-comment-body">Add comment</label>
                          <textarea
                            id="devops-comment-body"
                            className="input devops-approval-workspace__textarea"
                            rows={4}
                            value={commentBody}
                            onChange={(event) => setCommentBody(event.target.value)}
                            placeholder="Add a decision note, implementation concern, or follow-up"
                          />
                          <div className="devops-approval-workspace__actions">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={submitComment}
                              disabled={!commentBody.trim() || commentSubmitting}
                            >
                              {commentSubmitting ? 'Posting...' : 'Post comment'}
                            </button>
                          </div>
                        </div>
                      </section>

                      <section className="portal-surface portal-surface--tight">
                        <div className="portal-surface__header">
                          <div>
                            <span className="portal-surface__eyebrow">Timeline</span>
                            <h3 className="portal-surface__title">Request Activity</h3>
                          </div>
                        </div>

                        {detailTimeline.length === 0 ? (
                          <div className="devops-approval-workspace__empty">No activity recorded yet.</div>
                        ) : (
                          <div className="devops-approval-workspace__timeline">
                            {detailTimeline.map((event) => {
                              const kind = (event.kind || event.action || 'update').toLowerCase();
                              const label = kind.includes('comment') ? 'Comment' : kind.includes('approv') ? 'Approval' : kind.includes('status') ? 'Status' : kind.includes('operator') || kind.includes('audit') ? 'Automated' : 'Update';
                              return (
                              <article key={`${event.kind}-${event.id}`} className={`devops-approval-workspace__timeline-item is-${label.toLowerCase()}`}>
                                <div className="devops-approval-workspace__timeline-meta">
                                  <span className="ig-badge ig-badge--info">{label}</span>
                                  <strong>{event.username || 'System'}</strong>
                                  <span>{formatDateTime(event.created_at)}</span>
                                  {kind.includes('internal') ? <span className="ig-badge ig-badge--medium">Internal note</span> : null}
                                </div>
                                <p>{event.body || event.details || event.action}</p>
                              </article>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                </>
              )}
              </div>
            </InspectorDrawer>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
