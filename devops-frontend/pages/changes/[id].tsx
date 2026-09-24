import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface ChangeBrief {
  headline?: string;
  changing?: { key: string; label: string; count: number }[];
  risk_because?: string[];
}

interface LinkedIncident {
  id: number;
  incident_number?: string;
  summary: string;
  severity: string;
  status: string;
}

interface ChangeDetail {
  id: number;
  change_number: string;
  project_name?: string;
  project_code?: string;
  service: string;
  environment: string;
  repo: string;
  pr_number: number;
  pr_url?: string;
  sha: string;
  previous_sha?: string;
  title: string;
  author?: string;
  summary?: string;
  files: string[];
  pipeline_url?: string;
  change_type: string;
  status: string;
  watch_minutes: number;
  watch_until?: string;
  watch_remaining_minutes?: number;
  request_id?: number;
  linked_incidents: number;
  baseline?: { p95_ms?: number; error_ratio?: number; saturation?: number };
  latest_metrics?: { p95_ms?: number; error_ratio?: number; saturation?: number };
  rollback_hint?: string;
  cab_status?: string;
  linked_incident_number?: string;
  created_at: string;
}

export default function ChangeDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [item, setItem] = useState<ChangeDetail | null>(null);
  const [brief, setBrief] = useState<ChangeBrief | null>(null);
  const [incidents, setIncidents] = useState<LinkedIncident[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [approving, setApproving] = useState(false);
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    fetch(`${apiUrl}/api/devops/changes/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Failed to load change');
          return;
        }
        setItem(data.change || null);
        setBrief(data.change_brief || null);
        setIncidents(Array.isArray(data.linked_incidents) ? data.linked_incidents : []);
      })
      .catch(() => setError('Failed to load change'))
      .finally(() => setLoading(false));
  }, [apiUrl, id]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.change_number || 'Change'} - DevOps</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Change request</span>
            <h1 className="portal-page__title">{item?.change_number || 'Change'}</h1>
            <p className="portal-page__subtitle">{item?.title || 'Deployment recorded from CI.'}</p>
          </div>
          <div className="portal-page__actions">
            {item?.cab_status === 'pending' ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={approving}
                onClick={() => {
                  const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                  if (!token || !id) return;
                  setApproving(true);
                  fetch(`${apiUrl}/api/devops/changes/${id}/cab-approve`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  })
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(data?.error || 'Failed to approve CAB');
                        return;
                      }
                      setItem(data.change || item);
                    })
                    .finally(() => setApproving(false));
                }}
              >
                {approving ? 'Approving...' : 'Approve CAB'}
              </button>
            ) : null}
            {item && item.status !== 'closed' && item.status !== 'failed' && item.status !== 'cancelled' ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={closing}
                onClick={() => {
                  const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
                  if (!token || !id) return;
                  setClosing(true);
                  fetch(`${apiUrl}/api/devops/changes/${id}/close`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  })
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(data?.error || 'Failed to close change');
                        return;
                      }
                      setItem(data.change || item);
                    })
                    .catch(() => setError('Failed to close change'))
                    .finally(() => setClosing(false));
                }}
              >
                {closing ? 'Closing...' : 'Close change'}
              </button>
            ) : null}
            <Link href="/changes" className="btn btn-secondary">
              Back to changes
            </Link>
          </div>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading change...</div> : null}
        {item ? (
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">
                Status
                <input className="input" readOnly value={item.status} />
              </label>
              <label className="label">
                Type
                <input className="input" readOnly value={item.change_type} />
              </label>
              <label className="label">
                Repo
                <input className="input" readOnly value={item.repo} />
              </label>
              <label className="label">
                SHA
                <input className="input" readOnly value={item.sha} />
              </label>
              <label className="label">
                Pull request
                <input className="input" readOnly value={item.pr_number ? `#${item.pr_number}` : 'None'} />
              </label>
              <label className="label">
                Service
                <input className="input" readOnly value={item.service || '—'} />
              </label>
              <label className="label">
                Environment
                <input className="input" readOnly value={item.environment} />
              </label>
              <label className="label">
                Author
                <input className="input" readOnly value={item.author || '—'} />
              </label>
              <label className="label">
                Project
                <input className="input" readOnly value={item.project_name ? `${item.project_name} (${item.project_code})` : '—'} />
              </label>
              <label className="label">
                Watch window
                <input className="input" readOnly value={`${item.watch_minutes} min${item.watch_until ? ` · until ${new Date(item.watch_until).toLocaleString()}` : ''}`} />
              </label>
              <label className="label">
                Linked incidents
                <input className="input" readOnly value={String(item.linked_incidents || 0)} />
              </label>
              <label className="label">
                Previous SHA
                <input className="input" readOnly value={item.previous_sha || '—'} />
              </label>
              <label className="label">
                Remaining watch
                <input className="input" readOnly value={`${item.watch_remaining_minutes ?? 0} min`} />
              </label>
              <label className="label">
                Latest p95
                <input className="input" readOnly value={item.latest_metrics?.p95_ms != null ? `${item.latest_metrics.p95_ms}ms (baseline ${item.baseline?.p95_ms ?? '—'})` : 'No sample yet'} />
              </label>
            </div>
            {item.cab_status ? <p className="portal-surface__subtitle">CAB: {item.cab_status}{item.linked_incident_number ? ` · linked ${item.linked_incident_number}` : ''}</p> : null}
            {item.rollback_hint ? <p className="portal-surface__subtitle">{item.rollback_hint}</p> : null}
            {item.summary ? <p className="portal-surface__subtitle">{item.summary}</p> : null}
            {item.pr_url ? (
              <p>
                <a href={item.pr_url} target="_blank" rel="noreferrer">
                  Open pull request
                </a>
              </p>
            ) : null}
            {item.pipeline_url ? (
              <p>
                <a href={item.pipeline_url} target="_blank" rel="noreferrer">
                  Open pipeline
                </a>
              </p>
            ) : null}
            {brief?.headline ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Change brief</h2>
                <p className="portal-surface__subtitle">{brief.headline}</p>
                {brief.changing?.length ? (
                  <p className="portal-surface__subtitle">
                    {brief.changing.map((group) => `${group.label} (${group.count})`).join(' · ')}
                  </p>
                ) : null}
                {brief.risk_because?.length ? (
                  <ul>
                    {brief.risk_because.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {incidents.length ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Linked incidents</h2>
                <ul>
                  {incidents.map((incident) => (
                    <li key={incident.id}>
                      <Link href={`/incidents/${incident.id}/edit`}>
                        {incident.incident_number || `INC${incident.id}`} — {incident.summary} ({incident.severity})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <h2 className="portal-surface__title" style={{ marginTop: 24 }}>Files</h2>
            {item.files?.length ? (
              <ul>
                {item.files.map((file) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="portal-surface__subtitle">No file list was sent with this change.</p>
            )}
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
