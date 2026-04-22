import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { asRecord, getString } from '../../../lib/payload';
import {
  ARCHITECTURE_CLOUDS,
  ARCHITECTURE_COMPONENT_KINDS,
  ARCHITECTURE_ENVS,
  ArchitectureDiagramJob,
  normalizeJob,
} from '../../../lib/architectureDiagram';

const DEVOPS_TOKEN_KEY = 'devops_token';
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.xml', '.drawio'];

export default function EditArchitectureDiagramJob() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const { id } = router.query;

  const [job, setJob] = useState<ArchitectureDiagramJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [projectName, setProjectName] = useState('');
  const [environment, setEnvironment] = useState('dev');
  const [cloud, setCloud] = useState('aws');
  const [region, setRegion] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [hintsChanged, setHintsChanged] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [existingImageSrc, setExistingImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    if (!id || typeof id !== 'string') return;
    void load(id, token);
  }, [id, router]);

  const load = async (jobId: string, token: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (!res.ok || !data.job) {
        setError(getString(data.error, 'Failed to load job'));
        return;
      }
      const normalized = normalizeJob(data.job);
      if (!normalized) {
        setError('Failed to parse job');
        return;
      }
      setJob(normalized);
      setProjectName(normalized.project_name);
      setEnvironment(normalized.environment);
      setCloud(normalized.cloud);
      setRegion(normalized.region);
      setDueDate(normalized.due_date || '');
      setNotes(normalized.notes);
      setSelectedKinds(normalized.detected_components.map((c) => c.kind));
      if (normalized.image_object_key) {
        void loadExistingImage(jobId, token);
      }
    } catch {
      setError('Failed to load job');
    } finally {
      setLoading(false);
    }
  };

  const loadExistingImage = async (jobId: string, token: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram/${jobId}/image`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setExistingImageSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch {
    }
  };

  useEffect(() => {
    return () => {
      if (existingImageSrc) URL.revokeObjectURL(existingImageSrc);
    };
  }, [existingImageSrc]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const toggleKind = (kind: string) => {
    setHintsChanged(true);
    setSelectedKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    if (!next) {
      setFile(null);
      return;
    }
    const lower = next.name.toLowerCase();
    const extOk = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!extOk) {
      setError('Diagram must be PNG, JPG, SVG, XML, or .drawio');
      return;
    }
    if (next.size > MAX_FILE_SIZE) {
      setError('Diagram must be smaller than 12MB');
      return;
    }
    setError('');
    setFile(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!job) return;
    setError('');
    if (!projectName.trim()) {
      setError('Project name is required');
      return;
    }
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    const form = new FormData();
    form.append('project_name', projectName.trim());
    form.append('environment', environment);
    form.append('cloud', cloud);
    form.append('region', region.trim());
    form.append('due_date', dueDate);
    form.append('notes', notes);
    if (hintsChanged) {
      form.append('component_hints', selectedKinds.join(','));
    }
    if (file) {
      form.append('diagram', file);
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/devops/architecture-diagram/${job.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = asRecord(await res.json().catch(() => ({})));
      if (res.ok && data.job) {
        const saved = normalizeJob(data.job);
        if (saved) {
          router.push(`/architecture-diagram/${saved.id}?updated=1`);
          return;
        }
      }
      setError(getString(data.error, 'Failed to save changes'));
    } catch {
      setError('Failed to save changes. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const fileSizeLabel = useMemo(() => {
    if (!file) return '';
    if (file.size < 1024) return `${file.size} B`;
    if (file.size < 1024 * 1024) return `${(file.size / 1024).toFixed(1)} KB`;
    return `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  }, [file]);

  return (
    <>
      <Head>
        <title>{job ? `Edit ${job.project_name}` : 'Edit diagram'} - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="portal-page portal-page--narrow">
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">AI Infra Generator</span>
              <h1 className="portal-page__title">
                {job ? `Edit ${job.project_name}` : 'Edit diagram job'}
              </h1>
              <p className="portal-page__subtitle">
                Update metadata, refresh the diagram, or retune detection hints. Terraform is
                regenerated on save.
              </p>
            </div>
            <div className="portal-page__actions" style={{ gap: 8 }}>
              <Link
                href={job ? `/architecture-diagram/${job.id}` : '/architecture-diagram'}
                className="btn btn-secondary"
              >
                Cancel
              </Link>
            </div>
          </header>

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
          ) : !job ? (
            <div className="portal-surface">
              <div className="portal-empty">
                <p>Job not found.</p>
              </div>
            </div>
          ) : (
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Edit request</span>
                  <h2 className="portal-surface__title">Project metadata</h2>
                  <p className="portal-surface__subtitle">
                    Leave the diagram field empty to keep the existing upload.
                  </p>
                </div>
              </div>

              <form onSubmit={submit} className="portal-stack" encType="multipart/form-data">
                <div className="portal-field-grid portal-field-grid--two">
                  <div className="form-group">
                    <label className="label" htmlFor="ade-project">
                      Project name
                    </label>
                    <input
                      id="ade-project"
                      className="input"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="label" htmlFor="ade-due">
                      Due date
                    </label>
                    <input
                      id="ade-due"
                      className="input"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="portal-field-grid">
                  <div className="form-group">
                    <label className="label" htmlFor="ade-env">
                      Environment
                    </label>
                    <select
                      id="ade-env"
                      className="input"
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                    >
                      {ARCHITECTURE_ENVS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label" htmlFor="ade-cloud">
                      Cloud provider
                    </label>
                    <select
                      id="ade-cloud"
                      className="input"
                      value={cloud}
                      onChange={(e) => setCloud(e.target.value)}
                    >
                      {ARCHITECTURE_CLOUDS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label" htmlFor="ade-region">
                      Region
                    </label>
                    <input
                      id="ade-region"
                      className="input"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="us-east-1"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="label" htmlFor="ade-diagram">
                    Replace diagram (optional)
                  </label>
                  <input
                    id="ade-diagram"
                    className="input"
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.xml,.drawio,image/*"
                    onChange={handleFileChange}
                  />
                  <div className="portal-pill-row" style={{ marginTop: 8 }}>
                    <span className="portal-pill">
                      current: {job.image_filename || '—'}
                    </span>
                    {file ? (
                      <span className="portal-pill">
                        new: {file.name} · {fileSizeLabel}
                      </span>
                    ) : (
                      <span className="portal-pill">leave empty to keep current</span>
                    )}
                  </div>
                  {preview ? (
                    <div
                      style={{
                        marginTop: 12,
                        border: '1px solid var(--portal-border, #2a2f3a)',
                        borderRadius: 8,
                        padding: 8,
                        background: 'var(--portal-surface-sub, #11141a)',
                      }}
                    >
                      <img
                        src={preview}
                        alt="New diagram preview"
                        style={{ maxWidth: '100%', maxHeight: 320, display: 'block', margin: '0 auto' }}
                      />
                    </div>
                  ) : existingImageSrc ? (
                    <div
                      style={{
                        marginTop: 12,
                        border: '1px solid var(--portal-border, #2a2f3a)',
                        borderRadius: 8,
                        padding: 8,
                        background: 'var(--portal-surface-sub, #11141a)',
                      }}
                    >
                      <div className="portal-help-text" style={{ marginBottom: 6 }}>
                        Current diagram
                      </div>
                      <img
                        src={existingImageSrc}
                        alt="Current diagram"
                        style={{ maxWidth: '100%', maxHeight: 320, display: 'block', margin: '0 auto' }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="form-group">
                  <label className="label">Component hints</label>
                  <p className="portal-help-text">
                    Toggling hints retriggers detection using the updated diagram metadata.
                  </p>
                  <div className="portal-pill-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {ARCHITECTURE_COMPONENT_KINDS.map((c) => {
                      const active = selectedKinds.includes(c.kind);
                      return (
                        <button
                          type="button"
                          key={c.kind}
                          className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => toggleKind(c.kind)}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  {hintsChanged ? (
                    <p className="portal-help-text" style={{ marginTop: 6 }}>
                      Hints updated – components and Terraform will be regenerated on save.
                    </p>
                  ) : null}
                </div>

                <div className="form-group">
                  <label className="label" htmlFor="ade-notes">
                    Notes
                  </label>
                  <textarea
                    id="ade-notes"
                    className="input portal-code-input"
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                  <Link
                    href={`/architecture-diagram/${job.id}`}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </Link>
                </div>
              </form>
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
