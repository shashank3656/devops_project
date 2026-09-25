import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  CostCheckCard,
  DataTable,
  InspectorDrawer,
  PlanReviewCard,
  PolicyChecksCard,
  PageFilters,
  formatRelativeTime,
  queryString,
  type DataTableColumn,
  type PlanReview,
  type PolicyCheckSummary,
  type RequestCostCheck,
  type RequestLifetime,
} from '@infragate/ui';
import { useToast } from '../context/ToastContext';
import CalendarDateInput from '../components/CalendarDateInput';
import RequestPRImpact from '../components/RequestPRImpact';
import RequestLifecyclePanel from '../components/RequestLifecyclePanel';

import { maskSensitiveJson } from '../lib/maskSensitive';
import { getRecentRequestIds, addRecentRequestId } from '../lib/recentRequests';

const TEMPLATE_KEY = 'infra-request-template';
const HISTORY_FILTER_PRESETS_KEY = 'infra-history-filter-presets';
const HISTORY_LAST_FILTERS_KEY = 'infra-history-last-filters';

interface FilterPreset {
  name: string;
  filterType: string;
  filterValue: string;
  projectId: string;
  statusFilter: string;
  fromDate: string;
  toDate: string;
  viewMode: 'mine' | 'team';
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

interface ServiceBundleEntry {
  env?: string;
  cloud: string;
  service: string;
  normalized_service?: string;
  display_name?: string;
  config?: Record<string, any>;
}

interface RequestBundleSummary {
  count: number;
  clouds?: string[];
  services?: string[];
  display_names?: string[];
}

interface PRRequest {
  id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  env: string;
  cloud: string;
  service: string;
  application_id?: string;
  client_name?: string;
  priority?: string;
  due_date?: string | null;
  pr_url: string;
  branch: string;
  file_path: string;
  status: string;
  reject_reason?: string;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  created_by_username?: string;
  config?: string;
  bundle_mode?: boolean;
  service_bundle?: ServiceBundleEntry[];
  bundle_summary?: RequestBundleSummary | null;
  cost_risk_preview?: CostRiskPreview | null;
  approval_context?: ApprovalContext | null;
  plan_review?: PlanReview | null;
  policy_checks?: PolicyCheckSummary | null;
  cost_check?: RequestCostCheck | null;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
}

interface RequestComment {
  id: number;
  request_id: number;
  user_id: number;
  username: string;
  body: string;
  created_at: string;
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

function isAccessRequest(req: PRRequest | null | undefined): boolean {
  if (!req?.config) return false;
  try {
    const parsed = JSON.parse(req.config) as { request_type?: unknown };
    return typeof parsed.request_type === 'string' && parsed.request_type.trim().toLowerCase() === 'iam';
  } catch {
    return false;
  }
}

function getRequestServiceBundle(req: PRRequest | null | undefined): ServiceBundleEntry[] {
  if (!req) return [];
  if (Array.isArray(req.service_bundle) && req.service_bundle.length > 0) {
    return req.service_bundle.filter((entry) => entry && entry.cloud && entry.service);
  }
  if (!req.config) return [];
  try {
    const parsed = JSON.parse(req.config) as { service_bundle?: unknown; config?: { service_bundle?: unknown } };
    const serviceBundle = parsed.service_bundle ?? parsed.config?.service_bundle;
    if (!Array.isArray(serviceBundle)) return [];
    return serviceBundle.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, any>;
      const cloud = typeof record.cloud === 'string' ? record.cloud.trim() : '';
      const service = typeof record.service === 'string' ? record.service.trim() : '';
      if (!cloud || !service) return [];
      const bundle: ServiceBundleEntry = {
        env: typeof record.env === 'string' ? record.env : typeof record.config?.env === 'string' ? record.config.env : undefined,
        cloud,
        service,
        normalized_service: typeof record.normalized_service === 'string' ? record.normalized_service : undefined,
        display_name: typeof record.display_name === 'string' ? record.display_name : undefined,
        config: record.config && typeof record.config === 'object' ? (record.config as Record<string, any>) : undefined,
      };
      return [bundle];
    });
  } catch {
    return [];
  }
}

