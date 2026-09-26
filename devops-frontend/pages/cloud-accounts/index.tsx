import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { DataTable, EmptyState, PageHeader, portalFetch, type DataTableColumn } from '@infragate/ui';

interface CloudAccount {
  id: number;
  provider: string;
  account_id: string;
  display_name: string;
  team_slug: string;
  environments: string[];
  auth_mode: string;
  role_arn?: string;
  external_id_set?: boolean;
  status: string;
  last_error?: string;
  last_test_at?: string;
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  error: 'Error',
  disabled: 'Disabled',
  pending: 'Pending test',
};

export default function CloudAccountsPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [rows, setRows] = useState<CloudAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    portalFetch(`${apiUrl}/api/devops/cloud/accounts`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load cloud accounts');
        setRows(Array.isArray(data.accounts) ? data.accounts : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const columns: DataTableColumn<CloudAccount>[] = useMemo(
    () => [
      {
        id: 'display_name',
        header: 'Account',
        cell: (row) => (
          <Link href={`/cloud-accounts/${row.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
            {row.display_name}
          </Link>
        ),
      },
      { id: 'provider', header: 'Provider', cell: (row) => row.provider.toUpperCase() },
      { id: 'account_id', header: 'Account ID', cell: (row) => <span className="ig-mono">{row.account_id}</span> },
      { id: 'team_slug', header: 'Team', cell: (row) => row.team_slug },
      {
        id: 'environments',
        header: 'Environments',
        cell: (row) => (row.environments?.length ? row.environments.join(', ') : '—'),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => STATUS_LABEL[row.status] || row.status,
      },
    ],
    [],
  );

  return (
    <DevOpsLayout>
      <Head>
        <title>Cloud accounts - DevOps</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud"
          title="Cloud accounts"
          subtitle="Onboard AWS accounts for your teams. Credentials and secrets never leave the API host."
          actions={
            <Link href="/cloud-accounts/new" className="btn btn-primary">
              Onboard account
            </Link>
          }
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        <div className="portal-surface portal-surface--table">
          {loading ? (
            <EmptyState title="Loading accounts" body="Fetching onboarded cloud accounts…" />
          ) : rows.length === 0 ? (
            <>
              <EmptyState
                title="No cloud accounts yet"
                body="Onboard an AWS account with a cross-account role. Then run Test connection from the account detail page."
              />
              <p style={{ marginTop: 12 }}>
                <Link href="/cloud-accounts/new" className="btn btn-primary">
                  Onboard account
                </Link>
              </p>
            </>
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              label="Cloud accounts"
              onRowOpen={(row) => void router.push(`/cloud-accounts/${row.id}`)}
            />
          )}
        </div>
      </div>
    </DevOpsLayout>
  );
}
