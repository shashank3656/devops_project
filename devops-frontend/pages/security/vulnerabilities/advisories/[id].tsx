import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../context/ApiUrlContext';
import { lifecycleLabel, patchLabel, queryText, severityBadge, severityLabel, vulnRequest } from '../../../../lib/securityVuln';

type Advisory = {
  id: number;
  canonical_id: string;
  title: string;
  summary?: string;
  severity: string;
  ecosystem?: string;
  package_name?: string;
  first_fixed_version?: string;
  kev: boolean;
  epss?: number;
  source_url?: string;
  withdrawn: boolean;
  affected_services: number;
  count_note?: string;
};

type Finding = {
  id: number;
  repository: string;
  service?: string;
  package_name: string;
  installed_version: string;
  lifecycle: string;
  patch_state: string;
  severity: string;
};

export default function VulnAdvisoryDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = Number(queryText(router.query.id));
  const [advisory, setAdvisory] = useState<Advisory | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const result = await vulnRequest(apiUrl, `/api/devops/security/advisories/${id}`);
    if (result.status !== 200) {
      setError('That advisory was not found.');
      setAdvisory(null);
      return;
    }
    setAdvisory(result.body.advisory as Advisory);
    setFindings(Array.isArray(result.body.findings) ? result.body.findings as Finding[] : []);
  }, [apiUrl, id]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [load, router.isReady]);

  const columns: DataTableColumn<Finding>[] = [
    { id: 'id', header: 'Finding', cell: (item) => <Link href={`/security/vulnerabilities/findings/${item.id}`}>{item.package_name}@{item.installed_version || 'unresolved'}</Link> },
    { id: 'repo', header: 'Repository', cell: (item) => item.repository || 'Unknown' },
    { id: 'svc', header: 'Service', cell: (item) => item.service || 'Unknown' },
    { id: 'sev', header: 'Severity', cell: (item) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
    { id: 'fix', header: 'Patch', cell: (item) => patchLabel(item.patch_state) },
    { id: 'state', header: 'State', cell: (item) => lifecycleLabel(item.lifecycle) },
  ];

  return (
    <DevOpsLayout>
      <Head>
        <title>{advisory ? `${advisory.canonical_id} - Advisories` : 'Advisory - OpsTrellis'}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security</span>
            <h1 className="portal-page__title">{advisory?.canonical_id || 'Advisory'}</h1>
            <p className="portal-page__subtitle">Public intelligence. Confirmed repository matches are listed below. This page is not organization exposure by itself.</p>
          </div>
          <Link className="btn btn-secondary" href="/security/vulnerabilities?tab=advisories">Back to advisories</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {advisory ? (
          <>
            <dl className="sre-meta">
              <div className="sre-meta__item"><dt>Severity</dt><dd><span className={severityBadge(advisory.severity)}>{severityLabel(advisory.severity)}</span></dd></div>
              <div className="sre-meta__item"><dt>KEV</dt><dd>{advisory.kev ? 'Known exploitation' : 'Not listed'}</dd></div>
              <div className="sre-meta__item"><dt>EPSS</dt><dd>{advisory.epss ? `${Math.round(advisory.epss * 1000) / 10}%` : 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Package</dt><dd>{advisory.package_name ? `${advisory.ecosystem || ''} ${advisory.package_name}`.trim() : 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>First fixed version</dt><dd>{advisory.first_fixed_version || 'No known fix'}</dd></div>
              <div className="sre-meta__item"><dt>Source</dt><dd>{advisory.source_url ? <a href={advisory.source_url} target="_blank" rel="noreferrer">Open advisory</a> : 'Unknown'}</dd></div>
            </dl>
            <p className="form-section__copy">{advisory.summary || advisory.title}</p>
            <p className="form-section__copy">{advisory.count_note || 'Confirmed matches below are repository evidence, not a global count.'}</p>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Your repository matches</h2>
                  <p className="portal-surface__subtitle">{advisory.withdrawn ? 'This advisory is withdrawn. Existing history is retained.' : `${advisory.affected_services} confirmed service matches in your authorized scope.`}</p>
                </div>
              </div>
              <DataTable
                label="Repository matches for this advisory"
                columns={columns}
                rows={findings}
                rowKey={(item) => String(item.id)}
                empty={<EmptyState title="No matches in available inventory" body="A Critical advisory here is not proof that a registered repository is affected." />}
              />
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
