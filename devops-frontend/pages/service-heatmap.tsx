import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ServiceHeatmapRow {
  project_id: number;
  project_name: string;
  project_code: string;
  status: string;
  request_count: number;
  pending_count: number;
  service_counts: Record<string, number>;
}

interface ServiceHeatmap {
  columns: string[];
  rows: ServiceHeatmapRow[];
  cloud_totals: Record<string, number>;
  service_totals: Record<string, number>;
}

function normalizeHeatmap(value: unknown): ServiceHeatmap | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    columns: Array.isArray(record.columns)
      ? record.columns.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    rows: Array.isArray(record.rows)
      ? record.rows.map((row) => {
          const item = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
          return {
            project_id: typeof item.project_id === 'number' ? item.project_id : 0,
            project_name: typeof item.project_name === 'string' ? item.project_name : 'Unknown project',
            project_code: typeof item.project_code === 'string' ? item.project_code : 'n/a',
            status: typeof item.status === 'string' ? item.status : 'unknown',
            request_count: typeof item.request_count === 'number' ? item.request_count : 0,
            pending_count: typeof item.pending_count === 'number' ? item.pending_count : 0,
            service_counts: item.service_counts && typeof item.service_counts === 'object'
              ? (item.service_counts as Record<string, number>)
              : {},
          };
        })
      : [],
    cloud_totals: record.cloud_totals && typeof record.cloud_totals === 'object' ? (record.cloud_totals as Record<string, number>) : {},
    service_totals: record.service_totals && typeof record.service_totals === 'object' ? (record.service_totals as Record<string, number>) : {},
  };
}

function intensityClass(value: number): string {
  if (value >= 6) return 'portal-pill';
  if (value >= 3) return 'btn btn-secondary btn-sm';
  return 'btn btn-secondary btn-sm';
}

export default function DevOpsServiceHeatmapPage() {
  const apiUrl = useApiUrl();
  const [heatmap, setHeatmap] = useState<ServiceHeatmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    window.location.assign('/login');
  };

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    fetch(`${apiUrl}/api/devops/service-heatmap`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(data.error, 'Failed to load service heatmap'));
        }
        return data;
      })
      .then((data) => {
        const nextHeatmap = normalizeHeatmap(asRecord(data).heatmap);
        if (nextHeatmap) setHeatmap(nextHeatmap);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const topServiceColumns = useMemo(() => (heatmap?.columns || []).slice(0, 10), [heatmap]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Service Heatmap - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Usage</span>
            <h1 className="portal-page__title">Service Usage Heatmap</h1>
            <p className="portal-page__subtitle">See which projects are driving the highest service demand across clouds and request volume.</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/project-operations" className="btn btn-secondary">Project operations</Link>
            <Link href="/projects" className="btn btn-primary">Projects</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading service heatmap...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && !heatmap ? (
          <div className="empty-state">
            <p>No usage heatmap yet. Demand appears after projects have requests. Empty is Unknown, not zero usage.</p>
            <Link href="/projects/new" className="btn btn-primary btn-sm">Onboard a project</Link>
          </div>
        ) : null}
        {!loading && !error && heatmap ? (
          <>
            <section className="portal-surface" style={{ marginBottom: 24 }}>
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Cloud demand</span>
                  <h2 className="portal-surface__title">Cloud totals</h2>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {Object.entries(heatmap.cloud_totals).map(([cloud, total]) => (
                  <span key={cloud} className="portal-pill">{cloud}: {total}</span>
                ))}
              </div>
            </section>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Heatmap</span>
                  <h2 className="portal-surface__title">Project x service usage</h2>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Requests</th>
                      <th>Pending</th>
                      {topServiceColumns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmap.rows.map((row) => (
                      <tr key={`heatmap-${row.project_id}`}>
                        <td>
                          <strong>{row.project_name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{row.project_code}</div>
                        </td>
                        <td>{row.status}</td>
                        <td>{row.request_count}</td>
                        <td>{row.pending_count}</td>
                        {topServiceColumns.map((column) => (
                          <td key={`${row.project_id}-${column}`}>
                            <span className={intensityClass(row.service_counts?.[column] || 0)}>
                              {row.service_counts?.[column] || 0}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
