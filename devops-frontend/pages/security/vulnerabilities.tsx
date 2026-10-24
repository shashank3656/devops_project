import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CopyButton, DataTable, EmptyState, formatOperationalTime, Stepper, type DataTableColumn } from '@infragate/ui';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { asRows, lifecycleLabel, matchSourceLabel, patchLabel, queryText, reachabilityLabel, severityBadge, severityLabel, vulnRequest, vulnTab, VULN_PRIMARY_TABS, VULN_SECONDARY_TABS, type VulnTab } from '../../lib/securityVuln';
import { useWorkspaceScope } from '../../shared-ui/useWorkspaceScope';

const DEVOPS_USER_KEY = 'devops_user';

const WIZARD_STEPS = [
  { id: 'connection', label: 'Connection' },
  { id: 'repository', label: 'Repository' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'policy', label: 'Policy' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'review', label: 'Review' },
];

function collectionModeLabel(value: string): string {
  switch (value) {
    case 'agent':
      return 'Private outbound agent';
    case 'ci':
      return 'CI inventory / SBOM upload';
    default:
      return 'Hosted collector';
  }
}

type Overview = {
  critical_findings?: number;
  high_findings?: number;
  affected_services?: number;
  registered_services?: number;
  scanned_repositories?: number;
  kev_matches?: number;
  overdue?: number;
  intelligence_synced_at?: string;
  intel_new_matches?: number;
  intel_repos_assessed?: number;
  intel_open_matches?: number;
  unscanned_repositories?: number;
  github_token_configured?: boolean;
  count_note?: string;
};

