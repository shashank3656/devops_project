import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';

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
  const [newDepId, setNewDepId] = useState('');
  const [addingDep, setAddingDep] = useState(false);
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const detailRequestIsAccess = isAccessRequest(detailRequest);
  const detailStatusMeta = detailRequest ? getRequestStatusMeta(detailRequest.status) : null;
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    if (!router.isReady) return;
    const rawProjectID = router.query.project_id;
    const nextProjectID = Array.isArray(rawProjectID) ? rawProjectID[0] : rawProjectID;
    if (typeof nextProjectID === 'string') {
      setProjectId(nextProjectID);
      setPage(0);
    }
  }, [router.isReady, router.query.project_id]);

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
  }, [filterType, filterValue, projectId, page, viewMode, statusFilter, fromDate, toDate]);

  useEffect(() => {
    setSelectedRowIndex(0);
  }, [requests.length, page]);

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
      const requests = Array.isArray(data?.requests) ? data.requests : [];
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

  const openDetail = async (req: PRRequest) => {
    setDetailRequest(null);
    setCanApproveByManager(false);
    setComments([]);
    setTags([]);
    setDependsOn([]);
    setBlockedBy([]);
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
      if (detailRes.ok) {
        const data = await detailRes.json();
        const full = data.request || req;
        addRecentRequestId(full.id);
        setCanApproveByManager(Boolean(data.can_approve_by_manager));
        setDependsOn(Array.isArray(data.depends_on) ? data.depends_on : []);
        setBlockedBy(Array.isArray(data.blocked_by) ? data.blocked_by : []);
        if (full.config) {
          rawConfigByRequestId.current[full.id] = full.config;
          setDetailRequest({ ...full, config: maskSensitiveJson(full.config) });
        } else {
          setDetailRequest(full);
        }
      } else {
        addRecentRequestId(req.id);
        setDetailRequest(req);
      }
      if (commentsRes.ok) {
        const cData = await commentsRes.json();
        setComments(Array.isArray(cData?.comments) ? cData.comments : []);
      }
      const timelineRes = await fetch(`${apiUrl}/api/request/${req.id}/timeline`, { headers });
      if (timelineRes.ok) {
        const tData = await timelineRes.json();
        setTimeline(Array.isArray(tData?.timeline) ? tData.timeline : []);
      }
      if (tagsRes.ok) {
        const tData = await tagsRes.json();
        setTags(Array.isArray(tData?.tags) ? tData.tags : []);
      }
    } catch (_) {
      addRecentRequestId(req.id);
      setDetailRequest(req);
    } finally {
      setDetailLoading(false);
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

  // j/k keyboard shortcuts for list navigation (j=down, k=up, Enter=open)
  const sortedRequestsRef = useRef<PRRequest[]>([]);
  const selectedRowIndexRef = useRef(0);
  sortedRequestsRef.current = sortedRequests;
  selectedRowIndexRef.current = selectedRowIndex;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
      const list = sortedRequestsRef.current;
      const idx = selectedRowIndexRef.current;
      if (list.length === 0) return;
      if (e.key === 'j' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setSelectedRowIndex((i) => Math.min(i + 1, list.length - 1));
      } else if (e.key === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setSelectedRowIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && idx >= 0 && idx < list.length) {
        e.preventDefault();
        openDetail(list[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

        <div className="card history-filter-card">
          <div className="history-filter-card__header">
            <div>
              <h3 className="history-filter-card__title">Filter requests</h3>
              <p className="history-filter-card__summary">
                Use search, project, or status first. Open extra filters only when you need a narrower list.
              </p>
            </div>
            <div className="history-filter-card__header-actions">
              {activeFilterCount > 0 ? (
                <span className="history-filter-card__badge">{activeFilterCount} active</span>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAdvancedFilters((current) => !current)}
              >
                {showAdvancedFilters ? 'Hide extra filters' : 'More filters'}
              </button>
            </div>
          </div>

          <div className="history-filter-card__quick">
            <div className="history-filter-field">
              <label htmlFor="filter-type" className="history-filter-label">Search by</label>
              <select
                id="filter-type"
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value as 'team' | 'pr_number' | 'env' | 'cloud' | 'search' | 'application_id');
                  setFilterValue('');
                }}
                className="history-filter-select"
              >
                <option value="team">Team</option>
                <option value="pr_number">Request number</option>
                <option value="application_id">Application ID</option>
                <option value="env">Environment</option>
                <option value="cloud">Cloud</option>
                <option value="search">Search everything</option>
              </select>
            </div>

            <div className="history-filter-field history-filter-field--grow">
              <label htmlFor="filter-value" className="history-filter-label">
                {filterType === 'pr_number' ? 'Request number'
                  : filterType === 'search' ? 'Search term'
                  : filterType === 'team' ? 'Team name'
                  : filterType === 'application_id' ? 'Application ID'
                  : filterType === 'env' ? 'Environment'
                  : 'Cloud provider'}
              </label>
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
                className="history-filter-input"
              />
            </div>

            <div className="history-filter-field">
              <label className="history-filter-label">Project</label>
              <select
                value={projectId}
                onChange={(e) => { setProjectId(e.target.value); setPage(0); }}
                className="history-filter-select"
              >
                <option value="">All assigned projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                ))}
              </select>
            </div>

            <div className="history-filter-field">
              <label className="history-filter-label">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                className="history-filter-select"
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">Pending approval</option>
                <option value="pending_devops_approval">Pending DevOps</option>
                <option value="pending_user_manager_approval">Pending manager</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

          </div>

          <div className="history-filter-card__actions">
            <span className="history-filter-card__hint">Results update automatically as you change filters.</span>
            <div className="history-filter-card__action-buttons">
              <button onClick={clearFilters} className="btn btn-secondary">
                Clear filters
              </button>
            </div>
          </div>

          {showAdvancedFilters ? (
            <div className="history-filter-card__advanced">
              <div className="history-filter-card__advanced-row">
                <div className="history-filter-field">
                  <label className="history-filter-label">From date</label>
                  <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} className="history-filter-input" />
                </div>
                <div className="history-filter-field">
                  <label className="history-filter-label">To date</label>
                  <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} className="history-filter-input" />
                </div>
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
                <div className="history-filter-field history-filter-field--sort">
                  <label className="history-filter-label">Sort by</label>
                  <div className="history-filter-sort">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                      className="history-filter-select"
                    >
                      <option value="created_at">Created (newest)</option>
                      <option value="id">Request #</option>
                      <option value="priority">Priority</option>
                      <option value="due_date">Due date</option>
                      <option value="team">Team</option>
                      <option value="cloud">Cloud</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSortDesc((d) => !d)}
                      className="btn btn-secondary btn-sm"
                      title={sortDesc ? 'Descending' : 'Ascending'}
                    >
                      {sortDesc ? '↓' : '↑'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="history-filter-card__advanced-row history-filter-card__advanced-row--saved">
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
                <div className="history-filter-card__saved-actions">
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
          <div className="card history-table-card">
            {loading ? (
              <div className="history-loading">
                <div className="history-loading-spinner" />
                <p style={{ color: 'var(--text-secondary)' }}>Loading requests...</p>
              </div>
            ) : error ? (
              <div className="error" style={{ margin: '24px', padding: '16px', borderRadius: '8px' }}>
                <strong>Error:</strong> {error}
              </div>
            ) : requests.length === 0 ? (
              <div className="history-empty">
                <div className="history-empty__icon">📋</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
                  {filterValue ? 'No requests match this search.' : 'No requests yet.'}
                </p>
                {!filterValue && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    Start a new request, or use Advanced JSON if you already have a prepared payload.
                  </p>
                )}
                {filterValue ? (
                  <button
                    onClick={() => { setFilterValue(''); setProjectId(''); setPage(0); }}
                    className="btn btn-secondary"
                    style={{ marginTop: '1rem' }}
                  >
                    Clear filters
                  </button>
                ) : (
                  <div className="history-empty__actions">
                    <button onClick={() => router.push('/select-service')} className="btn btn-primary">
                      New request
                    </button>
                    <button onClick={() => router.push('/custom-json')} className="btn btn-secondary">
                      Advanced JSON
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                {viewMode === 'team' && (
                  <p style={{ padding: '12px 16px 0', margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                    Showing requests from you and your team. Use <strong>Raised by</strong> to see who submitted each one.
                  </p>
                )}
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Request #</th>
                      <th>Project</th>
                      <th>Team</th>
                      {viewMode === 'team' && <th>Raised by</th>}
                      <th>Environment</th>
                      <th>Cloud</th>
                      <th>Service</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Pull request</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRequests.map((req, idx) => (
                      <tr
                        key={req.id}
                        onClick={() => { setSelectedRowIndex(idx); openDetail(req); }}
                        style={{ background: idx === selectedRowIndex ? 'var(--primary-tint)' : undefined, cursor: 'pointer' }}
                      >
                        <td style={{ padding: '16px', fontWeight: '600', color: 'var(--primary-color)' }}>
                          #{req.id}
                        </td>
                        <td style={{ padding: '16px' }}>
                          {req.project_name ? (
                            <>
                              <strong>{req.project_name}</strong>
                              {req.project_code ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{req.project_code}</div> : null}
                            </>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '16px' }}>{req.team}</td>
                        {viewMode === 'team' && (
                          <td style={{ padding: '16px', fontSize: '14px' }}>{req.created_by_username || '—'}</td>
                        )}
                        <td style={{ padding: '16px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '500',
                            background: 'var(--info-bg)',
                            color: 'var(--info-color)'
                          }}>
                            {req.env}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '500',
                            background: req.cloud === 'AWS' ? '#fff4e6' : req.cloud === 'GCP' ? '#e8f0fe' : '#e3f2fd',
                            color: req.cloud === 'AWS' ? '#ff9900' : req.cloud === 'GCP' ? '#4285f4' : '#0078d4'
                          }}>
                            {req.cloud}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>{req.service}</td>
                        <td style={{ padding: '16px' }}>
                          <span style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: '600',
                            background: req.status === 'draft' ? 'var(--bg-gray-100)' :
                                       req.status === 'pending_approval' || req.status === 'pending_user_manager_approval' || req.status === 'pending_devops_approval' ? 'var(--warning-bg)' :
                                       req.status === 'in_progress' ? 'var(--info-bg)' :
                                       req.status === 'completed' ? 'var(--success-bg)' :
                                       req.status === 'rejected' ? 'var(--error-bg)' :
                                       req.status === 'pending' ? 'var(--warning-bg)' :
                                       req.status === 'merged' ? 'var(--success-bg)' :
                                       req.status === 'closed' ? 'var(--error-bg)' : 'var(--info-bg)',
                            color: req.status === 'draft' ? 'var(--text-secondary)' :
                                   req.status === 'pending_approval' || req.status === 'pending_user_manager_approval' || req.status === 'pending_devops_approval' ? 'var(--warning-color)' :
                                   req.status === 'in_progress' ? 'var(--info-color)' :
                                   req.status === 'completed' ? 'var(--success-color)' :
                                   req.status === 'rejected' ? 'var(--error-color)' :
                                   req.status === 'pending' ? 'var(--warning-color)' :
                                   req.status === 'merged' ? 'var(--success-color)' :
                                   req.status === 'closed' ? 'var(--error-color)' : 'var(--info-color)'
                          }}>
                            {req.status === 'draft' ? 'Draft' :
                             req.status === 'pending_approval' ? 'Pending approval' :
                             req.status === 'pending_user_manager_approval' ? 'Waiting for manager' :
                             req.status === 'pending_devops_approval' ? 'Waiting for platform team' :
                             req.status === 'in_progress' ? 'In progress' :
                             req.status === 'completed' ? 'Completed' :
                             req.status === 'rejected' ? 'Rejected' : req.status}
                          </span>
                        </td>
                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                          {formatDate(req.created_at)}
                        </td>
                        <td style={{ padding: '16px' }}>
                          {req.pr_url ? (
                            <a 
                              href={req.pr_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              style={{
                                color: 'var(--primary-color)',
                                textDecoration: 'none',
                                fontWeight: '500',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.textDecoration = 'underline';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.textDecoration = 'none';
                              }}
                            >
                              Open PR →
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '16px' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {(currentUserId == null || req.created_by === currentUserId) && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                                onClick={() => cloneRequest(req.id)}
                                title="Clone as new draft"
                              >
                                Clone
                              </button>
                            )}
                            {(currentUserId == null || req.created_by === currentUserId) &&
                             ['completed', 'in_progress'].includes(req.status) && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                                onClick={() => promoteRequest(req.id)}
                                title="Promote to next environment"
                              >
                                Promote
                              </button>
                            )}
                            {CANCELLABLE_STATUSES.includes(req.status) &&
                             (currentUserId == null || req.created_by === currentUserId) && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                                onClick={() => cancelRequest(req.id)}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {!loading && !error && totalCount > 0 && (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '16px 24px',
                borderTop: '1px solid var(--border-color)',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
                </span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn btn-secondary"
                    style={{ padding: '8px 16px' }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="btn btn-secondary"
                    style={{ padding: '8px 16px' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* View Details Modal */}
          {(detailRequest !== null || detailLoading) && (
            <div className="modal-overlay" onClick={() => !detailLoading && setDetailRequest(null)}>
              <div
                onClick={e => e.stopPropagation()}
                className="modal history-detail-modal"
                style={{ maxWidth: '860px', width: '100%', maxHeight: '88vh', overflow: 'auto' }}
              >
                {detailLoading ? (
                  <div className="history-detail-modal__loading">Loading request details...</div>
                ) : detailRequest ? (
                  <>
                    <div className="history-detail-modal__header">
                      <div className="history-detail-modal__title-wrap">
                        <span className="history-detail-modal__eyebrow">
                          {detailRequestIsAccess ? 'Access request' : 'Request'}
                        </span>
                        <h3 className="modal-title history-detail-modal__title">
                          {detailRequestIsAccess ? `Access request #${detailRequest.id}` : `Request #${detailRequest.id}`}
                        </h3>
                        <p className="history-detail-modal__subtitle">
                          Review the current status, important request details, and the latest updates in one place.
                        </p>
                      </div>
                      <div className="history-detail-modal__header-actions">
                        {detailStatusMeta ? (
                          <span className={`status-badge ${detailStatusMeta.tone}`}>
                            {detailStatusMeta.label}
                          </span>
                        ) : null}
                        <button onClick={() => setDetailRequest(null)} className="btn btn-secondary">
                          Close
                        </button>
                      </div>
                    </div>
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
                    </div>
                    {detailRequest.status === 'rejected' && detailRequest.reject_reason && (
                      <div className="history-detail-modal__notice history-detail-modal__notice--error">
                        <strong style={{ color: 'var(--error-color)' }}>Why it was rejected:</strong>
                        <p style={{ margin: '6px 0 0', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{detailRequest.reject_reason}</p>
                      </div>
                    )}
                    {detailRequest.cost_risk_preview && (
                      <div className="portal-preview-panel" style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                          <div>
                            <div className="portal-preview-eyebrow">Estimated Cost</div>
                            <strong className="portal-preview-value" style={{ fontSize: 18 }}>What reviewers may check</strong>
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
                            <a href={detailRequest.cost_risk_preview.cost_link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }}>
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
                      <div className="portal-preview-panel" style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                          <div>
                            <div className="portal-preview-eyebrow">Review Steps</div>
                            <strong className="portal-preview-value" style={{ fontSize: 18 }}>How this request is reviewed</strong>
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
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                          className="history-filter-input"
                          style={{ width: 160 }}
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
                    {showConfigHistory && detailRequest && (
                      <div className="history-detail-modal__section history-detail-modal__section--muted">
                        <div className="history-detail-modal__section-head">
                          <strong>Previous versions</strong>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowConfigHistory(false); setConfigHistory([]); }}>
                            Close
                          </button>
                        </div>
                        {configHistory.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No earlier versions yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                            {configHistory.map((h) => (
                              <div key={h.id} style={{ padding: 8, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    #{h.id} · {h.note || 'saved version'} · {new Date(h.created_at).toLocaleString()}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                    onClick={() => rollbackRequest(detailRequest.id, h.id)}
                                  >
                                    Restore this version
                                  </button>
                                </div>
                                <pre style={{ margin: 0, fontSize: 11, overflow: 'auto', maxHeight: 60 }}>{String(h.config || '').slice(0, 200)}...</pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {(diffResult?.changes?.length ?? 0) > 0 && (
                      <div className="history-detail-modal__section history-detail-modal__section--muted">
                        <strong>Comparison with request #{compareWithId}</strong>
                        {diffResult?.changes?.map((c: any) => (
                          <div key={c.field} style={{ marginTop: 8, fontSize: 13 }}>
                            <strong>{c.field}:</strong> <span style={{ color: 'var(--error-color)' }}>− {String(c.base_value || '').slice(0, 80)}</span>
                            <br />
                            <strong>{c.field}:</strong> <span style={{ color: 'var(--success-color)' }}>+ {String(c.compare_value || '').slice(0, 80)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Tags */}
                    <div className="history-detail-modal__section">
                      <strong>Labels</strong>
                      <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                        {tags.map((t) => (
                          <span
                            key={t}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              background: 'var(--primary-tint)',
                              color: 'var(--primary-color)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
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
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 14 }}
                              aria-label={`Remove ${t}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <div style={{ display: 'flex', gap: '6px' }}>
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
                            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', width: 100 }}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '6px 12px', fontSize: 13 }}
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
                          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                            Waiting on: {dependsOn.map((id) => {
                              const r = requests.find((x) => x.id === id);
                              const canRemove = detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId);
                              return (
                                <span key={id} style={{ marginRight: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  {r ? (
                                    <button type="button" onClick={() => { setDetailRequest(null); openDetail(r); }} style={{ padding: '2px 8px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
                                      #{id}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => { setFilterType('pr_number'); setFilterValue(String(id)); fetchHistory(); }}
                                      style={{ color: 'var(--primary-color)', fontSize: 13, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
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
                                    }} style={{ padding: '0 4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--error-color)', fontSize: 14 }} title="Remove">×</button>
                                  )}
                                </span>
                              );
                            })}
                          </p>
                        )}
                        {blockedBy.length > 0 && (
                          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                            Blocking: {blockedBy.map((id) => {
                              const r = requests.find((x) => x.id === id);
                              return r ? (
                                <button key={id} type="button" onClick={() => { setDetailRequest(null); openDetail(r); }} style={{ marginRight: 8, padding: '2px 8px', background: 'var(--info-color)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
                                  #{id}
                                </button>
                              ) : (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => { setFilterType('pr_number'); setFilterValue(String(id)); fetchHistory(); }}
                                  style={{ marginRight: 8, color: 'var(--info-color)', fontSize: 13, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                >
                                  #{id}
                                </button>
                              );
                            })}
                          </p>
                        )}
                        {detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId) && (
                          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input type="number" placeholder="Request #" value={newDepId} onChange={(e) => setNewDepId(e.target.value)} className="input" style={{ width: 100, padding: '6px 10px' }} min={1} />
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
                      <div style={{ marginTop: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                        {timelineLoading ? (
                          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Loading activity…</p>
                        ) : timeline.length === 0 ? (
                          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>No updates yet.</p>
                        ) : (
                          timeline.map((e) => (
                            <div key={`${e.kind}-${e.id}`} style={{ marginBottom: '8px', padding: '6px 10px', background: 'var(--bg-gray-50)', borderRadius: '6px', fontSize: '13px' }}>
                              <span style={{ fontWeight: 600 }}>{e.username || 'System'}</span>
                              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{formatTimelineAction(e.action)}</span>
                              {e.details && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}> - {e.details}</span>}
                              {e.body && <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{e.body}</p>}
                              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{new Date(e.created_at).toLocaleString()}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    {/* Comments */}
                    <div className="history-detail-modal__section">
                      <strong>Conversation</strong>
                      <div style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                        {comments.length === 0 ? (
                          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>No comments yet.</p>
                        ) : (
                          comments.map(c => (
                            <div key={c.id} style={{ marginBottom: '12px', padding: '8px', background: 'var(--bg-gray-50)', borderRadius: '8px' }}>
                              <span style={{ fontWeight: '600', fontSize: '13px' }}>{c.username || 'User'}</span>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                {new Date(c.created_at).toLocaleString()}
                              </span>
                              <p style={{ margin: '4px 0 0', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{c.body}</p>
                            </div>
                          ))
                        )}
                      </div>
                      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
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
                          style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                        />
                        <button type="button" onClick={addComment} className="btn btn-primary" disabled={!commentBody.trim() || commentSubmitting} style={{ padding: '8px 16px' }}>
                          {commentSubmitting ? '...' : 'Send'}
                        </button>
                      </div>
                    </div>
                    {detailRequest.config && (
                      <div className="history-detail-modal__section">
                        <strong>Request details (JSON)</strong>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          Sensitive values are hidden in this view. Raw values are not kept in page state.
                        </p>
                        <pre className="portal-code-block" style={{ maxHeight: '300px' }}>
                          {detailRequest.config}
                        </pre>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}
      </div>
    </>
  );
}
