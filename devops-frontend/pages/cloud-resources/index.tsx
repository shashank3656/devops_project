import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  DataTable,
  EmptyState,
  PageFilters,
  PageHeader,
  portalFetch,
  type DataTableColumn,
  type PageFilterChip,
} from '@infragate/ui';

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

const PAGE_SIZE = 25;

export default function CloudResourcesPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [rows, setRows] = useState<CloudResource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [account, setAccount] = useState('');
  const [env, setEnv] = useState('');
  const [region, setRegion] = useState('');

  const projectId = Array.isArray(router.query.project_id) ? router.query.project_id[0] : router.query.project_id;
  const scopeEnv = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment;

  useEffect(() => {
    if (scopeEnv && !env) setEnv(scopeEnv);
  }, [scopeEnv, env]);

  useEffect(() => {
    setPage(1);
  }, [team, account, env, region, q, projectId]);

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams({ cloud: 'aws', limit: String(PAGE_SIZE), page: String(page) });
    if (team.trim()) params.set('team', team.trim());
    if (account.trim()) params.set('account_id', account.trim());
    if (env.trim()) params.set('environment', env.trim());
    if (region.trim()) params.set('region', region.trim());
    if (q.trim()) params.set('q', q.trim());
    if (projectId) params.set('project_id', projectId);
    setLoading(true);
    setError('');
    setForbidden(false);
    portalFetch(`${apiUrl}/api/devops/cloud/resources?${params}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (res.status === 403) {
          setForbidden(true);
          setRows([]);
          setTotal(0);
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'Failed to load cloud resources');
        setRows(Array.isArray(data.resources) ? data.resources : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [apiUrl, router, team, account, env, region, q, projectId, page]);

  const columns: DataTableColumn<CloudResource>[] = useMemo(
    () => [
      {
        id: 'display_name',
        header: 'Name',
        cell: (row) => (
          <Link href={`/cloud-resources/${row.id}`} style={{ fontWeight: 500 }} onClick={(e) => e.stopPropagation()}>
            {row.display_name || row.resource_id}
          </Link>
        ),
      },
      { id: 'service_type', header: 'Service', cell: (row) => row.service_type },
      { id: 'team_slug', header: 'Team', cell: (row) => row.team_slug },
      { id: 'account_id', header: 'Account', cell: (row) => row.account_id },
      { id: 'environment', header: 'Env', cell: (row) => row.environment },
      { id: 'region', header: 'Region', cell: (row) => row.region },
      { id: 'status', header: 'Status', cell: (row) => row.status },
    ],
    [],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterChips: PageFilterChip[] = useMemo(
    () => [
      { key: 'project', label: 'Project scope', value: projectId ? `#${projectId}` : '' },
      { key: 'environment', label: 'Environment', value: env.trim() || scopeEnv || '' },
      { key: 'team', label: 'Team', value: team.trim() },
      { key: 'account', label: 'Account', value: account.trim() },
      { key: 'region', label: 'Region', value: region.trim() },
    ],
    [projectId, env, scopeEnv, team, account, region],
  );

  const removeChip = (key: string) => {
    switch (key) {
      case 'environment':
        setEnv('');
        break;
      case 'team':
        setTeam('');
        break;
      case 'account':
        setAccount('');
        break;
      case 'region':
        setRegion('');
        break;
      default:
        break;
    }
  };

  const clearLocalFilters = () => {
    setTeam('');
    setAccount('');
    setEnv('');
    setRegion('');
    setQ('');
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Cloud inventory - DevOps</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud"
          title="Resource inventory"
          subtitle="Read-only AWS inventory by team, account, environment, and region. Use the header ScopeBar for project and environment; refine below. Credentials never leave the API host."
        />
        {forbidden ? (
          <div className="alert alert-error" role="alert">
            You do not have permission to view cloud inventory. Ask a DevOps manager if you need access.
          </div>
        ) : null}
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="portal-surface portal-surface--table">
          <PageFilters
            search={q}
            onSearchChange={setQ}
            searchPlaceholder="Search name or resource id"
            chips={filterChips}
            onRemoveChip={removeChip}
            onClear={clearLocalFilters}
          />
          <div className="ig-table-toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <input className="input" placeholder="Team slug" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team slug" />
            <input className="input" placeholder="Account id" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account id" />
            <input className="input" placeholder="Environment" value={env} onChange={(e) => setEnv(e.target.value)} aria-label="Environment" />
            <input className="input" placeholder="Region" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" />
            <span className="ig-table-toolbar__count">
              {loading ? 'Loading…' : `${rows.length} on page · ${total} total`}
            </span>
          </div>
          {loading ? (
            <EmptyState title="Loading resources" body="Fetching inventory from the API…" />
          ) : rows.length === 0 && !forbidden ? (
            <EmptyState
              title="No resources match"
              body="Adjust filters or seed demo data by running a fresh API migration."
            />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                label="Cloud resources"
                onRowOpen={(row) => void router.push(`/cloud-resources/${row.id}`)}
              />
              {total > PAGE_SIZE ? (
                <div className="ig-table-toolbar" style={{ marginTop: 16, justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </DevOpsLayout>
  );
}
