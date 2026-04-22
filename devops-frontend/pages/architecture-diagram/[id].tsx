import { useEffect, useState } from 'react';
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

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function ArchitectureDiagramJobDetail() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const { id, created } = router.query;
  const [job, setJob] = useState<ArchitectureDiagramJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    if (!id || typeof id !== 'string') return;
    void load(id);
  }, [id, router]);

  const load = async (jobId: string) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok && data.job) {
        const normalized = normalizeJob(data.job);
        setJob(normalized);
        if (normalized?.image_object_key) {
          void loadImage(jobId, token ?? '');
        }
      } else {
        setError(getString(data.error, 'Failed to load job'));
      }
    } catch {
      setError('Failed to load job');
    } finally {
      setLoading(false);
    }
  };

  const loadImage = async (jobId: string, token: string) => {
    setImageError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram/${jobId}/image`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setImageError(`Could not load diagram (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setImageSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch {
      setImageError('Failed to fetch stored diagram');
    }
  };

  useEffect(() => {
    return () => {
      if (imageSrc) URL.revokeObjectURL(imageSrc);
    };
  }, [imageSrc]);

  const copyTerraform = async () => {
    if (!job) return;
    try {
      await navigator.clipboard.writeText(job.terraform_code);
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 1800);
    } catch {
      setCopyLabel('Copy failed');
      setTimeout(() => setCopyLabel('Copy'), 1800);
    }
  };

  const downloadTerraform = () => {
    if (!job) return;
    const blob = new Blob([job.terraform_code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${job.project_name || 'architecture'}-${job.environment}-${job.cloud}.tf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!job) return;
    if (!confirm('Delete this generated Terraform and diagram record?')) return;
    try {
      const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram/${job.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        router.push('/architecture-diagram');
      } else {
        alert('Failed to delete');
      }
    } catch {
      alert('Failed to delete');
    }
  };

  return (
    <>
      <Head>
        <title>{job ? `${job.project_name} - Diagram` : 'Diagram job'} - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">AI Infra Generator</span>
              <h1 className="portal-page__title">
                {job ? job.project_name : 'Diagram job'}
              </h1>
              <p className="portal-page__subtitle">
                {job
                  ? `Environment ${job.environment} · ${job.cloud.toUpperCase()}${
                      job.region ? ` · ${job.region}` : ''
                    }`
                  : 'Loading generated Terraform...'}
              </p>
            </div>
            <div className="portal-page__actions" style={{ gap: 8 }}>
              <Link href="/architecture-diagram" className="btn btn-secondary">
                Back
              </Link>
              {job ? (
                <Link href={`/architecture-diagram/${job.id}/edit`} className="btn btn-secondary">
                  Edit
                </Link>
              ) : null}
              <Link href="/architecture-diagram/new" className="btn btn-primary">
                New diagram
              </Link>
            </div>
          </header>

          {created ? (
            <div className="alert alert-success" role="status">
              Terraform generated successfully. Review the detected components and copy the code below.
            </div>
          ) : null}

          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="portal-surface">
              <div className="portal-empty">
                <p>Loading job…</p>
              </div>
            </div>
          ) : job ? (
            <>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Metadata</span>
                    <h2 className="portal-surface__title">Project details</h2>
                  </div>
                </div>
                <div className="portal-field-grid portal-field-grid--two">
                  <div>
                    <div className="portal-help-text">Project</div>
                    <div>{job.project_name}</div>
                  </div>
                  <div>
                    <div className="portal-help-text">Environment</div>
                    <div>
                      <span className="portal-pill">{job.environment}</span>
                    </div>
                  </div>
                  <div>
                    <div className="portal-help-text">Cloud</div>
                    <div>
                      <span className="portal-pill">{job.cloud.toUpperCase()}</span>
                      {job.region ? (
                        <span className="portal-pill" style={{ marginLeft: 6 }}>
                          {job.region}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className="portal-help-text">Due date</div>
                    <div>{job.due_date || '—'}</div>
                  </div>
                  <div>
                    <div className="portal-help-text">Diagram</div>
                    <div>
                      {job.image_filename}{' '}
                      <span className="portal-help-text">({job.image_mime || 'unknown'})</span>
                    </div>
                  </div>
                  <div>
                    <div className="portal-help-text">Created</div>
                    <div>
                      {formatDateTime(job.created_at)}{' '}
                      {job.created_by_username ? (
                        <span className="portal-help-text">by {job.created_by_username}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                {job.notes ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="portal-help-text">Notes</div>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{job.notes}</p>
                  </div>
                ) : null}
                {job.image_object_key ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="portal-help-text">Stored diagram (Supabase {job.image_bucket || 'storage'})</div>
                    {imageSrc ? (
                      <div
                        style={{
                          marginTop: 8,
                          border: '1px solid var(--portal-border, #2a2f3a)',
                          borderRadius: 8,
                          padding: 8,
                          background: 'var(--portal-surface-sub, #11141a)',
                        }}
                      >
                        <img
                          src={imageSrc}
                          alt={`${job.project_name} diagram`}
                          style={{ maxWidth: '100%', maxHeight: 480, display: 'block', margin: '0 auto' }}
                        />
                      </div>
                    ) : imageError ? (
                      <p className="portal-help-text" style={{ marginTop: 4 }}>
                        {imageError}
                      </p>
                    ) : (
                      <p className="portal-help-text" style={{ marginTop: 4 }}>
                        Loading diagram from storage…
                      </p>
                    )}
                    <div className="portal-pill-row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
                      <span className="portal-pill">bucket: {job.image_bucket || '—'}</span>
                      <span className="portal-pill">key: {job.image_object_key}</span>
                      {job.image_url ? (
                        <a
                          href={job.image_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary btn-sm"
                        >
                          Open public URL
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Detection</span>
                    <h2 className="portal-surface__title">
                      Components found ({job.detected_components.length})
                    </h2>
                    <p className="portal-surface__subtitle">
                      Source: {job.detection_source || 'heuristic'}. These drive the generated
                      Terraform modules below.
                    </p>
                  </div>
                </div>
                {job.detected_components.length === 0 ? (
                  <div className="portal-empty">
                    <p>No components were detected.</p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="templates-table">
                      <thead>
                        <tr>
                          <th>Kind</th>
                          <th>Name</th>
                          <th>Label</th>
                          <th>Properties</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.detected_components.map((c) => (
                          <tr key={`${c.kind}-${c.name}`}>
                            <td>
                              <span className="portal-pill">{componentKindLabel(c.kind)}</span>
                            </td>
                            <td>
                              <code>{c.name}</code>
                            </td>
                            <td>{c.label}</td>
                            <td>
                              {c.properties && Object.keys(c.properties).length > 0 ? (
                                <div className="portal-pill-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                                  {Object.entries(c.properties).map(([k, v]) => (
                                    <span key={k} className="portal-pill">
                                      {k}: {v}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Generated IaC</span>
                    <h2 className="portal-surface__title">Terraform (main.tf)</h2>
                    <p className="portal-surface__subtitle">
                      Components are pre-wired: subnets, security groups, LB listeners and target
                      groups, database subnet groups, and tags flow from project + environment.
                    </p>
                  </div>
                  <div className="portal-pill-row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={copyTerraform}>
                      {copyLabel}
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={downloadTerraform}>
                      Download .tf
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleDelete}>
                      Delete
                    </button>
                  </div>
                </div>
                <pre
                  style={{
                    maxHeight: 520,
                    overflow: 'auto',
                    background: 'var(--portal-surface-sub, #0f1218)',
                    color: 'var(--portal-text, #e5e8ef)',
                    padding: 16,
                    borderRadius: 8,
                    border: '1px solid var(--portal-border, #2a2f3a)',
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  <code>{job.terraform_code}</code>
                </pre>
              </section>
            </>
          ) : (
            <div className="portal-surface">
              <div className="portal-empty">
                <p>Job not found.</p>
              </div>
            </div>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
