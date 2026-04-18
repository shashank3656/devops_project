import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../components/AdminLayout';
import { getRecentRequestIds, addRecentRequestId } from '../lib/recentRequests';

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

interface PRRequest {
  id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  team: string;
  env: string;
  cloud: string;
  service: string;
  client_name?: string;
  priority?: string;
  due_date?: string | null;
  due_status?: 'overdue' | 'due_soon' | '';
  pr_url: string;
  branch?: string;
  file_path?: string;
  application_id?: string;
  status: string;
  config?: string;
  created_at: string;
  updated_at?: string;
  created_by_username?: string;
  terraform_plan_output?: string;
  jira_ticket_id?: string;
  blocked_by?: number[];
  blocked_by_with_status?: BlockedByItem[];
  cost_risk_preview?: CostRiskPreview | null;
  approval_context?: ApprovalContext | null;
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

function isAccessRequest(req: PRRequest | null | undefined): boolean {
  if (!req?.config) return false;
  try {
    const parsed = JSON.parse(req.config) as { request_type?: unknown };
    return typeof parsed.request_type === 'string' && parsed.request_type.trim().toLowerCase() === 'iam';
  } catch {
    return false;
  }
}

function getRequestServiceBundle(req: Pick<PRRequest, 'config'> | null | undefined): ServiceBundleEntry[] {
  if (!req?.config) return [];
  try {
    const parsed = JSON.parse(req.config) as { config?: { service_bundle?: unknown } };
    const serviceBundle = parsed?.config?.service_bundle;
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

function formatBundleEnvironmentLabel(entry: ServiceBundleEntry, req: PRRequest | null | undefined): string {
  const rawEnv = entry.env || entry.config?.env || req?.env || 'env';
  return rawEnv.trim() ? rawEnv.trim().toUpperCase() : 'ENV';
}

function buildBundleTargetPath(req: PRRequest, entry: ServiceBundleEntry): string {
  const projectKey = normalizeBundlePathSegment(req.project_code || req.project_name, 'project');
  const teamKey = normalizeBundlePathSegment(req.team, 'team');
  const cloudKey = normalizeBundlePathSegment(entry.cloud || req.cloud, 'cloud');
  const envKey = normalizeBundlePathSegment(entry.env || entry.config?.env || req.env, 'env');
  const serviceKey = normalizeBundlePathSegment(
    normalizeBundleServicePathKey(entry.cloud || req.cloud, entry.normalized_service || entry.service),
    'service',
  );
  const applicationKey = normalizeBundlePathSegment(req.application_id, 'application-id');
  return `project/${projectKey}/${teamKey}/${cloudKey}/envs/${envKey}/${serviceKey}/${applicationKey}/request.json`;
}

function groupServiceBundleByEnvironment(serviceBundle: ServiceBundleEntry[], req: PRRequest | null | undefined) {
  const groups = new Map<string, ServiceBundleEntry[]>();
  for (const entry of serviceBundle) {
    const environment = formatBundleEnvironmentLabel(entry, req);
    const existing = groups.get(environment);
    if (existing) existing.push(entry);
    else groups.set(environment, [entry]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([environment, entries]) => ({ environment, entries }));
}

function getRequestBundleCount(req: Pick<PRRequest, 'config'> | null | undefined): number {
  return getRequestServiceBundle(req).length;
}

export default function AdminRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState<PRRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [team, setTeam] = useState('');
  const [projectId, setProjectId] = useState('');
  const [env, setEnv] = useState('');
  const [cloud, setCloud] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [offset, setOffset] = useState(0);
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);
  const [detailRequest, setDetailRequest] = useState<PRRequest | null>(null);
  const [detailComments, setDetailComments] = useState<RequestComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [detailConfigOpen, setDetailConfigOpen] = useState(false);
  const [detailTerraformOpen, setDetailTerraformOpen] = useState(false);
  const [terraformOutputEdit, setTerraformOutputEdit] = useState('');
  const [terraformSaving, setTerraformSaving] = useState(false);
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [rollbackingId, setRollbackingId] = useState<number | null>(null);
  const [configHistory, setConfigHistory] = useState<{ id: number; config: string; created_at: string; note?: string }[]>([]);
  const [showConfigHistory, setShowConfigHistory] = useState(false);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [jiraEdit, setJiraEdit] = useState('');
  const [jiraSaving, setJiraSaving] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [timeline, setTimeline] = useState<{ id: number; kind: string; action: string; username: string; details: string; body?: string; created_at: string }[]>([]);
  const detailRequestIsAccess = isAccessRequest(detailRequest);
  const detailServiceBundle = getRequestServiceBundle(detailRequest);
  const detailServiceBundleGroups = groupServiceBundleByEnvironment(detailServiceBundle, detailRequest);
  const activeFilterCount = [
    team.trim(),
    projectId,
    env.trim(),
    cloud.trim(),
    search.trim(),
    statusFilter,
    priorityFilter,
    sortBy !== 'created_at' ? sortBy : '',
    sortOrder !== 'desc' ? sortOrder : '',
    atRiskOnly ? 'at-risk' : '',
  ].filter(Boolean).length;
  const limit = 20;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  const filtersRef = useRef<{ team: string; projectId: string; env: string; cloud: string; search: string; status: string; priority: string; sortBy: string; sortOrder: string; atRiskOnly: boolean }>({ team: '', projectId: '', env: '', cloud: '', search: '', status: '', priority: '', sortBy: 'created_at', sortOrder: 'desc', atRiskOnly: false });

  useEffect(() => {
    if (!router.isReady) return;
    const rawProjectID = router.query.project_id;
    const nextProjectID = Array.isArray(rawProjectID) ? rawProjectID[0] : rawProjectID;
    if (typeof nextProjectID === 'string') {
      setProjectId(nextProjectID);
      setShowAdvancedFilters(true);
      setOffset(0);
    }
  }, [router.isReady, router.query.project_id]);

  useEffect(() => {
    if (env || cloud || priorityFilter || sortBy !== 'created_at' || sortOrder !== 'desc' || atRiskOnly) {
      setShowAdvancedFilters(true);
    }
  }, [env, cloud, priorityFilter, sortBy, sortOrder, atRiskOnly]);

  const fetchRequests = (overrides?: { team?: string; projectId?: string; env?: string; cloud?: string; search?: string; status?: string; priority?: string; sortBy?: string; sortOrder?: string; atRiskOnly?: boolean; offset?: number }) => {
    const t = overrides?.team !== undefined ? overrides.team : filtersRef.current.team;
    const pid = overrides?.projectId !== undefined ? overrides.projectId : filtersRef.current.projectId;
    const e = overrides?.env !== undefined ? overrides.env : filtersRef.current.env;
    const c = overrides?.cloud !== undefined ? overrides.cloud : filtersRef.current.cloud;
    const q = overrides?.search !== undefined ? overrides.search : filtersRef.current.search;
    const s = overrides?.status !== undefined ? overrides.status : filtersRef.current.status;
    const p = overrides?.priority !== undefined ? overrides.priority : filtersRef.current.priority;
    const sb = overrides?.sortBy !== undefined ? overrides.sortBy : filtersRef.current.sortBy;
    const so = overrides?.sortOrder !== undefined ? overrides.sortOrder : filtersRef.current.sortOrder;
    const ar = overrides?.atRiskOnly !== undefined ? overrides.atRiskOnly : filtersRef.current.atRiskOnly;
    const o = overrides?.offset !== undefined ? overrides.offset : offset;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (t) params.set('team', t);
    if (pid) params.set('project_id', pid);
    if (e) params.set('env', e);
    if (c) params.set('cloud', c);
    if (q) params.set('q', q);
    if (s) params.set('status', s);
    if (p) params.set('priority', p);
    params.set('sort_by', sb);
    params.set('sort_order', so);
    if (ar) params.set('at_risk', 'true');
    params.set('limit', String(limit));
    params.set('offset', String(o));
    fetch(`${apiUrl}/api/admin/requests?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        setRequests(Array.isArray(data.requests) ? data.requests : []);
        if (typeof data.total_count === 'number') setTotal(data.total_count);
        if (data.error) setError(data.error);
      })
      .catch(() => setError('Failed to load requests'))
      .finally(() => setLoading(false));
  };

  // Apply search and at_risk from URL on load
  useEffect(() => {
    if (!router.isReady || !token) return;
    const q = router.query.q;
    const qStr = typeof q === 'string' ? q.trim() : '';
    filtersRef.current.search = qStr;
    setSearch(qStr);
    const atRisk = router.query.at_risk === 'true' || router.query.at_risk === '1';
    filtersRef.current.atRiskOnly = atRisk;
    setAtRiskOnly(atRisk);
  }, [router.isReady, router.query.q, router.query.at_risk]);

  useEffect(() => {
    setRecentIds(getRecentRequestIds());
    if (!token) return;
    fetch(`${apiUrl}/api/admin/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProjects(Array.isArray(data?.projects) ? data.projects : []))
      .catch(() => setProjects([]));
  }, []);
  useEffect(() => {
        if (detailRequest) {
          setRecentIds(getRecentRequestIds());
          setJiraEdit(detailRequest.jira_ticket_id || '');
        }
  }, [detailRequest]);

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchRequests({ offset });
  }, [token, router, offset]);

  useEffect(() => {
    const idParam = router.query.id;
    if (!token || !router.isReady || !idParam) return;
    const numId = typeof idParam === 'string' ? parseInt(idParam, 10) : NaN;
    if (Number.isNaN(numId) || numId <= 0) return;
    fetch(`${apiUrl}/api/admin/requests/${numId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const req = data?.request;
        if (!req) return;
        addRecentRequestId(req.id);
        setDetailRequest(req);
        setDetailComments([]);
        setDetailConfigOpen(false);
        setShowConfigHistory(false);
        setConfigHistory([]);
        setCommentBody('');
        fetch(`${apiUrl}/api/request/${req.id}/comments`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => r.json())
          .then((d) => setDetailComments(Array.isArray(d?.comments) ? d.comments : []))
          .catch(() => {});
        fetch(`${apiUrl}/api/request/${req.id}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => setTimeline(Array.isArray(d?.timeline) ? d.timeline : []))
          .catch(() => setTimeline([]));
        fetch(`${apiUrl}/api/admin/requests/${req.id}`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.request) {
              setDetailRequest((prev) => (prev ? { ...prev, ...d.request } : d.request));
              setTerraformOutputEdit(d.request?.terraform_plan_output || '');
            }
          })
          .catch(() => {});
        router.replace('/requests', undefined, { shallow: true });
      })
      .catch(() => {});
  }, [router.isReady, router.query.id, token]);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const teamVal = (form.elements.namedItem('filter-team') as HTMLInputElement | null)?.value?.trim() ?? '';
    const projectVal = (form.elements.namedItem('filter-project') as HTMLSelectElement | null)?.value ?? '';
    const envVal = (form.elements.namedItem('filter-env') as HTMLInputElement | null)?.value?.trim() ?? '';
    const cloudVal = (form.elements.namedItem('filter-cloud') as HTMLInputElement | null)?.value?.trim() ?? '';
    const searchVal = (form.elements.namedItem('filter-search') as HTMLInputElement | null)?.value?.trim() ?? '';
    const statusVal = (form.elements.namedItem('filter-status') as HTMLSelectElement | null)?.value ?? '';
    const priorityVal = (form.elements.namedItem('filter-priority') as HTMLSelectElement | null)?.value ?? '';
    const sortByVal = (form.elements.namedItem('filter-sort-by') as HTMLSelectElement | null)?.value ?? 'created_at';
    const sortOrderVal = (form.elements.namedItem('filter-sort-order') as HTMLSelectElement | null)?.value ?? 'desc';
    const atRiskVal = (form.elements.namedItem('filter-at-risk') as HTMLInputElement | null)?.checked ?? false;
    filtersRef.current = { team: teamVal, projectId: projectVal, env: envVal, cloud: cloudVal, search: searchVal, status: statusVal, priority: priorityVal, sortBy: sortByVal, sortOrder: sortOrderVal, atRiskOnly: atRiskVal };
    setTeam(teamVal);
    setProjectId(projectVal);
    setEnv(envVal);
    setCloud(cloudVal);
    setSearch(searchVal);
    setStatusFilter(statusVal);
    setPriorityFilter(priorityVal);
    setSortBy(sortByVal);
    setSortOrder(sortOrderVal);
    setAtRiskOnly(atRiskVal);
    setOffset(0);
    const qs = new URLSearchParams();
    if (searchVal) qs.set('q', searchVal);
    router.replace(searchVal ? `/requests?${qs}` : '/requests', undefined, { shallow: true });
    fetchRequests({ team: teamVal, projectId: projectVal, env: envVal, cloud: cloudVal, search: searchVal, status: statusVal, priority: priorityVal, offset: 0 });
  };

  const handleClearFilters = () => {
    filtersRef.current = { team: '', projectId: '', env: '', cloud: '', search: '', status: '', priority: '', sortBy: 'created_at', sortOrder: 'desc', atRiskOnly: false };
    setTeam('');
    setProjectId('');
    setEnv('');
    setCloud('');
    setSearch('');
    setStatusFilter('');
    setPriorityFilter('');
    setSortBy('created_at');
    setSortOrder('desc');
    setAtRiskOnly(false);
    setShowAdvancedFilters(false);
    setOffset(0);
    router.replace('/requests', undefined, { shallow: true });
    fetchRequests({ team: '', projectId: '', env: '', cloud: '', search: '', status: '', priority: '', sortBy: 'created_at', sortOrder: 'desc', atRiskOnly: false, offset: 0 });
  };

  const statusLabel = (s: string) =>
    s === 'draft' ? 'Draft'
      : s === 'pending_approval' ? 'Pending approval'
      : s === 'pending_user_manager_approval' ? 'Pending user manager'
      : s === 'pending_devops_approval' ? 'Pending DevOps approval'
      : s === 'in_progress' ? 'In progress'
      : s === 'completed' ? 'Completed'
      : s === 'rejected' ? 'Rejected' : s;

  const canApproveOrReject = (s: string) =>
    s === 'pending_approval' || s === 'pending_user_manager_approval' || s === 'pending_devops_approval';
  const pendingIds = requests.filter((r) => canApproveOrReject(r.status)).map((r) => r.id);
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAllPending = () => {
    if (selectedIds.size >= pendingIds.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(pendingIds));
  };
  const toggleSelectAll = () => {
    if (selectedIds.size >= requests.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(requests.map((r) => r.id)));
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds).filter((id) => pendingIds.includes(id));
    if (ids.length === 0) return;
    setBulkActioning(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSelectedIds(new Set());
        fetchRequests({ offset });
      } else {
        setError(data.error || 'Bulk approve failed');
      }
    } catch (_) {
      setError('Bulk approve failed');
    } finally {
      setBulkActioning(false);
    }
  };

  const handleBulkReject = async () => {
    const ids = Array.from(selectedIds).filter((id) => pendingIds.includes(id));
    if (ids.length === 0) return;
    const reasonInput = window.prompt(`Reject ${ids.length} request(s)? Add a reason (optional, visible to users):`);
    if (reasonInput === null) return;
    if (!confirm(`Reject ${ids.length} request(s)? This cannot be undone.`)) return;
    setBulkActioning(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/bulk-reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids, reason: reasonInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSelectedIds(new Set());
        fetchRequests({ offset });
      } else {
        setError(data.error || 'Bulk reject failed');
      }
    } catch (_) {
      setError('Bulk reject failed');
    } finally {
      setBulkActioning(false);
    }
  };

  const saveTerraformOutput = async () => {
    if (!detailRequest) return;
    setTerraformSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/${detailRequest.id}/plan-output`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ output: terraformOutputEdit }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDetailRequest((prev) => prev ? { ...prev, terraform_plan_output: terraformOutputEdit } : null);
      } else {
        setError(data.error || 'Failed to save');
      }
    } finally {
      setTerraformSaving(false);
    }
  };

  const openDetail = async (req: PRRequest) => {
    addRecentRequestId(req.id);
    setDetailRequest(req);
    setDetailComments([]);
    setDetailConfigOpen(false);
    setDetailTerraformOpen(false);
    setTimeline([]);
    setTerraformOutputEdit(req.terraform_plan_output || '');
    setCommentBody('');
    fetch(`${apiUrl}/api/request/${req.id}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTimeline(Array.isArray(d?.timeline) ? d.timeline : []))
      .catch(() => setTimeline([]));
    fetch(`${apiUrl}/api/request/${req.id}/comments`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((d) => setDetailComments(Array.isArray(d?.comments) ? d.comments : []))
      .catch(() => {});
    fetch(`${apiUrl}/api/admin/requests/${req.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((d) => {
        if (d?.request) {
          setDetailRequest((prev) => prev ? { ...prev, ...d.request } : d.request);
          setTerraformOutputEdit(d.request?.terraform_plan_output || '');
        }
      })
      .catch(() => {});
  };

  const addComment = async () => {
    if (!detailRequest || !commentBody.trim()) return;
    setCommentSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/request/${detailRequest.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      if (res.ok) {
        setCommentBody('');
        const listRes = await fetch(`${apiUrl}/api/request/${detailRequest.id}/comments`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await listRes.json().catch(() => ({}));
        setDetailComments(Array.isArray(d?.comments) ? d.comments : []);
        fetch(`${apiUrl}/api/request/${detailRequest.id}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((td) => setTimeline(Array.isArray(td?.timeline) ? td.timeline : []));
      }
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleApprove = async (id: number) => {
    const req = detailRequest?.id === id ? detailRequest : requests.find((r) => r.id === id);
    const blocked = req?.blocked_by_with_status || [];
    const blockedIncomplete = blocked.filter((b) => b.status !== 'completed' && b.status !== 'rejected');
    if (blockedIncomplete.length > 0) {
      const ok = window.confirm(
        `This request blocks ${blockedIncomplete.length} other request(s) that are not yet completed/rejected. Proceed with approval?`
      );
      if (!ok) return;
    }
    setActioningId(id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests({ offset });
      } else {
        setError(data.error || 'Failed to approve');
      }
    } catch (_) {
      setError('Failed to approve');
    } finally {
      setActioningId(null);
    }
  };

  const handleSaveJira = async () => {
    if (!detailRequest || jiraSaving) return;
    setJiraSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/${detailRequest.id}/jira`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jira_ticket_id: jiraEdit.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDetailRequest((prev) => (prev ? { ...prev, jira_ticket_id: jiraEdit.trim() } : prev));
      } else {
        setError(data.error || 'Failed to update Jira ticket');
      }
    } catch (_) {
      setError('Failed to update Jira ticket');
    } finally {
      setJiraSaving(false);
    }
  };

  const handleBulkStatus = async () => {
    if (!bulkStatusValue || selectedIds.size === 0) return;
    setBulkActioning(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: Array.from(selectedIds), status: bulkStatusValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests({ offset });
        setSelectedIds(new Set());
        setBulkStatusValue('');
      } else {
        setError(data.error || 'Bulk status update failed');
      }
    } catch (_) {
      setError('Bulk status update failed');
    } finally {
      setBulkActioning(false);
    }
  };

  const handleReject = async (id: number) => {
    const reasonInput = window.prompt('Reject this request? Add a reason (optional, visible to the user):');
    if (reasonInput === null) return; // user cancelled
    setActioningId(id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: reasonInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests({ offset });
        if (detailRequest?.id === id) setDetailRequest(null);
      } else {
        setError(data.error || 'Failed to reject');
      }
    } catch (_) {
      setError('Failed to reject');
    } finally {
      setActioningId(null);
    }
  };

  const handleClone = async (id: number) => {
    setCloningId(id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/clone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests({ offset });
        if (detailRequest?.id === id) setDetailRequest(null);
        const newId = data.id;
        if (newId) window.location.href = `/requests?id=${newId}`;
      } else {
        setError(data.error || 'Failed to clone');
      }
    } catch (_) {
      setError('Failed to clone');
    } finally {
      setCloningId(null);
    }
  };

  const handlePromote = async (id: number) => {
    setPromotingId(id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests({ offset });
        if (detailRequest?.id === id) setDetailRequest(null);
        const newId = data.id;
        if (newId) window.location.href = `/requests?id=${newId}`;
        setError('');
      } else {
        setError(data.error || 'Failed to promote');
      }
    } catch (_) {
      setError('Failed to promote');
    } finally {
      setPromotingId(null);
    }
  };

  const fetchConfigHistory = async (id: number) => {
    try {
      const res = await fetch(`${apiUrl}/api/request/${id}/config-history?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setConfigHistory(Array.isArray(d?.history) ? d.history : []);
        setShowConfigHistory(true);
      }
    } catch (_) {
      setError('Failed to load config history');
    }
  };

  const handleRollback = async (id: number, historyId?: number) => {
    setRollbackingId(id);
    setError('');
    try {
      const body = historyId ? { history_id: historyId } : {};
      const res = await fetch(`${apiUrl}/api/request/${id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowConfigHistory(false);
        setConfigHistory([]);
        const hr = await fetch(`${apiUrl}/api/admin/requests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (hr.ok) {
          const hd = await hr.json();
          if (detailRequest?.id === id && hd.request) setDetailRequest(hd.request);
        }
        fetchRequests({ offset });
      } else {
        setError(data.error || 'Failed to rollback');
      }
    } catch (_) {
      setError('Failed to rollback');
    } finally {
      setRollbackingId(null);
    }
  };

  const handleSetStatus = async (id: number, status: string) => {
    setActioningId(id);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/requests/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchRequests({ offset });
      } else {
        setError(data.error || 'Failed to update status');
      }
    } catch (_) {
      setError('Failed to update status');
    } finally {
      setActioningId(null);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <>
      <Head>
        <title>Requests - SetuOps Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Requests</span>
              <h1 className="portal-page__title">All requests</h1>
              <p className="portal-page__subtitle">
                Search, review, and update requests from one queue.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const params = new URLSearchParams();
                if (team) params.set('team', team);
                if (env) params.set('env', env);
                if (cloud) params.set('cloud', cloud);
                if (search) params.set('q', search);
                if (statusFilter) params.set('status', statusFilter);
                if (priorityFilter) params.set('priority', priorityFilter);
                params.set('sort_by', sortBy);
                params.set('sort_order', sortOrder);
                if (atRiskOnly) params.set('at_risk', 'true');
                params.set('format', 'csv');
                fetch(`${apiUrl}/api/admin/requests?${params}`, { headers: { Authorization: `Bearer ${token}` } })
                  .then((res) => res.text())
                  .then((csv) => {
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `requests-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => setError('Export failed'));
              }}
            >
              Download CSV
            </button>
          </div>

          {recentIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Recent requests:</span>
              {recentIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => openDetail({ id } as PRRequest)}
                  title={`Open ticket #${id}`}
                >
                  #{id}
                </button>
              ))}
            </div>
          )}

          {error && requests.length > 0 && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleFilter} className="admin-request-filter">
            <div className="admin-request-filter__bar">
              <label className="admin-request-filter__pill">
                <span className="admin-request-filter__key">Team</span>
                <input
                  id="filter-team"
                  name="filter-team"
                  type="text"
                  className="admin-request-filter__control"
                  placeholder="Any team"
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                />
              </label>

              <label className="admin-request-filter__pill">
                <span className="admin-request-filter__key">Project</span>
                <select
                  id="filter-project"
                  name="filter-project"
                  className="admin-request-filter__control"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                  ))}
                </select>
              </label>

              <label className="admin-request-filter__pill admin-request-filter__pill--search">
                <span className="admin-request-filter__key">Search</span>
                <input
                  id="filter-search"
                  name="filter-search"
                  type="text"
                  className="admin-request-filter__control"
                  placeholder="Requester, team, cloud, or service"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>

              <label className="admin-request-filter__pill">
                <span className="admin-request-filter__key">Status</span>
                <select
                  id="filter-status"
                  name="filter-status"
                  className="admin-request-filter__control"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="pending_user_manager_approval">Waiting for manager</option>
                  <option value="pending_devops_approval">Waiting for platform team</option>
                  <option value="pending_approval">Waiting for review</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>

              <div className="admin-request-filter__actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                >
                  {showAdvancedFilters ? 'Less' : 'More'}
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleClearFilters}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="admin-request-filter__footer">
              <div className="admin-request-filter__footer-meta">
                {activeFilterCount > 0 ? (
                  <span className="filters-bar__badge">{activeFilterCount} active</span>
                ) : (
                  <span className="admin-request-filter__hint">Start with one filter. Open more only if you need to narrow the queue.</span>
                )}
              </div>
            </div>

            {showAdvancedFilters ? (
              <div className="admin-request-filter__panel">
                <div className="admin-request-filter__panel-grid">
                  <label className="filters-bar__field">
                    <span className="filters-bar__field-label">Environment</span>
                    <input
                      id="filter-env"
                      name="filter-env"
                      type="text"
                      className="input"
                      placeholder="Environment"
                      value={env}
                      onChange={(e) => setEnv(e.target.value)}
                    />
                  </label>
                  <label className="filters-bar__field">
                    <span className="filters-bar__field-label">Cloud</span>
                    <input
                      id="filter-cloud"
                      name="filter-cloud"
                      type="text"
                      className="input"
                      placeholder="Cloud"
                      value={cloud}
                      onChange={(e) => setCloud(e.target.value)}
                    />
                  </label>
                  <label className="filters-bar__field">
                    <span className="filters-bar__field-label">Priority</span>
                    <select
                      id="filter-priority"
                      name="filter-priority"
                      className="input"
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value)}
                    >
                      <option value="">All priorities</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                  <label className="filters-bar__checkbox">
                    <input type="checkbox" id="filter-at-risk" name="filter-at-risk" checked={atRiskOnly} onChange={(e) => setAtRiskOnly(e.target.checked)} />
                    <span>Due soon or overdue only</span>
                  </label>
                </div>

                <div className="admin-request-filter__panel-grid admin-request-filter__panel-grid--short">
                  <label className="filters-bar__field">
                    <span className="filters-bar__field-label">Sort by</span>
                    <select id="filter-sort-by" name="filter-sort-by" className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                      <option value="created_at">Created</option>
                      <option value="updated_at">Updated</option>
                      <option value="priority">Priority</option>
                      <option value="due_date">Due date</option>
                    </select>
                  </label>
                  <label className="filters-bar__field">
                    <span className="filters-bar__field-label">Order</span>
                    <select id="filter-sort-order" name="filter-sort-order" className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                      <option value="desc">Newest first</option>
                      <option value="asc">Oldest first</option>
                    </select>
                  </label>
                </div>
              </div>
            ) : null}
          </form>

          <div className="card">
            {loading ? (
              <div className="admin-queue-state admin-queue-state--loading">
                <div className="admin-queue-state__spinner" />
                <h3 className="admin-queue-state__title">Loading requests</h3>
                <p className="admin-queue-state__copy">We’re pulling the latest request queue for you now.</p>
              </div>
            ) : error && requests.length === 0 ? (
              <div className="admin-queue-state admin-queue-state--error">
                <div className="admin-queue-state__icon" aria-hidden>!</div>
                <h3 className="admin-queue-state__title">We couldn’t load this queue</h3>
                <p className="admin-queue-state__copy">{error}</p>
                <div className="admin-queue-state__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => fetchRequests({ offset })}>
                    Try again
                  </button>
                </div>
              </div>
            ) : requests.length === 0 ? (
              <div className="admin-queue-state admin-queue-state--empty">
                <div className="admin-queue-state__icon" aria-hidden>⋯</div>
                <h3 className="admin-queue-state__title">No requests match these filters</h3>
                <p className="admin-queue-state__copy">
                  Try clearing one or two filters to bring the queue back into view.
                </p>
                <div className="admin-queue-state__actions">
                  <button type="button" className="btn btn-secondary" onClick={handleClearFilters}>
                    Clear filters
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="admin-requests-bulk-bar">
                  {pendingIds.length > 0 && (
                    <>
                    <label className="admin-requests-bulk-bar__toggle">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === pendingIds.length && pendingIds.length > 0}
                        onChange={toggleSelectAllPending}
                      />
                      Select all pending ({pendingIds.length})
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={selectedIds.size === 0 || bulkActioning}
                      onClick={handleBulkApprove}
                    >
                      {bulkActioning ? '…' : `Approve selected (${selectedIds.size})`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={selectedIds.size === 0 || bulkActioning}
                      onClick={handleBulkReject}
                    >
                      Reject selected
                    </button>
                    </>
                  )}
                  <label className="admin-requests-bulk-bar__toggle">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === requests.length && requests.length > 0}
                      onChange={toggleSelectAll}
                    />
                    Select all ({requests.length})
                  </label>
                  <span className="admin-requests-bulk-bar__status">
                    <select
                      value={bulkStatusValue}
                      onChange={(e) => setBulkStatusValue(e.target.value)}
                      className="input"
                    >
                      <option value="">Bulk status…</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={selectedIds.size === 0 || !bulkStatusValue || bulkActioning}
                      onClick={handleBulkStatus}
                    >
                      Apply
                    </button>
                  </span>
                </div>
                <div className="table-wrap">
                  <table className="admin-requests-table">
                    <thead>
                      <tr>
                        <th className="admin-requests-table__select-col" title="Select">☐</th>
                        <th>Request #</th>
                        <th>Project</th>
                        <th>Team</th>
                        <th>Env</th>
                        <th>Cloud</th>
                        <th>Service</th>
                        <th>Priority</th>
                        <th>Due</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th className="admin-requests-table__actions-col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((req) => {
                        const bundleCount = getRequestBundleCount(req);
                        return (
                        <tr key={req.id} className="admin-requests-table__row" style={{ cursor: 'pointer' }} onClick={() => openDetail(req)}>
                          <td className="admin-requests-table__checkbox-cell" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(req.id)}
                              onChange={() => toggleSelect(req.id)}
                            />
                          </td>
                          <td><span className="admin-requests-table__request-id">#{req.id}</span></td>
                          <td>
                            {req.project_name ? (
                              <div className="admin-requests-table__primary">
                                <strong>{req.project_name}</strong>
                                {req.project_code ? <span className="admin-requests-table__meta">{req.project_code}</span> : null}
                              </div>
                            ) : '—'}
                          </td>
                          <td>{req.team}</td>
                          <td><span className="admin-requests-table__pill admin-requests-table__pill--env">{req.env}</span></td>
                          <td><span className={`admin-requests-table__pill admin-requests-table__pill--cloud admin-requests-table__pill--cloud-${(req.cloud || '').toLowerCase()}`}>{req.cloud}</span></td>
                          <td>
                            <div className="admin-requests-table__primary">
                              <strong>{req.service}</strong>
                            {bundleCount > 1 ? (
                              <span className="admin-requests-table__bundle-badge">{bundleCount} services</span>
                            ) : null}
                            {isAccessRequest(req) ? (
                              <span className="admin-requests-table__meta">Access request</span>
                            ) : null}
                            </div>
                          </td>
                          <td><span className={`admin-requests-table__pill admin-requests-table__pill--priority admin-requests-table__pill--priority-${(req.priority || 'medium').toLowerCase()}`}>{req.priority || '—'}</span></td>
                          <td>
                            <div className="admin-requests-table__due">
                              <span className="admin-requests-table__meta">{req.due_date ? new Date(req.due_date).toLocaleDateString() : '—'}</span>
                            {req.due_status === 'overdue' && (
                              <span className="admin-requests-table__due-badge admin-requests-table__due-badge--overdue">Overdue</span>
                            )}
                            {req.due_status === 'due_soon' && (
                              <span className="admin-requests-table__due-badge admin-requests-table__due-badge--soon">Due in 24h</span>
                            )}
                            </div>
                          </td>
                          <td>
                            <span className="status-badge" data-status={req.status}>
                              {statusLabel(req.status)}
                            </span>
                          </td>
                          <td>
                            <span className="admin-requests-table__meta">{new Date(req.created_at).toLocaleString()}</span>
                          </td>
                          <td className="admin-requests-table__actions-cell" onClick={(e) => e.stopPropagation()}>
                            <div className="admin-requests-table__actions">
                              {req.status === 'pending_approval' && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    disabled={actioningId !== null}
                                    onClick={() => handleApprove(req.id)}
                                  >
                                    {actioningId === req.id ? '…' : 'Approve'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    disabled={actioningId !== null}
                                    onClick={() => handleReject(req.id)}
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                              {req.status === 'in_progress' && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={actioningId !== null}
                                  onClick={() => handleSetStatus(req.id, 'completed')}
                                >
                                  {actioningId === req.id ? '…' : 'Mark completed'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={actioningId !== null || cloningId !== null}
                                onClick={(e) => { e.stopPropagation(); handleClone(req.id); }}
                                title="Clone as new draft"
                              >
                                {cloningId === req.id ? '…' : 'Clone'}
                              </button>
                              {['completed', 'in_progress'].includes(req.status) && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={promotingId !== null}
                                  onClick={(e) => { e.stopPropagation(); handlePromote(req.id); }}
                                  title="Promote to next environment"
                                >
                                  {promotingId === req.id ? '…' : 'Promote'}
                                </button>
                              )}
                              {req.pr_url ? (
                                <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                  Open PR
                                </a>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
                <div className="admin-requests-pagination">
                  <span className="admin-requests-pagination__info">
                    Page {currentPage} of {totalPages} ({total} total)
                  </span>
                  <div className="admin-requests-pagination__actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={offset === 0}
                      onClick={() => setOffset((o) => Math.max(0, o - limit))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={offset + limit >= total}
                      onClick={() => setOffset((o) => o + limit)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {detailRequest && (
            <div
              role="dialog"
              aria-modal="true"
              className="modal-overlay admin-request-detail-modal"
              onClick={() => setDetailRequest(null)}
            >
              <div
                className="modal admin-request-detail-modal__dialog"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="admin-request-detail-modal__header">
                  <div className="admin-request-detail-modal__title-wrap">
                    <span className="admin-request-detail-modal__eyebrow">
                      {detailRequestIsAccess ? 'Access request' : 'Request'}
                    </span>
                    <h3 className="admin-request-detail-modal__title">
                      {detailRequestIsAccess ? `Access request #${detailRequest.id}` : `Request #${detailRequest.id}`}
                    </h3>
                    <p className="admin-request-detail-modal__subtitle">
                      Review request context, repo placement, approval signals, and the latest discussion without leaving the queue.
                    </p>
                  </div>
                  <div className="admin-request-detail-modal__header-actions">
                    <span className="status-badge" data-status={detailRequest.status}>
                      {statusLabel(detailRequest.status)}
                    </span>
                    <button type="button" className="btn btn-secondary" onClick={() => setDetailRequest(null)}>
                      Close
                    </button>
                  </div>
                </div>

                <div className="portal-detail-grid admin-request-detail-modal__summary-grid">
                  {detailRequest.project_name ? (
                    <article className="portal-detail-card">
                      <span className="admin-request-detail-modal__summary-label">Project</span>
                      <strong className="portal-detail-card__value">
                        {detailRequest.project_name}
                        {detailRequest.project_code ? ` (${detailRequest.project_code})` : ''}
                      </strong>
                      {detailRequest.project_id ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm admin-request-detail-modal__summary-action"
                          onClick={() => router.push(`/projects/${detailRequest.project_id}`)}
                        >
                          Open project
                        </button>
                      ) : null}
                    </article>
                  ) : null}
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Team</span>
                    <strong className="portal-detail-card__value">{detailRequest.team || '—'}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Environment</span>
                    <strong className="portal-detail-card__value">{detailRequest.env || '—'}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Cloud</span>
                    <strong className="portal-detail-card__value">{detailRequest.cloud || '—'}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">{detailRequestIsAccess ? 'Target' : 'Service'}</span>
                    <strong className="portal-detail-card__value">{detailRequest.service || '—'}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Requester</span>
                    <strong className="portal-detail-card__value">{detailRequest.created_by_username || 'Not available'}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Priority</span>
                    <strong className="portal-detail-card__value">{detailRequest.priority || 'Not set'}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Due date</span>
                    <strong className="portal-detail-card__value">
                      {detailRequest.due_date ? new Date(detailRequest.due_date).toLocaleDateString() : 'Not set'}
                    </strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Created</span>
                    <strong className="portal-detail-card__value">{new Date(detailRequest.created_at).toLocaleString()}</strong>
                  </article>
                  <article className="portal-detail-card">
                    <span className="admin-request-detail-modal__summary-label">Updated</span>
                    <strong className="portal-detail-card__value">
                      {detailRequest.updated_at ? new Date(detailRequest.updated_at).toLocaleString() : 'Not updated yet'}
                    </strong>
                  </article>
                  {detailRequest.branch ? (
                    <article className="portal-detail-card">
                      <span className="admin-request-detail-modal__summary-label">Request branch</span>
                      <strong className="portal-detail-card__value">{detailRequest.branch}</strong>
                    </article>
                  ) : null}
                  {detailRequest.file_path ? (
                    <article className="portal-detail-card">
                      <span className="admin-request-detail-modal__summary-label">Config path</span>
                      <strong className="portal-detail-card__value">{detailRequest.file_path}</strong>
                    </article>
                  ) : null}
                </div>

                {(detailRequest.branch || detailRequest.file_path) && (
                  <div className="admin-request-detail-modal__notice">
                    <strong className="admin-request-detail-modal__notice-title">Current repo layout</strong>
                    <p className="admin-request-detail-modal__notice-copy">
                      Requests now write to <code>project/&lt;project-code&gt;/&lt;team-slug&gt;/&lt;cloud&gt;/envs/&lt;env&gt;/&lt;service&gt;/request.json</code> and use a matching <code>project/&lt;project-code&gt;/&lt;team-slug&gt;/&lt;cloud&gt;/&lt;env&gt;/&lt;service&gt;/&lt;request-id&gt;</code> branch.
                    </p>
                  </div>
                )}

                <div className="admin-request-detail-modal__actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={cloningId !== null}
                    onClick={() => handleClone(detailRequest.id)}
                    title="Clone as new draft"
                  >
                    {cloningId === detailRequest.id ? '…' : 'Clone request'}
                  </button>
                  {['completed', 'in_progress'].includes(detailRequest.status) && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={promotingId !== null}
                      onClick={() => handlePromote(detailRequest.id)}
                      title="Create new request for next environment (dev→stage→prod)"
                    >
                      {promotingId === detailRequest.id ? '…' : 'Promote to next env'}
                    </button>
                  )}
                  {['draft', 'in_progress'].includes(detailRequest.status) && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={rollbackingId !== null}
                      onClick={() => fetchConfigHistory(detailRequest.id)}
                      title="Restore config from previous snapshot"
                    >
                      Rollback
                    </button>
                  )}
                  {detailRequest.pr_url && (
                    <a href={detailRequest.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                      Open PR
                    </a>
                  )}
                </div>

                <div className="admin-request-detail-modal__jira">
                  <span className="admin-request-detail-modal__summary-label">Jira ticket</span>
                  <div className="admin-request-detail-modal__jira-row">
                    <input
                      type="text"
                      value={jiraEdit}
                      onChange={(e) => setJiraEdit(e.target.value)}
                      placeholder="e.g. PROJ-123"
                      className="admin-request-detail-modal__jira-input"
                    />
                    <button type="button" className="btn btn-secondary" disabled={jiraSaving} onClick={handleSaveJira}>
                      {jiraSaving ? '…' : 'Save'}
                    </button>
                  </div>
                </div>

                {detailRequest.blocked_by_with_status && detailRequest.blocked_by_with_status.length > 0 && (
                  <div className="admin-request-detail-modal__notice admin-request-detail-modal__notice--warning">
                    <strong className="admin-request-detail-modal__notice-title">Downstream dependencies</strong>
                    <p className="admin-request-detail-modal__notice-copy">
                      Request(s) #{detailRequest.blocked_by_with_status.map((b) => b.id).join(', #')} are waiting on this one.
                    </p>
                  </div>
                )}

                {detailRequest.cost_risk_preview && (
                  <div className="portal-preview-panel admin-request-detail-modal__panel">
                    <div className="admin-request-detail-modal__panel-head">
                      <div>
                        <div className="portal-preview-eyebrow">Cost And Risk</div>
                        <strong className="portal-preview-value admin-request-detail-modal__panel-title">Approval preview</strong>
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
                            The request did not trigger major risk heuristics, but approval should still validate ownership, rollout safety, and expected spend.
                          </p>
                        </article>
                      )}
                    </div>
                  </div>
                )}
                {detailRequest.approval_context && (
                  <div className="portal-preview-panel admin-request-detail-modal__panel">
                    <div className="admin-request-detail-modal__panel-head">
                      <div>
                        <div className="portal-preview-eyebrow">Approval Flow</div>
                        <strong className="portal-preview-value admin-request-detail-modal__panel-title">Rule explanation</strong>
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
                    <div className="admin-request-detail-modal__signal-row">
                      <span className={getPreviewSignalClass(detailRequest.approval_context.requires_manager_approval ? 'medium' : 'low')}>
                        {detailRequest.approval_context.requires_manager_approval ? 'Manager gate enabled' : 'No manager gate'}
                      </span>
                      <span className={getPreviewSignalClass(detailRequest.approval_context.requires_devops_approval ? 'medium' : 'low')}>
                        {detailRequest.approval_context.requires_devops_approval ? 'DevOps gate enabled' : 'No DevOps gate'}
                      </span>
                    </div>
                  </div>
                )}

                {canApproveOrReject(detailRequest.status) && (
                  <div className="admin-request-detail-modal__decision-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={actioningId !== null}
                      onClick={() => handleApprove(detailRequest.id)}
                    >
                      {actioningId === detailRequest.id ? '…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={actioningId !== null}
                      onClick={() => handleReject(detailRequest.id)}
                    >
                      Reject
                    </button>
                  </div>
                )}

                {detailServiceBundle.length > 1 && (
                  <div className="admin-request-detail-modal__section admin-request-detail-modal__section--muted">
                    <div className="admin-request-detail-modal__section-head">
                      <strong>Service bundle</strong>
                    </div>
                    <p className="admin-request-detail-modal__empty-copy">
                      This request includes multiple services under one shared review flow. Each bundled service can still land in its own environment-specific target file.
                    </p>
                    <div className="admin-request-detail-modal__bundle-groups">
                      {detailServiceBundleGroups.map((group) => (
                        <div key={group.environment} className="admin-request-detail-modal__bundle-group">
                          <div className="admin-request-detail-modal__bundle-group-head">
                            <strong>{group.environment}</strong>
                            <span className="admin-request-detail-modal__bundle-group-count">
                              {group.entries.length} service{group.entries.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div className="portal-detail-grid admin-request-detail-modal__summary-grid">
                            {group.entries.map((entry, index) => (
                              <article key={`${group.environment}-${entry.cloud}-${entry.service}-${index}`} className="portal-detail-card">
                                <span className="admin-request-detail-modal__summary-label">Service {index + 1}</span>
                                <strong className="portal-detail-card__value">{entry.display_name || entry.service}</strong>
                                <p className="admin-request-detail-modal__empty-copy">
                                  {group.environment} · {(entry.cloud || detailRequest.cloud || 'cloud').toUpperCase()}
                                </p>
                                <code className="admin-request-detail-modal__bundle-path">
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

                {detailRequest.config && (
                  <div className="admin-request-detail-modal__section">
                    <button
                      type="button"
                      onClick={() => setDetailConfigOpen((o) => !o)}
                      className="admin-request-detail-modal__toggle"
                    >
                      {detailConfigOpen ? '▼' : '▶'} {detailRequestIsAccess ? 'Access request details' : 'Request details'} (JSON, secrets masked)
                    </button>
                    {detailConfigOpen && (
                      <pre className="portal-code-block admin-request-detail-modal__code">
                        {detailRequest.config}
                      </pre>
                    )}
                  </div>
                )}

                {showConfigHistory && detailRequest && (
                  <div className="admin-request-detail-modal__section admin-request-detail-modal__section--muted">
                    <div className="admin-request-detail-modal__section-head">
                      <strong>Config history (rollback)</strong>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowConfigHistory(false); setConfigHistory([]); }}>
                        Close
                      </button>
                    </div>
                    {configHistory.length === 0 ? (
                      <p className="admin-request-detail-modal__empty-copy">No config snapshots yet.</p>
                    ) : (
                      <div className="admin-request-detail-modal__history-list">
                        {configHistory.map((h) => (
                          <div key={h.id} className="admin-request-detail-modal__history-card">
                            <div className="admin-request-detail-modal__history-head">
                              <span className="admin-request-detail-modal__history-meta">
                                #{h.id} · {h.note || 'snapshot'} · {new Date(h.created_at).toLocaleString()}
                              </span>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={rollbackingId !== null}
                                onClick={() => handleRollback(detailRequest.id, h.id)}
                              >
                                Restore
                              </button>
                            </div>
                            <pre className="admin-request-detail-modal__history-code">{String(h.config || '').slice(0, 200)}...</pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="admin-request-detail-modal__section">
                  <button
                    type="button"
                    onClick={() => setDetailTerraformOpen((o) => !o)}
                    className="admin-request-detail-modal__toggle"
                  >
                    {detailTerraformOpen ? '▼' : '▶'} Terraform plan / output
                  </button>
                  {detailTerraformOpen && (
                    <div className="admin-request-detail-modal__terraform">
                      {detailRequest.terraform_plan_output ? (
                        <>
                          <pre className="portal-code-block admin-request-detail-modal__code admin-request-detail-modal__code--short">
                            {detailRequest.terraform_plan_output}
                          </pre>
                          <textarea
                            value={terraformOutputEdit}
                            onChange={(e) => setTerraformOutputEdit(e.target.value)}
                            placeholder="Paste Terraform plan or apply output from CI..."
                            className="admin-request-detail-modal__textarea"
                          />
                          <button type="button" className="btn btn-primary" disabled={terraformSaving} onClick={saveTerraformOutput}>
                            {terraformSaving ? 'Saving…' : 'Update output'}
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="admin-request-detail-modal__empty-copy">No Terraform output yet. Paste from CI or a manual run.</p>
                          <textarea
                            value={terraformOutputEdit}
                            onChange={(e) => setTerraformOutputEdit(e.target.value)}
                            placeholder="Paste Terraform plan or apply output..."
                            className="admin-request-detail-modal__textarea"
                          />
                          <button type="button" className="btn btn-primary" disabled={terraformSaving || !terraformOutputEdit.trim()} onClick={saveTerraformOutput}>
                            {terraformSaving ? 'Saving…' : 'Save output'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="admin-request-detail-modal__section">
                  <strong>Audit trail</strong>
                  <div className="admin-request-detail-modal__feed">
                    {timeline.length === 0 ? (
                      <p className="admin-request-detail-modal__empty-copy">No activity yet.</p>
                    ) : (
                      timeline.map((e) => (
                        <div key={`${e.kind}-${e.id}`} className="admin-request-detail-modal__feed-item">
                          <div className="admin-request-detail-modal__feed-meta">
                            <strong>{e.username || 'System'}</strong>
                            <span>{new Date(e.created_at).toLocaleString()}</span>
                          </div>
                          <p>
                            <span className="admin-request-detail-modal__feed-action">
                              {({ request_create: 'created', request_submit: 'submitted', request_approve: 'approved', request_reject: 'rejected', request_comment: 'commented', request_clone: 'cloned', request_resubmit: 'resubmitted', request_cancel: 'cancelled', request_promote: 'promoted', request_plan_output: 'updated plan', request_reassign: 'reassigned', request_approved_by_manager: 'approved (manager)' } as Record<string, string>)[e.action] || e.action.replace(/_/g, ' ')}
                            </span>
                            {e.details ? ` · ${e.details}` : ''}
                          </p>
                          {e.body && <p className="admin-request-detail-modal__feed-body">{e.body}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="admin-request-detail-modal__section">
                  <strong>Comments</strong>
                  <div className="admin-request-detail-modal__feed">
                    {detailComments.length === 0 ? (
                      <p className="admin-request-detail-modal__empty-copy">No comments yet.</p>
                    ) : (
                      detailComments.map((c) => (
                        <div key={c.id} className="admin-request-detail-modal__feed-item">
                          <div className="admin-request-detail-modal__feed-meta">
                            <strong>{c.username || 'User'}</strong>
                            <span>{new Date(c.created_at).toLocaleString()}</span>
                          </div>
                          <p className="admin-request-detail-modal__feed-body">{c.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="admin-request-detail-modal__comment-form">
                    <input
                      type="text"
                      placeholder="Add a comment..."
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addComment();
                        }
                      }}
                      className="admin-request-detail-modal__comment-input"
                    />
                    <button type="button" className="btn btn-primary" disabled={!commentBody.trim() || commentSubmitting} onClick={addComment}>
                      {commentSubmitting ? '…' : 'Post'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
