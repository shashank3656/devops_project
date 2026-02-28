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

interface PRRequest {
  id: number;
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

const PAGE_SIZE = 10;

export default function History() {
  const router = useRouter();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<'team' | 'pr_number' | 'env' | 'cloud' | 'search' | 'application_id'>('team');
  const [filterValue, setFilterValue] = useState('');
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

  const formatTimelineAction = (action: string) => {
    const map: Record<string, string> = {
      request_create: 'created request',
      request_submit: 'submitted',
      request_approved_by_manager: 'approved (manager)',
      request_approve: 'approved',
      request_reject: 'rejected',
      request_comment: 'commented',
      request_clone: 'cloned',
      request_resubmit: 'resubmitted',
      request_cancel: 'cancelled',
      request_promote: 'promoted',
      request_plan_output: 'updated plan output',
      request_reassign: 'reassigned',
    };
    return map[action] || action.replace(/_/g, ' ');
  };
  const [timelineLoading, setTimelineLoading] = useState(false);
  const rawConfigByRequestId = useRef<Record<number, string>>({});

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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
        setStatusFilter(l.statusFilter || '');
        setFromDate(l.fromDate || '');
        setToDate(l.toDate || '');
        setViewMode(l.viewMode || 'mine');
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
  }, [filterType, filterValue, page, viewMode, statusFilter, fromDate, toDate]);

  useEffect(() => {
    setSelectedRowIndex(0);
  }, [requests.length, page]);

  useEffect(() => {
    try {
      const p: FilterPreset = {
        name: '',
        filterType,
        filterValue,
        statusFilter,
        fromDate,
        toDate,
        viewMode,
      };
      localStorage.setItem(HISTORY_LAST_FILTERS_KEY, JSON.stringify(p));
    } catch (_) {}
  }, [filterType, filterValue, statusFilter, fromDate, toDate, viewMode]);

  const savePreset = () => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const p: FilterPreset = { name, filterType, filterValue, statusFilter, fromDate, toDate, viewMode };
    const next = presets.filter((x) => x.name !== name).concat([p]);
    setPresets(next);
    setPresetName('');
    try {
      localStorage.setItem(HISTORY_FILTER_PRESETS_KEY, JSON.stringify(next));
    } catch (_) {}
    toast(`Saved preset "${name}"`, 'success');
  };

  const loadPreset = (p: FilterPreset) => {
    setFilterType(p.filterType as any);
    setFilterValue(p.filterValue);
    setStatusFilter(p.statusFilter);
    setFromDate(p.fromDate);
    setToDate(p.toDate);
    setViewMode(p.viewMode);
    setPage(0);
    toast(`Loaded preset "${p.name}"`, 'success');
  };

  const deletePreset = (name: string) => {
    const next = presets.filter((x) => x.name !== name);
    setPresets(next);
    try {
      localStorage.setItem(HISTORY_FILTER_PRESETS_KEY, JSON.stringify(next));
    } catch (_) {}
    toast('Preset deleted', 'success');
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
      setRequests(data.requests || []);
      setTotalCount(data.total_count ?? data.requests?.length ?? 0);
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
        setComments(cData.comments || []);
      }
      const timelineRes = await fetch(`${apiUrl}/api/request/${req.id}/timeline`, { headers });
      if (timelineRes.ok) {
        const tData = await timelineRes.json();
        setTimeline(tData.timeline || []);
      }
      if (tagsRes.ok) {
        const tData = await tagsRes.json();
        setTags(tData.tags || []);
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
        setTimeline(d.timeline || []);
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
        toast(d?.message || 'Ticket cancelled', 'success');
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
          setComments(d.comments || []);
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
        setConfigHistory(d.history || []);
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

  const useAsTemplate = (req: PRRequest) => {
    try {
      const rawConfig = rawConfigByRequestId.current[req.id] ?? req.config ?? '';
      sessionStorage.setItem(TEMPLATE_KEY, JSON.stringify({
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
        <title>History - Infrastructure Portal</title>
      </Head>
      <div className="history-page">
        <div className="history-page__header">
          <h1 className="page-header__title">PR Request History</h1>
          {recentIds.length > 0 && (
            <div className="history-recent" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Recent:</span>
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
              🔄 Refresh
            </button>
            <button onClick={exportCSV} className="btn btn-secondary" disabled={loading}>
              📥 Export CSV
            </button>
          </div>
        </div>

        {/* Filter Box */}
        <div className="card history-filter-card">
          <h3 className="history-filter-card__title">Filter Requests</h3>
          <div className="history-filter-card__row">
            <div className="history-filter-field">
              <label htmlFor="filter-type" className="history-filter-label">Filter By</label>
              <select
                  id="filter-type"
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value as 'team' | 'pr_number' | 'env' | 'cloud' | 'search' | 'application_id');
                    setFilterValue(''); // Clear value when changing filter type
                  }}
                  className="history-filter-select"
                >
                  <option value="team">Team</option>
                  <option value="pr_number">PR Number</option>
                  <option value="application_id">Application ID</option>
                  <option value="env">Environment</option>
                  <option value="cloud">Cloud</option>
                  <option value="search">Search (all fields)</option>
              </select>
            </div>
            <div className="history-filter-field history-filter-field--grow">
              <label htmlFor="filter-value" className="history-filter-label">
                  {filterType === 'pr_number' ? 'PR Number' :
                   filterType === 'search' ? 'Search term' :
                   filterType === 'team' ? 'Team Name' :
                   filterType === 'application_id' ? 'Application ID' :
                   filterType === 'env' ? 'Environment' : 'Cloud Provider'}
              </label>
              <input
                id="filter-value"
                type={filterType === 'pr_number' ? 'number' : 'text'}
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                placeholder={
                  filterType === 'pr_number' ? 'Enter PR number (e.g., 123)' :
                  filterType === 'search' ? 'Search team, env, cloud, service…' :
                  filterType === 'team' ? 'Enter team name' :
                  filterType === 'application_id' ? 'Enter application ID' :
                  filterType === 'env' ? 'Enter environment (dev, stage, prod)' :
                  'Enter cloud provider (AWS, GCP, Azure)'
                }
                className="history-filter-input"
              />
            </div>
            <div className="history-filter-field">
              <label className="history-filter-label">Status</label>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="history-filter-select" style={{ minWidth: 140 }}>
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
            <div className="history-filter-field">
              <label className="history-filter-label">From date</label>
              <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} className="history-filter-input" />
            </div>
            <div className="history-filter-field">
              <label className="history-filter-label">To date</label>
              <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} className="history-filter-input" />
            </div>
            <div className="history-filter-actions">
              <div className="history-filter-inline">
                <span className="history-filter-label">View</span>
                <select
                  value={viewMode}
                  onChange={(e) => { setViewMode(e.target.value as 'mine' | 'team'); setPage(0); }}
                  className="history-filter-select"
                  style={{ minWidth: 120 }}
                >
                  <option value="mine">My tickets</option>
                  <option value="team">Group tickets</option>
                </select>
              </div>
              <div className="history-filter-inline">
                <span className="history-filter-label">Sort by</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="history-filter-select"
                  style={{ minWidth: 140 }}
                >
                  <option value="created_at">Created (newest)</option>
                  <option value="id">Ticket #</option>
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
              <button
                onClick={() => { setFilterValue(''); fetchHistory(); }}
                className="btn btn-secondary"
              >
                Clear
              </button>
              <div className="history-filter-inline" style={{ marginLeft: 12, gap: 6 }}>
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name"
                  className="history-filter-input"
                  style={{ width: 100 }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={savePreset}>
                  Save preset
                </button>
                {presets.length > 0 && (
                  <select
                    className="history-filter-select"
                    style={{ minWidth: 120 }}
                    value=""
                    onChange={(e) => {
                      const name = e.target.value;
                      if (name) loadPreset(presets.find((p) => p.name === name)!);
                      e.target.value = '';
                    }}
                  >
                    <option value="">Load preset…</option>
                    {presets.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
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
                  {filterValue ? 'No PR requests found matching your filter' : 'No requests yet'}
                </p>
                {!filterValue && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    Create your first request from Custom JSON or Select Service.
                  </p>
                )}
                {filterValue ? (
                  <button
                    onClick={() => { setFilterValue(''); fetchHistory(); }}
                    className="btn btn-secondary"
                    style={{ marginTop: '1rem' }}
                  >
                    Clear Filter
                  </button>
                ) : (
                  <div className="history-empty__actions">
                    <button onClick={() => router.push('/custom-json')} className="btn btn-primary">
                      Custom JSON
                    </button>
                    <button onClick={() => router.push('/select-service')} className="btn btn-secondary">
                      Select Service
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                {viewMode === 'team' && (
                  <p style={{ padding: '12px 16px 0', margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                    Showing tickets raised by you and your team members. Use <strong>Raised by</strong> to see who created each ticket.
                  </p>
                )}
                <p style={{ padding: '8px 16px 0', margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  Tip: Use <kbd style={{ padding: '2px 6px', background: 'var(--bg-button-secondary)', borderRadius: 4 }}>j</kbd> / <kbd style={{ padding: '2px 6px', background: 'var(--bg-button-secondary)', borderRadius: 4 }}>k</kbd> to move, <kbd style={{ padding: '2px 6px', background: 'var(--bg-button-secondary)', borderRadius: 4 }}>Enter</kbd> to open
                </p>
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Ticket #</th>
                      <th>Team</th>
                      {viewMode === 'team' && <th>Raised by</th>}
                      <th>Environment</th>
                      <th>Cloud</th>
                      <th>Service</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>PR Link</th>
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
                             req.status === 'pending_user_manager_approval' ? 'Pending your approval' :
                             req.status === 'pending_devops_approval' ? 'Pending DevOps approval' :
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
                              View PR →
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
            <div
              onClick={() => !detailLoading && setDetailRequest(null)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '20px'
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                className="card"
                style={{
                  maxWidth: '760px',
                  width: '100%',
                  maxHeight: '85vh',
                  overflow: 'auto'
                }}
              >
                {detailLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>Loading details...</div>
                ) : detailRequest ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <h3 style={{ margin: 0 }}>Ticket #{detailRequest.id}</h3>
                      <button onClick={() => setDetailRequest(null)} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
                        Close
                      </button>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <strong>Team:</strong> {detailRequest.team} &nbsp;|&nbsp; <strong>Env:</strong> {detailRequest.env} &nbsp;|&nbsp; <strong>Cloud:</strong> {detailRequest.cloud} &nbsp;|&nbsp; <strong>Service:</strong> {detailRequest.service}
                      {detailRequest.application_id && (
                        <> &nbsp;|&nbsp; <strong>App ID:</strong> <code style={{ background: 'var(--bg-gray-100)', padding: '2px 6px', borderRadius: 4 }}>{detailRequest.application_id}</code></>
                      )}
                    </div>
                    {(detailRequest.priority || detailRequest.due_date) && (
                      <div style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                        {detailRequest.priority && <span><strong>Priority:</strong> {detailRequest.priority} </span>}
                        {detailRequest.due_date && <span><strong>Due:</strong> {new Date(detailRequest.due_date).toLocaleDateString()} </span>}
                      </div>
                    )}
                    <div style={{ marginBottom: '12px' }}>
                      <strong>Status:</strong>{' '}
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        background: detailRequest.status === 'draft' ? 'var(--bg-gray-100)' :
                                   detailRequest.status === 'pending_approval' || detailRequest.status === 'pending_user_manager_approval' || detailRequest.status === 'pending_devops_approval' ? 'var(--warning-bg)' :
                                   detailRequest.status === 'in_progress' ? 'var(--info-bg)' :
                                   detailRequest.status === 'completed' ? 'var(--success-bg)' :
                                   detailRequest.status === 'rejected' ? 'var(--error-bg)' : 'var(--info-bg)',
                        color: detailRequest.status === 'draft' ? 'var(--text-secondary)' :
                               detailRequest.status === 'pending_approval' || detailRequest.status === 'pending_user_manager_approval' || detailRequest.status === 'pending_devops_approval' ? 'var(--warning-color)' :
                               detailRequest.status === 'in_progress' ? 'var(--info-color)' :
                               detailRequest.status === 'completed' ? 'var(--success-color)' :
                               detailRequest.status === 'rejected' ? 'var(--error-color)' : 'var(--info-color)'
                      }}>
                        {detailRequest.status === 'draft' ? 'Draft' :
                         detailRequest.status === 'pending_approval' ? 'Pending approval' :
                         detailRequest.status === 'pending_user_manager_approval' ? 'Pending your approval' :
                         detailRequest.status === 'pending_devops_approval' ? 'Pending DevOps approval' :
                         detailRequest.status === 'in_progress' ? 'In progress' :
                         detailRequest.status === 'completed' ? 'Completed' :
                         detailRequest.status === 'rejected' ? 'Rejected' : detailRequest.status}
                      </span>
                    </div>
                    {detailRequest.status === 'rejected' && detailRequest.reject_reason && (
                      <div style={{ marginBottom: '12px', padding: '12px', background: 'var(--error-bg)', borderRadius: '8px', borderLeft: '4px solid var(--error-color)' }}>
                        <strong style={{ color: 'var(--error-color)' }}>Rejection reason (from admin):</strong>
                        <p style={{ margin: '6px 0 0', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{detailRequest.reject_reason}</p>
                      </div>
                    )}
                    {detailRequest.cost_risk_preview && (
                      <div className="portal-preview-panel" style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                          <div>
                            <div className="portal-preview-eyebrow">Cost And Risk</div>
                            <strong className="portal-preview-value" style={{ fontSize: 18 }}>Manager Review Preview</strong>
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
                                <strong className="portal-preview-signal__title">No major heuristic risks</strong>
                                <span className={getPreviewRiskClass('low')}>low</span>
                              </div>
                              <p className="portal-preview-signal__detail">
                                The request did not trigger major risk heuristics, but manager approval should still verify ownership, rollout safety, and expected spend.
                              </p>
                            </article>
                          )}
                        </div>
                      </div>
                    )}
                    <div style={{ marginBottom: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {detailRequest.status === 'draft' && (
                        <>
                          <button type="button" onClick={() => submitDraft(detailRequest.id)} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                            Submit for approval
                          </button>
                          <button type="button" onClick={() => deleteDraft(detailRequest.id)} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                            Delete draft
                          </button>
                        </>
                      )}
                      {detailRequest.status === 'pending_user_manager_approval' && canApproveByManager && (
                        <button type="button" onClick={() => approveByManager(detailRequest.id)} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                          Approve (send to DevOps)
                        </button>
                      )}
                      {detailRequest.status === 'rejected' && (
                        <button type="button" onClick={() => resubmitRequest(detailRequest.id)} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                          Resubmit as draft
                        </button>
                      )}
                      {(currentUserId == null || detailRequest.created_by === currentUserId) && (
                        <button type="button" onClick={() => cloneRequest(detailRequest.id)} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '14px' }} title="Clone as new draft">
                          Clone request
                        </button>
                      )}
                      {(currentUserId == null || detailRequest.created_by === currentUserId) &&
                       ['completed', 'in_progress'].includes(detailRequest.status) && (
                        <button type="button" onClick={() => promoteRequest(detailRequest.id)} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '14px' }} title="Create new request for next environment (dev→stage→prod)">
                          Promote to next env
                        </button>
                      )}
                      {(currentUserId == null || detailRequest.created_by === currentUserId) &&
                       ['draft', 'in_progress'].includes(detailRequest.status) && (
                        <button type="button" onClick={() => fetchConfigHistory(detailRequest.id)} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '14px' }} title="Restore config from previous snapshot">
                          Rollback
                        </button>
                      )}
                      {CANCELLABLE_STATUSES.includes(detailRequest.status) &&
                       (currentUserId == null || detailRequest.created_by === currentUserId) && (
                        <button type="button" onClick={() => cancelRequest(detailRequest.id)} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                          Cancel ticket
                        </button>
                      )}
                      {detailRequest.pr_url ? (
                        <a href={detailRequest.pr_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)' }}>
                          Open PR →
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => useAsTemplate(detailRequest)}
                        className="btn btn-secondary"
                        style={{ padding: '8px 16px', fontSize: '14px' }}
                      >
                        Use as template
                      </button>
                      <button
                        type="button"
                        onClick={() => saveConfiguration(detailRequest)}
                        className="btn btn-secondary"
                        style={{ padding: '8px 16px', fontSize: '14px' }}
                      >
                        Save as my template
                      </button>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Compare with PR #"
                          value={compareWithId}
                          onChange={(e) => setCompareWithId(e.target.value)}
                          style={{ width: 120, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-color)' }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: 13 }}
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
                          <button type="button" className="btn btn-secondary" style={{ padding: '6px' }} onClick={() => setDiffResult(null)}>
                            Clear diff
                          </button>
                        )}
                      </div>
                    </div>
                    {showConfigHistory && detailRequest && (
                      <div style={{ marginBottom: 12, padding: 12, background: 'var(--bg-gray-50)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <strong>Config history (rollback)</strong>
                          <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { setShowConfigHistory(false); setConfigHistory([]); }}>
                            Close
                          </button>
                        </div>
                        {configHistory.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No config snapshots yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                            {configHistory.map((h) => (
                              <div key={h.id} style={{ padding: 8, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    #{h.id} · {h.note || 'snapshot'} · {new Date(h.created_at).toLocaleString()}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                    onClick={() => rollbackRequest(detailRequest.id, h.id)}
                                  >
                                    Restore
                                  </button>
                                </div>
                                <pre style={{ margin: 0, fontSize: 11, overflow: 'auto', maxHeight: 60 }}>{String(h.config || '').slice(0, 200)}...</pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {diffResult && diffResult.changes && diffResult.changes.length > 0 && (
                      <div style={{ marginBottom: 12, padding: 12, background: 'var(--bg-gray-50)', borderRadius: 8 }}>
                        <strong>Diff (this vs #{compareWithId})</strong>
                        {diffResult.changes.map((c: any) => (
                          <div key={c.field} style={{ marginTop: 8, fontSize: 13 }}>
                            <strong>{c.field}:</strong> <span style={{ color: 'var(--error-color)' }}>− {String(c.base_value || '').slice(0, 80)}</span>
                            <br />
                            <strong>{c.field}:</strong> <span style={{ color: 'var(--success-color)' }}>+ {String(c.compare_value || '').slice(0, 80)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Tags */}
                    <div style={{ marginBottom: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                      <strong>Tags</strong>
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
                            placeholder="Add tag"
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
                                    setTags(d.tags || []);
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
                                setTags(d.tags || []);
                                setNewTag('');
                              }
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Dependencies */}
                    {(dependsOn.length > 0 || blockedBy.length > 0 || (detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId))) && (
                      <div style={{ marginBottom: 20, padding: '12px 16px', background: 'var(--bg-gray-100)', borderRadius: 8 }}>
                        <strong>Dependencies</strong>
                        {dependsOn.length > 0 && (
                          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                            Depends on: {dependsOn.map((id) => {
                              const r = requests.find((x) => x.id === id);
                              const canRemove = detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId);
                              return (
                                <span key={id} style={{ marginRight: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  {r ? (
                                    <button type="button" onClick={() => { setDetailRequest(null); openDetail(r); }} style={{ padding: '2px 8px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
                                      #{id}
                                    </button>
                                  ) : (
                                    <a href="#" onClick={(e) => { e.preventDefault(); setFilterType('pr_number'); setFilterValue(String(id)); fetchHistory(); }} style={{ color: 'var(--primary-color)', fontSize: 13 }}>#{id}</a>
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
                                <a key={id} href="#" onClick={(e) => { e.preventDefault(); setFilterType('pr_number'); setFilterValue(String(id)); fetchHistory(); }} style={{ marginRight: 8, color: 'var(--info-color)', fontSize: 13 }}>#{id}</a>
                              );
                            })}
                          </p>
                        )}
                        {detailRequest && (currentUserId == null || detailRequest.created_by === currentUserId) && (
                          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input type="number" placeholder="Request #" value={newDepId} onChange={(e) => setNewDepId(e.target.value)} className="input" style={{ width: 100, padding: '6px 10px' }} min={1} />
                            <button type="button" className="btn btn-secondary btn-sm" disabled={addingDep || !newDepId.trim()} onClick={async () => {
                              const depId = parseInt(newDepId.trim(), 10);
                              if (isNaN(depId) || depId <= 0 || !detailRequest) return;
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
                              {addingDep ? '…' : 'Add dependency'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Audit trail */}
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                      <strong>Audit trail</strong>
                      <div style={{ marginTop: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                        {timelineLoading ? (
                          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Loading…</p>
                        ) : timeline.length === 0 ? (
                          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>No activity yet.</p>
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
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                      <strong>Comments</strong>
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
                          placeholder="Add a comment..."
                          value={commentBody}
                          onChange={(e) => setCommentBody(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addComment())}
                          style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                        />
                        <button type="button" onClick={addComment} className="btn btn-primary" disabled={!commentBody.trim() || commentSubmitting} style={{ padding: '8px 16px' }}>
                          {commentSubmitting ? '...' : 'Post'}
                        </button>
                      </div>
                    </div>
                    {detailRequest.config && (
                      <div>
                        <strong>Configuration (JSON):</strong>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          Sensitive and customer data (passwords, tokens, email, name, phone, etc.) are masked. Raw data is not kept in page state.
                        </p>
                        <pre style={{ 
                          background: 'var(--bg-gray-100)', 
                          padding: '16px', 
                          borderRadius: '8px', 
                          overflow: 'auto', 
                          fontSize: '13px',
                          maxHeight: '300px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}>
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
