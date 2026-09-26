import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { buildPortalApiUrl, parsePortalNumericId, portalFetch } from '@infragate/ui';
import { ADMIN_SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface IncidentReview {
  generated?: boolean;
  impact_summary?: string;
  root_cause?: string;
  detection_summary?: string;
  mitigation_summary?: string;
  corrective_actions?: string;
  review_notes?: string;
  caused_by_change?: string;
  previous_sha?: string;
  watch_result?: string;
  acknowledged_by?: string;
}

interface IncidentPostmortem {
  status?: string;
  impact_summary?: string;
  root_cause?: string;
  detection_summary?: string;
  mitigation_summary?: string;
  corrective_actions?: string;
  review_notes?: string;
  follow_up_owner_username?: string;
  updated_by_username?: string;
}

interface IncidentDetail {
  id: number;
  incident_number?: string;
  request_id?: number;
  project_name?: string;
  project_code?: string;
  severity: string;
  status: string;
  summary: string;
  notes?: string;
  source?: string;
  fingerprint?: string;
  alert_source?: string;
  dashboard_url?: string;
  suspected_change_id?: number;
  suspected_change_number?: string;
  service?: string;
  environment?: string;
  owner_username?: string;
  caused_by?: string;
  status_note?: string;
  updated_at?: string;
  external_provider?: string;
  external_id?: string;
}

export default function AdminIncidentDetailPage() {
  const router = useRouter();
  const [item, setItem] = useState<IncidentDetail | null>(null);
  const [review, setReview] = useState<IncidentReview | null>(null);
  const [postmortem, setPostmortem] = useState<IncidentPostmortem | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);

  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, `/api/admin/incidents/${resourceId}`), { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load incident');
        }
        setItem(data.incident || null);
        setReview(data.review && typeof data.review === 'object' ? data.review : null);
        setPostmortem(data.postmortem && typeof data.postmortem === 'object' ? data.postmortem : null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load incident'))
      .finally(() => setLoading(false));
  }, [id, router]);

  return (
    <AdminLayout>
      <Head>
        <title>{item?.incident_number || 'Incident'} - {ADMIN_SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Incident</span>
            <h1 className="portal-page__title">{item?.incident_number || 'Incident'}</h1>
            <p className="portal-page__subtitle">{item?.summary || 'Operational incident.'}</p>
          </div>
          <Link href="/incidents" className="btn btn-secondary">
            Back to incidents
          </Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading incident...</div> : null}
        {item ? (
          <section className="portal-surface">
            <div className="portal-form-grid">
              <label className="label">Status<input className="input" readOnly value={item.status} /></label>
              <label className="label">Severity<input className="input" readOnly value={item.severity} /></label>
              <label className="label">Source<input className="input" readOnly value={item.source || 'ticket'} /></label>
              <label className="label">Service<input className="input" readOnly value={item.service || '—'} /></label>
              <label className="label">Environment<input className="input" readOnly value={item.environment || '—'} /></label>
              <label className="label">Owner<input className="input" readOnly value={item.owner_username || 'Unassigned'} /></label>
              <label className="label">Project<input className="input" readOnly value={item.project_name ? `${item.project_name} (${item.project_code})` : '—'} /></label>
              <label className="label">Fingerprint<input className="input" readOnly value={item.fingerprint || '—'} /></label>
              <label className="label">External IRM<input className="input" readOnly value={item.external_provider && item.external_id ? `${item.external_provider} · ${item.external_id}` : '—'} /></label>
            </div>
            {item.caused_by ? <p className="portal-surface__subtitle">{item.caused_by}</p> : null}
            {item.status_note ? <p className="portal-surface__subtitle">{item.status_note}</p> : null}
            {item.notes ? <p className="portal-surface__subtitle">{item.notes}</p> : null}
            {item.suspected_change_id ? (
              <p>
                <Link href={`/changes/${item.suspected_change_id}`}>
                  Open {item.suspected_change_number || 'linked change'}
                </Link>
              </p>
            ) : null}
            {item.request_id ? (
              <p>
                <Link href={`/requests?id=${item.request_id}`}>Open related request</Link>
              </p>
            ) : null}
            {item.dashboard_url ? (
              <p>
                <a href={item.dashboard_url} target="_blank" rel="noreferrer">Open source dashboard</a>
              </p>
            ) : null}
          </section>
        ) : null}
        {item && (postmortem || review) ? (
          <section className="portal-surface">
            <span className="portal-surface__eyebrow">Incident review</span>
            <h2 className="portal-surface__title">Read-only review</h2>
            <p className="portal-surface__subtitle">
              {postmortem?.status ? `Status ${postmortem.status}` : 'Draft from the incident timeline'}
              {review?.caused_by_change ? ` · ${review.caused_by_change}` : ''}
              {review?.watch_result ? ` · Watch ${review.watch_result}` : ''}
            </p>
            <div className="portal-form-grid">
              <label className="label">Impact<textarea className="input" readOnly rows={3} value={postmortem?.impact_summary || review?.impact_summary || '—'} /></label>
              <label className="label">Why it happened<textarea className="input" readOnly rows={3} value={postmortem?.root_cause || review?.root_cause || '—'} /></label>
              <label className="label">Detection<textarea className="input" readOnly rows={3} value={postmortem?.detection_summary || review?.detection_summary || '—'} /></label>
              <label className="label">What we did<textarea className="input" readOnly rows={3} value={postmortem?.mitigation_summary || review?.mitigation_summary || '—'} /></label>
              <label className="label">Follow-up<textarea className="input" readOnly rows={3} value={postmortem?.corrective_actions || review?.corrective_actions || '—'} /></label>
              <label className="label">Owner<input className="input" readOnly value={postmortem?.follow_up_owner_username || review?.acknowledged_by || 'Unassigned'} /></label>
            </div>
          </section>
        ) : null}
      </div>
    </AdminLayout>
  );
}
