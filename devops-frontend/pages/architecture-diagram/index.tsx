import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRecord, getString } from '../../lib/payload';
import {
  ArchitectureDiagramJob,
  componentKindLabel,
  normalizeJob,
} from '../../lib/architectureDiagram';

const DEVOPS_TOKEN_KEY = 'devops_token';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

export default function ArchitectureDiagramList() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [jobs, setJobs] = useState<ArchitectureDiagramJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    void fetchJobs();
  }, [router]);

  const fetchJobs = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      if (!token || token === 'undefined') {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok) {
        const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];
        setJobs(rawJobs.map(normalizeJob).filter((j): j is ArchitectureDiagramJob => Boolean(j)));
      } else {
        setJobs([]);
        setError(getString(data.error, 'Failed to load jobs'));
      }
    } catch {
      setJobs([]);
      setError('Failed to load jobs. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this architecture diagram job and its generated Terraform?')) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setJobs((list) => list.filter((j) => j.id !== id));
      } else {
        alert('Failed to delete job');
      }
    } catch {
      alert('Failed to delete job');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => {
      const haystack = `${j.project_name} ${j.environment} ${j.cloud} ${j.notes} ${j.detected_components
        .map((c) => c.kind)
        .join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [jobs, search]);

  return (
    <>
      <Head>
        <title>Architecture Diagram → Infra Generator - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">AI Infra Generator</span>
              <h1 className="portal-page__title">Architecture Diagram → Infra Generator</h1>
              <p className="portal-page__subtitle">
                Upload a Draw.io or PNG architecture diagram. SetuOps detects common building blocks
                (VPC, load balancer, database, cache, queue, storage) and produces wired-up Terraform
                code you can apply.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/architecture-diagram/new" className="btn btn-primary">
                New diagram
              </Link>
            </div>
          </div>

          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Generated Jobs</span>
                <h2 className="portal-surface__title">Diagram history</h2>
                <p className="portal-surface__subtitle">
                  Re-open any entry to review the detected components and download the generated
                  Terraform plan.
                </p>
              </div>
            </div>

            <div className="template-browser-filter">
              <label className="template-browser-filter__search">
                <span className="template-browser-filter__label">Search</span>
                <input
                  className="input template-browser-filter__input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search project, env, cloud, or component"
                />
              </label>
            </div>

            {loading ? (
              <div className="portal-empty">
                <p>Loading jobs...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="portal-empty">
                <p>
                  {jobs.length === 0
                    ? 'No diagrams generated yet. Click “New diagram” to upload one.'
                    : 'No jobs match the current search.'}
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Env</th>
                      <th>Cloud</th>
                      <th>Components</th>
                      <th>Due</th>
                      <th>Created</th>
                      <th>By</th>
                      <th style={{ width: 140 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <Link href={`/architecture-diagram/${job.id}`} className="portal-link">
                            {job.project_name}
                          </Link>
                          <div className="template-tree__meta">{job.image_filename}</div>
                        </td>
                        <td>
                          <span className="portal-pill">{job.environment}</span>
                        </td>
                        <td>
                          <span className="portal-pill">{job.cloud.toUpperCase()}</span>
                        </td>
                        <td>
                          <div className="portal-pill-row">
                            {job.detected_components.slice(0, 4).map((c) => (
                              <span key={`${c.kind}-${c.name}`} className="portal-pill">
                                {componentKindLabel(c.kind)}
                              </span>
                            ))}
                            {job.detected_components.length > 4 ? (
                              <span className="portal-pill">
                                +{job.detected_components.length - 4}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>{formatDate(job.due_date)}</td>
                        <td>{formatDate(job.created_at)}</td>
                        <td>{job.created_by_username || '—'}</td>
                        <td>
                          <div className="portal-pill-row" style={{ gap: 8 }}>
                            <Link href={`/architecture-diagram/${job.id}`} className="btn btn-secondary btn-sm">
                              Open
                            </Link>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleDelete(job.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
