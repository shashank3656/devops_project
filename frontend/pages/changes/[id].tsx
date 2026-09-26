import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { DeliveryVisibilityCard, type DeliveryVisibility } from '@infragate/ui';
import { SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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
  title: string;
  author?: string;
  summary?: string;
  files: string[];
  change_type: string;
  status: string;
  linked_incidents: number;
  rollback_hint?: string;
  assignee_username?: string;
  priority?: string;
  risk_level?: string;
  impact?: string;
  backout_plan?: string;
  sbom_url?: string;
  attestation_url?: string;
  image_digest?: string;
  provenance_signed?: boolean;
  cab_window_start?: string;
  cab_window_end?: string;
  cost_delta_usd?: number;
  cost_monthly_after?: number;
  cost_currency?: string;
  policy_status?: string;
  policy_reasons?: string[];
}

export default function UserChangeDetailPage() {
  const router = useRouter();
  const [item, setItem] = useState<ChangeDetail | null>(null);
  const [brief, setBrief] = useState<ChangeBrief | null>(null);
  const [incidents, setIncidents] = useState<LinkedIncident[]>([]);
  const [blastRadius, setBlastRadius] = useState<string[]>([]);
  const [drift, setDrift] = useState<{ drifted?: boolean; detail?: string } | null>(null);
  const [delivery, setDelivery] = useState<DeliveryVisibility | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    setLoading(true);
    fetch(`${apiUrl}/api/me/changes/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return;
        }
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load change');
        }
        setItem(data.change || null);
        setBrief(data.change_brief || null);
        setIncidents(Array.isArray(data.linked_incidents) ? data.linked_incidents : []);
        setBlastRadius(Array.isArray(data.blast_radius) ? data.blast_radius : []);
        setDrift(data.drift && typeof data.drift === 'object' ? data.drift : null);
        setDelivery((data.delivery as DeliveryVisibility | undefined) ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load change'))
      .finally(() => setLoading(false));
  }, [id, router]);

  return (
    <>
      <Head>
        <title>{item?.change_number || 'Change'} - {SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Change request</span>
            <h1 className="portal-page__title">{item?.change_number || 'Change'}</h1>
            <p className="portal-page__subtitle">{item?.title || 'Deployment recorded from CI.'}</p>
          </div>
          <Link href="/changes" className="btn btn-secondary">
            Back to changes
          </Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading change...</div> : null}
        {item ? (
          <>
            <DeliveryVisibilityCard delivery={delivery} portal="user" />
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">Status<input className="input" readOnly value={item.status} /></label>
              <label className="label">Type<input className="input" readOnly value={item.change_type} /></label>
              <label className="label">Priority<input className="input" readOnly value={item.priority || 'medium'} /></label>
              <label className="label">Risk<input className="input" readOnly value={item.risk_level || 'medium'} /></label>
              <label className="label">Planned start<input className="input" readOnly value={item.cab_window_start ? new Date(item.cab_window_start).toLocaleString() : '—'} /></label>
              <label className="label">Planned end<input className="input" readOnly value={item.cab_window_end ? new Date(item.cab_window_end).toLocaleString() : '—'} /></label>
              <label className="label">Repo<input className="input" readOnly value={item.repo} /></label>
              <label className="label">SHA<input className="input" readOnly value={item.sha} /></label>
              <label className="label">Pull request<input className="input" readOnly value={item.pr_number ? `#${item.pr_number}` : 'None'} /></label>
              <label className="label">Service<input className="input" readOnly value={item.service || '—'} /></label>
              <label className="label">Environment<input className="input" readOnly value={item.environment === 'unspecified' ? '—' : item.environment} /></label>
              <label className="label">Assigned to<input className="input" readOnly value={item.assignee_username || '—'} /></label>
              <label className="label">Project<input className="input" readOnly value={item.project_name ? `${item.project_name} (${item.project_code})` : '—'} /></label>
            </div>
            {item.rollback_hint ? <p className="portal-surface__subtitle">{item.rollback_hint}</p> : null}
            {item.summary ? <p className="portal-surface__subtitle">{item.summary}</p> : null}
            {item.impact ? <p className="portal-surface__subtitle">Impact: {item.impact}</p> : null}
            {item.backout_plan ? <p className="portal-surface__subtitle">Backout: {item.backout_plan}</p> : null}
            <p className="portal-surface__subtitle">
              Cost delta: {item.cost_currency || 'USD'} {item.cost_delta_usd ?? 0}
              {item.cost_monthly_after ? ` · monthly after ${item.cost_monthly_after}` : ''}
              {item.policy_status ? ` · policy ${item.policy_status}` : ''}
              {item.policy_reasons?.length ? ` · ${item.policy_reasons.join('; ')}` : ''}
            </p>
            <p className="portal-surface__subtitle">Provenance: {item.provenance_signed ? 'Signed' : 'Unsigned'}{item.image_digest ? ` · ${item.image_digest}` : ''}</p>
            {item.sbom_url || item.attestation_url ? (
              <p className="portal-surface__subtitle">
                {item.sbom_url ? <a href={item.sbom_url} target="_blank" rel="noreferrer">SBOM</a> : null}
                {item.sbom_url && item.attestation_url ? ' · ' : ''}
                {item.attestation_url ? <a href={item.attestation_url} target="_blank" rel="noreferrer">Attestation</a> : null}
              </p>
            ) : null}
            {item.pr_url ? <p><a href={item.pr_url} target="_blank" rel="noreferrer">Open pull request</a></p> : null}
            {brief?.headline ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Change brief</h2>
                <p className="portal-surface__subtitle">{brief.headline}</p>
                {brief.changing?.length ? (
                  <p className="portal-surface__subtitle">{brief.changing.map((group) => `${group.label} (${group.count})`).join(' · ')}</p>
                ) : null}
              </div>
            ) : null}
            {drift?.drifted ? (
              <p className="portal-surface__subtitle">{drift.detail || 'Live image drifted from last CHG'}</p>
            ) : null}
            {blastRadius.length ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Blast radius</h2>
                <ul>{blastRadius.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              </div>
            ) : null}
            {incidents.length ? (
              <div style={{ marginTop: 24 }}>
                <h2 className="portal-surface__title">Linked incidents</h2>
                <ul>
                  {incidents.map((incident) => (
                    <li key={incident.id}>
                      <Link href={`/incidents/${incident.id}`}>
                        {incident.incident_number || `INC${incident.id}`} — {incident.summary} ({incident.severity})
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {item.files?.length ? (
              <>
                <h2 className="portal-surface__title" style={{ marginTop: 24 }}>Files</h2>
                <ul>{item.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
              </>
            ) : null}
          </section>
          </>
        ) : null}
      </div>
    </>
  );
}
