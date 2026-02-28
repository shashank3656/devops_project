import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

const riskColor = (r: string) =>
  ({ low: '#00FF9F', medium: '#FFD700', high: '#FF6B35', critical: '#FF1744' }[r?.toLowerCase() || ''] || '#888');
const riskBg = (r: string) =>
  ({ low: '#00FF9F18', medium: '#FFD70018', high: '#FF6B3518', critical: '#FF174418' }[r?.toLowerCase() || ''] || '#88888818');
const statusColor = (s: string) =>
  ({
    pending_approval: '#FFD700',
    pending_devops_approval: '#FFD700',
    pending_user_manager_approval: '#FFD700',
    in_progress: '#00D9FF',
    completed: '#00FF9F',
    rejected: '#FF4D8B',
  }[s] || '#888');

interface RequestRow {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  created_at: string;
  created_by_username?: string;
  application_id?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString();
}

function getRiskFromPriority(p: string): string {
  if (p === 'critical') return 'high';
  if (p === 'high') return 'high';
  if (p === 'medium') return 'medium';
  return 'low';
}

export default function ApprovalsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'DENIED'>('PENDING');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [actioning, setActioning] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (filter === 'PENDING') {
      params.set('status', 'pending_devops_approval');
    } else if (filter === 'APPROVED') {
      params.set('status', 'completed');
    } else if (filter === 'DENIED') {
      params.set('status', 'rejected');
    }
    params.set('limit', '50');
    fetch(`${apiUrl}/api/devops/requests?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data?.requests) setRequests(data.requests);
      })
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [token, router, apiUrl, filter]);

  const handleApproval = async (id: number, action: 'approve' | 'reject') => {
    if (!token || actioning) return;
    setActioning(true);
    try {
      const res = await fetch(`${apiUrl}/api/devops/requests/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: action === 'reject' ? JSON.stringify({ reason: 'Denied from DevOps portal' }) : undefined,
      });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== id));
        setSelectedId(null);
        window.dispatchEvent(new Event('devops-notifications-refresh'));
      }
    } catch (_) {}
    setActioning(false);
  };

  const pendingCount = requests.filter(
    (r) =>
      r.status === 'pending_approval' ||
      r.status === 'pending_devops_approval' ||
      r.status === 'pending_user_manager_approval'
  ).length;

  return (
    <DevOpsLayout>
      <Head>
        <title>Approval Queue - InfraGate DevOps</title>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Orbitron:wght@600;700;900&display=swap"
          rel="stylesheet"
        />
      </Head>
      <div className="approvals-page">
        <style jsx>{`
          .approvals-page {
            font-family: 'JetBrains Mono', 'Fira Code', monospace;
            color: #c8d6e5;
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .approvals-header {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .approvals-title {
            font-family: 'Orbitron', monospace;
            font-size: 16px;
            color: #00ff9f;
            letter-spacing: 0.1em;
          }
          .approvals-desc {
            font-size: 11px;
            color: #3a6a8a;
          }
          .approvals-filters {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }
          .approvals-filter-btn {
            background: #0d1420;
            border: 1px solid #1e3a5f;
            color: #4a7fa5;
            padding: 5px 14px;
            font-size: 10px;
            border-radius: 20px;
            font-family: inherit;
            letter-spacing: 0.1em;
            cursor: pointer;
          }
          .approvals-filter-btn:hover {
            filter: brightness(1.2);
          }
          .approvals-filter-btn.active {
            background: #0d1e35;
            border-color: #00ff9f;
            color: #00ff9f;
          }
          .approvals-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .approvals-row {
            background: #060c18;
            border: 1px solid #0d2040;
            border-radius: 8px;
            padding: 12px 16px;
            cursor: pointer;
            transition: all 0.15s;
          }
          .approvals-row:hover {
            background: #0d1420;
          }
          .approvals-row.selected {
            border-color: rgba(0, 255, 159, 0.4);
          }
          .approvals-row-line {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }
          .approvals-row-expand {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #0d2040;
            animation: fadeUp 0.2s ease;
          }
          @keyframes fadeUp {
            from {
              transform: translateY(8px);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
          .approvals-expand-label {
            font-size: 9px;
            color: #2a4a6a;
            letter-spacing: 0.15em;
            margin-bottom: 4px;
          }
          .approvals-expand-value {
            font-size: 11px;
            color: #c8d6e5;
          }
          .approvals-actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
            flex-wrap: wrap;
          }
          .approvals-action-btn {
            padding: 7px 20px;
            font-size: 11px;
            border-radius: 5px;
            font-family: inherit;
            letter-spacing: 0.05em;
            cursor: pointer;
            border: 1px solid;
          }
          .approvals-action-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .approvals-action-btn--approve {
            background: #001a0a;
            border-color: #00ff9f;
            color: #00ff9f;
          }
          .approvals-action-btn--deny {
            background: #1a0008;
            border-color: #ff4d8b;
            color: #ff4d8b;
          }
          .approvals-action-btn--info {
            background: #0d1420;
            border-color: #1e3a5f;
            color: #4a7fa5;
          }
        `}</style>

        <div className="approvals-header">
          <div className="approvals-title">APPROVAL QUEUE</div>
          <div className="approvals-desc">
            Review and act on pending infrastructure requests
          </div>
        </div>

        <div className="approvals-filters">
          {(['ALL', 'PENDING', 'APPROVED', 'DENIED'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`approvals-filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#4a7fa5' }}>Loading…</div>
        )}

        {!loading && (
          <div className="approvals-list">
            {requests.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#3a6a8a' }}>
                No requests in this category
              </div>
            ) : (
              requests.map((req) => {
                const risk = getRiskFromPriority(req.priority);
                const isPending =
                  req.status === 'pending_approval' ||
                  req.status === 'pending_devops_approval' ||
                  req.status === 'pending_user_manager_approval';
                return (
                  <div
                    key={req.id}
                    className={`approvals-row ${selectedId === req.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(selectedId === req.id ? null : req.id)}
                  >
                    <div className="approvals-row-line">
                      <span style={{ fontSize: 10, color: '#2a4a6a', minWidth: 70 }}>
                        REQ-{req.id}
                      </span>
                      <span
                        style={{
                          background: riskBg(risk),
                          border: `1px solid ${riskColor(risk)}50`,
                          color: riskColor(risk),
                          padding: '2px 8px',
                          borderRadius: 20,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.1em',
                          minWidth: 60,
                          textAlign: 'center',
                        }}
                      >
                        {risk.toUpperCase()}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: '#7aabcc',
                          background: '#0d1420',
                          padding: '2px 8px',
                          borderRadius: 3,
                        }}
                      >
                        {req.cloud} {req.service}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: '#c8d6e5',
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {req.team} / {req.env}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: statusColor(req.status),
                          minWidth: 90,
                          textAlign: 'right',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {req.status === 'pending_devops_approval'
                          ? 'PENDING'
                          : req.status === 'completed'
                          ? 'APPROVED'
                          : req.status === 'rejected'
                          ? 'DENIED'
                          : req.status.toUpperCase()}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: '#2a4a6a',
                          minWidth: 70,
                          textAlign: 'right',
                        }}
                      >
                        {formatTime(req.created_at)}
                      </span>
                    </div>

                    {selectedId === req.id && (
                      <div className="approvals-row-expand">
                        <div style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
                          <div>
                            <div className="approvals-expand-label">REQUESTER</div>
                            <div className="approvals-expand-value">
                              {req.created_by_username || '—'}
                            </div>
                          </div>
                          <div>
                            <div className="approvals-expand-label">TARGET</div>
                            <div className="approvals-expand-value">
                              {req.cloud} {req.service} ({req.env})
                            </div>
                          </div>
                          <div>
                            <div className="approvals-expand-label">TEAM</div>
                            <div className="approvals-expand-value">{req.team}</div>
                          </div>
                        </div>
                        <div
                          style={{
                            background: riskBg(risk),
                            border: `1px solid ${riskColor(risk)}30`,
                            borderRadius: 4,
                            padding: '8px 12px',
                            marginBottom: 12,
                            fontSize: 11,
                            color: '#c8d6e5',
                          }}
                        >
                          {req.priority && `Priority: ${req.priority}`} — Request #{req.id} for{' '}
                          {req.cloud} {req.service}
                        </div>
                        {isPending && (
                          <div className="approvals-actions">
                            <button
                              type="button"
                              className="approvals-action-btn approvals-action-btn--approve"
                              disabled={actioning}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApproval(req.id, 'approve');
                              }}
                            >
                              ✓ Approve & Execute
                            </button>
                            <button
                              type="button"
                              className="approvals-action-btn approvals-action-btn--deny"
                              disabled={actioning}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApproval(req.id, 'reject');
                              }}
                            >
                              ✗ Deny
                            </button>
                            <a
                              href={`/tickets?id=${req.id}`}
                              className="approvals-action-btn approvals-action-btn--info"
                              style={{ textDecoration: 'none' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              View full details
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </DevOpsLayout>
  );
}
