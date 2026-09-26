import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { EmptyState, PageHeader, portalFetch } from '@infragate/ui';

interface CloudResource {
  id: number;
  team_slug: string;
  cloud: string;
  account_id: string;
  account_name: string;
  environment: string;
  region: string;
  service_type: string;
  resource_id: string;
  display_name: string;
  status: string;
  updated_at?: string;
}

export default function CloudResourceDetailPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const [item, setItem] = useState<CloudResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem('devops_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    portalFetch(`${apiUrl}/api/devops/cloud/resources/${id}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Resource not found');
        setItem(data.resource || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [apiUrl, id, router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{item?.display_name || 'Resource'} - Cloud inventory</title>
      </Head>
      <div className="portal-page portal-page--narrow">
        <PageHeader
          eyebrow="Cloud"
          title={item?.display_name || 'Resource detail'}
          subtitle="Read-only context before any future day-2 action."
          actions={
            <Link href="/cloud-resources" className="btn btn-secondary">
              Back to inventory
            </Link>
          }
        />
        {loading ? (
          <EmptyState title="Loading" body="Fetching resource details…" />
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : item ? (
          <div className="portal-surface">
            <dl className="admin-status-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <dt>Cloud</dt>
                <dd>{item.cloud}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{item.status}</dd>
              </div>
              <div>
                <dt>Team</dt>
                <dd>{item.team_slug}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{item.environment}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>
                  {item.account_name} ({item.account_id})
                </dd>
              </div>
              <div>
                <dt>Region</dt>
                <dd>{item.region}</dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>{item.service_type}</dd>
              </div>
              <div>
                <dt>Resource id</dt>
                <dd>
                  <code>{item.resource_id}</code>
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
