import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, EmptyState, formatOperationalTime, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../context/ApiUrlContext';
import { downloadJSONFile, lifecycleLabel, patchLabel, queryText, reachabilityLabel, severityBadge, severityLabel, vulnRequest } from '../../../../lib/securityVuln';

type Service = {
  service_id: number;
  service: string;
  repository: string;
  project_name?: string;
  team?: string;
  technologies?: string[];
  critical_findings: number;
  high_findings: number;
  patch_readiness: string;
  coverage: string;
  last_scan_at?: string;
};

type Finding = {
  id: number;
  canonical_id: string;
  title: string;
  severity: string;
  lifecycle: string;
  patch_state: string;
  package_name: string;
  installed_version: string;
  reachability?: string;
};

type Dep = {
  ecosystem: string;
  package_name: string;
  version: string;
  path?: string;
  usage?: string;
  resolved?: boolean;
  reachability?: string;
};

type Plan = { id: number; label: string; package_name: string; current_version: string; target_version: string; status: string };
type Scan = { id: number; state: string; stage: string; commit_sha?: string; created_at?: string; error?: string; finding_count?: number; coverage_note?: string };
type Runtime = { kind: string; value: string; provenance: string; path?: string; note?: string };
type Deployment = { id: number; environment: string; digest: string; commit_sha?: string; has_sbom: boolean; created_at?: string; note?: string };

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'vulnerabilities', label: 'Vulnerabilities' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'plan', label: 'Patch plan' },
  { id: 'history', label: 'Scan history' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export default function VulnServiceDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = Number(queryText(router.query.id));
  const requested = queryText(router.query.tab);
  const tab: Tab = TABS.some((item) => item.id === requested) ? requested as Tab : 'summary';
  const [service, setService] = useState<Service | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [deps, setDeps] = useState<Dep[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [runtime, setRuntime] = useState<Runtime[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState('');
  const [environment, setEnvironment] = useState('');
  const [deployCommit, setDeployCommit] = useState('');
  const [deploySbom, setDeploySbom] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const result = await vulnRequest(apiUrl, `/api/devops/security/services/${id}`);
    if (result.status !== 200) {
      setError('That service was not found in your authorized projects.');
      setService(null);
      return;
    }
    setService(result.body.service as Service);
    setFindings(Array.isArray(result.body.findings) ? result.body.findings as Finding[] : []);
    setDeps(Array.isArray(result.body.dependencies) ? result.body.dependencies as Dep[] : []);
    setPlans(Array.isArray(result.body.plans) ? result.body.plans as Plan[] : []);
    setScans(Array.isArray(result.body.scans) ? result.body.scans as Scan[] : []);
    setRuntime(Array.isArray(result.body.runtime) ? result.body.runtime as Runtime[] : []);
    setDeployments(Array.isArray(result.body.deployments) ? result.body.deployments as Deployment[] : []);
  }, [apiUrl, id]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [load, router.isReady]);

  async function recordDeployment() {
    let sbom: unknown;
    if (deploySbom.trim()) {
      try {
        sbom = JSON.parse(deploySbom);
      } catch {
        setError('SBOM must be JSON.');
        return;
      }
    }
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/deployments', 'POST', {
      service_id: id, environment, digest, commit_sha: deployCommit, sbom,
    });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The deployment digest could not be saved.');
      return;
    }
    setNotice('Digest recorded. Images were not pulled and production was not patched.');
    setDigest('');
    setDeploySbom('');
    await load();
  }

  async function downloadScanInventory(scanId: number) {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/scans/${scanId}/inventory`);
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'No stored inventory for that scan. Coverage is Unknown.');
      return;
    }
    const slug = (service?.repository || 'inventory').replace(/[^a-zA-Z0-9._-]+/g, '-');
    downloadJSONFile(`${slug}-scan-${scanId}-sbom.json`, result.body.inventory ?? result.body);
  }

  async function cancelScan(scanId: number) {
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/scans/${scanId}/cancel`, 'POST', {});
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The queued scan could not be cancelled.');
      return;
    }
    setNotice(typeof result.body.note === 'string' ? result.body.note : 'Queued scan cancelled. History and open findings were kept. This is not Fixed.');
    await load();
  }

  const findingColumns: DataTableColumn<Finding>[] = [
    { id: 'id', header: 'Advisory', cell: (item) => <Link href={`/security/vulnerabilities/findings/${item.id}`}>{item.canonical_id}</Link> },
    { id: 'pkg', header: 'Package', cell: (item) => `${item.package_name}@${item.installed_version || 'unresolved'}` },
    { id: 'sev', header: 'Severity', cell: (item) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
    { id: 'fix', header: 'Patch', cell: (item) => patchLabel(item.patch_state) },
    { id: 'reach', header: 'Reachability', cell: (item) => reachabilityLabel(item.reachability) },
    { id: 'state', header: 'State', cell: (item) => lifecycleLabel(item.lifecycle) },
  ];

  return (
    <DevOpsLayout>
      <Head>
        <title>{service ? `${service.service} - Vulnerabilities` : 'Service security - OpsTrellis'}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security</span>
            <h1 className="portal-page__title">{service?.service || 'Service security'}</h1>
            <p className="portal-page__subtitle">Repository findings for this service. Empty coverage is Unknown, never Secure.</p>
          </div>
          <Link className="btn btn-secondary" href="/security/vulnerabilities">Back to services</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {service ? (
          <>
            <dl className="sre-meta">
              <div className="sre-meta__item"><dt>Repository</dt><dd>{service.repository || 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Coverage</dt><dd>{service.coverage}</dd></div>
              <div className="sre-meta__item"><dt>Critical / High</dt><dd>{service.critical_findings} / {service.high_findings}</dd></div>
              <div className="sre-meta__item"><dt>Patch readiness</dt><dd>{service.patch_readiness || 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Last scan</dt><dd>{service.last_scan_at ? formatOperationalTime(service.last_scan_at) : 'Unknown'}</dd></div>
              <div className="sre-meta__item"><dt>Team</dt><dd>{service.team || 'Unknown'}</dd></div>
            </dl>
            <nav className="ops-tabs" aria-label="Service security">
              {TABS.map((item) => (
                <Link key={item.id} href={{ pathname: `/security/vulnerabilities/services/${id}`, query: item.id === 'summary' ? {} : { tab: item.id } }} className={tab === item.id ? 'is-current' : undefined}>{item.label}</Link>
              ))}
            </nav>
            {tab === 'summary' ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Summary</h2>
                    <p className="portal-surface__subtitle">Declared runtime is not observed production runtime.</p>
                  </div>
                </div>
                <p className="form-section__copy">Technologies: {service.technologies && service.technologies.length ? service.technologies.join(' · ') : 'Not assessed'}</p>
                {runtime.length ? (
                  <ul className="sre-monitor-list">
                    {runtime.map((item, index) => (
                      <li key={`${item.kind}-${index}`}>
                        <strong>{item.kind} {item.value}</strong>
                        <span>{item.provenance} · {item.path || 'Unknown'} · {item.note}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="form-section__copy">No declared runtime observations stored yet.</p>}
                <h3 className="portal-surface__title">Deployment digest</h3>
                <p className="form-section__copy">Record an observed image digest. Images are not pulled. Without a digest-linked SBOM, production patch state stays Unknown.</p>
                <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void recordDeployment(); }}>
                  <label className="label">Environment<input className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} /></label>
                  <label className="label">Digest<input className="input" value={digest} onChange={(event) => setDigest(event.target.value)} placeholder="sha256:…" /></label>
                  <label className="label">Commit SHA<input className="input" value={deployCommit} onChange={(event) => setDeployCommit(event.target.value)} /></label>
                  <label className="label">Optional SBOM JSON<textarea className="input" rows={4} value={deploySbom} onChange={(event) => setDeploySbom(event.target.value)} /></label>
                  <div className="portal-form-actions">
                    <button type="submit" className="btn btn-secondary" disabled={busy}>Record digest</button>
                  </div>
                </form>
                {deployments.length ? (
                  <ul className="sre-monitor-list">
                    {deployments.map((item) => (
                      <li key={item.id}>
                        <strong>{item.environment} · {item.digest}</strong>
                        <span>{item.has_sbom ? 'SBOM attached' : 'No SBOM'} · {item.created_at ? formatOperationalTime(item.created_at) : 'Unknown'}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
            {tab === 'vulnerabilities' ? (
              <section className="portal-surface">
                <DataTable
                  label="Service findings"
                  columns={findingColumns}
                  rows={findings}
                  rowKey={(item) => String(item.id)}
                  empty={<EmptyState title="No matches in scanned scope" body="This is not a secure label if coverage is still Unknown." />}
                />
              </section>
            ) : null}
            {tab === 'dependencies' ? (
              <section className="portal-surface">
                <table className="data-table">
                  <thead>
                    <tr><th>Package</th><th>Version</th><th>Usage</th><th>Reachability</th><th>Path</th></tr>
                  </thead>
                  <tbody>
                    {deps.length ? deps.map((item, index) => (
                      <tr key={`${item.package_name}-${index}`}>
                        <td>{item.ecosystem} {item.package_name}</td>
                        <td>{item.version || (item.resolved === false ? 'Unresolved' : 'Unknown')}</td>
                        <td>{item.usage || 'dependency'}</td>
                        <td>{reachabilityLabel(item.reachability)}</td>
                        <td>{item.path || 'Unknown'}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5}>No stored inventory for this repository.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>
            ) : null}
            {tab === 'plan' ? (
              <section className="portal-surface">
                <DataTable
                  label="Service patch plans"
                  columns={[
                    { id: 'label', header: 'Plan', cell: (item: Plan) => item.label },
                    { id: 'pkg', header: 'Upgrade', cell: (item: Plan) => `${item.package_name} ${item.current_version} → ${item.target_version}` },
                    { id: 'status', header: 'Status', cell: (item: Plan) => patchLabel(item.status) },
                  ]}
                  rows={plans}
                  rowKey={(item) => String(item.id)}
                  empty={<EmptyState title="No patch plans" body="Plans appear after a confirmed match has a source-supported fix version. There is no Apply patch action." />}
                />
              </section>
            ) : null}
            {tab === 'history' ? (
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Scan history</h2>
                    <p className="portal-surface__subtitle">Jobs for this service’s repository, including hosted scans started from Config. Queued scans can be cancelled; running scans keep going.</p>
                  </div>
                  <Link className="btn btn-secondary btn-sm" href="/security/vulnerabilities?tab=history">Open History</Link>
                </div>
                <DataTable
                  label="Service scan history"
                  columns={[
                    { id: 'id', header: 'Job', cell: (item: Scan) => `#${item.id}` },
                    { id: 'state', header: 'State', cell: (item: Scan) => `${item.state} · ${item.stage}` },
                    { id: 'hits', header: 'Findings', cell: (item: Scan) => String(item.finding_count ?? 0) },
                    { id: 'cov', header: 'Coverage', cell: (item: Scan) => item.coverage_note || 'No coverage notes' },
                    { id: 'commit', header: 'Commit', cell: (item: Scan) => item.commit_sha ? item.commit_sha.slice(0, 12) : 'Unknown' },
                    { id: 'when', header: 'Queued', cell: (item: Scan) => (item.created_at ? formatOperationalTime(item.created_at) : 'Unknown') },
                    { id: 'err', header: 'Error', cell: (item: Scan) => item.error || 'None recorded' },
                    { id: 'sbom', header: '', cell: (item: Scan) => (
                      <span className="sec-vuln-row-actions">
                        {item.state === 'queued' ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void cancelScan(item.id)}>Cancel</button> : null}
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void downloadScanInventory(item.id)}>Download inventory</button>
                      </span>
                    ) },
                  ]}
                  rows={scans}
                  rowKey={(item) => String(item.id)}
                  empty={<EmptyState title="No scans yet" body="Scan this service from the services list, or scan its repository on Config. Empty history is not a secure label." />}
                />
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
