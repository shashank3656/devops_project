import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';

interface BundleNormalizationItem {
  request_id: number;
  application_id?: string;
  team: string;
  before_env: string;
  after_env?: string;
  before_cloud: string;
  after_cloud?: string;
  before_service: string;
  after_service?: string;
  bundle_count: number;
  config_changed: boolean;
  service_items_synced: boolean;
  error?: string;
}

interface BundleNormalizationPreview {
  dry_run: boolean;
  scanned: number;
  bundled_requests: number;
  config_changes_needed: number;
  service_items_synced: number;
  errors: number;
  scoped_request_id?: number | null;
  items: BundleNormalizationItem[];
}

export default function MaintenancePage() {
  const router = useRouter();
  const [preview, setPreview] = useState<BundleNormalizationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [singleId, setSingleId] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
    }
  }, [token, router]);

  useEffect(() => {
    const q = router.query.request_id;
    if (typeof q === 'string' && q.trim()) {
      setSingleId(q.trim());
    }
  }, [router.query.request_id]);

  const scopedQuery = () => {
    const id = parseInt(singleId.trim(), 10);
    return id > 0 ? `&request_id=${id}` : '';
  };

  const runPreview = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/request-bundle-normalization?limit=100${scopedQuery()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Preview failed');
        return;
      }
      setPreview(normalizePreview(data));
    } catch {
      setError('Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const applyCleanup = async () => {
    if (!token) return;
    const id = parseInt(singleId.trim(), 10);
    const scopeLabel = id > 0 ? `request #${id}` : 'up to 100 bundled requests';
    if (!confirm(`Normalize ${scopeLabel}? Stored JSON and service items will be updated.`)) return;
    const typed = prompt('Type NORMALIZE to confirm this maintenance action');
    if (typed?.trim() !== 'NORMALIZE') {
      setNotice('Apply cancelled — confirmation text did not match.');
      return;
    }
    setApplying(true);
    setError('');
    setNotice('');
    try {
      const body: { confirm: string; request_id?: number; limit?: number } = { confirm: 'NORMALIZE' };
      if (id > 0) body.request_id = id;
      else body.limit = 100;
      const res = await fetch(`${apiUrl}/api/admin/request-bundle-normalization`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Apply failed');
        return;
      }
      setPreview(normalizePreview(data));
      setNotice(
        id > 0
          ? `Request #${id} normalized.`
          : `Batch cleanup finished: ${data?.service_items_synced ?? 0} service item sync(s), ${data?.errors ?? 0} error(s).`
      );
    } catch {
      setError('Apply failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Head>
        <title>Maintenance - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Maintenance</span>
              <h1 className="portal-page__title">Legacy bundle normalization</h1>
              <p className="portal-page__subtitle">
                Older multi-service requests stored a bundled <code>service_bundle</code> blob in config. Normalization aligns config, primary env/cloud/service fields, and{' '}
                <code>request_service_items</code> with the current request model. This is separate from approving or rejecting tickets in the queue.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/requests" className="btn btn-secondary">
                Back to requests
              </Link>
            </div>
          </div>

          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="alert alert-success" role="status">
              {notice}
            </div>
          ) : null}

          <section className="admin-maintenance-card">
            <div className="admin-maintenance-card__header">
              <div>
                <span className="portal-page__eyebrow">Scoped cleanup</span>
                <h2 className="admin-maintenance-card__title">Preview or apply normalization</h2>
                <p className="admin-maintenance-card__copy">
                  Leave request # empty to scan the latest 100 bundled requests, or enter one id to fix a single ticket. Apply requires typing <strong>NORMALIZE</strong> in the confirmation prompt.
                </p>
              </div>
              <div className="admin-maintenance-card__actions">
                <label className="admin-maintenance-card__single-id">
                  <span>Request #</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="numeric"
                    placeholder="Optional"
                    value={singleId}
                    onChange={(e) => setSingleId(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <button type="button" className="btn btn-secondary btn-sm" onClick={runPreview} disabled={loading || applying}>
                  {loading ? 'Previewing…' : 'Preview'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={applyCleanup} disabled={loading || applying}>
                  {applying ? 'Applying…' : 'Apply normalization'}
                </button>
              </div>
            </div>

            {preview ? (
              <div className="admin-maintenance-card__body">
                <div className="admin-maintenance-card__summary">
                  <div className="admin-maintenance-card__metric">
                    <strong>{preview.scanned}</strong>
                    <span>Scanned</span>
                  </div>
                  <div className="admin-maintenance-card__metric">
                    <strong>{preview.bundled_requests}</strong>
                    <span>Bundled</span>
                  </div>
                  <div className="admin-maintenance-card__metric">
                    <strong>{preview.config_changes_needed}</strong>
                    <span>Config fixes</span>
                  </div>
                  <div className="admin-maintenance-card__metric">
                    <strong>{preview.service_items_synced}</strong>
                    <span>Item syncs</span>
                  </div>
                  <div className="admin-maintenance-card__metric">
                    <strong>{preview.errors}</strong>
                    <span>Errors</span>
                  </div>
                </div>
                <div className="admin-maintenance-card__status">
                  {preview.dry_run
                    ? 'Preview only — no database writes yet.'
                    : 'Changes were written. Re-open affected requests to see updated bundle rows.'}
                </div>
                {preview.items.length > 0 ? (
                  <div className="admin-maintenance-card__list">
                    {preview.items.slice(0, 12).map((item) => (
                      <article key={item.request_id} className="admin-maintenance-card__item">
                        <div className="admin-maintenance-card__item-head">
                          <strong>#{item.request_id}</strong>
                          {item.application_id ? <span>{item.application_id}</span> : null}
                          <span>{item.team}</span>
                          <Link href={`/requests?id=${item.request_id}`} className="admin-maintenance-card__item-link">
                            Open
                          </Link>
                        </div>
                        <p className="admin-maintenance-card__item-copy">
                          {item.before_env}/{item.before_cloud}/{item.before_service}
                          {' → '}
                          {item.after_env || item.before_env}/{item.after_cloud || item.before_cloud}/{item.after_service || item.before_service}
                        </p>
                        <div className="admin-maintenance-card__item-meta">
                          <span>{item.bundle_count} services</span>
                          <span>{item.config_changed ? 'Config updated' : 'Config already clean'}</span>
                          <span>{item.service_items_synced ? 'Service items synced' : 'Preview / pending'}</span>
                          {item.error ? <span className="admin-maintenance-card__item-error">{item.error}</span> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-maintenance-card__empty">No bundled requests matched this scope.</p>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </AdminLayout>
    </>
  );
}

function normalizePreview(data: Record<string, unknown>): BundleNormalizationPreview {
  return {
    dry_run: Boolean(data?.dry_run),
    scanned: typeof data?.scanned === 'number' ? data.scanned : 0,
    bundled_requests: typeof data?.bundled_requests === 'number' ? data.bundled_requests : 0,
    config_changes_needed: typeof data?.config_changes_needed === 'number' ? data.config_changes_needed : 0,
    service_items_synced: typeof data?.service_items_synced === 'number' ? data.service_items_synced : 0,
    errors: typeof data?.errors === 'number' ? data.errors : 0,
    scoped_request_id: typeof data?.scoped_request_id === 'number' ? data.scoped_request_id : null,
    items: Array.isArray(data?.items) ? (data.items as BundleNormalizationItem[]) : [],
  };
}
