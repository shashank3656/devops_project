import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, EmptyState, formatOperationalTime, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../context/ApiUrlContext';
import { accessLabel, asRows, collectionModeLabel, vulnRequest } from '../../../../lib/securityVuln';

type RepoConfig = {
  id: number;
  repository: string;
  collection_mode: string;
  owner_team?: string;
  branch: string;
  access_state?: string;
  access_detail?: string;
  last_scheduled_at?: string;
  schedule_minutes: number;
};

export default function VulnPolicyIndexPage() {
  const apiUrl = useApiUrl();
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/repositories?probe=1');
    setLoading(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Repositories could not be loaded.');
      return;
    }
    setRepos(asRows<RepoConfig>(result.body.repositories));
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataTableColumn<RepoConfig>[] = [
    { id: 'repo', header: 'Repository', cell: (item) => item.repository },
    { id: 'mode', header: 'Collection', cell: (item) => collectionModeLabel(item.collection_mode) },
    { id: 'access', header: 'Token', cell: (item) => <span title={item.access_detail || ''}>{accessLabel(item.access_state)}</span> },
    { id: 'branch', header: 'Branch', cell: (item) => item.branch || 'main' },
    { id: 'team', header: 'Owner', cell: (item) => item.owner_team || 'Unknown' },
    { id: 'sched', header: 'Last scheduled', cell: (item) => (item.last_scheduled_at ? formatOperationalTime(item.last_scheduled_at) : (item.schedule_minutes >= 15 ? `Every ${item.schedule_minutes}m` : 'Off')) },
    { id: 'open', header: '', cell: (item) => <Link className="btn btn-secondary btn-sm" href={`/security/vulnerabilities/policy/${item.id}`}>Edit policy</Link> },
  ];

  return (
    <DevOpsLayout>
      <Head>
        <title>Repository policy - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security</span>
            <h1 className="portal-page__title">Repository policy</h1>
            <p className="portal-page__subtitle">Choose a registered repository. This page never displays secret values.</p>
          </div>
          <Link className="btn btn-secondary" href="/security/vulnerabilities?tab=configuration">Back to Config</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <section className="portal-surface">
          <DataTable
            label="Repositories"
            columns={columns}
            rows={repos}
            rowKey={(item) => String(item.id)}
            empty={<EmptyState title={loading ? 'Loading repositories' : 'No repositories registered'} body="Register a repository on Config, then return here to set collection and alerts." />}
          />
        </section>
      </div>
    </DevOpsLayout>
  );
}