type ServiceRow = {
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

type AdvisoryRow = {
  id: number;
  canonical_id: string;
  title: string;
  severity: string;
  ecosystem?: string;
  package_name?: string;
  first_fixed_version?: string;
  kev: boolean;
  epss?: number;
  fetched_at?: string;
  withdrawn: boolean;
  affected_services: number;
  count_note?: string;
  source_url?: string;
};

type FindingRow = {
  id: number;
  repository: string;
  service?: string;
  canonical_id: string;
  title: string;
  severity: string;
  priority: string;
  lifecycle: string;
  patch_state: string;
  package_name: string;
  installed_version: string;
  first_fixed_version?: string;
  owner?: string;
  kev: boolean;
  due_at?: string;
  last_seen_at?: string;
  service_id?: number;
  reachability?: string;
  match_source?: string;
};

type ScanRow = {
  id: number;
  state: string;
  stage: string;
  repository: string;
  commit_sha?: string;
  error?: string;
  discovered_modules: number;
  assessed_modules: number;
  created_at?: string;
};

type PlanRow = {
  id: number;
  repository: string;
  package_name: string;
  current_version: string;
  target_version: string;
  action: string;
  status: string;
  label: string;
  estimated: boolean;
};

type SourceRow = {
  provider: string;
  status: string;
  enabled: boolean;
  last_success_at?: string;
  last_error?: string;
};

type AgentRow = { id: number; name: string; status: string; version?: string; last_heartbeat_at?: string };
type CampaignRow = { canonical_id: string; title: string; severity: string; count: number; services?: string[] };
type ComparisonRow = { id: number; pr_number: number; repository: string; state: string; coverage: string; introduced_critical: number; introduced_high: number; removed_count: number; note?: string };
type NewDepRow = { repository: string; ecosystem: string; package_name: string; version: string; note?: string };
type RepoConfig = { id: number; repository: string; provider?: string; collection_mode: string; owner_team?: string; schedule_minutes: number; alert_min_severity: string; allow_fork_prs: boolean; enforce_pr_gate?: boolean; exclusions?: string; branch: string };

function known(value?: string): string {
  const text = (value || '').trim();
  return text || 'Unknown';
}

export default function GlobalVulnerabilitiesPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const { scope } = useWorkspaceScope();
  const tab = router.isReady ? vulnTab(router.query.tab) : 'services';
  const projectId = router.isReady ? queryText(router.query.project_id) || scope.projectId : '';
  const serviceId = router.isReady ? queryText(router.query.service_id) : '';
  const [overview, setOverview] = useState<Overview>({});
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [advisories, setAdvisories] = useState<AdvisoryRow[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonRow[]>([]);
  const [newDeps, setNewDeps] = useState<NewDepRow[]>([]);
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [hosted, setHosted] = useState(false);
  const [hostedNote, setHostedNote] = useState('');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isManager, setIsManager] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [bootstrap, setBootstrap] = useState('');
  const [sbomRepo, setSbomRepo] = useState('');
  const [sbomCommit, setSbomCommit] = useState('');
  const [sbomText, setSbomText] = useState('');
  const [prRepo, setPrRepo] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardRepo, setWizardRepo] = useState('');
  const [wizardMode, setWizardMode] = useState('hosted');
  const [wizardTeam, setWizardTeam] = useState('');
  const [wizardAlert, setWizardAlert] = useState('high');
  const [wizardSchedule, setWizardSchedule] = useState('0');
  const [wizardForks, setWizardForks] = useState(false);
  const [wizardGate, setWizardGate] = useState(false);
  const [wizardExclusions, setWizardExclusions] = useState('');
  const [kevOnly, setKevOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [intelOnly, setIntelOnly] = useState(false);
  const [teamFilter, setTeamFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [patchFilter, setPatchFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [newRepo, setNewRepo] = useState('');
  const [newRepoBranch, setNewRepoBranch] = useState('main');
  const [compareDetail, setCompareDetail] = useState<{ id: number; items: { classification: string; canonical_id: string; package_name: string; severity: string; base_version?: string; head_version?: string }[] } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEVOPS_USER_KEY);
      const parsed = raw ? JSON.parse(raw) as { role?: string; devops_profile?: { is_manager?: boolean } } : null;
      setIsManager(Boolean(parsed?.devops_profile?.is_manager) || parsed?.role === 'admin');
    } catch {
      setIsManager(false);
    }
  }, []);

  const setTab = (next: VulnTab) => {
    const { tab: _tab, ...rest } = router.query;
    const query = next === 'services' ? rest : { ...rest, tab: next };
    void router.replace({ pathname: '/security/vulnerabilities', query }, undefined, { shallow: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (serviceId) params.set('service_id', serviceId);
    const projectQuery = params.toString() ? `?${params.toString()}` : '';
    const [overviewRes, serviceRes, advisoryRes, findingRes, scanRes, planRes, sourceRes, campaignRes, compareRes, depRes, repoRes] = await Promise.all([
      vulnRequest(apiUrl, '/api/devops/security/overview'),
      vulnRequest(apiUrl, `/api/devops/security/services${projectQuery}`),
      vulnRequest(apiUrl, '/api/devops/security/advisories?severity=all'),
      vulnRequest(apiUrl, `/api/devops/security/findings${projectQuery}`),
      vulnRequest(apiUrl, '/api/devops/security/scans'),
      vulnRequest(apiUrl, '/api/devops/security/plans'),
      vulnRequest(apiUrl, '/api/devops/security/sources'),
      vulnRequest(apiUrl, '/api/devops/security/campaigns'),
      vulnRequest(apiUrl, '/api/devops/security/pr-comparisons'),
      vulnRequest(apiUrl, '/api/devops/security/new-dependencies'),
      vulnRequest(apiUrl, '/api/devops/security/repositories'),
    ]);
    if (overviewRes.status !== 200) {
      setError(typeof overviewRes.body.error === 'string' ? overviewRes.body.error : 'This workspace could not be loaded.');
      setLoading(false);
      return;
    }
    setOverview(overviewRes.body as Overview);
    setServices(asRows<ServiceRow>(serviceRes.body.services));
    setAdvisories(asRows<AdvisoryRow>(advisoryRes.body.advisories));
    setFindings(asRows<FindingRow>(findingRes.body.findings));
    setScans(asRows<ScanRow>(scanRes.body.scans));
    setPlans(asRows<PlanRow>(planRes.body.plans));
    setSources(asRows<SourceRow>(sourceRes.body.sources));
    setAgents(asRows<AgentRow>(sourceRes.body.private_agents));
    setCampaigns(asRows<CampaignRow>(campaignRes.body.campaigns));
    setComparisons(asRows<ComparisonRow>(compareRes.body.comparisons));
    setNewDeps(asRows<NewDepRow>(depRes.body.dependencies));
    setRepos(asRows<RepoConfig>(repoRes.body.repositories));
    setHosted(Boolean(sourceRes.body.hosted_collector));
    setHostedNote(typeof sourceRes.body.hosted_collector_note === 'string' ? sourceRes.body.hosted_collector_note : '');
    setLoading(false);
  }, [apiUrl, projectId, serviceId]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [load, router.isReady]);

  useEffect(() => {
    const item = repos.find((row) => String(row.id) === wizardRepo);
    if (!item) return;
    setWizardMode(item.collection_mode || 'hosted');
    setWizardTeam(item.owner_team || '');
    setWizardAlert(item.alert_min_severity || 'high');
    setWizardSchedule(String(item.schedule_minutes || 0));
    setWizardForks(Boolean(item.allow_fork_prs));
    setWizardGate(Boolean(item.enforce_pr_gate));
    setWizardExclusions(item.exclusions || '');
  }, [repos, wizardRepo]);

  const showScorecards = tab === 'services' || tab === 'advisories' || tab === 'findings' || tab === 'remediation' || tab === 'campaigns';
  const teams = useMemo(() => Array.from(new Set(services.map((item) => item.team).filter((item): item is string => Boolean(item)))), [services]);
  const technologies = useMemo(() => Array.from(new Set(services.flatMap((item) => item.technologies || []))), [services]);

  const visibleServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((item) => {
      if (severity === 'critical' && item.critical_findings <= 0) return false;
      if (severity === 'high' && item.high_findings <= 0) return false;
      if (teamFilter && item.team !== teamFilter) return false;
      if (techFilter && !(item.technologies || []).includes(techFilter)) return false;
      if (patchFilter === 'fix_available' && !(item.patch_readiness || '').toLowerCase().includes('candidate')) return false;
      if (patchFilter === 'no_known_fix' && !(item.patch_readiness || '').toLowerCase().includes('no action')) return false;
      if (!q) return true;
      return `${item.service} ${item.repository} ${item.team || ''} ${(item.technologies || []).join(' ')}`.toLowerCase().includes(q);
    });
  }, [patchFilter, search, services, severity, teamFilter, techFilter]);

  const visibleAdvisories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return advisories.filter((item) => {
      if (severity && item.severity !== severity) return false;
      if (kevOnly && !item.kev) return false;
      if (!q) return true;
      return `${item.canonical_id} ${item.title} ${item.package_name || ''}`.toLowerCase().includes(q);
    });
  }, [advisories, kevOnly, search, severity]);

  const visibleFindings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((item) => {
      if (severity && item.severity !== severity) return false;
      if (unassignedOnly && (item.owner || '').trim()) return false;
      if (intelOnly && item.match_source !== 'intel') return false;
      if (lifecycleFilter && item.lifecycle !== lifecycleFilter) return false;
      if (patchFilter && item.patch_state !== patchFilter) return false;
      if (teamFilter && !`${item.service || ''} ${item.repository}`.toLowerCase().includes(teamFilter.toLowerCase())) return false;
      if (!q) return true;
      return `${item.canonical_id} ${item.package_name} ${item.repository} ${item.service || ''} ${item.owner || ''}`.toLowerCase().includes(q);
    });
  }, [findings, intelOnly, lifecycleFilter, patchFilter, search, severity, teamFilter, unassignedOnly]);

  async function scanSelected() {
    if (!selected.length) {
      setError('Select at least one service.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/scans', 'POST', { service_ids: selected });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The scan could not be queued.');
      return;
    }
    setNotice('Scan queued for the selected repositories. A shared repository is scanned once.');
    setSelected([]);
    void load();
  }

  async function refreshIntelligence() {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, '/api/devops/security/intelligence/sync', 'POST', {});
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Intelligence sync could not start.');
      return;
    }
    setNotice('Intelligence sync queued. New public advisories will be matched against stored lockfiles; the browser does not fetch feeds.');
  }

  async function enrollAgent() {
    if (!agentName.trim()) {
      setError('Agent name is required.');
      return;
    }
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/agents', 'POST', { name: agentName.trim() });
    setBusy(false);
    if (result.status !== 201) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The agent could not be enrolled.');
      return;
    }
    setBootstrap(typeof result.body.bootstrap_token === 'string' ? result.body.bootstrap_token : '');
    setNotice('Bootstrap token is shown once. The API stores only a hash.');
    setAgentName('');
    void load();
  }

  async function uploadSbom() {
    const repoId = Number(sbomRepo);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(sbomText);
    } catch {
      setError('SBOM must be JSON.');
      return;
    }
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/inventories', 'POST', {
      repository_id: repoId, commit_sha: sbomCommit.trim(), sbom: parsed,
    });
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The inventory could not be accepted.');
      return;
    }
    setNotice('SBOM inventory accepted. Image OS packages match from the uploaded document; images are not pulled.');
    void load();
  }

  async function comparePr() {
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/pr-comparisons', 'POST', {
      repository_id: Number(prRepo), pr_number: Number(prNumber),
    });
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'The pull request could not be compared.');
      return;
    }
    setNotice('Comparison stored against immutable base and head commits. Incomplete coverage is never a clean verdict.');
    void load();
  }

  async function saveWizard() {
    const repoId = Number(wizardRepo);
    if (!repoId) {
      setError('Select a registered repository.');
      return;
    }
    setBusy(true);
    const result = await vulnRequest(apiUrl, `/api/devops/security/repositories/${repoId}`, 'PATCH', {
      collection_mode: wizardMode,
      owner_team: wizardTeam,
      alert_min_severity: wizardAlert,
      schedule_minutes: Number(wizardSchedule) || 0,
      allow_fork_prs: wizardForks,
      enforce_pr_gate: wizardGate,
      exclusions: wizardExclusions,
    });
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Repository policy could not be saved.');
      return;
    }
    setNotice('Repository policy saved. Tokens stay on the API as environment names.');
    void load();
  }

  async function registerRepo() {
    setBusy(true);
    const result = await vulnRequest(apiUrl, '/api/devops/security/repositories', 'POST', {
      repository: newRepo.trim(), branch: newRepoBranch.trim() || 'main',
    });
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Repository could not be registered.');
      return;
    }
    setNotice('Repository registered. Scan still needs a successful inventory.');
    setNewRepo('');
    void load();
  }

  async function openComparison(id: number) {
    const result = await vulnRequest(apiUrl, `/api/devops/security/pr-comparisons/${id}`);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Comparison detail could not be loaded.');
      return;
    }
    const comparison = result.body.comparison as { id: number; items?: { classification: string; canonical_id: string; package_name: string; severity: string; base_version?: string; head_version?: string }[] };
    setCompareDetail({ id: comparison.id, items: Array.isArray(comparison.items) ? comparison.items : [] });
  }

  const serviceColumns: DataTableColumn<ServiceRow>[] = useMemo(() => [
    {
      id: 'select',
      header: '',
      cell: (item) => (
        <input
          type="checkbox"
          checked={selected.includes(item.service_id)}
          onChange={(event) => {
            setSelected((current) => event.target.checked ? [...current, item.service_id] : current.filter((id) => id !== item.service_id));
          }}
          aria-label={`Select ${item.service}`}
        />
      ),
    },
    {
      id: 'service',
      header: 'Service / repository',
      cell: (item) => (
        <div className="ig-cell-stack">
          <Link className="ig-cell-title" href={`/security/vulnerabilities/services/${item.service_id}`}>{item.service || 'Unknown'}</Link>
          <span className="ig-cell-meta">{known(item.repository)}</span>
        </div>
      ),
    },
    {
      id: 'tech',
      header: 'Technology',
      cell: (item) => (item.technologies && item.technologies.length ? item.technologies.join(' · ') : 'Not assessed'),
    },
    {
      id: 'findings',
      header: 'Findings',
      cell: (item) => (
        item.critical_findings + item.high_findings > 0
          ? <button type="button" className={item.critical_findings ? 'sec-sev sec-sev--critical' : 'sec-sev sec-sev--high'} onClick={() => { setSeverity(item.critical_findings ? 'critical' : 'high'); setTab('findings'); }}>{item.critical_findings ? `${item.critical_findings} Critical` : `${item.high_findings} High`}</button>
          : item.coverage === 'Not scanned' ? 'Not scanned' : 'No matches in scanned scope'
      ),
    },
    {
      id: 'patch',
      header: 'Patch readiness',
      cell: (item) => item.patch_readiness || 'Unknown',
    },
    {
      id: 'coverage',
      header: 'Coverage / action',
      cell: (item) => (
        <div className="ig-cell-stack">
          <span className="ig-cell-title">{item.coverage}</span>
          <span className="ig-cell-meta">{item.last_scan_at ? formatOperationalTime(item.last_scan_at) : 'No successful scan'}</span>
          <Link href={`/security/vulnerabilities/services/${item.service_id}`}>View security</Link>
        </div>
      ),
    },
  ], [selected]);

  const advisoryColumns: DataTableColumn<AdvisoryRow>[] = useMemo(() => [
    { id: 'id', header: 'Advisory', cell: (item) => <Link href={`/security/vulnerabilities/advisories/${item.id}`}>{item.canonical_id}</Link> },
    { id: 'title', header: 'Title', cell: (item) => item.title || 'Unknown' },
    { id: 'sev', header: 'Severity', cell: (item) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
    { id: 'pkg', header: 'Package', cell: (item) => item.package_name ? `${item.ecosystem || ''} ${item.package_name}`.trim() : 'Unknown' },
    { id: 'fix', header: 'First fixed version', cell: (item) => item.first_fixed_version || 'No known fix' },
    { id: 'kev', header: 'KEV', cell: (item) => (item.kev ? 'Known exploitation' : 'Not listed') },
    { id: 'epss', header: 'EPSS', cell: (item) => (item.epss ? `${Math.round(item.epss * 1000) / 10}%` : 'Unknown') },
    { id: 'local', header: 'Your affected services', cell: (item) => (item.affected_services ? `${item.affected_services} confirmed` : 'No matches in available inventory') },
  ], []);

  const findingColumns: DataTableColumn<FindingRow>[] = useMemo(() => [
    { id: 'adv', header: 'Advisory', cell: (item) => <Link href={`/security/vulnerabilities/findings/${item.id}`}>{item.canonical_id}</Link> },
    { id: 'pkg', header: 'Package', cell: (item) => `${item.package_name}@${item.installed_version || 'unresolved'}` },
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'sev', header: 'Severity', cell: (item) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
    { id: 'priority', header: 'Priority', cell: (item) => item.priority || 'review' },
    { id: 'fix', header: 'Fix', cell: (item) => item.patch_state === 'fix_available' ? <span className="sec-sev sec-sev--high">Fix available{item.first_fixed_version ? ` · ${item.first_fixed_version}` : ''}</span> : (item.first_fixed_version || patchLabel(item.patch_state)) },
    { id: 'reach', header: 'Reachability', cell: (item) => reachabilityLabel(item.reachability) },
    { id: 'origin', header: 'Origin', cell: (item) => matchSourceLabel(item.match_source) },
    { id: 'owner', header: 'Owner', cell: (item) => known(item.owner) },
    { id: 'due', header: 'Due', cell: (item) => (item.due_at ? formatOperationalTime(item.due_at) : 'None') },
    { id: 'seen', header: 'Last scan', cell: (item) => (item.last_seen_at ? formatOperationalTime(item.last_seen_at) : 'Unknown') },
    { id: 'state', header: 'State', cell: (item) => lifecycleLabel(item.lifecycle) },
  ], []);

  const scanColumns: DataTableColumn<ScanRow>[] = useMemo(() => [
    { id: 'id', header: 'Job', cell: (item) => `#${item.id}` },
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'state', header: 'State', cell: (item) => `${item.state} · ${item.stage}` },
    { id: 'mods', header: 'Modules', cell: (item) => `${item.assessed_modules} assessed / ${item.discovered_modules} discovered` },
    { id: 'commit', header: 'Commit', cell: (item) => item.commit_sha ? item.commit_sha.slice(0, 12) : 'Unknown' },
    { id: 'when', header: 'Queued', cell: (item) => (item.created_at ? formatOperationalTime(item.created_at) : 'Unknown') },
    { id: 'err', header: 'Error', cell: (item) => item.error || 'None recorded' },
  ], []);

  async function openPatchPR(planId: number) {
    setBusy(true);
    setError('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/plans/${planId}/pr`, 'POST', {});
    setBusy(false);
    if (result.status !== 202) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'A patch pull request could not be opened.');
      return;
    }
    setNotice('Draft patch proposal opened. OpsTrellis does not merge it and does not patch production.');
    void load();
  }

  const repoColumns: DataTableColumn<RepoConfig>[] = useMemo(() => [
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'provider', header: 'Provider', cell: (item) => item.provider || 'github' },
    { id: 'mode', header: 'Collection', cell: (item) => collectionModeLabel(item.collection_mode) },
    { id: 'branch', header: 'Branch', cell: (item) => item.branch || 'main' },
    { id: 'team', header: 'Owner', cell: (item) => known(item.owner_team) },
    { id: 'gate', header: 'PR gate', cell: (item) => (item.enforce_pr_gate ? 'Enforced' : 'Informational') },
    { id: 'edit', header: '', cell: (item) => (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setWizardRepo(String(item.id)); setWizardStep(0); }}>Edit policy</button>
    ) },
  ], []);

  const sourceColumns: DataTableColumn<SourceRow>[] = useMemo(() => [
    { id: 'provider', header: 'Provider', cell: (item) => item.provider },
    { id: 'status', header: 'Status', cell: (item) => (item.enabled ? item.status : 'Paused') },
    { id: 'ok', header: 'Last success', cell: (item) => (item.last_success_at ? formatOperationalTime(item.last_success_at) : 'Unknown') },
    { id: 'err', header: 'Error', cell: (item) => item.last_error || 'None recorded' },
  ], []);

  const agentColumns: DataTableColumn<AgentRow>[] = useMemo(() => [
    { id: 'name', header: 'Name', cell: (item) => item.name },
    { id: 'status', header: 'Status', cell: (item) => item.status },
    { id: 'ver', header: 'Version', cell: (item) => item.version || 'Unknown' },
    { id: 'hb', header: 'Last heartbeat', cell: (item) => (item.last_heartbeat_at ? formatOperationalTime(item.last_heartbeat_at) : 'Unknown') },
  ], []);

  const planColumns: DataTableColumn<PlanRow>[] = useMemo(() => [
    { id: 'label', header: 'Plan', cell: (item) => item.label },
    { id: 'repo', header: 'Repository', cell: (item) => known(item.repository) },
    { id: 'pkg', header: 'Upgrade', cell: (item) => `${item.package_name} ${item.current_version} → ${item.target_version}` },
    { id: 'action', header: 'Action', cell: (item) => item.action.replace(/_/g, ' ') },
    { id: 'status', header: 'Status', cell: (item) => patchLabel(item.status) },
    { id: 'pr', header: 'Proposal', cell: (item) => <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void openPatchPR(item.id)}>Open draft PR</button> },
  ], [apiUrl, busy]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Global Vulnerabilities & Patches - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security</span>
            <h1 className="portal-page__title">Global Vulnerabilities & Patches</h1>
            <p className="portal-page__subtitle">
              {tab === 'configuration'
                ? 'Register a repository, then set collection, ownership, and alert policy. Tokens stay on the API as environment names.'
                : tab === 'sources'
                  ? 'Intelligence feeds, private agents, and CI inventory. After each sync, stored lockfiles are re-checked. An online collector does not mean repositories were scanned.'
                  : 'See which services need action and which patches are available. A public advisory is not proof of repository exposure.'}
            </p>
          </div>
          <div className="runbooks__action-row">
            {isManager && (showScorecards || tab === 'sources') ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void refreshIntelligence()}>Refresh intelligence</button> : null}
            {showScorecards ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void scanSelected()}>{busy ? 'Working…' : 'Scan selected services'}</button> : null}
          </div>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {showScorecards ? (
        <p className="ops-scores__meta">
          <span>Last intelligence sync · {overview.intelligence_synced_at ? formatOperationalTime(overview.intelligence_synced_at) : 'Unknown'} · KEV matches {loading ? '…' : overview.kev_matches ?? 0} · Overdue {loading ? '…' : overview.overdue ?? 0}</span>
          <span>Hosted collector · {hosted ? 'Configured' : 'Offline'}</span>
        </p>
        ) : null}
        {showScorecards ? (
        <section className="ops-minis ops-minis--four" aria-label="Vulnerability scorecards">
          <article className="ops-mini ops-mini--peach">
            <span>Critical findings</span>
            <strong>{loading ? '…' : overview.critical_findings ?? 'Unknown'}</strong>
            <small>Confirmed repository occurrences</small>
          </article>
          <article className="ops-mini ops-mini--peach">
            <span>High findings</span>
            <strong>{loading ? '…' : overview.high_findings ?? 'Unknown'}</strong>
            <small>Confirmed repository occurrences</small>
          </article>
          <article className="ops-mini ops-mini--blue">
            <span>Affected services</span>
            <strong>{loading ? '…' : `${overview.affected_services ?? 0} of ${overview.registered_services ?? 0}`}</strong>
            <small>Registered in this scope</small>
          </article>
          <article className="ops-mini ops-mini--lilac">
            <span>Coverage</span>
            <strong>{loading ? '…' : `${overview.scanned_repositories ?? 0} scanned`}</strong>
            <small>Repositories with a stored inventory</small>
          </article>
        </section>
        ) : null}
        {showScorecards ? <p className="form-section__copy">{overview.count_note || 'Scorecards count confirmed matches, not global advisory volume.'}</p> : null}
        {showScorecards ? (
          <p className="ops-scores__meta sec-vuln-intel">
            <span>
              Internet advisories · Last sync {overview.intelligence_synced_at ? formatOperationalTime(overview.intelligence_synced_at) : 'Unknown'}
              {' '}· {loading ? '…' : overview.intel_repos_assessed ?? 0} stored inventories re-checked
              {' '}· {loading ? '…' : overview.intel_new_matches ?? 0} new matches this sync
              {' '}· {loading ? '…' : overview.intel_open_matches ?? 0} open internet matches
            </span>
            <span>
              {(overview.unscanned_repositories ?? 0) > 0
                ? `${overview.unscanned_repositories} registered repos have no inventory, so new CVEs cannot be checked there.`
                : 'Repos with a stored lockfile are checked when public advisories refresh.'}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setIntelOnly(true);
                void router.replace({ pathname: '/security/vulnerabilities', query: { ...router.query, tab: 'findings' } }, undefined, { shallow: true });
              }}
            >
              Show internet matches
            </button>
          </p>
        ) : null}
        <nav className="ops-tabs" aria-label="Vulnerability workspace">
          {VULN_PRIMARY_TABS.map((item) => (
            <Link key={item.id} href={{ pathname: '/security/vulnerabilities', query: { ...(projectId ? { project_id: projectId } : {}), ...(item.id === 'services' ? {} : { tab: item.id }) } }} className={tab === item.id ? 'is-current' : undefined}>{item.label}</Link>
          ))}
        </nav>
        <nav className="sec-vuln-secondary" aria-label="Setup and history">
          {VULN_SECONDARY_TABS.map((item) => (
            <Link key={item.id} href={{ pathname: '/security/vulnerabilities', query: { ...(projectId ? { project_id: projectId } : {}), tab: item.id } }} className={tab === item.id ? 'is-current' : undefined}>{item.label}</Link>
          ))}
        </nav>
        {tab === 'services' || tab === 'advisories' || tab === 'findings' ? (
          <form className="svc-filters svc-filters--inventory" onSubmit={(event) => event.preventDefault()}>
            <label>
              Search
              <input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Service, repository, package, or advisory" />
            </label>
            <label>
              Severity
              <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="">All displayed</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
              </select>
            </label>
            {tab === 'services' ? (
              <label>
                Team
                <select className="input" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                  <option value="">All teams</option>
                  {teams.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            ) : null}
            {tab === 'services' ? (
              <label>
                Technology
                <select className="input" value={techFilter} onChange={(event) => setTechFilter(event.target.value)}>
                  <option value="">All technologies</option>
                  {technologies.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              Fix availability
              <select className="input" value={patchFilter} onChange={(event) => setPatchFilter(event.target.value)}>
                <option value="">All patch states</option>
                <option value="fix_available">Fix available</option>
                <option value="no_known_fix">No known fix</option>
                <option value="pr_linked">PR linked</option>
              </select>
            </label>
            {tab === 'findings' ? (
              <label>
                Lifecycle
                <select className="input" value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)}>
                  <option value="">All states</option>
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="in_remediation">In remediation</option>
                  <option value="pending_verification">Pending verification</option>
                  <option value="risk_accepted">Risk accepted</option>
                </select>
              </label>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setSeverity(''); setKevOnly(false); setUnassignedOnly(false); setIntelOnly(false); setTeamFilter(''); setTechFilter(''); setPatchFilter(''); setLifecycleFilter(''); }}>Clear</button>
            {tab === 'advisories' ? <label className="label"><input type="checkbox" checked={kevOnly} onChange={(event) => setKevOnly(event.target.checked)} /> KEV only</label> : null}
            {tab === 'findings' ? <label className="label"><input type="checkbox" checked={unassignedOnly} onChange={(event) => setUnassignedOnly(event.target.checked)} /> Unassigned queue</label> : null}
            {tab === 'findings' ? <label className="label"><input type="checkbox" checked={intelOnly} onChange={(event) => setIntelOnly(event.target.checked)} /> Internet advisory matches</label> : null}
          </form>
        ) : null}

        {tab === 'services' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Services</h2>
                <p className="portal-surface__subtitle">Empty coverage is not a clean bill of health. “No matches in scanned scope” only covers assessed modules.</p>
              </div>
            </div>
            {selected.length ? <p className="form-section__copy">{selected.length} services selected. Shared repositories are scanned once.</p> : null}
            <DataTable
              label="Registered services"
              columns={serviceColumns}
              rows={visibleServices}
              rowKey={(item) => String(item.service_id)}
              empty={(
                <EmptyState
                  title={loading ? 'Loading services' : 'No registered services in this scope'}
                  body="Connect a repository on the service record, then scan. This page does not invent coverage."
                />
              )}
            />
          </section>
        ) : null}

        {tab === 'advisories' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Global advisories</h2>
                <p className="portal-surface__subtitle">Public intelligence. A Critical advisory here is not organization exposure unless a repository finding exists.</p>
              </div>
            </div>
            <DataTable
              label="Global advisories"
              columns={advisoryColumns}
              rows={visibleAdvisories}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading advisories' : 'No saved advisories'} body="Use Refresh intelligence. The browser never contacts vulnerability feeds." />}
            />
          </section>
        ) : null}

        {tab === 'findings' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Repository findings</h2>
                <p className="portal-surface__subtitle">Confirmed and potential dependency matches, including internet advisories that hit a stored lockfile. Production exposure stays Unknown until a deployment mapping exists.</p>
              </div>
            </div>
            <DataTable
              label="Repository findings"
              columns={findingColumns}
              rows={visibleFindings}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading findings' : intelOnly ? 'No internet advisory matches' : 'No matches in scanned scope'} body={intelOnly ? 'A public advisory becomes a finding only after it matches a stored lockfile for a registered repository.' : 'This is not a secure label. Check coverage on Scan history if repositories are still unscanned.'} />}
            />
          </section>
        ) : null}

        {tab === 'campaigns' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Campaigns</h2>
                <p className="portal-surface__subtitle">Open findings grouped by canonical advisory, including internet advisories matched to stored lockfiles. Unknown coverage is not listed as unaffected.</p>
              </div>
            </div>
            <DataTable
              label="Advisory campaigns"
              columns={[
                { id: 'id', header: 'Advisory', cell: (item: CampaignRow) => item.canonical_id },
                { id: 'title', header: 'Title', cell: (item: CampaignRow) => item.title || 'Unknown' },
                { id: 'sev', header: 'Severity', cell: (item: CampaignRow) => <span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span> },
                { id: 'count', header: 'Open findings', cell: (item: CampaignRow) => String(item.count) },
                { id: 'svc', header: 'Services', cell: (item: CampaignRow) => (item.services && item.services.length ? item.services.join(', ') : 'Unknown') },
              ]}
              rows={campaigns}
              rowKey={(item) => item.canonical_id}
              empty={<EmptyState title={loading ? 'Loading campaigns' : 'No open advisory campaigns'} body="Campaigns appear after confirmed repository findings exist." />}
            />
          </section>
        ) : null}

        {tab === 'remediation' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Patch plans</h2>
                <p className="portal-surface__subtitle">Grouped candidate upgrades. Counts stay estimated until each occurrence is verified. There is no Apply patch action.</p>
              </div>
            </div>
            <DataTable
              label="Patch plans"
              columns={planColumns}
              rows={plans}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading plans' : 'No patch plans'} body="Plans appear after a confirmed match has a source-supported fix version." />}
            />
          </section>
        ) : null}

        {tab === 'history' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">Scan history</h2>
                <p className="portal-surface__subtitle">Partial and failed scans keep the last successful inventory. They cannot close unscanned modules.</p>
              </div>
            </div>
            <DataTable
              label="Scan history"
              columns={scanColumns}
              rows={scans}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading history' : 'No scans yet'} body="Select services and run Scan selected services." />}
            />
          </section>
        ) : null}

        {tab === 'comparisons' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">PR comparisons</h2>
                <p className="portal-surface__subtitle">Introduced versus removed against the same advisory snapshot. Fork PRs stay closed unless the repository policy allows them.</p>
              </div>
            </div>
            <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void comparePr(); }}>
              <label className="label">Repository
                <select className="input" value={prRepo} onChange={(event) => setPrRepo(event.target.value)}>
                  <option value="">Select</option>
                  {repos.map((item) => <option key={item.id} value={item.id}>{item.repository}</option>)}
                </select>
              </label>
              <label className="label">PR number<input className="input" value={prNumber} onChange={(event) => setPrNumber(event.target.value)} /></label>
              <div className="portal-form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>Compare pull request</button>
              </div>
            </form>
            <DataTable
              label="PR comparisons"
              columns={[
                { id: 'pr', header: 'PR', cell: (item: ComparisonRow) => <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openComparison(item.id)}>{item.repository}#{item.pr_number}</button> },
                { id: 'state', header: 'State', cell: (item: ComparisonRow) => `${item.state} · ${item.coverage}` },
                { id: 'in', header: 'Introduced C/H', cell: (item: ComparisonRow) => `${item.introduced_critical} / ${item.introduced_high}` },
                { id: 'out', header: 'Removed', cell: (item: ComparisonRow) => String(item.removed_count) },
              ]}
              rows={comparisons}
              rowKey={(item) => String(item.id)}
              empty={<EmptyState title={loading ? 'Loading comparisons' : 'No PR comparisons'} body="Removed in a PR does not close default-branch findings." />}
            />
            {compareDetail ? (
              <div className="portal-surface" style={{ marginTop: 16 }}>
                <h3 className="portal-surface__title">Comparison #{compareDetail.id}</h3>
                <p className="form-section__copy">Incomplete coverage is never a clean introduced verdict. Removed here does not close default-branch findings.</p>
                <table className="data-table">
                  <thead>
                    <tr><th>Class</th><th>Advisory</th><th>Package</th><th>Base</th><th>Head</th><th>Severity</th></tr>
                  </thead>
                  <tbody>
                    {compareDetail.items.length ? compareDetail.items.map((item, index) => (
                      <tr key={`${item.canonical_id}-${index}`}>
                        <td>{item.classification.replace(/_/g, ' ')}</td>
                        <td>{item.canonical_id}</td>
                        <td>{item.package_name}</td>
                        <td>{item.base_version || '—'}</td>
                        <td>{item.head_version || '—'}</td>
                        <td><span className={severityBadge(item.severity)}>{severityLabel(item.severity)}</span></td>
                      </tr>
                    )) : <tr><td colSpan={6}>No comparable items in this snapshot.</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === 'new-deps' ? (
          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <h2 className="portal-surface__title">New dependencies</h2>
                <p className="portal-surface__subtitle">Packages that appeared between the last two inventories. Missing metadata is Unknown, not malicious.</p>
              </div>
            </div>
            <DataTable
              label="New dependencies"
              columns={[
                { id: 'repo', header: 'Repository', cell: (item: NewDepRow) => item.repository },
                { id: 'pkg', header: 'Package', cell: (item: NewDepRow) => `${item.ecosystem} ${item.package_name}@${item.version || 'Unknown'}` },
                { id: 'note', header: 'Note', cell: (item: NewDepRow) => item.note || 'Newly introduced package.' },
              ]}
              rows={newDeps}
              rowKey={(item) => `${item.repository}|${item.ecosystem}|${item.package_name}|${item.version}`}
              empty={<EmptyState title={loading ? 'Loading' : 'No newly introduced packages'} body="A second successful inventory is required before a diff exists." />}
            />
          </section>
        ) : null}

        {tab === 'sources' ? (
          <div className="sec-vuln-workspace">
            <dl className="sre-meta">
              <div className="sre-meta__item">
                <dt>Hosted collector</dt>
                <dd>{hosted ? 'Configured' : 'Offline'}</dd>
              </div>
              <div className="sre-meta__item">
                <dt>Private agents</dt>
                <dd>{agents.length ? `${agents.length} enrolled` : 'None enrolled'}</dd>
              </div>
              <div className="sre-meta__item">
                <dt>Last intelligence sync</dt>
                <dd>{overview.intelligence_synced_at ? formatOperationalTime(overview.intelligence_synced_at) : 'Unknown'}</dd>
              </div>
              <div className="sre-meta__item">
                <dt>Inventories re-checked</dt>
                <dd>{overview.intel_repos_assessed ?? 0}</dd>
              </div>
              <div className="sre-meta__item">
                <dt>New internet matches</dt>
                <dd>{overview.intel_new_matches ?? 0}</dd>
              </div>
            </dl>
            <p className="form-section__copy">{hostedNote || 'Hosted collector status is Unknown until the API answers.'}</p>
            <div className="sec-vuln-split">
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Intelligence feeds</h2>
                    <p className="portal-surface__subtitle">Public advisories saved on the API, then matched to stored lockfiles. A fresh feed is not repository coverage.</p>
                  </div>
                </div>
                <DataTable
                  label="Intelligence feeds"
                  columns={sourceColumns}
                  rows={sources}
                  rowKey={(item) => item.provider}
                  empty={<EmptyState title={loading ? 'Loading feeds' : 'No intelligence sources'} body="Refresh intelligence after the API worker can reach the allowlisted feeds." />}
                />
              </section>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <h2 className="portal-surface__title">Private agents</h2>
                    <p className="portal-surface__subtitle">Outbound workers upload inventory only. They do not print tokens, pull images, or write findings.</p>
                  </div>
                </div>
                <DataTable
                  label="Private agents"
                  columns={agentColumns}
                  rows={agents}
                  rowKey={(item) => String(item.id)}
                  empty={<EmptyState title={loading ? 'Loading agents' : 'None enrolled'} body="Create a bootstrap token, then run the worker from a runner that can read the repository." />}
                />
                {isManager ? (
                  <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void enrollAgent(); }}>
                    <label className="label">Agent name<input className="input" value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="build-runner-1" /></label>
                    <div className="portal-form-actions">
                      <button type="submit" className="btn btn-primary" disabled={busy}>Create bootstrap token</button>
                    </div>
                  </form>
                ) : <p className="form-section__copy">Enrolling an agent needs a manager role.</p>}
                {bootstrap ? (
                  <div className="alert alert-success sec-vuln-token" role="status">
                    <span>Shown once. Put this in workers/.env as VULN_BOOTSTRAP_TOKEN.</span>
                    <code>{bootstrap}</code>
                    <CopyButton value={bootstrap} label="bootstrap token" />
                  </div>
                ) : null}
                <p className="form-section__copy">Set OPSTRELLIS_API_URL and VULN_BOOTSTRAP_TOKEN in workers/.env, then run:</p>
                <pre className="sec-vuln-run">python3 workers/vuln_agent.py</pre>
              </section>
            </div>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">CI / SBOM upload</h2>
                  <p className="portal-surface__subtitle">Bind a CycloneDX or SPDX document to a registered repository and commit. Images are not pulled from a Docker socket.</p>
                </div>
              </div>
              <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void uploadSbom(); }}>
                <label className="label">Repository
                  <select className="input" value={sbomRepo} onChange={(event) => setSbomRepo(event.target.value)}>
                    <option value="">Select a registered repository</option>
                    {repos.map((item) => <option key={item.id} value={item.id}>{item.repository}</option>)}
                  </select>
                </label>
                <label className="label">Commit SHA<input className="input" value={sbomCommit} onChange={(event) => setSbomCommit(event.target.value)} placeholder="Immutable commit" /></label>
                <label className="label">SBOM JSON<textarea className="input" rows={6} value={sbomText} onChange={(event) => setSbomText(event.target.value)} /></label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>Upload inventory</button>
                </div>
              </form>
              <p className="form-section__copy">CI can also run <code>python3 workers/vuln_agent.py --ci</code> with VULN_PORTAL_TOKEN and VULN_REPOSITORY_ID.</p>
            </section>
          </div>
        ) : null}

        {tab === 'configuration' ? (
          <div className="sec-vuln-split">
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Repositories</h2>
                  <p className="portal-surface__subtitle">GitHub, GitLab, and Bitbucket URLs are accepted. Hosted tokens stay on the API.</p>
                </div>
              </div>
              <form className="portal-form-grid" onSubmit={(event) => { event.preventDefault(); void registerRepo(); }}>
                <label className="label">Repository<input className="input" value={newRepo} onChange={(event) => setNewRepo(event.target.value)} placeholder="org/service or gitlab.com/group/service" /></label>
                <label className="label">Branch<input className="input" value={newRepoBranch} onChange={(event) => setNewRepoBranch(event.target.value)} /></label>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy || !isManager}>Register</button>
                </div>
              </form>
              {!isManager ? <p className="form-section__copy">Registering a repository needs a manager role.</p> : null}
              <DataTable
                label="Registered repositories"
                columns={repoColumns}
                rows={repos}
                rowKey={(item) => String(item.id)}
                empty={<EmptyState title={loading ? 'Loading repositories' : 'No repositories registered'} body="Register owner/name or a GitHub, GitLab, or Bitbucket URL, then set policy on the right." />}
              />
            </section>
            <section className="portal-surface sec-vuln-wizard">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Repository policy</h2>
                  <p className="portal-surface__subtitle">Connection, ownership, schedule, and alerts. This form never displays secret values.</p>
                </div>
              </div>
              <Stepper
                steps={WIZARD_STEPS}
                current={WIZARD_STEPS[wizardStep]?.id || 'connection'}
                onSelect={(id) => {
                  const index = WIZARD_STEPS.findIndex((step) => step.id === id);
                  if (index >= 0) setWizardStep(index);
                }}
              />
              <form className="portal-form-grid" onSubmit={(event) => {
                event.preventDefault();
                if (wizardStep === 1 && !wizardRepo) {
                  setError('Select a registered repository.');
                  return;
                }
                if (wizardStep < 5) setWizardStep(wizardStep + 1);
                else void saveWizard();
              }}>
                {wizardStep === 0 ? (
                  <label className="label">Collection mode
                    <select className="input" value={wizardMode} onChange={(event) => setWizardMode(event.target.value)}>
                      <option value="hosted">Hosted collector</option>
                      <option value="agent">Private outbound agent</option>
                      <option value="ci">CI inventory / SBOM upload</option>
                    </select>
                  </label>
                ) : null}
                {wizardStep === 1 ? (
                  <label className="label">Repository
                    <select className="input" value={wizardRepo} onChange={(event) => setWizardRepo(event.target.value)}>
                      <option value="">Select a registered repository</option>
                      {repos.map((item) => <option key={item.id} value={item.id}>{item.repository}</option>)}
                    </select>
                  </label>
                ) : null}
                {wizardStep === 2 ? (
                  <label className="label">Owner team<input className="input" value={wizardTeam} onChange={(event) => setWizardTeam(event.target.value)} placeholder="Team that owns this repository" /></label>
                ) : null}
                {wizardStep === 3 ? (
                  <>
                    <label className="label">Schedule minutes<input className="input" value={wizardSchedule} onChange={(event) => setWizardSchedule(event.target.value)} /></label>
                    <label className="label">Path exclusions<input className="input" value={wizardExclusions} onChange={(event) => setWizardExclusions(event.target.value)} placeholder="docs/, vendor/" /></label>
                    <label className="sec-vuln-check"><input type="checkbox" checked={wizardForks} onChange={(event) => setWizardForks(event.target.checked)} /> Allow fork pull requests</label>
                    <label className="sec-vuln-check"><input type="checkbox" checked={wizardGate} onChange={(event) => setWizardGate(event.target.checked)} /> Enforce comparison gate (does not merge)</label>
                  </>
                ) : null}
                {wizardStep === 4 ? (
                  <label className="label">Alert from severity
                    <select className="input" value={wizardAlert} onChange={(event) => setWizardAlert(event.target.value)}>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                    </select>
                  </label>
                ) : null}
                {wizardStep === 5 ? (
                  <dl className="sre-meta">
                    <div className="sre-meta__item"><dt>Repository</dt><dd>{repos.find((item) => String(item.id) === wizardRepo)?.repository || 'Select a repository'}</dd></div>
                    <div className="sre-meta__item"><dt>Collection</dt><dd>{collectionModeLabel(wizardMode)}</dd></div>
                    <div className="sre-meta__item"><dt>Owner team</dt><dd>{wizardTeam || 'Unchanged'}</dd></div>
                    <div className="sre-meta__item"><dt>Alerts from</dt><dd>{wizardAlert}</dd></div>
                    <div className="sre-meta__item"><dt>Fork PRs</dt><dd>{wizardForks ? 'Allowed' : 'Blocked'}</dd></div>
                    <div className="sre-meta__item"><dt>Comparison gate</dt><dd>{wizardGate ? 'Enforced' : 'Informational'}</dd></div>
                  </dl>
                ) : null}
                {wizardStep === 0 || wizardStep === 5 ? (
                  <p className="form-section__copy">Hosted collector never executes package scripts. Saving policy needs a manager role.</p>
                ) : null}
                <div className="portal-form-actions">
                  {wizardStep > 0 ? <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(wizardStep - 1)}>Back</button> : null}
                  <button type="submit" className="btn btn-primary" disabled={busy || (wizardStep === 5 && !isManager)}>{wizardStep < 5 ? 'Next' : 'Save policy'}</button>
                </div>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