function normalizeHistoryPathSegment(value: string | undefined, fallback: string): string {
  const normalized = (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeHistoryServicePathKey(cloud: string, service: string): string {
  const normalizedCloud = cloud.trim().toLowerCase();
  const normalizedService = service.trim().toLowerCase();
  if (normalizedCloud === 'gcp') {
    if (normalizedService === 'cloud-storage' || normalizedService === 'storage') return 'storage';
    if (normalizedService === 'cloud-sql' || normalizedService === 'cloudsql') return 'cloudsql';
  }
  return normalizedService || 'service';
}

function buildBundleTargetPath(req: PRRequest, entry: ServiceBundleEntry): string {
  const projectKey = normalizeHistoryPathSegment(req.project_code || req.project_name || '', 'project');
  const teamKey = normalizeHistoryPathSegment(req.team, 'team');
  const cloudKey = normalizeHistoryPathSegment(entry.cloud || req.cloud, 'cloud');
  const envKey = normalizeHistoryPathSegment(entry.env || entry.config?.env || req.env, 'env');
  const serviceKey = normalizeHistoryPathSegment(
    normalizeHistoryServicePathKey(entry.cloud || req.cloud, entry.normalized_service || entry.service),
    'service',
  );
  const applicationKey = normalizeHistoryPathSegment(req.application_id, 'application-id');
  return `project/${projectKey}/${teamKey}/${cloudKey}/envs/${envKey}/${serviceKey}/${applicationKey}/request.json`;
}

function formatBundleEnvironmentLabel(entry: ServiceBundleEntry, req: PRRequest | null | undefined): string {
  const rawEnv = entry.env || entry.config?.env || req?.env || 'env';
  return rawEnv.trim() ? rawEnv.trim().toUpperCase() : 'ENV';
}

function groupServiceBundleByEnvironment(serviceBundle: ServiceBundleEntry[], req: PRRequest | null | undefined) {
  const groups = new Map<string, ServiceBundleEntry[]>();
  for (const entry of serviceBundle) {
    const envLabel = formatBundleEnvironmentLabel(entry, req);
    const existing = groups.get(envLabel);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(envLabel, [entry]);
    }
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([environment, entries]) => ({ environment, entries }));
}

function buildRequestBundleSummary(serviceBundle: ServiceBundleEntry[]): RequestBundleSummary | null {
  if (serviceBundle.length === 0) return null;
  const clouds = Array.from(new Set(serviceBundle.map((entry) => entry.cloud))).sort();
  const services = Array.from(new Set(serviceBundle.map((entry) => entry.service))).sort();
  const displayNames = Array.from(
    new Set(
      serviceBundle
        .map((entry) => entry.display_name?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
  return {
    count: serviceBundle.length,
    clouds,
    services,
    display_names: displayNames,
  };
}

function withBundleMetadata(req: PRRequest): PRRequest {
  const serviceBundle = getRequestServiceBundle(req);
  if (serviceBundle.length === 0) return req;
  return {
    ...req,
    bundle_mode: req.bundle_mode ?? serviceBundle.length > 1,
    service_bundle: serviceBundle,
    bundle_summary: req.bundle_summary ?? buildRequestBundleSummary(serviceBundle),
  };
}

function getRequestStatusMeta(status: string): { label: string; tone: 'success' | 'error' | 'warning' | 'info' } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', tone: 'info' };
    case 'pending_approval':
      return { label: 'Waiting for review', tone: 'warning' };
    case 'pending_user_manager_approval':
      return { label: 'Waiting for your approval', tone: 'warning' };
    case 'pending_devops_approval':
      return { label: 'Waiting for platform team', tone: 'warning' };
    case 'in_progress':
      return { label: 'In progress', tone: 'info' };
    case 'completed':
      return { label: 'Completed', tone: 'success' };
    case 'rejected':
      return { label: 'Rejected', tone: 'error' };
    default:
      return { label: status.replace(/_/g, ' '), tone: 'info' };
  }
}

const PAGE_SIZE = 10;

export default function History() {
  const router = useRouter();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<'team' | 'pr_number' | 'env' | 'cloud' | 'search' | 'application_id'>('team');
  const [filterValue, setFilterValue] = useState('');
  const [projectId, setProjectId] = useState('');
  const [scopeEnv, setScopeEnv] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [detailRequest, setDetailRequest] = useState<PRRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [canApproveByManager, setCanApproveByManager] = useState(false);
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [compareWithId, setCompareWithId] = useState('');
  const [diffResult, setDiffResult] = useState<{ base: any; compare: any; changes: any[] } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [sortBy, setSortBy] = useState<'id' | 'created_at' | 'team' | 'cloud' | 'priority' | 'due_date'>('created_at');
  const [sortDesc, setSortDesc] = useState(true);
  const [viewMode, setViewMode] = useState<'mine' | 'team'>('mine');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const defaultedToTeamView = useRef(false);
  const [configHistory, setConfigHistory] = useState<{ id: number; config: string; created_at: string; note?: string }[]>([]);
  const [showConfigHistory, setShowConfigHistory] = useState(false);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [timeline, setTimeline] = useState<{ id: number; kind: string; action: string; username: string; details: string; body?: string; created_at: string }[]>([]);
  const [dependsOn, setDependsOn] = useState<number[]>([]);
  const [blockedBy, setBlockedBy] = useState<number[]>([]);
  const [lifetime, setLifetime] = useState<RequestLifetime | null>(null);
  const [newDepId, setNewDepId] = useState('');
  const [addingDep, setAddingDep] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const detailRequestIsAccess = isAccessRequest(detailRequest);
  const detailStatusMeta = detailRequest ? getRequestStatusMeta(detailRequest.status) : null;
  const detailServiceBundle = getRequestServiceBundle(detailRequest);
  const detailServiceBundleGroups = groupServiceBundleByEnvironment(detailServiceBundle, detailRequest);
  const activeFilterCount = [
    filterValue.trim(),
    projectId,
    statusFilter,
    fromDate,
    toDate,
    viewMode === 'team' ? 'team' : '',
    sortBy !== 'created_at' ? sortBy : '',
    !sortDesc ? 'ascending' : '',
  ].filter(Boolean).length;

  const formatTimelineAction = (action: string) => {
    const map: Record<string, string> = {
      request_create: 'created this request',
      request_submit: 'sent it for review',
      request_approved_by_manager: 'approved it as manager',
      request_approve: 'approved',
      request_reject: 'rejected',
      request_comment: 'left a comment',
      request_clone: 'copied this request',
      request_resubmit: 'created a new draft from this request',
      request_cancel: 'cancelled this request',
      request_promote: 'created the next environment request',
      request_plan_output: 'updated delivery output',
      request_reassign: 'reassigned this request',
    };
    return map[action] || action.replace(/_/g, ' ');
  };
  const [timelineLoading, setTimelineLoading] = useState(false);
  const rawConfigByRequestId = useRef<Record<number, string>>({});
  const detailSeq = useRef(0);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    if (!router.isReady) return;
    setProjectId(queryString(router.query, 'project_id'));
    setScopeEnv(queryString(router.query, 'environment'));
    setPage(0);
  }, [router.isReady, router.query.project_id, router.query.environment]);

  useEffect(() => {
    setRecentIds(getRecentRequestIds());
    try {
      const raw = localStorage.getItem(HISTORY_FILTER_PRESETS_KEY);
      if (raw) setPresets(JSON.parse(raw));
      const last = localStorage.getItem(HISTORY_LAST_FILTERS_KEY);
      if (last) {
        const l = JSON.parse(last) as FilterPreset;
        setFilterType((l.filterType as any) || 'team');
        setFilterValue(l.filterValue || '');
        setProjectId(l.projectId || '');
        setStatusFilter(l.statusFilter || '');
        setFromDate(l.fromDate || '');
        setToDate(l.toDate || '');
        setViewMode(l.viewMode || 'mine');
        if (l.fromDate || l.toDate || l.viewMode === 'team') {
          setShowAdvancedFilters(true);
        }
      }
    } catch (_) {}
  }, []);
  useEffect(() => {
    if (detailRequest) setRecentIds(getRecentRequestIds());
  }, [detailRequest]);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchHistory();
  }, [filterType, filterValue, projectId, scopeEnv, page, viewMode, statusFilter, fromDate, toDate]);

  useEffect(() => {
    try {
      const p: FilterPreset = {
        name: '',
        filterType,
        filterValue,
        projectId,
        statusFilter,
        fromDate,
        toDate,
        viewMode,
      };
      localStorage.setItem(HISTORY_LAST_FILTERS_KEY, JSON.stringify(p));
    } catch (_) {}
  }, [filterType, filterValue, projectId, statusFilter, fromDate, toDate, viewMode]);

  useEffect(() => {
    if (fromDate || toDate || viewMode === 'team' || sortBy !== 'created_at' || !sortDesc) {
      setShowAdvancedFilters(true);
    }
  }, [fromDate, toDate, viewMode, sortBy, sortDesc]);

  const savePreset = () => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const p: FilterPreset = { name, filterType, filterValue, projectId, statusFilter, fromDate, toDate, viewMode };
    const next = presets.filter((x) => x.name !== name).concat([p]);
    setPresets(next);
    setPresetName('');
    try {
      localStorage.setItem(HISTORY_FILTER_PRESETS_KEY, JSON.stringify(next));
    } catch (_) {}
    toast(`Saved preset "${name}"`, 'success');
  };

  const clearFilters = () => {
    setFilterValue('');
    setProjectId('');
    setStatusFilter('');
    setFromDate('');
    setToDate('');
    setViewMode('mine');
    setSortBy('created_at');
    setSortDesc(true);
    setPresetName('');
    setShowAdvancedFilters(false);
    setPage(0);
  };

  const loadPreset = (p: FilterPreset) => {
    setFilterType(p.filterType as any);
    setFilterValue(p.filterValue);
    setProjectId(p.projectId || '');
    setStatusFilter(p.statusFilter);
    setFromDate(p.fromDate);
    setToDate(p.toDate);
    setViewMode(p.viewMode);
    setPage(0);
    toast(`Loaded preset "${p.name}"`, 'success');
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.user?.id != null) setCurrentUserId(data.user.id);
        // Default to Group tickets view once for portal managers so they see all their group requests
        if (data?.user?.is_portal_manager === true && !defaultedToTeamView.current) {
          defaultedToTeamView.current = true;
          setViewMode('team');
        }
      })
      .catch(() => {});
    fetch(`${apiUrl}/api/me/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProjects(Array.isArray(data?.projects) ? data.projects : []))
      .catch(() => setProjects([]));
  }, [apiUrl]);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const params = new URLSearchParams();
      if (filterValue.trim()) {
        if (filterType === 'pr_number') {
          params.append('id', filterValue.trim());
        } else if (filterType === 'search') {
          params.append('q', filterValue.trim());
        } else if (filterType === 'application_id') {
          params.append('application_id', filterValue.trim());
        } else {
          params.append(filterType, filterValue.trim());
        }
      }
      if (projectId) params.append('project_id', projectId);
      if (scopeEnv) params.append('environment', scopeEnv);
      if (statusFilter) params.append('status', statusFilter);
      if (fromDate) params.append('from', fromDate);
      if (toDate) params.append('to', toDate);
      params.append('limit', String(PAGE_SIZE));
      params.append('offset', String(page * PAGE_SIZE));
      if (viewMode === 'team') params.append('view', 'team');

      const response = await fetch(`${apiUrl}/api/history?${params.toString()}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const requests = Array.isArray(data?.requests) ? data.requests.map(withBundleMetadata) : [];
      setRequests(requests);
      setTotalCount(data?.total_count ?? requests.length ?? 0);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchHistory();
    toast('History refreshed', 'success');
  };

  const closeDetail = () => {
    detailSeq.current += 1;
    setDetailLoading(false);
    setDetailRequest(null);
  };

  const openDetail = async (req: PRRequest) => {
    detailSeq.current += 1;
    const seq = detailSeq.current;
    const isStale = () => seq !== detailSeq.current;
    setDetailRequest(null);
    setCanApproveByManager(false);
    setComments([]);
    setTags([]);
    setDependsOn([]);
    setBlockedBy([]);
    setLifetime(null);
    setConfigHistory([]);
    setShowConfigHistory(false);
    setNewTag('');
    setDiffResult(null);
    setCommentBody('');
    setDetailLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;
      const [detailRes, commentsRes, tagsRes] = await Promise.all([
        fetch(`${apiUrl}/api/history/${req.id}`, { headers }),
        fetch(`${apiUrl}/api/request/${req.id}/comments`, { headers }),
        fetch(`${apiUrl}/api/request/${req.id}/tags`, { headers })
      ]);
      if (isStale()) return;
      if (detailRes.ok) {
        const data = await detailRes.json();
        if (isStale()) return;
        const full = withBundleMetadata(data.request || req);
        addRecentRequestId(full.id);
        setCanApproveByManager(Boolean(data.can_approve_by_manager));
        setDependsOn(Array.isArray(data.depends_on) ? data.depends_on : []);
        setBlockedBy(Array.isArray(data.blocked_by) ? data.blocked_by : []);
        setLifetime(data.lifetime || null);
        const enriched: PRRequest = {
          ...full,
          plan_review: (data.plan_review as PlanReview | undefined) ?? full.plan_review,
          policy_checks: (data.policy_checks as PolicyCheckSummary | undefined) ?? full.policy_checks,
          cost_check: (data.cost_check as RequestCostCheck | undefined) ?? full.cost_check,
        };
        if (enriched.config) {
          rawConfigByRequestId.current[enriched.id] = enriched.config;
          setDetailRequest({ ...enriched, config: maskSensitiveJson(enriched.config) });
        } else {
          setDetailRequest(enriched);
        }
      } else {
        addRecentRequestId(req.id);
        setDetailRequest(withBundleMetadata(req));
      }
      if (commentsRes.ok) {
        const cData = await commentsRes.json();
        if (isStale()) return;
        setComments(Array.isArray(cData?.comments) ? cData.comments : []);
      }
      const timelineRes = await fetch(`${apiUrl}/api/request/${req.id}/timeline`, { headers });
      if (timelineRes.ok) {
        const tData = await timelineRes.json();
        if (isStale()) return;
        setTimeline(Array.isArray(tData?.timeline) ? tData.timeline : []);
      }
      if (tagsRes.ok) {
        const tData = await tagsRes.json();
        if (isStale()) return;
        setTags(Array.isArray(tData?.tags) ? tData.tags : []);
      }
    } catch (_) {
      if (isStale()) return;
      addRecentRequestId(req.id);
      setDetailRequest(withBundleMetadata(req));
    } finally {
      if (!isStale()) setDetailLoading(false);
    }
  };

  const fetchTimeline = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    setTimelineLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/timeline`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setTimeline(Array.isArray(d?.timeline) ? d.timeline : []);
      }
    } catch (_) {
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  };

  const submitDraft = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        toast('Draft submitted for approval', 'success');
        setDetailRequest(null);
        fetchHistory();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d?.error || 'Failed to submit draft', 'error');
      }
    } catch (_) {
      toast('Failed to submit draft', 'error');
    }
  };

  const approveByManager = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/approve-by-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(d?.message || 'Approved; request is now pending DevOps approval', 'success');
        setDetailRequest(null);
        fetchHistory();
        window.dispatchEvent(new CustomEvent('pending-manager-approval-refresh'));
      } else {
        toast(d?.error || 'Failed to approve', 'error');
      }
    } catch (_) {
      toast('Failed to approve', 'error');
    }
  };

  const resubmitRequest = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/resubmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(d?.message || 'Request cloned as draft. Edit and submit from History.', 'success');
        setDetailRequest(null);
        fetchHistory();
      } else {
        toast(d?.error || 'Failed to resubmit', 'error');
      }
    } catch (_) {
      toast('Failed to resubmit', 'error');
    }
  };

  const cloneRequest = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(d?.message || 'Request cloned as draft. Edit and submit from History.', 'success');
        setDetailRequest(null);
        fetchHistory();
      } else {
        toast(d?.error || 'Failed to clone', 'error');
      }
    } catch (_) {
      toast('Failed to clone', 'error');
    }
  };

  const promoteRequest = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(d?.message || `Request created for ${d?.env || 'next env'}. Edit and submit from History.`, 'success');
        setDetailRequest(null);
        fetchHistory();
      } else {
        toast(d?.error || 'Failed to promote', 'error');
      }
    } catch (_) {
      toast('Failed to promote', 'error');
    }
  };

  const rollbackRequest = async (id: number, historyId?: number, config?: string) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const body: { history_id?: number; config?: string } = {};
      if (historyId) body.history_id = historyId;
      if (config) body.config = config;
      const res = await fetch(`${apiUrl}/api/request/${id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(d?.message || 'Config rolled back', 'success');
        setConfigHistory([]);
        setShowConfigHistory(false);
        if (detailRequest?.id === id) {
          const hr = await fetch(`${apiUrl}/api/history/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          if (hr.ok) {
            const hd = await hr.json();
            setDetailRequest(hd.request || hd);
          }
        }
        fetchHistory();
      } else {
        toast(d?.error || 'Failed to rollback', 'error');
      }
    } catch (_) {
      toast('Failed to rollback', 'error');
    }
  };

  const deleteDraft = async (id: number) => {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        toast('Draft deleted', 'success');
        setDetailRequest(null);
        fetchHistory();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d?.error || 'Failed to delete draft', 'error');
      }
    } catch (_) {
      toast('Failed to delete draft', 'error');
    }
  };

  const CANCELLABLE_STATUSES = ['draft', 'pending_user_manager_approval', 'pending_devops_approval', 'pending_approval'];

  const cancelRequest = async (id: number) => {
    if (!confirm('Cancel this ticket? It will be marked as cancelled.')) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(d?.message || 'Request cancelled', 'success');
        setDetailRequest(null);
        fetchHistory();
      } else {
        toast(d?.error || 'Failed to cancel ticket', 'error');
      }
    } catch (_) {
      toast('Failed to cancel ticket', 'error');
    }
  };

  const addComment = async () => {
    if (!detailRequest || !commentBody.trim()) return;
    setCommentSubmitting(true);
    const token = localStorage.getItem('token');
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: commentBody.trim() })
      });
      if (res.ok) {
        setCommentBody('');
        const listRes = await fetch(`${apiUrl}/api/request/${detailRequest.id}/comments`, { headers });
        if (listRes.ok) {
          const d = await listRes.json();
          setComments(Array.isArray(d?.comments) ? d.comments : []);
        }
        fetchTimeline(detailRequest.id);
        toast('Comment added', 'success');
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d?.error || 'Failed to add comment', 'error');
      }
    } catch (_) {
      toast('Failed to add comment', 'error');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const fetchConfigHistory = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/config-history?limit=20`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const d = await res.json();
        setConfigHistory(Array.isArray(d?.history) ? d.history : []);
        setShowConfigHistory(true);
      }
    } catch (_) {
      toast('Failed to load config history', 'error');
    }
  };

  const exportCSV = () => {
    const token = localStorage.getItem('token');
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;
    const params = new URLSearchParams();
    if (filterValue.trim()) {
      if (filterType === 'pr_number') params.append('id', filterValue.trim());
      else if (filterType === 'search') params.append('q', filterValue.trim());
      else if (filterType === 'application_id') params.append('application_id', filterValue.trim());
      else params.append(filterType, filterValue.trim());
    }
    if (projectId) params.append('project_id', projectId);
    if (scopeEnv) params.append('environment', scopeEnv);
    if (statusFilter) params.append('status', statusFilter);
    if (fromDate) params.append('from', fromDate);
    if (toDate) params.append('to', toDate);
    if (viewMode === 'team') params.append('view', 'team');
    params.set('format', 'csv');
    fetch(`${apiUrl}/api/history?${params.toString()}`, { headers })
      .then((res) => res.text())
      .then((csv) => {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pr-requests-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast('CSV exported successfully', 'success');
      })
      .catch(() => toast('Export failed', 'error'));
  };

  const applyAsTemplate = (req: PRRequest) => {
    try {
      const rawConfig = rawConfigByRequestId.current[req.id] ?? req.config ?? '';
      sessionStorage.setItem(TEMPLATE_KEY, JSON.stringify({
        project_id: req.project_id,
        team: req.team,
        env: req.env,
        cloud: req.cloud,
        service: req.service,
        client_name: req.client_name,
        config: rawConfig,
      }));
      setDetailRequest(null);
      router.push('/custom-json');
      toast('Template loaded. Edit and submit in Custom JSON.', 'success');
    } catch (_) {
      toast('Failed to use template', 'error');
    }
  };

  const saveConfiguration = async (req: PRRequest) => {
    const name = window.prompt('Name this saved configuration (e.g. "Prod EKS request"):');
    if (!name || !name.trim()) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    const rawConfig = rawConfigByRequestId.current[req.id] ?? req.config ?? '{}';
    try {
      const res = await fetch(`${apiUrl}/api/me/saved-configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          config: rawConfig,
          cloud: req.cloud,
          env: req.env,
          service: req.service,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('Saved. You can reuse it from Create Infrastructure → My saved configurations.', 'success');
      } else {
        toast(d?.error || 'Failed to save', 'error');
      }
    } catch (_) {
      toast('Failed to save configuration', 'error');
    }
  };

  const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const sortedRequests = [...requests].sort((a, b) => {
    let aVal: string | number = (a as any)[sortBy];
    let bVal: string | number = (b as any)[sortBy];
    if (sortBy === 'created_at') {
      aVal = new Date(a.created_at).getTime();
      bVal = new Date(b.created_at).getTime();
    } else if (sortBy === 'due_date') {
      aVal = a.due_date ? new Date(a.due_date).getTime() : 0;
      bVal = b.due_date ? new Date(b.due_date).getTime() : 0;
    } else if (sortBy === 'priority') {
      aVal = priorityOrder[(a as any).priority || 'medium'] ?? 2;
      bVal = priorityOrder[(b as any).priority || 'medium'] ?? 2;
    }
    if (aVal === bVal) return 0;
    const cmp = aVal > bVal ? 1 : -1;
    return sortDesc ? -cmp : cmp;
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSortChange = (key: string) => {
    if (sortBy === key) setSortDesc((desc) => !desc);
    else {
      setSortBy(key as typeof sortBy);
      setSortDesc(true);
    }
  };

  const isOwner = (req: PRRequest) => currentUserId == null || req.created_by === currentUserId;

  const historyColumns: DataTableColumn<PRRequest>[] = [
    {
      id: 'id',
      header: 'Request',
      sortable: true,
      cell: (req) => (
        <div className="ig-cell-stack">
          <span className="ig-cell-title">{req.service || 'Request'}</span>
          <span className="ig-cell-meta">
            <span className="ig-mono">#{req.id}</span>
            {req.bundle_summary && req.bundle_summary.count > 1 ? ` · ${req.bundle_summary.count} services` : ''}
            {isAccessRequest(req) ? ' · Access' : ''}
            {viewMode === 'team' && req.created_by_username ? ` · ${req.created_by_username}` : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'team',
      header: 'Project',
      sortable: true,
      cell: (req) => (
        <div className="ig-cell-stack">
          <span>{req.project_name || '—'}</span>
          <span className="ig-cell-meta">{req.team}</span>
        </div>
      ),
    },
    {
      id: 'cloud',
      header: 'Target',
      sortable: true,
      cell: (req) => (
        <span className="ig-cell-chips">
          <span className="ig-chip">{req.env || '—'}</span>
          <span className="ig-chip ig-chip--muted">{(req.cloud || '—').toUpperCase()}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (req) => {
        const meta = getRequestStatusMeta(req.status);
        return <span className={`status-badge ${meta.tone}`}>{meta.label}</span>;
      },
    },
    {
      id: 'created_at',
      header: 'Created',
      sortable: true,
      cell: (req) => (
        <span className="ig-cell-meta" title={formatDate(req.created_at)}>
          {formatRelativeTime(req.created_at) || formatDate(req.created_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="ig-sr-only">Actions</span>,
      align: 'right',
      cell: (req) => (
        <div className="ig-row-actions">
          {req.pr_url ? (
            <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              PR ↗
            </a>
          ) : null}
          {isOwner(req) && ['completed', 'in_progress'].includes(req.status) ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => promoteRequest(req.id)} title="Promote to next environment">
              Promote
            </button>
          ) : null}
          {isOwner(req) ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => cloneRequest(req.id)} title="Clone as new draft">
              Clone
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <Head>
        <title>My Requests - SetuOps</title>
      </Head>
      <div className="history-page">
        <div className="history-page__header">
          <div>
            <h1 className="page-header__title">My Requests</h1>
            <p style={{ marginTop: 8, color: 'var(--text-secondary)', maxWidth: 720 }}>
              Check status, open comments, and reuse earlier requests without digging through technical details.
            </p>
          </div>
          {recentIds.length > 0 && (
            <div className="history-recent" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Recent requests:</span>
              {recentIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openDetail({ id } as PRRequest)}
                  title={`Open ticket #${id}`}
                >
                  #{id}
                </button>
              ))}
            </div>
          )}
          <div className="history-page__actions">
            <button onClick={handleRefresh} className="btn btn-secondary" disabled={loading} title="Refresh">
              Refresh list
            </button>
            <button onClick={exportCSV} className="btn btn-secondary" disabled={loading}>
              Download CSV
            </button>
          </div>
        </div>

        <PageFilters
          chips={[
            projectId ? { key: 'project', label: 'Project', value: projects.find((item) => String(item.id) === projectId)?.name || projectId } : null,
            scopeEnv ? { key: 'environment', label: 'Environment', value: scopeEnv } : null,
            statusFilter ? { key: 'status', label: 'Status', value: statusFilter } : null,
            filterValue ? { key: 'q', label: 'Filter', value: filterValue } : null,
          ].filter((chip): chip is { key: string; label: string; value: string } => Boolean(chip))}
          onClear={clearFilters}
        />

        <div className="card history-filter-card">
          <div className="history-filter-shell history-filter-shell--compact">
            <div className="history-filter-bar" role="group" aria-label="Request filters">
              <label className="history-filter-pill history-filter-pill--type">
                <span className="history-filter-pill__caption">Filter</span>
                <select
                  id="filter-type"
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value as 'team' | 'pr_number' | 'env' | 'cloud' | 'search' | 'application_id');
                    setFilterValue('');
                  }}
                  className="history-filter-pill__control"
                  aria-label="Filter type"
                >
                  <option value="team">Team</option>
                  <option value="pr_number">Request #</option>
                  <option value="application_id">App ID</option>
                  <option value="env">Environment</option>
                  <option value="cloud">Cloud</option>
                  <option value="search">Anything</option>
                </select>
              </label>

              <label className="history-filter-pill history-filter-pill--search">
                <span className="history-filter-pill__caption">Value</span>
                <input
                  id="filter-value"
                  type={filterType === 'pr_number' ? 'number' : 'text'}
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  placeholder={
                    filterType === 'pr_number' ? 'Enter request number'
                      : filterType === 'search' ? 'Search team, project, cloud, or service'
                      : filterType === 'team' ? 'Enter team name'
                      : filterType === 'application_id' ? 'Enter application ID'
                      : filterType === 'env' ? 'Enter environment'
                      : 'Enter cloud provider'
                  }
                  className="history-filter-pill__control"
                  aria-label="Filter value"
                />
              </label>

              <label className="history-filter-pill">
                <span className="history-filter-pill__caption">Project</span>
                <select
                  value={projectId}
                  onChange={(e) => { setProjectId(e.target.value); setPage(0); }}
                  className="history-filter-pill__control"
                  aria-label="Project"
                >
                  <option value="">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                  ))}
                </select>
              </label>

              <label className="history-filter-pill">
                <span className="history-filter-pill__caption">Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                  className="history-filter-pill__control"
                  aria-label="Status"
                >
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="pending_approval">Pending approval</option>
                  <option value="pending_devops_approval">Pending DevOps</option>
                  <option value="pending_user_manager_approval">Pending manager</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              <div className="history-filter-bar__actions">
                {activeFilterCount > 0 ? (
                  <span className="history-filter-card__badge">{activeFilterCount} active</span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                >
                  {showAdvancedFilters ? 'Hide' : 'More'}
                </button>
                <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                  Clear
                </button>
              </div>
            </div>
          </div>

          {showAdvancedFilters ? (
            <div className="history-filter-panel">
              <div className="history-filter-panel__row">
                <div className="history-filter-field">
                  <label className="history-filter-label">View</label>
                  <select
                    value={viewMode}
                    onChange={(e) => { setViewMode(e.target.value as 'mine' | 'team'); setPage(0); }}
                    className="history-filter-select"
                  >
                    <option value="mine">My requests</option>
                    <option value="team">Team requests</option>
                  </select>
                </div>
                <div className="history-filter-field">
                  <label className="history-filter-label">From date</label>
                  <CalendarDateInput value={fromDate} onChange={(value) => { setFromDate(value); setPage(0); }} />
                </div>
                <div className="history-filter-field">
                  <label className="history-filter-label">To date</label>
                  <CalendarDateInput value={toDate} onChange={(value) => { setToDate(value); setPage(0); }} />
                </div>
                <div className="history-filter-field">
                  <label className="history-filter-label">Sort by</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="history-filter-select"
                  >
                    <option value="created_at">Created date</option>
                    <option value="id">Request #</option>
                    <option value="priority">Priority</option>
                    <option value="due_date">Due date</option>
                    <option value="team">Team</option>
                    <option value="cloud">Cloud</option>
                  </select>
                </div>
                <div className="history-filter-field">
                  <label className="history-filter-label">Order</label>
                  <select
                    value={sortDesc ? 'desc' : 'asc'}
                    onChange={(e) => setSortDesc(e.target.value === 'desc')}
                    className="history-filter-select"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
              </div>

              <div className="history-filter-panel__row history-filter-panel__row--saved">
                <div className="history-filter-field history-filter-field--saved-name">
                  <label className="history-filter-label">Save current view</label>
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Saved view name"
                    className="history-filter-input"
                  />
                </div>
                <div className="history-filter-panel__saved-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={savePreset}>
                    Save view
                  </button>
                  {presets.length > 0 && (
                    <select
                      className="history-filter-select"
                      value=""
                      onChange={(e) => {
                        const name = e.target.value;
                        if (name) {
                          const preset = presets.find((p) => p.name === name);
                          if (preset) loadPreset(preset);
                        }
                        e.target.value = '';
                      }}
                    >
                      <option value="">Open saved view…</option>
                      {presets.map((p) => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

          {/* Table */}
          <div className="card history-table-card ig-table-card">
            {!loading && error ? (
              <div className="history-state history-state--error">
                <div className="history-state__icon" aria-hidden>!</div>
                <h3 className="history-state__title">We couldn’t load your requests</h3>
                <p className="history-state__copy">{error}</p>
                <div className="history-state__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => router.replace(router.asPath)}>
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <>
                {viewMode === 'team' && (
                  <p className="ig-table-note">Showing requests from you and your team. The requester is listed under each request.</p>
                )}
                <DataTable<PRRequest>
                  label="My requests"
                  columns={historyColumns}
                  rows={sortedRequests}
                  rowKey={(req) => req.id}
                  loading={loading}
                  skeletonRows={PAGE_SIZE}
                  activeKey={detailRequest?.id ?? null}
                  onRowOpen={(req) => void openDetail(req)}
                  sort={{ key: sortBy, direction: sortDesc ? 'desc' : 'asc' }}
                  onSortChange={handleSortChange}
                  rowVersion={(req) => req.status}
                  empty={
                    <div className="ig-table-empty">
                      <strong>{activeFilterCount > 0 ? 'No requests match these filters' : 'No requests yet'}</strong>
                      <p>
                        {activeFilterCount > 0
                          ? 'Clear a filter or two to see more.'
                          : 'Start a new request, or use Advanced JSON if you already have a prepared payload.'}
                      </p>
                      {activeFilterCount > 0 ? (
                        <button type="button" onClick={clearFilters} className="btn btn-secondary btn-sm">
                          Clear filters
                        </button>
                      ) : (
                        <button type="button" onClick={() => router.push('/create-infrastructure')} className="btn btn-primary btn-sm">
                          New request
                        </button>
                      )}
                    </div>
                  }
                />
              </>
            )}
            {/* Pagination */}
            {!loading && !error && totalCount > 0 && (
              <div className="history-pagination">
                <span className="history-pagination__info">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
                </span>
                <div className="history-pagination__actions">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn btn-secondary"
                  >
                    Previous
                  </button>
                  <span className="history-pagination__page">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="btn btn-secondary"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* View Details Modal */}
          {(detailRequest !== null || detailLoading) && (
            <InspectorDrawer
              open
              onClose={closeDetail}
              resetKey={detailRequest?.id ?? null}
              label="Request details"
              eyebrow={detailRequestIsAccess ? 'Access request' : 'Request'}
              title={
                detailRequest ? (
                  <>
                    <span className="ig-mono">#{detailRequest.id}</span> {detailRequest.service}
                  </>
                ) : (
                  'Loading request…'
                )
              }
              subtitle={detailRequest ? [detailRequest.project_name, detailRequest.team, detailRequest.env].filter(Boolean).join(' · ') : undefined}
              headerActions={
                detailStatusMeta ? <span className={`status-badge ${detailStatusMeta.tone}`}>{detailStatusMeta.label}</span> : null
              }
            >
                {detailLoading ? (
                  <div className="ig-drawer-loading" aria-busy="true">
                    <span className="ig-skeleton ig-skeleton--line" style={{ width: '40%' }} />
                    <span className="ig-skeleton ig-skeleton--line" />
                    <span className="ig-skeleton ig-skeleton--line" style={{ width: '75%' }} />
                    <span className="ig-skeleton ig-skeleton--line" style={{ width: '60%' }} />
                  </div>
                ) : detailRequest ? (
                  <>
                    <div className="portal-detail-grid history-detail-modal__summary-grid">
                      {detailRequest.project_name ? (
                        <article className="portal-detail-card">
                          <span className="history-detail-modal__summary-label">Project</span>
                          <strong className="portal-detail-card__value">
                            {detailRequest.project_name}
                            {detailRequest.project_code ? ` (${detailRequest.project_code})` : ''}
                          </strong>
                          {detailRequest.project_id ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm history-detail-modal__summary-action"
                              onClick={() => router.push(`/my-projects/${detailRequest.project_id}`)}
                            >
                              View project
                            </button>
                          ) : null}
                        </article>
                      ) : null}
                      <article className="portal-detail-card">
                        <span className="history-detail-modal__summary-label">Team</span>
                        <strong className="portal-detail-card__value">{detailRequest.team || '—'}</strong>
                      </article>
                      <article className="portal-detail-card">
                        <span className="history-detail-modal__summary-label">Environment</span>
                        <strong className="portal-detail-card__value">{detailRequest.env || '—'}</strong>
                      </article>
                      <article className="portal-detail-card">
                        <span className="history-detail-modal__summary-label">Cloud</span>
                        <strong className="portal-detail-card__value">{detailRequest.cloud || '—'}</strong>
                      </article>
                      <article className="portal-detail-card">
                        <span className="history-detail-modal__summary-label">{detailRequestIsAccess ? 'Target' : 'Service'}</span>
                        <strong className="portal-detail-card__value">{detailRequest.service || '—'}</strong>
                      </article>
                      {detailServiceBundle.length > 1 ? (
                        <article className="portal-detail-card">
                          <span className="history-detail-modal__summary-label">Bundle</span>
                          <strong className="portal-detail-card__value">{detailServiceBundle.length} services</strong>
                        </article>
                      ) : null}
                      {detailRequest.priority ? (
                        <article className="portal-detail-card">
                          <span className="history-detail-modal__summary-label">Priority</span>
                          <strong className="portal-detail-card__value">{detailRequest.priority}</strong>
                        </article>
                      ) : null}
                      {detailRequest.due_date ? (
                        <article className="portal-detail-card">
                          <span className="history-detail-modal__summary-label">Due date</span>
                          <strong className="portal-detail-card__value">{new Date(detailRequest.due_date).toLocaleDateString()}</strong>
                        </article>
                      ) : null}
                      {detailRequest.application_id ? (
                        <article className="portal-detail-card">
                          <span className="history-detail-modal__summary-label">App ID</span>
                          <strong className="portal-detail-card__value">{detailRequest.application_id}</strong>
                        </article>
                      ) : null}
                      {detailRequest.branch ? (
                        <article className="portal-detail-card">
                          <span className="history-detail-modal__summary-label">Request branch</span>
                          <strong className="portal-detail-card__value">{detailRequest.branch}</strong>
                        </article>
                      ) : null}
                      {detailRequest.file_path ? (
                        <article className="portal-detail-card">
                          <span className="history-detail-modal__summary-label">Config path</span>
                          <strong className="portal-detail-card__value">{detailRequest.file_path}</strong>
                        </article>
                      ) : null}
                    </div>
                    {(detailRequest.branch || detailRequest.file_path) && (
                      <div className="history-detail-modal__notice history-detail-modal__notice--spaced">
                        <strong className="history-detail-modal__notice-title">Current repo layout</strong>
                        <p className="history-detail-modal__notice-copy">
                          Requests now write to <code>project/&lt;project-code&gt;/&lt;team-slug&gt;/&lt;cloud&gt;/envs/&lt;env&gt;/&lt;service&gt;/&lt;request-id&gt;/request.json</code> and use a matching <code>project/&lt;project-code&gt;/&lt;team-slug&gt;/&lt;cloud&gt;/&lt;env&gt;/&lt;service&gt;/&lt;request-id&gt;</code> branch.
                        </p>
                      </div>
                    )}
                    {detailServiceBundle.length > 1 ? (
                      <div className="history-detail-modal__section history-detail-modal__section--muted">
                        <div className="history-detail-modal__section-head">
                          <strong>Service bundle</strong>
                        </div>
                        <p className="history-detail-modal__empty-copy">
                          This request groups multiple services under one shared project and team review flow, while each bundled service can still target its own environment.
                        </p>
                        <div className="history-detail-modal__bundle-groups">
                          {detailServiceBundleGroups.map((group) => (
                            <div key={group.environment} className="history-detail-modal__bundle-group">
                              <div className="history-detail-modal__bundle-group-head">
                                <strong>{group.environment}</strong>
                                <span className="history-detail-modal__bundle-group-count">
                                  {group.entries.length} service{group.entries.length === 1 ? '' : 's'}
                                </span>
                              </div>
                              <div className="portal-detail-grid history-detail-modal__summary-grid">
                                {group.entries.map((entry, index) => (
                                  <article key={`${group.environment}-${entry.cloud}-${entry.service}-${index}`} className="portal-detail-card">
                                    <span className="history-detail-modal__summary-label">Service {index + 1}</span>
                                    <strong className="portal-detail-card__value">
                                      {entry.display_name || entry.service}
                                    </strong>
                                    <p className="history-detail-modal__empty-copy">
                                      {group.environment} · {(entry.cloud || detailRequest.cloud || 'cloud').toUpperCase()}
                                    </p>
                                    <code className="request-builder__bundle-path request-builder__bundle-path--summary">
                                      {buildBundleTargetPath(detailRequest, entry)}
                                    </code>
                                  </article>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {detailRequest.status === 'rejected' && detailRequest.reject_reason && (
                      <div className="history-detail-modal__notice history-detail-modal__notice--error">
                        <strong className="history-detail-modal__notice-title history-detail-modal__notice-title--error">Why it was rejected</strong>
                        <p className="history-detail-modal__notice-copy history-detail-modal__notice-copy--prewrap">{detailRequest.reject_reason}</p>
                      </div>
                    )}
                    {(detailRequest.plan_review || detailRequest.policy_checks || detailRequest.cost_check) && (
                      <div className="history-detail-modal__section history-detail-modal__section--muted">
                        <div className="history-detail-modal__section-head">
                          <strong>Pipeline checks</strong>
                        </div>
                        <PlanReviewCard review={detailRequest.plan_review} env={detailRequest.env} />
                        <PolicyChecksCard summary={detailRequest.policy_checks} />
                        <CostCheckCard check={detailRequest.cost_check} />
                      </div>
                    )}
                    {detailRequest.cost_risk_preview && (
                      <div className="portal-preview-panel history-detail-modal__panel">
                        <div className="history-detail-modal__panel-head">
                          <div>
                            <div className="portal-preview-eyebrow">Estimated Cost</div>
                            <strong className="portal-preview-value history-detail-modal__panel-title">What reviewers may check</strong>
                          </div>
                          <span className={getPreviewRiskClass(detailRequest.cost_risk_preview.risk_level)}>
                            {detailRequest.cost_risk_preview.risk_level} review attention
                          </span>
                        </div>

                        <div className="portal-preview-grid">
                          <div className="portal-preview-card">
                            <span className="portal-preview-eyebrow">Estimated monthly cost</span>
                            <strong className="portal-preview-value">{detailRequest.cost_risk_preview.estimated_monthly}</strong>
                            <p className="portal-preview-copy">
                              {detailRequest.cost_risk_preview.estimated_band} footprint. {detailRequest.cost_risk_preview.estimate_basis}
                            </p>
                          </div>
                          <div className="portal-preview-card">
                            <span className="portal-preview-eyebrow">Review notes</span>
                            <strong className="portal-preview-value">{detailRequest.cost_risk_preview.signals.length} checks</strong>
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
                                <strong className="portal-preview-signal__title">No major review concerns</strong>
                                <span className={getPreviewRiskClass('low')}>low</span>
                              </div>
                              <p className="portal-preview-signal__detail">
                                Nothing major was flagged automatically, but reviewers should still confirm ownership, rollout safety, and expected spend.
                              </p>
                            </article>
                          )}
                        </div>
                      </div>
                    )}
                    {detailRequest.approval_context && (
                      <div className="portal-preview-panel history-detail-modal__panel">
                        <div className="history-detail-modal__panel-head">
                          <div>
                            <div className="portal-preview-eyebrow">Review Steps</div>
                            <strong className="portal-preview-value history-detail-modal__panel-title">How this request is reviewed</strong>
                          </div>
                          <span className={getPreviewRiskClass(detailRequest.approval_context.requires_devops_approval ? 'medium' : 'low')}>
                            {detailRequest.approval_context.current_stage}
                          </span>
                        </div>
                        <div className="portal-preview-grid">
                          <div className="portal-preview-card">
                            <span className="portal-preview-eyebrow">Current step</span>
                            <strong className="portal-preview-value">{detailRequest.approval_context.current_stage}</strong>
                            <p className="portal-preview-copy">
                              {detailRequest.approval_context.next_stage
                                ? `Next step: ${detailRequest.approval_context.next_stage}`
                                : 'No more review steps are waiting right now.'}
                            </p>
                          </div>
                          <div className="portal-preview-card">
                            <span className="portal-preview-eyebrow">Based on</span>
                            <strong className="portal-preview-value">
                              {detailRequest.approval_context.rule_source === 'project_rule' ? 'Project setting' : 'Standard flow'}
                            </strong>
                            <p className="portal-preview-copy">{detailRequest.approval_context.summary}</p>
                          </div>
                        </div>
                        <div className="history-detail-modal__signal-row">
                          <span className={getPreviewSignalClass(detailRequest.approval_context.requires_manager_approval ? 'medium' : 'low')}>
                            {detailRequest.approval_context.requires_manager_approval ? 'Manager review required' : 'No manager review'}
                          </span>
                          <span className={getPreviewSignalClass(detailRequest.approval_context.requires_devops_approval ? 'medium' : 'low')}>
                            {detailRequest.approval_context.requires_devops_approval ? 'Platform review required' : 'No platform review'}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="history-detail-modal__actions">
                      {detailRequest.status === 'draft' && (
                        <>
                          <button type="button" onClick={() => submitDraft(detailRequest.id)} className="btn btn-primary">
                            Send for review
                          </button>
                          <button type="button" onClick={() => deleteDraft(detailRequest.id)} className="btn btn-secondary">
                            Delete draft
                          </button>
                        </>
                      )}
                      {detailRequest.status === 'pending_user_manager_approval' && canApproveByManager && (
                        <button type="button" onClick={() => approveByManager(detailRequest.id)} className="btn btn-primary">
                          Approve and send on
                        </button>
                      )}
                      {detailRequest.status === 'rejected' && (
                        <button type="button" onClick={() => resubmitRequest(detailRequest.id)} className="btn btn-primary">
                          Create a new draft
                        </button>
                      )}
                      {(currentUserId == null || detailRequest.created_by === currentUserId) && (
                        <button type="button" onClick={() => cloneRequest(detailRequest.id)} className="btn btn-secondary" title="Clone as new draft">
                          Copy request
                        </button>
                      )}
                      {(currentUserId == null || detailRequest.created_by === currentUserId) &&
                       ['completed', 'in_progress'].includes(detailRequest.status) && (
                        <button type="button" onClick={() => promoteRequest(detailRequest.id)} className="btn btn-secondary" title="Create new request for next environment (dev→stage→prod)">
                          Create next environment request
                        </button>
                      )}
                      {(currentUserId == null || detailRequest.created_by === currentUserId) &&
                       ['draft', 'in_progress'].includes(detailRequest.status) && (
                        <button type="button" onClick={() => fetchConfigHistory(detailRequest.id)} className="btn btn-secondary" title="Restore config from previous snapshot">
                          Open previous versions
                        </button>
                      )}
                      {CANCELLABLE_STATUSES.includes(detailRequest.status) &&
                       (currentUserId == null || detailRequest.created_by === currentUserId) && (
                        <button type="button" onClick={() => cancelRequest(detailRequest.id)} className="btn btn-secondary">
                          Cancel request
                        </button>
                      )}
                      {detailRequest.pr_url ? (
                        <a href={detailRequest.pr_url} target="_blank" rel="noopener noreferrer" className="history-detail-modal__link">
                          Open pull request →
                        </a>
                      ) : null}
                      <RequestPRImpact apiUrl={apiUrl} token={typeof window === 'undefined' ? null : localStorage.getItem('token')} requestId={detailRequest.id} />
                      <button
                        type="button"
                        onClick={() => applyAsTemplate(detailRequest)}
                        className="btn btn-secondary"
                      >
                        Reuse this request
                      </button>
                      <button
                        type="button"
                        onClick={() => saveConfiguration(detailRequest)}
                        className="btn btn-secondary"
                      >
                        Save as reusable request
                      </button>
                      <div className="history-detail-modal__compare">
                        <input
                          type="number"
                          placeholder="Compare with request #"
                          value={compareWithId}
                          onChange={(e) => setCompareWithId(e.target.value)}
                          className="history-filter-input history-detail-modal__compare-input"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={!compareWithId}
                          onClick={async () => {
                            const token = localStorage.getItem('token');
                            if (!token || !compareWithId) return;
                            const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/diff?compare_with=${compareWithId}`, {
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (res.ok) {
                              const d = await res.json();
                              setDiffResult(d.diff);
                            } else {
                              setDiffResult(null);
                            }
                          }}
                        >
                          Compare
                        </button>
                        {diffResult && (
                          <button type="button" className="btn btn-secondary" onClick={() => setDiffResult(null)}>
                            Clear comparison
                          </button>
                        )}
                      </div>
                    </div>
                    {!detailRequestIsAccess && (
                      <RequestLifecyclePanel
                        apiUrl={apiUrl}
                        requestId={detailRequest.id}
                        status={detailRequest.status}
                        lifetime={lifetime}
                        canManage={currentUserId == null || detailRequest.created_by === currentUserId}
                        onLifetimeChange={setLifetime}
                        onRequestCreated={(id) => {
                          fetchHistory();
                          setDetailRequest(null);
                          openDetail({ id } as PRRequest);
                        }}
                      />
                    )}
                    {showConfigHistory && detailRequest && (
                      <div className="history-detail-modal__section history-detail-modal__section--muted">
                        <div className="history-detail-modal__section-head">
                          <strong>Previous versions</strong>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowConfigHistory(false); setConfigHistory([]); }}>
                            Close
                          </button>
                        </div>
                        {configHistory.length === 0 ? (
                          <p className="history-detail-modal__empty-copy">No earlier versions yet.</p>
                        ) : (
                          <div className="history-detail-modal__history-list">
                            {configHistory.map((h) => (
                              <div key={h.id} className="history-detail-modal__history-card">
                                <div className="history-detail-modal__history-head">
                                  <span className="history-detail-modal__history-meta">
                                    #{h.id} · {h.note || 'saved version'} · {new Date(h.created_at).toLocaleString()}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => rollbackRequest(detailRequest.id, h.id)}
                                  >
                                    Restore this version
                                  </button>
                                </div>
                                <pre className="history-detail-modal__history-code">{String(h.config || '').slice(0, 200)}...</pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {(diffResult?.changes?.length ?? 0) > 0 && (
                      <div className="history-detail-modal__section history-detail-modal__section--muted">
                        <strong>Comparison with request #{compareWithId}</strong>
                        <div className="history-detail-modal__diff-list">
                          {diffResult?.changes?.map((c: any) => (
                            <div key={c.field} className="history-detail-modal__diff-row">
                              <strong>{c.field}:</strong> <span className="history-detail-modal__diff-value history-detail-modal__diff-value--old">− {String(c.base_value || '').slice(0, 80)}</span>
                              <br />
                              <strong>{c.field}:</strong> <span className="history-detail-modal__diff-value history-detail-modal__diff-value--new">+ {String(c.compare_value || '').slice(0, 80)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Tags */}
                    <div className="history-detail-modal__section">
                      <strong>Labels</strong>
                      <div className="history-detail-modal__tags">
                        {tags.map((t) => (
                          <span key={t} className="history-detail-modal__tag">
                            {t}
                            <button
                              type="button"
                              onClick={async () => {
                                const token = localStorage.getItem('token');
                                if (!token) return;
                                const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/tags?tag=${encodeURIComponent(t)}`, {
                                  method: 'DELETE',
                                  headers: { Authorization: `Bearer ${token}` },
                                });
                                if (res.ok) {
                                  setTags((prev) => prev.filter((x) => x !== t));
                                }
                              }}
                              className="history-detail-modal__tag-remove"
                              aria-label={`Remove ${t}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <div className="history-detail-modal__tag-form">
                          <input
                            type="text"
                            placeholder="Add label"
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newTag.trim()) {
                                e.preventDefault();
                                (async () => {
                                  const token = localStorage.getItem('token');
                                  if (!token) return;
                                  const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/tags`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({ tag: newTag.trim() }),
                                  });
                                  if (res.ok) {
                                    const d = await res.json();
                                    setTags(Array.isArray(d?.tags) ? d.tags : []);
                                    setNewTag('');
                                  }
                                })();
                              }
                            }}
                            className="history-detail-modal__tag-input"
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={!newTag.trim()}
                            onClick={async () => {
                              if (!newTag.trim()) return;
                              const token = localStorage.getItem('token');
                              if (!token) return;
                              const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/tags`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ tag: newTag.trim() }),
                              });
                              if (res.ok) {
                                const d = await res.json();
                                setTags(Array.isArray(d?.tags) ? d.tags : []);
                                setNewTag('');
                              }
                            }}
                          >
                            Add label
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Dependencies */}
                    {(dependsOn.length > 0 || blockedBy.length > 0 || (detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId))) && (
                      <div className="history-detail-modal__section history-detail-modal__section--muted">
                        <strong>Linked requests</strong>
                        {dependsOn.length > 0 && (
                          <div className="history-detail-modal__dependency-block">
                            <span className="history-detail-modal__dependency-label">Waiting on</span>
                            <div className="history-detail-modal__dependency-list">
                              {dependsOn.map((id) => {
                              const r = requests.find((x) => x.id === id);
                              const canRemove = detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId);
                              return (
                                <span key={id} className="history-detail-modal__dependency-item">
                                  {r ? (
                                    <button
                                      type="button"
                                      onClick={() => { setDetailRequest(null); openDetail(r); }}
                                      className="history-detail-modal__dependency-chip history-detail-modal__dependency-chip--waiting"
                                    >
                                      #{id}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => { setFilterType('pr_number'); setFilterValue(String(id)); fetchHistory(); }}
                                      className="history-detail-modal__dependency-link"
                                    >
                                      #{id}
                                    </button>
                                  )}
                                  {canRemove && (
                                    <button type="button" onClick={async () => {
                                      const token = localStorage.getItem('token');
                                      if (!token || !detailRequest) return;
                                      const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/dependencies/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                                      if (res.ok) { setDependsOn((p) => p.filter((x) => x !== id)); toast('Dependency removed'); }
                                    }} className="history-detail-modal__dependency-remove" title="Remove">×</button>
                                  )}
                                </span>
                              );
                            })}
                            </div>
                          </div>
                        )}
                        {blockedBy.length > 0 && (
                          <div className="history-detail-modal__dependency-block">
                            <span className="history-detail-modal__dependency-label">Blocking</span>
                            <div className="history-detail-modal__dependency-list">
                              {blockedBy.map((id) => {
                              const r = requests.find((x) => x.id === id);
                              return r ? (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => { setDetailRequest(null); openDetail(r); }}
                                  className="history-detail-modal__dependency-chip history-detail-modal__dependency-chip--blocking"
                                >
                                  #{id}
                                </button>
                              ) : (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => { setFilterType('pr_number'); setFilterValue(String(id)); fetchHistory(); }}
                                  className="history-detail-modal__dependency-link history-detail-modal__dependency-link--blocking"
                                >
                                  #{id}
                                </button>
                              );
                            })}
                            </div>
                          </div>
                        )}
                        {detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId) && (
                          <div className="history-detail-modal__dependency-form">
                            <input type="number" placeholder="Request #" value={newDepId} onChange={(e) => setNewDepId(e.target.value)} className="input history-detail-modal__dependency-input" min={1} />
                            <button type="button" className="btn btn-secondary btn-sm" disabled={addingDep || !newDepId.trim()} onClick={async () => {
                              const depId = parseInt(newDepId.trim(), 10);
                              if (Number.isNaN(depId) || depId <= 0 || !detailRequest) return;
                              setAddingDep(true);
                              try {
                                const token = localStorage.getItem('token');
                                const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/dependencies`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ depends_on_request_id: depId }),
                                });
                                const d = await res.json().catch(() => ({}));
                                if (res.ok) { setDependsOn((p) => [...p, depId]); setNewDepId(''); toast('Dependency added'); }
                                else toast(d.error || 'Failed to add', 'error');
                              } finally { setAddingDep(false); }
                            }}>
                              {addingDep ? '…' : 'Link request'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Audit trail */}
                    <div className="history-detail-modal__section">
                      <strong>Activity</strong>
                      <div className="history-detail-modal__feed">
                        {timelineLoading ? (
                          <p className="history-detail-modal__empty-copy">Loading activity…</p>
                        ) : timeline.length === 0 ? (
                          <p className="history-detail-modal__empty-copy">No updates yet.</p>
                        ) : (
                          timeline.map((e) => (
                            <article key={`${e.kind}-${e.id}`} className="history-detail-modal__feed-item">
                              <div className="history-detail-modal__feed-meta">
                                <strong>{e.username || 'System'}</strong>
                                <span>{new Date(e.created_at).toLocaleString()}</span>
                              </div>
                              <p>
                                <span className="history-detail-modal__feed-action">{formatTimelineAction(e.action)}</span>
                                {e.details ? ` · ${e.details}` : ''}
                              </p>
                              {e.body && <p className="history-detail-modal__feed-body">{e.body}</p>}
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                    {/* Comments */}
                    <div className="history-detail-modal__section">
                      <strong>Conversation</strong>
                      <div className="history-detail-modal__feed history-detail-modal__feed--comments">
                        {comments.length === 0 ? (
                          <p className="history-detail-modal__empty-copy">No comments yet.</p>
                        ) : (
                          comments.map(c => (
                            <article key={c.id} className="history-detail-modal__feed-item">
                              <div className="history-detail-modal__feed-meta">
                                <strong>{c.username || 'User'}</strong>
                                <span>{new Date(c.created_at).toLocaleString()}</span>
                              </div>
                              <p className="history-detail-modal__feed-body">{c.body}</p>
                            </article>
                          ))
                        )}
                      </div>
                      <div className="history-detail-modal__comment-form">
                        <input
                          type="text"
                          placeholder="Write a comment for reviewers or teammates"
                          value={commentBody}
                          onChange={(e) => setCommentBody(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addComment();
                            }
                          }}
                          className="history-detail-modal__comment-input"
                        />
                        <button type="button" onClick={addComment} className="btn btn-primary" disabled={!commentBody.trim() || commentSubmitting}>
                          {commentSubmitting ? '...' : 'Send'}
                        </button>
                      </div>
                    </div>
                    {detailRequest.config && (
                      <div className="history-detail-modal__section">
                        <strong>Request details (JSON)</strong>
                        <p className="history-detail-modal__code-note">
                          Sensitive values are hidden in this view. Raw values are not kept in page state.
                        </p>
                        <pre className="portal-code-block history-detail-modal__code">
                          {detailRequest.config}
                        </pre>
                      </div>
                    )}
                  </>
                ) : null}
            </InspectorDrawer>
          )}
      </div>
    </>
  );
}
