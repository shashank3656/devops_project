import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import {
  buildPortalApiUrl,
  buildChangeDetailActions,
  ChangeDetailPanel,
  parsePortalNumericId,
  portalFetch,
  type ChangeDetailModel,
} from '@infragate/ui';
import { ADMIN_SITE_NAME } from '../../lib/site';

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
  status: string;
}

export default function AdminChangeDetailPage() {
  const router = useRouter();
  const [item, setItem] = useState<ChangeDetailModel | null>(null);
  const [brief, setBrief] = useState<ChangeBrief | null>(null);
  const [incidents, setIncidents] = useState<LinkedIncident[]>([]);
  const [blastRadius, setBlastRadius] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const resourceId = parsePortalNumericId(id);
  const status = (item?.status || '').toLowerCase();
  const finished = status === 'resolved' || status === 'closed' || status === 'failed' || status === 'cancelled';

  const postAction = (action: string, actingKey: string) => {
    const token = localStorage.getItem('admin_token');
    if (!token || !resourceId) return;
    setActing(actingKey);
    setError('');
    const path = action === 'approve' ? 'cab-approve' : action;
    portalFetch(buildPortalApiUrl(apiUrl, `/api/admin/changes/${resourceId}/${path}`), {
      method: 'POST',
      token,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || `Failed to ${actingKey} change`);
          return;
        }
        if (data.change) setItem(data.change);
      })
      .catch(() => setError(`Failed to ${actingKey} change`))
      .finally(() => setActing(''));
  };

  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, `/api/admin/changes/${resourceId}`), { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load change');
        }
        setItem(data.change || null);
        setBrief(data.change_brief || null);
        setIncidents(Array.isArray(data.linked_incidents) ? data.linked_incidents : []);
        setBlastRadius(Array.isArray(data.blast_radius) ? data.blast_radius : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load change'))
      .finally(() => setLoading(false));
  }, [resourceId, router]);

  const detailActions = useMemo(() => {
    if (!item) return undefined;
    const base = buildChangeDetailActions(item, { portal: 'admin', canAuthorize: true, finished });
    return {
      ...base,
      acting,
      onApprove: () => postAction('approve', 'approve'),
      onSchedule: () => postAction('schedule', 'schedule'),
      onImplement: () => postAction('implement', 'implement'),
      onResolve: () => postAction('resolve', 'resolve'),
      onClose: () => postAction('close', 'close'),
      onFail: () => postAction('fail', 'fail'),
      onCancel: () => postAction('cancel', 'cancel'),
      onReopen: () => postAction('reopen', 'reopen'),
    };
  }, [item, finished, acting, resourceId]);

  return (
    <AdminLayout>
      <Head>
        <title>{item?.change_number || 'Change'} - {ADMIN_SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Change request</span>
            <h1 className="portal-page__title">{item?.change_number || 'Change'}</h1>
            <p className="portal-page__subtitle">{item?.title || 'Approve, schedule, implement, or close this change.'}</p>
          </div>
          <Link href="/changes" className="btn btn-secondary">
            Back to changes
          </Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading change...</div> : null}
        {item ? (
          <>
            <ChangeDetailPanel item={item} actions={detailActions} />
            {(brief?.headline || incidents.length || blastRadius.length) && (
              <section className="portal-surface" style={{ marginTop: 16 }}>
                {brief?.headline ? (
                  <div style={{ marginBottom: 16 }}>
                    <h2 className="portal-surface__title">Change brief</h2>
                    <p className="portal-surface__subtitle">{brief.headline}</p>
                  </div>
                ) : null}
                {incidents.length ? (
                  <div>
                    <h2 className="portal-surface__title">Linked incidents</h2>
                    <ul>
                      {incidents.map((incident) => (
                        <li key={incident.id}>
                          <Link href={`/incidents/${incident.id}`}>
                            {incident.incident_number || `INC${incident.id}`} — {incident.summary}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            )}
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
