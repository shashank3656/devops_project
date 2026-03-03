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
  project_id?: number;
  project_name?: string;
  project_code?: string;
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

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cloudFilter, setCloudFilter] = useState('');
  const [projectId, setProjectId] = useState('');
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
    if (projectId) params.set('project_id', projectId);
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
  }, [router, apiUrl, cloudFilter, projectId, fromDate, toDate]);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProjects(Array.isArray(data?.projects) ? data.projects : []))
      .catch(() => setProjects([]));
  }, [apiUrl]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const exportCsv = () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (cloudFilter) params.set('cloud', cloudFilter);
    if (projectId) params.set('project_id', projectId);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    fetch(`${apiUrl}/api/devops/credential-audit?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.text())
      .then((csv) => {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `credential-audit-${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
  };

  return (
    <>
      <Head>
        <title>Credential Audit - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Credential Audit</span>
              <h1 className="portal-page__title">Credential Audit</h1>
              <p className="portal-page__subtitle">
                Existing audit features remain unchanged, but the page now uses a clearer filtering and evidence-review pattern.
              </p>
            </div>
          </header>

          <section className="portal-stat-grid">
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Entries</span>
              <strong className="portal-stat-card__value">{entries.length}</strong>
              <p className="portal-stat-card__copy">Credential-related approvals currently in the visible audit window.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Cloud filter</span>
              <strong className="portal-stat-card__value">{cloudFilter || 'All'}</strong>
              <p className="portal-stat-card__copy">Cloud-specific audit slicing without changing backend behavior.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Project filter</span>
              <strong className="portal-stat-card__value">
                {projectId ? (projects.find((project) => String(project.id) === projectId)?.code || 'Scoped') : 'All'}
              </strong>
              <p className="portal-stat-card__copy">Project-scoped credential review for governance and evidence tracking.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Date range</span>
              <strong className="portal-stat-card__value">{fromDate || toDate ? 'Filtered' : 'Open'}</strong>
              <p className="portal-stat-card__copy">Time-bound review mode for access-key and service-account creation.</p>
            </article>
            <article className="portal-stat-card">
              <span className="portal-stat-card__label">Export</span>
              <strong className="portal-stat-card__value">CSV</strong>
              <p className="portal-stat-card__copy">One-click export is preserved for handoff and governance workflows.</p>
            </article>
          </section>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Filters</span>
                <h2 className="portal-surface__title">Scope the evidence</h2>
                <p className="portal-surface__subtitle">
                  Track who created AWS access keys, GCP service account keys, and similar credentials via approved requests.
                </p>
              </div>
            </div>

            <div className="portal-toolbar">
              <div className="portal-toolbar__group">
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label">Cloud</label>
                  <select value={cloudFilter} onChange={(event) => setCloudFilter(event.target.value)} className="input">
                    <option value="">All</option>
                    <option value="AWS">AWS</option>
                    <option value="GCP">GCP</option>
                    <option value="Azure">Azure</option>
                  </select>
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label">Project</label>
                  <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="input">
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}{project.code ? ` (${project.code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label">From date</label>
                  <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="input" />
                </div>
                <div className="portal-toolbar__item">
                  <label className="credential-audit-label">To date</label>
                  <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="input" />
                </div>
              </div>
              <div className="portal-page__actions">
                <button type="button" className="btn btn-secondary" onClick={fetchEntries}>
                  Refresh
                </button>
                <button type="button" className="btn btn-primary" onClick={exportCsv}>
                  Export CSV
                </button>
              </div>
            </div>
          </section>

          {error && <div className="alert alert-error">{error}</div>}

          {loading ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>Loading credential audit...</p>
              </div>
            </section>
          ) : entries.length === 0 ? (
            <section className="portal-surface">
              <div className="portal-empty">
                <p>No credential audit entries yet.</p>
              </div>
            </section>
          ) : (
            <section className="portal-surface portal-surface--table">
              <div className="table-wrap">
                <table className="credential-audit-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Cloud</th>
                      <th>Project</th>
                      <th>Credential type</th>
                      <th>Team</th>
                      <th>Env</th>
                      <th>Request author</th>
                      <th>Approved by</th>
                      <th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const cloudStyle = CLOUD_BADGES[entry.cloud] || { bg: 'var(--color-primary)', color: '#fff' };
                      return (
                        <tr key={entry.id}>
                          <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 13 }}>
                            {new Date(entry.created_at).toLocaleString()}
                          </td>
                          <td>
                            <span className="credential-audit-cloud-badge" style={{ background: cloudStyle.bg, color: cloudStyle.color }}>
                              {entry.cloud}
                            </span>
                          </td>
                          <td>
                            {entry.project_name ? (
                              <div>
                                <strong>{entry.project_name}</strong>
                                {entry.project_code ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{entry.project_code}</div> : null}
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>{entry.credential_type}</td>
                          <td>{entry.team || '-'}</td>
                          <td>{entry.env || '-'}</td>
                          <td>{entry.created_by_username || '-'}</td>
                          <td>{entry.approved_by_username || '-'}</td>
                          <td>
                            {entry.request_id ? (
                              <Link
                                href={`/tickets?id=${entry.request_id}${entry.project_id ? `&project_id=${entry.project_id}` : ''}`}
                                className="credential-audit-link"
                                title="View in Tickets"
                              >
                                #{entry.request_id}
                              </Link>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
