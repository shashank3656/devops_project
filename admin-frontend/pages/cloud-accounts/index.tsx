import Head from 'next/head';
import { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../../lib/site';
import { providerChipTone, providerLabel } from '../../lib/cloudProviders';
import { DataTable, EmptyState, PageHeader, portalFetch, type DataTableColumn } from '@infragate/ui';

interface CloudAccount {
  id: number;
  provider: string;
  account_id: string;
  display_name: string;
  team_slug: string;
  environments: string[];
  status: string;
  onboarded_by_username?: string;
}

export default function AdminCloudAccountsPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const [rows, setRows] = useState<CloudAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    portalFetch(`${apiUrl}/api/admin/cloud/accounts`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load cloud accounts');
        setRows(Array.isArray(data.accounts) ? data.accounts : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const columns: DataTableColumn<CloudAccount>[] = [
    { id: 'display_name', header: 'Name', cell: (row) => row.display_name },
    {
      id: 'provider',
      header: 'Provider',
      cell: (row) => (
        <span className={`ig-chip ig-chip--${providerChipTone(row.provider)}`}>{providerLabel(row.provider)}</span>
      ),
    },
    { id: 'account_id', header: 'Account ID', cell: (row) => row.account_id },
    { id: 'team_slug', header: 'Team', cell: (row) => row.team_slug },
    {
      id: 'environments',
      header: 'Environments',
      cell: (row) => (row.environments?.length ? row.environments.join(', ') : '—'),
    },
    { id: 'status', header: 'Status', cell: (row) => row.status },
    { id: 'onboarded_by_username', header: 'Onboarded by', cell: (row) => row.onboarded_by_username || '—' },
  ];

  return (
    <AdminLayout>
      <Head>
        <title>{`Cloud accounts - ${ADMIN_SITE_NAME}`}</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud"
          title="Cloud accounts"
          subtitle="Read-only view of AWS, Azure, and GCP accounts by DevOps team. Credentials are never shown here."
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        <div className="portal-surface portal-surface--table">
          {loading ? (
            <EmptyState title="Loading" body="Fetching cloud accounts…" />
          ) : (
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} label="Cloud accounts" />
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
