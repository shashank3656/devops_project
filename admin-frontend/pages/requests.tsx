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
  const limit = 20;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  const filtersRef = useRef<{ team: string; projectId: string; env: string; cloud: string; search: string; status: string; priority: string; sortBy: string; sortOrder: string; atRiskOnly: boolean }>({ team: '', projectId: '', env: '', cloud: '', search: '', status: '', priority: '', sortBy: 'created_at', sortOrder: 'desc', atRiskOnly: false });

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
        if (data.requests) setRequests(data.requests);
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
    if (isNaN(numId) || numId <= 0) return;
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
          .then((d) => setDetailComments(d.comments || []))
          .catch(() => {});
        fetch(`${apiUrl}/api/request/${req.id}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d?.timeline) setTimeline(d.timeline); })
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
      .then((d) => { if (d?.timeline) setTimeline(d.timeline); })
      .catch(() => setTimeline([]));
    fetch(`${apiUrl}/api/request/${req.id}/comments`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((d) => setDetailComments(d.comments || []))
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
        setDetailComments(d.comments || []);
        fetch(`${apiUrl}/api/request/${detailRequest.id}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((td) => { if (td?.timeline) setTimeline(td.timeline); });
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
        setConfigHistory(d.history || []);
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
        <title>PR Requests - InfraGate Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Requests</span>
              <h1 className="portal-page__title">Request Management</h1>
              <p className="portal-page__subtitle">
                Search by team, environment, cloud, or priority, then act on individual requests or in bulk.
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
              Export CSV (filtered)
            </button>
          </div>

          {recentIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Recent:</span>
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

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleFilter} className="filters-bar">
            <input
              id="filter-team"
              name="filter-team"
              type="text"
              className="input"
              placeholder="Team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            />
            <select
              id="filter-project"
              name="filter-project"
              className="input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
              ))}
            </select>
            <input
              id="filter-env"
              name="filter-env"
              type="text"
              className="input"
              placeholder="Env"
              value={env}
              onChange={(e) => setEnv(e.target.value)}
            />
            <input
              id="filter-cloud"
              name="filter-cloud"
              type="text"
              className="input"
              placeholder="Cloud"
              value={cloud}
              onChange={(e) => setCloud(e.target.value)}
            />
            <input
              id="filter-search"
              name="filter-search"
              type="text"
              className="input"
              placeholder="Search (all fields)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 180 }}
            />
            <select
              id="filter-status"
              name="filter-status"
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ minWidth: 160 }}
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="pending_user_manager_approval">Pending user manager</option>
              <option value="pending_devops_approval">Pending DevOps approval</option>
              <option value="pending_approval">Pending approval</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              id="filter-priority"
              name="filter-priority"
              className="input"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              style={{ minWidth: 120 }}
            >
              <option value="">All priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select id="filter-sort-by" name="filter-sort-by" className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ minWidth: 120 }}>
              <option value="created_at">Sort: Created</option>
              <option value="updated_at">Sort: Updated</option>
              <option value="priority">Sort: Priority</option>
              <option value="due_date">Sort: Due date</option>
            </select>
            <select id="filter-sort-order" name="filter-sort-order" className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} style={{ minWidth: 80 }}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" id="filter-at-risk" name="filter-at-risk" checked={atRiskOnly} onChange={(e) => setAtRiskOnly(e.target.checked)} />
              At risk (overdue / due in 24h)
            </label>
            <button type="submit" className="btn btn-primary">
              Apply filters
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClearFilters}
            >
              Clear
            </button>
          </form>

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : requests.length === 0 ? (
              <div className="empty-state">
                No PR requests match the filters.
              </div>
            ) : (
              <>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {pendingIds.length > 0 && (
                    <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
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
                      style={{ padding: '6px 14px', fontSize: 13 }}
                      disabled={selectedIds.size === 0 || bulkActioning}
                      onClick={handleBulkApprove}
                    >
                      {bulkActioning ? '…' : `Approve selected (${selectedIds.size})`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '6px 14px', fontSize: 13 }}
                      disabled={selectedIds.size === 0 || bulkActioning}
                      onClick={handleBulkReject}
                    >
                      Reject selected
                    </button>
                    </>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === requests.length && requests.length > 0}
                      onChange={toggleSelectAll}
                    />
                    Select all ({requests.length})
                  </label>
                  <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <select
                      value={bulkStatusValue}
                      onChange={(e) => setBulkStatusValue(e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: 6, fontSize: 13 }}
                    >
                      <option value="">Bulk status…</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '6px 14px', fontSize: 13 }}
                      disabled={selectedIds.size === 0 || !bulkStatusValue || bulkActioning}
                      onClick={handleBulkStatus}
                    >
                      Apply
                    </button>
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 44 }} title="Select">☐</th>
                        <th>ID</th>
                        <th>Project</th>
                        <th>Team</th>
                        <th>Env</th>
                        <th>Cloud</th>
                        <th>Service</th>
                        <th>Priority</th>
                        <th>Due</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th style={{ width: 200 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((req) => (
                        <tr key={req.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(req)}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(req.id)}
                              onChange={() => toggleSelect(req.id)}
                            />
                          </td>
                          <td>{req.id}</td>
                          <td>
                            {req.project_name ? (
                              <>
                                <strong>{req.project_name}</strong>
                                {req.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{req.project_code}</div> : null}
                              </>
                            ) : '—'}
                          </td>
                          <td>{req.team}</td>
                          <td>{req.env}</td>
                          <td>{req.cloud}</td>
                          <td>{req.service}</td>
                          <td style={{ fontSize: 13 }}>{req.priority || '—'}</td>
                          <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                            {req.due_date ? new Date(req.due_date).toLocaleDateString() : '—'}
                            {req.due_status === 'overdue' && (
                              <span style={{ marginLeft: 6, padding: '2px 6px', borderRadius: 4, fontSize: 11, background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>Overdue</span>
                            )}
                            {req.due_status === 'due_soon' && (
                              <span style={{ marginLeft: 6, padding: '2px 6px', borderRadius: 4, fontSize: 11, background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>Due in 24h</span>
                            )}
                          </td>
                          <td>
                            <span
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 600,
                                background: req.status === 'draft' ? '#f1f5f9' :
                                           canApproveOrReject(req.status) ? 'var(--color-warning-bg)' :
                                           req.status === 'in_progress' ? 'var(--color-primary-light)' :
                                           req.status === 'completed' ? 'var(--color-success-bg)' :
                                           req.status === 'rejected' ? 'var(--color-danger-bg)' : '#f1f5f9',
                                color: req.status === 'draft' ? 'var(--color-text-muted)' :
                                       canApproveOrReject(req.status) ? 'var(--color-warning)' :
                                       req.status === 'in_progress' ? 'var(--color-primary)' :
                                       req.status === 'completed' ? 'var(--color-success)' :
                                       req.status === 'rejected' ? 'var(--color-danger)' : 'var(--color-text-muted)'
                              }}
                            >
                              {statusLabel(req.status)}
                            </span>
                          </td>
                          <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                            {new Date(req.created_at).toLocaleString()}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                              {req.status === 'pending_approval' && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '6px 12px', fontSize: 13 }}
                                    disabled={actioningId !== null}
                                    onClick={() => handleApprove(req.id)}
                                  >
                                    {actioningId === req.id ? '…' : 'Approve'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-danger"
                                    style={{ padding: '6px 12px', fontSize: 13 }}
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
                                  className="btn btn-secondary"
                                  style={{ padding: '6px 12px', fontSize: 13 }}
                                  disabled={actioningId !== null}
                                  onClick={() => handleSetStatus(req.id, 'completed')}
                                >
                                  {actioningId === req.id ? '…' : 'Mark completed'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: 13 }}
                                disabled={actioningId !== null || cloningId !== null}
                                onClick={(e) => { e.stopPropagation(); handleClone(req.id); }}
                                title="Clone as new draft"
                              >
                                {cloningId === req.id ? '…' : 'Clone'}
                              </button>
                              {['completed', 'in_progress'].includes(req.status) && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '6px 12px', fontSize: 13 }}
                                  disabled={promotingId !== null}
                                  onClick={(e) => { e.stopPropagation(); handlePromote(req.id); }}
                                  title="Promote to next environment"
                                >
                                  {promotingId === req.id ? '…' : 'Promote'}
                                </button>
                              )}
                              {req.pr_url ? (
                                <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }}>
                                  Open PR
                                </a>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
                    Page {currentPage} of {totalPages} ({total} total)
                  </span>
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
              </>
            )}
          </div>

          {detailRequest && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: 20,
              }}
              onClick={() => setDetailRequest(null)}
            >
              <div
                className="card"
                style={{ maxWidth: 760, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Request #{detailRequest.id}</h3>
                  <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => setDetailRequest(null)}>
                    Close
                  </button>
                </div>
                <p style={{ marginBottom: 8, fontSize: 14 }}>
                  <strong>Team:</strong> {detailRequest.team} · <strong>Env:</strong> {detailRequest.env} · <strong>Cloud:</strong> {detailRequest.cloud} · <strong>Service:</strong> {detailRequest.service}
                </p>
                {detailRequest.created_by_username && (
                  <p style={{ marginBottom: 8, fontSize: 14, color: 'var(--color-text-muted)' }}>
                    <strong>Requester:</strong> {detailRequest.created_by_username}
                  </p>
                )}
                {detailRequest.branch && (
                  <p style={{ marginBottom: 8, fontSize: 14, color: 'var(--color-text-muted)' }}>
                    <strong>Branch:</strong> <code style={{ fontSize: 12 }}>{detailRequest.branch}</code>
                  </p>
                )}
                {detailRequest.file_path && (
                  <p style={{ marginBottom: 8, fontSize: 14, color: 'var(--color-text-muted)' }}>
                    <strong>File path:</strong> <code style={{ fontSize: 12 }}>{detailRequest.file_path}</code>
                  </p>
                )}
                <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Created: {new Date(detailRequest.created_at).toLocaleString()}
                  {detailRequest.updated_at && ` · Updated: ${new Date(detailRequest.updated_at).toLocaleString()}`}
                </p>
                <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: 13 }}
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
                      style={{ padding: '6px 12px', fontSize: 13 }}
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
                      style={{ padding: '6px 12px', fontSize: 13 }}
                      disabled={rollbackingId !== null}
                      onClick={() => fetchConfigHistory(detailRequest.id)}
                      title="Restore config from previous snapshot"
                    >
                      Rollback
                    </button>
                  )}
                  {detailRequest.pr_url && (
                    <a href={detailRequest.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }}>
                      Open PR
                    </a>
                  )}
                </div>
                {(detailRequest.priority || detailRequest.due_date) && (
                  <p style={{ marginBottom: 8, fontSize: 14, color: 'var(--color-text-muted)' }}>
                    {detailRequest.priority && <span>Priority: {detailRequest.priority} </span>}
                    {detailRequest.due_date && <span>Due: {new Date(detailRequest.due_date).toLocaleDateString()}</span>}
                  </p>
                )}
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>Jira ticket:</strong>
                  <input
                    type="text"
                    value={jiraEdit}
                    onChange={(e) => setJiraEdit(e.target.value)}
                    placeholder="e.g. PROJ-123"
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13, minWidth: 140 }}
                  />
                  <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} disabled={jiraSaving} onClick={handleSaveJira}>
                    {jiraSaving ? '…' : 'Save'}
                  </button>
                </div>
                {detailRequest.blocked_by_with_status && detailRequest.blocked_by_with_status.length > 0 && (
                  <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--color-warning)' }}>
                    <strong>Blocks:</strong> Request(s) #{detailRequest.blocked_by_with_status.map((b) => b.id).join(', #')} depend on this one.
                  </p>
                )}
                <p style={{ marginBottom: 16 }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: detailRequest.status === 'draft' ? '#f1f5f9' :
                                 canApproveOrReject(detailRequest.status) ? 'var(--color-warning-bg)' :
                                 detailRequest.status === 'in_progress' ? 'var(--color-primary-light)' :
                                 detailRequest.status === 'completed' ? 'var(--color-success-bg)' :
                                 detailRequest.status === 'rejected' ? 'var(--color-danger-bg)' : '#f1f5f9',
                      color: detailRequest.status === 'draft' ? 'var(--color-text-muted)' :
                             canApproveOrReject(detailRequest.status) ? 'var(--color-warning)' :
                             detailRequest.status === 'in_progress' ? 'var(--color-primary)' :
                             detailRequest.status === 'completed' ? 'var(--color-success)' :
                             detailRequest.status === 'rejected' ? 'var(--color-danger)' : 'var(--color-text-muted)'
                    }}
                  >
                    {statusLabel(detailRequest.status)}
                  </span>
                </p>

                {detailRequest.cost_risk_preview && (
                  <div className="portal-preview-panel" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div className="portal-preview-eyebrow">Cost And Risk</div>
                        <strong className="portal-preview-value" style={{ fontSize: 18 }}>Approval Preview</strong>
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
                            The request did not trigger major risk heuristics, but approval should still validate ownership, rollout safety, and expected spend.
                          </p>
                        </article>
                      )}
                    </div>
                  </div>
                )}

                {canApproveOrReject(detailRequest.status) && (
                  <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

                {detailRequest.config && (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
                    <button
                      type="button"
                      onClick={() => setDetailConfigOpen((o) => !o)}
                      style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, cursor: 'pointer', color: 'var(--color-text)' }}
                    >
                      {detailConfigOpen ? '▼' : '▶'} Configuration (JSON, secrets masked)
                    </button>
                    {detailConfigOpen && (
                      <pre style={{ marginTop: 8, padding: 12, background: 'var(--color-bg)', borderRadius: 8, overflow: 'auto', fontSize: 12, maxHeight: 280 }}>
                        {detailRequest.config}
                      </pre>
                    )}
                  </div>
                )}

                {showConfigHistory && detailRequest && (
                  <div style={{ marginTop: 16, padding: 12, background: 'var(--color-bg)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <strong>Config history (rollback)</strong>
                      <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { setShowConfigHistory(false); setConfigHistory([]); }}>
                        Close
                      </button>
                    </div>
                    {configHistory.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No config snapshots yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                        {configHistory.map((h) => (
                          <div key={h.id} style={{ padding: 8, background: 'var(--color-bg)', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                #{h.id} · {h.note || 'snapshot'} · {new Date(h.created_at).toLocaleString()}
                              </span>
                              <button
                                type="button"
                                className="btn btn-primary"
                                style={{ padding: '4px 10px', fontSize: 12 }}
                                disabled={rollbackingId !== null}
                                onClick={() => handleRollback(detailRequest.id, h.id)}
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

                <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => setDetailTerraformOpen((o) => !o)}
                    style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, cursor: 'pointer', color: 'var(--color-text)' }}
                  >
                    {detailTerraformOpen ? '▼' : '▶'} Terraform plan / output
                  </button>
                  {detailTerraformOpen && (
                    <div style={{ marginTop: 8 }}>
                      {detailRequest.terraform_plan_output ? (
                        <>
                          <pre style={{ padding: 12, background: 'var(--color-bg)', borderRadius: 8, overflow: 'auto', fontSize: 12, maxHeight: 200, whiteSpace: 'pre-wrap' }}>
                            {detailRequest.terraform_plan_output}
                          </pre>
                          <textarea
                            value={terraformOutputEdit}
                            onChange={(e) => setTerraformOutputEdit(e.target.value)}
                            placeholder="Paste Terraform plan or apply output from CI..."
                            style={{ width: '100%', minHeight: 100, marginTop: 8, padding: 12, borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}
                          />
                          <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} disabled={terraformSaving} onClick={saveTerraformOutput}>
                            {terraformSaving ? 'Saving…' : 'Update output'}
                          </button>
                        </>
                      ) : (
                        <>
                          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 8 }}>No Terraform output yet. Paste from CI or manual run.</p>
                          <textarea
                            value={terraformOutputEdit}
                            onChange={(e) => setTerraformOutputEdit(e.target.value)}
                            placeholder="Paste Terraform plan or apply output..."
                            style={{ width: '100%', minHeight: 100, padding: 12, borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}
                          />
                          <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} disabled={terraformSaving || !terraformOutputEdit.trim()} onClick={saveTerraformOutput}>
                            {terraformSaving ? 'Saving…' : 'Save output'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 16 }}>
                  <strong>Audit trail</strong>
                  <div style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto' }}>
                    {timeline.length === 0 ? (
                      <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>No activity yet.</p>
                    ) : (
                      timeline.map((e) => (
                        <div key={`${e.kind}-${e.id}`} style={{ marginBottom: 8, padding: '6px 10px', background: 'var(--color-bg)', borderRadius: 6, fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>{e.username || 'System'}</span>
                          <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>
                            {({ request_create: 'created', request_submit: 'submitted', request_approve: 'approved', request_reject: 'rejected', request_comment: 'commented', request_clone: 'cloned', request_resubmit: 'resubmitted', request_cancel: 'cancelled', request_promote: 'promoted', request_plan_output: 'updated plan', request_reassign: 'reassigned', request_approved_by_manager: 'approved (manager)' } as Record<string, string>)[e.action] || e.action.replace(/_/g, ' ')}
                          </span>
                          {e.details && <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}> - {e.details}</span>}
                          {e.body && <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{e.body}</p>}
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{new Date(e.created_at).toLocaleString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 16 }}>
                  <strong>Comments</strong>
                  <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                    {detailComments.length === 0 ? (
                      <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>No comments yet.</p>
                    ) : (
                      detailComments.map((c) => (
                        <div key={c.id} style={{ marginBottom: 12, padding: 8, background: 'var(--color-bg)', borderRadius: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{c.username || 'User'}</span>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 }}>{new Date(c.created_at).toLocaleString()}</span>
                          <p style={{ margin: '4px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Add a comment..."
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addComment())}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)' }}
                    />
                    <button type="button" className="btn btn-primary" disabled={!commentBody.trim() || commentSubmitting} onClick={addComment} style={{ padding: '8px 16px' }}>
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
