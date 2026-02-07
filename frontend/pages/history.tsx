import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';

import { maskSensitiveJson } from '../lib/maskSensitive';

const TEMPLATE_KEY = 'infra-request-template';

interface PRRequest {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
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
  config?: string;
}

interface RequestComment {
  id: number;
  request_id: number;
  user_id: number;
  username: string;
  body: string;
  created_at: string;
}

const PAGE_SIZE = 10;

export default function History() {
  const router = useRouter();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<'team' | 'pr_number' | 'env' | 'cloud' | 'search'>('team');
  const [filterValue, setFilterValue] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [detailRequest, setDetailRequest] = useState<PRRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [compareWithId, setCompareWithId] = useState('');
  const [diffResult, setDiffResult] = useState<{ base: any; compare: any; changes: any[] } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [sortBy, setSortBy] = useState<'id' | 'created_at' | 'team' | 'cloud' | 'priority' | 'due_date'>('created_at');
  const [sortDesc, setSortDesc] = useState(true);
  const rawConfigByRequestId = useRef<Record<number, string>>({});

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    // Check authentication
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    fetchHistory();
  }, [filterType, filterValue, page]);

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
        } else {
          params.append(filterType, filterValue.trim());
        }
      }
      params.append('limit', String(PAGE_SIZE));
      params.append('offset', String(page * PAGE_SIZE));

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
    setComments([]);
    setTags([]);
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
        if (full.config) {
          rawConfigByRequestId.current[full.id] = full.config;
          setDetailRequest({ ...full, config: maskSensitiveJson(full.config) });
        } else {
          setDetailRequest(full);
        }
      } else {
        setDetailRequest(req);
      }
      if (commentsRes.ok) {
        const cData = await commentsRes.json();
        setComments(cData.comments || []);
      }
      if (tagsRes.ok) {
        const tData = await tagsRes.json();
        setTags(tData.tags || []);
      }
    } catch (_) {
      setDetailRequest(req);
    } finally {
      setDetailLoading(false);
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

  const exportCSV = () => {
    const headers = ['ID', 'Team', 'Environment', 'Cloud', 'Service', 'Status', 'Branch', 'PR URL', 'Created At'];
    const rows = [...requests].sort((a, b) => {
      const aVal = sortBy === 'created_at' ? new Date(a.created_at).getTime() : (a as any)[sortBy];
      const bVal = sortBy === 'created_at' ? new Date(b.created_at).getTime() : (b as any)[sortBy];
      return sortDesc ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1);
    }).map(r => [r.id, r.team, r.env, r.cloud, r.service, r.status, r.branch, r.pr_url, formatDate(r.created_at)].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pr-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported successfully', 'success');
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

  const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
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

  return (
    <>
      <Head>
        <title>History - Infrastructure Portal</title>
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '32px'
          }}>
            <h1 style={{ 
              fontSize: '36px', 
              fontWeight: 'bold',
              color: 'var(--text-primary)',
              margin: 0
            }}>
              PR Request History
            </h1>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button onClick={handleRefresh} className="btn btn-secondary" disabled={loading} title="Refresh">
                🔄 Refresh
              </button>
              <button onClick={exportCSV} className="btn btn-secondary" disabled={requests.length === 0}>
                📥 Export CSV
              </button>
            </div>
          </div>

          {/* Single Filter Box */}
          <div className="card" style={{ marginBottom: '24px', padding: '24px' }}>
            <h3 style={{ marginBottom: '20px', fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)' }}>
              Filter Requests
            </h3>
            <div style={{ 
              display: 'flex', 
              gap: '12px', 
              alignItems: 'flex-end',
              flexWrap: 'wrap'
            }}>
              <div style={{ flex: '0 0 auto', minWidth: '180px' }}>
                <label htmlFor="filter-type" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  Filter By
                </label>
                <select
                  id="filter-type"
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value as 'team' | 'pr_number' | 'env' | 'cloud' | 'search');
                    setFilterValue(''); // Clear value when changing filter type
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '15px',
                    backgroundColor: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="team">Team</option>
                  <option value="pr_number">PR Number</option>
                  <option value="env">Environment</option>
                  <option value="cloud">Cloud</option>
                  <option value="search">Search (all fields)</option>
                </select>
              </div>
              <div style={{ flex: '1 1 300px', minWidth: '250px' }}>
                <label htmlFor="filter-value" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  {filterType === 'pr_number' ? 'PR Number' :
                   filterType === 'search' ? 'Search term' :
                   filterType === 'team' ? 'Team Name' :
                   filterType === 'env' ? 'Environment' : 'Cloud Provider'}
                </label>
                <input
                  id="filter-value"
                  type={filterType === 'pr_number' ? 'number' : 'text'}
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  placeholder={
                    filterType === 'pr_number' ? 'Enter PR number (e.g., 123)' :
                    filterType === 'search' ? 'Search team, env, cloud, service, branch, config…' :
                    filterType === 'team' ? 'Enter team name' :
                    filterType === 'env' ? 'Enter environment (dev, stage, prod)' :
                    'Enter cloud provider (AWS, GCP, Azure)'
                  }
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '15px'
                  }}
                />
              </div>
              <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '14px', fontWeight: '500' }}>Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', minWidth: '140px' }}
                >
                  <option value="created_at">Created (newest)</option>
                  <option value="id">PR #</option>
                  <option value="priority">Priority</option>
                  <option value="due_date">Due date</option>
                  <option value="team">Team</option>
                  <option value="cloud">Cloud</option>
                </select>
                <button
                  type="button"
                  onClick={() => setSortDesc((d) => !d)}
                  className="btn btn-secondary"
                  style={{ padding: '10px 14px' }}
                  title={sortDesc ? 'Descending' : 'Ascending'}
                >
                  {sortDesc ? '↓' : '↑'}
                </button>
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <button
                  onClick={() => {
                    setFilterValue('');
                    fetchHistory();
                  }}
                  className="btn btn-secondary"
                  style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ overflowX: 'auto', padding: '0' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{ 
                  display: 'inline-block',
                  width: '40px',
                  height: '40px',
                  border: '4px solid var(--border-color)',
                  borderTop: '4px solid var(--primary-color)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  marginBottom: '16px'
                }}></div>
                <p style={{ color: 'var(--text-secondary)' }}>Loading requests...</p>
              </div>
            ) : error ? (
              <div className="error" style={{ margin: '24px', padding: '16px', borderRadius: '8px' }}>
                <strong>Error:</strong> {error}
              </div>
            ) : requests.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>
                  {filterValue ? 'No PR requests found matching your filter' : 'No requests yet'}
                </p>
                {!filterValue && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '8px' }}>
                    Create your first request from Custom JSON or Select Service.
                  </p>
                )}
                {filterValue ? (
                  <button
                    onClick={() => {
                      setFilterValue('');
                      fetchHistory();
                    }}
                    className="btn btn-secondary"
                    style={{ marginTop: '16px' }}
                  >
                    Clear Filter
                  </button>
                ) : (
                  <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
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
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse',
                  minWidth: '800px'
                }}>
                  <thead>
                    <tr style={{ 
                      borderBottom: '2px solid var(--border-color)',
                      background: 'var(--bg-gray-50)'
                    }}>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>PR #</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Team</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Environment</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Cloud</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Service</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Status</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>Created</th>
                      <th style={{ 
                        padding: '16px', 
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>PR Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRequests.map((req, index) => (
                      <tr 
                        key={req.id} 
                        onClick={() => openDetail(req)}
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          transition: 'background 0.2s ease',
                          background: index % 2 === 0 ? 'white' : 'var(--bg-gray-50)',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bg-gray-100)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = index % 2 === 0 ? 'white' : 'var(--bg-gray-50)';
                        }}
                      >
                        <td style={{ padding: '16px', fontWeight: '600', color: 'var(--primary-color)' }}>
                          #{req.id}
                        </td>
                        <td style={{ padding: '16px' }}>{req.team}</td>
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
                                       req.status === 'pending_approval' ? 'var(--warning-bg)' :
                                       req.status === 'in_progress' ? 'var(--info-bg)' :
                                       req.status === 'completed' ? 'var(--success-bg)' :
                                       req.status === 'rejected' ? 'var(--error-bg)' :
                                       req.status === 'pending' ? 'var(--warning-bg)' :
                                       req.status === 'merged' ? 'var(--success-bg)' :
                                       req.status === 'closed' ? 'var(--error-bg)' : 'var(--info-bg)',
                            color: req.status === 'draft' ? 'var(--text-secondary)' :
                                   req.status === 'pending_approval' ? 'var(--warning-color)' :
                                   req.status === 'in_progress' ? 'var(--info-color)' :
                                   req.status === 'completed' ? 'var(--success-color)' :
                                   req.status === 'rejected' ? 'var(--error-color)' :
                                   req.status === 'pending' ? 'var(--warning-color)' :
                                   req.status === 'merged' ? 'var(--success-color)' :
                                   req.status === 'closed' ? 'var(--error-color)' : 'var(--info-color)'
                          }}>
                            {req.status === 'draft' ? 'Draft' :
                             req.status === 'pending_approval' ? 'Pending approval' :
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
                  maxWidth: '600px',
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
                      <h3 style={{ margin: 0 }}>Request #{detailRequest.id}</h3>
                      <button onClick={() => setDetailRequest(null)} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
                        Close
                      </button>
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <strong>Team:</strong> {detailRequest.team} &nbsp;|&nbsp; <strong>Env:</strong> {detailRequest.env} &nbsp;|&nbsp; <strong>Cloud:</strong> {detailRequest.cloud} &nbsp;|&nbsp; <strong>Service:</strong> {detailRequest.service}
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
                                   detailRequest.status === 'pending_approval' ? 'var(--warning-bg)' :
                                   detailRequest.status === 'in_progress' ? 'var(--info-bg)' :
                                   detailRequest.status === 'completed' ? 'var(--success-bg)' :
                                   detailRequest.status === 'rejected' ? 'var(--error-bg)' : 'var(--info-bg)',
                        color: detailRequest.status === 'draft' ? 'var(--text-secondary)' :
                               detailRequest.status === 'pending_approval' ? 'var(--warning-color)' :
                               detailRequest.status === 'in_progress' ? 'var(--info-color)' :
                               detailRequest.status === 'completed' ? 'var(--success-color)' :
                               detailRequest.status === 'rejected' ? 'var(--error-color)' : 'var(--info-color)'
                      }}>
                        {detailRequest.status === 'draft' ? 'Draft' :
                         detailRequest.status === 'pending_approval' ? 'Pending approval' :
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
                      {detailRequest.status === 'rejected' && (
                        <button type="button" onClick={() => resubmitRequest(detailRequest.id)} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '14px' }}>
                          Resubmit as draft
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
      </div>
    </>
  );
}
