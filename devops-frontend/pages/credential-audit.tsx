import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface CredentialAuditEntry {
  id: number;
  request_id?: number;
  cloud: string;
  credential_type: string;
  team: string;
  env: string;
  created_by_user_id?: number;
  created_by_username?: string;
  approved_by_user_id?: number;
  approved_by_username?: string;
  created_at: string;
}

const CLOUD_BADGES: Record<string, { bg: string; color: string }> = {
  AWS: { bg: '#ea580c', color: '#fff' },
  GCP: { bg: '#2563eb', color: '#fff' },
  Azure: { bg: '#0078d4', color: '#fff' },
};

export default function CredentialAuditPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [entries, setEntries] = useState<CredentialAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cloudFilter, setCloudFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchEntries = useCallback(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (cloudFilter) params.set('cloud', cloudFilter);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    fetch(`${apiUrl}/api/devops/credential-audit?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.entries) setEntries(data.entries);
        else if (data?.error) setError(data.error);
      })
      .catch(() => setError('Failed to load credential audit'))
      .finally(() => setLoading(false));
  }, [router, apiUrl, cloudFilter, fromDate, toDate]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <>
      <Head>
        <title>Credential Audit - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container">
          <div className="credential-audit-header">
            <div>
              <h1 className="credential-audit-title">Credential Audit</h1>
              <p className="credential-audit-subtitle">
                Track who created AWS access keys, GCP service account keys, and other cloud credentials via approved requests
              </p>
            </div>
          </div>

          <div className="card credential-audit-filters">
            <h3 className="credential-audit-filters-title">Filters</h3>
            <div className="credential-audit-filters-row">
              <div>
                <label className="credential-audit-label">Cloud</label>
                <select
                  value={cloudFilter}
                  onChange={(e) => setCloudFilter(e.target.value)}
                  className="input"
                  style={{ width: 'auto', minWidth: 120 }}
                >
                  <option value="">All</option>
                  <option value="AWS">AWS</option>
                  <option value="GCP">GCP</option>
                  <option value="Azure">Azure</option>
                </select>
              </div>
              <div>
                <label className="credential-audit-label">From date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="input"
                  style={{ width: 'auto' }}
                />
              </div>
              <div>
                <label className="credential-audit-label">To date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="input"
                  style={{ width: 'auto' }}
                />
              </div>
              <button type="button" className="btn btn-secondary" onClick={fetchEntries}>
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-error">{error}</div>
          )}

          {loading ? (
            <div className="credential-audit-loading">
              <p>Loading credential audit…</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <p>No credential audit entries yet.</p>
                <p style={{ marginTop: 8, fontSize: 14, color: 'var(--color-text-muted)' }}>
                  Entries are created when requests containing AWS IAM access keys, GCP service account keys, or similar resources are approved.
                </p>
              </div>
            </div>
          ) : (
            <div className="card credential-audit-table-card">
              <div className="table-wrap">
                <table className="credential-audit-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Cloud</th>
                      <th>Credential type</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Request author</th>
                      <th>Approved by</th>
                      <th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const cloudStyle = CLOUD_BADGES[e.cloud] || { bg: 'var(--color-primary)', color: '#fff' };
                      return (
                        <tr key={e.id}>
                          <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 13 }}>
                            {new Date(e.created_at).toLocaleString()}
                          </td>
                          <td>
                            <span
                              className="credential-audit-cloud-badge"
                              style={{ background: cloudStyle.bg, color: cloudStyle.color }}
                            >
                              {e.cloud}
                            </span>
                          </td>
                          <td>{e.credential_type}</td>
                          <td>{e.team || '—'}</td>
                          <td>{e.env || '—'}</td>
                          <td>{e.created_by_username || '—'}</td>
                          <td>{e.approved_by_username || '—'}</td>
                          <td>
                            {e.request_id ? (
                              <Link href={`/tickets`} className="credential-audit-link" title="View in All tickets">
                                #{e.request_id}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
